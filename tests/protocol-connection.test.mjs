import test from 'node:test';
import assert from 'node:assert/strict';
import { createConnectionRegistry, CONNECTION_LIMITS } from '../packages/hermes-client/connection.ts';
import { createTextSend } from '../packages/domain/text-send.ts';

const baseOwner = Object.freeze({ hostId: 'host-fixture', principalId: 'dashboard-fixture', profileId: 'default',
  storedSessionId: 'stored-fixture', runtimeId: 'runtime-fixture', authGeneration: 1, connectionGeneration: 1 });
const tick = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const failure = kind => error => error?.kind === kind;
const event = (type, payload = {}, extra = {}) => ({ jsonrpc: '2.0', method: 'event', params: { type, payload, ...extra } });
const textRequest = (id = 'send-1', owner = baseOwner) => ({ jsonrpc: '2.0', id, method: 'prompt.submit',
  params: { session_id: owner.runtimeId, profile: owner.profileId, text: 'Synthetic hello', queued: true } });
// This intentionally does not claim a valid approval/clarification answer shape.
// Registered synthetic handlers either defer or explicitly refuse the method.
const refusal = async () => ({ error: { code: -32601, message: 'Synthetic handler has no prompt UI' } });

function fixture(handlers = { clarify: refusal }) {
  let owner = { ...baseOwner };
  let nextTimer = 0;
  const timers = new Map();
  const events = [];
  const registry = createConnectionRegistry({ currentOwner: () => owner,
    deadline(milliseconds, callback) {
      const id = ++nextTimer;
      timers.set(id, { milliseconds, callback: () => { timers.delete(id); callback(); } });
      return () => timers.delete(id);
    },
    onEvent: (frame, lease) => events.push({ frame, lease }),
  });
  const sockets = [];
  function connect(customHandlers = handlers, options = {}) {
    const socket = { sent: [], closeCount: 0, callbacks: null,
      start(callbacks) { this.callbacks = callbacks; options.start?.(socket); },
      send(text) { this.sent.push(JSON.parse(text)); options.send?.(socket, text); },
      close() { this.closeCount++; options.close?.(socket); },
      frame(value) { this.callbacks.frame(typeof value === 'string' ? value : JSON.stringify(value)); },
      result(request, value = {}) { this.frame({ jsonrpc: '2.0', id: request.id, result: value }); },
      error(request, code = -32601) { this.frame({ jsonrpc: '2.0', id: request.id, error: { code, message: 'Synthetic refusal' } }); },
    };
    sockets.push(socket);
    const lease = registry.connect(owner, socket, customHandlers);
    return { socket, lease };
  }
  async function ready(connection, exclusive = true) {
    const { socket, lease } = connection;
    socket.frame(event('gateway.ready'));
    if (socket.sent.at(-1)?.method === 'client.capabilities') {
      socket.result(socket.sent.at(-1)); await tick();
    }
    assert.equal(socket.sent.at(-1)?.method, 'gateway.capabilities');
    socket.result(socket.sent.at(-1), { per_session_exclusive_submit: exclusive, future_metadata: {} });
    await tick();
    assert.equal(registry.snapshot(lease).phase, 'ready');
  }
  return { registry, timers, events, sockets, connect, ready,
    setOwner(value) { owner = value; },
    reconnectOwner() { owner = { ...owner, connectionGeneration: owner.connectionGeneration + 1 }; return owner; },
  };
}

test('gateway readiness precedes capability advertisement and does not grant send admission', async () => {
  const f = fixture(); const c = f.connect();
  assert.equal(c.socket.sent.length, 0);
  assert.equal(f.registry.snapshot(c.lease).phase, 'opening');
  await assert.rejects(f.registry.submitText(c.lease, textRequest()), failure('not-ready'));
  c.socket.frame(event('gateway.ready'));
  assert.deepEqual(c.socket.sent[0].params, { server_requests: true });
  assert.equal(c.socket.sent[0].method, 'client.capabilities');
  assert.equal(f.registry.snapshot(c.lease).phase, 'negotiating');
  c.socket.result(c.socket.sent[0]); await tick();
  assert.equal(c.socket.sent[1].method, 'gateway.capabilities');
  c.socket.result(c.socket.sent[1], { per_session_exclusive_submit: true }); await tick();
  await assert.rejects(f.registry.submitText(c.lease, textRequest()), failure('not-ready'));
  f.registry.markReconciled(c.lease);
  const sent = f.registry.submitText(c.lease, textRequest());
  c.socket.result(c.socket.sent.at(-1), { status: 'streaming' });
  assert.equal((await sent).result.status, 'streaming');
  f.registry.disconnect(c.lease); assert.equal(f.timers.size, 0);
});

