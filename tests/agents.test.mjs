import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeProfiles } from '../packages/contracts/session.ts';
import { decodeModelOptions, decodeProfileRoster, deriveAgentId, createReceiptOutcome } from '../packages/contracts/agents.ts';
import { AGENT_CALLS } from '../apps/desktop/src/shared/calls/agents.ts';
import { AGENT_HANDLERS } from '../apps/desktop/src/main/calls/agents.ts';
import { CallError, callFailure } from '../apps/desktop/src/main/calls/context.ts';
import { createDesktopService } from '../apps/desktop/src/main/desktop-service.ts';
import { GatewayOperationError } from '../packages/hermes-client/gateway.ts';

// Shaped like profiles.list from Hermes b0f9ade (legacy dispatcher) plus a
// multiplexed sibling row without revisions. Paths are synthetic.
const roster = (extra = []) => ({
  profiles: [
    { name: 'default', path: '/home/example/.hermes', is_default: true, model: 'model-a', provider: 'example-provider',
      description: 'Travel planner', display_name: '', skill_count: 42, previous_names: [], ui_meta_revisions: { 'hermes-bots': 3 },
      ui_meta: { 'hermes-bots': { title: 'Ada', description: 'Plans trips and finds deals', color: '#7c3aed', shape: 'blobatar', imageKind: 'shape', custom: true } },
      has_avatar: true },
    { name: 'coder', path: '/home/example/.hermes/profiles/coder', is_default: false, model: null, provider: null,
      description: 'Code reviewer', display_name: 'Coder Bot', skill_count: 3, previous_names: [], ui_meta_revisions: {}, has_avatar: false },
    { name: 'sibling', path: '/srv/rooms/sibling', is_default: false, model: '', provider: '', description: '', display_name: '', skill_count: 0,
      ui_meta: { 'hermes-bots': { title: '  ', color: 'url(javascript:alert(1))' } } },
    ...extra,
  ],
  bot_mode_protocol: true, install_id: '0123456789abcdef0123456789abcdef',
});
const NOTHING_MIRRORED = { env: false, auth: false, model_inherited: false, voice: false };
const OPTIONS = { providers: [
  { slug: 'example-provider', name: 'Example Provider', is_current: true, models: ['model-a', 'model-b', 'model-a', 'gone'], unavailable_models: ['gone'], authenticated: true },
  { slug: 'other', name: 'Other', models: [], authenticated: false, key_env: 'OTHER_API_KEY' },
  { slug: 'locked', name: 'Locked', models: ['x'], authenticated: false },
], model: 'model-a', provider: 'example-provider' };

function fake(script) {
  const rpc = [], http = []; let refreshed = 0;
  const answer = reply => { if (reply instanceof Error) throw reply; return reply; };
  const context = Object.freeze({
    async rpc(method, params, options) { rpc.push({ method, params: structuredClone(params), options }); return answer(script.rpc?.(method, params) ?? null); },
    async http(route) { http.push(route); return { body: answer(script.http?.(route) ?? null), status: 200 }; },
    async nativeContext() { throw new Error('unused'); },
    identity: {}, openChat: () => null, isCurrent: () => true, requestId: () => '00000000-0000-4000-8000-000000000000',
    requireProfile(profile) { if (!(script.known ?? ['default', 'coder']).includes(profile)) throw new CallError('stale', 'gone'); return profile; },
    async refreshCatalog() { refreshed++; },
  });
  return { context, rpc, http, get refreshed() { return refreshed; } };
}
const run = (name, f, input) => AGENT_HANDLERS[name].run(f.context, AGENT_CALLS[name].parse(input));
const refusal = async (promise, code) => { await assert.rejects(promise, error => error instanceof CallError && error.code === code); };

