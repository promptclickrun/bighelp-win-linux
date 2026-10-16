import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  LINUX_DESKTOP_ENTRY, appPackageJson, archiveName, assemblePackage, packageName, readmeText, validatePackage, validateVersion,
} from '../scripts/desktop/package-layout.mjs';
import { APP_ICON_FILES, validateAppSource } from '../scripts/desktop/package-policy.mjs';
import { writeBundledLicenses } from '../scripts/desktop/package-licenses.mjs';
import { desktopExec } from '../apps/desktop/src/main/autostart.ts';

const posix = process.platform !== 'win32';
async function temporary(body) {
  // Real path: the script resolves its own folder with pwd -P.
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'bighelp-layout-test-')));
  try { await body(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}
// A synthetic runtime and app bundle shaped like the real ones.
async function fixture(directory, platform) {
  const runtime = join(directory, 'runtime'), app = join(directory, 'app'), project = join(directory, 'project');
  await mkdir(join(runtime, 'resources'), { recursive: true });
  const executables = platform === 'linux' ? ['electron', 'chrome-sandbox', 'chrome_crashpad_handler'] : ['electron.exe'];
  for (const name of [...executables, 'LICENSE', 'LICENSES.chromium.html', 'resources/default_app.asar']) await writeFile(join(runtime, name), name);
  for (const name of executables) await chmod(join(runtime, name), 0o755);
  await mkdir(join(app, 'renderer'), { recursive: true }); await mkdir(join(app, 'icons'));
  for (const name of ['main.cjs', 'preload.cjs', 'renderer/index.html', 'renderer/renderer.js', ...APP_ICON_FILES]) await writeFile(join(app, name), 'bundle');
  await writeBundledLicenses(app, app, { main: { inputs: {} }, preload: { inputs: {} }, renderer: { inputs: {} } });
  await mkdir(project);
  await writeFile(join(project, 'LICENSE'), 'Apache'); await writeFile(join(project, 'NOTICE'), 'Notice');
  return { runtime, appSource: app, appFiles: await validateAppSource(app), projectRoot: project };
}

test('beta packages are named after the project version', () => {
  assert.equal(validateVersion('0.9.0-beta.1'), '0.9.0-beta.1');
  assert.equal(packageName('0.9.0-beta.1', 'linux', 'x64'), 'bighelp-beta-0.9.0-beta.1-linux-x64');
  assert.equal(archiveName('0.9.0-beta.1', 'linux', 'x64'), 'bighelp-beta-0.9.0-beta.1-linux-x64.tar.gz');
  assert.equal(archiveName('0.9.0-beta.1', 'win32', 'x64'), 'bighelp-beta-0.9.0-beta.1-win32-x64.zip');
  for (const version of ['', '0.9', '0.9.0-beta/../x', '0.9.0 beta', '1.0.0+build', 'v1.0.0', '0.9.0-']) assert.throws(() => validateVersion(version), version);
  assert.deepEqual(JSON.parse(appPackageJson('0.9.0-beta.1')),
    { name: 'bighelp', productName: 'bighelp', version: '0.9.0-beta.1', private: true, main: 'main.cjs', desktopName: 'bighelp.desktop' });
});

test('the project version is a valid package version', async () => {
  const project = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const lock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'));
  assert.equal(validateVersion(project.version), project.version);
  assert.equal(lock.version, project.version);
  assert.equal(lock.packages[''].version, project.version);
});

test('README explains the unsigned beta, sign-in storage, the tray, data and uninstall in plain words', () => {
  const linux = readmeText({ platform: 'linux', version: '0.9.0-beta.1', electronVersion: '44.7.2' });
  for (const text of ['bighelp 0.9.0-beta.1 for Linux (x64) - beta', 'not signed', './bighelp', './install-desktop-entry.sh',
    'GNOME Keyring', 'KWallet', 'sudo chmod 4755 chrome-sandbox', 'Never start bighelp with --no-sandbox', '~/.config/bighelp',
    'Quitting bighelp', 'Quit bighelp', '--remove', 'SHA256SUMS', 'THIRD_PARTY_NOTICES.txt', 'Electron 44.7.2']) {
    assert.ok(linux.includes(text), text);
  }
  assert.equal(linux.includes('\r'), false);
  const windows = readmeText({ platform: 'win32', version: '0.9.0-beta.1', electronVersion: '44.7.2' });
  for (const text of ['for Windows (x64)', 'bighelp.exe', 'Windows protected your PC', '"More info"', '"Run anyway"',
    '%APPDATA%\\bighelp', 'Startup', 'SHA256SUMS']) assert.ok(windows.includes(text), text);
  assert.ok(windows.split('\n').slice(0, -1).every(line => line.endsWith('\r')), 'Windows README uses CRLF');
  assert.equal(windows.includes('chrome-sandbox'), false);
  for (const readme of [linux, windows]) assert.ok(readme.split(/\r?\n/u).every(line => line.length <= 80), 'short lines');
});

test('Linux package: bighelp executable, menu entry, README and complete checksums', async () => temporary(async directory => {
  const parts = await fixture(directory, 'linux');
  const output = join(directory, 'artifacts', packageName('0.9.0-beta.1', 'linux', 'x64'));
  await assemblePackage({ ...parts, output, platform: 'linux', version: '0.9.0-beta.1', electronVersion: '44.7.2' });
  await assert.rejects(lstat(join(output, 'electron')), { code: 'ENOENT' });
  await assert.rejects(lstat(join(output, 'resources/default_app.asar')), { code: 'ENOENT' });
  if (posix) {
    assert.equal((await lstat(join(output, 'bighelp'))).mode & 0o777, 0o755);
    assert.equal((await lstat(join(output, 'install-desktop-entry.sh'))).mode & 0o777, 0o755);
    assert.equal((await lstat(join(output, 'bighelp.desktop'))).mode & 0o777, 0o644);
  }
  assert.equal(await readFile(join(output, 'bighelp.desktop'), 'utf8'), LINUX_DESKTOP_ENTRY);
  assert.equal(JSON.parse(await readFile(join(output, 'resources/app/package.json'), 'utf8')).version, '0.9.0-beta.1');
  assert.equal(await readFile(join(output, 'resources/app/icons/bighelp.ico'), 'utf8'), 'bundle');
  const sums = await readFile(join(output, 'SHA256SUMS'), 'utf8');
  for (const name of ['bighelp', 'README.txt', 'bighelp.desktop', 'install-desktop-entry.sh', 'BIGHELP-LICENSE',
    'resources/app/THIRD_PARTY_NOTICES.txt', 'resources/app/icons/bighelp-256.png']) assert.match(sums, new RegExp(`  ${name}\n`, 'u'));
  const check = { platform: 'linux', version: '0.9.0-beta.1', appFiles: parts.appFiles };
  await validatePackage(output, check);
  await writeFile(join(output, 'README.txt'), 'changed');
  await assert.rejects(validatePackage(output, check), /Checksum mismatch: README.txt/u);
  await writeFile(join(output, 'extra.txt'), 'unlisted');
  await assert.rejects(validatePackage(output, check), /does not cover/u);
  await writeFile(join(output, 'electron'), 'old name');
  await assert.rejects(validatePackage(output, check), /Unexpected package file: electron/u);
}));

test('Windows package: bighelp.exe with the same app, README and checksums', async () => temporary(async directory => {
  const parts = await fixture(directory, 'win32');
  const output = join(directory, 'artifacts', packageName('0.9.0-beta.1', 'win32', 'x64'));
  await assemblePackage({ ...parts, output, platform: 'win32', version: '0.9.0-beta.1', electronVersion: '44.7.2' });
  assert.equal(await readFile(join(output, 'bighelp.exe'), 'utf8'), 'electron.exe');
  await assert.rejects(lstat(join(output, 'electron.exe')), { code: 'ENOENT' });
  await assert.rejects(lstat(join(output, 'bighelp.desktop')), { code: 'ENOENT' });
  await assert.rejects(lstat(join(output, 'install-desktop-entry.sh')), { code: 'ENOENT' });
  assert.match(await readFile(join(output, 'README.txt'), 'utf8'), /Run anyway/u);
  await assert.rejects(assemblePackage({ ...parts, output, platform: 'win32', version: '../x', electronVersion: '44.7.2' }), /version/u);
}));

test('menu entry script installs an escaped entry for this folder and removes it', { skip: posix ? false : 'POSIX shell script' }, async () => temporary(async directory => {
  const parts = await fixture(directory, 'linux');
  const folder = join(directory, 'My "Apps" $HOME 100% `x`', 'bighelp-beta');
  await assemblePackage({ ...parts, output: folder, platform: 'linux', version: '0.9.0-beta.1', electronVersion: '44.7.2' });
  const data = join(directory, 'data');
  const run = (...args) => spawnSync('sh', [join(folder, 'install-desktop-entry.sh'), ...args],
    { env: { PATH: process.env.PATH, HOME: directory, XDG_DATA_HOME: data }, encoding: 'utf8' });
  assert.equal(spawnSync('sh', ['-n', join(folder, 'install-desktop-entry.sh')]).status, 0, 'valid sh syntax');
  const added = run();
  assert.equal(added.status, 0, added.stderr);
  const entry = await readFile(join(data, 'applications', 'bighelp.desktop'), 'utf8');
  const lines = entry.trimEnd().split('\n');
  assert.equal(lines[0], '[Desktop Entry]');
  assert.equal(lines.filter(line => line.startsWith('#')).length, 0);
  assert.equal(lines.find(line => line.startsWith('Exec=')), `Exec=${desktopExec(join(folder, 'bighelp'), [])}`);
  assert.equal(lines.find(line => line.startsWith('Icon=')), `Icon=${join(folder, 'resources/app/icons/bighelp-256.png')}`);
  assert.ok(lines.includes('StartupWMClass=bighelp'));
  assert.equal((await lstat(join(data, 'applications', 'bighelp.desktop'))).mode & 0o777, 0o644);
  assert.equal(run('--bogus').status, 2);
  const removed = run('--remove');
  assert.equal(removed.status, 0, removed.stderr);
  await assert.rejects(lstat(join(data, 'applications', 'bighelp.desktop')), { code: 'ENOENT' });
}));