test('handlers exist before synchronous frames or advertisement on every socket', async () => {
  const calls = [];
  const f = fixture({ clarify: async (request, context) => { calls.push({ request, context }); return refusal(); } });
  const c = f.connect(undefined, { start(socket) {
    socket.frame({ jsonrpc: '2.0', id: 'early', method: 'clarify', params: {} });
  } });
  await tick();
  assert.equal(calls.length, 1);
  assert.equal(c.socket.sent.length, 0); // Responses cannot precede gateway.ready.
  await f.ready(c);
  assert.equal(c.socket.sent[0].id, 'early');
  assert.equal(c.socket.sent[0].error.code, -32601);
  assert.equal(c.socket.sent[1].method, 'client.capabilities');
  f.reconnectOwner();
  const next = f.connect(); await f.ready(next);
  assert.equal(next.socket.sent[0].method, 'client.capabilities');
  assert.equal(calls[0].context.signal.aborted, false); // Completed before disconnect.
  f.registry.disconnect(next.lease);
});

test('no registered handlers means no advertisement and no prompt admission, but reads remain usable', async () => {
  const f = fixture({}); const c = f.connect(); await f.ready(c);
  assert.deepEqual(c.socket.sent.map(frame => frame.method), ['gateway.capabilities']);
  f.registry.markReconciled(c.lease);
  await assert.rejects(f.registry.submitText(c.lease, textRequest()), failure('not-ready'));
  const ping = f.registry.ping(c.lease); c.socket.result(c.socket.sent.at(-1)); await ping;
  f.registry.disconnect(c.lease);
});

test('missing exclusive submit capability blocks writes without suppressing ping', async () => {
  const f = fixture(); const c = f.connect(); await f.ready(c, false); f.registry.markReconciled(c.lease);
  await assert.rejects(f.registry.submitText(c.lease, textRequest()), failure('not-ready'));
  const ping = f.registry.ping(c.lease); c.socket.result(c.socket.sent.at(-1)); await ping;
  f.registry.disconnect(c.lease);
});

test('capability errors cannot be mistaken for compatibility or boolean support', async () => {
  for (const code of [-32601, 403]) {
    const f = fixture(); const c = f.connect(); c.socket.frame(event('gateway.ready'));
    c.socket.error(c.socket.sent[0], code); await tick();
    if (code === -32601) {
      c.socket.result(c.socket.sent.at(-1), { per_session_exclusive_submit: true }); await tick();
      assert.equal(f.registry.snapshot(c.lease).serverRequests, 'unsupported');
      f.registry.markReconciled(c.lease);
      await assert.rejects(f.registry.submitText(c.lease, textRequest()), failure('not-ready'));
      f.registry.disconnect(c.lease);
    } else assert.equal(c.socket.closeCount, 1);
  }
  const f = fixture(); const c = f.connect(); c.socket.frame(event('gateway.ready'));
  c.socket.result(c.socket.sent[0]); await tick();
  c.socket.result(c.socket.sent[1], { per_session_exclusive_submit: 'true' }); await tick();
  assert.equal(c.socket.closeCount, 1);
});

test('responses correlate exact IDs and out-of-order completion, not latest pending request', async () => {
  const f = fixture(); const c = f.connect(); await f.ready(c);
  const a = f.registry.ping(c.lease); const first = c.socket.sent.at(-1);
  const b = f.registry.ping(c.lease); const second = c.socket.sent.at(-1);
  c.socket.result({ id: 'unknown' }, { wrong: true });
  assert.equal(f.registry.snapshot(c.lease).pending, 2);
  c.socket.result(second, { order: 2 }); c.socket.result(first, { order: 1 });
  assert.equal((await a).result.order, 1); assert.equal((await b).result.order, 2);
  f.registry.markReconciled(c.lease);
  const sent = f.registry.submitText(c.lease, textRequest('exact')); c.socket.result({ id: 'exact' }, { status: 'streaming' }); await sent;
  await assert.rejects(f.registry.submitText(c.lease, textRequest('exact')), failure('capacity'));
  f.registry.disconnect(c.lease);
});