test('agent names come from hermes-bots title, then display name, then ID; paths never pass', () => {
  const agents = decodeProfiles(roster());
  assert.deepEqual(agents, [
    { id: 'default', name: 'Ada', summary: 'Plans trips and finds deals', color: '#7c3aed', isDefault: true, model: 'model-a' },
    { id: 'coder', name: 'Coder Bot', summary: 'Code reviewer', color: '#D27B5B', isDefault: false, model: '' },
    { id: 'sibling', name: 'sibling', summary: '', color: '#D27B5B', isDefault: false, model: '' },
  ]);
  assert.equal(JSON.stringify(agents).match(/\/home|\/srv|path|blobatar|javascript/u), null);
  const rows = decodeProfileRoster(roster());
  assert.deepEqual(rows.map(row => row.revision), [3, 0, null]);
  assert.equal(rows[0].namespace.shape, 'blobatar');
  // The real disposable host's only row: empty revisions, no ui_meta.
  assert.deepEqual(decodeProfiles({ profiles: [{ name: 'default', path: '/tmp/x', is_default: true, model: 'gemma4:e2b', provider: 'custom', description: '',
    display_name: '', skill_count: 58, previous_names: [], ui_meta_revisions: {}, has_avatar: false }], bot_mode_protocol: true, install_id: 'c6' }),
  [{ id: 'default', name: 'default', summary: '', color: '#D27B5B', isDefault: true, model: 'gemma4:e2b' }]);
  // One display line, bounded for the offline display cache.
  const long = decodeProfiles({ profiles: [{ name: 'p', ui_meta_revisions: {}, ui_meta: { 'hermes-bots': { title: `Line\none\u202e${'x'.repeat(300)}` } } }] })[0];
  assert.equal(long.name.startsWith('Line one '), true); assert.equal([...long.name].length, 100); assert.equal(long.name.includes('\u202e'), false);
  for (const bad of [{ profiles: [{ name: 'p' }, { name: 'p' }] }, { profiles: [{ name: ' p' }] }, { profiles: [{}] }, { profiles: 'x' },
    { profiles: Array.from({ length: 257 }, (_, i) => ({ name: `p${i}` })) }]) assert.throws(() => decodeProfiles(bad));
});

test('new agent names follow Hermes rules and are derived from the typed name', () => {
  assert.equal(deriveAgentId('My AGENT', []), 'my-agent');
  assert.equal(deriveAgentId('Élodie', []), 'elodie');
  assert.equal(deriveAgentId('🌱', []), 'agent');
  assert.equal(deriveAgentId('DEFAULT', []), 'default-2');
  assert.equal(deriveAgentId('MiXeD Bot 🎸', []), 'mixed-bot');
  assert.equal(deriveAgentId('Coder', ['coder', 'Coder-2']), 'coder-3');
  assert.equal(deriveAgentId('x'.repeat(80), []).length, 48);
  const create = AGENT_CALLS['agents.create'].parse;
  assert.deepEqual(create({ id: 'travel-planner', title: 'Ada' }), { id: 'travel-planner', title: 'Ada' });
  for (const id of ['Coder', 'default', 'hermes', 'tmp', '-x', '_x', 'a'.repeat(65), '', 'a b', '../x', 'a/b', 'é']) {
    assert.throws(() => create({ id, title: 'Ada' }), `${id} must be refused`);
  }
  for (const input of [{ id: 'a', title: '   ' }, { id: 'a', title: 'A', extra: 1 }, { id: 'a', title: 'A', copyFrom: 'coder' },
    { id: 'a', title: 'A', copyFrom: 'coder', copyConsent: false }, { id: 'a', title: 'A', copyConsent: true },
    { id: 'a', title: 'A', color: 'red' }, { id: 'a', title: 'A', model: { provider: 'p' } }, { id: 'a', title: 'x'.repeat(201) },
    { id: 'a', title: 'A', role: 'two\nlines' }]) assert.throws(() => create(input), JSON.stringify(input));
  const update = AGENT_CALLS['agents.update'].parse;
  for (const input of [{ profile: 'coder' }, { profile: 'coder', title: 'X' }, { profile: 'coder', role: 'X' },
    { profile: 'coder', instructions: 'X', instructionsVersion: 'abc' }, { profile: 'coder', revision: 1 }, { profile: '../x', model: { provider: 'p', model: 'm' } }]) {
    assert.throws(() => update(input), JSON.stringify(input));
  }
  assert.deepEqual(update({ profile: 'coder', revision: null, title: 'X' }), { profile: 'coder', revision: null, title: 'X' });
});

