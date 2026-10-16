import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { collectBundledLicenses, writeBundledLicenses, validateBundledLicenses, licenseFiles } from '../scripts/desktop/package-licenses.mjs';
import { APP_ICON_FILES, validateAppSource, checksumManifest } from '../scripts/desktop/package-policy.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const hash = text => createHash('sha256').update(text).digest('hex');
const graphs = (main = [], renderer = [], preload = []) => Object.fromEntries(Object.entries({ main, preload, renderer })
  .map(([bundle, inputs]) => [bundle, { inputs: Object.fromEntries(inputs.map(input => [input, {}])) }]));
async function temporary(body) {
  const directory = await mkdtemp(join(tmpdir(), 'bighelp-license-test-'));
  try { await body(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}
async function source(directory, path, text) {
  await mkdir(dirname(join(directory, path)), { recursive: true });
  await writeFile(join(directory, path), text);
}
async function packageFixture(directory, path, { name = path.split('/').at(-1), version = '1.2.3', license = 'MIT' } = {}) {
  await source(directory, `${path}/package.json`, JSON.stringify({ name, version, license }));
  await source(directory, `${path}/lib/code.js`, 'module.exports = 1;');
}

test('all bundle graphs contribute notices, nested versions remain distinct, and output is deterministic', async () => temporary(async directory => {
  const paths = ['node_modules/alpha', 'node_modules/@scope/beta', 'node_modules/alpha/node_modules/@scope/beta'];
  for (const path of paths) {
    await packageFixture(directory, path);
    await source(directory, `${path}/LICENSE`, `Copyright ${path}\nFull permission and warranty terms.\n`);
  }
  await source(directory, `${paths[0]}/lib/NOTICE.txt`, 'Additional bundled-source notice.\n');
  await source(directory, 'node_modules/unbundled/package.json', '{"name":"unbundled","version":"9.9.9"}');
  const graph = graphs([`${paths[0]}/lib/code.js`], [`${paths[1]}/lib/code.js`], [`${paths[2]}/lib/code.js`]);
  const first = await writeBundledLicenses(directory, directory, graph);
  assert.equal(first.packages.length, 3);
  assert.deepEqual(first.packages.find(pkg => pkg.packagePath === paths[0]).notices.map(notice => notice.path),
    [`${paths[0]}/LICENSE`, `${paths[0]}/lib/NOTICE.txt`]);
  const before = await Promise.all(licenseFiles.map(file => readFile(join(directory, file), 'utf8')));
  await writeBundledLicenses(directory, directory, Object.fromEntries(Object.entries(graph).reverse()));
  assert.deepEqual(await Promise.all(licenseFiles.map(file => readFile(join(directory, file), 'utf8'))), before);
  assert.deepEqual(await validateBundledLicenses(directory), first);
}));

test('missing or empty full texts and incomplete bundle graphs fail instead of shipping metadata alone', async () => temporary(async directory => {
  await packageFixture(directory, 'node_modules/example');
  const graph = graphs(['node_modules/example/lib/code.js']);
  await assert.rejects(collectBundledLicenses(directory, graph), /No full dependency license/u);
  await source(directory, 'node_modules/example/NOTICE', 'Copyright alone is insufficient.');
  await assert.rejects(collectBundledLicenses(directory, graph), /No full dependency license/u);
  await source(directory, 'node_modules/example/LICENSE', '  ');
  await assert.rejects(collectBundledLicenses(directory, graph), /Empty dependency notice/u);
  await assert.rejects(collectBundledLicenses(directory, { main: graph.main }), /Missing bundle license input graph/u);
  await assert.rejects(collectBundledLicenses(directory, graphs(['../outside.js'])), /Unsafe bundle input/u);
}));

test('license symlinks and linked dependency directories are rejected', { skip: process.platform === 'win32' ? 'Linux exercises symlink policy without runner-specific privilege' : false }, async () => temporary(async directory => {
  await packageFixture(directory, 'node_modules/example');
  await source(directory, 'outside-LICENSE', 'permission');
  await symlink(join(directory, 'outside-LICENSE'), join(directory, 'node_modules/example/LICENSE'));
  await assert.rejects(collectBundledLicenses(directory, graphs(['node_modules/example/lib/code.js'])), /Unsafe dependency source entry/u);
  await symlink(join(directory, 'node_modules/example'), join(directory, 'node_modules/linked'));
  await assert.rejects(collectBundledLicenses(directory, graphs(['node_modules/linked/lib/code.js'])), /Unsafe dependency source entry/u);
}));

test('artifact policy requires full notices and rejects changed text or mismatched per-file hashes', async () => temporary(async directory => {
  for (const file of ['main.cjs', 'preload.cjs', 'renderer/index.html', 'renderer/renderer.js', ...APP_ICON_FILES]) await source(directory, file, 'bundle');
  await assert.rejects(validateAppSource(directory), /Incomplete application bundle/u);
  await writeBundledLicenses(directory, directory, graphs());
  await validateAppSource(directory);
  await writeFile(join(directory, licenseFiles[1]), 'comments alone are insufficient');
  await assert.rejects(validateAppSource(directory), /checksum mismatch/u);
  await writeBundledLicenses(directory, directory, graphs());
  await rm(join(directory, licenseFiles[0]));
  await assert.rejects(validateAppSource(directory), /Incomplete application bundle/u);
}));

test('installed ws, React and RN Web bundles carry complete original licenses and source provenance', async () => temporary(async directory => {
  // Synthetic entrypoints only: no app build, source mutation, runtime download,
  // fixtures, emitted executable output or full dependency-tree attribution.
  const options = { absWorkingDir: root, bundle: true, write: false, metafile: true, logLevel: 'silent', legalComments: 'none', minify: true };
  const main = await build({ ...options, stdin: { contents: 'require("ws")', resolveDir: root }, platform: 'node', external: ['bufferutil', 'utf-8-validate'] });
  const renderer = await build({ ...options, stdin: { contents: 'import React from "react"; import { View } from "react-native-web"; console.log(React.createElement(View));', resolveDir: root }, platform: 'browser', define: { 'process.env.NODE_ENV': '"production"' } });
  const graph = { main: main.metafile, preload: { inputs: {} }, renderer: renderer.metafile };
  const manifest = await writeBundledLicenses(root, directory, graph);
  const expectedRoots = new Set(Object.values(graph).flatMap(value => Object.keys(value.inputs))
    .map(path => /^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//u.exec(path)?.[1]).filter(Boolean));
  assert.deepEqual(new Set(manifest.packages.map(pkg => pkg.packagePath)), expectedRoots);
  for (const pkg of manifest.packages) {
    const metadata = await readFile(join(root, pkg.packagePath, 'package.json'));
    assert.equal(pkg.packageJsonSha256, hash(metadata));
    assert.equal(pkg.version, JSON.parse(metadata.toString()).version);
    for (const notice of pkg.notices) {
      const original = await readFile(join(root, notice.path), 'utf8');
      assert.equal(notice.text, original);
      assert.equal(notice.sha256, hash(original));
    }
  }
  for (const name of ['ws', 'react', 'react-native-web']) {
    const pkg = manifest.packages.find(pkg => pkg.name === name);
    assert.ok(pkg, `${name} must have graph-derived full license attribution`);
    const original = await readFile(join(root, pkg.packagePath, 'LICENSE'), 'utf8');
    assert.ok(pkg.notices.some(notice => notice.text === original));
    assert.ok(original.includes('Permission is hereby granted'));
  }
  const text = await readFile(join(directory, licenseFiles[1]), 'utf8');
  for (const holder of ['Einar Otto Stangvik', 'Arnout Kazemier', 'Luigi Pinca', 'Nicolas Gallagher', 'Meta Platforms']) assert.ok(text.includes(holder));
  const colors = manifest.packages.find(pkg => pkg.name === '@react-native/normalize-colors');
  assert.equal(colors.version, '0.74.89');
  assert.equal(colors.notices[0].basis.kind, 'normalize-colors-0.74.89-missing-license');
  assert.equal(colors.notices[0].basis.declarationSha256, hash(await readFile(join(root, colors.packagePath, 'index.js'))));
  assert.ok(colors.notices[0].basis.declarationHeader.includes('This source code is licensed under the MIT license'));
  assert.match(colors.notices[0].basis.textSourcePackage, /^react@/u);
  assert.equal(colors.notices[0].basis.packageJsonSha256, hash(await readFile(join(root, 'node_modules/react/package.json'))));
  await validateBundledLicenses(directory);
  const checksums = await checksumManifest(directory);
  for (const file of licenseFiles) assert.ok(checksums.includes(`${hash(await readFile(join(directory, file)))}  ${file}`));
  const changed = structuredClone(manifest);
  changed.packages[0].notices[0].text += 'omitted or altered terms';
  await writeFile(join(directory, licenseFiles[0]), JSON.stringify(changed));
  await assert.rejects(validateBundledLicenses(directory), /Invalid bundled license text or hash/u);
}));

test('normalize-colors exception fails closed if its version or source copyright changes', async () => temporary(async directory => {
  const path = 'node_modules/@react-native/normalize-colors';
  await packageFixture(directory, path, { name: '@react-native/normalize-colors', version: '0.74.90' });
  await assert.rejects(collectBundledLicenses(directory, graphs([`${path}/lib/code.js`])), /No full dependency license/u);
  await packageFixture(directory, path, { name: '@react-native/normalize-colors', version: '0.74.89' });
  await source(directory, `${path}/index.js`, '/** Copyright someone else; MIT */');
  await assert.rejects(collectBundledLicenses(directory, graphs([`${path}/lib/code.js`])), /license declaration changed/u);
  await source(directory, `${path}/index.js`, '/**\n * Copyright (c) Meta Platforms, Inc. and affiliates.\n *\n * This source code is licensed under the MIT license found in the\n * LICENSE file in the root directory of this source tree.\n */');
  await packageFixture(directory, 'node_modules/react', { name: 'react', license: 'MIT' });
  await source(directory, 'node_modules/react/LICENSE', 'A changed or incomplete donor license.');
  await assert.rejects(collectBundledLicenses(directory, graphs([`${path}/lib/code.js`])), /Matching complete Meta MIT license unavailable/u);
}));
