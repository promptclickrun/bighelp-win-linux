import test from 'node:test';
import assert from 'node:assert/strict';
import { createDesktopService } from '../apps/desktop/src/main/desktop-service.ts';
import { GatewayOperationError } from '../packages/hermes-client/gateway.ts';
import { EMPTY_LIVE, reduceLive, LIVE_CUT_NOTE, LIVE_LIMITS } from '../packages/domain/live-turn.ts';
import { callFailure } from '../apps/desktop/src/main/calls/context.ts';
import { HttpStatusError } from '../packages/platform/transport-policy.ts';

const tick = () => new Promise(resolve => setImmediate(resolve));
function setup(overrides = {}) {
  const values = new Map(), calls = [];
  const repository = { async read(key) { return values.get(key) ?? null; },
    async write(key, revision, value) { const next = { revision: (revision ?? 0) + 1, value: structuredClone(value) }; values.set(key, next); return next; } };
  let callbacks;
  const gateway = { exclusiveSubmit: true, close() {}, restoreRequests() {},
    async requestHttp(op) { if (op.kind === 'route') throw new Error('no REST'); return { body: { ok: true, auth_required: false } }; },
    async operation(op) { calls.push(['op', op.kind]);
      if (op.kind === 'profilesList') return { profiles: [{ name: 'agent' }] }; if (op.kind === 'sessionList') return { sessions: [] };
      if (op.kind === 'sessionCreate') return { session_id: 'runtime', stored_session_id: 'stored', info: { profile_name: 'agent' }, running: false };
      if (op.kind === 'sessionHistory') return overrides.history ? overrides.history() : { count: 0, messages: [] };
      if (op.kind === 'sessionInterrupt') return overrides.interrupt ? overrides.interrupt() : { status: 'interrupted' };
      return {}; },
    async call(method, params) { calls.push(['call', method, params]); return overrides.call ? overrides.call(method, params) : {}; },
    async submitText(request) { calls.push(['submit', request.params.text]); return { jsonrpc: '2.0', id: request.id, result: { status: 'streaming' } }; } };
  const service = createDesktopService({ repository, onChange() {}, pickFiles: async () => overrides.files ?? [],
    connect: async options => { callbacks = options; return gateway; } });
  return { service, calls, values, gateway, get callbacks() { return callbacks; } };
}
const host = { label: 'T', endpoint: 'https://t.invalid', authentication: 'dashboard', token: 'x', allowPrivateHttp: false };
async function opened(f) {
  await f.service.handle({ kind: 'connect', host });
  await f.service.handle({ kind: 'newChat', generation: f.service.snapshot().generation, profile: 'agent' });
  return f.service.snapshot();
}
const event = (f, type, payload = {}) => f.callbacks.onEvent({ kind: 'event', params: { type, session_id: 'runtime', payload } });

test('a /command sent while a reply runs is refused and never steered in as words', async () => {
  const f = setup(); const s = await opened(f);
  event(f, 'message.start');
  const result = await f.service.handle({ kind: 'send', generation: s.generation, chatId: 'stored', text: '/compress' });
  assert.equal(result.ok, false); assert.match(result.message, /Commands run when the current reply finishes/u);
  assert.equal(f.calls.some(call => call[1] === 'session.steer' || call[0] === 'submit' || call[1] === 'sessionInterrupt'), false);
});

test('a follow-up turn starting before the history read does not leave sending disabled', async () => {
  let release; const f = setup({ history: () => new Promise(resolve => { release = () => resolve({ count: 0, messages: [] }); }) });
  await f.service.handle({ kind: 'connect', host });
  const opening = f.service.handle({ kind: 'newChat', generation: f.service.snapshot().generation, profile: 'agent' });
  while (!release) await tick(); release(); await opening; release = undefined;
  event(f, 'message.start'); event(f, 'session.info', { running: false });
  while (!release) await tick();
  event(f, 'message.start'); // Hermes immediately starts a queued follow-up turn
  release(); await tick(); await tick();
  assert.equal(f.service.snapshot().running, true);
  assert.equal(f.service.snapshot().canSend, true, 'busy sends stay available during the follow-up turn');
});

test('interrupt-and-send holds the send slot: two quick sends submit once', async () => {
  let stop; const f = setup({ interrupt: () => new Promise(resolve => { stop = () => resolve({ status: 'interrupted' }); }) });
  const s = await opened(f);
  await f.service.handle({ kind: 'preferences', changes: { busyMode: 'interrupt' } });
  event(f, 'message.start');
  const first = f.service.handle({ kind: 'send', generation: s.generation, chatId: 'stored', text: 'Again' });
  while (!stop) await tick();
  const second = await f.service.handle({ kind: 'send', generation: s.generation, chatId: 'stored', text: 'Again' });
  assert.equal(second.ok, false);
  stop(); await first;
  assert.equal(f.calls.filter(call => call[0] === 'submit').length, 1);
});

