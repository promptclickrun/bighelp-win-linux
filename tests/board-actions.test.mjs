import test from 'node:test';
import assert from 'node:assert/strict';
import { CALLS } from '../apps/desktop/src/shared/calls/index.ts';
import { parseDesktopAction } from '../apps/desktop/src/shared/desktop-api.ts';
import { decodeBoardItem, decodeWorkspaceBoard } from '../packages/contracts/workspace.ts';
import { boardActions, boardGroups, discussText, goalPrompt, letsDoItText } from '../packages/ui/board-actions.ts';
import { ALL_FEATURES, etag, nativeHost, run } from './native-host-fixture.mjs';
import { control, harness, has, nodes, textContent } from './ui-hook-harness.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
// BoardStore._item (agent_board.py:564-583), synthetic values.
const item = (overrides = {}) => ({ id: '9b1c2d3e4f5a46b7a8c9d0e1f2a3b4c5', kind: 'feed', title: 'Top AI stories', body: 'Three stories.',
  icon: '📰', section: '', status: '', note: '', links: [{ url: 'https://example.com/a', title: 'Story A' }], images: [], files: [],
  source: 'Evening digest', liked: false, rating: 'none', reason: '', read: false, dismissed: false, answer: 'none', category: '',
  createdAt: 1792345678, updatedAt: 1792345678, ...overrides });
const boardReply = (body, plan, overrides = {}) => ({ body: { agentId: body.agentId, item: item({ id: body.itemId, ...overrides }) } });

test('thumbs down with a reason sends the exact native request and decodes the confirmed item', async () => {
  const host = nativeHost((path, body, plan) => {
    assert.equal(path, '/api/plugins/loopdy/native/board/update');
    return boardReply(body, plan, { rating: 'down', reason: body.reason });
  });
  const result = await run(host.context, 'board.update', { profile: 'agent', itemId: '9b1c2d3e4f5a46b7a8c9d0e1f2a3b4c5', rating: 'down', reason: 'Too frequent' });
  assert.equal(result.ok, true);
  assert.equal(result.value.rating, 'down'); assert.equal(result.value.reason, 'Too frequent');
  assert.deepEqual(result.value.links, [{ url: 'https://example.com/a', title: 'Story A' }]);
  const [plan] = host.posts();
  assert.equal(plan.url, 'https://hermes.example/api/plugins/loopdy/native/board/update');
  assert.equal(plan.body, '{"agentId":"agent","itemId":"9b1c2d3e4f5a46b7a8c9d0e1f2a3b4c5","rating":"down","reason":"Too frequent"}');
  assert.equal(plan.headers['If-Match'], etag);
  assert.match(plan.headers['X-Loopdy-Request-ID'], UUID);
  assert.equal(plan.headers['Content-Type'], 'application/json');
  assert.equal(plan.headers['X-Hermes-Session-Token'], 'synthetic-token');
  assert.equal(plan.maxResponseBytes, 196608);
  assert.equal(host.state.plans.length, 2, 'one context read, one write');
});

