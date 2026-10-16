import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { createProtectedRepository } from '../packages/platform/protected-repository.ts';
import { createDisplayCache, displayCacheKey, normalizeDisplayCache } from '../packages/platform/display-cache.ts';

// Synthetic authenticated encryption only; not an OS-secret-store qualification.
const secret = randomBytes(32);
const protection = {
  isEncryptionAvailable: () => true,
  getSelectedStorageBackend: () => 'synthetic',
  encryptString(text) {
    const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', secret, nonce);
    return Buffer.concat([nonce, cipher.update(text, 'utf8'), cipher.final(), cipher.getAuthTag()]);
  },
  decryptString(bytes) {
    const input = Buffer.from(bytes), decipher = createDecipheriv('aes-256-gcm', secret, input.subarray(0, 12));
    decipher.setAuthTag(input.subarray(-16));
    return Buffer.concat([decipher.update(input.subarray(12, -16)), decipher.final()]).toString('utf8');
  },
};
const scope = { hostId: 'synthetic-host', principalId: 'synthetic-principal' };
function snapshot() {
  return { hostLabel: 'Test computer', profiles: [{ profileId: 'alpha', name: 'Alpha', summary: 'Helper', color: '#123456' }],
    sessions: [{ profileId: 'alpha', storedSessionId: 'saved-chat', title: 'A conversation', preview: 'Saved words', historyUpdatedAt: 10,
      transcript: [{ kind: 'day', id: 'day-1', label: 'Today' },
        { kind: 'message', id: 'message-1', direction: 'in', paragraphs: ['Saved private display words'], bullets: ['A point'] },
        { kind: 'tool', id: 'tool-1', label: 'Read', detail: 'Finished reading' }] }] };
}
async function setup(t) {
  const directory = await mkdtemp(join(tmpdir(), 'bighelp-display-cache-'));
  const open = () => createProtectedRepository({ directory, protection, platform: process.platform });
  const repository = await open();
  t.after(async () => { await repository.close(); await rm(directory, { recursive: true, force: true }); });
  return { directory, repository, cache: createDisplayCache(repository), open };
}

test('display cache encrypted roundtrip survives reopen and returns detached frozen data', async t => {
  const { directory, repository, cache, open } = await setup(t);
  assert.equal(await cache.read(scope), null);
  const input = snapshot(), pending = cache.replace(scope, null, input);
  input.sessions[0].transcript[1].paragraphs[0] = 'caller mutation';
  const stored = await pending;
  assert.equal(stored.data.sessions[0].transcript[1].paragraphs[0], 'Saved private display words');
  assert.ok(Object.isFrozen(stored.data.sessions[0].transcript[1].paragraphs));
  for (const filename of await readdir(directory)) {
    if (filename.endsWith('.enc')) assert.equal((await readFile(join(directory, filename))).includes(Buffer.from('Saved private display words')), false);
  }
  await repository.close();
  const reopened = await open();
  try {
    const reloaded = await createDisplayCache(reopened).read(scope);
    assert.deepEqual(reloaded.data, snapshot());
    assert.equal(reloaded.revision, 1);
    assert.notEqual(reloaded.data, stored.data);
    assert.throws(() => { reloaded.data.sessions[0].transcript[1].paragraphs.push('forged'); }, TypeError);
  } finally { await reopened.close(); }
});

test('exact host/principal keys isolate scopes and exact profile/session pairs remain distinct', async t => {
  const { cache } = await setup(t);
  await cache.replace(scope, null, snapshot());
  assert.equal(await cache.read({ ...scope, principalId: 'another-principal' }), null);
  assert.equal(await cache.read({ ...scope, hostId: 'another-host' }), null);
  assert.notEqual(displayCacheKey({ hostId: 'a:b', principalId: 'c' }), displayCacheKey({ hostId: 'a', principalId: 'b:c' }));
  const input = snapshot();
  input.profiles.push({ ...input.profiles[0], profileId: 'beta' });
  input.sessions.push({ ...input.sessions[0], profileId: 'beta' });
  const result = await cache.replace(scope, 1, input);
  assert.deepEqual(result.data.sessions.map(row => [row.profileId, row.storedSessionId]), [['alpha', 'saved-chat'], ['beta', 'saved-chat']]);
  assert.ok(await cache.read(scope));
});

