// The only thing the preload exposes to the renderer in this slice: a finite,
// frozen description of the shell. No functions, no IPC, no host access.

export const FIXTURE_PREVIEW_ARG = '--bighelp-fixture-preview';

export type ShellPlatform = 'windows' | 'linux' | 'other';
export type ShellInfo = Readonly<{ platform: ShellPlatform; fixturePreview: boolean }>;

const FALLBACK: ShellInfo = Object.freeze({ platform: 'other', fixturePreview: false });

export function createShellInfo(argv: readonly string[], platform: string): ShellInfo {
  return Object.freeze({
    platform: platform === 'win32' ? 'windows' : platform === 'linux' ? 'linux' : 'other',
    fixturePreview: argv.includes(FIXTURE_PREVIEW_ARG),
  });
}

// The renderer validates what it receives instead of trusting a global.
export function parseShellInfo(value: unknown): ShellInfo {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return FALLBACK;
  const keys = Object.keys(value).sort();
  if (keys.length !== 2 || keys[0] !== 'fixturePreview' || keys[1] !== 'platform') return FALLBACK;
  const { platform, fixturePreview } = value as Record<string, unknown>;
  if ((platform !== 'windows' && platform !== 'linux' && platform !== 'other') || typeof fixturePreview !== 'boolean') {
    return FALLBACK;
  }
  return Object.freeze({ platform, fixturePreview });
}
