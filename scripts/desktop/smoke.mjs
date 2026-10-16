#!/usr/bin/env node
// Launches the built desktop shell under real Electron and checks it over the
// Chrome DevTools Protocol: renderer isolation, the frozen preload description,
// blocked network/navigation/popups, and the rendered shell. Optional screenshots.
//
//   node scripts/desktop/smoke.mjs [--fixture-preview] [--screenshots <dir>] [--no-os-sandbox]
//
// --no-os-sandbox passes Chromium's --no-sandbox. Use it only on a development
// machine that cannot run Chromium's OS sandbox, and report it: it removes the
// OS-level process sandbox (the renderer `sandbox: true` preference still applies).
// No network access is needed; the debugging port binds to 127.0.0.1 only.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const flag = name => args.includes(name);
const shotsIndex = args.indexOf('--screenshots');
const shots = shotsIndex >= 0 ? resolve(args[shotsIndex + 1] ?? '') : null;
const electronPath = createRequire(import.meta.url)('electron');
const main = join(root, 'apps', 'desktop', 'dist', 'main.cjs');

const freePort = () => new Promise((done, fail) => {
  const server = createServer().listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => done(port)); });
  server.on('error', fail);
});
const sleep = ms => new Promise(done => setTimeout(done, ms));

const port = await freePort();
const profile = await mkdtemp(join(tmpdir(), 'bighelp-smoke-'));
const child = spawn(electronPath, [
  `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1',
  ...(flag('--no-os-sandbox') ? ['--no-sandbox'] : []), main, ...(flag('--fixture-preview') ? ['--fixture-preview'] : []),
], { env: { ...process.env, XDG_CONFIG_HOME: profile, ELECTRON_DISABLE_SECURITY_WARNINGS: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
let stderr = '';
child.stderr.on('data', chunk => { stderr += chunk; });
child.stdout.on('data', () => {});

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: Boolean(ok), detail }); };
let socket;
let browserVersion;
try {
  let target;
  for (let attempt = 0; attempt < 60 && !target; attempt++) {
    await sleep(250);
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      target = list.find(entry => entry.type === 'page' && entry.url.startsWith('app://bighelp/'));
    } catch { /* not listening yet */ }
    if (child.exitCode !== null) break;
  }
  if (!target) throw new Error(`App window did not appear. Electron said: ${stderr.slice(-800)}`);

  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((done, fail) => { socket.onopen = done; socket.onerror = () => fail(new Error('CDP connect failed')); });
  let nextId = 0;
  const waiting = new Map();
  const requests = new Map();
  const answered = new Set();
  const failures = new Map();
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id && waiting.has(message.id)) { waiting.get(message.id)(message); waiting.delete(message.id); }
    if (message.method === 'Network.requestWillBeSent') requests.set(message.params.requestId, message.params.request.url);
    if (message.method === 'Network.responseReceived') answered.add(message.params.requestId);
    if (message.method === 'Network.loadingFailed') failures.set(message.params.requestId, message.params.errorText);
  };
  const send = (method, params = {}) => new Promise(done => {
    const id = ++nextId; waiting.set(id, done); socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const reply = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (reply.result?.exceptionDetails) throw new Error(`Evaluation failed: ${expression}`);
    return reply.result?.result?.value;
  };
  await send('Network.enable');
  browserVersion = await evaluate('navigator.userAgent.match(/(Chrome|Electron)\\/[\\d.]+/g)?.join(" ")');
  for (let attempt = 0; attempt < 40; attempt++) {
    if (await evaluate("document.querySelector('[aria-label=\"Places\"]') !== null")) break;
    await sleep(250);
  }

  // Renderer isolation and the preload contract.
  check('renderer has no Node require/process/module', await evaluate(
    "typeof require === 'undefined' && typeof process === 'undefined' && typeof module === 'undefined'"));
  const info = await evaluate('JSON.stringify(window.bighelpShell)');
  check('preload exposes only {platform, fixturePreview}', /^\{"platform":"(windows|linux|other)","fixturePreview":(true|false)\}$/u.test(info ?? ''), info);
  check('preload object is frozen', await evaluate('Object.isFrozen(window.bighelpShell)'));
  check('no electron/ipc globals', await evaluate("!('ipcRenderer' in window) && !('electron' in window)"));
  check('page served from app://bighelp', await evaluate("location.origin === 'app://bighelp'"));
  const csp = await evaluate("document.querySelector('meta[http-equiv=\"Content-Security-Policy\"]')?.content ?? ''");
  check('CSP forbids connections', /connect-src 'none'/u.test(csp));

  // Network, popups and navigation must all fail closed.
  check('fetch to the internet is blocked', await evaluate(
    "fetch('https://example.invalid/').then(() => false, () => true)"));
  check('fetch to a local host is blocked', await evaluate(
    "fetch('http://127.0.0.1:9/api/status').then(() => false, () => true)"));
  check('window.open is denied', await evaluate("window.open('https://example.invalid/') === null"));
  // Second layer: with CSP bypassed in DevTools, the main-process request filter must still refuse.
  await send('Page.setBypassCSP', { enabled: true });
  await send('Page.reload');
  await sleep(1500);
  check('without CSP, the request still fails', await evaluate(
    "fetch('http://127.0.0.1:9/api/status').then(() => false, error => error instanceof TypeError)"));
  await sleep(300);
  const probe = [...requests].filter(([, url]) => url === 'http://127.0.0.1:9/api/status').map(([id]) => failures.get(id));
  check('the main-process filter is what blocked it', probe.includes('net::ERR_BLOCKED_BY_CLIENT'), JSON.stringify(probe));
  await send('Page.setBypassCSP', { enabled: false });
  await send('Page.reload');
  await sleep(1500);
  await evaluate("(() => { location.href = 'https://example.invalid/'; return true; })()");
  await sleep(600);
  check('navigation away is refused', await evaluate("location.origin === 'app://bighelp'"));

  // Keyboard: Tab reaches the rail, and Enter/Space activates a rail item.
  await evaluate('document.activeElement?.blur(), true');
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  check('Tab moves focus to the first rail item', await evaluate("document.activeElement?.getAttribute('aria-label')") === 'Chats');
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  // A real Enter carries the "\r" character; native buttons activate from it.
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await sleep(200);
  check('Enter on a focused rail item opens that place', await evaluate(
    "document.querySelector('[role=region]')?.getAttribute('aria-label')") === 'Agents');
  await evaluate("document.querySelector('[aria-label=\"Workflows\"]').focus(), true");
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, text: ' ' });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  await sleep(200);
  check('Space on a focused rail item opens that place', await evaluate(
    "document.querySelector('[role=region]')?.getAttribute('aria-label')") === 'Workflows');
  await evaluate("document.querySelector('[aria-label=\"Chats\"]').click(), true");
  await sleep(150);

  // The shell itself.
  const text = await evaluate('document.body.innerText');
  check('rail shows the one navigation', ['Chats', 'Agents', 'Projects', 'Kanban', 'Workflows', 'Scheduled', 'Usage', 'Vault', 'Settings']
    .every(label => text.includes(label)), '');
  const fixture = flag('--fixture-preview');
  check(fixture ? 'sample data is labelled' : 'no invented data without a computer',
    fixture ? text.includes('Sample data') : text.includes('No computer connected yet') && !text.includes('Juniper'));

  const click = label => evaluate(`(() => { const el = document.querySelector('[aria-label=${JSON.stringify(label)}]'); if (!el) return false; el.click(); return true; })()`);
  const capture = async name => {
    if (!shots) return;
    await sleep(250);
    const reply = await send('Page.captureScreenshot', { format: 'png' });
    await writeFile(join(shots, `${name}.png`), Buffer.from(reply.result.data, 'base64'));
  };
  if (shots) await mkdir(shots, { recursive: true });

  if (fixture) {
    await click('Planning call checklist, with Juniper');
    await sleep(300);
    const open = await evaluate('document.body.innerText');
    check('opening a chat shows the agent tabs', ['Feed', 'Ideas', 'Goals', 'Files'].every(label => open.includes(label)));
    check('unknown send is shown as unknown, not failed', open.includes('Not sure this arrived.') && !/failed/iu.test(open));
    // Real input path: focus, then Chromium's text-commit pipeline (the same path an IME commit takes).
    await evaluate("document.querySelector('textarea[aria-label=\"Message Juniper\"]').focus(), true");
    await send('Input.insertText', { text: 'Also remind me about the projector on Monday' });
    await sleep(150);
    check('composer accepts typed text through the input pipeline', await evaluate(
      "document.querySelector('textarea[aria-label=\"Message Juniper\"]').value") === 'Also remind me about the projector on Monday');
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await sleep(150);
    check('Enter in the composer sends nothing and keeps the draft', await evaluate(
      "document.querySelector('textarea[aria-label=\"Message Juniper\"]').value.startsWith('Also remind me about the projector on Monday')"));
    await evaluate("(() => { const box = document.querySelector('textarea[aria-label=\"Message Juniper\"]'); box.select(); return true; })()");
    await send('Input.insertText', { text: 'Also remind me about the projector on Monday' });
    check('Send stays disabled without a computer', await evaluate(
      "document.querySelector('[aria-label^=\"Send.\"]')?.getAttribute('aria-disabled') === 'true'"));
    await capture('wide-light-chat');
    await click('Workflows');
    await sleep(200);
    check('function pages have no agent tab bar', !(await evaluate("document.querySelector('[role=tablist]') !== null")));
    await capture('wide-light-workflows');
    await click('Chats');
    await sleep(200);
    check('draft survives navigation', await evaluate(
      "document.querySelector('textarea[aria-label=\"Message Juniper\"]')?.value === 'Also remind me about the projector on Monday'"));
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
    await sleep(300);
    await capture('wide-dark-chat');
    await click('Settings');
    await click('Nerd Mode');
    await sleep(200);
    const settings = await evaluate('document.body.innerText');
    check('Nerd Mode reveals Hermes items in the one Settings', settings.includes('Hermes tools') && settings.includes('System'));
    await capture('wide-dark-settings-nerd');
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
    await send('Emulation.setDeviceMetricsOverride', { width: 720, height: 780, deviceScaleFactor: 1, mobile: false });
    await click('Chats');
    await sleep(400);
    await capture('narrow-light-list');
    await click('Planning call checklist, with Juniper');
    await sleep(300);
    check('narrow chat offers Back to the list', await evaluate("document.querySelector('[aria-label=\"Back to the list\"]') !== null"));
    await capture('narrow-light-chat');
  } else {
    await capture('wide-light-empty');
  }
  const escaped = [...requests].filter(([id, url]) => !url.startsWith('app://bighelp/') && !url.startsWith('data:') && answered.has(id));
  check('no request outside app:// got a response', escaped.length === 0,
    `${requests.size} requests seen, ${escaped.length} answered outside app://`);
} catch (error) {
  check('smoke run completed', false, error instanceof Error ? error.message : String(error));
} finally {
  try { socket?.close(); } catch { /* closing */ }
  child.kill('SIGTERM');
  await sleep(500);
  if (child.exitCode === null) child.kill('SIGKILL');
  await rm(profile, { recursive: true, force: true });
}

const failed = results.filter(result => !result.ok);
const runtime = browserVersion ?? null;
process.stdout.write(`${JSON.stringify({
  runtime, osSandbox: flag('--no-os-sandbox') ? 'disabled (--no-sandbox)' : 'enabled',
  fixturePreview: flag('--fixture-preview'), screenshots: shots, passed: results.length - failed.length, failed: failed.length, results,
}, null, 2)}\n`);
process.exit(failed.length === 0 ? 0 : 1);
