// The beta package layout: names, the renamed executable, the README, the Linux
// menu entry, and a final check of the assembled folder. No signing, installer or
// publishing. package.mjs downloads and verifies the runtime, then calls this.
import { chmod, copyFile, cp, lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { checksumManifest, regularFiles } from './package-policy.mjs';

const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:-[0-9A-Za-z]{1,16}(?:\.[0-9A-Za-z]{1,16}){0,3})?$/u;
export function validateVersion(version) {
  if (typeof version !== 'string' || !VERSION.test(version)) throw new Error('Package version must look like 0.9.0-beta.1');
  return version;
}
export function packageName(version, platform, arch) {
  return `bighelp-beta-${validateVersion(version)}-${platform}-${arch}`;
}
export function archiveName(version, platform, arch) {
  return `${packageName(version, platform, arch)}.${platform === 'linux' ? 'tar.gz' : 'zip'}`;
}
export const runtimeExecutable = platform => (platform === 'linux' ? 'electron' : 'electron.exe');
export const packageExecutable = platform => (platform === 'linux' ? 'bighelp' : 'bighelp.exe');

export function appPackageJson(version) {
  return `${JSON.stringify({ name: 'bighelp', productName: 'bighelp', version: validateVersion(version), private: true,
    main: 'main.cjs', desktopName: 'bighelp.desktop' }, null, 2)}\n`;
}

// Archive copy of the menu entry. install-desktop-entry.sh fills in Exec and Icon.
export const LINUX_DESKTOP_ENTRY = `# bighelp app menu entry. Run ./install-desktop-entry.sh to install it for your
# user with the full path to this folder filled in.
[Desktop Entry]
Type=Application
Name=bighelp
Comment=Chat with your Hermes agents
Exec=bighelp
Icon=bighelp
Terminal=false
Categories=Network;Chat;
StartupWMClass=bighelp
`;

// POSIX sh. Quotes and escapes the path per the Desktop Entry Specification:
// " \` $ \\ get a backslash inside the quotes, % becomes %%, then every \\ doubles.
export const LINUX_INSTALL_SCRIPT = `#!/bin/sh
# Adds bighelp to your app menu, for your user only. Nothing else changes.
#   ./install-desktop-entry.sh           add or update the menu entry
#   ./install-desktop-entry.sh --remove  remove it
# Run it again if you move this folder.
set -eu
umask 022
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
data=\${XDG_DATA_HOME:-$HOME/.local/share}
case $data in /*) ;; *) data=$HOME/.local/share ;; esac
entry=$data/applications/bighelp.desktop
if [ "$#" -eq 1 ] && [ "$1" = "--remove" ]; then
  rm -f -- "$entry"
  echo "Removed bighelp from your app menu."
  exit 0
fi
if [ "$#" -ne 0 ]; then echo "Usage: $0 [--remove]" >&2; exit 2; fi
if [ ! -x "$here/bighelp" ] || [ ! -f "$here/bighelp.desktop" ]; then
  echo "Run this script from inside the bighelp folder." >&2; exit 1
fi
newline='
'
case $here in *"$newline"*) echo "Move the bighelp folder to a path without line breaks first." >&2; exit 1 ;; esac
exec_path=$(printf '%s' "$here/bighelp" | sed -e 's/[\\\\"\`$]/\\\\&/g' -e 's/%/%%/g' -e 's/\\\\/\\\\\\\\/g')
icon_path=$(printf '%s' "$here/resources/app/icons/bighelp-256.png" | sed -e 's/\\\\/\\\\\\\\/g')
mkdir -p -- "$data/applications"
temporary=$entry.$$.tmp
while IFS= read -r line || [ -n "$line" ]; do
  case $line in
    '#'*) ;;
    Exec=*) printf 'Exec="%s"\\n' "$exec_path" ;;
    Icon=*) printf 'Icon=%s\\n' "$icon_path" ;;
    *) printf '%s\\n' "$line" ;;
  esac
done < "$here/bighelp.desktop" > "$temporary"
mv -f -- "$temporary" "$entry"
echo "Added bighelp to your app menu."
`;

