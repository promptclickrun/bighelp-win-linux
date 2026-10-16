// Kanban lanes, the finite moves a person may make, and what each move costs.
// Pure: no I/O, no timers. Hermes has nine statuses; the five lanes fold them
// into what matters (bighelp KanbanLane.swift). Only Hermes starts work, so no
// move ever targets Working.
//
// "Later" parks a task in Hermes' `scheduled` status. `todo` is not a parking
// place: every dispatcher tick (60 s by default) promotes a todo task whose
// parents are done, and a task with no parents, to Ready, where an assigned
// agent starts it (hermes_cli/kanban_db.py recompute_ready). `triage` is not one
// either: with Auto plan on (the host default) Hermes splits it with AI.
// Nothing wakes `scheduled` except an explicit move to Ready.
import type { KanbanCard, KanbanCardStatus, KanbanEvent, KanbanStatus } from '../contracts/kanban.ts';

export const KANBAN_LANES = Object.freeze(['later', 'ready', 'working', 'needsYou', 'done'] as const);
export type KanbanLane = typeof KANBAN_LANES[number] | 'other';

export const LANE_TEXT: Readonly<Record<KanbanLane, Readonly<{ title: string; subtitle: string; empty: string }>>> = Object.freeze({
  later: { title: 'Later', subtitle: 'Planned, not started', empty: 'Nothing planned. Add a task for later.' },
  ready: { title: 'Ready', subtitle: 'An agent picks these up next', empty: 'Move a task here when you want an agent to start it.' },
  working: { title: 'Working', subtitle: 'Agents on it now', empty: 'No agent is working on anything.' },
  needsYou: { title: 'Needs you', subtitle: 'Waiting on your answer or review', empty: 'Nothing needs you.' },
  done: { title: 'Done', subtitle: 'Finished', empty: 'Finished tasks land here.' },
  other: { title: 'Other', subtitle: "States this app doesn't know yet", empty: '' },
});

export function laneOf(status: KanbanCardStatus): KanbanLane {
  switch (status) {
    case 'triage': case 'todo': case 'scheduled': return 'later';
    case 'ready': return 'ready';
    case 'running': return 'working';
    case 'blocked': case 'review': return 'needsYou';
    case 'done': return 'done';
    default: return 'other';
  }
}

// The short status line on a card, in plain words.
export function cardNote(card: Pick<KanbanCard, 'status' | 'blockKind' | 'parents'>): string {
  switch (card.status) {
    case 'triage': return 'Planning';
    case 'todo': return card.parents > 0 ? 'Waiting on another task' : 'Moving to Ready soon';
    case 'scheduled': return 'Not started';
    case 'ready': return 'Up next';
    case 'running': return 'Working now';
    case 'blocked': return card.blockKind === 'needs_input' ? 'Has a question'
      : card.blockKind === 'dependency' ? 'Waiting on another task' : 'On hold';
    case 'review': return 'Ready for review';
    case 'done': return 'Finished';
    case 'archived': return 'Archived';
    default: return 'Unknown state';
  }
}

export const KANBAN_MOVES = Object.freeze(['later', 'ready', 'done'] as const);
export type KanbanMove = typeof KANBAN_MOVES[number];

// Moves offered from each server status (workspace-writes spec 5.6). Left out on
// purpose: anything into Working; review -> Later (Hermes refuses to park a
// review and re-gates it into Ready instead); Later -> Done (Hermes refuses);
// anything out of Working (it would stop a running agent). A Later task that is
// still in triage or todo can be held, so Hermes does not plan or start it.
const TARGETS: Readonly<Record<KanbanCardStatus, readonly KanbanMove[]>> = Object.freeze({
  triage: ['later', 'ready'], todo: ['later', 'ready'], scheduled: ['ready'],
  ready: ['later', 'done'], running: [], blocked: ['later', 'ready', 'done'],
  review: ['ready', 'done'], done: ['later', 'ready'], archived: [], other: [],
});
export function moveTargets(status: KanbanCardStatus): readonly KanbanMove[] { return TARGETS[status]; }
export function canMove(status: KanbanCardStatus, move: KanbanMove): boolean { return TARGETS[status].includes(move); }

