// Friendly schedule choices and plain descriptions for scheduled tasks. Pure:
// no I/O, no clocks except the instant passed in. Hermes parses the final text.
import type { TaskSchedule } from '../contracts/schedules.ts';

export type SchedulePreset =
  | Readonly<{ kind: 'daily' | 'weekdays'; time: string }>
  | Readonly<{ kind: 'hours'; every: number }>
  | Readonly<{ kind: 'once'; at: string }>
  | Readonly<{ kind: 'custom'; text: string }>;
export const HOUR_CHOICES = Object.freeze([1, 2, 3, 4, 6, 8, 12] as const);

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/u;
const CRON_DAY = /^([0-5]?\d) ([01]?\d|2[0-3]) \* \* (\*|1-5|MON-FRI)$/u;
const INTERVAL = /^every ([1-9]\d{0,6})m$/u;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u;

// The exact text sent to Hermes, or a plain reason the choice is incomplete.
// Intervals are sent in minutes, which is how Hermes stores them, so the saved
// task can be compared with the request. One-time runs are absolute UTC instants.
export function scheduleRequest(preset: SchedulePreset, now: number): Readonly<{ ok: true; text: string }> | Readonly<{ ok: false; message: string }> {
  switch (preset.kind) {
    case 'daily': case 'weekdays': {
      const match = TIME.exec(preset.time);
      if (!match) return { ok: false, message: 'Choose a time.' };
      return { ok: true, text: `${Number(match[2])} ${Number(match[1])} * * ${preset.kind === 'daily' ? '*' : '1-5'}` };
    }
    case 'hours':
      if (!HOUR_CHOICES.includes(preset.every as typeof HOUR_CHOICES[number])) return { ok: false, message: 'Choose how often.' };
      return { ok: true, text: `every ${preset.every * 60}m` };
    case 'once': {
      const instant = Date.parse(preset.at);
      if (!Number.isFinite(instant)) return { ok: false, message: 'Choose a date and time.' };
      if (instant <= now + 60_000) return { ok: false, message: 'Choose a date and time in the future.' };
      return { ok: true, text: new Date(Math.floor(instant / 1000) * 1000).toISOString().replace(/\.\d{3}Z$/u, 'Z') };
    }
    case 'custom': {
      const text = preset.text.trim();
      if (!text) return { ok: false, message: 'Describe when it should run.' };
      if (text.length > 2048 || /[\x00-\x1f\x7f]/u.test(text)) return { ok: false, message: 'Use a shorter, single-line schedule.' };
      return { ok: true, text };
    }
  }
}

// What Hermes should store for a request bighelp built itself. Null for custom
// text: Hermes interprets it, and the person sees that interpretation.
export function expectedSchedule(text: string): TaskSchedule | null {
  const day = CRON_DAY.exec(text);
  if (day) return { kind: 'cron', expr: text };
  const interval = INTERVAL.exec(text);
  if (interval) return { kind: 'interval', minutes: Number(interval[1]) };
  if (INSTANT.test(text) && Number.isFinite(Date.parse(text))) return { kind: 'once', at: new Date(Date.parse(text)).toISOString() };
  return null;
}
export function sameSchedule(expected: TaskSchedule, saved: TaskSchedule): boolean {
  if (expected.kind === 'cron') return saved.kind === 'cron' && saved.expr === expected.expr;
  if (expected.kind === 'interval') return saved.kind === 'interval' && saved.minutes === expected.minutes;
  return saved.kind === 'once' && Math.abs(Date.parse(saved.at) - Date.parse(expected.at)) < 1000;
}

const pad = (value: number) => String(value).padStart(2, '0');
// Start the editor from a saved task. Anything bighelp did not build stays as text.
export function presetFor(schedule: TaskSchedule, now: number): SchedulePreset {
  if (schedule.kind === 'cron') {
    const day = CRON_DAY.exec(schedule.expr);
    if (day) return { kind: day[3] === '*' ? 'daily' : 'weekdays', time: `${pad(Number(day[2]))}:${pad(Number(day[1]))}` };
    return { kind: 'custom', text: schedule.expr };
  }
  if (schedule.kind === 'interval') {
    const hours = schedule.minutes / 60;
    if (HOUR_CHOICES.includes(hours as typeof HOUR_CHOICES[number])) return { kind: 'hours', every: hours };
    return { kind: 'custom', text: `every ${schedule.minutes}m` };
  }
  return Date.parse(schedule.at) > now ? { kind: 'once', at: schedule.at } : { kind: 'custom', text: schedule.at };
}

export type ScheduleFormat = Readonly<{ clock(hour: number, minute: number): string; instant(iso: string): string }>;
// Plain words for the common shapes; Hermes' own wording for everything else.
export function describeSchedule(schedule: TaskSchedule, hostText: string, format: ScheduleFormat): string {
  if (schedule.kind === 'cron') {
    const day = CRON_DAY.exec(schedule.expr);
    if (!day) return hostText;
    const clock = format.clock(Number(day[2]), Number(day[1]));
    return day[3] === '*' ? `Every day at ${clock}` : `Weekdays at ${clock}`;
  }
  if (schedule.kind === 'interval') {
    const { minutes } = schedule;
    if (minutes === 60) return 'Every hour';
    if (minutes % 1440 === 0) return minutes === 1440 ? 'Every day' : `Every ${minutes / 1440} days`;
    if (minutes % 60 === 0) return `Every ${minutes / 60} hours`;
    return minutes === 1 ? 'Every minute' : `Every ${minutes} minutes`;
  }
  return `Once, ${format.instant(schedule.at)}`;
}
