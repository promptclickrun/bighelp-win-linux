import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeSessionList } from '../packages/contracts/session.ts';
import { decodeChatActivity, decodeChatDetail, decodeChatSearch, decodeMutationReceipt, decodeMutationSnapshot, snippetParts } from '../packages/contracts/chat-list.ts';
import { agentsByRecency, filterChats, groupChats, sortChats } from '../packages/ui/chat-list.ts';
import { parseDesktopAction } from '../apps/desktop/src/shared/desktop-api.ts';
import { CHAT_LIST_HANDLERS as CHAT_HANDLERS } from '../apps/desktop/src/main/calls/chats.ts';
import { CallError, callFailure } from '../apps/desktop/src/main/calls/context.ts';
import { createDesktopService } from '../apps/desktop/src/main/desktop-service.ts';
import { HttpStatusError, parseHttpOperation } from '../packages/platform/transport-policy.ts';
import { GatewayOperationError } from '../packages/hermes-client/gateway.ts';

// Synthetic rows shaped like the disposable Hermes 0.22.1 replies (hermes_cli/web_routers/sessions.py).
const S = 1792186270.1869812;
const restRow = (id, extra = {}) => ({ id, runtime_revision: 3, runtime_generation: 1, source: 'bighelp', model: 'synthetic-model',
  started_at: S, ended_at: null, message_count: 4, title: `Title ${id}`, title_source: 'llm', last_activity_at: S + 1,
  profile_name: 'agent', archived: false, auto_archived: 0, pinned: false, hidden: 0, cwd: '/synthetic/workspace',
  last_active: S + 30, preview: 'Synthetic preview', unread: false, is_active: false, profile: 'agent', is_default_profile: false, ...extra });
const searchRow = (id, extra = {}) => ({ snippet: 'how do I >>>rotate<<< the key', role: 'user', source: 'bighelp', model: null,
  session_started: S, last_active: S + 60, session_id: id, lineage_root: id, profile: 'agent', is_default_profile: false, id,
  title: 'Key rotation', started_at: S, ended_at: null, is_active: false, message_count: 2, tool_call_count: 0, input_tokens: 0,
  output_tokens: 0, preview: 'how do I rotate the key', parent_session_id: null, archived: false, ...extra });
const call = (name, input) => ({ kind: 'call', connection: 1, name, input });

test('chat calls refuse malformed, oversized and unknown input before any handler runs', () => {
  for (const input of [{ query: 'a', profiles: ['agent'] }, { query: '  a ', profiles: ['agent'] }, { query: 'ok', profiles: [] },
    { query: 'ok', profiles: ['agent', 'agent'] }, { query: 'ok', profiles: Array.from({ length: 17 }, (_, i) => `p${i}`) },
    { query: 'x'.repeat(201), profiles: ['agent'] }, { query: 'ok', profiles: ['../env'] }, { query: 'ok', profiles: ['agent'], url: '/api/env' },
    { query: 'line\nbreak', profiles: ['agent'] }]) {
    assert.throws(() => parseDesktopAction(call('chats.search', input)), JSON.stringify(input));
  }
  assert.deepEqual(parseDesktopAction(call('chats.search', { query: '  rotate key ', profiles: ['agent'] })).input, { query: 'rotate key', profiles: ['agent'] });
  for (const input of [{ profile: 'agent', chatId: 'c1', title: '' }, { profile: 'agent', chatId: 'c1', title: '   ' },
    { profile: 'agent', chatId: 'c1', title: 'x'.repeat(101) }, { profile: 'agent', chatId: 'c1', title: 'a\u0007b' },
    { profile: 'agent', chatId: 'c/1', title: 'ok' }, { profile: 'agent', chatId: '..', title: 'ok' },
    { profile: 'agent', chatId: 'c1' }, { profile: 'agent', chatId: 'c1', title: 'ok', archived: true }]) {
    assert.throws(() => parseDesktopAction(call('chats.rename', input)), JSON.stringify(input));
  }
  assert.equal(parseDesktopAction(call('chats.rename', { profile: 'agent', chatId: 'c1', title: '  Q3   planning ' })).input.title, 'Q3 planning');
  for (const name of ['chats.archive', 'chats.delete']) {
    assert.throws(() => parseDesktopAction(call(name, { profile: 'agent' })));
    assert.throws(() => parseDesktopAction(call(name, { profile: 'agent', chatId: 'c1', request_id: 'x' })));
    assert.throws(() => parseDesktopAction(call(name, { profile: 'agent', chatId: 'c 1' })));
  }
  assert.throws(() => parseDesktopAction(call('chats.capabilities', { probe: true })));
  assert.deepEqual(parseDesktopAction({ kind: 'openChat', generation: 2, chatId: 'c1', profile: 'agent' }), { kind: 'openChat', generation: 2, chatId: 'c1', profile: 'agent' });
  assert.throws(() => parseDesktopAction({ kind: 'openChat', generation: 2, chatId: 'c1', profile: '' }));
  assert.throws(() => parseDesktopAction({ kind: 'openChat', generation: 2, chatId: 'c1', profile: 'agent', title: 'x' }));
});

