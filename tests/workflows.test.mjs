// Workflows: the repository's byte-for-byte plugin vectors decode to bounded
// display data; inputs are refused before anything is sent; runs/start has the
// exact body and keeps its token and request ID through a lost answer; only
// advertised actions are offered; an unsupported plugin is one clear sentence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { parseDesktopAction } from '../apps/desktop/src/shared/desktop-api.ts';
import { CALLS } from '../apps/desktop/src/shared/calls/index.ts';
import { HANDLERS } from '../apps/desktop/src/main/calls/index.ts';
import { callFailure } from '../apps/desktop/src/main/calls/context.ts';
import { HttpStatusError, parseHttpOperation } from '../packages/platform/transport-policy.ts';
import {
  decodeArtifactChunk, decodeRunDetail, decodeRunPage, decodeRunReply, decodeWorkflowDetail, decodeWorkflowOverview,
} from '../packages/contracts/workflows.ts';
import {
  NOT_SURE_STARTED, createStartIntent, offeredActions, prepareRunInputs, resendStart, runLine, settleStart, signoffGate, startRequest,
  unavailableText, workflowStatus,
} from '../packages/domain/workflows.ts';

const DIR = new URL('../docs/reference/fixtures/workflows-v1/', import.meta.url);
const vector = name => JSON.parse(readFileSync(new URL(name, DIR), 'utf8'));
const reply = name => vector(name).response;
const TOKEN = '6f1e2d3c-4b5a-4987-8a6b-5c4d3e2f1a0b';
const REQUEST = '0b6f0c1e-5d7a-4c55-9f0e-2a1b3c4d5e6f';
const ETAG = `"sha256:${'a'.repeat(64)}"`;
const WF = 'wf_8c1d2e3f4a5b6c7d';
const RUN = 'run_10a1b2c3d4e5f606';
const CONTEXT = { schemaVersion: 1, pluginVersion: '3.13.0', runtimeId: '0f1e2d3c4b5a69788796a5b4c3d2e1f0', servingProfileId: null,
  principal: null, features: ['native-context-v1', 'native-workflows-v1'] };

