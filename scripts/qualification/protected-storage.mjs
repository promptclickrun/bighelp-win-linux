#!/usr/bin/env node
// Real Electron/OS encryption, disposable synthetic state, two separate launches.
// No app main/service, host discovery, provider environment scan, or network.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdtemp, mkdir, open, readdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const MAX_OUTPUT_BYTES = 64 * 1024;
const BACKENDS = ['windows-dpapi', 'gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6', 'basic_text', 'unknown'];
const key = 'synthetic-protected-restart-v1';
const marker = 'synthetic-bighelp-os-protection-restart-value-v1';

export function parseArguments(args) {
  const options = { requireAvailable: false, headless: false, executable: null };
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === '--require-available' && !options.requireAvailable) options.requireAvailable = true;
    else if (argument === '--headless' && !options.headless) options.headless = true;
    else if (argument === '--executable' && options.executable === null) {
      const executable = args[++index];
      if (typeof executable !== 'string' || executable.length < 1 || executable.length > 4096
        || executable.startsWith('--') || executable.includes('\0')) throw Error('invalid-arguments');
      options.executable = resolve(executable);
    }
    else throw Error('invalid-arguments');
  }
  if (options.headless && process.platform !== 'linux') throw Error('invalid-arguments');
  return options;
}

export function isolatedEnvironment(directory, environment = process.env) {
  const result = {};
  // Only fixed OS launcher/display/Secret Service inputs; never enumerate the
  // environment or forward provider/auth variables, NODE_OPTIONS, or Electron flags.
  for (const name of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'SystemDrive', 'COMSPEC', 'PATHEXT',
    'DISPLAY', 'WAYLAND_DISPLAY', 'XAUTHORITY', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS', 'LANG', 'LC_ALL']) {
    if (typeof environment[name] === 'string') result[name] = environment[name];
  }
  for (const name of ['HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME',
    'TMPDIR', 'TEMP', 'TMP']) result[name] = directory;
  return result;
}