test('catalog times decode from session.list and REST rows; unknown fields are dropped', () => {
  const [row] = decodeSessionList({ sessions: [{ id: 'c1', title: 'One', preview: 'p', started_at: S, message_count: 4, source: 'bighelp', _lineage_root_id: null }] }, 'agent');
  assert.deepEqual(row, { id: 'c1', profile: 'agent', title: 'One', preview: 'p', startedAt: Math.round(S * 1000) });
  assert.equal(decodeSessionList({ sessions: [{ id: 'c2', started_at: 0 }] }, 'agent')[0].startedAt, null);
  const activity = decodeChatActivity({ sessions: [restRow('c1'), restRow('c2', { last_active: null }), { id: 'bad id\n' }, restRow('c3', { last_active: 'soon', last_activity_at: -1 })],
    total: 4, limit: 100, offset: 0, storage: {} }, 'agent');
  assert.deepEqual(activity, [{ id: 'c1', updatedAt: Math.round((S + 30) * 1000) }, { id: 'c2', updatedAt: Math.round((S + 1) * 1000) }]);
  assert.equal(JSON.stringify(activity).includes('synthetic/workspace'), false);
  assert.throws(() => decodeChatActivity({ sessions: [restRow('c1', { profile: 'other' })] }, 'agent'));
  assert.throws(() => decodeChatActivity({ rows: [] }, 'agent'));
});

test('host search decodes real-shaped hits, renders match markers as plain parts and skips internal or malformed rows', () => {
  const hits = decodeChatSearch({ results: [searchRow('c1'), searchRow('c2', { archived: true, snippet: 'Session ID: c2', last_active: null }),
    searchRow('c3', { source: 'kanban' }), searchRow('bad id'), searchRow('c1')] }, 'agent');
  assert.deepEqual(hits.map(hit => hit.id), ['c1', 'c2']);
  assert.deepEqual(hits[0], { id: 'c1', profile: 'agent', title: 'Key rotation', preview: 'how do I rotate the key',
    snippet: [{ text: 'how do I ', match: false }, { text: 'rotate', match: true }, { text: ' the key', match: false }],
    startedAt: Math.round(S * 1000), updatedAt: Math.round((S + 60) * 1000), archived: false });
  assert.equal(hits[1].archived, true); assert.equal(hits[1].updatedAt, null);
  assert.ok(Object.isFrozen(hits) && Object.isFrozen(hits[0]) && Object.isFrozen(hits[0].snippet));
  assert.deepEqual(snippetParts('<b> >>>x<<< </b> unclosed >>>tail'), [{ text: '<b> ', match: false }, { text: 'x', match: true }, { text: ' </b> unclosed tail', match: false }]);
  assert.throws(() => decodeChatSearch({ results: [searchRow('c1', { profile: 'other' })] }, 'agent'));
  assert.throws(() => decodeChatSearch({ results: [searchRow('c1', { archived: 'yes' })] }, 'agent'));
  assert.deepEqual(decodeChatSearch({ results: [] }, 'agent'), []);
});