test('disconnect retires pending writes as unknown and never replays them on reconnect', async () => {
  const f = fixture(); const c = f.connect(); await f.ready(c); f.registry.markReconciled(c.lease);
  const mutation = f.registry.submitText(c.lease, textRequest());
  const unknown = assert.rejects(mutation, failure('outcome-unknown'));
  const read = f.registry.ping(c.lease); const unavailable = assert.rejects(read, failure('transport-unavailable'));
  c.socket.callbacks.closed(); await unknown; await unavailable;
  assert.equal(f.timers.size, 0);
  f.reconnectOwner(); const replacement = f.connect(); await f.ready(replacement);
  assert.deepEqual(replacement.socket.sent.map(frame => frame.method), ['client.capabilities', 'gateway.capabilities']);
  assert.equal(f.registry.snapshot(replacement.lease).reconciled, false);
  c.socket.result({ id: 'send-1' }, { status: 'streaming' }); c.socket.callbacks.closed();
  c.socket.frame(event('gateway.ready'));
  assert.equal(replacement.socket.closeCount, 0);
  assert.equal(f.registry.snapshot(replacement.lease).pending, 0);
  f.registry.disconnect(replacement.lease);
});

test('late handler completion and exact cancellation cannot answer on a replacement socket', async () => {
  const deferredReplies = []; const signals = [];
  const f = fixture({ clarify: async (request, context) => {
    const reply = deferred(); deferredReplies.push(reply); signals.push(context.signal); return reply.promise;
  } });
  const c = f.connect(); await f.ready(c);
  c.socket.frame({ jsonrpc: '2.0', id: 'ask', method: 'clarify', params: {} });
  c.socket.frame(event('request.cancel', { id: 'ask', method: 'approval', reason: 'different method' }));
  assert.equal(signals[0].aborted, false);
  c.socket.frame(event('request.cancel', { id: 'ask', method: 'clarify', reason: 'expired' }));
  assert.equal(signals[0].aborted, true);
  deferredReplies[0].resolve(await refusal()); await tick();
  assert.equal(c.socket.sent.filter(frame => frame.id === 'ask').length, 0);
  c.socket.frame({ jsonrpc: '2.0', id: 'ask', method: 'clarify', params: {} });
  assert.equal(deferredReplies.length, 1); // Cancellation tombstone prevents another decision.
  c.socket.frame({ jsonrpc: '2.0', id: 'late', method: 'clarify', params: {} });
  f.reconnectOwner(); const next = f.connect(); await f.ready(next);
  assert.equal(signals[1].aborted, true);
  deferredReplies[1].resolve(await refusal()); await tick();
  assert.equal(next.socket.sent.some(frame => frame.id === 'late'), false);
  f.registry.disconnect(next.lease);
});

test('response and server-request ID namespaces are separate; duplicate decisions are suppressed', async () => {
  let calls = 0;
  const f = fixture({ clarify: async () => { calls++; return refusal(); } });
  const c = f.connect(); await f.ready(c);
  const ping = f.registry.ping(c.lease); const request = c.socket.sent.at(-1);
  const server = { jsonrpc: '2.0', id: request.id, method: 'clarify', params: {} };
  c.socket.frame(server); c.socket.frame(server); await tick();
  assert.equal(calls, 1); assert.equal(f.registry.snapshot(c.lease).pending, 1);
  c.socket.result(request, { pong: true }); assert.equal((await ping).result.pong, true);
  c.socket.frame(server); assert.equal(calls, 1);
  f.registry.disconnect(c.lease);
});

test('bounded pending registry rejects excess before dispatch, then cancels all deadlines', async () => {
  const f = fixture(); const c = f.connect(); await f.ready(c);
  const pending = Array.from({ length: CONNECTION_LIMITS.pending }, () => {
    const request = f.registry.ping(c.lease);
    return assert.rejects(request, failure('transport-unavailable'));
  });
  const count = c.socket.sent.length;
  await assert.rejects(f.registry.ping(c.lease), failure('capacity'));
  assert.equal(c.socket.sent.length, count);
  f.registry.disconnect(c.lease); await Promise.all(pending); assert.equal(f.timers.size, 0);
});

