// Kanban board: input refusal, lane mapping, request shapes, decoding of
// real-shaped replies, optimistic rollback and the AI-spending gates.
// Synthetic data shaped like Hermes' bundled kanban plugin (plugin_api.py) replies.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDesktopAction } from '../apps/desktop/src/shared/desktop-api.ts';
import { CALLS } from '../apps/desktop/src/shared/calls/index.ts';
import { HANDLERS } from '../apps/desktop/src/main/calls/index.ts';
import { callFailure } from '../apps/desktop/src/main/calls/context.ts';
import { HttpStatusError, parseHttpOperation } from '../packages/platform/transport-policy.ts';
import {
  decodeKanbanAutoPlan, decodeKanbanBoards, decodeKanbanSnapshot, decodeKanbanTaskDetail, decodeKanbanTaskReply,
} from '../packages/contracts/kanban.ts';
import {
  KANBAN_LANES, assignSpends, cardNote, deleteBody, eventLabel, finishMove, laneCounts, laneOf, moveBody, moveGate,
  moveTargets, primaryMove, startMove,
} from '../packages/domain/kanban.ts';

const KEY = '0b6f0c1e-5d7a-4c55-9f0e-2a1b3c4d5e6f';
// The full Task row the plugin returns (asdict(Task) + derived fields).
function task(overrides = {}) {
  return { id: 't_1a2b3c4d', title: 'Draft the release notes', body: 'Cover the sync feature.', assignee: null, status: 'todo',
    priority: 0, created_by: 'dashboard', created_at: 1760600000, started_at: null, completed_at: null, workspace_kind: 'scratch',
    workspace_path: '/home/example/.hermes/kanban/workspaces/t_1a2b3c4d', claim_lock: null, claim_expires: null, tenant: null,
    branch_name: null, project_id: null, result: null, idempotency_key: KEY, consecutive_failures: 0, worker_pid: 4242,
    last_failure_error: 'Traceback /home/example/secret', max_runtime_seconds: null, last_heartbeat_at: null, current_run_id: null,
    workflow_template_id: null, current_step_key: null, skills: null, model_override: null, provider_override: null,
    reasoning_effort: null, max_retries: null, goal_mode: false, goal_max_turns: null, session_id: null, block_kind: null,
    block_recurrences: 0, completion_contract: 'local-only',
    age: { created_age_seconds: 7, started_age_seconds: null, time_to_complete_seconds: null },
    latest_summary: null, current_run_started_at: null, ...overrides };
}
const boardCard = (overrides = {}) => ({ ...task(overrides), link_counts: { parents: 0, children: 0 }, comment_count: 1, progress: null, ...overrides });
function snapshot(tasks) {
  const names = ['triage', 'todo', 'scheduled', 'ready', 'running', 'blocked', 'review', 'done'];
  return { columns: names.map(name => ({ name, tasks: tasks.filter(entry => (names.includes(entry.status) ? entry.status : 'todo') === name) })),
    tenants: [], assignees: ['default', 'writer'], latest_event_id: 4, now: 1760600120 };
}
const BOARDS = { boards: [{ slug: 'default', name: 'Default', description: '', icon: '', color: '', default_workdir: null, project_id: null,
  created_at: null, archived: false, db_path: '/home/example/.hermes/kanban.db', is_current: true, counts: { todo: 2, ready: 1, done: 4 },
  total: 7, default_workspace_kind: 'scratch', project_name: null }], current: 'default' };
