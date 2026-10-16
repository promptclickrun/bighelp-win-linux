import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateTarget, validateAppSource, checksumManifest, regularFiles, validateRuntime } from '../scripts/desktop/package-policy.mjs';
import { writeBundledLicenses } from '../scripts/desktop/package-licenses.mjs';

async function temporary(body) {
  const directory = await mkdtemp(join(tmpdir(), 'bighelp-package-test-'));
  try { await body(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}
async function bundle(directory) {
  await mkdir(join(directory, 'renderer'));
  for (const file of ['main.cjs', 'preload.cjs', 'renderer/index.html', 'renderer/renderer.js']) await writeFile(join(directory, file), 'bundle');
  await writeBundledLicenses(directory, directory, { main: { inputs: {} }, preload: { inputs: {} }, renderer: { inputs: {} } });
}
test('only qualified portable target combinations are accepted', () => {
  validateTarget('linux', 'x64'); validateTarget('win32', 'x64');
  for (const target of [['darwin', 'x64'], ['linux', 'arm64'], ['win32', '../x64'], ['../linux', 'x64']]) assert.throws(() => validateTarget(...target));
});
test('complete application resources pass; credentials, source and fixture files fail closed', async () => temporary(async directory => {
  await bundle(directory);
  assert.equal((await validateAppSource(directory)).length, 6);
  for (const file of ['.env', 'renderer/fixtures.json', 'main.ts', 'renderer/renderer.js.map']) {
    await writeFile(join(directory, file), 'must not ship');
    await assert.rejects(validateAppSource(directory), /Unexpected file/u);
    await rm(join(directory, file));
  }
  await rm(join(directory, 'preload.cjs'));
  await assert.rejects(validateAppSource(directory), /Incomplete/u);
}));
test('source links are rejected before package copying', { skip: process.platform === 'win32' ? 'Creating symlinks requires runner-specific privilege; Linux exercises this policy' : false }, async () => temporary(async directory => {
  await writeFile(join(directory, 'secret'), 'secret');
  await symlink(join(directory, 'secret'), join(directory, 'linked'));
  await assert.rejects(regularFiles(directory), /Unsafe source entry/u);
}));
test('manifest covers nested binary contents with known SHA256 and is stable across regeneration', async () => temporary(async directory => {
  await mkdir(join(directory, 'resources'));
  await writeFile(join(directory, 'resources/data'), 'abc');
  const expected = ['ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad  resources/data'];
  assert.deepEqual(await checksumManifest(directory), expected);
  assert.equal(await readFile(join(directory, 'SHA256SUMS'), 'utf8'), `${expected[0]}\n`);
  assert.deepEqual(await checksumManifest(directory), expected);
  await writeFile(join(directory, 'resources/data'), 'changed');
  assert.notDeepEqual(await checksumManifest(directory), expected);
}));

test('Linux package rejects runtime binaries that lost executable permissions', { skip: process.platform === 'win32' }, async () => temporary(async directory => {
  for (const file of ['electron', 'chrome-sandbox', 'chrome_crashpad_handler', 'LICENSE', 'LICENSES.chromium.html']) {
    await writeFile(join(directory, file), 'runtime');
    await chmod(join(directory, file), 0o755);
  }
  await validateRuntime(directory, 'linux');
  await chmod(join(directory, 'electron'), 0o644);
  await assert.rejects(validateRuntime(directory, 'linux'), /executable permission missing/u);
}));
