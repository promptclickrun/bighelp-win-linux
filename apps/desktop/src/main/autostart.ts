// "Open bighelp when I sign in" (opt-in, docs/DECISIONS.md D3). Windows uses the
// login item API; Linux uses an XDG autostart entry in ~/.config/autostart.
// Only packaged builds register themselves. No Electron import.
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, posix } from 'node:path';

// Passed by the login item so the app can tell a sign-in launch from a click.
export const LOGIN_LAUNCH_ARG = '--bighelp-login';
export const AUTOSTART_FILE = 'bighelp.desktop';
const GENERATED_MARKER = 'X-Bighelp-Generated=true';

export function launchedAtLogin(argv: readonly string[], packaged: boolean): boolean {
  return packaged && argv.includes(LOGIN_LAUNCH_ARG);
}
// Start hidden only for a sign-in launch with tray mode on and a working tray.
export function startHidden(loginLaunch: boolean, keepRunningInTray: boolean, trayReady: boolean): boolean {
  return loginLaunch && keepRunningInTray && trayReady;
}

export function windowsLoginItem(enabled: boolean, executable: string) {
  return Object.freeze({ openAtLogin: enabled, path: executable, args: [LOGIN_LAUNCH_ARG], name: 'bighelp' });
}

// $XDG_CONFIG_HOME/autostart when it is an absolute path, else ~/.config/autostart.
export function autostartPath(env: Readonly<Record<string, string | undefined>>, home: string): string {
  const configured = env.XDG_CONFIG_HOME;
  const base = configured && configured.startsWith('/') ? configured : posix.join(home, '.config');
  if (!base.startsWith('/')) throw new TypeError('Home directory must be absolute');
  return posix.join(base, 'autostart', AUTOSTART_FILE);
}

function safePath(value: string): string {
  if (typeof value !== 'string' || !value.startsWith('/') || /[\u0000-\u001F\u007F]/u.test(value)) {
    throw new TypeError('Unsafe desktop entry path');
  }
  return value;
}
// Desktop Entry Specification: quote each argument, escape " ` $ \ inside quotes,
// write % as %%, then apply the string-value escape for backslashes.
export function desktopExec(executable: string, args: readonly string[]): string {
  const quoted = [safePath(executable), ...args].map(arg => {
    if (/[\u0000-\u001F\u007F]/u.test(arg)) throw new TypeError('Unsafe desktop entry argument');
    return `"${arg.replace(/(["`$\\])/gu, '\\$1')}"`;
  }).join(' ');
  return quoted.replace(/%/gu, '%%').replace(/\\/gu, '\\\\');
}

export function autostartEntry(executable: string, icon: string | null): string {
  const lines = [
    '[Desktop Entry]', 'Type=Application', 'Name=bighelp', 'Comment=Chat with your Hermes agents',
    `Exec=${desktopExec(executable, [LOGIN_LAUNCH_ARG])}`,
    ...(icon ? [`Icon=${safePath(icon).replace(/\\/gu, '\\\\')}`] : []),
    'Terminal=false', 'X-GNOME-Autostart-enabled=true', GENERATED_MARKER,
  ];
  return `${lines.join('\n')}\n`;
}

export type AutostartResult = 'written' | 'removed' | 'unchanged' | 'notOurs';

// Write or remove the entry. A file at that path that bighelp did not write is
// never replaced or deleted.
export async function syncLinuxAutostart(options: Readonly<{ enabled: boolean; path: string; content: string }>): Promise<AutostartResult> {
  let existing: string | null = null;
  try {
    const stat = await lstat(options.path);
    if (!stat.isFile()) return 'notOurs';
    existing = await readFile(options.path, 'utf8');
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const ours = existing !== null && existing.split('\n').includes(GENERATED_MARKER);
  if (existing !== null && !ours) return 'notOurs';
  if (!options.enabled) {
    if (existing === null) return 'unchanged';
    await rm(options.path, { force: true });
    return 'removed';
  }
  if (existing === options.content) return 'unchanged';
  await mkdir(dirname(options.path), { recursive: true });
  const temporary = `${options.path}.${process.pid}.tmp`;
  await writeFile(temporary, options.content, { mode: 0o644 });
  await rename(temporary, options.path);
  return 'written';
}
