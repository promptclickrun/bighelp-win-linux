import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  LOGIN_LAUNCH_ARG, autostartEntry, autostartPath, desktopExec, launchedAtLogin, startHidden, syncLinuxAutostart, windowsLoginItem,
} from '../apps/desktop/src/main/autostart.ts';
import { TRAY_LABELS, appIdentity, closeAction, iconFile, zoomFactor } from '../apps/desktop/src/main/desktop-lifecycle.ts';
import {
  DEFAULT_WINDOW_SIZE, loadWindowState, parseWindowState, placeWindow, saveWindowState, serializeWindowState,
} from '../apps/desktop/src/main/window-state.ts';
import { TEXT_SIZES } from '../apps/desktop/src/shared/preferences.ts';

async function temporary(body) {
  const directory = await mkdtemp(join(tmpdir(), 'bighelp-lifecycle-test-'));
  try { await body(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}

test('packaged builds are "bighelp"; development keeps its separate name', () => {
  assert.deepEqual(appIdentity(true), { name: 'bighelp', appUserModelId: 'bighelp', desktopName: 'bighelp.desktop' });
  assert.deepEqual(appIdentity(false), { name: 'bighelp-desktop-dev', appUserModelId: 'bighelp-desktop-dev', desktopName: null });
});

test('text size maps to a fixed zoom factor', () => {
  assert.deepEqual(TEXT_SIZES.map(zoomFactor), [0.9, 1, 1.12, 1.25]);
  assert.equal(zoomFactor('huge'), 1);
  assert.equal(zoomFactor('__proto__'), 1);
});

test('closing hides only in tray mode with a working tray; quitting always closes', () => {
  assert.equal(closeAction({ exiting: false, keepRunningInTray: true, trayReady: true }), 'hide');
  assert.equal(closeAction({ exiting: false, keepRunningInTray: false, trayReady: true }), 'close');
  assert.equal(closeAction({ exiting: false, keepRunningInTray: true, trayReady: false }), 'close', 'never hide without a way back');
  assert.equal(closeAction({ exiting: true, keepRunningInTray: true, trayReady: true }), 'close');
  assert.deepEqual(TRAY_LABELS, { tooltip: 'bighelp', open: 'Open bighelp', quit: 'Quit bighelp' });
});

test('icons resolve to bundled files per platform', () => {
  assert.equal(iconFile('win32', 'window'), 'icons/bighelp.ico');
  assert.equal(iconFile('win32', 'tray'), 'icons/bighelp.ico');
  assert.equal(iconFile('linux', 'window'), 'icons/bighelp-256.png');
  assert.equal(iconFile('linux', 'tray'), 'icons/bighelp-32.png');
  assert.equal(iconFile('win32', 'notification'), 'icons/bighelp-64.png');
});

test('a sign-in launch is recognised only in packaged builds, and starts hidden only with tray mode', () => {
  assert.equal(launchedAtLogin(['/opt/bighelp/bighelp', LOGIN_LAUNCH_ARG], true), true);
  assert.equal(launchedAtLogin(['/opt/bighelp/bighelp'], true), false);
  assert.equal(launchedAtLogin(['electron', 'main.cjs', LOGIN_LAUNCH_ARG], false), false);
  assert.equal(startHidden(true, true, true), true);
  assert.equal(startHidden(true, false, true), false);
  assert.equal(startHidden(true, true, false), false);
  assert.equal(startHidden(false, true, true), false);
  assert.deepEqual(windowsLoginItem(true, 'C:\\Apps\\bighelp\\bighelp.exe'),
    { openAtLogin: true, path: 'C:\\Apps\\bighelp\\bighelp.exe', args: [LOGIN_LAUNCH_ARG], name: 'bighelp' });
  assert.equal(windowsLoginItem(false, 'C:\\bighelp.exe').openAtLogin, false);
});

test('autostart entry lives under XDG_CONFIG_HOME or ~/.config', () => {
  assert.equal(autostartPath({}, '/home/sam'), '/home/sam/.config/autostart/bighelp.desktop');
  assert.equal(autostartPath({ XDG_CONFIG_HOME: '/home/sam/cfg' }, '/home/sam'), '/home/sam/cfg/autostart/bighelp.desktop');
  assert.equal(autostartPath({ XDG_CONFIG_HOME: 'relative' }, '/home/sam'), '/home/sam/.config/autostart/bighelp.desktop');
  assert.throws(() => autostartPath({}, 'relative-home'));
});

test('autostart Exec quotes and escapes the executable path', () => {
  assert.equal(desktopExec('/opt/bighelp/bighelp', [LOGIN_LAUNCH_ARG]), '"/opt/bighelp/bighelp" "--bighelp-login"');
  assert.equal(desktopExec('/home/sam/My Apps/bighelp', []), '"/home/sam/My Apps/bighelp"');
  assert.equal(desktopExec('/x/$HOME`id`"q"/100%/b\\c', []), '"/x/\\\\$HOME\\\\`id\\\\`\\\\"q\\\\"/100%%/b\\\\\\\\c"');
  for (const path of ['bighelp', 'relative/bighelp', '/x/line\nExec=evil', '/x/\u0000']) assert.throws(() => desktopExec(path, []), path);
  assert.throws(() => desktopExec('/x/bighelp', ['a\nb']));
  const entry = autostartEntry('/opt/bighelp beta/bighelp', '/opt/bighelp beta/resources/app/icons/bighelp-256.png');
  assert.equal(entry, [
    '[Desktop Entry]', 'Type=Application', 'Name=bighelp', 'Comment=Chat with your Hermes agents',
    'Exec="/opt/bighelp beta/bighelp" "--bighelp-login"', 'Icon=/opt/bighelp beta/resources/app/icons/bighelp-256.png',
    'Terminal=false', 'X-GNOME-Autostart-enabled=true', 'X-Bighelp-Generated=true', '',
  ].join('\n'));
  assert.equal(entry.split('\n').filter(line => line.startsWith('Exec=')).length, 1);
});

test('autostart sync writes, updates and removes only its own entry', async () => temporary(async directory => {
  const path = join(directory, 'autostart', 'bighelp.desktop');
  const content = autostartEntry('/opt/bighelp/bighelp', null);
  assert.equal(await syncLinuxAutostart({ enabled: false, path, content }), 'unchanged');
  assert.equal(await syncLinuxAutostart({ enabled: true, path, content }), 'written');
  assert.equal(await readFile(path, 'utf8'), content);
  if (process.platform !== 'win32') assert.equal((await stat(path)).mode & 0o777, 0o644);
  assert.equal(await syncLinuxAutostart({ enabled: true, path, content }), 'unchanged');
  const moved = autostartEntry('/home/sam/bighelp/bighelp', null);
  assert.equal(await syncLinuxAutostart({ enabled: true, path, content: moved }), 'written', 'a moved app updates its entry');
  assert.equal(await syncLinuxAutostart({ enabled: false, path, content: moved }), 'removed');
  await assert.rejects(readFile(path), { code: 'ENOENT' });
  // Someone else's bighelp.desktop is left alone either way.
  await writeFile(path, '[Desktop Entry]\nExec=/usr/bin/other\n');
  assert.equal(await syncLinuxAutostart({ enabled: true, path, content }), 'notOurs');
  assert.equal(await syncLinuxAutostart({ enabled: false, path, content }), 'notOurs');
  assert.equal(await readFile(path, 'utf8'), '[Desktop Entry]\nExec=/usr/bin/other\n');
}));

test('autostart sync never follows a link at the entry path', { skip: process.platform === 'win32' ? 'Linux behaviour; symlinks need privilege on Windows runners' : false }, async () => temporary(async directory => {
  await mkdir(join(directory, 'autostart'));
  const target = join(directory, 'elsewhere');
  await writeFile(target, 'X-Bighelp-Generated=true\n');
  const path = join(directory, 'autostart', 'bighelp.desktop');
  await symlink(target, path);
  assert.equal(await syncLinuxAutostart({ enabled: true, path, content: autostartEntry('/opt/bighelp/bighelp', null) }), 'notOurs');
  assert.equal(await syncLinuxAutostart({ enabled: false, path, content: '' }), 'notOurs');
  assert.equal(await readFile(target, 'utf8'), 'X-Bighelp-Generated=true\n');
}));

test('window state accepts only its own exact, bounded shape', () => {
  const state = { version: 1, x: 10, y: -20, width: 900, height: 700, maximized: true };
  assert.deepEqual(parseWindowState(state), { x: 10, y: -20, width: 900, height: 700, maximized: true });
  assert.deepEqual(parseWindowState(JSON.parse(serializeWindowState({ x: 10.4, y: -20, width: 900, height: 700, maximized: true }))),
    { x: 10, y: -20, width: 900, height: 700, maximized: true });
  for (const value of [null, [], 'x', { ...state, version: 2 }, { ...state, extra: 1 }, { ...state, width: 100 }, { ...state, height: 1e9 },
    { ...state, x: 1.5 }, { ...state, y: Number.NaN }, { ...state, x: 1e12 }, { ...state, maximized: 'yes' }, { ...state, width: '900' }]) {
    assert.equal(parseWindowState(value), null, JSON.stringify(value));
  }
  const withoutVersion = { ...state }; delete withoutVersion.version;
  assert.equal(parseWindowState(withoutVersion), null);
});

test('a restored window is placed fully inside a visible display', () => {
  const primary = { x: 0, y: 0, width: 1920, height: 1040 };
  const second = { x: 1920, y: 0, width: 1280, height: 984 };
  // No saved state: default size, centred on the primary display.
  assert.deepEqual(placeWindow(null, [primary, second], primary), { x: 320, y: 120, ...DEFAULT_WINDOW_SIZE, maximized: false });
  // Kept as saved when it fits.
  assert.deepEqual(placeWindow({ x: 100, y: 50, width: 1000, height: 700, maximized: true }, [primary, second], primary),
    { x: 100, y: 50, width: 1000, height: 700, maximized: true });
  // Mostly on the second display and hanging off its edge: moved inside it.
  assert.deepEqual(placeWindow({ x: 2800, y: 600, width: 1000, height: 700, maximized: false }, [primary, second], primary),
    { x: 2200, y: 284, width: 1000, height: 700, maximized: false });
  // The display it was on is gone: back onto the primary display.
  assert.deepEqual(placeWindow({ x: 5000, y: 3000, width: 1000, height: 700, maximized: false }, [primary], primary),
    { x: 920, y: 340, width: 1000, height: 700, maximized: false });
  // Larger than the display: shrunk to fit.
  assert.deepEqual(placeWindow({ x: -50, y: -50, width: 4000, height: 3000, maximized: false }, [primary], primary),
    { x: 0, y: 0, width: 1920, height: 1040, maximized: false });
  // A tiny display never forces the window under its minimum size.
  const tiny = { x: 0, y: 0, width: 600, height: 400 };
  assert.deepEqual(placeWindow({ x: 0, y: 0, width: 800, height: 600, maximized: false }, [tiny], tiny),
    { x: 0, y: 0, width: 640, height: 480, maximized: false });
});

test('window state round-trips through its file and ignores damage', async () => temporary(async directory => {
  const path = join(directory, 'window-state.json');
  assert.equal(loadWindowState(path), null);
  assert.equal(saveWindowState(path, { x: 1, y: 2, width: 800, height: 600, maximized: false }), true);
  assert.deepEqual(loadWindowState(path), { x: 1, y: 2, width: 800, height: 600, maximized: false });
  await writeFile(path, '{"version":1,');
  assert.equal(loadWindowState(path), null);
  await writeFile(path, `${' '.repeat(5000)}{}`);
  assert.equal(loadWindowState(path), null);
  assert.equal(saveWindowState(join(directory, 'missing', 'window-state.json'), { x: 1, y: 2, width: 800, height: 600, maximized: false }), false);
}));