function detail(overrides = {}, extra = {}) {
  return { task: task(overrides),
    comments: [{ id: 1, task_id: 't_1a2b3c4d', author: 'bighelp', body: 'Use the short version.', created_at: 1760600100 }],
    events: [
      { id: 1, task_id: 't_1a2b3c4d', kind: 'created', payload: { assignee: null, status: 'triage', parents: [], workspace_path: null }, created_at: 1760600000, run_id: null },
      { id: 2, task_id: 't_1a2b3c4d', kind: 'status', payload: { status: 'todo', requested_status: 'todo' }, created_at: 1760600001, run_id: null },
      { id: 3, task_id: 't_1a2b3c4d', kind: 'commented', payload: { author: 'bighelp', len: 22 }, created_at: 1760600100, run_id: null },
      { id: 4, task_id: 't_1a2b3c4d', kind: 'assigned', payload: { assignee: 'writer', from: null }, created_at: 1760600101, run_id: null },
    ],
    attachments: [], links: { parents: [], children: [] }, link_tasks: [], child_results: [],
    runs: [{ id: 3, task_id: 't_1a2b3c4d', profile: 'writer', step_key: null, status: 'done', worker_pid: 4242, started_at: 1760600200,
      ended_at: 1760600400, outcome: 'completed', summary: 'Drafted.', metadata: null, error: 'boom at /home/example/secret' }], ...extra };
}

// A fake host: each route goes through the real transport policy parser first.
function host(reply) {
  const seen = [];
  const context = Object.freeze({
    async http(route) {
      parseHttpOperation({ kind: 'route', ...route });
      const call = { method: route.method, path: route.path, query: { ...route.query }, body: route.body === undefined ? undefined : JSON.parse(route.body) };
      seen.push(call);
      return { body: await reply(call) };
    },
    rpc: async () => { throw new Error('unexpected rpc'); },
    nativeContext: async () => { throw new Error('unexpected native'); },
    identity: { kind: 'dashboard' }, requireProfile: value => value, openChat: () => null, isCurrent: () => true,
    refreshCatalog: async () => {}, requestId: () => KEY,
  });
  return { seen, async call(name, input) {
    const parsed = CALLS[name].parse(input);
    try { return { ok: true, value: await HANDLERS[name].run(context, parsed) }; }
    catch (error) { return callFailure(error, HANDLERS[name].mutation); }
  } };
}
const writes = seen => seen.filter(call => call.method !== 'GET');

test('kanban calls refuse anything outside their exact inputs', () => {
  const action = (name, input) => parseDesktopAction({ kind: 'call', connection: 1, name, input });
  const ok = { board: 'default', id: 't_1a2b3c4d' };
  assert.ok(action('kanban.load', {}));
  assert.ok(action('kanban.task', ok));
  assert.ok(action('kanban.move', { ...ok, from: 'todo', move: 'ready' }));
  assert.ok(action('kanban.move', { ...ok, from: 'ready', move: 'done', note: 'Shipped.' }));
  assert.ok(action('kanban.create', { board: 'default', title: 'Plan', idempotencyKey: KEY, assignee: 'writer', body: '' }));
  for (const [name, input] of [
    ['kanban.load', { board: 'Default' }], ['kanban.load', { board: '../x' }], ['kanban.load', { extra: 1 }],
    ['kanban.task', { board: 'default', id: '../../auth' }], ['kanban.task', { board: 'default', id: 't_1/x' }], ['kanban.task', { id: 't_1' }],
    ['kanban.move', { ...ok, from: 'todo', move: 'working' }], ['kanban.move', { ...ok, from: 'todo', move: 'running' }],
    ['kanban.move', { ...ok, from: 'mystery', move: 'ready' }], ['kanban.move', { ...ok, from: 'ready', move: 'done' }],
    ['kanban.move', { ...ok, from: 'ready', move: 'done', note: '   ' }], ['kanban.move', { ...ok, from: 'todo', move: 'ready', note: 'x' }],
    ['kanban.create', { board: 'default', title: '   ', idempotencyKey: KEY }], ['kanban.create', { board: 'default', title: 'x', idempotencyKey: 'abc' }],
    ['kanban.create', { board: 'default', title: 'x', idempotencyKey: KEY, triage: false }],
    ['kanban.create', { board: 'default', title: 'x', idempotencyKey: KEY, assignee: 'Writer' }],
    ['kanban.create', { board: 'default', title: 'a\u0000b', idempotencyKey: KEY }], ['kanban.create', { board: 'default', title: 'x'.repeat(501), idempotencyKey: KEY }],
    ['kanban.assign', { ...ok, assignee: '../root' }], ['kanban.assign', ok],
    ['kanban.comment', { ...ok, body: ' \n ' }], ['kanban.comment', { ...ok, body: 'x', author: 'someone' }],
    ['kanban.delete', { ...ok, status: 'done' }],
  ]) assert.throws(() => action(name, input), `${name} ${JSON.stringify(input)} must be refused`);
});

