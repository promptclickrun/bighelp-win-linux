// Hermes' bundled Kanban plugin. Stock dashboard auth only: no If-Match or
// X-Loopdy-Request-ID. Always names the board (`?board=`), because the host-wide
// "current" board can change under us. Writes are never retried here.
import {
  KANBAN_LIMITS, decodeKanbanAutoPlan, decodeKanbanBoards, decodeKanbanSnapshot, decodeKanbanTaskDetail, decodeKanbanTaskReply,
} from '../../../../../packages/contracts/kanban.ts';
import type { KanbanCard, KanbanTaskDetail } from '../../../../../packages/contracts/kanban.ts';
import { assignAllowed, canMove, deleteAllowed, moveBody } from '../../../../../packages/domain/kanban.ts';
import { HttpStatusError } from '../../../../../packages/platform/transport-policy.ts';
import type { KANBAN_CALLS } from '../../shared/calls/kanban.ts';
import type { CallFailure } from '../../shared/call.ts';
import type { CallContext, Route } from './context.ts';
import { CallError } from './context.ts';
import type { CallHandlers } from './index.ts';

const BASE = '/api/plugins/kanban';
export const KANBAN_UNSUPPORTED = "Kanban isn't on this computer. It comes with Hermes, so updating Hermes there adds it.";
const GONE = 'This task is no longer on the board. Refresh to see the latest.';
const CHANGED = 'This task changed on your computer. Refresh and try again.';
const UNREADABLE = "Hermes sent Kanban data this app can't read.";

type Refusals = Readonly<Partial<Record<400 | 404 | 405 | 409, readonly [CallFailure['code'], string]>>>;
const gone = ['stale', GONE] as const;
const boardGone = ['stale', 'That board is no longer on this computer. Refresh to see the latest.'] as const;
const unsupported = ['unsupported', KANBAN_UNSUPPORTED] as const;
// Known refusals become plain sentences. Host detail text can name raw task IDs,
// so it is not shown. Anything else (5xx, lost replies) goes to callFailure,
// which reports writes as "not sure this finished".
async function send(context: CallContext, route: Route, refusals: Refusals): Promise<unknown> {
  try {
    return (await context.http(route)).body;
  } catch (error) {
    if (error instanceof HttpStatusError) {
      const refusal = refusals[error.status as 400 | 404 | 405 | 409];
      if (refusal !== undefined) throw new CallError(refusal[0], refusal[1]);
    }
    throw error;
  }
}
function decode<T>(decoder: (value: unknown) => T, value: unknown): T {
  try { return decoder(value); } catch { throw new CallError('invalid', UNREADABLE); }
}
function taskPath(id: string, suffix = ''): string { return `${BASE}/tasks/${encodeURIComponent(id)}${suffix}`; }
function json(body: Readonly<Record<string, unknown>>): string { return JSON.stringify(body); }

async function readTask(context: CallContext, board: string, id: string): Promise<KanbanTaskDetail> {
  return decode(decodeKanbanTaskDetail, await send(context,
    { method: 'GET', path: taskPath(id), query: { board }, maxBytes: KANBAN_LIMITS.detailBytes }, { 404: gone }));
}
async function patchTask(context: CallContext, board: string, id: string, body: Readonly<Record<string, unknown>>, refusals: Refusals): Promise<KanbanCard> {
  return decode(decodeKanbanTaskReply, await send(context,
    { method: 'PATCH', path: taskPath(id), query: { board }, body: json(body), maxBytes: KANBAN_LIMITS.detailBytes }, { 404: gone, ...refusals }));
}