test('create sends mirror_credentials false, starts blank and applies name, instructions and model', async () => {
  let listed = 0;
  const f = fake({
    rpc(method, params) {
      if (method === 'profiles.list') return ++listed === 1 ? roster() : roster([{ name: 'travel-planner', path: '/p', is_default: false, description: 'Travel planner', ui_meta_revisions: {}, has_avatar: false }]);
      if (method === 'profiles.create') return { ok: true, name: params.name, path: '/home/example/.hermes/profiles/travel-planner', soul_written: false, model_set: false, mirrored: NOTHING_MIRRORED };
      if (method === 'profiles.configure' && params.ui_meta) return { ok: true, applied: { ui_meta: true, ui_meta_revisions: { 'hermes-bots': 1 } } };
      if (method === 'model.options') return OPTIONS;
      if (method === 'profiles.configure') return { ok: true, applied: {}, confirm_required: true, confirm_message: 'This model is billed\u0007 at a premium rate.' };
    },
    http(route) { if (route.method === 'PUT') return { ok: true }; return { content: 'Be kind.', exists: true }; },
  });
  const saved = await run('agents.create', f, { id: 'travel-planner', title: 'Ada', role: 'Travel planner', summary: 'Finds deals', color: '#2BA59A',
    instructions: 'Be kind.', model: { provider: 'example-provider', model: 'model-b' } });
  assert.deepEqual(saved, { profile: 'travel-planner', partial: null, modelConfirm: 'This model is billed at a premium rate.' });
  const create = f.rpc.find(call => call.method === 'profiles.create');
  assert.deepEqual(create.params, { name: 'travel-planner', description: 'Travel planner', no_alias: true, mirror_credentials: false, no_skills: false });
  assert.deepEqual(f.rpc.find(call => call.method === 'profiles.configure').params, { name: 'travel-planner',
    ui_meta: { 'hermes-bots': { title: 'Ada', description: 'Finds deals', color: '#2BA59A' } }, ui_meta_expected_revisions: { 'hermes-bots': 0 } });
  assert.deepEqual(f.http.map(route => [route.method, route.path]), [['PUT', '/api/profiles/travel-planner/soul'], ['GET', '/api/profiles/travel-planner/soul']]);
  assert.deepEqual(JSON.parse(f.http[0].body), { content: 'Be kind.' });
  // The model pick went through the guarded path without confirmation; nothing was pinned at create.
  assert.deepEqual(f.rpc.at(-1).params, { name: 'travel-planner', provider: 'example-provider', model: 'model-b' });
  assert.equal(f.rpc.some(call => call.params.mirror_credentials === true || call.params.confirm_expensive_model), false);
  assert.ok(f.refreshed >= 1);
  await refusal(run('agents.create', fake({ rpc: () => roster() }), { id: 'coder', title: 'Coder' }), 'conflict');
});

test('copying another agent needs consent, sends clone_from and inherits its role and summary', async () => {
  let listed = 0;
  const f = fake({ rpc(method, params) {
    if (method === 'profiles.list') return ++listed === 1 ? roster() : roster([{ name: 'coder-copy', is_default: false, ui_meta_revisions: {} }]);
    if (method === 'profiles.create') return { ok: true, name: params.name, mirrored: NOTHING_MIRRORED };
    if (method === 'profiles.configure') return { ok: true, applied: { ui_meta: true } };
  } });
  assert.deepEqual(await run('agents.create', f, { id: 'coder-copy', title: 'Coder copy', copyFrom: 'coder', copyConsent: true }),
    { profile: 'coder-copy', partial: null, modelConfirm: null });
  assert.deepEqual(f.rpc.find(call => call.method === 'profiles.configure').params.ui_meta, { 'hermes-bots': { title: 'Coder copy' } });
  assert.deepEqual(f.rpc.find(call => call.method === 'profiles.create').params, { name: 'coder-copy', description: 'Code reviewer', no_alias: true,
    mirror_credentials: false, no_skills: false, clone_from: 'coder', clone_all: false });
  // Instructions come with the copy; nothing is written over them.
  assert.equal(f.http.length, 0);
  await refusal(run('agents.create', fake({ rpc: () => roster() }), { id: 'x', title: 'X', copyFrom: 'missing', copyConsent: true }), 'stale');
});

