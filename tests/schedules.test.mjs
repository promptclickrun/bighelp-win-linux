// Scheduled tasks: strict renderer input, exact Hermes cron requests, decoding of
// replies shaped like a real host's, and plain outcomes for refusals and lost replies.
// Synthetic data only; no host is contacted.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { parseDesktopAction } from '../apps/desktop/src/shared/desktop-api.ts';
import { HANDLERS } from '../apps/desktop/src/main/calls/index.ts';
import { CallError, callFailure } from '../apps/desktop/src/main/calls/context.ts';
import { decodeScheduledTask, decodeScheduledTasks, decodeTaskRuns, decodeDeliveryTargets } from '../packages/contracts/schedules.ts';
import { describeSchedule, expectedSchedule, presetFor, sameSchedule, scheduleRequest } from '../packages/domain/schedule.ts';
import { HttpStatusError, LONG_HTTP_TIMEOUT_MS, parseHttpOperation } from '../packages/platform/transport-policy.ts';
import { boundedHttp } from '../packages/platform/http-transport.ts';

// Shaped like a real Hermes 0.22 job (fields and types from a disposable host), synthetic values.
const job = (overrides = {}) => ({
  id: '3f9c2a1b7d4e', name: 'Weekday brief', prompt: 'Summarize unread email.', skills: [], skill: null,
  model: null, provider: null, base_url: null, script: null, no_agent: false, monitor_script: null, monitor_url: null,
  monitor_state: null, context_from: null, schedule: { kind: 'cron', expr: '0 9 * * 1-5', display: '0 9 * * 1-5' },
  schedule_display: '0 9 * * 1-5', repeat: { times: null, completed: 0 }, enabled: true, state: 'scheduled',
  paused_at: null, paused_reason: null, created_at: '2026-10-16T10:12:03.123456-05:00', next_run_at: '2026-10-19T09:00:00-05:00',
  last_run_at: null, last_status: null, last_error: null, last_delivery_error: null, last_delivery_unverified: null,
  last_failure: null, failure_streak: 0, deliver: 'local', origin: null, enabled_toolsets: null, workdir: null,
  fire_claim: null, canonical_completions: ['5c2b3285b01d4073ae270c7e5846fa9b'],
  profile: 'agent', profile_name: 'agent', hermes_home: '/synthetic/private/home', is_default_profile: false, scheduler_heartbeat_age_s: 12.4,
  ...overrides,
});
const agentRun = (overrides = {}) => ({
  id: 'local-b380e1ab6d02efa3e17b6f0021d2a4ee8bfb7a8ec1f206bf5f5f4ded672bc17c', source: 'cron', user_id: 'cron-owner',
  model: 'synthetic-model', system_prompt: 'Synthetic system prompt '.repeat(400), started_at: 1792187233.735097, ended_at: 1792187263.3612008,
  end_reason: 'cron_complete', message_count: 2, tool_call_count: 0, input_tokens: 12629, output_tokens: 213,
  estimated_cost_usd: 0.0, actual_cost_usd: null, cost_status: 'unknown', title: 'Weekday brief · Oct 16 16:47',
  cwd: '/synthetic/workspace', cron_execution_id: '5c2b3285b01d4073ae270c7e5846fa9b', last_active: 1792187263.347114,
  preview: '[IMPORTANT: You are running as a scheduled cron job…', cron_job_id: '3f9c2a1b7d4e', is_active: false,
  scheduler_owned: false, archived: false, profile: 'agent', ...overrides,
});
const outputRun = { id: 'cron_output:3f9c2a1b7d4e:2026-10-15_09-00-04', source: 'cron_output', title: 'COMPLETED · Here is your summary',
  preview: 'Here is your summary', started_at: 1792072804, ended_at: 1792072804, last_active: 1792072804, message_count: 0, tool_call_count: 0, model: null };

