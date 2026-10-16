import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createWorkspaceClient, WorkspaceClientError } from '../packages/hermes-client/workspace.ts';
import { decodeWorkspaceProjects, decodeWorkspaceUsage, decodeWorkspaceScheduled, decodeWorkspaceBoard } from '../packages/contracts/workspace.ts';
import { createTransportPolicy, parseHttpOperation, HttpStatusError } from '../packages/platform/transport-policy.ts';
import { boundedHttp } from '../packages/platform/http-transport.ts';

const owner = Object.freeze({ hostId: 'host-one', principalId: 'principal-one', profileId: 'agent', authGeneration: 1, connectionGeneration: 2 });
const identity = Object.freeze({ kind: 'provider', providerId: 'test-provider', userId: 'test-user' });
const etag = `"sha256:${'a'.repeat(64)}"`;
const requestId = '01234567-89ab-cdef-0123-456789abcdef';
const context = () => ({ body: { schemaVersion: 1, pluginVersion: 'synthetic', runtimeId: 'runtime-one', servingProfileId: 'default',
  principal: { provider: identity.providerId, userId: identity.userId, displayName: 'Synthetic' },
  features: ['native-context-v1', 'serving-profile-v1', 'native-agent-board-v1'] }, etag, cacheControl: 'no-store' });
const project = () => ({ id: 'project-one', name: 'Example project', description: 'Synthetic project', archived: false,
  folders: [{ path: '/synthetic/project', label: 'Main', is_primary: true }] });
const job = () => ({ id: 'job-one', profile: 'agent', name: 'Synthetic check', prompt: 'Private instructions',
  enabled: true, state: 'scheduled', schedule: { kind: 'cron', expr: '0 9 * * *' }, deliver: 'local',
  next_run_at: 1792112400, last_status: null });
const item = (kind = 'feed', id = 'item-one') => ({ id, kind, title: 'Synthetic item', body: 'A saved note',
  status: 'active', read: false, dismissed: false, createdAt: 1792026000, updatedAt: 1792026000 });

function harness(overrides = {}) {
  const state = { owner, calls: [], response: { body: {} }, context: context(), projects: { projects: [project()], active_id: 'project-one' } };
  const client = createWorkspaceClient({ owner, identity, currentOwner: () => state.owner, nextRequestId: () => requestId,
    http: async operation => { state.calls.push(operation); return operation.kind === 'nativeContext' ? state.context : state.response; },
    projects: async profile => { state.calls.push({ kind: 'projects', profile }); return state.projects; }, ...overrides });
  return { state, client };
}
const failure = kind => error => error instanceof WorkspaceClientError && error.kind === kind;

test('projects use one profile-scoped RPC callback and bounded display projection', async () => {
  const { state, client } = harness();
  state.projects.secret = 'never-project-extra'; state.projects.projects[0].token = 'never-project-token';
  const result = await client.projects();
  assert.equal(result.status, 'loaded');
  assert.deepEqual(result.data, { projects: [{ id: 'project-one', name: 'Example project', description: 'Synthetic project', archived: false,
    folders: [{ path: '/synthetic/project', label: 'Main', primary: true }] }], activeId: 'project-one' });
  assert.deepEqual(state.calls, [{ kind: 'projects', profile: 'agent' }]);
  assert.ok(!JSON.stringify(result).includes('never-'));
  assert.ok(Object.isFrozen(result.data.projects[0].folders));
  assert.equal(decodeWorkspaceProjects({ projects: [project()], active_id: 'removed' }, 'agent').activeId, null);
});

