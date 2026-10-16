import test from 'node:test';
import assert from 'node:assert/strict';
import { createReconnector, RECONNECT_DELAYS_MS } from '../apps/desktop/src/main/reconnect.ts';
import { createDesktopService } from '../apps/desktop/src/main/desktop-service.ts';

const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(check) { for (let i = 0; i < 200; i++) { if (check()) return; await tick(); } assert.fail('Condition did not settle'); }
// Deterministic timers: nothing fires until the test says so.
function fakeTimers() {
  const pending = new Map(); let next = 0;
  return { pending,
    set(callback, ms) { const id = ++next; pending.set(id, { callback, ms }); return id; },
    clear(id) { pending.delete(id); },
    delays() { return [...pending.values()].map(entry => entry.ms); },
    fire() { const [id, entry] = [...pending.entries()][0] ?? []; assert.ok(entry, 'No timer pending'); pending.delete(id); entry.callback(); } };
}

test('backoff is about 1, 2, 5, 10 and 30 seconds, then every 60 seconds', async () => {
  const timers = fakeTimers(), states = []; let attempts = 0;
  const reconnector = createReconnector({ timers, attempt: async () => { attempts++; return 'retry'; }, onChange: state => states.push(state) });
  reconnector.start();
  const seen = [];
  for (let i = 0; i < 8; i++) { seen.push(...timers.delays()); timers.fire(); await until(() => timers.pending.size === 1); }
  assert.deepEqual(seen, [1000, 2000, 5000, 10000, 30000, 60000, 60000, 60000]);
  assert.deepEqual(RECONNECT_DELAYS_MS, [1000, 2000, 5000, 10000, 30000, 60000]);
  assert.equal(attempts, 8);
  assert.deepEqual(states.slice(0, 3), [{ state: 'waiting', delaySeconds: 1 }, { state: 'trying', delaySeconds: 0 }, { state: 'waiting', delaySeconds: 2 }]);
  reconnector.stop();
  assert.equal(timers.pending.size, 0); assert.equal(reconnector.state.state, 'idle');
});

test('try now acts only while waiting; a sign-in problem stops retrying', async () => {
  const timers = fakeTimers(); let result = 'retry', attempts = 0;
  const reconnector = createReconnector({ timers, attempt: async () => { attempts++; return result; }, onChange() {} });
  assert.equal(reconnector.now(), false); assert.equal(attempts, 0);
  reconnector.start(); assert.equal(reconnector.now(), true);
  await until(() => timers.pending.size === 1); assert.equal(attempts, 1);
  result = 'signIn'; reconnector.now(); await until(() => reconnector.state.state === 'signIn');
  assert.equal(timers.pending.size, 0); assert.equal(reconnector.now(), false);
  // A stopped attempt that finishes late cannot schedule anything.
  let release; const late = createReconnector({ timers, attempt: () => new Promise(resolve => { release = resolve; }), onChange() {} });
  late.start(); timers.fire(); await until(() => release); late.stop(); release('retry'); await tick();
  assert.equal(timers.pending.size, 0); assert.equal(late.state.state, 'idle');
});

const host = { label: 'Synthetic computer', endpoint: 'https://test.invalid', authentication: 'dashboard', token: 'synthetic-private-token', allowPrivateHttp: false };
function fixture() {
  const values = new Map(), calls = [], timers = fakeTimers(); let callbacks, failConnect = false;
  const repository = { async read(key) { return structuredClone(values.get(key) ?? null); },
    async write(key, revision, value) { assert.equal(values.get(key)?.revision ?? null, revision);
      const next = { revision: (revision ?? 0) + 1, value: structuredClone(value) }; values.set(key, next); return next; } };
  const gateway = { exclusiveSubmit: true, close() { calls.push(['close']); }, async requestHttp() { return { body: { ok: true, auth_required: false } }; },
    async operation(op) { calls.push(['operation', op.kind, op.storedSessionId]);
      if (op.kind === 'profilesList') return { profiles: [{ name: 'agent', display_name: 'Agent' }] };
      if (op.kind === 'sessionList') return { sessions: [{ id: 'stored', profile: 'agent', title: 'Saved chat' }] };
      if (op.kind === 'sessionCreate' || op.kind === 'sessionResume') return { session_id: 'runtime', stored_session_id: 'stored', info: { profile_name: 'agent' }, running: false };
      if (op.kind === 'sessionHistory') return { count: 0, messages: [] }; return {}; },
    async submitText(request) { calls.push(['submit', request.params?.text]); return { jsonrpc: '2.0', id: request.id, result: { status: 'streaming' } }; } };
  const service = createDesktopService({ repository, timers, onChange() {},
    connect: async options => { calls.push(['connect']); callbacks = options; if (failConnect) throw Error('Synthetic offline'); return gateway; } });
  return { service, values, calls, timers, gateway, get callbacks() { return callbacks; }, set failConnect(value) { failConnect = value; } };
}
const count = (f, kind) => f.calls.filter(call => call[0] === kind || call[1] === kind).length;

