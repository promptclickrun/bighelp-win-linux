import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { CALLS } from '../apps/desktop/src/shared/calls/index.ts';
import { parseDesktopAction } from '../apps/desktop/src/shared/desktop-api.ts';
import { createSaveCopy, safeFileName } from '../apps/desktop/src/main/save-copy.ts';
import { decodeMediaChunk, decodeWorkspaceListing, hostPath, relativeFilePath, textPreview } from '../packages/contracts/agent-files.ts';
import { ALL_FEATURES, etag, nativeHost, run } from './native-host-fixture.mjs';
import { control, harness, has, nodes, textContent } from './ui-hook-harness.mjs';

const ROOT = '/home/ana/agent-work';
const workspace = (profileId = 'default') => ({ origin: 'config', profileId, root: ROOT, source: 'terminal.cwd' });
// Shaped like workspace_artifacts.py _list/_recent/_read replies (recorded from a disposable 3.13.0 host, paths changed).
const entry = (path, overrides = {}) => ({ created: 1792186077.3270655, is_directory: false, mime_type: 'text/markdown', mtime: 1792186077.327111,
  name: path.slice(path.lastIndexOf('/') + 1), path: `${ROOT}/${path}`, size: 34, ...overrides });
const folder = path => entry(path, { is_directory: true, size: null, created: null, mime_type: null });
const frame = (path, entries, profileId) => ({ can_change_path: false, entries, locked_root: ROOT, parent: path === ROOT ? null : ROOT,
  path, root: ROOT, workspace: workspace(profileId) });
const read = (path, bytes, mime) => ({ can_change_path: false, data_url: `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`,
  locked_root: ROOT, mime_type: mime, path: `${ROOT}/${path}`, root: ROOT, size: Buffer.from(bytes).byteLength, workspace: workspace() });
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4f00000000049454e44ae426082', 'hex');

function workspaceHost(files, options = {}) {
  return nativeHost((path, body) => {
    const op = path.replace('/api/plugins/loopdy/native/workspace-files/', '');
    if (op === 'scope') { assert.deepEqual(body, { path: null }); return { body: frame(ROOT, []) }; }
    if (op === 'recent') { assert.deepEqual(body, { path: null }); return { body: frame(ROOT, files.recent ?? []) }; }
    if (op === 'list') {
      const where = body.path ?? ROOT;
      const relative = where === ROOT ? '' : where.slice(ROOT.length + 1);
      return { body: frame(where, files.folders?.[relative] ?? [], options.profileId) };
    }
    if (op === 'read') return files.read(body.path);
    return assert.fail(`unexpected ${path}`);
  }, options);
}

