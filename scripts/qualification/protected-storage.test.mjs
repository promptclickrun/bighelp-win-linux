// Synthetic harness checks only. These do not qualify OS encryption.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { assertCiphertext, isolatedEnvironment, parseArguments, runBoundedProcess, validatePhaseReport } from './protected-storage.mjs';

const script = fileURLToPath(new URL('./protected-storage.mjs', import.meta.url));
const phaseReport = overrides => ({ phase: 'write', status: 'passed', reason: 'synthetic-value-written',
  backend: 'windows-dpapi', electron: '44.7.2', ...overrides });

test('qualification harness: only finite flags are accepted; plaintext/sandbox overrides are rejected', () => {
  assert.deepEqual(parseArguments([]), { requireAvailable: false, headless: false, executable: null });
  assert.equal(parseArguments(['--require-available']).requireAvailable, true);
  assert.equal(parseArguments(['--executable', 'synthetic-runtime']).executable, resolve('synthetic-runtime'));
  for (const args of [['--no-sandbox'], ['--password-store=basic'], ['--require-available', '--require-available'],
    ['--executable'], ['--executable', '--no-sandbox'], ['--executable', ''], ['--executable', 'a\0b'],
    ['--executable', 'a', '--executable', 'b'], ['--headless', '--headless']]) assert.throws(() => parseArguments(args));
});

test('qualification harness: child environment permits only fixed OS inputs and isolates all profile/temp paths', () => {
  const environment = new Proxy({ PATH: 'synthetic-launcher-path', DBUS_SESSION_BUS_ADDRESS: 'synthetic-session-bus',
    HOME: 'private-home', NODE_OPTIONS: '--inspect', ELECTRON_RUN_AS_NODE: '1', PROVIDER_KEY: 'private-provider-value' }, {
    ownKeys() { throw Error('Environment enumeration forbidden'); },
  });
  const child = isolatedEnvironment('synthetic-fresh-directory', environment);
  assert.equal(child.PATH, 'synthetic-launcher-path');
  assert.equal(child.DBUS_SESSION_BUS_ADDRESS, 'synthetic-session-bus');
  for (const name of ['HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME',
    'TMPDIR', 'TEMP', 'TMP']) assert.equal(child[name], 'synthetic-fresh-directory');
  assert.equal(child.PROVIDER_KEY, undefined);
  assert.equal(child.NODE_OPTIONS, undefined);
  assert.equal(child.ELECTRON_RUN_AS_NODE, undefined);
  assert.doesNotMatch(JSON.stringify(child), /private-/);
});

test('qualification harness: runtime evidence rejects unknown fields, malformed values, and insecure success', () => {
  assert.equal(validatePhaseReport(phaseReport(), 'write', 'win32').status, 'passed');
  assert.equal(validatePhaseReport(phaseReport({ phase: 'read', reason: 'synthetic-value-recovered' }), 'read', 'win32').status, 'passed');
  for (const backend of ['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6']) {
    assert.equal(validatePhaseReport(phaseReport({ backend }), 'write', 'linux').status, 'passed');
  }
  const unavailable = phaseReport({ status: 'unavailable', reason: 'os-encryption-unavailable', backend: 'basic_text' });
  assert.equal(validatePhaseReport(unavailable, 'write', 'linux').status, 'unavailable');
  for (const input of [null, [], {}, phaseReport({ privateValue: 'private' }), phaseReport({ phase: 'read' }),
    phaseReport({ backend: 'basic_text' }), phaseReport({ backend: 'unknown' }), phaseReport({ electron: '44.7.2-private' }),
    phaseReport({ reason: 'private' }), phaseReport({ status: 'qualified' })]) {
    assert.throws(() => validatePhaseReport(input, 'write', 'win32'), /^Error: invalid-phase-report$/);
  }
  assert.throws(() => validatePhaseReport(phaseReport({ backend: 'windows-dpapi' }), 'write', 'linux'));
});

test('qualification harness: ciphertext checks reject UTF-8 and UTF-16 synthetic plaintext', () => {
  assert.doesNotThrow(() => assertCiphertext(Buffer.from([0, 12, 234, 255, 3, 1])));
  for (const text of ['synthetic-protected-restart-v1', 'synthetic-bighelp-os-protection-restart-value-v1', '"sequence":1']) {
    for (const encoding of ['utf8', 'utf16le']) assert.throws(() => assertCiphertext(Buffer.from(text, encoding)), /plaintext-in-protected-file/);
  }
});

async function withProcess(run) {
  const directory = await mkdtemp(join(tmpdir(), 'bighelp-protection-harness-test-'));
  try {
    return await run({ env: isolatedEnvironment(directory), cwd: directory, deadlineMs: 2000 });
  } finally { await rm(directory, { recursive: true, force: true }); }
}

test('qualification harness: child success and nonzero exit never expose diagnostics', () => withProcess(async options => {
  const success = await runBoundedProcess(process.execPath, ['-e', 'process.stdout.write("synthetic-private-value"); process.stderr.write("synthetic-private-error")'], options);
  assert.deepEqual(success, { status: 'passed', reason: 'process-exited' });
  const failure = await runBoundedProcess(process.execPath, ['-e', 'process.stderr.write("synthetic-private-error"); process.exit(9)'], options);
  assert.deepEqual(failure, { status: 'failed', reason: 'process-exit-failed' });
  assert.doesNotMatch(JSON.stringify([success, failure]), /private/);
}));

test('qualification harness: excessive combined output is killed and redacted', () => withProcess(async options => {
  const result = await runBoundedProcess(process.execPath, ['-e',
    'process.stdout.write("private".repeat(10000)); process.stderr.write("private".repeat(10000)); setInterval(()=>{},1000)'],
  { ...options, maxOutputBytes: 64 * 1024 });
  assert.deepEqual(result, { status: 'failed', reason: 'process-output-limit' });
}));

test('qualification harness: a hung child is killed by its deadline', () => withProcess(async options => {
  const start = Date.now();
  const result = await runBoundedProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { ...options, deadlineMs: 150 });
  assert.deepEqual(result, { status: 'failed', reason: 'process-deadline' });
  assert.ok(Date.now() - start < 5000);
}));

test('qualification harness: interruption kills the child and returns a fixed category', () => withProcess(async options => {
  const controller = new AbortController();
  const promise = runBoundedProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { ...options, signal: controller.signal });
  controller.abort();
  assert.deepEqual(await promise, { status: 'failed', reason: 'interrupted' });
}));

test('qualification harness: missing executable is reported without exposing its path', () => withProcess(async options => {
  const result = await runBoundedProcess(join(options.cwd, 'private-missing-runtime'), [], options);
  assert.deepEqual(result, { status: 'failed', reason: 'process-launch-failed' });
}));

test('qualification harness: CLI help and invalid arguments are bounded and do not echo input', () => {
  const help = spawnSync(process.execPath, [script, '--help'], { encoding: 'utf8', timeout: 5000, maxBuffer: 4096 });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /sandbox stays enabled/);
  assert.equal(help.stderr, '');
  const invalid = spawnSync(process.execPath, [script, '--synthetic-private-value'], { encoding: 'utf8', timeout: 5000, maxBuffer: 4096 });
  assert.equal(invalid.status, 2);
  assert.equal(invalid.stdout, '');
  assert.equal(invalid.stderr, 'Invalid arguments. Use --help.\n');
});
