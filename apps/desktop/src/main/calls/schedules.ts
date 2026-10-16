// Scheduled tasks over stock Hermes REST (/api/cron/*). Hermes has no ETag or
// idempotency key for these routes, so every write checks the task is in this
// agent's list first, requires the reply to name the same agent and task, and is
// never retried. A lost reply is "not sure", never success.
import { decodeDeliveryTargets, decodeScheduledTask, decodeScheduledTasks, decodeTaskRuns } from '../../../../../packages/contracts/schedules.ts';
import type { ScheduledTask } from '../../../../../packages/contracts/schedules.ts';
import { expectedSchedule, sameSchedule } from '../../../../../packages/domain/schedule.ts';
import { HttpStatusError, LONG_HTTP_TIMEOUT_MS } from '../../../../../packages/platform/transport-policy.ts';
import type { SCHEDULE_CALLS, TaskChanges, TaskDraft } from '../../shared/calls/schedules.ts';
import type { CallContext } from './context.ts';
import { CallError } from './context.ts';
import type { CallHandlers } from './index.ts';

const LIST_BYTES = 4 * 1024 * 1024 - 256;
const JOB_BYTES = 2 * 1024 * 1024;
const GONE = 'That task is no longer on your computer. Refresh the list.';
const UNSUPPORTED = "This computer's Hermes can't manage scheduled tasks. A Hermes update may be needed.";

const path = (id: string, action?: 'pause' | 'resume' | 'trigger' | 'runs') =>
  `/api/cron/jobs/${encodeURIComponent(id)}${action ? `/${action}` : ''}`;

// The request may have reached Hermes and its answer was lost or failed inside.
function lost(error: unknown): boolean {
  if (error instanceof CallError) return false;
  if (error instanceof HttpStatusError) return error.status >= 500;
  return !(error instanceof Error && error.message === 'Host changed');
}
function profileGone(error: unknown): boolean {
  return error instanceof HttpStatusError && error.status === 404 && /^Profile '.*' does not exist\.?$/u.test(error.detail);
}
// Known refusals in plain words; anything else falls through to callFailure().
function refusal(error: unknown): unknown {
  if (profileGone(error)) return new CallError('stale', 'That agent is no longer on your computer.');
  if (error instanceof HttpStatusError && error.status === 404 && error.detail === 'Job not found') return new CallError('stale', GONE);
  if (error instanceof HttpStatusError && error.status === 400 && error.detail.startsWith('Cannot activate terminal cron job')) {
    return new CallError('invalid', "This task has finished, so its schedule can't change. Create a new task instead.");
  }
  return error;
}
function decoded<T>(decode: () => T, written: boolean): T {
  try { return decode(); } catch {
    throw written ? new CallError('unknown', 'Hermes answered in a way bighelp could not check. Look at this task before trying again.')
      : new CallError('invalid', 'Hermes sent scheduled tasks in a form bighelp does not understand.');
  }
}

async function list(context: CallContext, profile: string): Promise<readonly ScheduledTask[]> {
  let response;
  try { response = await context.http({ method: 'GET', path: '/api/cron/jobs', query: { profile }, maxBytes: LIST_BYTES }); }
  catch (error) {
    if (error instanceof HttpStatusError && [404, 405, 501].includes(error.status) && !profileGone(error)) throw new CallError('unsupported', UNSUPPORTED);
    throw refusal(error);
  }
  return decoded(() => decodeScheduledTasks(response.body, profile), false);
}
// Hermes treats ?profile= as a hint and acts on whichever agent owns the id, so
// confirm this agent owns it before any write.
async function owned(context: CallContext, profile: string, id: string): Promise<ScheduledTask> {
  const task = (await list(context, profile)).find(row => row.id === id);
  if (!task) throw new CallError('stale', GONE);
  return task;
}
function confirmed(body: unknown, profile: string, id: string | null): ScheduledTask {
  const task = decoded(() => decodeScheduledTask(body, profile), true);
  if (id !== null && task.id !== id) throw new CallError('unknown', 'Hermes answered about a different task. Look at your tasks before trying again.');
  return task;
}

// Plain notes for anything Hermes kept differently from the request.
function readBack(sent: TaskChanges, task: ScheduledTask): string[] {
  const notes: string[] = [];
  if (sent.name !== undefined && task.name !== sent.name) notes.push(`Hermes saved the name as “${task.name}”.`);
  if (sent.prompt !== undefined && task.prompt !== sent.prompt) notes.push('Hermes saved the instructions differently. Check them.');
  if (sent.deliver !== undefined && task.deliver !== sent.deliver) notes.push('Hermes saved a different place for results.');
  for (const [key, label] of [['model', 'model'], ['workdir', 'working folder']] as const) {
    const wanted = sent[key];
    if (wanted === undefined || task[key] === (wanted || null)) continue;
    const saved = task[key];
    notes.push(!task.stores[key] ? `Hermes on this computer doesn't keep a ${label} for tasks.`
      : saved === null ? `Hermes didn't keep the ${label}.` : `Hermes saved the ${label} as “${saved}”.`);
  }
  const expected = sent.schedule === undefined ? null : expectedSchedule(sent.schedule);
  if (expected && !sameSchedule(expected, task.schedule)) notes.push('Hermes read the schedule differently. Check when it runs.');
  return notes;
}
// After a lost create reply: a task that was not there before, with the same
// name and instructions, is the one this request saved.
async function findCreated(context: CallContext, draft: TaskDraft, before: ReadonlySet<string>): Promise<ScheduledTask | null> {
  const matches = (await list(context, draft.profile)).filter(task => !before.has(task.id) && task.name === draft.name && task.prompt === draft.prompt);
  return matches.length === 1 ? matches[0]! : null;
}

