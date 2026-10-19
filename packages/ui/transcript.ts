// Arranges transcript items into what the conversation shows. Pure: no I/O.
// Finished turns fold their tool steps (and reasoning, and in-between commentary)
// into one "Worked" row above the answer; the turn in progress stays open.
import type { TranscriptItem } from './view-model.ts';

type Message = Extract<TranscriptItem, { kind: 'message' }>;
type Notice = Extract<TranscriptItem, { kind: 'notice' }>;
export type WorkRow = Readonly<{
  kind: 'work'; id: string; live: boolean; items: readonly TranscriptItem[];
  steps: number; failed: number; stopped: number; summary: string;
}>;
export type Row =
  | Readonly<{ kind: 'day'; id: string; label: string }>
  | Readonly<{ kind: 'message'; id: string; item: Message }>
  | Readonly<{ kind: 'notice'; id: string; item: Notice }>
  | WorkRow;

function summarize(items: readonly TranscriptItem[], live: boolean): Omit<WorkRow, 'kind' | 'id' | 'live' | 'items'> {
  const tools = items.filter(item => item.kind === 'tool');
  const failed = tools.filter(item => item.kind === 'tool' && item.state === 'failed').length;
  const stopped = tools.filter(item => item.kind === 'tool' && item.state === 'stopped').length;
  const running = [...tools].reverse().find(item => item.kind === 'tool' && item.state === 'running');
  const steps = tools.length;
  const count = steps === 1 ? '1 step' : `${steps} steps`;
  let summary: string;
  if (live && running?.kind === 'tool') summary = `${running.label}…`;
  else if (live) summary = 'Working';
  else if (!steps) summary = 'Thought it through';
  else if (failed) summary = `Hit a snag · ${count}`;
  else if (stopped) summary = `Stopped · ${count}`;
  else summary = `Worked · ${count}`;
  return { steps, failed, stopped, summary };
}

function work(id: string, items: readonly TranscriptItem[], live: boolean): WorkRow {
  return Object.freeze({ kind: 'work', id, live, items: Object.freeze([...items]), ...summarize(items, live) });
}

export function projectRows(items: readonly TranscriptItem[], options: Readonly<{ liveTurn: string | null; showReasoning: boolean }>): readonly Row[] {
  const visible = items.filter(item => item.kind !== 'reasoning' || options.showReasoning);
  const rows: Row[] = [];
  let index = 0;
  while (index < visible.length) {
    const item = visible[index]!;
    if (item.kind === 'day') { rows.push(Object.freeze({ kind: 'day', id: item.id, label: item.label })); index++; continue; }
    if (item.kind === 'message' && item.direction === 'out') { rows.push(Object.freeze({ kind: 'message', id: item.id, item })); index++; continue; }
    // Collect the reply side of one turn: everything up to the next day or outgoing message
    // of a different turn.
    const turn = 'turn' in item ? item.turn : undefined;
    const group: TranscriptItem[] = [];
    while (index < visible.length) {
      const next = visible[index]!;
      if (next.kind === 'day' || (next.kind === 'message' && next.direction === 'out')) break;
      const nextTurn = 'turn' in next ? next.turn : undefined;
      if (group.length && nextTurn !== turn) break;
      group.push(next); index++;
    }
    const live = turn !== undefined && turn === options.liveTurn;
    if (live) {
      // In progress: keep order; consecutive steps form an open work trail.
      let trail: TranscriptItem[] = [];
      const flush = () => { if (trail.length) { rows.push(work(`work:${trail[0]!.id}`, trail, true)); trail = []; } };
      for (const entry of group) {
        if (entry.kind === 'tool' || entry.kind === 'reasoning') { trail.push(entry); continue; }
        flush();
        if (entry.kind === 'message') rows.push(Object.freeze({ kind: 'message', id: entry.id, item: entry }));
        else if (entry.kind === 'notice') rows.push(Object.freeze({ kind: 'notice', id: entry.id, item: entry }));
      }
      flush();
      continue;
    }
    // Finished: the last assistant message is the answer; earlier ones were commentary.
    const replies = group.filter((entry): entry is Message => entry.kind === 'message');
    const answer = replies.at(-1);
    const steps = group.filter(entry => entry.kind === 'tool' || entry.kind === 'reasoning' || (entry.kind === 'message' && entry !== answer));
    if (steps.some(entry => entry.kind === 'tool' || entry.kind === 'reasoning')) rows.push(work(`work:${steps[0]!.id}`, steps, false));
    else for (const entry of steps) if (entry.kind === 'message') rows.push(Object.freeze({ kind: 'message', id: entry.id, item: entry }));
    if (answer) rows.push(Object.freeze({ kind: 'message', id: answer.id, item: answer }));
    for (const entry of group) if (entry.kind === 'notice') rows.push(Object.freeze({ kind: 'notice', id: entry.id, item: entry }));
  }
  return Object.freeze(rows);
}

export function formatDuration(milliseconds: number): string {
  if (milliseconds < 100) return '';
  if (milliseconds < 10_000) return `${(milliseconds / 1000).toFixed(1)}s`;
  const seconds = Math.round(milliseconds / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes}m ${seconds % 60}s` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