export function readmeText({ platform, version, electronVersion }) {
  validateVersion(version);
  const linux = platform === 'linux';
  const lines = [
    `bighelp ${version} for ${linux ? 'Linux' : 'Windows'} (x64) - beta`,
    '',
    'bighelp lets you chat with your own Hermes agent. It connects to a Hermes',
    "computer you already run. Your agent's work happens on that computer.",
    '',
    'This is an early beta. It is not signed, has no installer, and does not',
    'update itself. Download new versions yourself.',
    '',
    'START BIGHELP',
    ...(linux ? [
      '  Extract this folder anywhere you like, then run ./bighelp from it.',
      '  To add bighelp to your app menu, run ./install-desktop-entry.sh once.',
      '  Run it again if you move the folder.',
      '',
      '  If bighelp does not open and the terminal mentions the sandbox, your',
      '  system blocks the security sandbox bighelp uses. Ubuntu 24.04 does this',
      '  by default. Fix it once by running these two commands in this folder:',
      '    sudo chown root:root chrome-sandbox',
      '    sudo chmod 4755 chrome-sandbox',
      '  Never start bighelp with --no-sandbox.',
    ] : [
      '  Extract the whole zip first (right-click, Extract All). Then open',
      '  bighelp.exe in the extracted folder.',
      '',
      '  Windows may say "Windows protected your PC" because this beta is not',
      '  signed. Choose "More info", then "Run anyway".',
    ]),
    '',
    'SAVING YOUR SIGN-IN',
    ...(linux ? [
      '  bighelp keeps your sign-in encrypted with your system keyring. You need a',
      '  working keyring, such as GNOME Keyring or KWallet, unlocked when you sign',
      "  in to your computer. Without one, bighelp can't connect.",
    ] : [
      '  bighelp keeps your sign-in encrypted with your Windows account.',
    ]),
    '',
    'NOTIFICATIONS AND THE TRAY',
    '  bighelp shows notifications only while it is running. Quitting bighelp',
    '  stops them. Your agent keeps working on your Hermes computer either way.',
    '  If you turn on keep running in the tray in Settings, closing the window',
    '  leaves bighelp running with a tray icon. Choose "Quit bighelp" from that',
    "  icon to quit. If you can't see the icon, open bighelp again to bring the",
    '  window back.',
    '',
    'WHERE YOUR DATA LIVES',
    `  Settings, your encrypted sign-in and saved chat copies: ${linux ? '~/.config/bighelp' : '%APPDATA%\\bighelp'}`,
    '  Your chats themselves live on your Hermes computer.',
    '',
    'UNINSTALL',
    '  1. If you turned on opening bighelp when you sign in, turn it off in Settings.',
    '  2. Quit bighelp.',
    ...(linux ? [
      '  3. If you added the menu entry, run ./install-desktop-entry.sh --remove',
      '  4. Delete this folder.',
      '  5. To remove your settings and saved sign-in too, delete ~/.config/bighelp.',
      '     Your keyring may also keep a bighelp key; you can delete it in your',
      '     keyring app.',
    ] : [
      '  3. Delete this folder.',
      '  4. To remove your settings and saved sign-in too, delete %APPDATA%\\bighelp.',
      '  If you deleted bighelp before turning off opening at sign-in, remove it in',
      '  Windows Settings, Apps, Startup.',
    ]),
    '',
    'CHECKING THE FILES',
    '  SHA256SUMS lists a checksum for every file in this folder. It shows whether',
    '  a file was damaged. It does not prove who made the files.',
    '',
    'LICENSES',
    '  BIGHELP-LICENSE and BIGHELP-NOTICE cover bighelp. LICENSE and',
    `  LICENSES.chromium.html cover Electron ${electronVersion} and Chromium.`,
    '  resources/app/THIRD_PARTY_NOTICES.txt covers the bundled libraries.',
    '',
  ];
  return lines.join(linux ? '\n' : '\r\n');
}