test('mutation snapshot, receipt and detail decoders are strict about identity and counters', () => {
  assert.deepEqual(decodeMutationSnapshot({ session_id: 'c1', exists: true, runtime_revision: 3, runtime_generation: 1 }, 'c1'), { exists: true, revision: 3, generation: 1 });
  assert.deepEqual(decodeMutationSnapshot({ session_id: 'c1', exists: false, runtime_revision: 0, runtime_generation: null }, 'c1'), { exists: false, revision: 0, generation: null });
  for (const bad of [{ session_id: 'c2', exists: true, runtime_revision: 3, runtime_generation: 1 }, { session_id: 'c1', exists: 'yes', runtime_revision: 3, runtime_generation: 1 },
    { session_id: 'c1', exists: true, runtime_revision: -1, runtime_generation: 1 }, { session_id: 'c1', exists: true, runtime_revision: 3, runtime_generation: null }]) {
    assert.throws(() => decodeMutationSnapshot(bad, 'c1'));
  }
  decodeMutationReceipt({ ok: true, session_id: 'c1', revision: 4, execution_generation: 1, operation: 'sidebar', title: 'x' }, 'c1', 'sidebar');
  decodeMutationReceipt({ ok: true, already_absent: true }, 'c1', 'delete');
  assert.throws(() => decodeMutationReceipt({ ok: true, already_absent: true }, 'c1', 'sidebar'));
  assert.throws(() => decodeMutationReceipt({ ok: true, session_id: 'c9', operation: 'delete' }, 'c1', 'delete'));
  const detail = decodeChatDetail({ ...restRow('c1'), archived: 1, last_active: null, preview: null, system_prompt: 'hidden text' }, 'c1', 'agent');
  assert.deepEqual(detail, { id: 'c1', title: 'Title c1', preview: '', startedAt: Math.round(S * 1000), updatedAt: Math.round((S + 1) * 1000), hidden: false });
  assert.equal(decodeChatDetail({ id: 'c1', hidden: 1 }, 'c1', 'agent').hidden, true);
  assert.throws(() => decodeChatDetail({ id: 'c2' }, 'c1', 'agent'));
  assert.throws(() => decodeChatDetail({ id: 'c1', profile_name: 'other' }, 'c1', 'agent'));
});

test('day groups follow local calendar days; undated chats stay first without a caption', () => {
  const now = new Date(2026, 9, 16, 9, 30);
  const at = (days, hours = 8) => new Date(2026, 9, 16 - days, hours).getTime();
  const chats = [
    { id: 'old', agentId: 'a', title: 'Old', preview: '', transcript: [], startedAt: at(40) },
    { id: 'week', agentId: 'b', title: 'Week', preview: '', transcript: [], updatedAt: at(6, 23), startedAt: at(30) },
    { id: 'saved', agentId: 'a', title: 'Saved copy', preview: '', transcript: [] },
    { id: 'today', agentId: 'b', title: 'Today', preview: '', transcript: [], updatedAt: at(0, 0) },
    { id: 'late', agentId: 'a', title: 'Late', preview: '', transcript: [], updatedAt: at(1, 23) },
    { id: 'edge', agentId: 'a', title: 'Edge', preview: '', transcript: [], updatedAt: at(7, 0) },
    { id: 'older', agentId: 'a', title: 'Older', preview: '', transcript: [], updatedAt: at(7, 0) - 1 },
  ];
  assert.deepEqual(groupChats(chats, now).map(group => [group.label, group.chats.map(chat => chat.id)]), [
    [null, ['saved']], ['Today', ['today']], ['Yesterday', ['late']], ['Previous 7 days', ['week', 'edge']], ['Older', ['older', 'old']]]);
  assert.deepEqual(sortChats([{ id: 'x', updatedAt: 1 }, { id: 'y' }, { id: 'z', updatedAt: 2 }, { id: 'w' }]).map(chat => chat.id), ['y', 'w', 'z', 'x']);
  // A daylight-saving change still starts "Today" at local midnight.
  const spring = new Date(2026, 2, 9, 12);
  assert.equal(groupChats([{ id: 'm', agentId: 'a', title: '', preview: '', transcript: [], updatedAt: new Date(2026, 2, 9, 0, 30).getTime() }], spring)[0].label, 'Today');
  const agents = [{ id: 'a', name: 'Ágata', summary: '', color: '' }, { id: 'b', name: 'Otto', summary: '', color: '' }, { id: 'c', name: 'Unused', summary: '', color: '' }];
  assert.deepEqual(filterChats(chats, agents, 'agata sav').map(chat => chat.id), ['saved']);
  assert.deepEqual(filterChats(chats, agents, '  ').length, chats.length);
  assert.deepEqual(agentsByRecency(agents, chats).map(agent => agent.id), ['a', 'b', 'c']);
  assert.deepEqual(agentsByRecency(agents, chats.filter(chat => chat.id === 'today')).map(agent => agent.id), ['b', 'a', 'c']);
});

