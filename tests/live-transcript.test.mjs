import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EMPTY_LIVE, reduceLive, addOutgoing, afterHistory } from '../packages/domain/live-turn.ts';
import { decodeRestHistory, decodeRpcHistory, cleanUserText } from '../packages/contracts/history.ts';
import { projectRows, formatDuration } from '../packages/ui/transcript.ts';
import { toolFailed, toolPhrase, toolDetail } from '../packages/domain/tool-phrases.ts';

const run = (events, start = EMPTY_LIVE) => events.reduce((state, [type, payload = {}]) => reduceLive(state, type, payload, 1000), start);
const texts = state => state.items.filter(item => item.kind === 'message').map(item => item.paragraphs[0]);

test('a streamed reply accumulates, then the complete text is authoritative', () => {
  const state = run([['message.start'], ['message.delta', { text: '* Apple' }], ['message.delta', { text: '\n* Banana' }],
    ['message.complete', { text: '* Apple\n* Banana\n* Orange', status: 'complete' }], ['session.info', { running: false }]]);
  assert.deepEqual(texts(state), ['* Apple\n* Banana\n* Orange']);
  assert.equal(state.running, false);
  assert.equal(state.items[0].streaming, false);
});

test('empty, previewed or silence completions never erase or duplicate streamed text', () => {
  assert.deepEqual(texts(run([['message.start'], ['message.delta', { text: 'Hi' }], ['message.complete', { text: '' }]])), ['Hi']);
  const interim = run([['message.start'], ['message.delta', { text: 'Done.' }], ['message.interim', { text: 'Done.', already_streamed: true }],
    ['message.complete', { text: 'Done.', response_previewed: true }]]);
  assert.deepEqual(texts(interim), ['Done.']);
  assert.deepEqual(texts(run([['message.start'], ['message.delta', { text: 'NO_REPLY' }], ['message.complete', { text: 'NO_REPLY' }]])), []);
  assert.deepEqual(texts(run([['message.start'], ['message.delta', { text: 'draft' }], ['message.complete', { text: 'rewritten', response_transformed: true }]])), ['rewritten']);
});

test('interim commentary seals a bubble; tools sit between; later text starts a new bubble', () => {
  const state = run([['message.start'], ['message.delta', { text: 'Let me check.' }], ['message.interim', { text: 'Let me check.', already_streamed: true }],
    ['tool.generating', { name: 'terminal' }], ['tool.start', { tool_id: 'call_1', name: 'terminal', context: 'ls -F', args: { command: 'ls -F' } }],
    ['tool.complete', { tool_id: 'call_1', name: 'terminal', args: { command: 'ls -F' }, duration_s: 0.14, result: { output: 'a\nb', exit_code: 0, error: null } }],
    ['message.delta', { text: 'Two files.' }], ['message.complete', { text: 'Two files.', status: 'complete' }]]);
  assert.deepEqual(state.items.map(item => item.kind), ['message', 'tool', 'message']);
  const tool = state.items[1];
  assert.equal(tool.state, 'done'); assert.equal(tool.label, 'Ran a command'); assert.equal(tool.detail, 'ls -F'); assert.equal(tool.durationMs, 140);
  assert.match(tool.output, /exit_code/u);
});

test('failed tools use Hermes failure rule; unfinished tools become stopped at the bookend', () => {
  assert.equal(toolFailed({ exit_code: 1 }), true); assert.equal(toolFailed({ success: false }), true);
  assert.equal(toolFailed('{"error":"boom"}'), true); assert.equal(toolFailed({ output: 'ok', exit_code: 0, error: null }), false);
  assert.equal(toolFailed('plain text'), false);
  const state = run([['message.start'], ['tool.start', { tool_id: 'a', name: 'read_file', args: { path: '/x/notes.md' } }],
    ['tool.complete', { tool_id: 'a', name: 'read_file', result: { success: false } }],
    ['tool.start', { tool_id: 'b', name: 'web_search', context: 'rust' }], ['session.info', { running: false }]]);
  assert.deepEqual(state.items.map(item => item.state), ['failed', 'stopped']);
  assert.equal(state.status, '');
});

test('errors become a plain failure row, not a healthy reply', () => {
  const state = run([['message.start'], ['message.complete', { text: 'Provider refused: 429', status: 'error', error: '429', error_surface: { code: 'rate_limited' } }]]);
  assert.equal(state.items.at(-1).kind, 'notice');
  assert.equal(state.items.at(-1).tone, 'error');
  assert.match(state.failure, /busy/u);
  assert.equal(texts(state).length, 0);
});