test('the root folder lists in one request and only folder-relative paths reach the renderer', async () => {
  const host = workspaceHost({ folders: { '': [entry('notes.md'), folder('reports'), entry('fruits.txt', { mime_type: 'text/plain', size: 20 })] } });
  const result = await run(host.context, 'files.list', { profile: 'agent', folder: '' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, { servingProfileId: 'default', folder: '', parent: null, recent: false, entries: [
    { name: 'notes.md', path: 'notes.md', folder: false, size: 34, mimeType: 'text/markdown', modifiedAt: '2026-10-16T21:27:57.327Z', createdAt: '2026-10-16T21:27:57.327Z' },
    { name: 'reports', path: 'reports', folder: true, modifiedAt: '2026-10-16T21:27:57.327Z' },
    { name: 'fruits.txt', path: 'fruits.txt', folder: false, size: 20, mimeType: 'text/plain', modifiedAt: '2026-10-16T21:27:57.327Z', createdAt: '2026-10-16T21:27:57.327Z' }] });
  assert.equal(JSON.stringify(result).includes(ROOT), false, 'no host path');
  const [plan] = host.posts();
  assert.equal(plan.url, 'https://hermes.example/api/plugins/loopdy/native/workspace-files/list');
  assert.equal(plan.body, '{"path":null}');
  assert.equal(plan.headers['If-Match'], etag);
  assert.match(plan.headers['X-Loopdy-Request-ID'], /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
  assert.equal(plan.maxResponseBytes, 196608);
});

test('a subfolder is listed under a freshly read root, never a renderer path', async () => {
  const host = workspaceHost({ folders: { 'reports/2026': [entry('reports/2026/summary.md')] } });
  const result = await run(host.context, 'files.list', { profile: 'agent', folder: 'reports/2026' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.entries.map(row => row.path), ['reports/2026/summary.md']);
  assert.equal(result.value.parent, 'reports');
  assert.deepEqual(host.posts().map(plan => [new URL(plan.url).pathname.split('/').at(-1), plan.body]),
    [['scope', '{"path":null}'], ['list', `{"path":"${ROOT}/reports/2026"}`]]);
});

test('listings that escape the folder, change profile or misreport paths are refused', () => {
  const ok = frame(`${ROOT}/a`, [entry('a/b.md')]);
  assert.equal(decodeWorkspaceListing(ok, 'default', ROOT, 'a').entries.length, 1);
  const bad = [
    frame(`${ROOT}/a`, [entry('a/b.md', { path: '/etc/passwd' })]),
    frame(`${ROOT}/a`, [entry('a/b.md', { path: `${ROOT}/a/../../etc/passwd` })]),
    frame(`${ROOT}/a`, [entry('a/b.md', { path: `${ROOT}/a/c.md` })]),
    frame(`${ROOT}/a`, [entry('a/b.md', { name: '..' })]),
    frame(`${ROOT}/a`, [entry('a/b.md', { name: 'b‮.md', path: `${ROOT}/a/b‮.md` })]),
    frame(`${ROOT}/a`, [entry('a/b.md'), entry('a/b.md')]),
    frame(`${ROOT}/a`, [entry('a/b.md', { is_directory: 'no' })]),
    frame(`${ROOT}/other`, [entry('other/b.md')]),
    frame(`${ROOT}/a`, [entry('a/b.md')], 'someone-else'),
    { ...ok, workspace: { ...workspace(), source: 'managed' } },
    { ...ok, workspace: { ...workspace(), root: 'relative/root' } },
    { ...ok, root: '/elsewhere' },
  ];
  for (const value of bad) assert.throws(() => decodeWorkspaceListing(value, 'default', ROOT, 'a'), JSON.stringify(value).slice(0, 120));
  // Recent entries may sit anywhere below the root, but never be folders.
  assert.equal(decodeWorkspaceListing(frame(ROOT, [entry('deep/x/y.md')]), 'default', ROOT, null).entries[0].path, 'deep/x/y.md');
  assert.throws(() => decodeWorkspaceListing(frame(ROOT, [folder('deep')]), 'default', ROOT, null));
  for (const path of ['', 'a/b', 'a b/c.md']) assert.equal(relativeFilePath(path), path);
  for (const path of ['/a', 'a/', 'a//b', '../a', 'a/..', './a', 'a\\b', 'a\u0000b', 'x'.repeat(2049)]) assert.throws(() => relativeFilePath(path), path);
  assert.equal(hostPath('/', 'a/b'), '/a/b'); assert.equal(hostPath(ROOT, ''), ROOT);
});

test('recent files need their own feature and show the serving profile honestly', async () => {
  const host = workspaceHost({ recent: [entry('scratch/tmp.txt', { mime_type: 'text/plain', size: 5 }), entry('notes.md')] });
  const result = await run(host.context, 'files.recent', { profile: 'agent' });
  assert.equal(result.ok, true);
  assert.equal(result.value.recent, true); assert.equal(result.value.servingProfileId, 'default');
  assert.deepEqual(result.value.entries.map(row => row.path), ['scratch/tmp.txt', 'notes.md']);
  const older = workspaceHost({}, { features: ALL_FEATURES.filter(feature => feature !== 'native-workspace-recent-v1') });
  assert.equal((await run(older.context, 'files.recent', { profile: 'agent' })).code, 'unsupported');
  const none = workspaceHost({}, { features: ['native-context-v1', 'serving-profile-v1'] });
  assert.equal((await run(none.context, 'files.list', { profile: 'agent', folder: '' })).code, 'unsupported');
  assert.equal(older.posts().length + none.posts().length, 0, 'no request without the feature');
});

test('text preview re-lists the parent, reads once and checks size, type and bytes', async () => {
  const text = '# Notes\nmilk, eggs, flour\n';
  const host = workspaceHost({ folders: { '': [entry('notes.md', { size: Buffer.byteLength(text) })] }, read: path => {
    assert.equal(path, `${ROOT}/notes.md`); return { body: read('notes.md', text, 'text/markdown') };
  } });
  const result = await run(host.context, 'files.preview', { profile: 'agent', path: 'notes.md' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.preview, { kind: 'text', text, truncated: false });
  assert.equal(result.value.saveable, true); assert.equal(result.value.name, 'notes.md');
  assert.deepEqual(host.posts().map(plan => new URL(plan.url).pathname.split('/').at(-1)), ['scope', 'list', 'read']);
  assert.equal(host.posts()[2].maxResponseBytes, 4 * 1024 * 1024 - 256);
  for (const reply of [read('notes.md', text + 'x', 'text/markdown'), read('notes.md', text, 'text/plain'), read('other.md', text, 'text/markdown'),
    { ...read('notes.md', text, 'text/markdown'), data_url: 'data:text/markdown;base64,%%%' }, { ...read('notes.md', text, 'text/markdown'), workspace: workspace('x') }]) {
    const mismatch = workspaceHost({ folders: { '': [entry('notes.md', { size: Buffer.byteLength(text) })] }, read: () => ({ body: reply }) });
    assert.equal((await run(mismatch.context, 'files.preview', { profile: 'agent', path: 'notes.md' })).code, 'unavailable');
  }
  const long = textPreview(Buffer.from('a'.repeat(100_001)));
  assert.equal(long.text.length, 100_000); assert.equal(long.truncated, true);
  assert.deepEqual(textPreview(Buffer.from([0xff, 0xfe, 0x00])), { kind: 'none', reason: 'not-text' });
});

test('image preview is a verified raster data URL; other files are not read', async () => {
  const host = workspaceHost({ folders: { '': [entry('chart.png', { mime_type: 'image/png', size: PNG.byteLength })] },
    read: () => ({ body: read('chart.png', PNG, 'image/png') }) });
  const image = await run(host.context, 'files.preview', { profile: 'agent', path: 'chart.png' });
  assert.deepEqual(image.value.preview, { kind: 'image', dataUrl: `data:image/png;base64,${PNG.toString('base64')}` });
  const fake = workspaceHost({ folders: { '': [entry('chart.png', { mime_type: 'image/png', size: 12 })] },
    read: () => ({ body: read('chart.png', '<svg onload=x>', 'image/png') }) });
  // 14 bytes were listed as 12: refused. Same size but wrong signature: no preview.
  assert.equal((await run(fake.context, 'files.preview', { profile: 'agent', path: 'chart.png' })).code, 'unavailable');
  const lie = workspaceHost({ folders: { '': [entry('chart.png', { mime_type: 'image/png', size: 14 })] },
    read: () => ({ body: read('chart.png', '<svg onload=x>', 'image/png') }) });
  assert.deepEqual((await run(lie.context, 'files.preview', { profile: 'agent', path: 'chart.png' })).value.preview, { kind: 'none', reason: 'not-previewable' });
  const others = [entry('a.svg', { mime_type: 'image/svg+xml' }), entry('b.pdf', { mime_type: 'application/pdf', size: 4000 }),
    entry('c.md', { size: 5_000_000 }), entry('d.txt', { mime_type: 'text/plain', size: 0 })];
  const skip = workspaceHost({ folders: { '': others }, read: () => assert.fail('must not read') });
  const reasons = [];
  for (const row of others) reasons.push((await run(skip.context, 'files.preview', { profile: 'agent', path: row.name })).value.preview.reason);
  assert.deepEqual(reasons, ['not-previewable', 'not-previewable', 'too-large', 'empty']);
});

test('workspace refusals use the plugin code, in plain words', async () => {
  const cases = [
    ['workspace_not_configured', 409, ALL_FEATURES, /folder named “workspace”/u],
    ['workspace_not_configured', 409, ALL_FEATURES.filter(f => f !== 'native-workspace-hermes-home-v1'), /newest bighelp plugin/u],
    ['workspace_in_container', 409, ALL_FEATURES, /inside a container/u],
    ['workspace_windows_unsupported', 501, ALL_FEATURES, /Windows Hermes computer/u],
    ['path_outside_workspace', 403, ALL_FEATURES, /outside the agent’s working folder/u],
    ['directory_too_large', 413, ALL_FEATURES, /more than 2,000/u],
  ];
  for (const [code, status, features, message] of cases) {
    const host = nativeHost(() => ({ status, body: { error: { code, message: 'raw /home/ana text', retryable: false, details: {} } } }), { features });
    const result = await run(host.context, 'files.list', { profile: 'agent', folder: '' });
    assert.match(result.message, message, code);
    assert.equal(result.message.includes('/home/ana'), false);
  }
});

test('Save a copy asks first, then fetches and writes bytes main read itself', async () => {
  const text = 'milk, eggs\n';
  const steps = [];
  const saveCopy = async (name, fetch) => { steps.push(['dialog', name]); const bytes = await fetch(); steps.push(['write', Buffer.from(bytes).toString()]); return 'notes copy.md'; };
  const host = workspaceHost({ folders: { '': [entry('notes.md', { size: text.length })] }, read: () => { steps.push(['read']); return { body: read('notes.md', text, 'text/markdown') }; } },
    { saveCopy });
  const result = await run(host.context, 'files.save', { profile: 'agent', path: 'notes.md' });
  assert.deepEqual(result, { ok: true, value: { saved: true, fileName: 'notes copy.md' } });
  assert.deepEqual(steps, [['dialog', 'notes.md'], ['read'], ['write', text]]);
  const cancelled = workspaceHost({ folders: { '': [entry('notes.md', { size: text.length })] }, read: () => assert.fail('no read after cancel') },
    { saveCopy: async () => null });
  assert.deepEqual(await run(cancelled.context, 'files.save', { profile: 'agent', path: 'notes.md' }), { ok: true, value: { saved: false } });
  const big = workspaceHost({ folders: { '': [entry('video.mp4', { mime_type: 'video/mp4', size: 3_000_001 })] } }, { saveCopy: () => assert.fail('no dialog') });
  assert.match((await run(big.context, 'files.save', { profile: 'agent', path: 'video.mp4' })).message, /over 3 MB/u);
  const windowless = workspaceHost({ folders: { '': [entry('notes.md', { size: text.length })] } });
  assert.equal((await run(windowless.context, 'files.save', { profile: 'agent', path: 'notes.md' })).code, 'unsupported');
  // The renderer can only name a file; never where to write or what to write.
  for (const input of [{ profile: 'agent', path: 'notes.md', target: '/tmp/x' }, { profile: 'agent', path: 'notes.md', bytes: 'aGk=' },
    { profile: 'agent', path: '/etc/passwd' }, { profile: 'agent', path: '../secret' }, { profile: 'agent', path: '' }]) {
    assert.throws(() => CALLS['files.save'].parse(input), JSON.stringify(input));
    assert.throws(() => parseDesktopAction({ kind: 'call', connection: 1, name: 'files.save', input }));
  }
});

test('the save capability writes only where the person chose, via a partial file', async () => {
  const log = [];
  const files = { writeFile: async (path, bytes, options) => { log.push(['write', path, Buffer.from(bytes).toString(), options.flag]); },
    rename: async (from, to) => { log.push(['rename', from, to]); }, rm: async path => { log.push(['rm', path]); } };
  let shown;
  const save = createSaveCopy({ downloads: () => '/Users/ana/Downloads', files,
    showSaveDialog: async options => { shown = options; return { canceled: false, filePath: '/Users/ana/Desktop/notes.md' }; } });
  assert.equal(await save('../../notes.md', async () => new TextEncoder().encode('hi')), 'notes.md');
  assert.deepEqual(shown, { title: 'Save a copy', buttonLabel: 'Save', defaultPath: '/Users/ana/Downloads/_.._notes.md' });
  assert.equal(log[0][0], 'write'); assert.match(log[0][1], /^\/Users\/ana\/Desktop\/\.notes\.md\.[0-9a-f-]{36}\.part$/u);
  assert.equal(log[0][2], 'hi'); assert.equal(log[0][3], 'wx');
  assert.deepEqual(log[1], ['rename', log[0][1], '/Users/ana/Desktop/notes.md']);
  const cancel = createSaveCopy({ downloads: () => '/d', files, showSaveDialog: async () => ({ canceled: true }) });
  assert.equal(await cancel('x', () => assert.fail('no fetch after cancel')), null);
  const relative = createSaveCopy({ downloads: () => '/d', files, showSaveDialog: async () => ({ canceled: false, filePath: 'relative.md' }) });
  await assert.rejects(relative('x', () => assert.fail('no fetch')));
  const failing = { ...files, rename: async () => { throw new Error('EACCES /secret/path'); } };
  log.length = 0;
  const broken = createSaveCopy({ downloads: () => '/d', files: failing, showSaveDialog: async () => ({ canceled: false, filePath: '/d/x.md' }) });
  await assert.rejects(broken('x', async () => new Uint8Array([1])), error => error.code === 'unavailable' && !error.message.includes('/secret'));
  assert.equal(log.at(-1)[0], 'rm', 'partial file removed');
  for (const [input, expected] of [['report.pdf', 'report.pdf'], ['a/b\\c:d*e?f"g<h>i|j', 'a_b_c_d_e_f_g_h_i_j'], ['  ..hidden. ', 'hidden'],
    ['CON', '_CON'], ['nul.txt', '_nul.txt'], ['', 'file'], ['‮cod.exe', 'cod.exe'], [`${'x'.repeat(200)}.md`, `${'x'.repeat(117)}.md`], [7, 'file']]) {
    assert.equal(safeFileName(input), expected, String(input));
  }
});

test('media lists this agent’s pictures and videos and saves them chunk by chunk', async () => {
  const id = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
  const bytes = Buffer.alloc(5000, 7);
  const media = { id, fileName: 'sunset.jpg', mimeType: 'image/jpeg', byteCount: bytes.byteLength, storedId: 'session-1', createdAt: 1792186077.5 };
  const fetched = [];
  const host = nativeHost((path, body) => {
    if (path.endsWith('/attachments/recent')) { assert.deepEqual(body, { agentId: 'agent', limit: 36 }); return { body: { items: [media] } }; }
    assert.ok(path.endsWith('/attachments/fetch'));
    fetched.push(body.offset);
    const end = Math.min(body.offset + 3000, bytes.byteLength);
    return { body: { attachmentId: id, offset: body.offset, byteCount: bytes.byteLength, mimeType: 'image/jpeg',
      data: bytes.subarray(body.offset, end).toString('base64'), nextOffset: end < bytes.byteLength ? end : null } };
  }, { saveCopy: async (name, fetch) => { assert.equal(name, 'sunset.jpg'); assert.equal(Buffer.from(await fetch()).equals(bytes), true); return name; } });
  const list = await run(host.context, 'media.list', { profile: 'agent' });
  assert.deepEqual(list.value, { items: [{ id, name: 'sunset.jpg', mimeType: 'image/jpeg', size: 5000, createdAt: '2026-10-16T21:27:57.500Z' }] });
  assert.equal(JSON.stringify(list).includes('session-1'), false);
  assert.deepEqual(await run(host.context, 'media.save', { profile: 'agent', id }), { ok: true, value: { saved: true, fileName: 'sunset.jpg' } });
  assert.deepEqual(fetched, [0, 3000]);
  // Not a JPEG signature, so no picture is shown even though it is small.
  assert.deepEqual((await run(host.context, 'media.preview', { profile: 'agent', id })).value.preview, { kind: 'none', reason: 'not-previewable' });
  assert.throws(() => decodeMediaChunk({ attachmentId: id, offset: 0, byteCount: 10, mimeType: 'image/jpeg', data: 'AAAA', nextOffset: 5 }, id, 0));
  assert.throws(() => decodeMediaChunk({ attachmentId: id, offset: 3, byteCount: 6, mimeType: 'image/jpeg', data: 'AAAA', nextOffset: null }, id, 0));
  assert.throws(() => decodeMediaChunk({ attachmentId: id, offset: 0, byteCount: 6, mimeType: 'image/jpeg', data: 'AAAA', nextOffset: null }, id, 0));
  const older = nativeHost(() => assert.fail('no request'), { features: ALL_FEATURES.filter(f => f !== 'native-agent-media-v1') });
  assert.equal((await run(older.context, 'media.list', { profile: 'agent' })).code, 'unsupported');
  for (const input of [{ profile: 'agent', id: 'short' }, { profile: 'agent', id: '../../etc/passwd/xxxxxxxx' }, { profile: 'agent', id, path: '/x' }]) {
    assert.throws(() => CALLS['media.save'].parse(input));
  }
});

// ---- The Files tab page ----
const uiData = { sample: false, host: { label: 'Studio Mac', state: 'connected' }, chats: [], workflows: [],
  agents: [{ id: 'one', name: 'One', summary: '', color: 'blue' }, { id: 'default', name: 'Main', summary: '', color: 'red' }] };
const uiSnapshot = (overrides = {}) => ({ generation: 1, connection: 4, revision: 1, status: 'connected', data: uiData, selectedChatId: null,
  running: false, canSend: false, notice: '', storageAvailable: true, prompts: [], drafts: {}, workspace: null, ...overrides });
const file = (path, overrides = {}) => ({ name: path.slice(path.lastIndexOf('/') + 1), path, folder: false, size: 34, mimeType: 'text/markdown',
  modifiedAt: '2026-10-16T21:27:57.327Z', ...overrides });
function filesApi() {
  const calls = [];
  const api = { call(connection, name, input) { let resolve; const promise = new Promise(done => { resolve = done; }); calls.push({ connection, name, input, resolve }); return promise; },
    send() { throw new Error('Files never send a message'); } };
  const answer = (name, value) => { const call = calls.find(entry => entry.name === name && !entry.done); assert.ok(call, `no pending ${name}`); call.done = true; call.resolve(value); return call; };
  return { api, calls, answer };
}
async function filesPage(extra = {}) {
  const io = filesApi();
  const props = { api: io.api, snapshot: uiSnapshot(), data: uiData, profile: 'one', narrow: false, ...extra };
  const h = await harness('packages/ui/components/AgentFiles.tsx', 'AgentFiles', props);
  h.render(); await h.settle();
  return { h, io, props };
}
const folderValue = (entries, overrides = {}) => ({ ok: true, value: { servingProfileId: 'one', folder: '', parent: null, recent: true, entries, ...overrides } });

test('Artifacts shows recent files from the Hermes computer, previews text and saves a copy through main', async () => {
  const { h, io } = await filesPage();
  const recent = io.answer('files.recent', folderValue([file('reports/summary.md'), file('notes.md')]));
  assert.deepEqual([recent.connection, recent.input], [4, { profile: 'one' }]);
  await h.settle();
  const text = textContent(h.value);
  assert.match(text, /Made or changed lately/);
  assert.match(text, /These files are on Studio Mac, in One’s working folder\. bighelp only reads them; Save a copy puts one on this computer\./);
  assert.match(text, /in Working folder › reports|in reports/);
  control(h, 'summary.md').onPress(); h.render(); await h.settle();
  const preview = io.answer('files.preview', { ok: true, value: { servingProfileId: 'one', name: 'summary.md', path: 'reports/summary.md', size: 18,
    mimeType: 'text/markdown', saveable: true, preview: { kind: 'text', text: '# Summary\nAll good', truncated: true } } });
  assert.deepEqual(preview.input, { profile: 'one', path: 'reports/summary.md' });
  await h.settle();
  assert.match(textContent(h.value), /# Summary\nAll good/);
  assert.match(textContent(h.value), /Showing the first part of this file/);
  control(h, 'Save a copy of summary.md on this computer').onPress(); h.render();
  assert.equal(control(h, 'Save a copy of summary.md on this computer').disabled, true, 'one save at a time');
  const save = io.answer('files.save', { ok: true, value: { saved: true, fileName: 'summary copy.md' } });
  assert.deepEqual(save.input, { profile: 'one', path: 'reports/summary.md' }, 'the renderer names the file, never where to write');
  await h.settle();
  assert.match(textContent(h.value), /Saved “summary copy\.md” on this computer\./);
  control(h, 'Save a copy of summary.md on this computer').onPress(); h.render();
  io.answer('files.save', { ok: true, value: { saved: false } }); await h.settle();
  assert.doesNotMatch(textContent(h.value), /Saved “/, 'cancelling says nothing');
  h.unmount();
});

test('Artifacts says whose working folder it is when the plugin serves another agent', async () => {
  const { h, io } = await filesPage();
  io.answer('files.recent', folderValue([file('notes.md')], { servingProfileId: 'default' })); await h.settle();
  const text = textContent(h.value);
  assert.match(text, /in Main’s working folder/);
  assert.match(text, /Showing Main’s files/);
  assert.match(text, /The bighelp plugin shares the working folder of the agent Hermes runs as, Main\. One may keep its own files somewhere else\./);
  h.unmount();
});

test('without recent files the working folder is browsed folder by folder', async () => {
  const { h, io } = await filesPage();
  io.answer('files.recent', { ok: false, code: 'unsupported', message: 'Update the bighelp plugin on your Hermes computer, then try again.' }); await h.settle();
  const root = io.answer('files.list', folderValue([file('notes.md'), { name: 'reports', path: 'reports', folder: true }], { recent: false }));
  assert.deepEqual(root.input, { profile: 'one', folder: '' });
  await h.settle();
  assert.match(textContent(h.value), /Working folder/);
  assert.equal(has(h, 'Show recent files'), false);
  control(h, 'Folder reports').onPress(); h.render(); await h.settle();
  const inner = io.answer('files.list', folderValue([file('reports/a.md')], { recent: false, folder: 'reports', parent: '' }));
  assert.deepEqual(inner.input, { profile: 'one', folder: 'reports' });
  await h.settle();
  control(h, 'Up one folder').onPress(); h.render(); await h.settle();
  assert.deepEqual(io.calls.at(-1).input, { profile: 'one', folder: '' });
  h.unmount();
});

test('refusals are shown in plain words; offline nothing is requested', async () => {
  const { h, io } = await filesPage();
  io.answer('files.recent', { ok: false, code: 'unavailable', message: 'This agent works inside a container, so its files aren’t on the computer bighelp can read.' });
  await h.settle();
  assert.match(textContent(h.value), /inside a container/);
  const offline = await filesPage({ snapshot: uiSnapshot({ status: 'disconnected' }) });
  assert.match(textContent(offline.h.value), /Files are unavailable\. Connect to Hermes, then refresh\./);
  assert.equal(offline.io.calls.length, 0);
  h.unmount(); offline.h.unmount();
});

test('Media lists pictures and videos, previews only images, and saves through main', async () => {
  const { h, io } = await filesPage();
  control(h, 'Media').onPress(); h.render(); await h.settle();
  const id = 'a1b2c3d4e5f60718293a4b5c6d7e8f90', video = 'b1b2c3d4e5f60718293a4b5c6d7e8f90';
  const list = io.answer('media.list', { ok: true, value: { items: [{ id, name: 'sunset.png', mimeType: 'image/png', size: 67 },
    { id: video, name: 'clip.mp4', mimeType: 'video/mp4', size: 9_000_000 }] } });
  assert.deepEqual(list.input, { profile: 'one' });
  await h.settle();
  control(h, 'sunset.png').onPress(); h.render(); await h.settle();
  io.answer('media.preview', { ok: true, value: { id, mimeType: 'image/png', size: 67, saveable: true, preview: { kind: 'image', dataUrl: 'data:image/png;base64,iVBORw0KGgo=' } } });
  await h.settle();
  const images = nodes(h.value, node => node.type === 'img');
  assert.equal(images.length, 1); assert.equal(images[0].props.src, 'data:image/png;base64,iVBORw0KGgo='); assert.equal(images[0].props.alt, 'sunset.png');
  control(h, 'clip.mp4').onPress(); h.render(); await h.settle();
  assert.match(textContent(h.value), /Videos can be saved, but not played here yet\./);
  assert.equal(io.calls.filter(call => call.name === 'media.preview').length, 1, 'videos are not fetched for a preview');
  control(h, 'Save a copy of clip.mp4 on this computer').onPress(); h.render();
  assert.deepEqual(io.answer('media.save', { ok: false, code: 'stale', message: 'That file is no longer in Media. Refresh to see the latest.' }).input, { profile: 'one', id: video });
  await h.settle();
  assert.match(textContent(h.value), /no longer in Media/);
  h.unmount();
});