// A CallContext double. Every route is re-parsed by the real transport policy.
function harness({ http, rpc = async () => { throw new GatewayOperationError(-32601); }, open = null } = {}) {
  const log = { http: [], rpc: [], closed: [], refreshed: 0 };
  let ids = 0;
  const context = Object.freeze({
    identity: { kind: 'dashboard' },
    async http(route) { parseHttpOperation({ kind: 'route', ...route }); log.http.push(route); return { body: await http(route), status: 200 }; },
    async rpc(method, params, options) { log.rpc.push({ method, params, options }); return rpc(method, params); },
    async nativeContext() { throw new HttpStatusError(404); },
    requireProfile(profile) { if (profile !== 'agent') throw new CallError('stale', 'That agent is no longer on your computer.'); return profile; },
    openChat: () => open, closeChat(profile, id) { log.closed.push([profile, id]); },
    isCurrent: () => true, async refreshCatalog() { log.refreshed++; },
    requestId: () => `${String(++ids).padStart(8, '0')}-89ab-cdef-0123-456789abcdef`,
  });
  return { context, log };
}
const snapshotReply = (revision = 3, generation = 1) => ({ session_id: 'c1', exists: true, runtime_revision: revision, runtime_generation: generation });
const run = (name, context, input) => CHAT_HANDLERS[name].run(context, input).then(value => ({ ok: true, value }), error => callFailure(error, CHAT_HANDLERS[name].mutation));

test('rename, archive and delete send the fenced Hermes mutation with the snapshot identity', async () => {
  const rename = harness({ http: async route => route.method === 'GET' ? snapshotReply()
    : { ok: true, session_id: 'c1', revision: 4, execution_generation: 1, operation: 'sidebar', title: 'Q3 planning' } });
  assert.deepEqual(await run('chats.rename', rename.context, { profile: 'agent', chatId: 'c1', title: 'Q3 planning' }), { ok: true, value: { title: 'Q3 planning' } });
  assert.deepEqual(rename.log.http[0], { method: 'GET', path: '/api/sessions/c1/mutation-snapshot', query: { profile: 'agent' }, maxBytes: 16384 });
  assert.equal(rename.log.http[1].method, 'PATCH'); assert.equal(rename.log.http[1].path, '/api/sessions/c1');
  assert.deepEqual(JSON.parse(rename.log.http[1].body), { profile: 'agent', title: 'Q3 planning', request_id: '00000001-89ab-cdef-0123-456789abcdef', expected_revision: 3, expected_generation: 1 });
  assert.equal(rename.log.refreshed, 1); assert.deepEqual(rename.log.closed, []);

  const archive = harness({ http: async route => route.method === 'GET' ? snapshotReply(7, 2) : { ok: true, session_id: 'c1', revision: 8, operation: 'sidebar', archived: true } });
  assert.equal((await run('chats.archive', archive.context, { profile: 'agent', chatId: 'c1' })).ok, true);
  assert.deepEqual(JSON.parse(archive.log.http[1].body), { profile: 'agent', archived: true, request_id: '00000001-89ab-cdef-0123-456789abcdef', expected_revision: 7, expected_generation: 2 });
  assert.deepEqual(archive.log.closed, [['agent', 'c1']]); assert.equal(archive.log.refreshed, 1);

  const remove = harness({ http: async route => route.method === 'GET' ? snapshotReply(5, 0) : { ok: true, session_id: 'c1', revision: 6, operation: 'delete', deleted_ids: ['c1'] },
    rpc: async method => method === 'session.active_list' ? { sessions: [{ id: 'rt-old', session_key: 'c1', status: 'idle' }, { id: 'rt-x', session_key: 'other', status: 'working' }] } : { closed: true, messages: [] } });
  assert.equal((await run('chats.delete', remove.context, { profile: 'agent', chatId: 'c1' })).ok, true);
  assert.deepEqual(remove.log.http[1], { method: 'DELETE', path: '/api/sessions/c1', maxBytes: 65536,
    query: { profile: 'agent', request_id: '00000001-89ab-cdef-0123-456789abcdef', expected_revision: '5', expected_generation: '0' } });
  assert.equal(remove.log.http[1].body, undefined);
  assert.deepEqual(remove.log.rpc.map(entry => [entry.method, entry.params]), [['session.active_list', { profile: 'agent' }], ['session.close', { session_id: 'rt-old' }]]);
  assert.deepEqual(remove.log.closed, [['agent', 'c1']]);
  const absent = harness({ http: async route => route.method === 'GET' ? snapshotReply() : { ok: true, already_absent: true }, rpc: async () => ({ sessions: [] }) });
  assert.equal((await run('chats.delete', absent.context, { profile: 'agent', chatId: 'c1' })).ok, true);
});

