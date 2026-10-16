import { lstat, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { licenseFiles, validateBundledLicenses } from './package-licenses.mjs';

// Icons main loads at runtime (see apps/desktop/src/main/desktop-lifecycle.ts).
export const APP_ICON_FILES = Object.freeze(['16', '32', '48', '64', '128', '256'].map(size => `icons/bighelp-${size}.png`).concat('icons/bighelp.ico'));

export function validateTarget(platform, arch) {
  if (!['linux', 'win32'].includes(platform) || arch !== 'x64') throw new Error('Supported development targets: linux/x64 and win32/x64');
}
export async function regularFiles(directory, prefix = '') {
  const directoryStat = await lstat(directory);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) throw new Error(`Unsafe source directory: ${directory}`);
  const files = [];
  for (const name of (await readdir(directory)).sort()) {
    const path = join(directory, name);
    const stat = await lstat(path);
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) throw new Error(`Unsafe source entry: ${path}`);
    const relative = prefix ? `${prefix}/${name}` : name;
    if (stat.isDirectory()) files.push(...await regularFiles(path, relative));
    else files.push(relative);
  }
  return files;
}
export async function validateAppSource(directory) {
  const files = await regularFiles(directory);
  const required = ['main.cjs', 'preload.cjs', 'renderer/index.html', 'renderer/renderer.js', ...APP_ICON_FILES, ...licenseFiles];
  const allowed = new Set([...required, 'main.cjs.LEGAL.txt', 'preload.cjs.LEGAL.txt', 'renderer/renderer.js.LEGAL.txt']);
  if (required.some(file => !files.includes(file))) throw new Error('Incomplete application bundle');
  if (files.some(file => !allowed.has(file))) throw new Error('Unexpected file in application bundle');
  await validateBundledLicenses(directory);
  return files;
}
export async function checksumManifest(directory) {
  const entries = [];
  for (const file of await regularFiles(directory)) {
    if (file === 'SHA256SUMS') continue;
    entries.push(`${createHash('sha256').update(await readFile(join(directory, file))).digest('hex')}  ${file}`);
  }
  await writeFile(join(directory, 'SHA256SUMS'), `${entries.join('\n')}\n`);
  return entries;
}

export async function validateRuntime(directory, platform) {
  const executable = platform === 'linux' ? 'electron' : 'electron.exe';
  const required = [executable, 'LICENSE', 'LICENSES.chromium.html'];
  if (platform === 'linux') required.push('chrome-sandbox', 'chrome_crashpad_handler');
  for (const file of required) {
    const stat = await lstat(join(directory, file));
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Invalid runtime file: ${file}`);
    if (platform === 'linux' && !file.startsWith('LICENSE') && (stat.mode & 0o111) === 0) {
      throw new Error(`Runtime executable permission missing: ${file}`);
    }
  }
}