test('statuses fold into five lanes; unknown states are read-only and nothing targets Working', () => {
  assert.deepEqual(KANBAN_LANES, ['later', 'ready', 'working', 'needsYou', 'done']);
  const lanes = { triage: 'later', todo: 'later', scheduled: 'later', ready: 'ready', running: 'working', blocked: 'needsYou',
    review: 'needsYou', done: 'done', archived: 'other', other: 'other' };
  for (const [status, lane] of Object.entries(lanes)) assert.equal(laneOf(status), lane, status);
  for (const status of Object.keys(lanes)) assert.ok(!moveTargets(status).some(move => move === 'working' || move === 'running'));
  assert.deepEqual(moveTargets('running'), []);
  assert.deepEqual(moveTargets('other'), []);
  assert.deepEqual(moveTargets('review'), ['ready', 'done'], 'review -> Later would re-gate into Ready and may start work');
  assert.deepEqual(moveTargets('todo'), ['ready'], 'Hermes refuses Later -> Done');
  assert.equal(cardNote({ status: 'blocked', blockKind: 'needs_input' }), 'Has a question');
  assert.equal(cardNote({ status: 'blocked', blockKind: 'dependency' }), 'Waiting on another task');
  assert.equal(cardNote({ status: 'triage', blockKind: null }), 'Planning');
  assert.deepEqual(primaryMove('todo'), { move: 'ready', label: 'Start now' });
  assert.deepEqual(primaryMove('blocked'), { move: 'ready', label: 'Try again' });
  assert.equal(primaryMove('running'), null);
  const counts = laneCounts([{ status: 'todo' }, { status: 'triage' }, { status: 'running' }, { status: 'other' }]);
  assert.deepEqual({ ...counts }, { later: 2, ready: 0, working: 1, needsYou: 0, done: 0, other: 1 });
});