test('Hermes refusals map to plain words; 409 says the chat changed and never leaks another chat ID', async () => {
  const refuse = (status, detail) => harness({ http: async route => { if (route.method === 'GET') return snapshotReply(); throw new HttpStatusError(status, detail); } });
  for (const detail of ['revision_conflict', 'stale_generation', 'mutation_identity_required', 'admission_conflict']) {
    assert.deepEqual(await run('chats.archive', refuse(409, detail).context, { profile: 'agent', chatId: 'c1' }),
      { ok: false, code: 'conflict', message: 'This chat changed on your computer. Try again.' });
  }
  assert.equal((await run('chats.archive', refuse(409, 'session_busy').context, { profile: 'agent', chatId: 'c1' })).message, 'This chat is busy. Try again when the agent finishes.');
  const duplicate = await run('chats.rename', refuse(400, "Title 'x' is already in use by session 20261016_101500_ab12cd").context, { profile: 'agent', chatId: 'c1', title: 'x' });
  assert.deepEqual(duplicate, { ok: false, code: 'invalid', message: 'Another chat already has that name.' });
  assert.equal((await run('chats.rename', refuse(400, 'Title too long (101 chars, max 100)').context, { profile: 'agent', chatId: 'c1', title: 'x' })).message, 'Use a name up to 100 characters.');
  assert.equal((await run('chats.delete', refuse(404, 'not_found').context, { profile: 'agent', chatId: 'c1' })).code, 'stale');
  assert.equal((await run('chats.archive', refuse(403, 'permission_denied').context, { profile: 'agent', chatId: 'c1' })).code, 'denied');
  assert.equal((await run('chats.archive', refuse(500, '').context, { profile: 'agent', chatId: 'c1' })).code, 'unknown');
  const gone = harness({ http: async () => ({ session_id: 'c1', exists: false, runtime_revision: 0, runtime_generation: null }) });
  assert.equal((await run('chats.archive', gone.context, { profile: 'agent', chatId: 'c1' })).code, 'stale'); assert.equal(gone.log.http.length, 1);
  const old = harness({ http: async () => { throw new HttpStatusError(404, 'Not Found'); } });
  assert.equal((await run('chats.rename', old.context, { profile: 'agent', chatId: 'c1', title: 'x' })).code, 'unsupported');
  assert.equal((await run('chats.archive', harness({ http: async () => snapshotReply() }).context, { profile: 'other', chatId: 'c1' })).code, 'stale');
});