test('a create reply that is lost, mismatched or mirrored credentials is an unknown outcome', async () => {
  assert.equal(createReceiptOutcome({ ok: true, name: 'a', mirrored: NOTHING_MIRRORED }, 'a'), 'created');
  for (const mirrored of [{ ...NOTHING_MIRRORED, env: true }, { ...NOTHING_MIRRORED, auth: 'shared' }, { ...NOTHING_MIRRORED, voice: null }, { env: false }]) {
    assert.equal(createReceiptOutcome({ ok: true, name: 'a', mirrored }, 'a'), 'mirrored');
  }
  for (const receipt of [null, { ok: true, name: 'A', mirrored: NOTHING_MIRRORED }, { ok: 'true', name: 'a', mirrored: NOTHING_MIRRORED }, { ok: true, name: 'a' }]) {
    assert.equal(createReceiptOutcome(receipt, 'a'), 'unknown');
  }
  for (const reply of [{ ok: true, name: 'new-agent', mirrored: { ...NOTHING_MIRRORED, env: true } }, { ok: true, name: 'other' }, new Error('outcome-unknown')]) {
    const f = fake({ rpc: method => method === 'profiles.list' ? roster() : reply });
    await refusal(run('agents.create', f, { id: 'new-agent', title: 'New', instructions: 'Hi' }), 'unknown');
    assert.deepEqual(f.rpc.map(call => call.method), ['profiles.list', 'profiles.create']);
    assert.equal(f.http.length, 0); assert.equal(f.refreshed, 1);
  }
  // Host refusals are plain words; the host's path never reaches the person.
  for (const [detail, code] of [["A profile named 'x' already exists. Use another name.", 'conflict'], ["Source profile 'y' does not exist at /home/example/.hermes/profiles/y", 'invalid']]) {
    const refused = fake({ rpc: method => method === 'profiles.list' ? roster() : new GatewayOperationError(4062, '', detail) });
    const failure = callFailure(await run('agents.create', refused, { id: 'x', title: 'X' }).catch(error => error), true);
    assert.equal(failure.code, code); assert.equal(failure.message.includes('/home'), false); assert.equal(refused.refreshed, 0);
  }
});

test('expensive models need an explicit second request with confirm_expensive_model', async () => {
  let configured = 0;
  const f = fake({ rpc(method, params) {
    if (method === 'model.options') return OPTIONS;
    if (method === 'profiles.configure') return ++configured === 1 ? { ok: true, applied: {}, confirm_required: true, confirm_message: 'Costs more.' }
      : { ok: true, applied: { model: true } };
    if (method === 'profiles.describe') return { name: params.name, model: { provider: 'example-provider', default: 'model-b' } };
  } });
  assert.deepEqual(await run('agents.setModel', f, { profile: 'coder', provider: 'example-provider', model: 'model-b', confirm: false }), { status: 'confirm', message: 'Costs more.' });
  assert.equal(f.refreshed, 0);
  assert.deepEqual(await run('agents.setModel', f, { profile: 'coder', provider: 'example-provider', model: 'model-b', confirm: true }), { status: 'saved' });
  const sent = f.rpc.filter(call => call.method === 'profiles.configure').map(call => call.params);
  assert.deepEqual(sent, [{ name: 'coder', provider: 'example-provider', model: 'model-b' },
    { name: 'coder', provider: 'example-provider', model: 'model-b', confirm_expensive_model: true }]);
  assert.equal(f.refreshed, 1);
  await refusal(run('agents.setModel', f, { profile: 'coder', provider: 'locked', model: 'x', confirm: true }), 'invalid');
  await refusal(run('agents.setModel', f, { profile: 'coder', provider: 'example-provider', model: 'gone', confirm: true }), 'invalid');
  assert.throws(() => decodeModelOptions({ providers: [], model: 'm', provider: 'p', extra: 'x'.repeat(5 * 1024 * 1024) }));
  assert.deepEqual(decodeModelOptions(OPTIONS), { providers: [{ id: 'example-provider', name: 'Example Provider', models: ['model-a', 'model-b'] }],
    current: { provider: 'example-provider', model: 'model-a' } });
});