function context(routes, overrides = {}) {
  const seen = [];
  const value = {
    seen,
    rpc: async () => { throw new Error('unexpected rpc'); },
    async http(route) {
      seen.push(route);
      const handler = routes.shift();
      if (!handler) throw new Error(`unexpected ${route.method} ${route.path}`);
      return handler(route);
    },
    nativeContext: async () => { throw new HttpStatusError(404); },
    identity: { kind: 'dashboard' },
    requireProfile(profile) { if (profile !== 'agent') throw new CallError('stale', 'That agent is no longer on your computer.'); return profile; },
    openChat: () => null, isCurrent: () => true, refreshCatalog: async () => {}, requestId: () => '01234567-89ab-4cde-8f01-23456789abcd',
    ...overrides,
  };
  return value;
}
const reply = body => async () => ({ body, status: 200 });
const fail = (status, detail = '') => async () => { throw new HttpStatusError(status, detail); };
const lostReply = async () => { throw new Error('Host request failed or retired'); };
const parse = (name, input) => parseDesktopAction({ kind: 'call', connection: 1, name, input }).input;
async function run(name, input, ctx) {
  try { return { ok: true, value: await HANDLERS[name].run(ctx, parse(name, input)) }; }
  catch (error) { return callFailure(error, HANDLERS[name].mutation); }
}

test('renderer input is refused unless every field is exact and bounded', () => {
  const create = { profile: 'agent', name: 'Brief', prompt: 'Summarize.', schedule: '0 9 * * *', deliver: 'local' };
  assert.deepEqual({ ...parse('schedules.create', { ...create, name: '  Brief ', model: '', workdir: '' }) },
    { profile: 'agent', name: 'Brief', prompt: 'Summarize.', schedule: '0 9 * * *', deliver: 'local' });
  for (const input of [{ ...create, extra: 1 }, { ...create, profile: 'all' }, { ...create, profile: '../x' }, { ...create, name: '   ' },
    { ...create, name: 'a\nb' }, { ...create, prompt: '' }, { ...create, prompt: 'x'.repeat(256001) }, { ...create, schedule: 'a\nb' },
    { ...create, deliver: 'tele gram' }, { ...create, deliver: '' }, { ...create, model: 3 }, (({ deliver, ...rest }) => rest)(create)]) {
    assert.throws(() => parse('schedules.create', input), JSON.stringify(input).slice(0, 80));
  }
  assert.deepEqual({ ...parse('schedules.update', { profile: 'agent', id: 'abc123', changes: { model: '' } }).changes }, { model: '' });
  for (const input of [{ profile: 'agent', id: 'abc', changes: {} }, { profile: 'agent', id: 'abc', changes: { state: 'paused' } },
    { profile: 'agent', id: 'a/b', changes: { name: 'x' } }, { profile: 'agent', id: '..', changes: { name: 'x' } }]) {
    assert.throws(() => parse('schedules.update', input));
  }
  assert.throws(() => parse('schedules.run', { profile: 'agent', id: 'abc' }), 'Run now must say whether resuming was agreed');
  assert.throws(() => parse('schedules.setPaused', { profile: 'agent', id: 'abc', paused: 'true' }));
  assert.throws(() => parse('schedules.list', { profile: 'agent', url: '/api/env' }));
});

test('a real-shaped job decodes without host paths, internal state or other agents', () => {
  const task = decodeScheduledTask(job({ latest_execution: { status: 'running' } }), 'agent');
  assert.equal(task.running, true);
  assert.deepEqual(task.schedule, { kind: 'cron', expr: '0 9 * * 1-5' });
  assert.equal(task.nextRunAt, '2026-10-19T14:00:00.000Z');
  assert.equal(task.hostOffsetMinutes, -300);
  assert.deepEqual(task.stores, { model: true, workdir: true });
  const text = JSON.stringify(task);
  for (const secret of ['/synthetic/private/home', 'fire_claim', 'canonical_completions', 'heartbeat']) assert.equal(text.includes(secret), false, secret);
  assert.ok(Object.isFrozen(task) && Object.isFrozen(task.schedule));
  assert.throws(() => decodeScheduledTask(job({ profile: 'other' }), 'agent'), 'a job owned by another agent is refused');
  assert.throws(() => decodeScheduledTask(job({ id: '../x' }), 'agent'));
  assert.throws(() => decodeScheduledTask(job({ schedule: { kind: 'lunar' } }), 'agent'));
  assert.equal(decodeScheduledTask(job({ state: 'quota_hold' }), 'agent').state, 'unknown');
  assert.equal(decodeScheduledTask(job({ script: 'collect.py' }), 'agent').hostManaged, true);
  assert.equal(decodeScheduledTask(job({ prompt: 'x\u0000y' }), 'agent').prompt, null, 'unsafe instructions are read-only, not dropped silently');
  const interval = decodeScheduledTask(job({ schedule: { kind: 'interval', minutes: 120, display: 'every 120m' }, schedule_display: 'every 120m' }), 'agent');
  assert.deepEqual(interval.schedule, { kind: 'interval', minutes: 120 });
  assert.equal(decodeScheduledTasks([job(), job({ id: 'aaaaaaaaaaaa' })], 'agent').length, 2);
  assert.throws(() => decodeScheduledTasks([job(), job()], 'agent'), 'duplicate ids are refused');
  assert.throws(() => decodeScheduledTasks(Array(501).fill(job()), 'agent'));
});

