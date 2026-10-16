// Scheduled tasks on the connected computer (Hermes cron). Every task belongs to
// one agent (profile). Runs spend AI credits; nothing here runs in the background.
import type { DeliveryTarget, ScheduledTask, TaskRun } from '../../../../../packages/contracts/schedules.ts';
import { defineCall } from '../call.ts';
import { InvalidInput, boolean, fields, identifier, optional, segment, text } from '../validate.ts';

export type TaskList = Readonly<{ profile: string; tasks: readonly ScheduledTask[] }>;
// A confirmed write. `notes` are plain sentences about anything Hermes saved
// differently from the request (for example, a field this host does not keep).
export type TaskSaved = Readonly<{ profile: string; task: ScheduledTask | null; notes: readonly string[] }>;
export type TaskRunResult = Readonly<{ profile: string; task: ScheduledTask; ran: boolean }>;

export function profileName(value: unknown): string {
  const result = identifier(value, 128);
  if (result === 'all' || /[/\\]/u.test(result) || result === '.' || result === '..') throw new InvalidInput();
  return result;
}
export const taskId = (value: unknown) => segment(value, 64);
const name = (value: unknown) => {
  const result = text(value, { max: 240 });
  if (!result.trim()) throw new InvalidInput();
  return result.trim();
};
const prompt = (value: unknown) => {
  const result = text(value, { max: 256000, multiline: true });
  if (!result.trim()) throw new InvalidInput();
  return result.trim();
};
const schedule = (value: unknown) => {
  const result = text(value, { max: 2048 });
  if (!result.trim()) throw new InvalidInput();
  return result.trim();
};
// Delivery target ids from the host list: local, a platform, platform:chat[:thread], bot-chat:<profile>.
const deliver = (value: unknown) => {
  const result = identifier(value, 512);
  if (!/^[A-Za-z0-9_.:@,~+-]+$/u.test(result)) throw new InvalidInput();
  return result;
};
// Optional fields; an empty string clears them on edit.
const model = (value: unknown) => text(value, { max: 200, min: 0 }).trim();
const workdir = (value: unknown) => text(value, { max: 4096, min: 0 }).trim();

const CHANGES = ['name', 'prompt', 'schedule', 'deliver', 'model', 'workdir'] as const;
export type TaskChanges = Readonly<Partial<Record<typeof CHANGES[number], string>>>;
export type TaskDraft = Readonly<{ profile: string; name: string; prompt: string; schedule: string; deliver: string; model?: string; workdir?: string }>;
const PARSE = Object.freeze({ name, prompt, schedule, deliver, model, workdir });

export const SCHEDULE_CALLS = Object.freeze({
  'schedules.list': defineCall<TaskList>()(input => {
    const value = fields(input, ['profile']);
    return Object.freeze({ profile: profileName(value.profile) });
  }),
  'schedules.targets': defineCall<Readonly<{ profile: string; targets: readonly DeliveryTarget[] }>>()(input => {
    const value = fields(input, ['profile']);
    return Object.freeze({ profile: profileName(value.profile) });
  }),
  'schedules.runs': defineCall<Readonly<{ profile: string; id: string; runs: readonly TaskRun[] }>>()(input => {
    const value = fields(input, ['profile', 'id']);
    return Object.freeze({ profile: profileName(value.profile), id: taskId(value.id) });
  }),
  'schedules.create': defineCall<TaskSaved>()(input => {
    const value = fields(input, ['profile', 'name', 'prompt', 'schedule', 'deliver'], ['model', 'workdir']);
    const chosenModel = optional(value.model, model), folder = optional(value.workdir, workdir);
    const draft: TaskDraft = { profile: profileName(value.profile), name: name(value.name), prompt: prompt(value.prompt),
      schedule: schedule(value.schedule), deliver: deliver(value.deliver),
      ...(chosenModel ? { model: chosenModel } : {}), ...(folder ? { workdir: folder } : {}) };
    return Object.freeze(draft);
  }),
  // Only the fields the person changed. Hermes recomputes the next run from now
  // whenever a schedule is sent, so an unchanged schedule must not be sent.
  'schedules.update': defineCall<TaskSaved>()(input => {
    const value = fields(input, ['profile', 'id', 'changes']);
    const given = fields(value.changes, [], CHANGES);
    if (Object.keys(given).length === 0) throw new InvalidInput();
    const changes: Partial<Record<typeof CHANGES[number], string>> = {};
    for (const key of CHANGES) if (given[key] !== undefined) changes[key] = PARSE[key](given[key]);
    return Object.freeze({ profile: profileName(value.profile), id: taskId(value.id), changes: Object.freeze(changes) as TaskChanges });
  }),
  'schedules.setPaused': defineCall<TaskSaved>()(input => {
    const value = fields(input, ['profile', 'id', 'paused']);
    return Object.freeze({ profile: profileName(value.profile), id: taskId(value.id), paused: boolean(value.paused) });
  }),
  // `resume` records that the person agreed a paused task turns back on when run.
  'schedules.run': defineCall<TaskRunResult>()(input => {
    const value = fields(input, ['profile', 'id', 'resume']);
    return Object.freeze({ profile: profileName(value.profile), id: taskId(value.id), resume: boolean(value.resume) });
  }),
  'schedules.delete': defineCall<Readonly<{ profile: string; id: string }>>()(input => {
    const value = fields(input, ['profile', 'id']);
    return Object.freeze({ profile: profileName(value.profile), id: taskId(value.id) });
  }),
});
