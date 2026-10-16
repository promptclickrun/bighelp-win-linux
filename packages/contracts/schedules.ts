// Hermes scheduled tasks (stock REST /api/cron/*). Decoders keep what a person
// needs to read and edit a task. Authority fields (id, owning profile, the job a
// run belongs to) are strict; unknown display metadata is dropped. Host paths
// (hermes_home, scripts) and internal scheduler state never cross this boundary.
import { boundedString, encodeBoundedJson } from './rpc.ts';

export type TaskSchedule = Readonly<{ kind: 'cron'; expr: string }>
  | Readonly<{ kind: 'interval'; minutes: number }>
  | Readonly<{ kind: 'once'; at: string }>;
export type TaskState = 'scheduled' | 'paused' | 'completed' | 'error' | 'unknown';
export type ScheduledTask = Readonly<{
  id: string; name: string;
  // Null when the stored instructions cannot be shown safely here (too long or
  // unusual characters); the task is then read-only in bighelp.
  prompt: string | null;
  schedule: TaskSchedule;
  // Hermes' own wording of the schedule ("every monday 9am", "0 9 * * 1-5").
  scheduleText: string;
  state: TaskState; enabled: boolean;
  // A run is in progress (latest execution claimed or running). List reads only.
  running: boolean;
  nextRunAt: string | null; lastRunAt: string | null; createdAt: string | null;
  // The host clock's UTC offset in minutes, from a timestamp it wrote. Jobs have
  // no zone field; cron times use the host's configured zone.
  hostOffsetMinutes: number | null;
  lastStatus: string | null; lastError: string | null;
  deliver: string; model: string | null; workdir: string | null;
  // Script, skill or script-only jobs are set up on the Hermes computer.
  hostManaged: boolean;
  repeat: Readonly<{ times: number | null; completed: number }> | null;
  // Which optional fields this host stores (it drops unknown fields silently).
  stores: Readonly<{ model: boolean; workdir: boolean }>;
}>;
export type TaskRun = Readonly<{
  id: string; kind: 'agent' | 'output';
  startedAt: string | null; endedAt: string | null; active: boolean;
  // Output rows only: Hermes' short "COMPLETED · …" line.
  summary: string | null;
  model: string | null; inputTokens: number | null; outputTokens: number | null;
  estimatedCost: number | null; actualCost: number | null;
}>;
export type DeliveryTarget = Readonly<{ id: string; name: string; ready: boolean }>;

const invalid = (): never => { throw new TypeError('Invalid scheduled task response'); };
function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
const UNSAFE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/u;
function text(value: unknown, max: number, options: Readonly<{ empty?: boolean; multiline?: boolean }> = {}): string {
  const result = boundedString(value, max);
  if ((!options.empty && !result.trim()) || UNSAFE.test(result) || (!options.multiline && /[\n\r\t]/u.test(result))) return invalid();
  return result;
}
// Display text from the host that may be long or messy: clip instead of refusing.
function clipped(value: unknown, max: number): string | null {
  if (typeof value !== 'string' || !value.isWellFormed()) return null;
  const line = value.replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]+/gu, ' ').replace(/\s+/gu, ' ').trim();
  if (!line) return null;
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}
function multiline(value: unknown, max: number): string | null {
  if (typeof value !== 'string' || value.length > max || !value.isWellFormed() || UNSAFE.test(value)) return null;
  return value;
}
function identifier(value: unknown, max = 160): string {
  const result = text(value, max);
  if (!/^[A-Za-z0-9_.:@~-]+$/u.test(result) || result === '.' || result === '..') return invalid();
  return result;
}
function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
function money(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < 1e9 ? value : null;
}
const ISO = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/u;
// ISO-8601 with an explicit offset, as Hermes writes job timestamps. Returns UTC ISO.
export function hostInstant(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const raw = text(value, 64);
  const match = ISO.exec(raw);
  if (!match) return invalid();
  const instant = Date.parse(raw);
  if (!Number.isFinite(instant) || instant < 0 || instant > 253402300799000) return invalid();
  return new Date(instant).toISOString();
}
function offsetMinutes(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = ISO.exec(value);
  if (!match) return null;
  const zone = match[5]!;
  if (zone === 'Z') return 0;
  const minutes = Number(zone.slice(1, 3)) * 60 + Number(zone.slice(4, 6));
  return minutes > 18 * 60 ? null : zone.startsWith('-') ? -minutes : minutes;
}
// Session rows use epoch seconds.
function epoch(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 253402300799) return null;
  return new Date(Math.round(value * 1000)).toISOString();
}
function schedule(value: unknown): TaskSchedule {
  const row = object(value);
  if (row.kind === 'cron') return Object.freeze({ kind: 'cron', expr: text(row.expr, 2048) });
  if (row.kind === 'interval') {
    const minutes = row.minutes;
    if (typeof minutes !== 'number' || !Number.isSafeInteger(minutes) || minutes < 1 || minutes > 10 * 366 * 24 * 60) return invalid();
    return Object.freeze({ kind: 'interval', minutes });
  }
  if (row.kind === 'once') return Object.freeze({ kind: 'once', at: hostInstant(row.run_at) ?? invalid() });
  return invalid();
}
const STATES: readonly TaskState[] = ['scheduled', 'paused', 'completed', 'error'];

