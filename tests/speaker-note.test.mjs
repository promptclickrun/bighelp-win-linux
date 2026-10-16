import test from 'node:test';
import assert from 'node:assert/strict';
import { sendSpeakerNote, speakerNoteAllowed, SPEAKER_NOTE_WAIT_MS } from '../apps/desktop/src/main/speaker-note.ts';
import { HttpStatusError } from '../packages/platform/transport-policy.ts';

const etag = `"sha256:${'a'.repeat(64)}"`;
const context = features => ({ body: { schemaVersion: 1, pluginVersion: '3.13.0', runtimeId: 'rt', principal: null, servingProfileId: null,
  features: ['native-context-v1', ...features] }, etag, cacheControl: 'no-store' });
const note = { profile: 'default', storedSessionId: '20261016_1', personId: '1b4e28ba-2fa1-4d3b-a3f5-ef19b5a7633b', name: 'Ada' };

test('the note is a bounded label with strict identifiers', () => {
  assert.equal(speakerNoteAllowed(note), true);
  for (const bad of [{ profile: 'Default' }, { storedSessionId: '../x' }, { personId: 'not-a-uuid' }, { name: '  ' }, { name: 'x'.repeat(401) }]) {
    assert.equal(speakerNoteAllowed({ ...note, ...bad }), false);
  }
});

test('posts the exact plugin request when supported and skips otherwise', async () => {
  const calls = [];
  await sendSpeakerNote(async op => { calls.push(op); return op.kind === 'nativeContext' ? context(['native-people-v1']) : { body: {} }; }, { kind: 'dashboard' }, note);
  assert.equal(calls[1].path, '/api/plugins/loopdy/native/people/speaking');
  assert.equal(calls[1].native.etag, etag);
  assert.deepEqual(JSON.parse(calls[1].body), { agentId: 'default', sessionId: '20261016_1', personId: note.personId, name: 'Ada' });
  const skipped = [];
  await sendSpeakerNote(async op => { skipped.push(op); return context([]); }, { kind: 'dashboard' }, note);
  assert.equal(skipped.length, 1);
});

test('a stale ETag retries once; a hung plugin never holds the send past the limit', async () => {
  let posts = 0;
  await sendSpeakerNote(async op => { if (op.kind === 'nativeContext') return context(['native-people-v1']); posts++; if (posts === 1) throw new HttpStatusError(412); return { body: {} }; }, { kind: 'dashboard' }, note);
  assert.equal(posts, 2);
  const started = Date.now();
  await sendSpeakerNote(() => new Promise(() => {}), { kind: 'dashboard' }, note);
  assert.ok(Date.now() - started < SPEAKER_NOTE_WAIT_MS + 300);
  await sendSpeakerNote(async () => { throw new Error('boom'); }, { kind: 'dashboard' }, note);
});