test('moves to Ready need a spending confirmation and Done needs a result note', () => {
  const card = { status: 'todo', title: 'Plan', children: 0 };
  const start = moveGate(card, 'ready');
  assert.equal(start.kind, 'spend');
  assert.match(start.body, /starts the agent and uses AI credits/u);
  assert.equal(moveGate({ ...card, status: 'blocked' }, 'ready').confirm, 'Try again');
  assert.equal(moveGate({ ...card, status: 'ready' }, 'later').kind, 'none');
  const done = moveGate({ ...card, status: 'ready' }, 'done');
  assert.equal(done.kind, 'note');
  assert.doesNotMatch(done.body, /AI credits/u);
  assert.match(moveGate({ ...card, status: 'ready', children: 2 }, 'done').body, /AI credits/u, 'finishing a parent can start waiting tasks');
  assert.throws(() => moveGate({ ...card, status: 'running' }, 'later'));
  assert.deepEqual(moveBody('todo', 'ready'), { status: 'ready' });
  assert.deepEqual(moveBody('ready', 'later'), { status: 'todo' });
  assert.deepEqual(moveBody('blocked', 'done', '  Shipped it. '), { status: 'done', summary: 'Shipped it.' });
  assert.throws(() => moveBody('ready', 'done', '  '));
  assert.throws(() => moveBody('todo', 'done', 'x'));
  assert.equal(assignSpends({ status: 'ready' }, 'writer'), true);
  assert.equal(assignSpends({ status: 'ready' }, null), false);
  assert.equal(assignSpends({ status: 'todo' }, 'writer'), false);
  assert.match(deleteBody({ title: 'Plan', children: 1 }), /can't undo.*AI credits/su);
});

test('an optimistic move shows the new lane and rolls back exactly on refusal', () => {
  const cards = decodeKanbanSnapshot(snapshot([boardCard(), boardCard({ id: 't_00000002', title: 'Other', status: 'ready' })])).cards;
  const started = startMove(cards, 't_1a2b3c4d', 'ready');
  assert.equal(started.cards[0].status, 'ready');
  assert.equal(cards[0].status, 'todo', 'the source list is not mutated');
  assert.deepEqual(finishMove(started.cards, started.pending, null), cards);
  const confirmed = { ...cards[0], status: 'todo' }; // Hermes may land it somewhere else (open parents)
  assert.equal(finishMove(started.cards, started.pending, confirmed)[0].status, 'todo');
  assert.equal(finishMove(started.cards, started.pending, { ...confirmed, id: 't_99999999' })[0], cards[0], 'a mismatched reply rolls back');
  assert.equal(startMove(cards, 't_1a2b3c4d', 'done'), null, 'not offered from Later');
  assert.equal(startMove(cards, 't_missing0', 'ready'), null);
});

test('real-shaped replies decode to bounded display data without host paths, PIDs or keys', () => {
  const boards = decodeKanbanBoards(BOARDS);
  assert.deepEqual(boards, { boards: [{ slug: 'default', name: 'Default', open: 3, total: 7 }], current: 'default' });
  const decoded = decodeKanbanSnapshot(snapshot([boardCard({ assignee: 'writer', block_kind: 'needs_input', status: 'blocked' }),
    boardCard({ id: 't_00000003', status: 'mystery', title: 'Bidi ‮evil‬\ntitle' })]));
  assert.equal(decoded.cards.length, 2);
  // Hermes files an unknown status under todo; the card keeps it and goes read-only.
  const [unknown, asking] = decoded.cards;
  assert.equal(asking.assignee, 'writer');
  assert.equal(asking.blockKind, 'needs_input');
  assert.equal(asking.commentCount, 1);
  assert.equal(unknown.status, 'other');
  assert.equal(unknown.title, 'Bidi evil title');
  assert.deepEqual(decoded.assignees, ['default', 'writer']);
  const text = JSON.stringify([decoded, boards]);
  for (const secret of ['/home/example', 'kanban.db', KEY, '4242', 'Traceback', 'local-only']) assert.equal(text.includes(secret), false, secret);
  const full = decodeKanbanTaskDetail(detail({ status: 'done', result: 'Done well.' }, { links: { parents: [], children: ['t_00000009'] } }));
  assert.equal(full.card.children, 1);
  assert.equal(full.body, 'Cover the sync feature.');
  assert.equal(full.result, 'Done well.');
  assert.deepEqual(full.comments, [{ id: 1, author: 'bighelp', body: 'Use the short version.', createdAt: 1760600100 }]);
  assert.deepEqual(full.runs, [{ id: 3, agent: 'writer', outcome: 'completed', summary: 'Drafted.', failed: true, startedAt: 1760600200, endedAt: 1760600400 }]);
  assert.equal(JSON.stringify(full).includes('/home/example'), false, 'raw run errors never cross');
  const labels = full.events.map(event => eventLabel(event, id => id === 'writer' ? 'Writer' : id));
  assert.deepEqual(labels, ['Added', 'Moved to Later', null, 'Given to Writer']);
  assert.equal(decodeKanbanTaskReply({ task: task({ status: 'triage' }) }).status, 'triage');
  assert.equal(decodeKanbanAutoPlan({ orchestrator_profile: '', auto_decompose: true, resolved_default_assignee: 'default' }), true);
  assert.equal(decodeKanbanAutoPlan({}), null);
  // Strict where it routes: a bad task ID or a duplicate fails the whole read.
  assert.throws(() => decodeKanbanSnapshot(snapshot([boardCard({ id: '../x' })])));
  assert.throws(() => decodeKanbanSnapshot(snapshot([boardCard(), boardCard()])));
  assert.throws(() => decodeKanbanBoards({ boards: [{ slug: 'Bad Slug' }], current: null }));
  assert.throws(() => decodeKanbanSnapshot({ columns: 'nope' }));
});

test('load names the board on every read and reports a missing plugin in one sentence', async () => {
  const fake = host(call => call.path.endsWith('/boards') ? BOARDS : call.path.endsWith('/board') ? snapshot([boardCard()])
    : { auto_decompose: false });
  const loaded = await fake.call('kanban.load', {});
  assert.equal(loaded.ok, true);
  assert.equal(loaded.value.board, 'default');
  assert.equal(loaded.value.autoPlan, false);
  assert.deepEqual(fake.seen.map(call => [call.method, call.path, call.query]), [
    ['GET', '/api/plugins/kanban/boards', { include_archived: 'false' }],
    ['GET', '/api/plugins/kanban/board', { board: 'default', include_archived: 'false' }],
    ['GET', '/api/plugins/kanban/orchestration', {}],
  ]);
  const missing = host(() => { throw new HttpStatusError(404, 'Plugin not found'); });
  const result = await missing.call('kanban.load', {});
  assert.equal(result.code, 'unsupported');
  assert.equal(result.message, "Kanban isn't on this computer. It comes with Hermes, so updating Hermes there adds it.");
  // An Auto plan read failure never blocks the board.
  const quiet = host(call => { if (call.path.endsWith('/orchestration')) throw new HttpStatusError(500); return call.path.endsWith('/boards') ? BOARDS : snapshot([]); });
  assert.equal((await quiet.call('kanban.load', { board: 'gone' })).value.autoPlan, null);
  assert.equal(quiet.seen[1].query.board, 'default', 'an unknown board falls back to the current one');
});

test('new tasks are created in planning and moved straight to Later, never Ready', async () => {
  const fake = host(call => call.method === 'POST' ? { task: task({ status: 'triage', assignee: 'writer' }) } : { task: task({ status: 'todo', assignee: 'writer' }) });
  const result = await fake.call('kanban.create', { board: 'default', title: '  Plan the launch ', body: ' Notes ', assignee: 'writer', idempotencyKey: KEY });
  assert.equal(result.ok, true);
  assert.equal(result.value.status, 'todo');
  assert.deepEqual(fake.seen, [
    { method: 'POST', path: '/api/plugins/kanban/tasks', query: { board: 'default' }, body: { title: 'Plan the launch', body: 'Notes',
      assignee: 'writer', priority: 0, parents: [], triage: true, goal_mode: false, idempotency_key: KEY } },
    { method: 'PATCH', path: '/api/plugins/kanban/tasks/t_1a2b3c4d', query: { board: 'default' }, body: { status: 'todo' } },
  ]);
  // Same key again after an unknown outcome: Hermes hands back the existing task; nothing moves twice.
  const again = host(() => ({ task: task({ status: 'todo' }) }));
  await again.call('kanban.create', { board: 'default', title: 'Plan', idempotencyKey: KEY });
  assert.equal(again.seen.length, 1);
  assert.equal('body' in again.seen[0].body || 'assignee' in again.seen[0].body, false);
  const stuck = host(call => { if (call.method === 'PATCH') throw new Error('outcome-unknown'); return { task: task({ status: 'triage' }) }; });
  const unknown = await stuck.call('kanban.create', { board: 'default', title: 'Plan', idempotencyKey: KEY });
  assert.equal(unknown.code, 'unknown');
  assert.match(unknown.message, /added.*Refresh to check/u);
});

test('moves re-check the status first and send exactly one status change', async () => {
  let status = 'todo';
  const fake = host(call => call.method === 'GET' ? detail({ status }) : { task: task({ status: call.body.status }) });
  const started = await fake.call('kanban.move', { board: 'default', id: 't_1a2b3c4d', from: 'todo', move: 'ready' });
  assert.equal(started.value.status, 'ready');
  assert.deepEqual(writes(fake.seen), [{ method: 'PATCH', path: '/api/plugins/kanban/tasks/t_1a2b3c4d', query: { board: 'default' }, body: { status: 'ready' } }]);
  status = 'ready';
  await fake.call('kanban.move', { board: 'default', id: 't_1a2b3c4d', from: 'ready', move: 'done', note: ' Shipped. ' });
  assert.deepEqual(writes(fake.seen)[1].body, { status: 'done', summary: 'Shipped.' });
  // The card started running after the person looked: refuse, send nothing.
  status = 'running';
  const before = writes(fake.seen).length;
  const stale = await fake.call('kanban.move', { board: 'default', id: 't_1a2b3c4d', from: 'ready', move: 'later' });
  assert.equal(stale.code, 'conflict');
  assert.equal(writes(fake.seen).length, before);
  // Hermes' 409 names raw task IDs; the person sees a plain sentence.
  status = 'todo';
  const refused = host(call => { if (call.method === 'GET') return detail({ status: 'todo' });
    throw new HttpStatusError(409, "Cannot move to 'ready': blocked by parent(s) not done — 'Spec' (t_9f9f9f9f, status=todo)"); });
  const blocked = await refused.call('kanban.move', { board: 'default', id: 't_1a2b3c4d', from: 'todo', move: 'ready' });
  assert.deepEqual(blocked, { ok: false, code: 'conflict', message: 'This task is waiting on another task to finish first.' });
  const lost = host(call => { if (call.method === 'GET') return detail({ status: 'todo' }); throw new HttpStatusError(502); });
  assert.equal((await lost.call('kanban.move', { board: 'default', id: 't_1a2b3c4d', from: 'todo', move: 'ready' })).code, 'unknown');
});

test('comments, agent changes and delete use their exact routes and refuse running work', async () => {
  let status = 'todo';
  const fake = host(call => call.method === 'GET' ? detail({ status }) : call.method === 'DELETE' ? { deleted: true, task_id: 't_1a2b3c4d' }
    : call.path.endsWith('/comments') ? { ok: true } : { task: task({ assignee: call.body.assignee || null }) });
  assert.deepEqual(await fake.call('kanban.comment', { board: 'default', id: 't_1a2b3c4d', body: ' Use the short version.\n' }), { ok: true, value: null });
  assert.equal((await fake.call('kanban.assign', { board: 'default', id: 't_1a2b3c4d', assignee: null })).value.assignee, null);
  assert.deepEqual(await fake.call('kanban.delete', { board: 'default', id: 't_1a2b3c4d' }), { ok: true, value: null });
  assert.deepEqual(writes(fake.seen), [
    { method: 'POST', path: '/api/plugins/kanban/tasks/t_1a2b3c4d/comments', query: { board: 'default' }, body: { body: 'Use the short version.', author: 'bighelp' } },
    { method: 'PATCH', path: '/api/plugins/kanban/tasks/t_1a2b3c4d', query: { board: 'default' }, body: { assignee: '' } },
    { method: 'DELETE', path: '/api/plugins/kanban/tasks/t_1a2b3c4d', query: { board: 'default' }, body: undefined },
  ]);
  status = 'running';
  const count = writes(fake.seen).length;
  assert.equal((await fake.call('kanban.delete', { board: 'default', id: 't_1a2b3c4d' })).code, 'conflict');
  assert.equal((await fake.call('kanban.assign', { board: 'default', id: 't_1a2b3c4d', assignee: 'writer' })).code, 'conflict');
  assert.equal(writes(fake.seen).length, count);
  const gone = host(() => { throw new HttpStatusError(404, 'task t_1a2b3c4d not found'); });
  const missing = await gone.call('kanban.task', { board: 'default', id: 't_1a2b3c4d' });
  assert.equal(missing.code, 'stale');
  assert.equal(missing.message.includes('t_1a2b3c4d'), false);
  const odd = host(call => call.method === 'GET' ? detail() : { ok: false });
  assert.equal((await odd.call('kanban.comment', { board: 'default', id: 't_1a2b3c4d', body: 'x' })).code, 'unknown');
});