test('a lost reply keeps the request identity for an explicit retry; a definite refusal drops it', async () => {
  let attempt = 0;
  const lost = harness({ http: async route => {
    if (route.method === 'GET') return snapshotReply(3 + attempt, 1);
    if (++attempt === 1) throw new Error('outcome-unknown');
    return { ok: true, session_id: 'c1', revision: 4, operation: 'sidebar', archived: true };
  } });
  assert.equal((await run('chats.archive', lost.context, { profile: 'agent', chatId: 'c1' })).code, 'unknown');
  assert.equal((await run('chats.archive', lost.context, { profile: 'agent', chatId: 'c1' })).ok, true);
  const writes = lost.log.http.filter(route => route.method === 'PATCH').map(route => JSON.parse(route.body));
  assert.equal(lost.log.http.filter(route => route.method === 'GET').length, 1, 'retry reuses the retained snapshot');
  assert.deepEqual(writes[0], writes[1]);
  let conflicts = 0;
  const refused = harness({ http: async route => { if (route.method === 'GET') return snapshotReply(3 + conflicts, 1); if (++conflicts === 1) throw new HttpStatusError(409, 'revision_conflict'); return { ok: true, session_id: 'c1', operation: 'sidebar' }; } });
  assert.equal((await run('chats.archive', refused.context, { profile: 'agent', chatId: 'c1' })).code, 'conflict');
  assert.equal((await run('chats.archive', refused.context, { profile: 'agent', chatId: 'c1' })).ok, true);
  const patches = refused.log.http.filter(route => route.method === 'PATCH').map(route => JSON.parse(route.body));
  assert.notEqual(patches[0].request_id, patches[1].request_id); assert.equal(patches[1].expected_revision, 4);
});

test('the open chat renames through its live runtime; a store owned by a gateway falls back to the socket methods', async () => {
  const open = { profile: 'agent', storedSessionId: 'c1', runtimeId: 'rt-1' };
  const live = harness({ open, http: async () => { throw Error('REST not expected'); }, rpc: async () => ({ pending: false, title: 'Q3 planning' }) });
  assert.deepEqual(await run('chats.rename', live.context, { profile: 'agent', chatId: 'c1', title: 'Q3 planning' }), { ok: true, value: { title: 'Q3 planning' } });
  assert.deepEqual(live.log.rpc.map(entry => [entry.method, entry.params]), [['session.title', { session_id: 'rt-1', title: 'Q3 planning' }]]);
  const taken = harness({ open, http: async () => snapshotReply(), rpc: async () => { throw new GatewayOperationError(4022, '', "Title 'x' is already in use by session 20261016_101500_ab12cd"); } });
  assert.deepEqual(await run('chats.rename', taken.context, { profile: 'agent', chatId: 'c1', title: 'x' }), { ok: false, code: 'invalid', message: 'Another chat already has that name.' });

  const owned = 'Exclusive maintenance refused: Gateway runtime already owns profile /synthetic/home. Drain and stop the gateway, then retry.';
  const busyStore = rpc => harness({ open, rpc, http: async route => { if (route.method === 'GET') return snapshotReply(); throw new HttpStatusError(409, owned); } });
  const archive = busyStore(async () => ({ archived: true, session_key: 'c1' }));
  assert.equal((await run('chats.archive', archive.context, { profile: 'agent', chatId: 'c1' })).ok, true);
  assert.deepEqual(archive.log.rpc.map(entry => [entry.method, entry.params]), [['session.archive', { session_id: 'c1', archived: true, profile: 'agent' }]]);
  const remove = busyStore(async method => method === 'session.active_list' ? { sessions: [] } : method === 'session.close' ? { closed: true } : { deleted: 'c1' });
  assert.equal((await run('chats.delete', remove.context, { profile: 'agent', chatId: 'c1' })).ok, true);
  assert.deepEqual(remove.log.rpc.map(entry => [entry.method, entry.params]), [['session.active_list', { profile: 'agent' }],
    ['session.close', { session_id: 'rt-1' }], ['session.delete', { session_id: 'c1', profile: 'agent' }]]);
  assert.deepEqual(remove.log.closed, [['agent', 'c1'], ['agent', 'c1']]);
  const elsewhere = busyStore(async method => { if (method === 'session.delete') throw new GatewayOperationError(4023, '', 'cannot delete an active session'); return { sessions: [] }; });
  const refusal = await run('chats.delete', elsewhere.context, { profile: 'agent', chatId: 'c1' });
  assert.equal(refusal.code, 'conflict'); assert.match(refusal.message, /open in another app/);
  const running = busyStore(async () => ({ sessions: [{ id: 'rt-2', session_key: 'c1', status: 'working' }] }));
  assert.equal((await run('chats.delete', running.context, { profile: 'agent', chatId: 'c1' })).message, 'This chat is busy. Try again when the agent finishes.');
  assert.equal(running.log.http.some(route => route.method === 'DELETE'), false); assert.deepEqual(running.log.closed, []);
  const notOpen = harness({ http: async route => { if (route.method === 'GET') return snapshotReply(); throw new HttpStatusError(409, owned); } });
  const result = await run('chats.rename', notOpen.context, { profile: 'agent', chatId: 'c1', title: 'x' });
  assert.equal(result.code, 'conflict'); assert.match(result.message, /only an open chat can be renamed/);
});

