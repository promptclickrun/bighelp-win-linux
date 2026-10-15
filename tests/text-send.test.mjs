import test from 'node:test';
import assert from 'node:assert/strict';
import { createTextSend, classifyReceipt, recoverTextSend } from '../packages/domain/text-send.ts';

const owner = Object.freeze({ hostId: 'host-a', principalId: 'principal-a', profileId: 'alpha', storedSessionId: 'stored-a', runtimeId: 'runtime-a', authGeneration: 1, connectionGeneration: 1 });
function fixture(overrides = {}) {
  const calls = [];
  let current = owner;
  const adapters = {
    currentOwner: () => current,
    commit: async snapshot => { calls.push(snapshot.phase); },
    submit: async request => { calls.push(request); return { jsonrpc: '2.0', id: 'req-a', result: { status: 'streaming' } }; },
    ...overrides,
  };
  return { calls, changeOwner: value => { current = value; }, send: createTextSend({ id: 'intent-a', requestId: 'req-a', owner, text: 'Hello 👋' }, adapters) };
}
test('writes both barriers before exactly one finite prompt.submit', async () => {
  const f = fixture();
  assert.equal((await f.send()).phase, 'accepted');
  assert.deepEqual(f.calls, ['prepared', 'dispatched', { jsonrpc: '2.0', id: 'req-a', method: 'prompt.submit', params: { session_id: 'runtime-a', profile: 'alpha', text: 'Hello 👋' } }, 'accepted']);
  await assert.rejects(f.send(), /already consumed/);
});
for (const failPhase of ['prepared', 'dispatched']) {
  test(`failure committing ${failPhase} prevents transport`, async () => {
    let dispatched = false;
    const f = fixture({ commit: async s => { if (s.phase === failPhase) throw Error('disk'); }, submit: async () => { dispatched = true; } });
    await assert.rejects(f.send(), /disk/);
    assert.equal(dispatched, false);
    await assert.rejects(f.send(), /already consumed/);
  });
}
test('owner replacement during preparation prevents transport', async () => {
  let dispatched = false;
  const f = fixture({ commit: async () => { f.changeOwner({ ...owner, connectionGeneration: 2 }); }, submit: async () => { dispatched = true; } });
  await assert.rejects(f.send(), /Stale/);
  assert.equal(dispatched, false);
});
test('owner replacement after transport retains unknown for original owner', async () => {
  const f = fixture({ submit: async () => { f.changeOwner({ ...owner, hostId: 'host-b' }); return { jsonrpc: '2.0', id: 'req-a', result: { status: 'streaming' } }; } });
  const result = await f.send();
  assert.equal(result.phase, 'unknown');
  assert.deepEqual(result.owner, owner);
});
test('transport failure is unknown and cannot resend', async () => {
  const f = fixture({ submit: async () => { throw Error('lost'); } });
  assert.equal((await f.send()).phase, 'unknown');
  await assert.rejects(f.send(), /already consumed/);
});
test('receipt commit failure preserves conservative dispatch record', async () => {
  const snapshots = [];
  const f = fixture({ commit: async s => { if (s.phase === 'accepted') throw Error('disk'); snapshots.push(s); } });
  await assert.rejects(f.send(), /disk/);
  assert.equal(snapshots.at(-1).phase, 'dispatched');
  await assert.rejects(f.send(), /already consumed/);
});
test('concurrent calls consume one dispatch permit', async () => {
  const f = fixture();
  const results = await Promise.allSettled([f.send(), f.send()]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(f.calls.filter(c => typeof c === 'object').length, 1);
});
test('request IDs enforce UTF-8 byte boundaries before side effects', async () => {
  for (const id of ['a'.repeat(1024), '👋'.repeat(256)]) {
    let actual;
    await createTextSend({ id: 'local', requestId: id, owner, text: 'x' }, { currentOwner: () => owner, commit: async () => {}, submit: async request => { actual = request.id; } })();
    assert.equal(actual, id);
  }
  for (const id of ['a'.repeat(1025), '👋'.repeat(257)]) {
    assert.throws(() => createTextSend({ id: 'local', requestId: id, owner, text: 'x' }, { currentOwner: () => owner, commit: async () => assert.fail('commit'), submit: async () => assert.fail('submit') }), /request ID/);
  }
});
test('text recovery preserves exact immutable request without replay', async () => {
  const snapshots = [];
  const f = fixture({ commit: async s => { snapshots.push(s); } });
  await f.send();
  const captured = snapshots.find(s => s.phase === 'dispatched');
  const recovered = recoverTextSend(captured);
  assert.equal(recovered.phase, 'unknown');
  assert.deepEqual(recovered.request, captured.request);
  assert.deepEqual(recovered.owner, owner);
  assert.equal(Object.isFrozen(recovered.request.params), true);
  assert.equal(f.calls.length, 1);
});
test('owner replacement at dispatch barrier consumes permit without transport', async () => {
  const phases = [];
  const f = fixture({ commit: async s => { phases.push(s.phase); if (s.phase === 'dispatched') f.changeOwner(null); } });
  await assert.rejects(f.send(), /Stale/);
  assert.deepEqual(phases, ['prepared', 'dispatched']);
  assert.equal(f.calls.length, 0);
  await assert.rejects(f.send(), /already consumed/);
});
test('transport waits for both unresolved durable barriers', async () => {
  const first = Promise.withResolvers();
  const second = Promise.withResolvers();
  const enteredSecond = Promise.withResolvers();
  const f = fixture({ commit: s => {
    if (s.phase === 'prepared') return first.promise;
    if (s.phase === 'dispatched') { enteredSecond.resolve(); return second.promise; }
    return Promise.resolve();
  } });
  const result = f.send();
  assert.equal(f.calls.length, 0);
  first.resolve();
  await enteredSecond.promise;
  assert.equal(f.calls.length, 0);
  second.resolve();
  await result;
  assert.equal(f.calls.length, 1);
});
test('receipt classification requires exact correlation and unambiguous result', () => {
  const valid = { jsonrpc: '2.0', id: 'req-a', result: { status: 'streaming', display: 'extra' } };
  assert.equal(classifyReceipt(valid, 'req-a'), 'streaming');
  for (const value of [null, [], {}, { ...valid, id: 'other' }, { ...valid, error: {} }, { ...valid, jsonrpc: '1.0' }, { ...valid, result: { status: 'future' } }]) {
    assert.equal(classifyReceipt(value, 'req-a'), 'unknown');
  }
});