test('an unexpected close reconnects with backoff and reopens the chat without resending', async () => {
  const f = fixture();
  await f.service.handle({ kind: 'connect', host });
  await f.service.handle({ kind: 'openChat', generation: f.service.snapshot().generation, chatId: 'stored' });
  assert.equal((await f.service.handle({ kind: 'send', generation: f.service.snapshot().generation, chatId: 'stored', text: 'Hello once' })).ok, true);
  assert.equal(count(f, 'submit'), 1);
  f.callbacks.onClosed();
  let s = f.service.snapshot();
  assert.equal(s.status, 'disconnected'); assert.deepEqual(s.hosts.reconnect, { state: 'waiting', delaySeconds: 1 });
  assert.equal(s.notice, 'Offline — trying again in 1 s.');
  assert.equal(s.data.chats[0].id, 'stored'); assert.equal(s.selectedChatId, 'stored'); // saved chat stays on screen, read-only
  f.failConnect = true; f.timers.fire();
  await until(() => f.service.snapshot().hosts.reconnect.state === 'waiting');
  s = f.service.snapshot();
  assert.deepEqual(s.hosts.reconnect, { state: 'waiting', delaySeconds: 2 }); assert.equal(s.selectedChatId, 'stored');
  f.failConnect = false; f.timers.fire();
  await until(() => f.service.snapshot().status === 'connected' && f.service.snapshot().selectedChatId === 'stored');
  s = f.service.snapshot();
  assert.equal(s.hosts.reconnect.state, 'idle');
  assert.ok(f.calls.some(call => call[1] === 'sessionResume' && call[2] === 'stored'));
  // The accepted send is still unresolved: it is reported, never replayed.
  assert.equal(count(f, 'submit'), 1);
  assert.equal(s.notice, 'An earlier send may have run. Check saved history before sending again. Nothing was resent.');
  assert.equal(JSON.stringify(s).includes(host.token), false);
  f.service.dispose();
});

test('Disconnect stops reconnecting; wake and network triggers act only while waiting', async () => {
  const f = fixture();
  await f.service.handle({ kind: 'connect', host });
  f.callbacks.onClosed(); assert.equal(f.timers.pending.size, 1);
  const connects = count(f, 'connect');
  f.service.reconnectNow(); // e.g. powerMonitor 'resume'
  await until(() => f.service.snapshot().status === 'connected');
  assert.equal(count(f, 'connect'), connects + 1); assert.equal(f.timers.pending.size, 0);
  f.callbacks.onClosed(); assert.equal(f.timers.pending.size, 1);
  await f.service.handle({ kind: 'disconnect' });
  assert.equal(f.timers.pending.size, 0); assert.equal(f.service.snapshot().hosts.reconnect.state, 'idle');
  f.service.reconnectNow(); await f.service.handle({ kind: 'reconnectNow' }); await tick();
  assert.equal(count(f, 'connect'), connects + 1);
  // "Connect" for the saved computer is the person's explicit choice.
  assert.equal((await f.service.handle({ kind: 'connectSaved' })).ok, true);
  assert.equal(f.service.snapshot().status, 'connected');
  f.service.dispose();
});

test('a failed automatic connect at startup keeps trying; dispose stops it', async () => {
  const f = fixture();
  await f.service.handle({ kind: 'connect', host });
  f.service.dispose();
  const again = createDesktopService({ repository: { read: async key => structuredClone(f.values.get(key) ?? null),
    write: async (key, revision, value) => { const next = { revision: (revision ?? 0) + 1, value }; f.values.set(key, next); return next; } },
    timers: f.timers, onChange() {}, connect: async () => { throw Error('Hermes is not running yet'); } });
  await again.initialize();
  assert.deepEqual(again.snapshot().hosts.reconnect, { state: 'waiting', delaySeconds: 1 });
  assert.equal(again.snapshot().hosts.saved.label, 'Synthetic computer');
  again.dispose(); assert.equal(f.timers.pending.size, 0);
});

test('Disconnect during a connect already in flight never starts automatic retries', async () => {
  for (const start of ['initialize', 'connectSaved']) {
    const f = fixture();
    await f.service.handle({ kind: 'connect', host });
    f.service.dispose();
    // connectSaved: start with the computer saved but not auto-connecting.
    if (start === 'connectSaved') f.values.set('desktop:autoConnect', { revision: f.values.get('desktop:autoConnect').revision + 1, value: false });
    let fail;
    const again = createDesktopService({ repository: { read: async key => structuredClone(f.values.get(key) ?? null),
      write: async (key, revision, value) => { const next = { revision: (revision ?? 0) + 1, value }; f.values.set(key, next); return next; } },
      timers: f.timers, onChange() {}, connect: () => new Promise((_resolve, reject) => { fail = () => reject(Error('Synthetic offline')); }) });
    if (start === 'connectSaved') { await again.initialize(); assert.equal(fail, undefined); }
    const pending = start === 'initialize' ? again.initialize() : again.handle({ kind: 'connectSaved' });
    await until(() => fail);
    await again.handle({ kind: 'disconnect' });
    fail(); await pending; await tick();
    assert.equal(f.timers.pending.size, 0, start); assert.equal(again.snapshot().hosts.reconnect.state, 'idle', start);
    again.dispose();
  }
});