test('each board write has its exact body and route', async () => {
  const cases = [
    ['board.update', { itemId: 'post-1', rating: 'up' }, 'board/update', { agentId: 'agent', itemId: 'post-1', rating: 'up' }],
    ['board.update', { itemId: 'post-1', rating: 'none' }, 'board/update', { agentId: 'agent', itemId: 'post-1', rating: 'none' }],
    ['board.update', { itemId: 'post-1', read: false }, 'board/update', { agentId: 'agent', itemId: 'post-1', read: false }],
    ['board.update', { itemId: 'post-1', dismissed: true }, 'board/update', { agentId: 'agent', itemId: 'post-1', dismissed: true }],
    ['board.update', { itemId: 'post-1', dismissed: false }, 'board/update', { agentId: 'agent', itemId: 'post-1', dismissed: false }],
    ['board.update', { itemId: 'g-run-10k', status: 'done' }, 'board/update', { agentId: 'agent', itemId: 'g-run-10k', status: 'done' }],
    ['board.read', { itemIds: ['a', 'b.c'], read: true }, 'board/read', { agentId: 'agent', itemIds: ['a', 'b.c'], read: true }],
    ['board.promote', { itemId: 'idea-1' }, 'board/promote', { agentId: 'agent', itemId: 'idea-1' }],
    ['board.accept', { itemId: 'idea-1' }, 'board/accept', { agentId: 'agent', itemId: 'idea-1' }],
  ];
  for (const [name, input, route, body] of cases) {
    const host = nativeHost((path, sent) => {
      assert.equal(path, `/api/plugins/loopdy/native/${route}`);
      if (route === 'board/read') return { body: { agentId: 'agent', updated: 2 } };
      if (route === 'board/promote') return { body: { agentId: 'agent', item: item({ id: 'goal-new', kind: 'goal', status: 'active', section: 'goal', source: 'From an idea' }) } };
      return { body: { agentId: 'agent', item: item({ id: sent.itemId, kind: route === 'board/accept' ? 'idea' : 'feed', answer: route === 'board/accept' ? 'yes' : 'none' }) } };
    });
    const result = await run(host.context, name, { profile: 'agent', ...input });
    assert.equal(result.ok, true, `${name} ${JSON.stringify(input)} ${result.message}`);
    assert.deepEqual(JSON.parse(host.posts()[0].body), body);
    assert.equal(host.posts().length, 1);
  }
});

test('actions are gated on the plugin features exactly as the Mac app gates them', async () => {
  const base = ['native-context-v1', 'serving-profile-v1', 'native-agent-board-v1'];
  const host = nativeHost((path, body) => ({ body: { agentId: 'agent', item: item({ id: body.itemId, rating: body.liked ? 'up' : 'none', liked: !!body.liked }) } }),
    { features: base });
  // An older plugin has only the heart.
  const up = await run(host.context, 'board.update', { profile: 'agent', itemId: 'post-1', rating: 'up' });
  assert.equal(up.ok, true);
  assert.deepEqual(JSON.parse(host.posts()[0].body), { agentId: 'agent', itemId: 'post-1', liked: true });
  for (const [name, input] of [['board.update', { itemId: 'post-1', rating: 'down' }], ['board.update', { itemId: 'post-1', read: true }],
    ['board.update', { itemId: 'post-1', rating: 'down', reason: 'Not relevant' }], ['board.read', { itemIds: ['post-1'], read: true }],
    ['board.promote', { itemId: 'idea-1' }], ['board.accept', { itemId: 'idea-1' }]]) {
    const result = await run(host.context, name, { profile: 'agent', ...input });
    assert.equal(result.code, 'unsupported', name);
  }
  assert.equal(host.posts().length, 1, 'refused before sending');
  const none = nativeHost(() => assert.fail('no board feature, no request'), { features: ['native-context-v1', 'serving-profile-v1'] });
  assert.equal((await run(none.context, 'board.update', { profile: 'agent', itemId: 'x', dismissed: true })).code, 'unsupported');
  const answersOnly = nativeHost(() => assert.fail('no answers feature'), { features: ALL_FEATURES.filter(f => f !== 'native-agent-board-answers-v1') });
  assert.equal((await run(answersOnly.context, 'board.accept', { profile: 'agent', itemId: 'idea-1' })).code, 'unsupported');
});