test('usage retains reported totals, days and model values without inventing missing costs', async () => {
  const { state, client } = harness();
  state.response.body = { profile: 'agent', totals: { total_input: 40, total_output: 9, total_sessions: 2 },
    daily: [{ day: '2026-10-15', input_tokens: 40, actual_cost: 0.02 }],
    by_model: [{ model: 'example-model', output_tokens: 9, api_key: 'never-model-secret' }], token: 'never-usage-secret' };
  const result = await client.usage(7);
  assert.deepEqual(state.calls, [{ kind: 'workspaceUsage', profile: 'agent', days: 7 }]);
  assert.deepEqual(result.data.totals, { inputTokens: 40, outputTokens: 9, sessions: 2 });
  assert.deepEqual(result.data.daily, [{ day: '2026-10-15', inputTokens: 40, actualCost: 0.02 }]);
  assert.deepEqual(result.data.models, [{ name: 'example-model', outputTokens: 9 }]);
  assert.ok(!JSON.stringify(result).includes('never-'));
  assert.deepEqual(decodeWorkspaceUsage({ totals: { total_actual_cost: -2, total_input: '90', total_output: 0 } }, 'agent', 30).totals,
    { outputTokens: 0 });
  await assert.rejects(client.usage(365));
});

test('scheduled catalog preserves real state and projects no prompt, script, or credential fields', async () => {
  const { state, client } = harness(); state.response.body = { jobs: [job()] };
  const result = await client.scheduled();
  assert.deepEqual(state.calls, [{ kind: 'workspaceScheduled', profile: 'agent' }]);
  assert.equal(result.data.tasks[0].state, 'scheduled');
  assert.equal(result.data.tasks[0].schedule, '0 9 * * *');
  assert.equal(result.data.tasks[0].nextRunAt, new Date(job().next_run_at * 1000).toISOString());
  assert.ok(!JSON.stringify(result).includes('Private instructions'));
  assert.equal(decodeWorkspaceScheduled({ jobs: [{ ...job(), schedule: { kind: 'interval', minutes: 30 } }] }, 'agent').tasks[0].schedule, 'every 30m');
  assert.equal(decodeWorkspaceScheduled({ jobs: [{ ...job(), schedule: { kind: 'once', run_at: '2026-10-17T09:00:00Z' } }] }, 'agent').tasks[0].schedule,
    '2026-10-17T09:00:00Z');
});

test('board verifies current context and returns only the requested kind without writes or AI', async () => {
  const { state, client } = harness();
  state.response = { body: { items: [item(), item('idea', 'idea-one'), { ...item('goal', 'goal-one'), token: 'never-board-secret' },
    { ...item('goal', 'goal-dismissed'), dismissed: true }] }, etag, requestId };
  const result = await client.board('goals');
  assert.deepEqual(state.calls, [{ kind: 'nativeContext' }, { kind: 'workspaceBoard', agentId: 'agent', etag, requestId }]);
  assert.equal(result.data.tab, 'goals'); assert.equal(result.data.items.length, 1); assert.equal(result.data.items[0].id, 'goal-one');
  assert.ok(!JSON.stringify(result).includes('never-')); assert.ok(!JSON.stringify(result).includes('test-user'));
  assert.ok(Object.isFrozen(result.data.items[0]));
});

test('missing optional capabilities produce typed unsupported results without browsing side effects', async () => {
  const { state, client } = harness({ capabilities: { projects: false, usage: false, scheduled: false } });
  for (const result of [await client.projects(), await client.usage(), await client.scheduled()]) {
    assert.deepEqual(result, { status: 'unsupported', reason: 'host-update' });
  }
  state.context.body.features = ['native-context-v1', 'serving-profile-v1'];
  assert.deepEqual(await client.board('feed'), { status: 'unsupported', reason: 'plugin-update' });
  assert.deepEqual(state.calls, [{ kind: 'nativeContext' }]);
});

test('context rejects principal, serving-profile declaration, schema, features, ETag and cache violations', async () => {
  const invalid = [
    c => { c.body.principal.userId = 'other'; }, c => { c.body.principal.provider = 'other'; },
    c => { c.body.principal = null; }, c => { c.body.schemaVersion = 2; }, c => { delete c.body.runtimeId; },
    c => { c.body.features.push('native-context-v1'); }, c => { c.body.features = ['native-agent-board-v1']; },
    c => { c.body.servingProfileId = 5; }, c => { c.body.features = ['native-context-v1', 'native-agent-board-v1']; },
    c => { c.etag = 'W/' + etag; }, c => { delete c.cacheControl; }, c => { c.cacheControl = 'public'; },
  ];
  for (const change of invalid) {
    const { state, client } = harness(); change(state.context);
    await assert.rejects(client.board('feed'), failure('invalid-response')); assert.equal(state.calls.length, 1);
  }
  const { state, client } = harness({ identity: { kind: 'dashboard' } });
  state.context.body.principal = null; state.response = { body: { items: [] }, etag, requestId };
  assert.equal((await client.board('feed')).status, 'loaded');
});