test('corruption, identity substitution and newer schemas fail closed without overwriting', async t => {
  const { repository, cache } = await setup(t), key = displayCacheKey(scope);
  const current = await cache.replace(scope, null, snapshot());
  const original = (await repository.read(key)).value;
  for (const bad of [{ ...original, version: 2 }, { ...original, hostId: 'forged-host' },
    { ...original, principalId: 'forged-principal' }, { ...original, data: { ...snapshot(), sessions: null } }]) {
    const revision = (await repository.read(key)).revision;
    await repository.write(key, revision, bad);
    await assert.rejects(cache.read(scope));
    await assert.rejects(cache.replace(scope, revision + 1, snapshot()));
    assert.deepEqual((await repository.read(key)).value, bad);
  }
  assert.equal(current.revision, 1);
});

test('runtime, credentials, action, prompt and send fields are rejected at every schema level', async t => {
  const { cache } = await setup(t);
  const alterations = [
    input => { input.token = 'synthetic-token'; },
    input => { input.runtimeId = 'synthetic-runtime'; },
    input => { input.profiles[0].credentials = {}; },
    input => { input.sessions[0].openRequests = []; },
    input => { input.sessions[0].canSend = true; },
    input => { input.sessions[0].transcript[1].delivery = 'unknown'; },
    input => { input.sessions[0].transcript[2].action = 'execute'; },
  ];
  for (const change of alterations) {
    const input = snapshot(); change(input);
    await assert.rejects(cache.replace(scope, null, input));
    assert.equal(await cache.read(scope), null);
  }
});

test('ambiguous identities, unsafe object properties and excessive catalogs are rejected', async t => {
  const { cache } = await setup(t);
  const alterations = [
    input => { input.profiles.push({ ...input.profiles[0] }); },
    input => { input.sessions.push({ ...input.sessions[0] }); },
    input => { input.sessions[0].profileId = 'unlisted'; },
    input => { input.sessions[0].transcript.push({ ...input.sessions[0].transcript[0] }); },
    input => { input.sessions[0].storedSessionId = ' '; },
    input => { input.sessions[0].historyUpdatedAt = NaN; },
    input => { input.profiles = Array.from({ length: 257 }, (_, index) => ({ ...input.profiles[0], profileId: `profile-${index}` })); },
    input => { Object.defineProperty(input, 'hostLabel', { get() { throw Error('Accessor must never run'); }, enumerable: true }); },
  ];
  for (const change of alterations) { const input = snapshot(); change(input); await assert.rejects(cache.replace(scope, null, input), /display cache/i); }
  for (const bad of [{ ...scope, hostId: '' }, { ...scope, principalId: ' principal ' }, { ...scope, runtimeId: 'forged' }]) {
    await assert.rejects(cache.read(bad));
  }
});

test('stale replacements cannot overwrite a newer snapshot', async t => {
  const { cache } = await setup(t);
  await cache.replace(scope, null, snapshot());
  const next = snapshot(); next.sessions[0].title = 'Newer title';
  await cache.replace(scope, 1, next);
  await assert.rejects(cache.replace(scope, 1, snapshot()), /revision/i);
  assert.equal((await cache.read(scope)).data.sessions[0].title, 'Newer title');
});

test('history trimming is deterministic, oldest first, and includes repository envelope bytes', async t => {
  const { cache, repository } = await setup(t);
  const input = snapshot();
  const rows = count => Array.from({ length: count }, (_, index) => ({ kind: 'message', id: `message-${index}`, direction: 'in', paragraphs: ['😀'.repeat(1000)] }));
  input.sessions[0].transcript = rows(400);
  input.sessions.push({ ...input.sessions[0], storedSessionId: 'newer-chat', historyUpdatedAt: 20, transcript: rows(200) });
  const result = await cache.replace(scope, null, input);
  assert.ok(result.data.sessions[0].transcript.length < 400, 'oldest session loses history first');
  assert.equal(result.data.sessions[0].transcript[0].id, `message-${400 - result.data.sessions[0].transcript.length}`);
  assert.equal(result.data.sessions[1].transcript.length, 200, 'newer history retained when it fits');
  const record = await repository.read(displayCacheKey(scope));
  assert.ok(Buffer.byteLength(JSON.stringify({ version: 1, key: displayCacheKey(scope), revision: Number.MAX_SAFE_INTEGER, value: record.value })) <= 1024 * 1024);
  await repository.remove(displayCacheKey(scope), result.revision);
  assert.deepEqual((await cache.replace(scope, null, input)).data, result.data);
});