async function file(path) {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Missing package file: ${path}`);
  return stat;
}

// Copy the verified runtime, rename its executable, add the app and its notices.
export async function assemblePackage({ runtime, appSource, appFiles, projectRoot, output, platform, version, electronVersion }) {
  validateVersion(version);
  await rm(output, { recursive: true, force: true });
  await mkdir(dirname(output), { recursive: true });
  await cp(runtime, output, { recursive: true });
  await rm(join(output, 'resources/default_app.asar'), { force: true });
  await rename(join(output, runtimeExecutable(platform)), join(output, packageExecutable(platform)));
  const app = join(output, 'resources/app');
  await mkdir(app, { recursive: true });
  // appFiles includes the required graph-derived full npm notices and provenance.
  for (const name of appFiles) {
    await mkdir(dirname(join(app, name)), { recursive: true });
    await copyFile(join(appSource, name), join(app, name));
  }
  await writeFile(join(app, 'package.json'), appPackageJson(version));
  for (const name of ['LICENSE', 'NOTICE']) await copyFile(join(projectRoot, name), join(output, `BIGHELP-${name}`));
  await writeFile(join(output, 'README.txt'), readmeText({ platform, version, electronVersion }));
  if (platform === 'linux') {
    await writeFile(join(output, 'bighelp.desktop'), LINUX_DESKTOP_ENTRY, { mode: 0o644 });
    await writeFile(join(output, 'install-desktop-entry.sh'), LINUX_INSTALL_SCRIPT, { mode: 0o755 });
    await chmod(join(output, 'install-desktop-entry.sh'), 0o755);
  }
  await checksumManifest(output);
  await validatePackage(output, { platform, version, appFiles });
}

// The assembled folder, exactly as a beta user receives it.
export async function validatePackage(output, { platform, version, appFiles }) {
  const executable = await file(join(output, packageExecutable(platform)));
  if (platform === 'linux' && (executable.mode & 0o111) === 0) throw new Error('Package executable permission missing');
  for (const name of [runtimeExecutable(platform), 'resources/default_app.asar', 'DEVELOPMENT.txt']) {
    try { await lstat(join(output, name)); throw new Error(`Unexpected package file: ${name}`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const required = ['README.txt', 'SHA256SUMS', 'BIGHELP-LICENSE', 'BIGHELP-NOTICE', 'LICENSE', 'LICENSES.chromium.html',
    'resources/app/package.json', ...appFiles.map(name => `resources/app/${name}`)];
  if (platform === 'linux') required.push('chrome-sandbox', 'chrome_crashpad_handler', 'bighelp.desktop', 'install-desktop-entry.sh');
  for (const name of required) await file(join(output, name));
  if (platform === 'linux' && ((await file(join(output, 'install-desktop-entry.sh'))).mode & 0o111) === 0) {
    throw new Error('Menu entry script permission missing');
  }
  const manifest = JSON.parse(await readFile(join(output, 'resources/app/package.json'), 'utf8'));
  if (manifest.name !== 'bighelp' || manifest.version !== version || manifest.main !== 'main.cjs') throw new Error('Unexpected app identity');
  // Every file except the manifest itself is listed with its current hash.
  const listed = new Map((await readFile(join(output, 'SHA256SUMS'), 'utf8')).trim().split('\n').map(line => {
    const match = /^([a-f0-9]{64}) {2}(.+)$/u.exec(line);
    if (!match) throw new Error('Malformed SHA256SUMS');
    return [match[2], match[1]];
  }));
  const files = (await regularFiles(output)).filter(name => name !== 'SHA256SUMS');
  if (files.length !== listed.size || files.some(name => !listed.has(name))) throw new Error('SHA256SUMS does not cover the package');
  for (const name of files) {
    if (createHash('sha256').update(await readFile(join(output, name))).digest('hex') !== listed.get(name)) throw new Error(`Checksum mismatch: ${name}`);
  }
}
