import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOwner, sameAuthority, sameLease, transitionSend, recoverSend } from '../packages/domain/chat-contract.ts';

const owner = Object.freeze({ hostId: 'host-a', principalId: 'principal-a', profileId: 'default', storedSessionId: 'stored-a', runtimeId: 'runtime-a', authGeneration: 1, connectionGeneration: 1 });
const intent = (phase = 'editing') => ({ id: 'intent-a', owner, phase });

test('owner validation copies and freezes known identity fields', () => {
  const input = { ...owner, displayName: 'Ignored metadata' };
  const result = parseOwner(input);
  input.hostId = 'other';
  assert.deepEqual(result, owner);
  assert.ok(Object.isFrozen(result));
});
for (const field of Object.keys(owner)) {
  test(`rejects invalid ${field}`, () => {
    assert.throws(() => parseOwner({ ...owner, [field]: typeof owner[field] === 'number' ? -1 : '' }));
    assert.equal(sameLease(owner, { ...owner, [field]: typeof owner[field] === 'number' ? 2 : 'other' }), false);
  });
}
test('identity validation rejects malformed Unicode without normalizing valid IDs', () => {
  assert.throws(() => parseOwner({ ...owner, profileId: '\ud800' }));
  assert.equal(parseOwner({ ...owner, profileId: ' Alpha ' }).profileId, ' Alpha ');
  for (const value of [NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => parseOwner({ ...owner, connectionGeneration: value }));
  }
});

test('reconnect retains authority but retires callback lease', () => {
  const next = { ...owner, connectionGeneration: 2, runtimeId: 'runtime-b' };
  assert.equal(sameAuthority(owner, next), true);
  assert.equal(sameLease(owner, next), false);
  assert.equal(sameLease(owner, null), false);
  assert.equal(sameAuthority(owner, { ...owner, principalId: 'other' }), false);
});
test('send requires durable preparation and dispatch authorization', () => {
  assert.throws(() => transitionSend(intent(), { type: 'dispatch' }, owner));
  const prepared = transitionSend(intent(), { type: 'persisted' }, owner);
  assert.equal(prepared.phase, 'prepared');
  const dispatched = transitionSend(prepared, { type: 'dispatch' }, owner);
  assert.equal(dispatched.phase, 'dispatched');
  assert.throws(() => transitionSend(dispatched, { type: 'dispatch' }, owner));
});
test('streaming is accepted and cannot dispatch a second prompt', () => {
  const accepted = transitionSend(intent('dispatched'), { type: 'receipt', status: 'streaming' }, owner);
  assert.equal(accepted.phase, 'accepted');
  assert.throws(() => transitionSend(accepted, { type: 'dispatch' }, owner));
});
test('lost and unrecognized receipts remain unknown with no retry transition', () => {
  for (const event of [{ type: 'receiptLost' }, { type: 'receipt', status: 'surprise' }]) {
    const unknown = transitionSend(intent('dispatched'), event, owner);
    assert.equal(unknown.phase, 'unknown');
    assert.throws(() => transitionSend(unknown, { type: 'dispatch' }, owner));
  }
});
test('a stale callback or absent owner cannot mutate an intent', () => {
  for (const current of [null, { ...owner, connectionGeneration: 2 }, { ...owner, storedSessionId: 'other' }]) {
    assert.throws(() => transitionSend(intent('dispatched'), { type: 'receipt', status: 'streaming' }, current));
  }
});
test('crash recovery never makes an attempted send dispatchable', () => {
  for (const phase of ['dispatched', 'accepted', 'unknown']) {
    const recovered = recoverSend(intent(phase));
    assert.equal(recovered.phase, 'unknown');
    assert.throws(() => transitionSend(recovered, { type: 'dispatch' }, owner));
  }
  assert.equal(recoverSend(intent('prepared')).phase, 'prepared');
});
test('explicit refusal preserves identity and does not automatically retry', () => {
  const rejected = transitionSend(intent('dispatched'), { type: 'refused' }, owner);
  assert.equal(rejected.phase, 'rejected');
  assert.equal(rejected.id, 'intent-a');
  assert.throws(() => transitionSend(rejected, { type: 'dispatch' }, owner));
});
test('terminal signal still requires saved-history reconciliation', () => {
  const terminal = transitionSend(intent('accepted'), { type: 'terminalVerified' }, owner);
  assert.equal(terminal.phase, 'reconciling');
  assert.equal(transitionSend(terminal, { type: 'historyVerified' }, owner).phase, 'complete');
  assert.throws(() => transitionSend(intent('accepted'), { type: 'historyVerified' }, owner));
});