// Moving to Ready is what makes Hermes start an agent.
export function moveSpends(move: KanbanMove): boolean { return move === 'ready'; }
// Hermes refuses Done without evidence; the person writes it, never the app.
export function moveNeedsNote(move: KanbanMove): boolean { return move === 'done'; }

export type KanbanMoveBody = Readonly<{ status: 'todo' | 'scheduled' | 'ready' }> | Readonly<{ status: 'done'; summary: string }>;
// The exact PATCH bodies, in order, for a permitted move. Hermes parks only from
// todo, ready, running or blocked, so triage and done pass through todo first.
// Throws for anything not offered.
export function moveSteps(status: KanbanCardStatus, move: KanbanMove, note?: string): readonly KanbanMoveBody[] {
  if (!canMove(status, move)) throw new TypeError('Move not offered');
  if (move === 'later') {
    const park = Object.freeze({ status: 'scheduled' as const });
    return Object.freeze(status === 'triage' || status === 'done' ? [Object.freeze({ status: 'todo' as const }), park] : [park]);
  }
  if (move === 'ready') return Object.freeze([Object.freeze({ status: 'ready' as const })]);
  const summary = note?.trim() ?? '';
  if (!summary) throw new TypeError('A result note is required');
  return Object.freeze([Object.freeze({ status: 'done' as const, summary })]);
}
// The status a card shows while its move is in flight.
export function moveStatus(move: KanbanMove): KanbanStatus { return move === 'later' ? 'scheduled' : move; }

export function moveLabel(move: KanbanMove, from?: KanbanCardStatus): string {
  if (move === 'later') return from === 'triage' || from === 'todo' ? 'Hold in Later' : 'Move to Later';
  return move === 'ready' ? 'Move to Ready (starts the agent)' : 'Move to Done…';
}

export const SPENDING_NOTE = 'This starts the agent and uses AI credits.';
const WAITING_NOTE = 'Tasks waiting on this one may start next, which uses AI credits.';

// What must happen before a move is sent: nothing, a spending confirmation, or a
// result note. Never skipped: the UI sends only after the person confirms.
export type KanbanGate =
  | Readonly<{ kind: 'none' }>
  | Readonly<{ kind: 'spend'; title: string; body: string; confirm: string }>
  | Readonly<{ kind: 'note'; title: string; body: string; confirm: string }>;
export function moveGate(card: Pick<KanbanCard, 'status' | 'title' | 'children'>, move: KanbanMove): KanbanGate {
  if (!canMove(card.status, move)) throw new TypeError('Move not offered');
  if (move === 'ready') {
    const [title, confirm] = card.status === 'blocked' ? ['Try again?', 'Try again']
      : card.status === 'review' ? ['Send it back to the agent?', 'Send back']
        : card.status === 'done' ? ['Run it again?', 'Run again'] : ['Start now?', 'Start now'];
    return Object.freeze({ kind: 'spend', title, confirm, body: `Moving “${card.title}” to Ready. ${SPENDING_NOTE}` });
  }
  if (move === 'done') {
    return Object.freeze({ kind: 'note', title: card.status === 'review' ? 'Approve this task' : 'Mark as done', confirm: 'Mark done',
      body: card.children > 0 ? `Write a short note about the result. ${WAITING_NOTE}` : 'Write a short note about the result.' });
  }
  return Object.freeze({ kind: 'none' });
}

// The one main action a task's page offers, if any.
export function primaryMove(status: KanbanCardStatus): Readonly<{ move: KanbanMove; label: string }> | null {
  switch (status) {
    case 'triage': case 'todo': case 'scheduled': return { move: 'ready', label: 'Start now' };
    case 'blocked': return { move: 'ready', label: 'Try again' };
    case 'review': return { move: 'done', label: 'Approve' };
    case 'done': return { move: 'later', label: 'Reopen' };
    default: return null;
  }
}