test('edits are compare-and-set: stale revisions and changed instructions are refused before writing', async () => {
  const soul = 'Be helpful.';
  const host = (overrides = {}) => fake({ rpc(method) {
    if (method === 'profiles.list') return roster();
    if (method === 'profiles.describe') return { name: 'default', model: { provider: 'example-provider', default: 'model-a' } };
    if (method === 'profiles.configure') return overrides.configure ?? { ok: true, applied: { ui_meta: true, description: true } };
  }, http: route => route.method === 'PUT' ? { ok: true } : { content: overrides.soul ?? soul, exists: true } });
  const f = host();
  const details = await run('agents.details', f, { profile: 'default' });
  assert.equal(details.name, 'Ada'); assert.equal(details.role, 'Travel planner'); assert.equal(details.revision, 3);
  assert.equal(details.instructions, soul); assert.equal(details.model, 'model-a'); assert.equal(JSON.stringify(details).includes('/home'), false);
  const saved = await run('agents.update', f, { profile: 'default', revision: 3, title: 'Ada Lovelace', summary: '', role: 'Planner', roleVersion: details.roleVersion });
  assert.deepEqual(saved, { profile: 'default', partial: null, modelConfirm: null });
  // The whole hermes-bots object goes back with unknown keys intact; blank summary follows the role.
  assert.deepEqual(f.rpc.find(call => call.method === 'profiles.configure').params, { name: 'default', description: 'Planner',
    ui_meta: { 'hermes-bots': { title: 'Ada Lovelace', color: '#7c3aed', shape: 'blobatar', imageKind: 'shape', custom: true } },
    ui_meta_expected_revisions: { 'hermes-bots': 3 } });
  assert.equal(f.refreshed, 1);
  const stale = host();
  await refusal(run('agents.update', stale, { profile: 'default', revision: 2, title: 'X' }), 'conflict');
  assert.equal(stale.rpc.some(call => call.method === 'profiles.configure'), false);
  const raced = host({ configure: { ok: false, applied: { ui_meta: false, ui_meta_conflicts: { 'hermes-bots': { expected: 3, actual: 4 } } } } });
  await assert.rejects(run('agents.update', raced, { profile: 'default', revision: 3, title: 'X' }),
    error => error.code === 'conflict' && error.message === 'This agent changed on your computer. Reload and try again.');
  const edited = host({ soul: 'Someone else wrote this.' });
  await refusal(run('agents.update', edited, { profile: 'default', instructions: 'Mine', instructionsVersion: details.instructionsVersion }), 'conflict');
  assert.equal(edited.http.some(route => route.method === 'PUT'), false);
  const noCas = host();
  await refusal(run('agents.update', noCas, { profile: 'sibling', revision: null, title: 'X' }), 'stale');
});

