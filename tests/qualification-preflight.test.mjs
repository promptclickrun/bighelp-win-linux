import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createPreflightReport } from '../scripts/qualification/preflight.mjs';

const script = fileURLToPath(new URL('../scripts/qualification/preflight.mjs', import.meta.url));
const facts = (overrides = {}) => ({
  platform: 'linux', architecture: 'x64', osRelease: '6.8.0',
  node: '24.22.0', electron: null, chromium: null, sessionHint: 'wayland',
  features: { fetch: true, webSocket: true, abortController: true, textDecoder: true },
  ...overrides,
});

function cli(args = [], extraEnv = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8', timeout: 10_000,
    env: { ...process.env, NODE_OPTIONS: '', ...extraEnv },
  });
}

test('qualification: deterministic report strips unknown facts and never certifies a target', () => {
  const input = facts({ token: 'synthetic-private-token', hostname: 'private-host' });
  const before = structuredClone(input);
  const report = createPreflightReport(input);
  assert.deepEqual(report, createPreflightReport(input));
  assert.deepEqual(input, before);
  assert.equal(report.localPreflight.status, 'ready');
  assert.equal(report.proposedToolchain.matches, true);
  assert.equal(report.platformAcceptance, false);
  assert.equal(report.targetIdentity, 'not-verified');
  assert.deepEqual(report.qualification, [
    { target: 'windows-11-x64', status: 'not-exercised' },
    { target: 'ubuntu-24.04-x64-wayland', status: 'not-exercised' },
    { target: 'ubuntu-24.04-x64-x11', status: 'not-exercised' },
  ]);
  assert.doesNotMatch(JSON.stringify(report), /synthetic-private-token|private-host/);
});

test('qualification: Windows kernel version and Linux session hints are not OS acceptance', () => {
  for (const input of [facts(), facts({ sessionHint: 'x11' }), facts({ platform: 'win32', osRelease: '10.0.26100' })]) {
    const report = createPreflightReport(input);
    assert.equal(report.platformAcceptance, false);
    assert.equal(report.targetIdentity, 'not-verified');
    assert.equal(report.targetCandidate, input.platform === 'win32' ? 'windows-family-x64' : 'linux-family-x64');
    assert.equal(report.runtime.sessionHint, input.platform === 'win32' ? 'unknown' : input.sessionHint);
  }
  for (const input of [facts({ platform: 'darwin' }), facts({ architecture: 'arm64' })]) {
    assert.equal(createPreflightReport(input).targetCandidate, 'outside-initial-matrix');
  }
});

test('qualification: baseline comparison is numeric and separate from exact proposal', () => {
  for (const [node, expected] of [
    ['22.22.9', false], ['22.23.0', true], ['22.23.3', true],
    ['22.100.0', true], ['24.0.0', true], ['20.99.0', false],
  ]) {
    const report = createPreflightReport(facts({ node }));
    assert.equal(report.localPreflight.meetsBaseline, expected, node);
    assert.equal(report.localPreflight.status, expected ? 'ready' : 'blocked');
    assert.equal(report.proposedToolchain.matches, false);
  }
  const embedded = createPreflightReport(facts({ electron: '44.7.2', chromium: '152.0.7977.149' }));
  assert.equal(embedded.proposedToolchain.matches, false, 'embedded Node is not the build toolchain');
});

test('qualification: missing required primitives block, socket presence cannot qualify transport', () => {
  for (const feature of ['abortController', 'textDecoder']) {
    const input = facts();
    input.features[feature] = false;
    assert.equal(createPreflightReport(input).localPreflight.status, 'blocked');
  }
  const input = facts();
  input.features.fetch = false;
  input.features.webSocket = false;
  const report = createPreflightReport(input);
  assert.equal(report.localPreflight.status, 'ready');
  assert.ok(report.unverified.includes('transport-and-real-host-contracts'));
});

test('qualification: malformed unknown boundaries fail without echoing values', () => {
  const invalid = [
    null, [], 7, 'private', {}, facts({ node: '24.22.0-secret' }),
    facts({ node: 'v24.22.0' }), facts({ node: '024.22.0' }), facts({ node: '24.22' }),
    facts({ node: '9999999.0.0' }), facts({ node: 24 }), facts({ platform: 'SECRET' }),
    facts({ architecture: null }), facts({ sessionHint: 'WAYLAND' }),
    facts({ features: null }), facts({ features: { ...facts().features, fetch: 'true' } }),
    facts({ electron: undefined }), facts({ chromium: '152.0-secret' }),
    facts({ osRelease: '6.8.0-private-host' }),
  ];
  for (const input of invalid) {
    assert.throws(() => createPreflightReport(input), (error) => {
      assert.ok(error instanceof TypeError);
      assert.match(error.message, /^Invalid /);
      assert.doesNotMatch(error.message, /SECRET|secret|private/);
      return true;
    });
  }
});

test('qualification: CLI emits bounded JSON without environment or argument secrets', () => {
  const result = cli([], { XDG_SESSION_TYPE: 'synthetic-private-token', QUALIFICATION_TEST_SECRET: 'synthetic-private-token' });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.ok(result.stdout.length < 6000);
  assert.doesNotMatch(result.stdout, /synthetic-private-token|QUALIFICATION_TEST_SECRET/);
  const report = JSON.parse(result.stdout);
  assert.equal(report.runtime.node, process.versions.node);
  assert.equal(report.runtime.sessionHint, 'unknown');
  assert.equal(report.platformAcceptance, false);
  const bad = cli(['--synthetic-private-token']);
  assert.equal(bad.status, 2);
  assert.equal(bad.stdout, '');
  assert.equal(bad.stderr, 'Invalid arguments. Use --help.\n');
});

test('qualification: CLI help and exact-toolchain gate have distinct exit contracts', () => {
  const help = cli(['--help']);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Never certifies platform acceptance/);
  assert.equal(cli(['--help', '--require-proposed-toolchain']).status, 2);
  const pinned = cli(['--require-proposed-toolchain']);
  const report = JSON.parse(pinned.stdout);
  assert.equal(pinned.status, report.localPreflight.status === 'ready' && report.proposedToolchain.matches ? 0 : 1);
});