// One job as returned by list/create/update/pause/resume/trigger. Every cron route
// annotates the owning profile; a job from another profile is refused.
export function decodeScheduledTask(value: unknown, profile: string): ScheduledTask {
  const row = object(value);
  if (row.profile !== profile) return invalid();
  const parsed = schedule(row.schedule);
  const state = STATES.includes(row.state as TaskState) ? row.state as TaskState : 'unknown';
  if (typeof row.enabled !== 'boolean') return invalid();
  const latest = row.latest_execution !== null && typeof row.latest_execution === 'object' && !Array.isArray(row.latest_execution)
    ? row.latest_execution as Record<string, unknown> : null;
  const skills = Array.isArray(row.skills) ? row.skills.length > 0 : false;
  const repeat = row.repeat !== null && typeof row.repeat === 'object' && !Array.isArray(row.repeat) ? row.repeat as Record<string, unknown> : null;
  return Object.freeze({
    id: identifier(row.id, 64), name: clipped(row.name, 240) ?? '', prompt: multiline(row.prompt ?? '', 256000),
    schedule: parsed,
    scheduleText: clipped(row.schedule_display, 300) ?? (parsed.kind === 'cron' ? parsed.expr : parsed.kind === 'interval' ? `every ${parsed.minutes}m` : parsed.at),
    state, enabled: row.enabled,
    running: latest !== null && (latest.status === 'claimed' || latest.status === 'running'),
    nextRunAt: hostInstant(row.next_run_at), lastRunAt: hostInstant(row.last_run_at), createdAt: hostInstant(row.created_at),
    // created_at and last_run_at are written on the host clock; a one-time run_at keeps the sender's offset.
    hostOffsetMinutes: offsetMinutes(row.last_run_at) ?? offsetMinutes(row.created_at) ?? offsetMinutes(row.next_run_at),
    lastStatus: clipped(row.last_status, 64), lastError: clipped(row.last_error, 500),
    // Routing text is only displayed and compared; bighelp sends it back only when changed.
    deliver: clipped(row.deliver, 512) ?? 'local', model: clipped(row.model, 200), workdir: clipped(row.workdir, 4096),
    hostManaged: !!row.script || row.no_agent === true || skills || !!row.skill,
    repeat: repeat ? Object.freeze({ times: count(repeat.times), completed: count(repeat.completed) ?? 0 }) : null,
    stores: Object.freeze({ model: Object.hasOwn(row, 'model'), workdir: Object.hasOwn(row, 'workdir') }),
  });
}

// GET /api/cron/jobs?profile=<p>: a bare array (older hosts may wrap it in {jobs}).
export function decodeScheduledTasks(value: unknown, profile: string): readonly ScheduledTask[] {
  encodeBoundedJson(value, 4 * 1024 * 1024 - 256);
  const rows = Array.isArray(value) ? value : object(value).jobs;
  if (!Array.isArray(rows) || rows.length > 500) return invalid();
  const tasks = rows.map(row => decodeScheduledTask(row, profile));
  if (new Set(tasks.map(task => task.id)).size !== tasks.length) return invalid();
  return Object.freeze(tasks);
}

// GET /api/cron/jobs/{id}/runs: newest first. Agent rows are stored sessions;
// output rows come from the run ledger and carry no profile. Each row must name
// this job: by cron_job_id, or by Hermes' id prefixes for older rows.
export function decodeTaskRuns(value: unknown, jobId: string, profile: string): readonly TaskRun[] {
  const payload = object(value);
  if (!Array.isArray(payload.runs) || payload.runs.length > 100) return invalid();
  const runs = payload.runs.map(entry => {
    const row = object(entry);
    const id = text(row.id, 512);
    if (row.profile !== undefined && row.profile !== profile) return invalid();
    const output = row.source === 'cron_output';
    if (row.cron_job_id !== undefined && row.cron_job_id !== null) { if (row.cron_job_id !== jobId) return invalid(); }
    else if (!id.startsWith(output ? `cron_output:${jobId}:` : `cron_${jobId}_`)) return invalid();
    const started = epoch(row.started_at), ended = epoch(row.ended_at);
    return Object.freeze({
      id, kind: output ? 'output' as const : 'agent' as const,
      startedAt: started, endedAt: ended, active: row.is_active === true,
      summary: output ? clipped(row.title, 300) : null,
      model: clipped(row.model, 200),
      inputTokens: output ? null : count(row.input_tokens), outputTokens: output ? null : count(row.output_tokens),
      estimatedCost: money(row.estimated_cost_usd), actualCost: money(row.actual_cost_usd),
    });
  });
  if (new Set(runs.map(run => run.id)).size !== runs.length) return invalid();
  return Object.freeze(runs);
}

// GET /api/cron/delivery-targets: `local` first, then platforms and Bot Chats.
// A platform without a home channel cannot receive results yet.
export function decodeDeliveryTargets(value: unknown): readonly DeliveryTarget[] {
  const payload = object(value);
  if (!Array.isArray(payload.targets) || payload.targets.length > 64) return invalid();
  const targets = payload.targets.map(entry => {
    const row = object(entry);
    return Object.freeze({ id: identifier(row.id, 256), name: clipped(row.name, 120) ?? identifier(row.id, 256),
      ready: row.home_target_set !== false });
  });
  if (new Set(targets.map(target => target.id)).size !== targets.length) return invalid();
  return Object.freeze(targets);
}