test('delete reviews the host first, refuses protected agents and confirms removal by reading back', async () => {
  const restRow = (name, extra = {}) => ({ name, path: `/home/example/.hermes/profiles/${name}`, is_default: name === 'default', model: 'm', provider: 'p',
    has_env: true, skill_count: 12, gateway_running: false, description: '', description_auto: false, display_name: '', bot_title: '', has_alias: false, ...extra });
  let present = ['default', 'coder'];
  const host = (active = { active: 'default', current: 'default' }, onDelete = () => { present = present.filter(name => name !== 'coder'); return { ok: true, path: '/x' }; }) => fake({
    http(route) {
      if (route.path === '/api/profiles') return { profiles: present.map(name => restRow(name)) };
      if (route.path === '/api/profiles/active') return active;
      if (route.method === 'DELETE') return onDelete();
    },
  });
  const f = host();
  const review = await run('agents.deleteReview', f, { profile: 'coder' });
  assert.equal(review.canDelete, true); assert.equal(review.skills, 12); assert.equal(review.hasSavedKeys, true);
  assert.equal(JSON.stringify(review).includes('/home'), false);
  assert.deepEqual(await run('agents.delete', f, { profile: 'coder', token: review.token }), { deleted: true });
  assert.deepEqual(f.http.filter(route => route.method === 'DELETE').map(route => [route.path, route.body]), [['/api/profiles/coder', undefined]]);
  assert.equal(f.refreshed, 1);
  for (const [profile, active] of [['default', undefined], ['coder', { active: 'coder', current: 'default' }], ['coder', { active: 'default', current: 'coder' }]]) {
    present = ['default', 'coder'];
    const blocked = host(active);
    const checked = await run('agents.deleteReview', blocked, { profile });
    assert.equal(checked.canDelete, false); assert.ok(checked.reason);
    await refusal(run('agents.delete', blocked, { profile, token: checked.token }), 'denied');
    assert.equal(blocked.http.some(route => route.method === 'DELETE'), false);
  }
  present = ['default', 'coder'];
  const changed = host();
  await refusal(run('agents.delete', changed, { profile: 'coder', token: 'a'.repeat(64) }), 'conflict');
  assert.equal(changed.http.some(route => route.method === 'DELETE'), false);
  // A lost reply is checked: still listed means unknown, gone means deleted.
  present = ['default', 'coder'];
  const lost = host(undefined, () => new Error('outcome-unknown'));
  const token = (await run('agents.deleteReview', lost, { profile: 'coder' })).token;
  await refusal(run('agents.delete', lost, { profile: 'coder', token }), 'unknown');
  const gone = host(undefined, () => { present = ['default']; return new Error('outcome-unknown'); });
  assert.deepEqual(await run('agents.delete', gone, { profile: 'coder', token }), { deleted: true });
});

test('deleting the open chat\'s agent refreshes the list and leaves that chat', async () => {
  let agents = ['agent', 'other'];
  const gateway = { exclusiveSubmit: true, close() {}, restoreRequests() {},
    async requestHttp(op) {
      if (op.kind === 'health') return { body: { ok: true, auth_required: false } };
      if (op.path === '/api/profiles') return { body: { profiles: agents.map(name => ({ name, is_default: false, has_env: false, skill_count: 0, gateway_running: false, description_auto: false, has_alias: false })) } };
      if (op.path === '/api/profiles/active') return { body: { active: 'default', current: 'default' } };
      if (op.method === 'DELETE') { agents = ['other']; return { body: { ok: true } }; }
      throw new Error('unexpected');
    },
    async operation(op) {
      if (op.kind === 'profilesList') return { profiles: agents.map(name => ({ name, ui_meta_revisions: {}, ui_meta: { 'hermes-bots': { title: name.toUpperCase() } } })) };
      if (op.kind === 'sessionList') return { sessions: [] };
      if (op.kind === 'sessionCreate') return { session_id: 'runtime', stored_session_id: 'stored', info: { profile_name: 'agent' }, running: false };
      return {};
    },
  };
  const values = new Map();
  const repository = { async read(key) { return values.get(key) ?? null; },
    async write(key, revision, value) { const next = { revision: (revision ?? 0) + 1, value }; values.set(key, next); return next; } };
  const service = createDesktopService({ repository, connect: async () => gateway, onChange() {} });
  await service.handle({ kind: 'connect', host: { label: 'Test', endpoint: 'https://test.invalid', authentication: 'dashboard', token: 'synthetic', allowPrivateHttp: false } });
  assert.deepEqual(service.snapshot().data.agents.map(agent => agent.name), ['AGENT', 'OTHER']);
  await service.handle({ kind: 'newChat', generation: service.snapshot().generation, profile: 'agent' });
  assert.equal(service.snapshot().selectedChatId, 'stored');
  const lease = service.snapshot().connection;
  const review = await service.call({ kind: 'call', connection: lease, name: 'agents.deleteReview', input: { profile: 'agent' } });
  assert.equal(review.ok, true);
  const deleted = await service.call({ kind: 'call', connection: lease, name: 'agents.delete', input: { profile: 'agent', token: review.value.token } });
  assert.deepEqual(deleted, { ok: true, value: { deleted: true } });
  const after = service.snapshot();
  assert.deepEqual(after.data.agents.map(agent => agent.id), ['other']);
  assert.equal(after.selectedChatId, null); assert.equal(after.canSend, false);
  assert.equal(after.data.chats.some(chat => chat.agentId === 'agent'), false);
});
