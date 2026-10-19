import assert from 'node:assert/strict';
import test from 'node:test';
import {
  APP_ORIGIN, CONTENT_SECURITY_POLICY, launchOptions, resolveAppAsset, secureWebPreferences, isAppRequest,
} from '../apps/desktop/src/main/policy.ts';
import { FIXTURE_PREVIEW_ARG, createShellInfo, parseShellInfo } from '../apps/desktop/src/shared/shell-info.ts';

test('desktop policy: every window gets the locked-down renderer settings', () => {
  const prefs = secureWebPreferences('/app/preload.cjs', false);
  assert.equal(prefs.contextIsolation, true);
  assert.equal(prefs.sandbox, true);
  assert.equal(prefs.nodeIntegration, false);
  assert.equal(prefs.nodeIntegrationInWorker, false);
  assert.equal(prefs.nodeIntegrationInSubFrames, false);
  assert.equal(prefs.webSecurity, true);
  assert.equal(prefs.allowRunningInsecureContent, false);
  assert.equal(prefs.webviewTag, false);
  assert.equal(prefs.navigateOnDragDrop, false);
  assert.equal(prefs.spellcheck, false, 'spellcheck dictionaries download from the network');
  assert.equal(prefs.preload, '/app/preload.cjs');
  assert.deepEqual(prefs.additionalArguments, []);
  assert.equal(Object.isFrozen(prefs), true);
  assert.deepEqual(secureWebPreferences('/app/preload.cjs', true).additionalArguments, [FIXTURE_PREVIEW_ARG]);
});

test('desktop policy: the preload path must be absolute', () => {
  assert.throws(() => secureWebPreferences('preload.cjs', false));
  assert.throws(() => secureWebPreferences('', false));
});

test('desktop policy: sample data needs an explicit flag and never runs in a packaged build', () => {
  assert.deepEqual(launchOptions(['electron', '.'], false), { fixturePreview: false });
  assert.deepEqual(launchOptions(['electron', '.', '--fixture-preview'], false), { fixturePreview: true });
  assert.deepEqual(launchOptions(['bighelp', '--fixture-preview'], true), { fixturePreview: false });
  assert.deepEqual(launchOptions(['electron', '.', '--fixture-preview=1'], false), { fixturePreview: false });
});

test('desktop policy: the app protocol serves an exact allowlist, nothing else', () => {
  assert.equal(APP_ORIGIN, 'app://bighelp');
  assert.deepEqual(resolveAppAsset('app://bighelp/'), { file: 'index.html', type: 'text/html; charset=utf-8' });
  assert.deepEqual(resolveAppAsset('app://bighelp/index.html'), { file: 'index.html', type: 'text/html; charset=utf-8' });
  assert.deepEqual(resolveAppAsset('app://bighelp/renderer.js'), { file: 'renderer.js', type: 'text/javascript; charset=utf-8' });
  for (const url of [
    'app://bighelp/../main.cjs', 'app://bighelp/%2e%2e/main.cjs', 'app://bighelp/preload.cjs',
    'app://bighelp/renderer.js?x=1', 'app://bighelp/index.html#top', 'app://other/index.html',
    'app://bighelp:8080/index.html', 'app://user@bighelp/index.html', 'file:///etc/passwd',
    'https://bighelp/index.html', 'app://bighelp/RENDERER.JS', 'app://bighelp//renderer.js',
    'app://bighelp/renderer.js/', 'app://bighelp\\renderer.js', 'not a url', '',
  ]) assert.equal(resolveAppAsset(url), null, url);
});

test('desktop policy: only app-origin requests leave the renderer', () => {
  assert.equal(isAppRequest('app://bighelp/renderer.js'), true);
  for (const url of ['https://example.invalid/', 'http://127.0.0.1:9119/api/status', 'ws://127.0.0.1/api/ws',
    'file:///etc/hosts', 'data:text/html,hi', 'app://other/x', 'devtools://devtools/x']) {
    assert.equal(isAppRequest(url), false, url);
  }
});

test('desktop policy: the content security policy blocks scripts and connections from anywhere else', () => {
  const directives = new Map(CONTENT_SECURITY_POLICY.split(';').map(part => {
    const [name, ...values] = part.trim().split(/\s+/u);
    return [name, values.join(' ')];
  }));
  assert.equal(directives.get('default-src'), "'none'");
  assert.equal(directives.get('script-src'), "'self'");
  assert.equal(directives.get('connect-src'), "'none'");
  assert.equal(directives.get('object-src'), "'none'");
  assert.equal(directives.get('base-uri'), "'none'");
  assert.equal(directives.get('form-action'), "'none'");
  assert.equal(directives.get('frame-ancestors'), "'none'");
  assert.equal(CONTENT_SECURITY_POLICY.includes('unsafe-eval'), false);
  assert.equal(/script-src[^;]*unsafe-inline/u.test(CONTENT_SECURITY_POLICY), false);
});

test('shell info: the preload exposes a frozen, finite description of the shell', () => {
  const linux = createShellInfo(['electron', FIXTURE_PREVIEW_ARG], 'linux');
  assert.deepEqual(linux, { platform: 'linux', fixturePreview: true, appVersion: '', system: '' });
  assert.equal(Object.isFrozen(linux), true);
  assert.deepEqual(createShellInfo([], 'win32', { appVersion: '0.1.0', systemVersion: '10.0.26100', arch: 'x64' }),
    { platform: 'windows', fixturePreview: false, appVersion: '0.1.0', system: 'Windows 10.0.26100 x64' });
  assert.deepEqual(createShellInfo([], 'darwin'), { platform: 'other', fixturePreview: false, appVersion: '', system: '' });
  // Only short printable facts: control characters are dropped, oversized values are left out.
  assert.deepEqual(createShellInfo([], 'linux', { appVersion: '1.0\n(dev)', systemVersion: 'x'.repeat(200), arch: 'arm64' }),
    { platform: 'linux', fixturePreview: false, appVersion: '1.0 (dev)', system: 'Linux arm64' });
});

test('shell info: the renderer accepts only the exact shape and otherwise assumes nothing', () => {
  const valid = { platform: 'windows', fixturePreview: true, appVersion: '0.1.0 (development build)', system: 'Windows 10.0.26100 x64' };
  assert.deepEqual(parseShellInfo(valid), valid);
  const fallback = { platform: 'other', fixturePreview: false, appVersion: '', system: '' };
  for (const value of [undefined, null, 'linux', [], { platform: 'linux' }, { platform: 'mac', fixturePreview: false },
    { platform: 'linux', fixturePreview: 'yes' }, { platform: 'linux', fixturePreview: false, token: 'x' },
    { platform: 'windows', fixturePreview: true }, { ...valid, token: 'x' }, { ...valid, appVersion: 1 },
    { ...valid, system: 'Linux\n6.8' }, { ...valid, appVersion: 'x'.repeat(65) }]) {
    assert.deepEqual(parseShellInfo(value), fallback, JSON.stringify(value));
  }
});