test('update and read go once more after 412 with a fresh context; promote and accept never do', async () => {
  for (const name of ['board.update', 'board.read']) {
    let calls = 0;
    const host = nativeHost((path, body) => {
      calls += 1;
      if (calls === 1) return { status: 412, body: { error: { code: 'context_changed', message: 'The native context changed; refresh before retrying.' } } };
      return name === 'board.read' ? { body: { agentId: 'agent', updated: 1 } } : { body: { agentId: 'agent', item: item({ id: body.itemId, read: true }) } };
    });
    const input = name === 'board.read' ? { itemIds: ['post-1'], read: true } : { itemId: 'post-1', read: true };
    const result = await run(host.context, name, { profile: 'agent', ...input });
    assert.equal(result.ok, true, name);
    const [first, second] = host.posts();
    assert.notEqual(first.headers['X-Loopdy-Request-ID'], second.headers['X-Loopdy-Request-ID']);
    assert.equal(first.body, second.body);
    assert.equal(host.state.plans.filter(plan => plan.method === 'GET').length, 2, 'context read again');
    const again = nativeHost(() => ({ status: 412, body: { error: { code: 'context_changed', message: 'x' } } }));
    assert.equal((await run(again.context, name, { profile: 'agent', ...input })).code, 'conflict');
    assert.equal(again.posts().length, 2, 'only one extra try');
  }
  for (const name of ['board.promote', 'board.accept']) {
    const host = nativeHost(() => ({ status: 412, body: { error: { code: 'context_changed', message: 'The native context changed; reconcile the outcome.' } } }));
    const result = await run(host.context, name, { profile: 'agent', itemId: 'idea-1' });
    assert.equal(result.code, 'unknown', `${name}: a 412 may come after the change`);
    assert.equal(host.posts().length, 1, `${name} is never resent`);
  }
});

test('a lost or unreadable write reply is "not sure", while plugin refusals are plain and certain', async () => {
  const replies = [
    [() => { throw new Error('socket closed https://hermes.example/?token=synthetic-token'); }, 'unknown'],
    [() => ({ status: 503, body: { error: { code: 'native_service_unavailable', message: 'x' } } }), 'unknown'],
    [() => ({ status: 502, body: null }), 'unknown'],
    [(path, body, plan) => ({ body: { agentId: 'agent', item: item({ id: 'idea-1', kind: 'goal' }) }, headers: { etag: `"sha256:${'d'.repeat(64)}"`, 'x-loopdy-request-id': plan.headers['X-Loopdy-Request-ID'] } }), 'unknown'],
    [(path, body) => ({ body: { agentId: 'agent', item: item({ id: 'idea-1', kind: 'goal' }) }, headers: { etag, 'x-loopdy-request-id': crypto.randomUUID() } }), 'unknown'],
    [() => ({ body: { agentId: 'agent', item: { id: 'x' } } }), 'unknown'],
    [() => ({ body: { agentId: 'other', item: item({ kind: 'goal' }) } }), 'unknown'],
    [() => ({ body: { agentId: 'agent', item: item({ kind: 'idea' }) } }), 'unknown'],
    [() => ({ status: 404, body: { error: { code: 'board_item_unavailable', message: 'That item is no longer available.' } } }), 'stale'],
    [() => ({ status: 404, body: { error: { code: 'profile_not_found', message: 'x' } } }), 'stale'],
    [() => ({ status: 503, body: { error: { code: 'board_unavailable', message: 'x' } } }), 'unsupported'],
    [() => ({ status: 422, body: { error: { code: 'invalid_request', message: 'The native request is invalid.' } } }), 'invalid'],
    [() => ({ status: 401, body: null }), 'denied'],
  ];
  for (const [reply, code] of replies) {
    const host = nativeHost(reply);
    const result = await run(host.context, 'board.promote', { profile: 'agent', itemId: 'idea-1' });
    assert.equal(result.code, code, reply.toString());
    assert.equal(result.message.includes('token'), false);
    assert.equal(host.posts().length, 1);
  }
});