test('capabilities hide actions an older Hermes cannot do; search merges profiles and reports partial results', async () => {
  const modern = harness({ http: async route => route.path === '/api/sessions/search' ? { results: [] }
    : { session_id: 'bighelp-capability-probe', exists: false, runtime_revision: 0, runtime_generation: null } });
  assert.deepEqual(await CHAT_HANDLERS['chats.capabilities'].run(modern.context, {}), { search: true, manage: true });
  const older = harness({ http: async () => { throw new HttpStatusError(404, 'Not Found'); } });
  assert.deepEqual(await CHAT_HANDLERS['chats.capabilities'].run(older.context, {}), { search: false, manage: false });
  const search = harness({ http: async route => ({ results: [searchRow('c1', { last_active: S }), searchRow('c2', { last_active: S + 99 })] }) });
  const found = await CHAT_HANDLERS['chats.search'].run(search.context, { query: 'rotate', profiles: ['agent'] });
  assert.deepEqual(found.results.map(hit => hit.id), ['c2', 'c1']); assert.equal(found.partial, false);
  assert.deepEqual(search.log.http[0].query, { q: 'rotate', profile: 'agent', limit: '20', exclude_sources: 'kanban,tool,oneshot' });
  const failing = harness({ http: async () => { throw new HttpStatusError(500, 'Search failed'); } });
  assert.equal((await run('chats.search', failing.context, { query: 'rotate', profiles: ['agent'] })).code, 'unavailable');
});

// Desktop service with a gateway double shaped like the disposable host.
function service({ rows = [], activity = async () => ({ sessions: [] }), detail, rpc } = {}) {
  const calls = [];
  let current = rows;
  const gateway = { exclusiveSubmit: true, close() {}, restoreRequests() {},
    async requestHttp(op) {
      calls.push(op.kind === 'route' ? `${op.method} ${op.path}` : op.kind);
      if (op.kind === 'health') return { body: { ok: true, auth_required: false } };
      if (op.kind === 'route' && op.path === '/api/sessions') return { body: await activity(op) };
      if (op.kind === 'canonicalSessionDetail') return { body: detail(op) };
      if (op.kind === 'route' && op.path.endsWith('/mutation-snapshot')) return { body: { session_id: op.path.split('/')[3], exists: true, runtime_revision: 1, runtime_generation: 0 } };
      if (op.kind === 'route' && op.method === 'DELETE') { const id = op.path.split('/')[3]; current = current.filter(row => row.id !== id); return { body: { ok: true, session_id: id, operation: 'delete', deleted_ids: [id] } }; }
      throw new HttpStatusError(404);
    },
    async operation(op) {
      calls.push(op.kind);
      if (op.kind === 'profilesList') return { profiles: [{ name: 'agent', display_name: 'Agent' }] };
      if (op.kind === 'sessionList') return { sessions: current };
      if (op.kind === 'sessionResume') return { session_id: `rt-${op.storedSessionId}`, stored_session_id: op.storedSessionId, info: { profile_name: 'agent' }, running: false };
      if (op.kind === 'sessionHistory') return { count: 0, messages: [] };
      return {};
    },
    async call(method, params) { calls.push(method); return rpc ? rpc(method, params) : { sessions: [] }; },
  };
  const values = new Map();
  const repository = { async read(key) { return values.get(key) ?? null; },
    async write(key, revision, value) { const next = { revision: (revision ?? 0) + 1, value }; values.set(key, next); return next; } };
  const desktop = createDesktopService({ repository, connect: async () => gateway, onChange() {} });
  return { desktop, calls };
}
const host = { label: 'Synthetic computer', endpoint: 'https://test.invalid', authentication: 'dashboard', token: 'synthetic', allowPrivateHttp: false };