export const KANBAN_HANDLERS: Pick<CallHandlers, keyof typeof KANBAN_CALLS> = Object.freeze({
  'kanban.load': {
    mutation: false,
    async run(context, input) {
      // Plugin presence is proved by this read, not by the plugin catalog.
      const boards = decode(decodeKanbanBoards, await send(context,
        { method: 'GET', path: `${BASE}/boards`, query: { include_archived: 'false' }, maxBytes: KANBAN_LIMITS.smallBytes * 4 },
        { 404: unsupported, 405: unsupported }));
      const known = (slug: string | null | undefined) => slug && boards.boards.some(board => board.slug === slug) ? slug : null;
      const board = known(input.board) ?? boards.current ?? boards.boards[0]?.slug ?? 'default';
      const [snapshot, autoPlan] = await Promise.all([
        send(context, { method: 'GET', path: `${BASE}/board`, query: { board, include_archived: 'false' }, maxBytes: KANBAN_LIMITS.boardBytes },
          { 404: boardGone }).then(value => decode(decodeKanbanSnapshot, value)),
        // Only used to warn that Hermes may plan new tasks with AI. Unknown is fine.
        context.http({ method: 'GET', path: `${BASE}/orchestration`, maxBytes: KANBAN_LIMITS.smallBytes })
          .then(result => decodeKanbanAutoPlan(result.body)).catch(() => null),
      ]);
      return Object.freeze({ boards: boards.boards, board, cards: snapshot.cards, assignees: snapshot.assignees, autoPlan });
    },
  },
  'kanban.task': {
    mutation: false,
    run: (context, input) => readTask(context, input.board, input.id),
  },
  'kanban.create': {
    mutation: true,
    async run(context, input) {
      const body = input.body?.trim();
      // triage:true is the only create path that does not start in Ready. Hermes
      // then moves it to Later (todo) so nothing runs until the person asks.
      let card = decode(decodeKanbanTaskReply, await send(context, { method: 'POST', path: `${BASE}/tasks`, query: { board: input.board },
        body: json({ title: input.title.trim(), ...(body ? { body } : {}), ...(input.assignee ? { assignee: input.assignee } : {}),
          priority: 0, parents: [], triage: true, goal_mode: false, idempotency_key: input.idempotencyKey }),
        maxBytes: KANBAN_LIMITS.detailBytes }, { 400: ['invalid', 'Hermes could not add that task. Check the title and try again.'], 404: boardGone }));
      if (card.status === 'triage') {
        try { card = await patchTask(context, input.board, card.id, { status: 'todo' }, {}); }
        catch { throw new CallError('unknown', "The task was added, but Hermes didn't confirm it's waiting in Later. Refresh to check."); }
      }
      return card;
    },
  },
  'kanban.move': {
    mutation: true,
    async run(context, input) {
      // Advisory precondition: Hermes has no If-Match, so re-read the status the
      // person acted on. A card that started running meanwhile is never moved.
      const current = await readTask(context, input.board, input.id);
      if (current.card.status !== input.from) throw new CallError('conflict', CHANGED);
      if (!canMove(current.card.status, input.move)) throw new CallError('invalid', "That move isn't available for this task.");
      return patchTask(context, input.board, input.id, moveBody(current.card.status, input.move, input.note), {
        400: ['invalid', input.move === 'done' ? 'Hermes needs a short result note to mark this done.' : "Hermes didn't accept that move."],
        409: ['conflict', input.move === 'ready' ? 'This task is waiting on another task to finish first.' : "Hermes didn't allow that move right now. Refresh and try again."],
      });
    },
  },
  'kanban.assign': {
    mutation: true,
    async run(context, input) {
      const current = await readTask(context, input.board, input.id);
      if (!assignAllowed(current.card)) throw new CallError('conflict', 'An agent is working on this task. Wait until it finishes to change who does it.');
      return patchTask(context, input.board, input.id, { assignee: input.assignee ?? '' }, {
        400: ['invalid', "Hermes didn't accept that agent."], 409: ['conflict', 'An agent is working on this task. Wait until it finishes to change who does it.'],
      });
    },
  },
  'kanban.comment': {
    mutation: true,
    async run(context, input) {
      const reply = await send(context, { method: 'POST', path: taskPath(input.id, '/comments'), query: { board: input.board },
        body: json({ body: input.body.trim(), author: 'bighelp' }), maxBytes: KANBAN_LIMITS.smallBytes },
      { 400: ['invalid', 'Write a comment first.'], 404: gone });
      if (!reply || typeof reply !== 'object' || (reply as Record<string, unknown>).ok !== true) throw new CallError('unknown', 'Not sure the comment was saved. Refresh to check.');
      return null;
    },
  },
  'kanban.delete': {
    mutation: true,
    async run(context, input) {
      const current = await readTask(context, input.board, input.id);
      if (!deleteAllowed(current.card)) throw new CallError('conflict', 'An agent is working on this task. Wait until it finishes, then delete it.');
      const reply = await send(context, { method: 'DELETE', path: taskPath(input.id), query: { board: input.board }, maxBytes: KANBAN_LIMITS.smallBytes },
        { 404: gone });
      if (!reply || typeof reply !== 'object' || (reply as Record<string, unknown>).deleted !== true) throw new CallError('unknown', 'Not sure the task was deleted. Refresh to check.');
      return null;
    },
  },
});