test('server capacity overflow retires the connection instead of dropping required interaction', async () => {
  const wait = deferred(); const signals = [];
  const f = fixture({ clarify: async (request, context) => { signals.push(context.signal); return wait.promise; } });
  const c = f.connect(); await f.ready(c);
  for (let i = 0; i <= CONNECTION_LIMITS.serverRequests; i++) {
    c.socket.frame({ jsonrpc: '2.0', id: `q-${i}`, method: 'clarify', params: {} });
  }
  assert.equal(c.socket.closeCount, 1); assert.equal(signals.length, CONNECTION_LIMITS.serverRequests);
  assert.ok(signals.every(signal => signal.aborted));
  wait.resolve(await refusal()); await tick();
  assert.equal(c.socket.sent.filter(frame => 'error' in frame).length, 0);
});

test('unknown server methods receive exact-ID -32601 only after readiness', async () => {
  const f = fixture(); const c = f.connect();
  c.socket.frame({ jsonrpc: '2.0', id: 'e\u0301', method: 'future.method', params: null });
  assert.equal(c.socket.sent.length, 0);
  await f.ready(c);
  assert.equal(c.socket.sent[0].id, 'e\u0301'); assert.equal(c.socket.sent[0].error.code, -32601);
  f.registry.disconnect(c.lease);
});

test('timeout preserves mutation uncertainty and readiness/negotiation timeouts retire their socket', async () => {
  const f = fixture(); const opening = f.connect();
  [...f.timers.values()][0].callback(); assert.equal(opening.socket.closeCount, 1);
  const c = f.connect(); c.socket.frame(event('gateway.ready'));
  [...f.timers.values()][0].callback(); await tick(); assert.equal(c.socket.closeCount, 1);
  const next = f.connect(); await f.ready(next); f.registry.markReconciled(next.lease);
  const mutation = f.registry.submitText(next.lease, textRequest());
  const unknown = assert.rejects(mutation, failure('outcome-unknown'));
  [...f.timers.values()][0].callback(); await unknown;
  assert.equal(f.registry.snapshot(next.lease).reconciled, false);
  await assert.rejects(f.registry.submitText(next.lease, textRequest('next-send')), failure('not-ready'));
  next.socket.result({ id: 'send-1' }, { status: 'streaming' });
  assert.equal(f.registry.snapshot(next.lease).pending, 0);
  f.registry.disconnect(next.lease);
});

test('owner changes fence callbacks and accepted-but-unpublished replies', async () => {
  for (const field of ['hostId', 'principalId', 'profileId', 'storedSessionId', 'runtimeId', 'authGeneration', 'connectionGeneration']) {
    const f = fixture(); const c = f.connect(); await f.ready(c); f.registry.markReconciled(c.lease);
    const mutation = f.registry.submitText(c.lease, textRequest());
    const unknown = assert.rejects(mutation, failure('outcome-unknown'));
    c.socket.result({ id: 'send-1' }, { status: 'streaming' });
    f.setOwner({ ...baseOwner, [field]: typeof baseOwner[field] === 'number' ? 2 : 'other' });
    await unknown; assert.equal(c.socket.closeCount, 1);
    const count = f.events.length; c.socket.frame(event('message.delta')); assert.equal(f.events.length, count);
  }
});

test('whole-frame validation is atomic; duplicate ready and malformed frames close safely', async () => {
  const f = fixture(); const c = f.connect();
  c.socket.frame(`${JSON.stringify(event('gateway.ready'))}\n{"jsonrpc":"2.0","id":"x","id":"y","result":{}}`);
  assert.equal(c.socket.sent.length, 0); assert.equal(f.events.length, 0); assert.equal(c.socket.closeCount, 1);
  const next = f.connect(); await f.ready(next);
  next.socket.frame(event('gateway.ready')); assert.equal(next.socket.closeCount, 1);
});

test('transport exceptions cannot imply safe mutation replay', async () => {
  const f = fixture(); const c = f.connect(undefined, { send(socket) {
    if (socket.sent.at(-1).method === 'prompt.submit') throw new Error('Synthetic enqueue uncertainty');
  } });
  await f.ready(c); f.registry.markReconciled(c.lease);
  await assert.rejects(f.registry.submitText(c.lease, textRequest()), failure('outcome-unknown'));
  assert.equal(c.socket.closeCount, 1); assert.equal(f.timers.size, 0);
});

