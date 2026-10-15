import { release } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const PROPOSED_NODE = '24.22.0';
const BASELINE_NODE = [22, 23, 0];
const VERSION = /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/;
const PLATFORMS = ['aix', 'android', 'darwin', 'freebsd', 'linux', 'openbsd', 'sunos', 'win32', 'netbsd'];
const ARCHITECTURES = ['arm', 'arm64', 'ia32', 'loong64', 'mips', 'mipsel', 'ppc', 'ppc64', 'riscv64', 's390', 's390x', 'x64'];

/** @param {unknown} value @returns {Record<string, unknown>} */
function record(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Invalid runtime facts');
  }
  return value;
}

/** @param {unknown} value */
function version(value) {
  if (typeof value !== 'string' || !VERSION.test(value)) {
    throw new TypeError('Invalid runtime version');
  }
  return value;
}

/** @param {unknown} value @param {readonly string[]} choices */
function choice(value, choices) {
  if (typeof value !== 'string' || !choices.includes(value)) {
    throw new TypeError('Invalid runtime category');
  }
  return value;
}

/** @param {unknown} value */
function boolean(value) {
  if (typeof value !== 'boolean') throw new TypeError('Invalid runtime feature');
  return value;
}

/**
 * Read only public runtime facts and a single categorical display hint.
 * No network, filesystem probe, shell, package loading, keyring access, or writes.
 * XDG_SESSION_TYPE is only a hint, not proof of Electron's active Ozone backend.
 */
export function collectRuntimeFacts() {
  const session = process.platform === 'linux' ? process.env.XDG_SESSION_TYPE : undefined;
  // Keep only the numeric kernel/build prefix, never a custom kernel suffix.
  const osRelease = /^\d+(?:\.\d+){0,3}/.exec(release())?.[0] ?? null;
  return {
    platform: process.platform,
    architecture: process.arch,
    osRelease,
    node: process.versions.node,
    electron: process.versions.electron ?? null,
    chromium: process.versions.chrome ?? null,
    sessionHint: session === 'wayland' || session === 'x11' ? session : 'unknown',
    features: {
      fetch: typeof globalThis.fetch === 'function',
      webSocket: typeof globalThis.WebSocket === 'function',
      abortController: typeof globalThis.AbortController === 'function',
      textDecoder: typeof globalThis.TextDecoder === 'function',
    },
  };
}

/**
 * Validate unknown facts into a redacted report. Pure and deterministic.
 * The local runtime check is not dependency, security, or OS qualification.
 * @param {unknown} input
 */
export function createPreflightReport(input) {
  const facts = record(input);
  const platform = choice(facts.platform, PLATFORMS);
  const architecture = choice(facts.architecture, ARCHITECTURES);
  const node = version(facts.node);
  const electron = facts.electron === null ? null : version(facts.electron);
  if (facts.chromium !== null && (typeof facts.chromium !== 'string'
    || !/^\d{1,6}\.\d{1,6}\.\d{1,6}\.\d{1,6}$/.test(facts.chromium))) {
    throw new TypeError('Invalid Chromium version');
  }
  if (facts.osRelease !== null && (typeof facts.osRelease !== 'string'
    || !/^\d{1,6}(?:\.\d{1,6}){0,3}$/.test(facts.osRelease))) {
    throw new TypeError('Invalid OS release');
  }
  const sessionHint = choice(facts.sessionHint, ['wayland', 'x11', 'unknown']);
  const rawFeatures = record(facts.features);
  const features = {
    fetch: boolean(rawFeatures.fetch),
    webSocket: boolean(rawFeatures.webSocket),
    abortController: boolean(rawFeatures.abortController),
    textDecoder: boolean(rawFeatures.textDecoder),
  };
  const parts = node.split('.').map(Number);
  const firstDifference = parts.findIndex((part, index) => part !== BASELINE_NODE[index]);
  const meetsBaseline = firstDifference === -1 || parts[firstDifference] > BASELINE_NODE[firstDifference];
  const localReady = meetsBaseline && features.abortController && features.textDecoder;
  const candidate = architecture !== 'x64' ? 'outside-initial-matrix'
    : platform === 'win32' ? 'windows-family-x64'
      : platform === 'linux' ? 'linux-family-x64' : 'outside-initial-matrix';

  return {
    schemaVersion: 1,
    evidence: 'local-runtime-observation-only',
    runtime: {
      platform, architecture, osRelease: facts.osRelease, node, electron,
      chromium: facts.chromium,
      sessionHint: platform === 'linux' ? sessionHint : 'unknown',
      features,
    },
    localPreflight: {
      status: localReady ? 'ready' : 'blocked',
      baselineNode: '22.23.0',
      meetsBaseline,
      // fetch/WebSocket presence does not prove custom headers or frame policy.
      checks: { abortController: features.abortController, textDecoder: features.textDecoder },
    },
    proposedToolchain: {
      node: PROPOSED_NODE,
      matches: electron === null && node === PROPOSED_NODE,
      status: 'approval-pending',
    },
    targetCandidate: candidate,
    targetIdentity: 'not-verified',
    platformAcceptance: false,
    qualification: [
      { target: 'windows-11-x64', status: 'not-exercised' },
      { target: 'ubuntu-24.04-x64-wayland', status: 'not-exercised' },
      { target: 'ubuntu-24.04-x64-x11', status: 'not-exercised' },
    ],
    unverified: [
      'dependency-install-and-peer-resolution', 'strict-typecheck-and-build',
      'security-advisories-and-transitive-licenses', 'packaged-electron-boundary',
      'os-secret-store-and-durable-storage', 'transport-and-real-host-contracts',
      'input-accessibility-media-and-lifecycle',
    ],
  };
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    process.stdout.write('Usage: node scripts/qualification/preflight.mjs [--require-proposed-toolchain]\n'
      + 'Offline JSON runtime report. Never certifies platform acceptance.\n'
      + 'Exit 0: local preflight ready; 1: local check or requested pin fails; 2: invalid input.\n');
    return;
  }
  if (args.length > 1 || (args.length === 1 && args[0] !== '--require-proposed-toolchain')) {
    process.stderr.write('Invalid arguments. Use --help.\n');
    process.exitCode = 2;
    return;
  }
  try {
    const report = createPreflightReport(collectRuntimeFacts());
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = report.localPreflight.status === 'blocked'
      || (args[0] === '--require-proposed-toolchain' && !report.proposedToolchain.matches) ? 1 : 0;
  } catch {
    // Do not print raw unexpected values, environment, or error messages.
    process.stderr.write('Runtime facts could not be validated. No qualification claimed.\n');
    process.exitCode = 2;
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main();