test('reasoning, todos, usage and status are bounded side channels', () => {
  const state = run([['message.start'], ['reasoning.delta', { text: 'Think' }], ['reasoning.delta', { text: 'ing' }],
    ['thinking.delta', { text: '(｡•́︿•̀｡) synthesizing...' }], ['todo.updated', { revision: 2, todos: [{ id: '1', content: 'Read', status: 'completed' }] }],
    ['todo.updated', { revision: 1, todos: [] }], ['session.usage', { usage: { context_used: 10, context_max: 100 } }],
    ['message.delta', { text: 'Answer' }]]);
  assert.equal(state.items[0].kind, 'reasoning'); assert.equal(state.items[0].text, 'Thinking'); assert.equal(state.items[0].streaming, false);
  assert.equal(state.todos.length, 1); assert.deepEqual(state.context, { used: 10, max: 100 });
  assert.equal(JSON.stringify(state).includes('synthesizing'), false, 'decorative wait text is not shown');
});

test('outgoing rows bind to the next turn and saved history replaces finished turns only', () => {
  let state = addOutgoing(EMPTY_LIVE, 'send-1', 'Hello', 'pending');
  state = run([['message.start'], ['message.delta', { text: 'Hi' }], ['session.info', { running: false }]], state);
  assert.equal(state.items[0].turn, state.items[1].turn);
  assert.deepEqual(afterHistory(state).items, []);
  const running = run([['message.start'], ['message.delta', { text: 'More' }]], state);
  assert.deepEqual(afterHistory(running).items.map(item => item.paragraphs[0]), ['More']);
});

test('REST history pairs tool calls with results, cleans user text and strips attached context', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/rest-history-tools.json', import.meta.url), 'utf8'));
  const items = decodeRestHistory(fixture, 1792186400000);
  const tools = items.filter(item => item.kind === 'tool');
  assert.equal(tools.length, 2);
  assert.ok(tools.every(tool => tool.state === 'done' && tool.output));
  assert.deepEqual(items.filter(item => item.kind === 'message').map(item => item.direction), ['out', 'in', 'out', 'in', 'out', 'in']);
  assert.equal(JSON.stringify(items).includes('hermes-home'), false);
  assert.deepEqual(cleanUserText('Summarize this\n@file:`/h/a/Q3 report.pdf`\n\n--- Attached Context ---\n\n📎 secret body\n@image:/h/i/upload.jpg'),
    { text: 'Summarize this', attachments: ['Q3 report.pdf'] });
  assert.equal(cleanUserText('<memory-context>private</memory-context>Hi').text, 'Hi');
  assert.deepEqual(cleanUserText('What color?\n[image]'), { text: 'What color?', attachments: ['Photo'] });
  assert.throws(() => decodeRestHistory({ messages: [{ id: -1, role: 'user', content: 'x' }] }));
});

test('RPC history accepts a raw count above the projected rows and keeps tool previews', () => {
  const items = decodeRpcHistory({ count: 10, messages: [{ role: 'user', text: 'List files', row_id: 3 },
    { role: 'tool', name: 'terminal', context: 'ls -F', args: { command: 'ls -F' } }, { role: 'assistant', text: 'Done', row_id: 6, reasoning: 'r' }] });
  assert.deepEqual(items.map(item => item.kind), ['message', 'tool', 'reasoning', 'message']);
  assert.equal(items[1].state, 'recorded');
  assert.throws(() => decodeRpcHistory({ count: 1, messages: [{ role: 'user', text: 'a' }, { role: 'user', text: 'b' }] }));
});

test('rows fold finished work above the answer and keep the live turn open', () => {
  const items = [
    { kind: 'message', id: 'u1', direction: 'out', paragraphs: ['List'], turn: 't1' },
    { kind: 'message', id: 'a0', direction: 'in', paragraphs: ['Let me check'], turn: 't1' },
    { kind: 'tool', id: 'x', label: 'Ran a command', detail: 'ls', state: 'done', turn: 't1' },
    { kind: 'reasoning', id: 'r', text: 'hmm', turn: 't1' },
    { kind: 'message', id: 'a1', direction: 'in', paragraphs: ['Two files'], turn: 't1' },
    { kind: 'message', id: 'u2', direction: 'out', paragraphs: ['More'], turn: 't2' },
    { kind: 'tool', id: 'y', label: 'Reading a file', detail: 'a', state: 'running', turn: 't2' },
  ];
  const rows = projectRows(items, { liveTurn: 't2', showReasoning: false });
  assert.deepEqual(rows.map(row => row.kind), ['message', 'work', 'message', 'message', 'work']);
  assert.equal(rows[1].summary, 'Worked · 1 step');
  assert.deepEqual(rows[1].items.map(item => item.id), ['a0', 'x']);
  assert.equal(rows[4].live, true); assert.equal(rows[4].summary, 'Reading a file…');
  assert.equal(projectRows(items, { liveTurn: null, showReasoning: true })[1].items.some(item => item.kind === 'reasoning'), true);
  assert.equal(formatDuration(50), ''); assert.equal(formatDuration(1400), '1.4s'); assert.equal(formatDuration(125000), '2m 5s');
});

test('tool wording stays plain and bounded', () => {
  assert.equal(toolPhrase('mcp_github_create_issue', 'live'), 'Using github create issue');
  assert.equal(toolDetail(undefined, { path: 'a'.repeat(200) }).length, 80);
  assert.equal(toolDetail('line\nbreak‮', undefined), 'line break');
});