test('an upload abandoned mid-way (disconnect) takes back queued photos and its record', async () => {
  let switchChat; const f = setup({ files: [{ name: 'a.png', bytes: new Uint8Array([1, 2]) }],
    call: (method) => { if (method === 'image.attach_bytes') { switchChat?.(); return { attached: true, path: '/h/images/a.png' }; } return {}; } });
  const s = await opened(f);
  await f.service.handle({ kind: 'attach', generation: s.generation, chatId: 'stored' });
  switchChat = () => { void f.service.handle({ kind: 'disconnect' }); };
  await f.service.handle({ kind: 'send', generation: s.generation, chatId: 'stored', text: 'Look' });
  await tick(); await tick();
  assert.equal(f.calls.some(call => call[0] === 'submit'), false);
  assert.deepEqual(f.calls.find(call => call[1] === 'image.detach')?.[2], { session_id: 'runtime', path: '/h/images/a.png' });
  const journal = [...f.values.entries()].find(([key]) => key.startsWith('journal:'))?.[1].value.intents ?? [];
  assert.equal(journal.some(intent => intent.phase === 'prepared'), false, 'a definitely unsent intent leaves no warning behind');
});

test('a picked command with a trailing space clears its saved draft', async () => {
  const f = setup({ call: () => ({ output: 'ok' }) }); const s = await opened(f);
  await f.service.handle({ kind: 'draft', generation: s.generation, chatId: 'stored', text: '/help ' });
  await f.service.handle({ kind: 'send', generation: s.generation, chatId: 'stored', text: '/help ' });
  const draft = [...f.values.entries()].find(([key]) => key.startsWith('draft:'))?.[1].value;
  assert.equal(draft, '');
});

test('streaming stays O(1) per update and says when the live view stops growing', () => {
  let state = reduceLive(EMPTY_LIVE, 'message.start', {}, 0);
  const chunk = 'x'.repeat(5000);
  const started = performance.now();
  for (let index = 0; index < 120; index++) state = reduceLive(state, 'message.delta', { text: chunk }, index);
  assert.ok(performance.now() - started < 1500);
  const text = state.items[0].paragraphs[0];
  assert.ok(text.endsWith(LIVE_CUT_NOTE)); assert.equal(text.length, LIVE_LIMITS.characters + LIVE_CUT_NOTE.length);
});

test('a bare FastAPI Not Found reads as an older host', () => {
  assert.match(callFailure(new HttpStatusError(404, 'Not Found'), false).message, /newer version/u);
  assert.equal(callFailure(new HttpStatusError(404, 'That task no longer exists.'), false).message, 'That task no longer exists.');
  assert.equal(callFailure(new GatewayOperationError(-32601), false).code, 'unsupported');
});

test('older saved messages load 500 at a time and pair across pages', async () => {
  const rows = Array.from({ length: 700 }, (_, index) => ({ id: index + 1, role: index % 2 ? 'assistant' : 'user', content: `m${index + 1}` }));
  const f = setup();
  const requests = [];
  f.gateway.requestHttp = async op => {
    if (op.kind !== 'route') return { body: { ok: true, auth_required: false } };
    if (!op.path.endsWith('/messages')) throw new Error('not this route');
    requests.push(op.query.offset);
    const offset = Number(op.query.offset), newestFirst = [...rows].reverse().slice(offset, offset + 500);
    return { body: { messages: newestFirst.reverse(), pagination: { order: 'latest', limit: 500, offset } } };
  };
  const s = await opened(f);
  let snapshot = f.service.snapshot();
  assert.equal(snapshot.earlier, true);
  assert.equal(snapshot.data.chats.find(chat => chat.id === 'stored').transcript.filter(item => item.kind === 'message').length, 500);
  await f.service.handle({ kind: 'loadEarlier', generation: s.generation, chatId: 'stored' });
  snapshot = f.service.snapshot();
  const messages = snapshot.data.chats.find(chat => chat.id === 'stored').transcript.filter(item => item.kind === 'message');
  assert.equal(messages.length, 700); assert.equal(messages[0].paragraphs[0], 'm1');
  assert.equal(snapshot.earlier, false);
  assert.deepEqual(requests, ['0', '0', '500']);
});