// A fake host: each route goes through the real transport policy parser first.
// Replies echo the request ID (the transport checks it) and, unless told, the context ETag.
function host(answer, { context = CONTEXT, contextError = null, echo = ETAG } = {}) {
  const seen = [];
  let ids = 0;
  const ctx = Object.freeze({
    async http(route) {
      parseHttpOperation({ kind: 'route', ...route });
      const call = { method: route.method, path: route.path, body: JSON.parse(route.body), native: route.native, maxBytes: route.maxBytes };
      seen.push(call);
      return { body: await answer(call), requestId: route.native?.requestId, etag: echo };
    },
    async nativeContext() {
      if (contextError) throw contextError;
      return { body: context, etag: ETAG, cacheControl: 'no-store' };
    },
    rpc: async () => { throw new Error('unexpected rpc'); },
    identity: { kind: 'dashboard' }, requireProfile: value => value, openChat: () => null, isCurrent: () => true,
    refreshCatalog: async () => {}, requestId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`,
  });
  return { seen, async call(name, input) {
    const parsed = CALLS[name].parse(input);
    try { return { ok: true, value: await HANDLERS[name].run(ctx, parsed) }; }
    catch (error) { return callFailure(error, HANDLERS[name].mutation); }
  } };
}
// The plugin's error envelope reaches handlers as status, one-line detail and code.
const refuse = (status, code, message) => { throw new HttpStatusError(status, message ?? code, code); };
const startInput = (overrides = {}) => ({ workflowId: WF, revision: 3, inputs: { topic: 'How small teams use checklists', length: 'Medium' },
  clientRunToken: TOKEN, requestId: REQUEST, ...overrides });

test('every repository workflow vector is valid JSON with the route it names', () => {
  const files = readdirSync(DIR).filter(name => name.endsWith('.json'));
  assert.equal(files.length, 43);
  for (const name of files) assert.ok(vector(name), name);
});

test('list vectors decode to workflows (pinned first, archived hidden) with waiting and active runs', () => {
  const v1 = decodeWorkflowOverview(reply('list.json'));
  assert.deepEqual(v1.workflows.map(row => [row.name, row.revision, row.needsSetup, row.pinned]),
    [['Weekly newsletter', 3, false, false], ['Research, draft, review', null, true, false]]);
  assert.equal(v1.waiting[0].waiting.kind, 'signoff');
  assert.equal(v1.active[0].state, 'running');
  const v2 = decodeWorkflowOverview(reply('list-v2.json'));
  assert.equal(v2.workflows[0].name, 'Newsletter with a loop');
  assert.equal(v2.workflows[0].pinned, true);
  const unpinnedFirst = structuredClone(reply('list-v2.json'));
  unpinnedFirst.workflows.reverse();
  unpinnedFirst.workflows.push({ ...unpinnedFirst.workflows[0], id: 'wf_0000000000000001', name: 'Old', archived: true });
  const ordered = decodeWorkflowOverview(unpinnedFirst);
  assert.equal(ordered.workflows[0].pinned, true, 'pinned first even if the host order changes');
  assert.ok(!ordered.workflows.some(row => row.name === 'Old'), 'archived workflows are hidden');
  // Plain list status.
  const status = row => workflowStatus(row, v1);
  assert.equal(status(v1.workflows[0]), 'needsYou', 'a sign-off is waiting');
  assert.equal(status(v1.workflows[1]), 'draftOnly');
  assert.equal(workflowStatus(v1.workflows[0], { waiting: [], active: v1.active }), 'running');
  assert.equal(workflowStatus(v1.workflows[0], { waiting: [], active: [] }), 'ready');
  assert.equal(workflowStatus({ ...v1.workflows[0], needsSetup: true }, { waiting: [], active: [] }), 'needsSetup');
});

test('get vectors decode stages in order, assigned agents and the run inputs', () => {
  const detail = decodeWorkflowDetail(reply('get.json'));
  assert.equal(detail.description, 'Research, draft and review the weekly newsletter.');
  assert.deepEqual(detail.stages.map(stage => [stage.title, stage.kind]), [['Research the topic', 'agent'], ['Write the draft', 'agent'],
    ['Check length and title', 'check'], ['Review the draft', 'agent'], ['Pass or send back', 'decision'], ['Your sign-off', 'signoff']]);
  assert.deepEqual(detail.roles.map(role => [role.label, role.agentId]), [['Researcher', 'research'], ['Writer', 'writer'], ['Reviewer', 'editor']]);
  assert.deepEqual(detail.inputs.map(input => [input.key, input.type, input.required]), [['topic', 'text', true], ['audience', 'text', false], ['length', 'choice', true]]);
  assert.deepEqual(detail.inputs[2].choices, ['Short', 'Medium', 'Long']);
  assert.deepEqual(detail.validation, { valid: true, host: true, issues: [] });
  const text = JSON.stringify(detail);
  assert.equal(text.includes('Research the topic for the audience'), false, 'stage instructions stay on the host');
  const v2 = decodeWorkflowDetail(reply('get-v2.json'));
  assert.equal(v2.latestRevision, null);
  assert.equal(v2.pinned, true);
  const broken = structuredClone(reply('get.json'));
  broken.workflow.definition.inputs.push({ key: 'photo', label: 'Photo', type: 'image', required: true });
  assert.throws(() => decodeWorkflowDetail(broken), 'an input this app cannot fill refuses the workflow');
});

test('run vectors decode every state, the sign-off file and outputs, dropping unknown fields and host paths', () => {
  const page = decodeRunPage(reply('runs-list.json'));
  assert.equal(page.runs.length, 10);
  assert.equal(page.hasMore, true);
  assert.equal(page.cursor, '40');
  const states = decodeRunPage(reply('run-states.json')).runs.map(run => run.state);
  for (const state of ['planned', 'launched', 'running', 'checking_output', 'accepted', 'waiting_for_you', 'needs_attention', 'succeeded', 'failed', 'cancelled']) {
    assert.ok(states.includes(state), state);
  }
  const attention = page.runs.find(run => run.state === 'needs_attention');
  assert.deepEqual(attention.attention, { code: 'host_restarted', message: "We don't know how Review the draft ended." });
  const failed = page.runs.find(run => run.state === 'failed');
  assert.equal(failed.failure.stageKey, 'draft');
  assert.equal(runLine(failed), 'Failed · Write the draft');
  assert.equal(typeof failed.startedAt, 'number', 'times become epoch milliseconds');

  const run = decodeRunDetail(reply('runs-get.json'));
  assert.equal(run.signoff.kind, 'file');
  assert.equal(run.signoff.artifact.sha256, '4f1c0d6b2e8a7f3c9d5e1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d9a2e');
  assert.equal(run.signoff.previous.iteration, 1);
  assert.equal(run.signoff.reviewNotes[0].severity, 'major');
  assert.deepEqual(run.allowedActions, ['cancel', 'pause']);
  assert.deepEqual(run.inputs.map(entry => entry.key), ['topic', 'audience', 'length']);
  assert.deepEqual(run.stages.map(stage => stage.state), ['accepted', 'accepted', 'accepted', 'accepted', 'accepted', 'waiting_for_you']);
  assert.equal(run.outputs.find(output => output.name === 'word_count').value, 884);
  assert.deepEqual(run.tokens, { in: 54130, out: 6810 });

  const extra = structuredClone(reply('runs-get-text-runner.json'));
  extra.run.secretPath = '/home/example/.hermes';
  extra.run.state = 'teleporting';
  const lenient = decodeRunDetail(extra);
  assert.equal(lenient.state, 'other');
  assert.equal(JSON.stringify(lenient).includes('/home/example'), false);
  assert.equal(JSON.stringify(lenient).includes('att_'), false, 'attempt IDs stay in main');

  const code = decodeRunDetail(reply('runs-get-code-review.json'));
  assert.deepEqual(code.signoff, { kind: 'changes', stageKey: 'review' });
  assert.equal(JSON.stringify(code).includes('/Users/you'), false, 'project and worktree paths never cross');
  for (const name of ['runs-start.json', 'runs-control.json', 'runs-signoff.json', 'runs-start-code.json', 'runs-signoff-code.json']) {
    assert.match(decodeRunReply(reply(name)).id, /^run_/u, name);
    assert.equal(JSON.stringify(decodeRunReply(reply(name))).includes('/Users/you'), false, name);
  }
  assert.equal(decodeArtifactChunk(reply('artifacts-read.json')).total, 5214);
  assert.throws(() => decodeRunReply({ run: { ...reply('runs-start.json').run, id: '../x' } }));
  assert.throws(() => decodeRunReply({}), 'a reply without a run is not a confirmation');
});

test('workflow calls refuse anything outside their exact inputs', () => {
  const action = (name, input) => parseDesktopAction({ kind: 'call', connection: 1, name, input });
  assert.ok(action('workflows.overview', {}));
  assert.ok(action('workflows.runs', { filter: 'all', workflowId: WF, before: '40' }));
  assert.ok(action('workflows.start', startInput()));
  assert.ok(action('workflows.start', startInput({ inputs: { count: 3, notes: 'line one\nline two' } })));
  assert.ok(action('workflows.control', { runId: RUN, action: 'cancel', expectedVersion: 21 }));
  assert.ok(action('workflows.signoff', { runId: RUN, stageKey: 'signoff', decision: 'approve', artifactSha256: 'a'.repeat(64) }));
  for (const [name, input] of [
    ['workflows.overview', { includeArchived: true }],
    ['workflows.detail', { workflowId: '../../auth' }], ['workflows.detail', { workflowId: 'WF_8C1D2E3F4A5B6C7D' }],
    ['workflows.runs', { filter: 'everything' }], ['workflows.runs', { filter: 'all', before: 'abc' }], ['workflows.runs', { filter: 'all', limit: 500 }],
    ['workflows.run', { runId: 'run_1' }], ['workflows.output', { runId: RUN, sha256: 'A'.repeat(64) }],
    ['workflows.start', startInput({ sample: true })], ['workflows.start', startInput({ clientRunToken: 'not-a-token' })],
    ['workflows.start', startInput({ clientRunToken: '6f1e2d3c-4b5a-1987-8a6b-5c4d3e2f1a0b' })],
    ['workflows.start', startInput({ requestId: TOKEN })], ['workflows.start', startInput({ revision: 0 })],
    ['workflows.start', startInput({ requestId: '0b6f0c1e-5d7a-1c55-9f0e-2a1b3c4d5e6f' })],
    ['workflows.start', startInput({ requestId: '0b6f0c1e-5d7a-4c55-0f0e-2a1b3c4d5e6f' })],
    ['workflows.start', startInput({ revision: 'draft' })], ['workflows.start', startInput({ inputs: { Topic: 'x' } })],
    ['workflows.start', startInput({ inputs: JSON.parse('{"__proto__":"x"}') })], ['workflows.start', startInput({ inputs: { topic: '' } })],
    ['workflows.start', startInput({ inputs: { topic: 'a\u0000b' } })], ['workflows.start', startInput({ inputs: { topic: 'x'.repeat(20001) } })],
    ['workflows.start', startInput({ inputs: { count: Infinity } })], ['workflows.start', startInput({ inputs: { list: ['x'] } })],
    ['workflows.control', { runId: RUN, action: 'pause', expectedVersion: 21 }], ['workflows.control', { runId: RUN, action: 'cancel', expectedVersion: 0 }],
    ['workflows.control', { runId: RUN, action: 'cancel' }],
    ['workflows.signoff', { runId: RUN, stageKey: 'signoff', decision: 'changes', artifactSha256: 'a'.repeat(64), notes: '  ' }],
    ['workflows.signoff', { runId: RUN, stageKey: 'signoff', decision: 'publish', artifactSha256: 'a'.repeat(64) }],
    ['workflows.signoff', { runId: RUN, stageKey: 'signoff', decision: 'approve', artifactSha256: 'short' }],
    ['workflows.signoff', { runId: RUN, stageKey: 'signoff', decision: 'approve', artifactSha256: 'a'.repeat(64), notes: 'x'.repeat(2001) }],
  ]) assert.throws(() => action(name, input), `${name} ${JSON.stringify(input)} must be refused`);
});

test('run inputs are checked like the plugin checks them before anything is sent', () => {
  const { inputs } = decodeWorkflowDetail(reply('get.json'));
  assert.deepEqual(prepareRunInputs(inputs, {}), { ok: false, errors: { topic: 'Fill in Topic.', length: 'Fill in Length.' } });
  assert.deepEqual(prepareRunInputs(inputs, { topic: '   ', length: 'Medium' }).errors, { topic: 'Fill in Topic.' });
  assert.deepEqual(prepareRunInputs(inputs, { topic: 'Checklists', length: 'Huge' }).errors, { length: 'Choose one of the choices for Length.' });
  assert.match(prepareRunInputs(inputs, { topic: 'x'.repeat(2001), length: 'Short' }).errors.topic, /at most 2,000 characters/u);
  // Optional and empty is left out; unknown keys are never sent.
  assert.deepEqual(prepareRunInputs(inputs, { topic: 'Checklists', audience: '', length: 'Short', extra: 'x' }),
    { ok: true, inputs: { topic: 'Checklists', length: 'Short' } });
  const numbers = [{ key: 'count', label: 'Count', type: 'number', required: true, choices: [] }];
  assert.deepEqual(prepareRunInputs(numbers, { count: ' 12.5 ' }), { ok: true, inputs: { count: 12.5 } });
  for (const bad of ['12abc', 'Infinity', '0x10', '1e999']) assert.equal(prepareRunInputs(numbers, { count: bad }).errors.count, 'Count must be a number.', bad);
});

test('runs/start sends the exact body with the window token and request ID, under the context ETag', async () => {
  const fake = host(call => { assert.equal(call.path, '/api/plugins/loopdy/native/workflows/runs/start'); return reply('runs-start.json'); });
  const result = await fake.call('workflows.start', startInput());
  assert.equal(result.ok, true);
  assert.equal(result.value.number, 14);
  const [sent] = fake.seen;
  assert.equal(sent.method, 'POST');
  assert.deepEqual(sent.body, { workflowId: WF, revision: 3, inputs: { topic: 'How small teams use checklists', length: 'Medium' },
    clientRunToken: TOKEN, sample: false });
  assert.deepEqual(Object.keys(sent.body), ['workflowId', 'revision', 'inputs', 'clientRunToken', 'sample']);
  assert.deepEqual(sent.native, { etag: ETAG, requestId: REQUEST });
  assert.equal(sent.maxBytes, 196608);
});

test('a lost or uncertain start answer is "not sure", keeps its token and is never sent again by itself', async () => {
  for (const [label, answer, echo = ETAG] of [
    ['lost reply', () => { throw new Error('socket closed'); }],
    ['context changed after commit', () => refuse(412, 'context_changed')],
    ['server error', () => refuse(500, 'internal_error')],
    ['proxy 503 without the plugin envelope', () => { throw new HttpStatusError(503, 'Service Unavailable'); }],
    ['unreadable reply', () => ({ run: { id: 'nope' } })],
    ['reply under another context', () => reply('runs-start.json'), `"sha256:${'b'.repeat(64)}"`],
  ]) {
    const fake = host(answer, { echo });
    const result = await fake.call('workflows.start', startInput());
    assert.deepEqual(result, { ok: false, code: 'unknown', message: NOT_SURE_STARTED }, label);
    assert.equal(fake.seen.length, 1, `${label}: sent once, never retried`);
  }
  // The plugin's own "refused before starting" codes: nothing started.
  const notNow = await host(() => refuse(503, 'runner_unavailable', "This computer can't run workflow stages right now.")).call('workflows.start', startInput());
  assert.deepEqual(notNow, { ok: false, code: 'unavailable', message: "This computer can't run workflow stages right now." });
  assert.equal(settleStart(createStartIntent(WF, 3, {}, () => TOKEN), notNow, false).outcome, 'refused');
  // Refusals the host answered for this exact token.
  const refused = host(() => refuse(422, 'inputs_invalid', 'Fill in Topic.'));
  assert.deepEqual(await refused.call('workflows.start', startInput()), { ok: false, code: 'invalid', message: 'Fill in Topic.' });
  const archived = host(() => refuse(409, 'workflow_archived', 'This workflow is archived.'));
  assert.equal((await archived.call('workflows.start', startInput())).code, 'conflict');
  const full = host(() => refuse(429, 'queue_full', 'Too many runs are waiting. Try again later.'));
  assert.equal((await full.call('workflows.start', startInput())).message, 'Too many runs are waiting. Try again later.');
  // Nothing was sent: the context could not be read.
  const offline = host(() => assert.fail('must not send'), { contextError: new Error('socket closed') });
  const notSent = await offline.call('workflows.start', startInput());
  assert.equal(notSent.code, 'unavailable');
  assert.match(notSent.message, /nothing was sent/u);
  // Too large to send is refused before sending.
  const big = host(() => assert.fail('must not send'));
  const inputs = Object.fromEntries(Array.from({ length: 12 }, (_, index) => [`field_${index}`, 'x'.repeat(20000)]));
  assert.equal((await big.call('workflows.start', startInput({ inputs }))).code, 'invalid');
});

test('the start intent keeps the same token and request ID until the host answers for them', async () => {
  let ids = 0;
  const newId = () => [TOKEN, REQUEST, 'ffffffff-ffff-4fff-8fff-ffffffffffff'][ids++];
  const intent = createStartIntent(WF, 3, { topic: 'Checklists' }, newId);
  assert.deepEqual(startRequest(intent), { workflowId: WF, revision: 3, inputs: { topic: 'Checklists' }, clientRunToken: TOKEN, requestId: REQUEST });
  const lost = settleStart(intent, { ok: false, code: 'unknown', message: 'x' }, false);
  assert.equal(lost.outcome, 'unknown');
  assert.equal(lost.message, NOT_SURE_STARTED);
  assert.deepEqual(startRequest(resendStart(lost.intent)), startRequest(intent), 'sending again is the same start');
  // The same start through the handler is byte-for-byte the same request.
  const fake = host(() => { throw new Error('socket closed'); });
  await fake.call('workflows.start', startRequest(intent));
  await fake.call('workflows.start', startRequest(resendStart(lost.intent)));
  assert.deepEqual(fake.seen[0], fake.seen[1]);
  // After a lost answer, a send that never left stays unknown; a host refusal settles it.
  assert.equal(settleStart(lost.intent, { ok: false, code: 'unavailable', message: 'Could not reach Hermes.' }, true).outcome, 'unknown');
  assert.equal(settleStart(lost.intent, { ok: false, code: 'stale', message: 'Connect first.' }, true).intent.clientRunToken, TOKEN);
  assert.deepEqual(settleStart(lost.intent, { ok: false, code: 'conflict', message: 'Archived.' }, true), { intent: null, outcome: 'refused', message: 'Archived.', run: null });
  const run = decodeRunReply(reply('runs-start.json'));
  assert.deepEqual(settleStart(lost.intent, { ok: true, value: run }, true), { intent: null, outcome: 'started', message: '', run });
  // A first send that never left is simply not started.
  assert.equal(settleStart(intent, { ok: false, code: 'unavailable', message: 'Could not reach Hermes.' }, false).intent, null);
});

test('only advertised actions are offered, pause never, and a sign-off needs the exact file on screen', () => {
  const waiting = decodeRunDetail(reply('runs-get.json'));
  assert.deepEqual(offeredActions(waiting), ['cancel'], 'pause is advertised but has no button');
  assert.deepEqual(offeredActions({ allowedActions: [], paused: false }), []);
  assert.deepEqual(offeredActions({ allowedActions: ['cancel', 'retry', 'resume'], paused: true }), ['retry', 'resume', 'cancel']);
  assert.deepEqual(offeredActions({ allowedActions: ['resume'], paused: false }), [], 'resume only for a paused run');
  const unknownState = decodeRunDetail({ run: { ...reply('runs-get.json').run, state: 'mystery', allowedActions: [] } });
  assert.deepEqual(offeredActions(unknownState), [], 'an unknown state gains nothing');
  const sha = waiting.signoff.artifact.sha256;
  assert.equal(signoffGate(waiting, null), 'load');
  assert.equal(signoffGate(waiting, 'b'.repeat(64)), 'load', 'a different file is not the one waiting');
  assert.equal(signoffGate(waiting, sha), 'ready');
  assert.equal(signoffGate({ ...waiting, state: 'running' }, sha), 'none');
  assert.equal(signoffGate({ ...waiting, waiting: { ...waiting.waiting, stageKey: 'review' } }, sha), 'none');
  assert.equal(signoffGate(decodeRunDetail(reply('runs-get-code-review.json')), sha), 'changes');
});

test('control and sign-off send the version and hash the person saw; stale ones fail safely', async () => {
  const control = host(() => reply('runs-control.json'));
  const cancelled = await control.call('workflows.control', { runId: 'run_3f9a1c2e4b5d6f70', action: 'cancel', expectedVersion: 7 });
  assert.equal(cancelled.value.state, 'cancelled');
  assert.deepEqual(control.seen[0].body, { runId: 'run_3f9a1c2e4b5d6f70', action: 'cancel', expectedVersion: 7 });
  assert.equal(control.seen[0].path, '/api/plugins/loopdy/native/workflows/runs/control');
  const moved = host(() => refuse(409, 'run_conflict', 'The run changed. Load it again.'));
  assert.deepEqual(await moved.call('workflows.control', { runId: RUN, action: 'retry', expectedVersion: 3 }),
    { ok: false, code: 'conflict', message: 'The run changed. Load it again.' });
  const lost = host(() => { throw new Error('socket closed'); });
  assert.equal((await lost.call('workflows.control', { runId: RUN, action: 'cancel', expectedVersion: 3 })).code, 'unknown');

  const signoff = host(() => reply('runs-signoff.json'));
  const sha = '4f1c0d6b2e8a7f3c9d5e1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d9a2e';
  const approved = await signoff.call('workflows.signoff', { runId: RUN, stageKey: 'signoff', decision: 'approve', artifactSha256: sha });
  assert.equal(approved.value.state, 'succeeded');
  assert.deepEqual(signoff.seen[0].body, vector('runs-signoff.json').request);
  const stale = host(() => refuse(409, 'approval_stale', 'The file changed since you opened it. Look at it again.'));
  assert.deepEqual(await stale.call('workflows.signoff', { runId: RUN, stageKey: 'signoff', decision: 'approve', artifactSha256: sha }),
    { ok: false, code: 'conflict', message: 'The file changed since you opened it. Look at it again.' });
  const changes = host(() => reply('runs-signoff.json'));
  await changes.call('workflows.signoff', { runId: RUN, stageKey: 'signoff', decision: 'changes', artifactSha256: sha, notes: 'Shorter, please.' });
  assert.equal(changes.seen[0].body.notes, 'Shorter, please.');
});

test('a text output is read in bounded chunks and proved against its hash', async () => {
  const content = Buffer.from(`# Checklists\n\n${'Small teams ship. '.repeat(9000)}`, 'utf8');
  const sha = createHash('sha256').update(content).digest('hex');
  const serve = data => call => {
    const { offset, length } = call.body;
    const part = data.subarray(offset, offset + length);
    return { sha256: call.body.sha256, offset, total: data.length, data: part.toString('base64'), done: offset + part.length >= data.length };
  };
  const fake = host(serve(content));
  const result = await fake.call('workflows.output', { runId: RUN, sha256: sha });
  assert.equal(result.ok, true);
  assert.equal(result.value.text, content.toString('utf8'));
  assert.equal(fake.seen.length, Math.ceil(content.length / 98304));
  assert.ok(fake.seen.every(call => call.body.length === 98304));
  const swapped = await host(serve(Buffer.from('# Other file\n'))).call('workflows.output', { runId: RUN, sha256: sha });
  assert.equal(swapped.code, 'stale', 'bytes that do not match the hash are never shown as that file');
  const big = await host(() => ({ sha256: sha, offset: 0, total: 600 * 1024, data: '', done: false })).call('workflows.output', { runId: RUN, sha256: sha });
  assert.deepEqual(big, { ok: false, code: 'invalid', message: 'This file is too large to show here.' });
  const binary = Buffer.from([0xff, 0xfe, 0x00]);
  const notText = await host(serve(binary)).call('workflows.output', { runId: RUN, sha256: createHash('sha256').update(binary).digest('hex') });
  assert.equal(notText.code, 'invalid');
});

test('reads go through the verified context; an unsupported plugin is one clear sentence', async () => {
  const fake = host(call => call.path.endsWith('/list') ? reply('list.json') : assert.fail(call.path));
  const overview = await fake.call('workflows.overview', {});
  assert.equal(overview.value.workflows.length, 2);
  assert.deepEqual(fake.seen[0].body, { includeArchived: false });
  assert.match(fake.seen[0].native.requestId, /^[0-9a-f-]{36}$/u);
  // The published revision is what runs.
  const detail = host(call => { if (call.body.revision === 'draft') return reply('get.json'); assert.equal(call.body.revision, 3); return reply('get.json'); });
  assert.equal((await detail.call('workflows.detail', { workflowId: WF })).ok, true);
  assert.deepEqual(detail.seen.map(call => call.body.revision), ['draft', 3]);
  const gone = await host(() => refuse(404, 'run_not_found')).call('workflows.run', { runId: RUN });
  assert.equal(gone.code, 'stale');
  const otherContext = await host(() => reply('list.json'), { echo: `"sha256:${'c'.repeat(64)}"` }).call('workflows.overview', {});
  assert.equal(otherContext.code, 'unavailable', 'a reply under another context is not shown');

  const noPlugin = await host(() => assert.fail('no send'), { contextError: new HttpStatusError(404) }).call('workflows.overview', {});
  assert.deepEqual(noPlugin, { ok: false, code: 'unsupported', message: 'Workflows need the bighelp plugin on your computer.' });
  const unavailable = await host(() => assert.fail('no send'), { context: reply('context-unavailable.json') }).call('workflows.overview', {});
  assert.deepEqual(unavailable, { ok: false, code: 'unsupported', message: unavailableText('chat_runner_missing') });
  assert.match(unavailable.message, /Update Hermes/u);
  const older = await host(() => assert.fail('no send'), { context: { ...CONTEXT, features: ['native-context-v1'] } }).call('workflows.start', startInput());
  assert.deepEqual(older, { ok: false, code: 'unsupported', message: 'Workflows need a newer bighelp plugin on your computer.' });
  const offline = await host(() => refuse(503, 'store_unavailable', "The workflow store can't be opened.")).call('workflows.overview', {});
  assert.deepEqual(offline, { ok: false, code: 'unavailable', message: "The workflow store can't be opened." });
});

test('the window records a start before sending it, sends one at a time and keeps it until the host answers', async () => {
  const { forgetStart, pendingStart, sendStart } = await import('../packages/ui/workflow-starts.ts');
  let ids = 0;
  const intent = createStartIntent('wf_0000000000000abc', 1, { topic: 'Tea' }, () => [TOKEN, REQUEST][ids++]);
  let release;
  const seen = [];
  const first = sendStart(intent, false, request => {
    seen.push(request);
    assert.equal(pendingStart(intent.workflowId)?.intent.state, 'sending', 'recorded before it goes out');
    return new Promise(done => { release = done; });
  });
  assert.equal(await sendStart(resendStart(intent), false, () => assert.fail('a second send while one is out')), null);
  release({ ok: false, code: 'unknown', message: '' });
  assert.equal((await first).outcome, 'unknown');
  const kept = pendingStart(intent.workflowId);
  assert.deepEqual([kept.intent.state, kept.uncertain, kept.intent.clientRunToken, kept.intent.requestId], ['unknown', true, TOKEN, REQUEST]);
  // Sending it again by hand is the same request; a send that throws is still unknown.
  await sendStart(resendStart(kept.intent), kept.uncertain, request => { seen.push(request); throw new Error('ipc closed'); });
  assert.deepEqual(seen[1], seen[0]);
  assert.equal(pendingStart(intent.workflowId).intent.state, 'unknown');
  forgetStart({ ...intent, clientRunToken: 'ffffffff-ffff-4fff-8fff-ffffffffffff' });
  assert.ok(pendingStart(intent.workflowId), 'only the start on screen is forgotten');
  const done = await sendStart(resendStart(kept.intent), true, async () => ({ ok: true, value: decodeRunReply(reply('runs-start.json')) }));
  assert.equal(done.outcome, 'started');
  assert.equal(pendingStart(intent.workflowId), null);
});
