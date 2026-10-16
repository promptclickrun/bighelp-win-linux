import assert from 'node:assert/strict';
import test from 'node:test';
import { EMPTY_DATA, composerStatus, chatById, agentById } from '../packages/ui/view-model.ts';
import { SAMPLE_DATA } from '../packages/ui/fixtures.ts';

test('view model: without a connected computer the app shows nothing invented', () => {
  assert.equal(EMPTY_DATA.host, null);
  assert.deepEqual(EMPTY_DATA.agents, []);
  assert.deepEqual(EMPTY_DATA.chats, []);
  assert.equal(EMPTY_DATA.sample, false);
});

test('view model: Send is never available in this slice, and the reason is plain', () => {
  assert.deepEqual(composerStatus(EMPTY_DATA), { canSend: false, hint: 'Send waits until a computer is connected.' });
  assert.deepEqual(composerStatus(SAMPLE_DATA), { canSend: false, hint: 'Sample data. Nothing is sent.' });
});

test('fixtures: sample data is labelled, synthetic, and contains no host address', () => {
  assert.equal(SAMPLE_DATA.sample, true);
  assert.equal(SAMPLE_DATA.host?.label, 'Sample computer');
  const text = JSON.stringify(SAMPLE_DATA);
  assert.equal(/https?:|wss?:|\d+\.\d+\.\d+\.\d+|@/u.test(text), false);
  for (const chat of SAMPLE_DATA.chats) assert.ok(agentById(SAMPLE_DATA, chat.agentId), chat.id);
  assert.equal(Object.isFrozen(SAMPLE_DATA.chats), true);
});

test('fixtures: the first sample chat carries the unknown-send state; nothing claims success', () => {
  const first = SAMPLE_DATA.chats[0];
  const last = first.transcript.at(-1);
  assert.equal(last.kind, 'message');
  assert.equal(last.direction, 'out');
  assert.equal(last.delivery, 'unknown');
  assert.equal(SAMPLE_DATA.chats.flatMap(chat => chat.transcript).some(item => item.delivery === 'confirmed'), false);
  assert.equal(chatById(SAMPLE_DATA, 'missing'), null);
});