export const SCHEDULE_HANDLERS: Pick<CallHandlers, keyof typeof SCHEDULE_CALLS> = Object.freeze({
  'schedules.list': {
    mutation: false,
    async run(context, input) {
      context.requireProfile(input.profile);
      return Object.freeze({ profile: input.profile, tasks: await list(context, input.profile) });
    },
  },
  'schedules.targets': {
    mutation: false,
    async run(context, input) {
      context.requireProfile(input.profile);
      let response;
      try { response = await context.http({ method: 'GET', path: '/api/cron/delivery-targets', query: { profile: input.profile }, maxBytes: 65536 }); }
      catch (error) {
        if (error instanceof HttpStatusError && [404, 405, 501].includes(error.status) && !profileGone(error)) {
          throw new CallError('unsupported', "This computer's Hermes doesn't list places to send results.");
        }
        throw refusal(error);
      }
      return Object.freeze({ profile: input.profile, targets: decoded(() => decodeDeliveryTargets(response.body), false) });
    },
  },
  'schedules.runs': {
    mutation: false,
    async run(context, input) {
      context.requireProfile(input.profile);
      let response;
      try { response = await context.http({ method: 'GET', path: path(input.id, 'runs'), query: { profile: input.profile, limit: '20' }, maxBytes: LIST_BYTES }); }
      catch (error) { throw refusal(error); }
      return Object.freeze({ profile: input.profile, id: input.id, runs: decoded(() => decodeTaskRuns(response.body, input.id, input.profile), false) });
    },
  },
  'schedules.create': {
    mutation: true,
    async run(context, input) {
      context.requireProfile(input.profile);
      const before = new Set((await list(context, input.profile)).map(task => task.id));
      const body = { name: input.name, prompt: input.prompt, schedule: input.schedule, deliver: input.deliver,
        ...(input.model ? { model: input.model } : {}), ...(input.workdir ? { workdir: input.workdir } : {}) };
      let response;
      try {
        response = await context.http({ method: 'POST', path: '/api/cron/jobs', query: { profile: input.profile }, body: JSON.stringify(body), maxBytes: JOB_BYTES });
      } catch (error) {
        // 424: saved, but the external scheduler did not take the first run. Never create it again.
        if (error instanceof HttpStatusError && error.status === 424) {
          const task = await findCreated(context, input, before).catch(() => null);
          return Object.freeze({ profile: input.profile, task, notes: Object.freeze([
            "Saved, but Hermes couldn't confirm the schedule with its scheduler yet. Don't create it again. Check it in the list."]) });
        }
        if (lost(error)) {
          const task = await findCreated(context, input, before).catch(() => null);
          if (task) return Object.freeze({ profile: input.profile, task, notes: Object.freeze(['The reply was lost, but the task is saved.', ...readBack(input, task)]) });
          throw new CallError('unknown', 'Not sure this was saved. Check the list before creating it again.');
        }
        throw refusal(error);
      }
      const task = confirmed(response.body, input.profile, null);
      return Object.freeze({ profile: input.profile, task, notes: Object.freeze(readBack(input, task)) });
    },
  },
  'schedules.update': {
    mutation: true,
    async run(context, input) {
      context.requireProfile(input.profile);
      const task = await owned(context, input.profile, input.id);
      if (task.hostManaged) throw new CallError('unsupported', 'This task uses scripts or skills set up on the Hermes computer. Change it there.');
      if (task.prompt === null && input.changes.prompt !== undefined) throw new CallError('unsupported', "These instructions can't be edited in bighelp. Change them on the Hermes computer.");
      // Send only real changes. An unchanged schedule would restart interval timing.
      const updates: Record<string, string> = {};
      const { changes } = input;
      if (changes.name !== undefined && changes.name !== task.name) updates.name = changes.name;
      if (changes.prompt !== undefined && changes.prompt !== task.prompt) updates.prompt = changes.prompt;
      if (changes.deliver !== undefined && changes.deliver !== task.deliver) updates.deliver = changes.deliver;
      if (changes.model !== undefined && (changes.model || null) !== task.model) updates.model = changes.model;
      if (changes.workdir !== undefined && (changes.workdir || null) !== task.workdir) updates.workdir = changes.workdir;
      if (changes.schedule !== undefined) {
        const expected = expectedSchedule(changes.schedule);
        const same = expected ? sameSchedule(expected, task.schedule)
          : changes.schedule === task.scheduleText || (task.schedule.kind === 'cron' && changes.schedule === task.schedule.expr);
        if (!same) updates.schedule = changes.schedule;
      }
      if (Object.keys(updates).length === 0) return Object.freeze({ profile: input.profile, task, notes: Object.freeze(['Nothing changed.']) });
      let response;
      try {
        response = await context.http({ method: 'PUT', path: path(input.id), query: { profile: input.profile }, body: JSON.stringify({ updates }), maxBytes: JOB_BYTES });
      } catch (error) {
        if (lost(error)) throw new CallError('unknown', 'Not sure this change was saved. Check the task before changing it again.');
        throw refusal(error);
      }
      const saved = confirmed(response.body, input.profile, input.id);
      return Object.freeze({ profile: input.profile, task: saved, notes: Object.freeze(readBack(updates, saved)) });
    },
  },
  'schedules.setPaused': {
    mutation: true,
    async run(context, input) {
      context.requireProfile(input.profile);
      const task = await owned(context, input.profile, input.id);
      if (task.state === 'completed') throw new CallError('invalid', 'This task has finished. Create a new task to run it again.');
      const paused = !task.enabled || task.state === 'paused';
      if (paused === input.paused) return Object.freeze({ profile: input.profile, task, notes: Object.freeze([]) });
      if (!input.paused && task.schedule.kind === 'once' && Date.parse(task.schedule.at) <= Date.now()) {
        throw new CallError('invalid', 'Its one-time run is in the past. Change when it runs first.');
      }
      let response;
      try {
        response = await context.http({ method: 'POST', path: path(input.id, input.paused ? 'pause' : 'resume'), query: { profile: input.profile }, maxBytes: JOB_BYTES });
      } catch (error) {
        if (lost(error)) throw new CallError('unknown', `Not sure the task was ${input.paused ? 'paused' : 'resumed'}. Check it before trying again.`);
        throw refusal(error);
      }
      const saved = confirmed(response.body, input.profile, input.id);
      if (saved.enabled === input.paused || (input.paused && saved.state !== 'paused')) {
        throw new CallError('unknown', "Hermes didn't confirm the change. Check this task before trying again.");
      }
      // Resuming keeps a missed slot due, and Hermes runs it on its next tick.
      const soon = !input.paused && saved.nextRunAt !== null && Date.parse(saved.nextRunAt) <= Date.now() + 2 * 60_000;
      return Object.freeze({ profile: input.profile, task: saved,
        notes: Object.freeze(soon ? ['It missed a run while paused, so it may run in the next minute or two. That uses AI credits.'] : []) });
    },
  },
  'schedules.run': {
    mutation: true,
    async run(context, input) {
      context.requireProfile(input.profile);
      const task = await owned(context, input.profile, input.id);
      if (task.running) throw new CallError('conflict', 'This task is already running. Check Recent runs.');
      if (task.state === 'completed') throw new CallError('invalid', 'This task has finished. Create a new task to run it again.');
      if ((!task.enabled || task.state === 'paused') && !input.resume) {
        throw new CallError('conflict', 'This task is paused. Running it now also turns its schedule back on.');
      }
      // Hermes answers only after the whole run. Wait long, and never send it twice.
      let response;
      try {
        response = await context.http({ method: 'POST', path: path(input.id, 'trigger'), query: { profile: input.profile }, maxBytes: JOB_BYTES, timeoutMs: LONG_HTTP_TIMEOUT_MS });
      } catch (error) {
        if (error instanceof HttpStatusError && error.status === 409) {
          throw new CallError('conflict', "Hermes says this task is already running or can't run right now. Check Recent runs.");
        }
        if (lost(error)) throw new CallError('unknown', 'Not sure the run finished. It may still be running. Check Recent runs before running it again.');
        throw refusal(error);
      }
      const saved = confirmed(response.body, input.profile, input.id);
      return Object.freeze({ profile: input.profile, task: saved, ran: saved.lastRunAt !== task.lastRunAt });
    },
  },
  'schedules.delete': {
    mutation: true,
    async run(context, input) {
      context.requireProfile(input.profile);
      await owned(context, input.profile, input.id);
      let response;
      try { response = await context.http({ method: 'DELETE', path: path(input.id), query: { profile: input.profile }, maxBytes: 4096 }); }
      catch (error) {
        if (lost(error)) throw new CallError('unknown', 'Not sure the task was deleted. Check the list.');
        throw refusal(error);
      }
      const body = response.body;
      const ok = body !== null && typeof body === 'object' && (body as Record<string, unknown>).ok === true;
      // Read back: the task must be gone from this agent's list.
      const still = await list(context, input.profile).then(tasks => tasks.some(task => task.id === input.id), () => null);
      if (!ok || still !== false) throw new CallError('unknown', "Hermes didn't confirm the delete. Check the list.");
      return Object.freeze({ profile: input.profile, id: input.id });
    },
  },
});
