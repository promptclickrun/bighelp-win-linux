// The preload's frozen description of the shell: the platform, whether this is
// the sample preview, and version facts for Help & feedback. No functions, no
// IPC, no host access, no paths or user names.

export const FIXTURE_PREVIEW_ARG = '--bighelp-fixture-preview';

export type ShellPlatform = 'windows' | 'linux' | 'other';
export type ShellInfo = Readonly<{
  platform: ShellPlatform; fixturePreview: boolean;
  // Build-time app version, for example "0.1.0" or "0.1.0 (development build)".
  appVersion: string;
  // Operating system name, version and CPU type, for example "Windows 10.0.26100 x64".
  system: string;
}>;
export type ShellDetails = Readonly<{ appVersion: string; systemVersion: string; arch: string }>;

const FALLBACK: ShellInfo = Object.freeze({ platform: 'other', fixturePreview: false, appVersion: '', system: '' });
const KEYS = ['appVersion', 'fixturePreview', 'platform', 'system'];

// Short printable facts only.
function fact(value: unknown, max = 80): string {
  if (typeof value !== 'string') return '';
  const clean = value.replace(/[^\x20-\x7e]+/gu, ' ').replace(/\s+/gu, ' ').trim();
  return clean.length > max ? '' : clean;
}

export function createShellInfo(argv: readonly string[], platform: string, details?: ShellDetails): ShellInfo {
  const kind: ShellPlatform = platform === 'win32' ? 'windows' : platform === 'linux' ? 'linux' : 'other';
  const name = kind === 'windows' ? 'Windows' : kind === 'linux' ? 'Linux' : 'Other';
  const system = details ? fact([name, fact(details.systemVersion, 40), fact(details.arch, 16)].filter(Boolean).join(' ')) : '';
  return Object.freeze({
    platform: kind, fixturePreview: argv.includes(FIXTURE_PREVIEW_ARG),
    appVersion: details ? fact(details.appVersion, 64) : '', system,
  });
}

// The renderer validates what it receives instead of trusting a global.
export function parseShellInfo(value: unknown): ShellInfo {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return FALLBACK;
  const keys = Object.keys(value).sort();
  if (keys.length !== KEYS.length || keys.some((key, index) => key !== KEYS[index])) return FALLBACK;
  const { platform, fixturePreview, appVersion, system } = value as Record<string, unknown>;
  if ((platform !== 'windows' && platform !== 'linux' && platform !== 'other') || typeof fixturePreview !== 'boolean'
    || typeof appVersion !== 'string' || fact(appVersion, 64) !== appVersion || typeof system !== 'string' || fact(system) !== system) {
    return FALLBACK;
  }
  return Object.freeze({ platform, fixturePreview, appVersion, system });
}