test('owner mismatch before and after awaits rejects all stale host/profile/principal/generation results', async () => {
  for (const update of [{ hostId: 'other' }, { principalId: 'other' }, { profileId: 'other' }, { authGeneration: 2 }, { connectionGeneration: 3 }]) {
    const { state, client } = harness(); state.owner = { ...owner, ...update };
    await assert.rejects(client.projects(), failure('owner-changed')); assert.equal(state.calls.length, 0);
  }
  let current = owner;
  const { client } = harness({ currentOwner: () => current, projects: async () => { current = { ...owner, profileId: 'other' }; return { projects: [], active_id: null }; } });
  await assert.rejects(client.projects(), failure('owner-changed'));
  let boardCalls = 0;
  const { client: boardClient } = harness({ currentOwner: () => current, http: async () => { boardCalls++; current = null; return context(); } });
  current = owner;
  await assert.rejects(boardClient.board('ideas'), failure('owner-changed')); assert.equal(boardCalls, 1);
  current = owner; boardCalls = 0;
  const { client: lateBoardClient } = harness({ currentOwner: () => current, http: async operation => {
    boardCalls++;
    if (operation.kind === 'nativeContext') return context();
    current = { ...owner, principalId: 'changed' }; return { body: { items: [item()] }, etag, requestId };
  } });
  await assert.rejects(lateBoardClient.board('feed'), failure('owner-changed')); assert.equal(boardCalls, 2);
});

test('malformed catalogs, mismatched profile echoes, duplicates and oversized rows fail safely', () => {
  for (const value of [{}, { projects: [project(), project()], active_id: null }, { projects: [project()], active_id: 3 },
    { projects: [{ ...project(), name: 'x'.repeat(201) }], active_id: null }, { projects: Array(1001).fill(project()), active_id: null },
    { projects: [project()], active_id: null, profile: 'other' }]) assert.throws(() => decodeWorkspaceProjects(value, 'agent'));
  for (const value of [{ jobs: [{ ...job(), profile: 'other' }] }, { jobs: [job(), job()] }, { jobs: [{ ...job(), state: 'invented' }] },
    { jobs: Array(501).fill(job()) }, { jobs: [{ ...job(), next_run_at: Infinity }] }]) assert.throws(() => decodeWorkspaceScheduled(value, 'agent'));
  for (const value of [{}, { profile: 'other', totals: {} }, { daily: Array(801).fill({ day: '2026-10-16' }) }]) {
    assert.throws(() => decodeWorkspaceUsage(value, 'agent', 30));
  }
  for (const value of [{ items: [item(), item()] }, { items: [item('unknown')] }, { items: [{ ...item(), title: '\u202eevil' }] },
    { items: Array(201).fill(item()) }, { items: [], agentId: 'other' }]) assert.throws(() => decodeWorkspaceBoard(value, 'agent', 'feed'));
});

test('request failures and mismatched native receipt are never retried and do not expose adapter errors', async () => {
  let attempts = 0;
  const { client } = harness({ http: async () => { attempts++; throw new Error('Bearer never-secret'); } });
  await assert.rejects(client.usage(), error => failure('unavailable')(error) && !String(error).includes('never-secret'));
  assert.equal(attempts, 1);
  for (const change of [{ etag: `"sha256:${'b'.repeat(64)}"` }, { requestId: 'wrong' }]) {
    const { state, client } = harness(); state.response = { body: { items: [] }, etag, requestId, ...change };
    await assert.rejects(client.board('feed'), failure('invalid-response')); assert.equal(state.calls.length, 2);
  }
});

