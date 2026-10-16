#!/usr/bin/env node
// Unsigned, portable development packages only. No signing or publishing.
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, rm, readFile, writeFile, cp, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { validateTarget, validateAppSource, regularFiles, checksumManifest, validateRuntime } from './package-policy.mjs';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
if (args.length > 2) throw new Error('Usage: package.mjs [linux|win32] [x64]');
const platform = args[0] ?? process.platform;
const arch = args[1] ?? process.arch;
validateTarget(platform, arch);
if (platform !== process.platform) throw new Error('Package on the target operating system');
const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', ...options });
  if (result.error || result.status !== 0) throw new Error(`${command} failed: ${result.error ?? result.status}`);
};
run(process.execPath, [join(root, 'scripts/desktop/build.mjs'), '--production']);
const source = join(root, 'apps/desktop/dist');
const appFiles = await validateAppSource(source);
const { version } = require('electron/package.json');
const checksums = require('electron/checksums.json');
const archiveName = `electron-v${version}-${platform}-${arch}.zip`;
const expected = checksums[archiveName];
if (!/^[a-f0-9]{64}$/u.test(expected ?? '')) throw new Error('Pinned Electron archive checksum missing');
const { downloadArtifact } = require('@electron/get');
const archive = await downloadArtifact({ version, platform, arch, artifactName: 'electron', checksums });
if (createHash('sha256').update(await readFile(archive)).digest('hex') !== expected) throw new Error('Electron archive checksum mismatch');
const staging = await mkdtemp(join(tmpdir(), 'bighelp-package-'));
const name = `bighelp-development-${platform}-${arch}`;
const output = join(root, 'artifacts', name);
try {
  await require('@electron-internal/extract-zip').extract(archive, { dir: staging });
  await regularFiles(staging); // Reject links and special entries before copying.
  await validateRuntime(staging, platform);
  await rm(output, { recursive: true, force: true });
  await mkdir(dirname(output), { recursive: true });
  await cp(staging, output, { recursive: true });
  await rm(join(output, 'resources/default_app.asar'), { force: true });
  const app = join(output, 'resources/app');
  await mkdir(app, { recursive: true });
  // appFiles includes the required graph-derived full npm notices and provenance.
  for (const file of appFiles) {
    await mkdir(dirname(join(app, file)), { recursive: true });
    await copyFile(join(source, file), join(app, file));
  }
  await writeFile(join(app, 'package.json'), JSON.stringify({ name: 'bighelp-development', productName: 'Bighelp Development', version: '0.0.0', private: true, main: 'main.cjs' }, null, 2));
  for (const file of ['LICENSE', 'NOTICE']) await copyFile(join(root, file), join(output, `BIGHELP-${file}`));
  for (const file of ['LICENSE', 'LICENSES.chromium.html']) await readFile(join(output, file));
  await writeFile(join(output, 'DEVELOPMENT.txt'), `Bighelp unsigned development build. Electron ${version}.\nLaunch ${platform === 'linux' ? './electron' : 'electron.exe'}. OS sandbox must remain enabled.\nNo installer, signing, updates, or production qualification is provided.\n`);
  await checksumManifest(output);
  const extension = platform === 'linux' ? 'tar.gz' : 'zip';
  const packaged = `${output}.${extension}`;
  await rm(packaged, { force: true });
  if (platform === 'linux') run('tar', ['-czf', packaged, '-C', dirname(output), name]);
  else run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Compress-Archive -LiteralPath $env:BIGHELP_PACKAGE_SOURCE -DestinationPath $env:BIGHELP_PACKAGE_ARCHIVE'], { env: { ...process.env, BIGHELP_PACKAGE_SOURCE: output, BIGHELP_PACKAGE_ARCHIVE: packaged } });
  const hash = createHash('sha256').update(await readFile(packaged)).digest('hex');
  await writeFile(`${packaged}.sha256`, `${hash}  ${name}.${extension}\n`);
  console.log(packaged);
} finally { await rm(staging, { recursive: true, force: true }); }
