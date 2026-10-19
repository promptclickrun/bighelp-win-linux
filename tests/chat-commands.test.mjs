import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeCommands, decodeModels } from '../apps/desktop/src/main/calls/chat.ts';
import { CHAT_CALLS } from '../apps/desktop/src/shared/calls/chat.ts';
import { createDesktopService } from '../apps/desktop/src/main/desktop-service.ts';
import { GatewayOperationError } from '../packages/hermes-client/gateway.ts';

test('the command menu shows desktop commands and skills only', () => {
  const commands = decodeCommands({ pairs: [['/help', 'Show commands'], ['/model', 'Change model'], ['/review', 'Review changes'], ['bad', 'x'],
    ['/quit', 'Exit the terminal'], ['/help', 'dup']], commands: { '/model': { desktop: 'hidden' }, '/quit': { desktop: 'terminal' }, '/help': { desktop: null } },
  skills: { '/review': { usage: 1 } } });
  assert.deepEqual(commands.map(command => [command.name, command.kind]), [['/review', 'skill'], ['/help', 'command']]);
  assert.throws(() => decodeCommands({ pairs: 'nope' }));
});

test('model lists drop unavailable models and keep reasoning support', () => {
  const models = decodeModels({ model: 'gemma4:e2b', provider: 'custom', providers: [
    { slug: 'custom', name: 'Local', is_current: true, models: ['gemma4:e2b', 'gone', 'bad model'], unavailable_models: ['gone'],
      capabilities: { 'gemma4:e2b': { reasoning: true } } },
    { slug: 'bad slug!', models: ['x'] }, { slug: 'empty', models: [] }] });
  assert.deepEqual(models, { current: { model: 'gemma4:e2b', provider: 'custom' },
    providers: [{ slug: 'custom', name: 'Local', current: true, models: ['gemma4:e2b'], reasoning: ['gemma4:e2b'] }] });
});

test('model and reasoning inputs refuse flags and unknown levels', () => {
  assert.throws(() => CHAT_CALLS['chat.setModel'].parse({ chatId: 'a', model: 'x --global', provider: 'p' }));
  assert.throws(() => CHAT_CALLS['chat.setModel'].parse({ chatId: 'a', model: '-x', provider: 'p' }));
  assert.throws(() => CHAT_CALLS['chat.setModel'].parse({ chatId: 'a', model: 'x', provider: 'p q' }));
  assert.throws(() => CHAT_CALLS['chat.setReasoning'].parse({ chatId: 'a', level: 'show' }));
  assert.deepEqual(CHAT_CALLS['chat.setModel'].parse({ chatId: 'a', model: 'm', provider: 'p' }), { chatId: 'a', model: 'm', provider: 'p', confirmExpensive: false });
});

function setup(callImpl) {
  const values = new Map(), calls = [];
  const repository = { async read(key) { return values.get(key) ?? null; },
    async write(key, revision, value) { const next = { revision: (revision ?? 0) + 1, value: structuredClone(value) }; values.set(key, next); return next; } };
  const gateway = { exclusiveSubmit: true, close() {}, restoreRequests() {},
    async requestHttp(op) { if (op.kind === 'route') throw new Error('no REST'); return { body: { ok: true, auth_required: false } }; },
    async operation(op) {
      if (op.kind === 'profilesList') return { profiles: [{ name: 'agent' }] }; if (op.kind === 'sessionList') return { sessions: [] };
      if (op.kind === 'sessionCreate') return { session_id: 'runtime', stored_session_id: 'stored', info: { profile_name: 'agent' }, running: false };
      if (op.kind === 'sessionHistory') return { count: 0, messages: [] }; return {}; },
    async call(method, params) { calls.push([method, params]); return callImpl(method, params); },
    async submitText(request) { calls.push(['submit', request.params.text]); return { jsonrpc: '2.0', id: request.id, result: { status: 'streaming' } }; } };
  const service = createDesktopService({ repository, connect: async () => gateway, onChange() {} });
  return { service, calls };
}
async function opened(f) {
  await f.service.handle({ kind: 'connect', host: { label: 'T', endpoint: 'https://t.invalid', authentication: 'dashboard', token: 'x', allowPrivateHttp: false } });
  await f.service.handle({ kind: 'newChat', generation: f.service.snapshot().generation, profile: 'agent' });
  return f.service.snapshot();
}

test('a /command runs through slash.exec and shows its output, never as prompt text', async () => {
  const f = setup(() => ({ output: '**Commands**: /help' }));
  const s = await opened(f);
  assert.equal((await f.service.handle({ kind: 'send', generation: s.generation, chatId: 'stored', text: '/help' })).ok, true);
  assert.deepEqual(f.calls, [['slash.exec', { session_id: 'runtime', profile: 'agent', command: '/help' }]]);
  const rows = f.service.snapshot().data.chats[0].transcript;
  assert.deepEqual(rows.map(row => [row.direction, row.paragraphs[0]]), [['out', '/help'], ['in', '```text\n**Commands**: /help\n```']]);
});

test('skills fall back to command.dispatch and their prompt goes through the journaled send', async () => {
  const f = setup((method, params) => {
    if (method === 'slash.exec') throw new GatewayOperationError(4018, '', 'skill command');
    assert.deepEqual(params, { session_id: 'runtime', profile: 'agent', name: 'review', arg: 'the leak' });
    return { type: 'skill', message: 'EXPANDED SKILL PROMPT', display: '/review the leak', name: 'review' };
  });
  const s = await opened(f);
  assert.equal((await f.service.handle({ kind: 'send', generation: s.generation, chatId: 'stored', text: '/review the leak' })).ok, true);
  assert.deepEqual(f.calls.map(call => call[0]), ['slash.exec', 'command.dispatch', 'submit']);
  assert.equal(f.calls[2][1], 'EXPANDED SKILL PROMPT');
  const outgoing = f.service.snapshot().data.chats[0].transcript.find(row => row.direction === 'out');
  assert.equal(outgoing.paragraphs[0], '/review the leak', 'the person sees what they typed, not the expanded prompt');
});

test('prefill puts text back in the box; unknown commands keep the draft', async () => {
  const f = setup(method => method === 'slash.exec' ? { type: 'prefill', message: 'previous message', notice: 'Edit and send.' } : {});
  const s = await opened(f);
  await f.service.handle({ kind: 'send', generation: s.generation, chatId: 'stored', text: '/undo' });
  assert.equal(f.service.snapshot().drafts.stored, 'previous message');
  assert.equal(f.calls.some(call => call[0] === 'submit'), false);
  const g = setup(() => { throw new GatewayOperationError(4018, '', 'not a command'); });
  const t = await opened(g);
  const result = await g.service.handle({ kind: 'send', generation: t.generation, chatId: 'stored', text: '/nonsense' });
  assert.equal(result.ok, false); assert.match(result.message, /doesn't know \/nonsense/u);
});