test('missing fixed catalog routes are unsupported; authorization failures and absent board profiles are not', async () => {
  for (const status of [404, 405, 501]) {
    let count = 0;
    const { client } = harness({ http: async () => { count++; throw new HttpStatusError(status); } });
    assert.deepEqual(await client.usage(), { status: 'unsupported', reason: 'host-update' });
    assert.deepEqual(await client.scheduled(), { status: 'unsupported', reason: 'host-update' });
    assert.deepEqual(await client.board('feed'), { status: 'unsupported', reason: 'plugin-update' });
    assert.equal(count, 3);
  }
  for (const status of [401, 403, 412, 429, 500, 503]) {
    let count = 0;
    const { client } = harness({ http: async () => { count++; throw new HttpStatusError(status); } });
    await assert.rejects(client.board('feed'), failure('unavailable')); assert.equal(count, 1);
  }
  let count = 0;
  const { client } = harness({ http: async operation => { count++;
    if (operation.kind === 'nativeContext') return context(); throw new HttpStatusError(404);
  } });
  await assert.rejects(client.board('feed'), failure('unavailable')); assert.equal(count, 2);
  assert.throws(() => new HttpStatusError('never-secret'), error => !String(error).includes('never-secret'));
});

test('local HTTP carries comma-separated cache policy but rejects ambiguous native authority headers', async () => {
  const server = createServer((request, response) => {
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('ETag', request.url === '/duplicate-etag' ? [etag, etag] : etag);
    response.setHeader('X-Loopdy-Request-ID', request.url === '/duplicate-id' ? [requestId, requestId] : requestId);
    response.end('{}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const plan = path => ({ url: base + path, method: 'GET', headers: {}, redirect: 'error', credentials: 'omit', maxResponseBytes: 128 });
  try {
    const result = await boundedHttp(plan('/context'), new AbortController().signal);
    assert.equal(result.headers['cache-control'], 'private, no-store');
    for (const path of ['/duplicate-etag', '/duplicate-id']) await assert.rejects(boundedHttp(plan(path), new AbortController().signal));
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('finite transport chooses exact read routes and bounded native POST with required correlation', async () => {
  const plans = [];
  const policy = createTransportPolicy({ endpoint: 'https://synthetic.example', authentication: { kind: 'dashboard', token: 'never-token' } }, {
    isCurrent: () => true, now: () => 0, socket: async () => { throw new Error('not needed'); },
    http: async plan => { plans.push(plan); return { status: 200, url: plan.url, redirected: false, body: {},
      headers: { etag, 'x-loopdy-request-id': requestId, 'cache-control': 'no-store' } }; },
  });
  const signal = new AbortController().signal;
  await policy.request({ kind: 'workspaceUsage', profile: 'agent', days: 30 }, signal);
  await policy.request({ kind: 'workspaceScheduled', profile: 'agent' }, signal);
  await policy.request({ kind: 'workspaceBoard', agentId: 'agent', etag, requestId }, signal);
  const native = await policy.request({ kind: 'nativeContext' }, signal);
  assert.equal(plans[0].url, 'https://synthetic.example/api/analytics/usage?days=30&profile=agent');
  assert.equal(plans[1].url, 'https://synthetic.example/api/cron/jobs?profile=agent');
  assert.equal(plans[2].url, 'https://synthetic.example/api/plugins/loopdy/native/board/list');
  assert.equal(plans[2].method, 'POST'); assert.equal(plans[2].body, JSON.stringify({ agentId: 'agent', limit: 200 }));
  assert.equal(plans[2].headers['If-Match'], etag); assert.equal(plans[2].headers['X-Loopdy-Request-ID'], requestId);
  assert.equal(plans[2].maxResponseBytes, 2 * 1024 * 1024); assert.equal(native.cacheControl, 'no-store');
  for (const operation of [{ kind: 'workspaceUsage', profile: 'agent', days: 365 }, { kind: 'workspaceScheduled', profile: '../x' },
    { kind: 'workspaceScheduled', profile: 'é'.repeat(65) }, { kind: 'workspaceScheduled', profile: 'all' },
    { kind: 'workspaceBoard', agentId: 'agent', etag, requestId, tab: 'feed' },
    { kind: 'workspaceBoard', agentId: 'agent', etag, requestId: requestId.toUpperCase() },
    { kind: 'workspaceScheduled', profile: 'agent', headers: { authorization: 'secret' } }]) assert.throws(() => parseHttpOperation(operation));
});
