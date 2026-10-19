// Projects: strict renderer input, exact profile-scoped JSON-RPC requests, decoding
// of real-shaped replies, read-back, and plain outcomes for refusals and lost replies.
// Synthetic data only; no host is contacted.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDesktopAction } from '../apps/desktop/src/shared/desktop-api.ts';
import { HANDLERS } from '../apps/desktop/src/main/calls/index.ts';
import { CallError, callFailure } from '../apps/desktop/src/main/calls/context.ts';
import { decodeProject, decodeProjectList, hostFolder } from '../packages/contracts/projects.ts';
import { GatewayOperationError } from '../packages/hermes-client/gateway.ts';
import { HttpStatusError } from '../packages/platform/transport-policy.ts';

// Shaped like hermes_cli/projects_db.Project.to_dict(), synthetic values.
const project = (overrides = {}) => ({
  id: 'p_1a2b3c4d', slug: 'travel-app', name: 'Travel app', description: 'Booking prototype', icon: null, color: null, board_slug: null,
  primary_path: '/home/synthetic/projects/travel-app', archived: false, created_at: 1792345678,
  folders: [{ path: '/home/synthetic/projects/travel-app', label: null, is_primary: true, added_at: 1792345678 }], ...overrides,
});
const listing = (projects, active = null) => ({ projects, active_id: active });

function context(replies) {
  const seen = [];
  return {
    seen,
    async rpc(method, params, options) {
      seen.push({ method, params, mutation: options?.mutation });
      const reply = replies.shift();
      if (!reply) throw new Error(`unexpected ${method}`);
      return reply(params);
    },
    http: async () => { throw new HttpStatusError(404); }, nativeContext: async () => { throw new HttpStatusError(404); },
    identity: { kind: 'dashboard' },
    requireProfile(profile) { if (profile !== 'agent') throw new CallError('stale', 'That agent is no longer on your computer.'); return profile; },
    openChat: () => null, isCurrent: () => true, refreshCatalog: async () => {}, requestId: () => '01234567-89ab-4cde-8f01-23456789abcd',
  };
}
const ok = value => async () => value;
const refused = (code, message) => async () => { throw new GatewayOperationError(code, '', message); };
const lost = async () => { throw new Error('outcome-unknown'); };
const parse = (name, input) => parseDesktopAction({ kind: 'call', connection: 1, name, input }).input;
async function run(name, input, ctx) {
  try { return { ok: true, value: await HANDLERS[name].run(ctx, parse(name, input)) }; }
  catch (error) { return callFailure(error, HANDLERS[name].mutation); }
}
const draft = { profile: 'agent', name: 'Travel app', folder: '/home/synthetic/projects/travel-app', description: 'Booking prototype' };

test('renderer input is refused unless every field is exact and bounded', () => {
  assert.deepEqual({ ...parse('projects.create', { ...draft, name: '  Travel app  ' }) }, draft);
  assert.equal(parse('projects.create', { ...draft, folder: '~/projects/app' }).folder, '~/projects/app');
  for (const input of [{ ...draft, folder: 'projects/app' }, { ...draft, folder: 'C:\\Users\\x' }, { ...draft, folder: '~x' },
    { ...draft, folder: '/a/b\\c' }, { ...draft, name: '   ' }, { ...draft, name: 'x'.repeat(161) }, { ...draft, profile: 'all' },
    { ...draft, use: true }, { ...draft, description: 'x'.repeat(2001) }, (({ folder, ...rest }) => rest)(draft)]) {
    assert.throws(() => parse('projects.create', input), JSON.stringify(input).slice(0, 80));
  }
  assert.throws(() => parse('projects.update', { profile: 'agent', id: 'p_1' }), 'an edit must change something');
  assert.throws(() => parse('projects.update', { profile: 'agent', id: 'p_1', icon: 'x' }));
  assert.throws(() => parse('projects.update', { profile: 'agent', id: 'p/1', name: 'x' }));
  assert.throws(() => parse('projects.archive', { profile: 'agent', id: 'p_1' }));
  assert.throws(() => parse('projects.delete', { profile: 'agent', id: 'p_1' }), 'hard delete is not a call');
});