test('run history keeps both real row kinds and refuses rows for another task', () => {
  const runs = decodeTaskRuns({ runs: [agentRun(), outputRun], limit: 20 }, '3f9c2a1b7d4e', 'agent');
  assert.equal(runs.length, 2);
  assert.deepEqual({ ...runs[0], id: undefined }, { id: undefined, kind: 'agent', startedAt: '2026-10-16T21:47:13.735Z', endedAt: '2026-10-16T21:47:43.361Z',
    active: false, summary: null, model: 'synthetic-model', inputTokens: 12629, outputTokens: 213, estimatedCost: 0, actualCost: null });
  assert.equal(runs[1].kind, 'output');
  assert.equal(runs[1].summary, 'COMPLETED · Here is your summary');
  assert.equal(JSON.stringify(runs).includes('Synthetic system prompt'), false);
  assert.throws(() => decodeTaskRuns({ runs: [agentRun({ cron_job_id: 'bbbbbbbbbbbb' })] }, '3f9c2a1b7d4e', 'agent'));
  assert.throws(() => decodeTaskRuns({ runs: [agentRun({ profile: 'other' })] }, '3f9c2a1b7d4e', 'agent'));
  assert.throws(() => decodeTaskRuns({ runs: [{ ...outputRun, id: 'cron_output:bbbbbbbbbbbb:latest' }] }, '3f9c2a1b7d4e', 'agent'));
  assert.equal(decodeTaskRuns({ runs: [agentRun({ cron_job_id: undefined, id: 'cron_3f9c2a1b7d4e_1760600000' })] }, '3f9c2a1b7d4e', 'agent').length, 1);
});

test('delivery targets keep host names and mark platforms without a home channel', () => {
  const targets = decodeDeliveryTargets({ targets: [
    { id: 'local', name: 'Local (save only)', home_target_set: true, home_env_var: null },
    { id: 'telegram', name: 'Telegram', home_target_set: false, home_env_var: 'TELEGRAM_HOME_CHANNEL' },
    { id: 'bot-chat:agent', name: 'Bot Chat (agent)', home_target_set: true, home_env_var: null }] });
  assert.deepEqual(targets.map(target => [target.id, target.ready]), [['local', true], ['telegram', false], ['bot-chat:agent', true]]);
  assert.equal(JSON.stringify(targets).includes('TELEGRAM_HOME_CHANNEL'), false);
  assert.throws(() => decodeDeliveryTargets({ targets: [{ id: 'a b', name: 'x' }] }));
});

test('create sends exactly the four fields plus chosen options, after checking the list', async () => {
  const ctx = context([reply([]), reply(job({ model: 'synthetic-model' }))]);
  const result = await run('schedules.create', { profile: 'agent', name: 'Weekday brief', prompt: 'Summarize unread email.', schedule: '0 9 * * 1-5',
    deliver: 'local', model: 'synthetic-model' }, ctx);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.notes, []);
  assert.deepEqual(ctx.seen.map(route => [route.method, route.path, { ...route.query }]),
    [['GET', '/api/cron/jobs', { profile: 'agent' }], ['POST', '/api/cron/jobs', { profile: 'agent' }]]);
  assert.deepEqual(JSON.parse(ctx.seen[1].body), { name: 'Weekday brief', prompt: 'Summarize unread email.', schedule: '0 9 * * 1-5', deliver: 'local', model: 'synthetic-model' });
  assert.equal(ctx.seen[1].timeoutMs, undefined);
});