test('a "not sure" Turn into a goal is checked through the board list before any retry', async () => {
  const states = [
    [[item({ id: 'idea-1', kind: 'idea', answer: 'goal', dismissed: true })], 'goal'],
    // The goal was made but the idea was not marked: still a goal, never a second one.
    [[item({ id: 'idea-1', kind: 'idea', source: '' }), item({ id: 'g', kind: 'goal', title: 'Top AI stories', source: 'From an idea', status: 'active' })], 'goal'],
    [[item({ id: 'idea-1', kind: 'idea' }), item({ id: 'g', kind: 'goal', title: 'Top AI stories', source: 'Other', status: 'active' })], 'idea'],
    [[item({ id: 'idea-1', kind: 'idea' })], 'idea'],
    [[], 'missing'],
  ];
  for (const [items, state] of states) {
    const host = nativeHost(path => { assert.equal(path, '/api/plugins/loopdy/native/board/list'); return { body: { agentId: 'agent', items } }; });
    const result = await run(host.context, 'board.checkPromote', { profile: 'agent', itemId: 'idea-1' });
    assert.deepEqual(result, { ok: true, value: { state } });
    assert.equal(host.posts()[0].body, '{"agentId":"agent","kinds":["idea","goal"],"limit":200,"includeDismissed":true}');
  }
});

test('board inputs are refused before main sends anything', () => {
  const bad = [
    ['board.update', { profile: 'agent', itemId: 'x' }],
    ['board.update', { profile: 'agent', itemId: 'x', reason: 'Too frequent' }],
    ['board.update', { profile: 'agent', itemId: 'x', rating: 'up', reason: 'Too frequent' }],
    ['board.update', { profile: 'agent', itemId: 'x', rating: 'down', reason: 'x'.repeat(121) }],
    ['board.update', { profile: 'agent', itemId: 'x', rating: 'down', reason: 'line\nbreak' }],
    ['board.update', { profile: 'agent', itemId: 'x', rating: 'meh' }],
    ['board.update', { profile: 'agent', itemId: 'x', status: 'archived' }],
    ['board.update', { profile: 'agent', itemId: 'x', read: 'yes' }],
    ['board.update', { profile: 'agent', itemId: 'x', dismissed: true, title: 'New title' }],
    ['board.update', { profile: 'agent', itemId: 'x', dismissed: true, note: 'Edited' }],
    ['board.update', { profile: 'agent', itemId: '../x', dismissed: true }],
    ['board.update', { profile: 'agent', itemId: '.hidden', dismissed: true }],
    ['board.update', { profile: 'agent', itemId: 'x'.repeat(65), dismissed: true }],
    ['board.update', { profile: 'agent', itemId: '', dismissed: true }],
    ['board.update', { profile: ' agent', itemId: 'x', dismissed: true }],
    ['board.read', { profile: 'agent', itemIds: [], read: true }],
    ['board.read', { profile: 'agent', itemIds: ['a', 'a'], read: true }],
    ['board.read', { profile: 'agent', itemIds: Array.from({ length: 201 }, (_, i) => `i${i}`), read: true }],
    ['board.read', { profile: 'agent', itemIds: ['a'] }],
    ['board.promote', { profile: 'agent', itemId: 'x', retry: true }],
    ['board.accept', { profile: 'agent', itemId: 'x', message: 'Yes, go ahead' }],
    ['board.checkPromote', { profile: 'agent' }],
  ];
  for (const [name, input] of bad) {
    assert.throws(() => CALLS[name].parse(input), `${name} ${JSON.stringify(input)}`);
    assert.throws(() => parseDesktopAction({ kind: 'call', connection: 1, name, input }));
  }
  assert.throws(() => parseDesktopAction({ kind: 'call', connection: 1, name: 'board.create', input: { profile: 'agent', title: 'x' } }));
  assert.ok(parseDesktopAction({ kind: 'call', connection: 1, name: 'board.update', input: { profile: 'agent', itemId: 'A.b_c-1', rating: 'down', reason: 'Not relevant' } }));
});

test('agents whose names the plugin cannot take, or that left, are refused without a request', async () => {
  const host = nativeHost(() => assert.fail('no request'));
  assert.equal((await run(host.context, 'board.update', { profile: 'Upper', itemId: 'x', dismissed: true })).code, 'unsupported');
  assert.equal((await run(host.context, 'board.update', { profile: 'gone', itemId: 'x', dismissed: true })).code, 'stale');
  assert.equal(host.state.plans.length, 0);
});