test('existing durable text sender consumes a contract-correct streaming receipt through the registry', async () => {
  const f = fixture(); const c = f.connect(); await f.ready(c); f.registry.markReconciled(c.lease);
  const phases = [];
  const send = createTextSend({ id: 'intent-1', requestId: 'submit-1', owner: baseOwner, text: 'Synthetic hello' }, {
    currentOwner: () => baseOwner,
    commit: async snapshot => { phases.push(snapshot.phase); },
    submit: request => f.registry.submitText(c.lease, request),
  });
  const result = send(); await tick();
  assert.deepEqual(phases, ['prepared', 'dispatched']);
  c.socket.result(c.socket.sent.at(-1), { status: 'streaming' });
  assert.equal((await result).phase, 'accepted');
  assert.deepEqual(phases, ['prepared', 'dispatched', 'accepted']);
  f.registry.disconnect(c.lease);
});

test('foreign session traffic never becomes a current-owner event or prompt decision', async () => {
  let calls = 0;
  const f = fixture({ clarify: async () => { calls++; return refusal(); } });
  const c = f.connect(); await f.ready(c);
  const count = f.events.length;
  c.socket.frame(event('message.delta', {}, { session_id: 'other-runtime' }));
  c.socket.frame(event('session.reclaimed', {}, { session_id: 'other-runtime' }));
  assert.equal(f.events.length, count); assert.equal(c.socket.closeCount, 0);
  c.socket.frame({ jsonrpc: '2.0', id: 'foreign', method: 'clarify', params: { session_id: 'other-runtime' } });
  await tick(); assert.equal(calls, 0); assert.equal(c.socket.closeCount, 1);
});

test('reclaim retires current prompt ownership and dispatched writes', async () => {
  const f = fixture(); const c = f.connect(); await f.ready(c); f.registry.markReconciled(c.lease);
  const sent = assert.rejects(f.registry.submitText(c.lease, textRequest()), failure('outcome-unknown'));
  c.socket.frame(event('session.reclaimed', {}, { session_id: baseOwner.runtimeId }));
  await sent; assert.equal(c.socket.closeCount, 1);
  assert.throws(() => f.registry.markReconciled(c.lease), failure('owner-changed'));
});

test('throwing handlers and invalid answers fail closed, never send synthetic successful answers', async () => {
  for (const handler of [
    async () => { throw new Error('Synthetic handler failure'); },
    async () => ({ id: 'forged', result: {} }),
  ]) {
    const f = fixture({ clarify: handler }); const c = f.connect(); await f.ready(c);
    c.socket.frame({ jsonrpc: '2.0', id: 'original', method: 'clarify', params: {} });
    await tick(); assert.equal(c.socket.closeCount, 1);
    assert.equal(c.socket.sent.some(frame => 'result' in frame || 'error' in frame), false);
  }
});

test('retired timeout callbacks cannot close a replacement connection', async () => {
  const f = fixture(); const first = f.connect();
  const oldDeadline = [...f.timers.values()][0].callback;
  f.reconnectOwner(); const second = f.connect(); await f.ready(second);
  oldDeadline(); assert.equal(second.socket.closeCount, 0);
  assert.equal(first.socket.closeCount, 1); assert.equal(f.registry.snapshot(second.lease).phase, 'ready');
  f.registry.disconnect(second.lease);
});

test('identity tombstones are bounded without allowing reused IDs to consume late receipts', async () => {
  const f = fixture(); const c = f.connect(); await f.ready(c);
  // Negotiation consumed two outbound IDs. This is a local per-socket budget,
  // not a claim that Hermes imposes a lifetime request-count limit.
  for (let i = 2; i < CONNECTION_LIMITS.identitiesPerSocket; i++) {
    const pending = f.registry.ping(c.lease);
    c.socket.result(c.socket.sent.at(-1)); await pending;
  }
  const count = c.socket.sent.length;
  await assert.rejects(f.registry.ping(c.lease), failure('capacity'));
  assert.equal(c.socket.sent.length, count); assert.equal(f.registry.snapshot(c.lease).pending, 0);
  f.registry.disconnect(c.lease);
});