test('create reads back what Hermes kept and says so in plain words', async () => {
  const dropped = job({ schedule: { kind: 'interval', minutes: 60, display: 'every 60m' } });
  delete dropped.workdir;
  const result = await run('schedules.create', { profile: 'agent', name: 'Weekday brief', prompt: 'Summarize unread email.', schedule: 'every 120m',
    deliver: 'local', workdir: '/synthetic/folder' }, context([reply([]), reply(dropped)]));
  assert.deepEqual(result.value.notes, ["Hermes on this computer doesn't keep a working folder for tasks.", 'Hermes read the schedule differently. Check when it runs.']);
});

test('424 means saved: never create again, and find the saved task', async () => {
  const ctx = context([reply([]), fail(424), reply([job()])]);
  const result = await run('schedules.create', { profile: 'agent', name: 'Weekday brief', prompt: 'Summarize unread email.', schedule: '0 9 * * 1-5', deliver: 'local' }, ctx);
  assert.equal(result.ok, true);
  assert.equal(result.value.task.id, '3f9c2a1b7d4e');
  assert.match(result.value.notes[0], /Don't create it again/u);
  assert.equal(ctx.seen.filter(route => route.method === 'POST').length, 1, 'no second create');
});

test('a lost create reply is unknown unless a new matching task is found', async () => {
  const draft = { profile: 'agent', name: 'Weekday brief', prompt: 'Summarize unread email.', schedule: '0 9 * * 1-5', deliver: 'local' };
  const found = await run('schedules.create', draft, context([reply([job({ id: 'aaaaaaaaaaaa', name: 'Other' })]), lostReply, reply([job({ id: 'aaaaaaaaaaaa', name: 'Other' }), job()])]));
  assert.equal(found.ok, true);
  assert.match(found.value.notes[0], /reply was lost/u);
  const missing = await run('schedules.create', draft, context([reply([]), fail(502), reply([])]));
  assert.deepEqual(missing, { ok: false, code: 'unknown', message: 'Not sure this was saved. Check the list before creating it again.' });
  const preexisting = await run('schedules.create', draft, context([reply([job()]), lostReply, reply([job()])]));
  assert.equal(preexisting.code, 'unknown', 'a task that existed before is not proof this request saved one');
});

test('host refusals keep the host one-line reason; profile and task gaps are stale', async () => {
  const draft = { profile: 'agent', name: 'Bad', prompt: 'x', schedule: 'every blue moon', deliver: 'local' };
  const invalid = await run('schedules.create', draft, context([reply([]), fail(400, "Invalid duration: 'blue moon'. Use format like '30m'.")]));
  assert.deepEqual(invalid, { ok: false, code: 'invalid', message: "Invalid duration: 'blue moon'. Use format like '30m'." });
  assert.equal((await run('schedules.list', { profile: 'agent' }, context([fail(404, "Profile 'agent' does not exist.")]))).code, 'stale');
  assert.equal((await run('schedules.list', { profile: 'agent' }, context([fail(404)]))).code, 'unsupported');
  assert.equal((await run('schedules.list', { profile: 'other' }, context([]))).code, 'stale');
  assert.equal((await run('schedules.list', { profile: 'agent' }, context([reply([job({ profile: 'other' })])]))).code, 'invalid');
  const terminal = await run('schedules.update', { profile: 'agent', id: '3f9c2a1b7d4e', changes: { schedule: '0 10 * * *' } },
    context([reply([job({ state: 'completed', enabled: false })]), fail(400, "Cannot activate terminal cron job 'x' through update_job; use cron resume --run-now or --at.")]));
  assert.equal(terminal.code, 'invalid');
  assert.doesNotMatch(terminal.message, /cron resume/u);
});

test('edit sends only changed fields and never an unchanged schedule', async () => {
  const ctx = context([reply([job()]), reply(job({ name: 'Morning brief' }))]);
  const result = await run('schedules.update', { profile: 'agent', id: '3f9c2a1b7d4e',
    changes: { name: 'Morning brief', prompt: 'Summarize unread email.', schedule: '0 9 * * 1-5', deliver: 'local', model: '' } }, ctx);
  assert.equal(result.ok, true);
  assert.equal(ctx.seen[1].method, 'PUT');
  assert.equal(ctx.seen[1].path, '/api/cron/jobs/3f9c2a1b7d4e');
  assert.deepEqual(JSON.parse(ctx.seen[1].body), { updates: { name: 'Morning brief' } });
  const none = context([reply([job()])]);
  assert.deepEqual((await run('schedules.update', { profile: 'agent', id: '3f9c2a1b7d4e', changes: { schedule: '0 9 * * 1-5' } }, none)).value.notes, ['Nothing changed.']);
  assert.equal(none.seen.length, 1, 'no write when nothing changed');
  const interval = context([reply([job({ schedule: { kind: 'interval', minutes: 120 } })])]);
  await run('schedules.update', { profile: 'agent', id: '3f9c2a1b7d4e', changes: { schedule: 'every 120m' } }, interval);
  assert.equal(interval.seen.length, 1, 'same interval in minutes is not resent');
  const cleared = context([reply([job({ model: 'synthetic-model' })]), reply(job())]);
  await run('schedules.update', { profile: 'agent', id: '3f9c2a1b7d4e', changes: { model: '' } }, cleared);
  assert.deepEqual(JSON.parse(cleared.seen[1].body), { updates: { model: '' } });
});

test('writes confirm the task belongs to this agent before and after', async () => {
  const missing = context([reply([job({ id: 'aaaaaaaaaaaa' })])]);
  assert.equal((await run('schedules.delete', { profile: 'agent', id: '3f9c2a1b7d4e' }, missing)).code, 'stale');
  assert.equal(missing.seen.length, 1, 'no write for a task outside this agent');
  const moved = await run('schedules.setPaused', { profile: 'agent', id: '3f9c2a1b7d4e', paused: true }, context([reply([job()]), reply(job({ profile: 'other' }))]));
  assert.equal(moved.code, 'unknown');
  const other = await run('schedules.setPaused', { profile: 'agent', id: '3f9c2a1b7d4e', paused: true }, context([reply([job()]), reply(job({ id: 'aaaaaaaaaaaa' }))]));
  assert.equal(other.code, 'unknown');
  const hostManaged = await run('schedules.update', { profile: 'agent', id: '3f9c2a1b7d4e', changes: { name: 'x' } }, context([reply([job({ script: 'a.py' })])]));
  assert.equal(hostManaged.code, 'unsupported');
});

test('pause and resume use their own routes and report a missed run that may start soon', async () => {
  const pause = context([reply([job()]), reply(job({ enabled: false, state: 'paused', next_run_at: null }))]);
  const paused = await run('schedules.setPaused', { profile: 'agent', id: '3f9c2a1b7d4e', paused: true }, pause);
  assert.equal(pause.seen[1].path, '/api/cron/jobs/3f9c2a1b7d4e/pause');
  assert.equal(pause.seen[1].body, undefined);
  assert.equal(paused.value.task.state, 'paused');
  const due = new Date(Date.now() - 60_000).toISOString();
  const resume = context([reply([job({ enabled: false, state: 'paused', next_run_at: null })]), reply(job({ next_run_at: due }))]);
  const resumed = await run('schedules.setPaused', { profile: 'agent', id: '3f9c2a1b7d4e', paused: false }, resume);
  assert.equal(resume.seen[1].path, '/api/cron/jobs/3f9c2a1b7d4e/resume');
  assert.match(resumed.value.notes[0], /may run in the next minute or two. That uses AI credits/u);
  const unconfirmed = await run('schedules.setPaused', { profile: 'agent', id: '3f9c2a1b7d4e', paused: true }, context([reply([job()]), reply(job())]));
  assert.equal(unconfirmed.code, 'unknown');
  assert.equal((await run('schedules.setPaused', { profile: 'agent', id: '3f9c2a1b7d4e', paused: true }, context([reply([job()]), lostReply]))).code, 'unknown');
});

test('Run now waits long, is never retried, and reports a lost reply as unknown', async () => {
  const ctx = context([reply([job()]), reply(job({ last_run_at: '2026-10-16T16:47:44.980912-05:00', last_status: 'ok' }))]);
  const result = await run('schedules.run', { profile: 'agent', id: '3f9c2a1b7d4e', resume: false }, ctx);
  assert.equal(result.value.ran, true);
  assert.equal(result.value.task.lastStatus, 'ok');
  assert.equal(ctx.seen[1].path, '/api/cron/jobs/3f9c2a1b7d4e/trigger');
  assert.equal(ctx.seen[1].timeoutMs, LONG_HTTP_TIMEOUT_MS);
  const timeout = context([reply([job()]), lostReply]);
  assert.deepEqual(await run('schedules.run', { profile: 'agent', id: '3f9c2a1b7d4e', resume: false }, timeout),
    { ok: false, code: 'unknown', message: 'Not sure the run finished. It may still be running. Check Recent runs before running it again.' });
  assert.equal(timeout.seen.filter(route => route.path.endsWith('/trigger')).length, 1, 'one attempt only');
  assert.equal((await run('schedules.run', { profile: 'agent', id: '3f9c2a1b7d4e', resume: false }, context([reply([job()]), fail(409, 'Job is already running')]))).code, 'conflict');
  assert.equal((await run('schedules.run', { profile: 'agent', id: '3f9c2a1b7d4e', resume: false }, context([reply([job()]), fail(500)]))).code, 'unknown');
});

test('Run now refuses before sending when the task is busy, finished, or paused without agreement', async () => {
  for (const [row, resume, code] of [[job({ latest_execution: { status: 'claimed' } }), false, 'conflict'],
    [job({ state: 'completed', enabled: false }), true, 'invalid'], [job({ state: 'paused', enabled: false }), false, 'conflict']]) {
    const ctx = context([reply([row])]);
    assert.equal((await run('schedules.run', { profile: 'agent', id: '3f9c2a1b7d4e', resume }, ctx)).code, code);
    assert.equal(ctx.seen.length, 1, 'nothing was sent to run');
  }
  const agreed = context([reply([job({ state: 'paused', enabled: false })]), reply(job({ last_run_at: '2026-10-16T16:47:44-05:00' }))]);
  assert.equal((await run('schedules.run', { profile: 'agent', id: '3f9c2a1b7d4e', resume: true }, agreed)).ok, true);
});

test('delete is confirmed by reading the list back', async () => {
  const ctx = context([reply([job()]), reply({ ok: true }), reply([])]);
  assert.deepEqual(await run('schedules.delete', { profile: 'agent', id: '3f9c2a1b7d4e' }, ctx), { ok: true, value: { profile: 'agent', id: '3f9c2a1b7d4e' } });
  assert.deepEqual(ctx.seen.map(route => route.method), ['GET', 'DELETE', 'GET']);
  assert.equal((await run('schedules.delete', { profile: 'agent', id: '3f9c2a1b7d4e' }, context([reply([job()]), reply({ ok: true }), reply([job()])]))).code, 'unknown');
  assert.equal((await run('schedules.delete', { profile: 'agent', id: '3f9c2a1b7d4e' }, context([reply([job()]), lostReply]))).code, 'unknown');
});

test('history and targets are plain reads with their own routes', async () => {
  const ctx = context([reply({ runs: [agentRun()], limit: 20 })]);
  const history = await run('schedules.runs', { profile: 'agent', id: '3f9c2a1b7d4e' }, ctx);
  assert.equal(history.value.runs.length, 1);
  assert.deepEqual([ctx.seen[0].path, { ...ctx.seen[0].query }], ['/api/cron/jobs/3f9c2a1b7d4e/runs', { profile: 'agent', limit: '20' }]);
  assert.equal((await run('schedules.runs', { profile: 'agent', id: '3f9c2a1b7d4e' }, context([lostReply]))).code, 'unavailable', 'a failed read is never "unknown"');
  const targets = await run('schedules.targets', { profile: 'agent' }, context([reply({ targets: [{ id: 'local', name: 'Local (save only)', home_target_set: true }] })]));
  assert.equal(targets.value.targets[0].id, 'local');
  assert.equal((await run('schedules.targets', { profile: 'agent' }, context([fail(404)]))).code, 'unsupported');
});

test('friendly schedule choices become exact Hermes text and are compared by meaning', () => {
  const now = Date.parse('2026-10-16T12:00:00Z');
  assert.deepEqual(scheduleRequest({ kind: 'daily', time: '09:05' }, now), { ok: true, text: '5 9 * * *' });
  assert.deepEqual(scheduleRequest({ kind: 'weekdays', time: '17:30' }, now), { ok: true, text: '30 17 * * 1-5' });
  assert.deepEqual(scheduleRequest({ kind: 'hours', every: 2 }, now), { ok: true, text: 'every 120m' });
  assert.deepEqual(scheduleRequest({ kind: 'once', at: '2026-10-17T09:00:00.500Z' }, now), { ok: true, text: '2026-10-17T09:00:00Z' });
  assert.equal(scheduleRequest({ kind: 'once', at: '2026-10-16T11:00:00Z' }, now).message, 'Choose a date and time in the future.');
  assert.equal(scheduleRequest({ kind: 'daily', time: '9am' }, now).ok, false);
  assert.equal(scheduleRequest({ kind: 'hours', every: 5 }, now).ok, false);
  assert.deepEqual(scheduleRequest({ kind: 'custom', text: '  every monday 9am ' }, now), { ok: true, text: 'every monday 9am' });
  assert.equal(scheduleRequest({ kind: 'custom', text: '  ' }, now).ok, false);
  assert.deepEqual(expectedSchedule('every 120m'), { kind: 'interval', minutes: 120 });
  assert.equal(expectedSchedule('every monday 9am'), null);
  assert.ok(sameSchedule(expectedSchedule('2026-10-17T09:00:00Z'), { kind: 'once', at: '2026-10-17T04:00:00.000-05:00' }));
  assert.ok(!sameSchedule(expectedSchedule('every 120m'), { kind: 'interval', minutes: 60 }));
  assert.deepEqual(presetFor({ kind: 'cron', expr: '5 9 * * 1-5' }, now), { kind: 'weekdays', time: '09:05' });
  assert.deepEqual(presetFor({ kind: 'cron', expr: '0 9 * * 1' }, now), { kind: 'custom', text: '0 9 * * 1' });
  assert.deepEqual(presetFor({ kind: 'interval', minutes: 240 }, now), { kind: 'hours', every: 4 });
  const format = { clock: (hour, minute) => `${hour}:${String(minute).padStart(2, '0')}`, instant: iso => iso };
  assert.equal(describeSchedule({ kind: 'cron', expr: '5 9 * * *' }, '5 9 * * *', format), 'Every day at 9:05');
  assert.equal(describeSchedule({ kind: 'cron', expr: '0 9 * * 1' }, 'every monday 9am', format), 'every monday 9am');
  assert.equal(describeSchedule({ kind: 'interval', minutes: 120 }, 'every 120m', format), 'Every 2 hours');
  assert.equal(describeSchedule({ kind: 'interval', minutes: 30 }, 'every 30m', format), 'Every 30 minutes');
});

test('only an explicit, bounded timeout lengthens one HTTP exchange', async () => {
  const route = { kind: 'route', method: 'POST', path: '/api/cron/jobs/abc/trigger', maxBytes: 4096 };
  assert.equal(parseHttpOperation({ ...route, timeoutMs: LONG_HTTP_TIMEOUT_MS }).timeoutMs, LONG_HTTP_TIMEOUT_MS);
  for (const timeoutMs of [999, LONG_HTTP_TIMEOUT_MS + 1, 1.5, '60000']) assert.throws(() => parseHttpOperation({ ...route, timeoutMs }));
  const server = createServer((request, response) => { setTimeout(() => response.end('{"ok":true}'), 1300); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const plan = timeoutMs => ({ url: `http://127.0.0.1:${server.address().port}/slow`, method: 'GET', headers: {}, redirect: 'error', credentials: 'omit', maxResponseBytes: 128, timeoutMs });
  try {
    await assert.rejects(boundedHttp(plan(1000), new AbortController().signal), /Host request failed/u);
    assert.equal((await boundedHttp(plan(5000), new AbortController().signal)).body.ok, true);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