test('a proxy-wrapped context tag still sends the clean tag in If-Match', async () => {
  for (const contextTag of ['W/' + etag, etag.replace(/"$/u, '-gzip"')]) {
    const host = nativeHost((path, body) => ({ body: { agentId: 'agent', item: item({ id: body.itemId, dismissed: true }) } }), { contextTag });
    assert.equal((await run(host.context, 'board.update', { profile: 'agent', itemId: 'post-1', dismissed: true })).ok, true);
    assert.equal(host.posts()[0].headers['If-Match'], etag);
  }
});

test('board items keep display-only feedback fields and drop unsafe or unknown values', () => {
  const decoded = decodeBoardItem({ agentId: 'agent', item: item({ rating: 'down', reason: 'Too frequent', answer: 'not now', section: 'Health',
    links: [{ url: 'javascript:alert(1)', title: 'x' }, { url: 'https://user:pw@example.com/', title: 'x' }, { url: 'http://example.com/ok' }, 'junk'],
    extra: 'dropped' }) }, 'agent');
  assert.equal(decoded.rating, 'down'); assert.equal(decoded.reason, 'Too frequent'); assert.equal(decoded.answer, 'not now');
  assert.equal(decoded.section, 'Health'); assert.equal(decoded.source, 'Evening digest'); assert.equal(decoded.icon, '📰');
  assert.deepEqual(decoded.links, [{ url: 'http://example.com/ok' }]);
  assert.equal('extra' in decoded, false);
  const odd = decodeBoardItem({ agentId: 'agent', item: item({ rating: 'great', reason: 'kept only with down', answer: 'maybe', section: 7, links: 'x' }) }, 'agent');
  for (const key of ['rating', 'reason', 'answer', 'section', 'links']) assert.equal(key in odd, false, key);
  const heart = item({ liked: true }); delete heart.rating;
  assert.equal(decodeBoardItem({ agentId: 'agent', item: heart }, 'agent').rating, 'up');
  const board = decodeWorkspaceBoard({ agentId: 'agent', items: [item({ id: 'a', kind: 'idea' }), item({ id: 'b', kind: 'idea', dismissed: true }), item({ id: 'c' })] }, 'agent', 'ideas');
  assert.deepEqual(board.items.map(row => row.id), ['a']);
});

// ---- The board page: actions in the approved list/detail layout ----
const ALL = { feedback: true, answers: true, goalCategories: true };
const data = { sample: false, host: { label: 'Synthetic', state: 'connected' }, chats: [], workflows: [], agents: [{ id: 'one', name: 'One', summary: '', color: 'blue' }] };
const snapshot = (overrides = {}) => ({ generation: 1, connection: 3, revision: 1, status: 'connected', data, selectedChatId: null, running: false,
  canSend: false, notice: '', storageAvailable: true, prompts: [], drafts: {}, workspace: null, ...overrides });
const row = (overrides = {}) => ({ id: 'post-1', kind: 'feed', title: 'Top AI stories', body: 'Three stories.', status: '', read: false,
  rating: 'none', source: 'Evening digest', ...overrides });
function fakeApi() {
  const reads = [], calls = [], copied = [];
  const pending = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
  const api = {
    workspace(...args) { const held = pending(); reads.push({ args, ...held }); return held.promise; },
    call(connection, name, input) { const held = pending(); calls.push({ connection, name, input, ...held }); return held.promise; },
    copyText: async text => { copied.push(text); return true; },
    send() { throw new Error('Board actions never send a message'); },
  };
  return { api, reads, calls, copied };
}
async function page(kind, items, features = ALL) {
  const io = fakeApi(), started = [];
  const tab = kind === 'idea' ? 'ideas' : kind === 'goal' ? 'goals' : 'feed';
  const props = { api: io.api, snapshot: snapshot(), data, profile: 'one', page: tab, narrow: false, onStartChat: text => started.push(text) };
  const h = await harness('packages/ui/components/AgentBoard.tsx', 'AgentBoard', props);
  h.render();
  io.reads[0].resolve({ ok: true, snapshot: snapshot({ workspace: { profile: 'one', page: tab, status: 'loaded',
    data: { tab, items, ...(features ? { features } : {}) } } }) });
  await h.settle();
  return { h, io, started, props };
}
const ok = value => ({ ok: true, value });

test('feed: opening an unread post reads it once, and thumbs down asks why without requiring it', async () => {
  const { h, io } = await page('feed', [row()]);
  control(h, 'Top AI stories (unread)').onPress(); h.render(); await h.settle();
  assert.deepEqual(io.calls.map(call => [call.connection, call.name, call.input]), [[3, 'board.read', { profile: 'one', itemIds: ['post-1'], read: true }]]);
  io.calls[0].resolve(ok({ updated: 1 })); await h.settle();
  for (const label of ['Thumbs up', 'Thumbs down', 'Discuss', 'Mark as unread', 'Copy', 'Clear']) assert.ok(has(h, label), label);
  control(h, 'Thumbs down').onPress(); h.render();
  assert.deepEqual(io.calls[1].input, { profile: 'one', itemId: 'post-1', rating: 'down' });
  assert.match(textContent(h.value), /Less like this\?.*Optional\. It helps\s+One\s+post things you want\./s);
  io.calls[1].resolve(ok(row({ read: true, rating: 'down' }))); await h.settle();
  control(h, 'Too frequent').onPress(); h.render();
  assert.deepEqual(io.calls[2].input, { profile: 'one', itemId: 'post-1', rating: 'down', reason: 'Too frequent' });
  assert.doesNotMatch(textContent(h.value), /Less like this/);
  io.calls[2].resolve(ok(row({ read: true, rating: 'down', reason: 'Too frequent' }))); await h.settle();
  assert.match(textContent(h.value), /You said:\s+Too frequent/);
  assert.ok(has(h, 'Remove thumbs down'));
  assert.equal(io.calls.length, 3, 'opening the post again does not re-read it');
  h.unmount();
});

test('feed: Clear hides with Undo, and a lost reply rolls back as "not sure"', async () => {
  const { h, io } = await page('feed', [row({ read: true })]);
  control(h, 'Top AI stories').onPress(); h.render();
  control(h, 'Clear').onPress(); h.render();
  assert.deepEqual(io.calls[0].input, { profile: 'one', itemId: 'post-1', dismissed: true });
  assert.equal(has(h, 'Top AI stories'), false);
  assert.match(textContent(h.value), /Cleared “Top AI stories”/);
  io.calls[0].resolve(ok(row({ read: true, dismissed: true }))); await h.settle();
  control(h, 'Undo').onPress(); h.render();
  assert.deepEqual(io.calls[1].input, { profile: 'one', itemId: 'post-1', dismissed: false });
  io.calls[1].resolve(ok(row({ read: true, dismissed: false }))); await h.settle();
  assert.ok(has(h, 'Top AI stories'));
  control(h, 'Top AI stories').onPress(); h.render();
  control(h, 'Thumbs up').onPress(); h.render();
  assert.ok(has(h, 'Remove thumbs up'), 'shown at once');
  io.calls[2].resolve({ ok: false, code: 'unknown', message: 'Not sure this finished. Check before trying again.' }); await h.settle();
  assert.ok(has(h, 'Thumbs up'), 'rolled back');
  assert.match(textContent(h.value), /Not sure this was saved\. Refresh to check before trying again\./);
  control(h, 'Copy').onPress(); await h.settle();
  assert.deepEqual(io.copied, ['Top AI stories\n\nThree stories.']);
  assert.equal(io.calls.length, 3, 'nothing was retried');
  h.unmount();
});

test('ideas: Let’s do it records the yes, then only fills in a new chat', async () => {
  const idea = row({ id: 'idea-1', kind: 'idea', title: 'Plan meals', read: true, answer: 'none' });
  const { h, io, started } = await page('idea', [idea]);
  control(h, 'Plan meals').onPress(); h.render();
  for (const label of ["Let's do it", 'Start a chat about this', 'Turn into a goal', 'Not now']) assert.ok(has(h, label), label);
  control(h, "Let's do it").onPress(); h.render();
  assert.deepEqual([io.calls[0].name, io.calls[0].input], ['board.accept', { profile: 'one', itemId: 'idea-1' }]);
  assert.deepEqual(started, [], 'no chat before the yes is recorded');
  io.calls[0].resolve({ ok: false, code: 'unavailable', message: 'Could not reach Hermes.' }); await h.settle();
  assert.match(textContent(h.value), /Couldn’t tell One yet\. Check the connection and try again\./);
  control(h, 'Try again').onPress(); h.render();
  io.calls[1].resolve(ok({ ...idea, answer: 'yes' })); await h.settle();
  assert.deepEqual(started, ['Yes, go ahead with this idea: “Plan meals”.']);
  control(h, 'Start a chat about this').onPress();
  assert.equal(started.at(-1), 'About your idea “Plan meals”: ');
  assert.equal(io.calls.length, 2);
  h.unmount();
});

test('ideas: on an older plugin Let’s do it goes straight to the chat prefill', async () => {
  const idea = row({ id: 'idea-1', kind: 'idea', title: 'Plan meals', read: true });
  const { h, io, started } = await page('idea', [idea], { feedback: false, answers: false, goalCategories: false });
  control(h, 'Plan meals').onPress(); h.render();
  for (const label of ['Turn into a goal', 'Mark as unread', 'Mark as read']) assert.equal(has(h, label), false, label);
  control(h, "Let's do it").onPress();
  assert.deepEqual(started, [letsDoItText('Plan meals')]);
  assert.equal(io.calls.length, 0);
  h.unmount();
});

test('ideas: a "not sure" Turn into a goal is never resent; Check Goals decides', async () => {
  const idea = row({ id: 'idea-1', kind: 'idea', title: 'Plan meals', read: true });
  const { h, io } = await page('idea', [idea]);
  control(h, 'Plan meals').onPress(); h.render();
  control(h, 'Turn into a goal').onPress(); h.render();
  assert.deepEqual([io.calls[0].name, io.calls[0].input], ['board.promote', { profile: 'one', itemId: 'idea-1' }]);
  assert.equal(has(h, 'Plan meals'), false, 'hidden while it is made');
  io.calls[0].resolve({ ok: false, code: 'unknown', message: 'Not sure this finished.' }); await h.settle();
  assert.ok(has(h, 'Plan meals'), 'back until we know');
  assert.match(textContent(h.value), /Not sure this became a goal/);
  control(h, 'Plan meals').onPress(); h.render();
  assert.equal(control(h, 'Turn into a goal').disabled, true, 'no retry until checked');
  control(h, 'Check Goals').onPress(); h.render();
  assert.deepEqual([io.calls[1].name, io.calls[1].input], ['board.checkPromote', { profile: 'one', itemId: 'idea-1' }]);
  io.calls[1].resolve(ok({ state: 'goal' })); await h.settle();
  assert.equal(has(h, 'Plan meals'), false);
  assert.match(textContent(h.value), /“Plan meals” became a goal\. Find it in Goals\./);
  assert.equal(io.calls.filter(call => call.name === 'board.promote').length, 1);
  h.unmount();
});

test('goals: done toggles status and Create a goal only fills in a chat', async () => {
  const goal = row({ id: 'g-run', kind: 'goal', title: 'Run a 10k', status: 'active', category: 'health', read: true });
  const { h, io, started } = await page('goal', [goal, row({ id: 'g-done', kind: 'goal', title: 'Read 5 books', status: 'done', category: 'interests', read: true })]);
  const text = textContent(nodes(h.value, node => node.props?.role === 'list'));
  assert.ok(text.indexOf('Health') < text.indexOf('Run a 10k') && text.indexOf('Run a 10k') < text.indexOf('Done') && text.indexOf('Done') < text.indexOf('Read 5 books'), text);
  control(h, 'Run a 10k').onPress(); h.render();
  control(h, 'Mark done').onPress(); h.render();
  assert.deepEqual(io.calls[0].input, { profile: 'one', itemId: 'g-run', status: 'done' });
  io.calls[0].resolve(ok({ ...goal, status: 'done' })); await h.settle();
  assert.ok(has(h, 'Mark active'));
  control(h, 'Discuss').onPress();
  assert.equal(started.at(-1), 'About my goal “Run a 10k”: ');
  control(h, 'Create a goal. Opens a chat; nothing is sent until you press Send.').onPress(); h.render();
  control(h, 'Health').onPress(); h.render();
  assert.equal(started.at(-1), "I'd like to set a health goal. Ask me a few quick questions about what I'm after, then make a plan and add it to my Goals under Health.");
  assert.equal(io.calls.length, 1);
  h.unmount();
});

test('without plugin support or a connection the board offers only what works', async () => {
  const { h, io, props } = await page('feed', [row({ read: false })], null);
  control(h, 'Top AI stories').onPress(); h.render(); await h.settle();
  for (const label of ['Thumbs down', 'Mark as read', 'Mark as unread']) assert.equal(has(h, label), false, label);
  assert.ok(has(h, 'Thumbs up'), 'the heart works on every board plugin');
  assert.equal(io.calls.length, 0, 'no read marking without the feedback feature');
  h.render({ ...props, snapshot: snapshot({ status: 'disconnected' }) });
  assert.equal(nodes(h.value, node => node.props?.role === 'group').length, 0, 'no actions while disconnected');
  h.unmount();
});

test('action lists, groups and prefills follow the Mac wording', () => {
  const labels = (entry, features, chat = true) => boardActions(entry, features, chat).map(action => action.label);
  assert.deepEqual(labels(row(), ALL), ['Thumbs up', 'Thumbs down', 'Discuss', 'Mark as read', 'Copy', 'Clear']);
  assert.deepEqual(labels(row({ rating: 'up', read: true }), ALL), ['Remove thumbs up', 'Thumbs down', 'Discuss', 'Mark as unread', 'Copy', 'Clear']);
  assert.deepEqual(labels(row({ kind: 'idea' }), ALL), ["Let's do it", 'Start a chat about this', 'Turn into a goal', 'Mark as read', 'Copy', 'Not now']);
  assert.deepEqual(labels(row({ kind: 'goal', status: 'done' }), ALL), ['Mark active', 'Discuss', 'Mark as read', 'Copy', 'Remove']);
  assert.deepEqual(labels(row({ kind: 'idea' }), undefined, false), ['Copy', 'Not now']);
  assert.equal(discussText(row()), 'About “Top AI stories”: ');
  assert.equal(goalPrompt('other'), "I'd like to set a goal. Ask me a few quick questions about what I'm after, then make a plan and add it to my Goals.");
  assert.equal(goalPrompt('finance'), "I'd like to set a money goal. Ask me a few quick questions about what I'm after, then make a plan and add it to my Goals under Finance.");
  const ideas = boardGroups([row({ id: 'a', kind: 'idea', section: 'Health' }), row({ id: 'b', kind: 'idea' })], ALL);
  assert.deepEqual(ideas.map(group => [group.title, group.items.map(entry => entry.id)]), [['Health', ['a']], ['Other ideas', ['b']]]);
  const goals = boardGroups([row({ id: 'a', kind: 'goal', status: 'active', category: 'mystery' })], { ...ALL, goalCategories: false });
  assert.deepEqual(goals.map(group => group.title), ['Tracking']);
});