test('a real-shaped project decodes to display data; host folders stay POSIX', () => {
  const decoded = decodeProject(project());
  assert.deepEqual(decoded, { id: 'p_1a2b3c4d', name: 'Travel app', description: 'Booking prototype', archived: false,
    primaryPath: '/home/synthetic/projects/travel-app', folders: [{ path: '/home/synthetic/projects/travel-app', primary: true }] });
  assert.ok(Object.isFrozen(decoded) && Object.isFrozen(decoded.folders));
  assert.equal(decodeProject(project({ description: '' })).description, null);
  assert.equal(decodeProjectList(listing([project({ archived: true })], 'p_1a2b3c4d')).activeId, 'p_1a2b3c4d', 'an archived active pointer is shown as is');
  for (const value of [listing([project(), project()]), listing([project({ archived: 'no' })]), listing([project({ id: '../x' })]),
    listing([project({ folders: [{ path: 'a\nb', is_primary: true }] })]), { projects: Array(1001).fill(project()) }]) {
    assert.throws(() => decodeProjectList(value));
  }
  assert.equal(hostFolder('/home//synthetic/./projects/../app/'), '/home/synthetic/app');
  assert.equal(hostFolder('~/app'), null);
});

test('create sends one profile-scoped request, then reads the list back', async () => {
  const ctx = context([ok(listing([])), ok({ project: project() }), ok(listing([project()], 'p_1a2b3c4d'))]);
  const result = await run('projects.create', { ...draft, folder: '/home/synthetic/projects/travel-app/' }, ctx);
  assert.equal(result.ok, true);
  assert.equal(result.value.current, true);
  assert.deepEqual(result.value.notes, []);
  assert.deepEqual(ctx.seen.map(entry => [entry.method, entry.mutation]), [['projects.list', false], ['projects.create', true], ['projects.list', false]]);
  assert.deepEqual(ctx.seen[1].params, { profile: 'agent', name: 'Travel app', folders: ['/home/synthetic/projects/travel-app/'],
    primary_path: '/home/synthetic/projects/travel-app/', description: 'Booking prototype', use: true });
});

test('create explains what Hermes saved differently and a missing current pointer', async () => {
  const saved = project({ name: 'Travel', primary_path: '/home/synthetic/elsewhere', folders: [] });
  const result = await run('projects.create', draft, context([ok(listing([])), ok({ project: saved }), ok(listing([saved]))]));
  assert.deepEqual(result.value.notes, ['Hermes saved the name as “Travel”.', 'Hermes saved a different folder. Check it below.',
    "Hermes didn't confirm it as the current project."]);
  const home = await run('projects.create', { ...draft, folder: '~/projects/travel-app' },
    context([ok(listing([])), ok({ project: project() }), ok(listing([project()], 'p_1a2b3c4d'))]));
  assert.deepEqual(home.value.notes, [], 'a ~ folder matches the expanded host path');
});

test('a folder already in a project is refused in plain words before or by Hermes', async () => {
  const early = context([ok(listing([project()]))]);
  assert.deepEqual(await run('projects.create', { ...draft, name: 'Another' }, early),
    { ok: false, code: 'conflict', message: 'That folder already belongs to “Travel app”. Open that project instead.' });
  assert.equal(early.seen.length, 1, 'nothing was created');
  const late = await run('projects.create', { ...draft, folder: '~/projects/travel-app' }, context([ok(listing([])),
    refused(5063, "folder already belongs to project 'travel-app' (p_1a2b3c4d); switch to it instead of creating a duplicate")]));
  assert.equal(late.code, 'conflict');
  assert.doesNotMatch(late.message, /p_1a2b3c4d/u, 'no raw IDs');
});

test('a lost create reply is unknown unless the new project is found', async () => {
  const found = await run('projects.create', draft, context([ok(listing([])), lost, ok(listing([project()])), ok(listing([project()], 'p_1a2b3c4d'))]));
  assert.equal(found.ok, true);
  assert.equal(found.value.notes[0], 'The reply was lost, but the project is saved.');
  assert.deepEqual(await run('projects.create', draft, context([ok(listing([])), lost, ok(listing([]))])),
    { ok: false, code: 'unknown', message: 'Not sure the project was created. Check the list before creating it again.' });
  assert.equal((await run('projects.create', draft, context([ok(listing([])), ok({ project: null })]))).code, 'unknown');
});

