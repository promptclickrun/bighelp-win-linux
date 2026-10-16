// Kanban board calls (Hermes' bundled Kanban plugin). Boards are host-wide, so
// nothing here names an agent profile. Moves are a finite set; Working is never
// a target, and moving to Ready (which starts an agent) is confirmed in the UI.
import type { KanbanBoardMeta, KanbanCard, KanbanTaskDetail } from '../../../../../packages/contracts/kanban.ts';
import { KANBAN_LIMITS, KANBAN_STATUSES, isKanbanAssignee, isKanbanBoardSlug, isKanbanTaskId } from '../../../../../packages/contracts/kanban.ts';
import { KANBAN_MOVES } from '../../../../../packages/domain/kanban.ts';
import { defineCall } from '../call.ts';
import { InvalidInput, compact, fields, oneOf, optional, text, uuid } from '../validate.ts';

export type KanbanBoardLoad = Readonly<{
  boards: readonly KanbanBoardMeta[]; board: string; cards: readonly KanbanCard[];
  assignees: readonly string[]; autoPlan: boolean | null;
}>;

function slug(value: unknown): string { if (!isKanbanBoardSlug(value)) throw new InvalidInput(); return value; }
function taskId(value: unknown): string { if (!isKanbanTaskId(value)) throw new InvalidInput(); return value; }
function assignee(value: unknown): string | null {
  if (value === null) return null;
  if (!isKanbanAssignee(value)) throw new InvalidInput();
  return value;
}
// Free text that must say something once trimmed.
function words(value: unknown, max: number, multiline: boolean): string {
  const result = text(value, { max, multiline });
  if (!result.trim()) throw new InvalidInput();
  return result;
}
const target = (input: Record<string, unknown>) => Object.freeze({ board: slug(input.board), id: taskId(input.id) });

export const KANBAN_CALLS = Object.freeze({
  'kanban.load': defineCall<KanbanBoardLoad>()(input => {
    const value = fields(input, [], ['board']);
    return compact({ board: optional(value.board, slug) });
  }),
  'kanban.task': defineCall<KanbanTaskDetail>()(input => target(fields(input, ['board', 'id']))),
  // Always lands in Later. The key lets a person safely press Add again after an
  // unknown outcome: Hermes returns the task it already made with this key.
  'kanban.create': defineCall<KanbanCard>()(input => {
    const value = fields(input, ['board', 'title', 'idempotencyKey'], ['body', 'assignee']);
    return compact({ board: slug(value.board), title: words(value.title, KANBAN_LIMITS.title, false),
      body: optional(value.body, entry => text(entry, { max: KANBAN_LIMITS.body, min: 0, multiline: true })),
      assignee: optional(value.assignee, assignee), idempotencyKey: uuid(value.idempotencyKey) });
  }),
  // `from` is the status the person saw; main refuses if Hermes now says otherwise.
  'kanban.move': defineCall<KanbanCard>()(input => {
    const value = fields(input, ['board', 'id', 'from', 'move'], ['note']);
    const move = oneOf(value.move, KANBAN_MOVES);
    const note = optional(value.note, entry => words(entry, KANBAN_LIMITS.note, true));
    if ((move === 'done') !== (note !== undefined)) throw new InvalidInput();
    return compact({ ...target(value), from: oneOf(value.from, KANBAN_STATUSES), move, note });
  }),
  'kanban.assign': defineCall<KanbanCard>()(input => {
    const value = fields(input, ['board', 'id', 'assignee']);
    return Object.freeze({ ...target(value), assignee: assignee(value.assignee) });
  }),
  'kanban.comment': defineCall<null>()(input => {
    const value = fields(input, ['board', 'id', 'body']);
    return Object.freeze({ ...target(value), body: words(value.body, KANBAN_LIMITS.comment, true) });
  }),
  'kanban.delete': defineCall<null>()(input => target(fields(input, ['board', 'id']))),
});