// Giving a Ready task (or one Hermes is about to make Ready) to an agent lets
// Hermes start it without another step.
export function assignSpends(card: Pick<KanbanCard, 'status' | 'parents'>, assignee: string | null): boolean {
  return assignee !== null && (card.status === 'ready' || (card.status === 'todo' && card.parents === 0));
}
export function assignAllowed(card: Pick<KanbanCard, 'status'>): boolean {
  return card.status !== 'running' && card.status !== 'other' && card.status !== 'archived';
}
export function deleteAllowed(card: Pick<KanbanCard, 'status'>): boolean { return card.status !== 'running'; }
export function deleteBody(card: Pick<KanbanCard, 'title' | 'children'>): string {
  return `This removes “${card.title}” and its comments for everyone using this computer. You can't undo this.`
    + (card.children > 0 ? ` ${WAITING_NOTE}` : '');
}

// Optimistic move: show the card in its new lane at once; put it back exactly
// as it was when Hermes refuses or the outcome is unknown.
export type PendingMove = Readonly<{ id: string; previous: KanbanCard }>;
export function startMove(cards: readonly KanbanCard[], id: string, move: KanbanMove):
  Readonly<{ cards: readonly KanbanCard[]; pending: PendingMove }> | null {
  const previous = cards.find(card => card.id === id);
  if (!previous || !canMove(previous.status, move)) return null;
  const moved = Object.freeze({ ...previous, status: moveStatus(move) });
  return Object.freeze({ cards: Object.freeze(cards.map(card => card.id === id ? moved : card)), pending: Object.freeze({ id, previous }) });
}
// `confirmed` is the card Hermes returned (its lane may differ from the request),
// or null to roll back.
export function finishMove(cards: readonly KanbanCard[], pending: PendingMove, confirmed: KanbanCard | null): readonly KanbanCard[] {
  const replacement = confirmed && confirmed.id === pending.id ? confirmed : pending.previous;
  return Object.freeze(cards.map(card => card.id === pending.id ? replacement : card));
}

export function laneCounts(cards: readonly KanbanCard[]): Readonly<Record<KanbanLane, number>> {
  const counts: Record<KanbanLane, number> = { later: 0, ready: 0, working: 0, needsYou: 0, done: 0, other: 0 };
  for (const card of cards) counts[laneOf(card.status)] += 1;
  return Object.freeze(counts);
}

// History rows in plain words. Unknown or noisy kinds are left out.
export function eventLabel(event: KanbanEvent, agentName: (id: string) => string): string | null {
  switch (event.kind) {
    case 'created': return 'Added';
    case 'status': return event.status ? `Moved to ${LANE_TEXT[laneOf(event.status)].title}` : 'Moved';
    case 'assigned': return event.assignee === undefined ? null : event.assignee === null ? 'Set to anyone' : `Given to ${agentName(event.assignee)}`;
    case 'edited': return 'Edited';
    case 'blocked': return 'Put on hold';
    case 'unblocked': return 'Taken off hold';
    case 'completed': return 'Marked done';
    case 'archived': return 'Archived';
    case 'spawned': return 'An agent started';
    case 'reclaimed': return 'Work stopped';
    case 'gave_up': return 'Got stuck';
    case 'timed_out': return 'Ran out of time';
    case 'crashed': return 'Stopped with a problem';
    case 'review_requested': return 'Sent for review';
    case 'review_reopened': case 'changes_requested': return 'Changes asked for';
    // This app parks Later tasks in `scheduled`; Hermes' dispatcher promotes todo tasks.
    case 'scheduled': return 'Held in Later';
    case 'promoted': return `Moved to ${event.status ? LANE_TEXT[laneOf(event.status)].title : 'Ready'} by Hermes`;
    default: return null;
  }
}

export function runLabel(outcome: string | undefined, failed: boolean): string {
  switch (outcome) {
    case 'completed': return 'Finished';
    case 'blocked': return 'Stopped to ask you something';
    case 'review_requested': return 'Asked for review';
    case 'reclaimed': return 'Stopped';
    case 'gave_up': case 'crashed': case 'timed_out': case 'spawn_failed': return 'Got stuck';
    case undefined: return failed ? 'Got stuck' : 'Working';
    default: return failed ? 'Got stuck' : 'Ended';
  }
}
