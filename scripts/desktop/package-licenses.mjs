// Full dependency notices come from the esbuild input graphs, never npm's entire
// dependency tree. Only these two inert files are permitted in the app artifact.
import { lstat, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';

export const licenseFiles = ['THIRD_PARTY_NOTICES.json', 'THIRD_PARTY_NOTICES.txt'];
const bundles = ['main', 'preload', 'renderer'];
const sha256 = value => createHash('sha256').update(value).digest('hex');
const metaMitSha256 = 'da6d3703ed11cbe42bd212c725957c98da23cbff1998c05fa4b3d976d1a58e93';
const legalName = /^(?:licen[cs]e|notice|copying|copyright|authors)(?:[._-].*)?$/iu;
const licenseName = /^(?:licen[cs]e|copying)(?:[._-].*)?$/iu;
const portable = value => value.split(sep).join('/');
const safePath = value => typeof value === 'string' && value.length > 0 && !value.includes('\\')
  && !/[\u0000-\u001f\u007f]/u.test(value)
  && !isAbsolute(value) && !value.split('/').some(part => part === '..' || part === '.' || part === '');

// Reject links in every ancestor as well as at the final license/package file.
async function checkedPath(root, path, directory = false) {
  if (!safePath(path)) throw new Error(`Unsafe dependency source path: ${path}`);
  const parts = path.split('/');
  let current = root;
  for (let index = 0; index < parts.length; index++) {
    current = join(current, parts[index]);
    const stat = await lstat(current);
    const wantDirectory = index < parts.length - 1 || directory;
    if (stat.isSymbolicLink() || (wantDirectory ? !stat.isDirectory() : !stat.isFile())) {
      throw new Error(`Unsafe dependency source entry: ${path}`);
    }
  }
  return current;
}

function packagePath(input) {
  const matches = [...input.matchAll(/(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)(?=\/)/gu)];
  const match = matches.at(-1);
  if (!match) return undefined;
  return input.slice(0, match.index + match[0].length);
}

function noticeText(packages) {
  return `Third-party runtime software bundled in Bighelp Development.\nSources are installed npm packages used by the esbuild main/preload/renderer input graphs.\nSee THIRD_PARTY_NOTICES.json for package versions, source paths, input graphs, and SHA-256 hashes.\n\n${packages.map(pkg =>
    `===== ${pkg.name}@${pkg.version} (${pkg.packagePath}) =====\n${pkg.notices.map(notice =>
      `${notice.basis ? `This npm package omits its referenced LICENSE. The complete matching Meta MIT text below comes from ${notice.basis.textSourcePackage}, ${notice.path}.\nIts MIT declaration and copyright were verified in ${notice.basis.declarationPath}; this is not a license file shipped by normalize-colors.\n` : ''}----- ${notice.path} -----\n${notice.text}${notice.text.endsWith('\n') ? '' : '\n'}`).join('\n')}`).join('\n')}`;
}

// This locked npm package omits the LICENSE referenced by its source header.
// Its MIT declaration and Meta copyright exactly match React's complete MIT
// license. Keep this explicit and version-bound; never infer a generic fallback.
async function missingNormalizeColorsNotice(root, pkg, source) {
  if (pkg.name !== '@react-native/normalize-colors' || pkg.version !== '0.74.89' || pkg.license !== 'MIT') return [];
  const declarationPath = `${source}/index.js`;
  const declaration = await readFile(await checkedPath(root, declarationPath), 'utf8');
  const copyright = 'Copyright (c) Meta Platforms, Inc. and affiliates.';
  if (!declaration.startsWith(`/**\n * ${copyright}\n *\n * This source code is licensed under the MIT license found in the\n * LICENSE file in the root directory of this source tree.`)) throw new Error('normalize-colors license declaration changed');
  const path = 'node_modules/react/LICENSE';
  const text = await readFile(await checkedPath(root, path), 'utf8');
  const metadata = await readFile(await checkedPath(root, 'node_modules/react/package.json'));
  const donor = JSON.parse(metadata.toString('utf8'));
  if (donor.name !== 'react' || donor.version !== '19.3.1' || donor.license !== 'MIT'
    || sha256(text) !== metaMitSha256 || !text.startsWith(`MIT License\n\n${copyright}\n\nPermission is hereby granted, free of charge`)) throw new Error('Matching complete Meta MIT license unavailable');
  return [{ path, sha256: sha256(text), text, basis: {
    kind: 'normalize-colors-0.74.89-missing-license', declarationPath, declarationSha256: sha256(declaration),
    declarationHeader: declaration.slice(0, declaration.indexOf('*/') + 2),
    license: 'MIT', copyright, textSourcePackage: `${donor.name}@${donor.version}`, packageJsonSha256: sha256(metadata),
  } }];
}

export async function collectBundledLicenses(root, graphs) {
  if (Object.keys(graphs).sort().join(',') !== [...bundles].sort().join(',')) throw new Error('Missing bundle license input graph');
  const found = new Map();
  for (const bundle of bundles) {
    for (const file of Object.keys(graphs[bundle].inputs).sort()) {
      const input = portable(relative(root, resolve(root, file)));
      if (!safePath(input)) throw new Error(`Unsafe bundle input: ${file}`);
      const source = packagePath(input);
      if (!source) continue;
      await checkedPath(root, input);
      if (!found.has(source)) found.set(source, { main: [], preload: [], renderer: [] });
      found.get(source)[bundle].push(input);
    }
  }
  const packages = [];
  for (const [source, inputs] of [...found].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    const metadata = await readFile(await checkedPath(root, `${source}/package.json`));
    const pkg = JSON.parse(metadata.toString('utf8'));
    if (typeof pkg.name !== 'string' || !pkg.name || typeof pkg.version !== 'string' || !pkg.version) throw new Error(`Missing package identity: ${source}`);
    // Include root legal files and any additional notices governing the actual
    // bundled source subdirectories. Do not traverse unrelated fixtures or deps.
    const directories = new Set([source]);
    for (const input of Object.values(inputs).flat()) {
      let directory = portable(dirname(input));
      while (directory !== source) {
        directories.add(directory);
        directory = portable(dirname(directory));
      }
    }
    const notices = [];
    for (const directory of [...directories].sort()) {
      const path = await checkedPath(root, directory, true);
      for (const name of (await readdir(path)).sort().filter(name => legalName.test(name))) {
        const sourcePath = `${directory}/${name}`;
        const text = await readFile(await checkedPath(root, sourcePath), 'utf8');
        if (!text.trim()) throw new Error(`Empty dependency notice: ${sourcePath}`);
        notices.push({ path: sourcePath, sha256: sha256(text), text });
      }
    }
    if (!notices.some(notice => licenseName.test(notice.path.split('/').at(-1)))) {
      notices.push(...await missingNormalizeColorsNotice(root, pkg, source));
    }
    if (!notices.some(notice => licenseName.test(notice.path.split('/').at(-1)))) throw new Error(`No full dependency license/notice found: ${source}`);
    packages.push({ name: pkg.name, version: pkg.version, packagePath: source,
      packageJsonSha256: sha256(metadata), license: typeof pkg.license === 'string' ? pkg.license : null, inputs, notices });
  }
  const text = noticeText(packages);
  return { manifest: { schemaVersion: 1, bundles, packages, noticesSha256: sha256(text) }, text };
}

export async function writeBundledLicenses(root, out, graphs) {
  const result = await collectBundledLicenses(root, graphs);
  await writeFile(join(out, licenseFiles[0]), `${JSON.stringify(result.manifest, null, 2)}\n`);
  await writeFile(join(out, licenseFiles[1]), result.text);
  return result.manifest;
}

export async function validateBundledLicenses(directory) {
  const manifest = JSON.parse(await readFile(join(directory, licenseFiles[0]), 'utf8'));
  const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
  if (manifest.schemaVersion !== 1 || JSON.stringify(manifest.bundles) !== JSON.stringify(bundles)
    || !Array.isArray(manifest.packages) || !hash(manifest.noticesSha256)) throw new Error('Invalid bundled license manifest');
  const roots = new Set();
  for (const pkg of manifest.packages) {
    if (!pkg || typeof pkg.name !== 'string' || !pkg.name || typeof pkg.version !== 'string' || !pkg.version
      || !safePath(pkg.packagePath) || packagePath(`${pkg.packagePath}/package.json`) !== pkg.packagePath
      || roots.has(pkg.packagePath) || !hash(pkg.packageJsonSha256)
      || !pkg.inputs || Object.keys(pkg.inputs).sort().join(',') !== [...bundles].sort().join(',')
      || !bundles.every(bundle => Array.isArray(pkg.inputs[bundle]) && pkg.inputs[bundle].every(input =>
        safePath(input) && packagePath(input) === pkg.packagePath))
      || Object.values(pkg.inputs).flat().length === 0 || !Array.isArray(pkg.notices)
      || !pkg.notices.some(notice => notice && typeof notice.path === 'string' && licenseName.test(notice.path.split('/').at(-1)))) throw new Error('Invalid bundled package license provenance');
    roots.add(pkg.packagePath);
    for (const notice of pkg.notices) {
      const exception = notice?.basis;
      const knownException = pkg.name === '@react-native/normalize-colors' && pkg.version === '0.74.89'
        && pkg.license === 'MIT' && notice.path === 'node_modules/react/LICENSE'
        && exception?.kind === 'normalize-colors-0.74.89-missing-license'
        && exception.declarationPath === `${pkg.packagePath}/index.js` && hash(exception.declarationSha256)
        && typeof exception.declarationHeader === 'string'
        && exception.declarationHeader.startsWith('/**\n * Copyright (c) Meta Platforms, Inc. and affiliates.\n *\n * This source code is licensed under the MIT license found in the\n * LICENSE file in the root directory of this source tree.')
        && exception.license === 'MIT' && exception.copyright === 'Copyright (c) Meta Platforms, Inc. and affiliates.'
        && exception.textSourcePackage === 'react@19.3.1' && notice.sha256 === metaMitSha256
        && hash(exception.packageJsonSha256);
      if (!notice || !safePath(notice.path) || (exception && !knownException)
        || (!notice.path.startsWith(`${pkg.packagePath}/`) && !knownException)
        || !legalName.test(notice.path.split('/').at(-1)) || typeof notice.text !== 'string' || !notice.text.trim()
        || !hash(notice.sha256) || sha256(notice.text) !== notice.sha256) throw new Error('Invalid bundled license text or hash');
    }
  }
  const text = await readFile(join(directory, licenseFiles[1]), 'utf8');
  if (text !== noticeText(manifest.packages) || sha256(text) !== manifest.noticesSha256) throw new Error('Bundled license text checksum mismatch');
  return manifest;
}
