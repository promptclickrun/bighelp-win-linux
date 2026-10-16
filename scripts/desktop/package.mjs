#!/usr/bin/env node
// Unsigned, portable beta packages only. No signing, installer or publishing.
//   node scripts/desktop/package.mjs [linux|win32] [x64]   (run on the target OS)
import { createRequire } from 'node:module';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { validateTarget, validateAppSource, regularFiles, validateRuntime } from './package-policy.mjs';
import { archiveName, assemblePackage, packageName, validateVersion } from './package-layout.mjs';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
if (args.length > 2) throw new Error('Usage: package.mjs [linux|win32] [x64]');
const platform = args[0] ?? process.platform;
const arch = args[1] ?? process.arch;
validateTarget(platform, arch);
if (platform !== process.platform) throw new Error('Package on the target operating system');
const appVersion = validateVersion(JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version);
const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', ...options });
  if (result.error || result.status !== 0) throw new Error(`${command} failed: ${result.error ?? result.status}`);
};
run(process.execPath, [join(root, 'scripts/desktop/build.mjs'), '--production']);
const source = join(root, 'apps/desktop/dist');
const appFiles = await validateAppSource(source);
const { version } = require('electron/package.json');
const checksums = require('electron/checksums.json');
const runtimeArchive = `electron-v${version}-${platform}-${arch}.zip`;
const expected = checksums[runtimeArchive];
if (!/^[a-f0-9]{64}$/u.test(expected ?? '')) throw new Error('Pinned Electron archive checksum missing');
const { downloadArtifact } = require('@electron/get');
const archive = await downloadArtifact({ version, platform, arch, artifactName: 'electron', checksums });
if (createHash('sha256').update(await readFile(archive)).digest('hex') !== expected) throw new Error('Electron archive checksum mismatch');
const staging = await mkdtemp(join(tmpdir(), 'bighelp-package-'));
const name = packageName(appVersion, platform, arch);
const output = join(root, 'artifacts', name);
try {
  await require('@electron-internal/extract-zip').extract(archive, { dir: staging });
  await regularFiles(staging); // Reject links and special entries before copying.
  await validateRuntime(staging, platform);
  await assemblePackage({ runtime: staging, appSource: source, appFiles, projectRoot: root, output, platform, version: appVersion, electronVersion: version });
  const packaged = join(root, 'artifacts', archiveName(appVersion, platform, arch));
  await rm(packaged, { force: true });
  if (platform === 'linux') run('tar', ['-czf', packaged, '-C', dirname(output), name]);
  else run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Compress-Archive -LiteralPath $env:BIGHELP_PACKAGE_SOURCE -DestinationPath $env:BIGHELP_PACKAGE_ARCHIVE'], { env: { ...process.env, BIGHELP_PACKAGE_SOURCE: output, BIGHELP_PACKAGE_ARCHIVE: packaged } });
  const hash = createHash('sha256').update(await readFile(packaged)).digest('hex');
  await writeFile(`${packaged}.sha256`, `${hash}  ${archiveName(appVersion, platform, arch)}\n`);
  console.log(packaged);
} finally { await rm(staging, { recursive: true, force: true }); }