// Exported for synthetic process-boundary tests. Raw child output is discarded.
export function runBoundedProcess(executable, args, { env, cwd, signal, deadlineMs = 30_000, maxOutputBytes = MAX_OUTPUT_BYTES }) {
  return new Promise(resolveResult => {
    let outputBytes = 0;
    let failure;
    let finished = false;
    let killTimer;
    const child = spawn(executable, args, { env, cwd, detached: process.platform !== 'win32', windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'] });
    const finish = result => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      signal?.removeEventListener('abort', abort);
      resolveResult(result);
    };
    const kill = reason => {
      if (failure || finished) return;
      failure = reason;
      if (child.pid) {
        if (process.platform === 'win32') {
          // Terminate the process tree as well as the Electron parent. Never shell.
          const terminator = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'],
            { env, windowsHide: true, stdio: 'ignore', timeout: 2000 });
          terminator.on('error', () => child.kill('SIGKILL'));
          terminator.once('close', () => child.kill('SIGKILL'));
        } else {
          try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
        }
      }
      // Even a broken launcher cannot leave the qualification itself unbounded.
      killTimer = setTimeout(() => {
        child.stdout.destroy();
        child.stderr.destroy();
        child.unref();
        finish({ status: 'failed', reason: 'termination-not-confirmed' });
      }, 3000);
    };
    const abort = () => kill('interrupted');
    const timer = setTimeout(() => kill('process-deadline'), deadlineMs);
    const drain = chunk => {
      outputBytes += chunk.length;
      if (outputBytes > maxOutputBytes) kill('process-output-limit');
    };
    child.stdout.on('data', drain);
    child.stderr.on('data', drain);
    child.once('error', () => finish({ status: 'failed', reason: 'process-launch-failed' }));
    child.once('close', code => finish(failure ? { status: 'failed', reason: failure }
      : { status: code === 0 ? 'passed' : 'failed', reason: code === 0 ? 'process-exited' : 'process-exit-failed' }));
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
}

async function boundedFile(filename, maximum) {
  const file = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size < 1 || stat.size > maximum) throw Error('invalid-file');
    const bytes = Buffer.alloc(maximum + 1);
    let length = 0;
    while (length < bytes.length) {
      const { bytesRead } = await file.read(bytes, length, bytes.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length < 1 || length > maximum) throw Error('invalid-file');
    return bytes.subarray(0, length);
  } finally { await file.close(); }
}

export function validatePhaseReport(input, phase, platform) {
  if (!input || Array.isArray(input) || typeof input !== 'object' || Object.keys(input).sort().join(',') !== 'backend,electron,phase,reason,status'
    || input.phase !== phase || !['write', 'read'].includes(phase)
    || !BACKENDS.includes(input.backend) || typeof input.electron !== 'string'
    || !/^\d{1,6}\.\d{1,6}\.\d{1,6}$/.test(input.electron)) throw Error('invalid-phase-report');
  const expectedReason = input.status === 'passed' ? (phase === 'write' ? 'synthetic-value-written' : 'synthetic-value-recovered')
    : input.status === 'unavailable' ? 'os-encryption-unavailable'
      : input.status === 'failed' ? 'protected-storage-operation-failed' : null;
  if (!expectedReason || input.reason !== expectedReason
    || (input.status === 'passed' && (platform === 'win32' ? input.backend !== 'windows-dpapi'
      : !['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6'].includes(input.backend)))) throw Error('invalid-phase-report');
  return { phase, status: input.status, reason: input.reason, backend: input.backend, electron: input.electron };
}

export function assertCiphertext(bytes) {
  for (const text of [key, marker, '"sequence":1']) {
    if (bytes.includes(Buffer.from(text)) || bytes.includes(Buffer.from(text, 'utf16le'))) throw Error('plaintext-in-protected-file');
  }
}

async function ciphertext(directory) {
  const filename = `${createHash('sha256').update(key).digest('hex')}.enc`;
  const files = await readdir(join(directory, 'protected'));
  if (files.length !== 1 || files[0] !== filename) throw Error('unexpected-protected-state');
  const bytes = await boundedFile(join(directory, 'protected', filename), 1024 * 1024 + 64 * 1024);
  assertCiphertext(bytes);
  return bytes;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    process.stdout.write('Usage: node scripts/qualification/protected-storage.mjs [--require-available] [--headless] [--executable <path>]\n'
      + 'Disposable real Electron safeStorage write/relaunch/read probe; sandbox stays enabled.\n'
      + 'Exit 0: passed or optional unavailable; 1: failed or required unavailable; 2: invalid arguments.\n');
    return;
  }
  let options;
  try { options = parseArguments(args); } catch {
    process.stderr.write('Invalid arguments. Use --help.\n'); process.exitCode = 2; return;
  }
  const report = { schemaVersion: 1, evidence: 'disposable-real-os-protection-restart', platform: process.platform,
    osSandbox: 'enabled', status: 'failed', reason: 'probe-failed', phases: [],
    checks: { ciphertextExcludesPlaintext: false, recoveredAfterProcessRestart: false, ciphertextUnchangedAfterRead: false },
    cleanup: 'not-created', platformAcceptance: false };
  let directory;
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  try {
    if (!['linux', 'win32'].includes(process.platform)) throw Error('unsupported-platform');
    directory = await mkdtemp(join(tmpdir(), 'bighelp-os-protection-'));
    report.cleanup = 'pending';
    for (const child of ['user-data', 'session-data', 'crash-dumps']) await mkdir(join(directory, child), { mode: 0o700 });
    const { build } = await import('esbuild');
    const entry = join(directory, 'probe.cjs');
    await build({ entryPoints: [join(sourceRoot, 'scripts/qualification/protected-storage-electron.ts')], outfile: entry,
      bundle: true, platform: 'node', format: 'cjs', target: 'node24', external: ['electron'], logLevel: 'silent' });
    const executable = options.executable ?? createRequire(import.meta.url)('electron');
    let written;
    for (const phase of ['write', 'read']) {
      if (controller.signal.aborted) throw Error('interrupted');
      const result = await runBoundedProcess(executable, [
        ...(options.headless ? ['--ozone-platform=headless', '--disable-gpu'] : []), entry, phase, directory,
      ], { env: isolatedEnvironment(directory), cwd: directory, signal: controller.signal });
      // A failed child is still redacted; its stderr never enters the report.
      if (result.status !== 'passed') {
        report.phases.push({ phase, ...result }); report.reason = result.reason; break;
      }
      const observed = validatePhaseReport(JSON.parse((await boundedFile(join(directory, `${phase}.json`), 1024)).toString('utf8')),
        phase, process.platform);
      report.phases.push(observed);
      if (observed.status !== 'passed') {
        report.status = phase === 'write' ? observed.status : 'failed';
        report.reason = phase === 'write' ? observed.reason : 'os-protection-lost-after-restart';
        break;
      }
      if (phase === 'write') {
        written = await ciphertext(directory);
        report.checks.ciphertextExcludesPlaintext = true;
      } else {
        const recovered = await ciphertext(directory);
        if (!written.equals(recovered)) throw Error('ciphertext-changed-after-read');
        if (observed.backend !== report.phases[0].backend || observed.electron !== report.phases[0].electron) throw Error('runtime-changed');
        report.checks.recoveredAfterProcessRestart = true;
        report.checks.ciphertextUnchangedAfterRead = true;
        report.status = 'passed'; report.reason = 'synthetic-value-recovered-after-restart';
      }
    }
  } catch {
    report.status = 'failed'; report.reason = 'probe-failed';
  } finally {
    if (directory) {
      try { await rm(directory, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 }); report.cleanup = 'removed'; }
      catch { report.cleanup = 'failed'; report.status = 'failed'; report.reason = 'cleanup-failed'; }
    }
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.status === 'passed' || (report.status === 'unavailable' && !options.requireAvailable) ? 0 : 1;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main();