test('rename and description edits send only given fields and read back the echo', async () => {
  const ctx = context([ok({ project: project({ name: 'Trip planner', description: '' }) }), ok(listing([project()]))]);
  const result = await run('projects.update', { profile: 'agent', id: 'p_1a2b3c4d', name: 'Trip planner', description: '' }, ctx);
  assert.deepEqual(ctx.seen[0].params, { profile: 'agent', id: 'p_1a2b3c4d', name: 'Trip planner', description: '' });
  assert.deepEqual(result.value.notes, []);
  const other = await run('projects.update', { profile: 'agent', id: 'p_1a2b3c4d', name: 'x' }, context([ok({ project: project({ id: 'p_ffffffff' }) })]));
  assert.equal(other.code, 'unknown');
  assert.equal((await run('projects.update', { profile: 'agent', id: 'p_1a2b3c4d', name: 'x' }, context([lost]))).code, 'unknown');
  assert.equal((await run('projects.update', { profile: 'agent', id: 'p_1a2b3c4d', name: 'x' }, context([refused(5062, 'no such project')]))).code, 'stale');
  assert.deepEqual(await run('projects.update', { profile: 'agent', id: 'p_1a2b3c4d', name: 'x' }, context([refused(5063, 'project name must not be empty')])),
    { ok: false, code: 'invalid', message: 'project name must not be empty' });
});

test('make current refuses archived projects and requires the pointer to read back', async () => {
  const ctx = context([ok(listing([project()])), ok({ active_id: 'p_1a2b3c4d' }), ok(listing([project()], 'p_1a2b3c4d'))]);
  assert.deepEqual(await run('projects.makeCurrent', { profile: 'agent', id: 'p_1a2b3c4d' }, ctx), { ok: true, value: { profile: 'agent', activeId: 'p_1a2b3c4d' } });
  assert.deepEqual(ctx.seen[1], { method: 'projects.set_active', params: { profile: 'agent', id: 'p_1a2b3c4d' }, mutation: true });
  const archived = context([ok(listing([project({ archived: true })]))]);
  assert.equal((await run('projects.makeCurrent', { profile: 'agent', id: 'p_1a2b3c4d' }, archived)).code, 'invalid');
  assert.equal(archived.seen.length, 1);
  assert.equal((await run('projects.makeCurrent', { profile: 'agent', id: 'p_1a2b3c4d' },
    context([ok(listing([project()])), ok({ active_id: 'p_1a2b3c4d' }), ok(listing([project()], null))]))).code, 'unknown');
  assert.equal((await run('projects.makeCurrent', { profile: 'agent', id: 'p_1a2b3c4d' }, context([ok(listing([]))]))).code, 'stale');
});

test('archive and restore use the archive method and require the new state', async () => {
  const ctx = context([ok(listing([project({ archived: true })], 'p_1a2b3c4d'))]);
  const archived = await run('projects.archive', { profile: 'agent', id: 'p_1a2b3c4d', archived: true }, ctx);
  assert.deepEqual(ctx.seen[0].params, { profile: 'agent', id: 'p_1a2b3c4d', restore: false });
  assert.equal(archived.value.projects[0].archived, true);
  const restore = context([ok(listing([project()]))]);
  await run('projects.archive', { profile: 'agent', id: 'p_1a2b3c4d', archived: false }, restore);
  assert.equal(restore.seen[0].params.restore, true);
  assert.equal((await run('projects.archive', { profile: 'agent', id: 'p_1a2b3c4d', archived: true }, context([ok(listing([project()]))]))).code, 'unknown');
  assert.equal((await run('projects.archive', { profile: 'agent', id: 'p_1a2b3c4d', archived: true }, context([lost]))).code, 'unknown');
});

test('reads map an old host and a missing agent to plain states', async () => {
  assert.equal((await run('projects.list', { profile: 'agent' }, context([refused(-32601, 'method not found')]))).code, 'unsupported');
  assert.equal((await run('projects.list', { profile: 'agent' }, context([refused(-32000, "handler error: Profile 'agent' does not exist.")]))).code, 'stale');
  assert.equal((await run('projects.list', { profile: 'other' }, context([]))).code, 'stale');
  assert.equal((await run('projects.list', { profile: 'agent' }, context([ok({ projects: 'x' })]))).code, 'invalid');
  const failed = await run('projects.list', { profile: 'agent' }, context([async () => { throw new Error('transport-unavailable'); }]));
  assert.equal(failed.code, 'unavailable', 'a failed read is never "unknown"');
});