test('the catalog orders chats across agents by Hermes last activity and keeps working without it', async () => {
  const rows = [{ id: 'older', title: 'Started last', started_at: S + 500 }, { id: 'newer', title: 'Active last', started_at: S }];
  const f = service({ rows, activity: async op => {
    assert.deepEqual({ ...op.query }, { profile: 'agent', limit: '100', order: 'recent', archived: 'exclude', exclude_sources: 'kanban,tool,oneshot' });
    return { sessions: [restRow('newer', { last_active: S + 900 }), restRow('older', { last_active: S + 600 })], total: 2, limit: 100, offset: 0, storage: {} };
  } });
  await f.desktop.handle({ kind: 'connect', host });
  assert.deepEqual(f.desktop.snapshot().data.chats.map(chat => [chat.id, chat.startedAt, chat.updatedAt]),
    [['newer', Math.round(S * 1000), Math.round((S + 900) * 1000)], ['older', Math.round((S + 500) * 1000), Math.round((S + 600) * 1000)]]);
  const offline = service({ rows, activity: async () => { throw new HttpStatusError(503, 'busy'); } });
  assert.equal((await offline.desktop.handle({ kind: 'connect', host })).ok, true);
  assert.deepEqual(offline.desktop.snapshot().data.chats.map(chat => [chat.id, chat.updatedAt]), [['older', undefined], ['newer', undefined]]);
});

test('a chat found by search opens from Hermes detail; hidden chats and unknown agents are refused', async () => {
  const f = service({ detail: op => ({ ...restRow(op.storedSessionId), title: 'Archived plan', archived: 1, hidden: op.storedSessionId === 'bot' ? 1 : 0 }) });
  await f.desktop.handle({ kind: 'connect', host });
  let s = f.desktop.snapshot();
  assert.equal((await f.desktop.handle({ kind: 'openChat', generation: s.generation, chatId: 'found' })).ok, false, 'unlisted chat needs a profile');
  s = f.desktop.snapshot();
  assert.equal((await f.desktop.handle({ kind: 'openChat', generation: s.generation, chatId: 'found', profile: 'agent' })).ok, true);
  s = f.desktop.snapshot();
  assert.equal(s.selectedChatId, 'found');
  assert.deepEqual(s.data.chats.map(chat => [chat.id, chat.title]), [['found', 'Archived plan']]);
  assert.equal((await f.desktop.handle({ kind: 'openChat', generation: s.generation, chatId: 'bot', profile: 'agent' })).ok, false);
  assert.equal((await f.desktop.handle({ kind: 'openChat', generation: f.desktop.snapshot().generation, chatId: 'x', profile: 'nobody' })).ok, false);
  assert.equal(f.calls.includes('sessionResume'), true);
});

test('deleting the open chat leaves it, selects nothing and re-reads the catalog', async () => {
  const f = service({ rows: [{ id: 'keep', title: 'Keep', started_at: S }, { id: 'gone', title: 'Gone', started_at: S }],
    rpc: async method => method === 'session.active_list' ? { sessions: [{ id: 'rt-gone', session_key: 'gone', status: 'idle' }] } : { closed: true } });
  await f.desktop.handle({ kind: 'connect', host });
  await f.desktop.handle({ kind: 'openChat', generation: f.desktop.snapshot().generation, chatId: 'gone' });
  const before = f.desktop.snapshot();
  assert.equal(before.selectedChatId, 'gone');
  const result = await f.desktop.call({ kind: 'call', connection: before.connection, name: 'chats.delete', input: { profile: 'agent', chatId: 'gone' } });
  assert.deepEqual(result, { ok: true, value: { deleted: true } });
  const after = f.desktop.snapshot();
  assert.equal(after.selectedChatId, null); assert.equal(after.canSend, false); assert.ok(after.generation > before.generation);
  assert.deepEqual(after.data.chats.map(chat => chat.id), ['keep']);
  assert.ok(f.calls.indexOf('session.close') < f.calls.indexOf('DELETE /api/sessions/gone'));
});