test('row collection limits keep newest rows and refuse oversized catalog-only snapshots', async t => {
  const { cache } = await setup(t), input = snapshot();
  input.sessions[0].transcript = Array.from({ length: 600 }, (_, index) => ({ kind: 'day', id: `day-${index}`, label: 'Day' }));
  const result = await cache.replace(scope, null, input);
  assert.equal(result.data.sessions[0].transcript.length, 512);
  assert.equal(result.data.sessions[0].transcript[0].id, 'day-88');
  const catalog = snapshot();
  catalog.sessions = Array.from({ length: 256 }, (_, index) => ({ ...catalog.sessions[0], storedSessionId: `saved-${index}`,
    title: '字'.repeat(170), preview: '字'.repeat(682), transcript: [] }));
  // Each field is valid, but escaped newlines increase the catalog's JSON size.
  catalog.sessions.forEach(row => { row.preview = '\n'.repeat(2048); });
  await assert.rejects(cache.replace(scope, result.revision, catalog), /size/i);
  assert.equal((await cache.read(scope)).revision, result.revision);
});

test('aggregate history cap uses stable identity tie breaks without reordering catalog entries', async t => {
  const { cache } = await setup(t), input = snapshot();
  const rows = Array.from({ length: 512 }, (_, index) => ({ kind: 'day', id: `day-${index}`, label: 'Day' }));
  input.sessions = Array.from({ length: 9 }, (_, index) => ({ ...input.sessions[0], storedSessionId: `saved-${8 - index}`, transcript: rows }));
  const result = await cache.replace(scope, null, input);
  assert.equal(result.data.sessions.reduce((count, session) => count + session.transcript.length, 0), 4096);
  assert.equal(result.data.sessions[8].storedSessionId, 'saved-0');
  assert.equal(result.data.sessions[8].transcript.length, 0);
  assert.equal(result.data.sessions[0].storedSessionId, 'saved-8');
  assert.equal(result.data.sessions[0].transcript.length, 512);
});

test('concurrent replacements honor repository CAS without retrying over the winner', async t => {
  const { cache } = await setup(t);
  await cache.replace(scope, null, snapshot());
  const left = snapshot(), right = snapshot();
  left.sessions[0].title = 'Left completion'; right.sessions[0].title = 'Right completion';
  const attempts = await Promise.allSettled([cache.replace(scope, 1, left), cache.replace(scope, 1, right)]);
  const winner = attempts.find(result => result.status === 'fulfilled');
  assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(attempts.filter(result => result.status === 'rejected').length, 1);
  assert.deepEqual(await cache.read(scope), winner.value);
  assert.equal(winner.value.revision, 2);
});

test('pure normalization applies persistence bounds before admission without retaining caller mutations', async t => {
  const { cache } = await setup(t), input = snapshot();
  input.sessions[0].transcript = Array.from({ length: 600 }, (_, index) => ({ kind: 'day', id: `day-${index}`, label: 'Day' }));
  const normalized = normalizeDisplayCache(scope, input);
  assert.equal(normalized.sessions[0].transcript.length, 512);
  assert.equal(normalized.sessions[0].transcript[0].id, 'day-88');
  assert.deepEqual((await cache.replace(scope, null, input)).data, normalized);
  input.sessions[0].transcript.at(-1).label = 'Caller mutation';
  assert.equal(normalized.sessions[0].transcript.at(-1).label, 'Day');
  assert.ok(Object.isFrozen(normalized.sessions[0].transcript));
  assert.throws(() => normalizeDisplayCache(scope, { ...input, runtimeId: 'forbidden' }), /display cache/i);
});
