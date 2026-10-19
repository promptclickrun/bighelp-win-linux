// Feed, Ideas and Goals actions (bighelp plugin native/board/*). None of them
// calls a model: they set flags the person chose, copy an idea into a goal, or
// record a "yes". Chats about an item are composer prefills, never sent here.
import type { WorkspaceBoardItem } from '../../../../../packages/contracts/workspace.ts';
import { defineCall } from '../call.ts';
import { InvalidInput, boolean, compact, fields, identifier, list, oneOf, optional, text } from '../validate.ts';

// Board item IDs exactly as the plugin accepts them (native_api.py _BOARD_ITEM_ID).
export function boardItemId(value: unknown): string {
  const id = identifier(value, 64);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(id)) throw new InvalidInput();
  return id;
}
export const BOARD_REASONS = Object.freeze(['Not relevant', 'Too frequent', 'Already knew', 'Wrong timing'] as const);

export type BoardUpdate = Readonly<{
  profile: string; itemId: string; rating?: 'up' | 'down' | 'none'; reason?: string; read?: boolean; dismissed?: boolean;
  status?: 'active' | 'done';
}>;
function parseUpdate(input: unknown): BoardUpdate {
  const value = fields(input, ['profile', 'itemId'], ['rating', 'reason', 'read', 'dismissed', 'status']);
  const update = compact({
    profile: identifier(value.profile, 128), itemId: boardItemId(value.itemId),
    rating: optional(value.rating, entry => oneOf(entry, ['up', 'down', 'none'] as const)),
    // A reason explains a thumbs down and is kept only with one (agent_board.py set_flags).
    reason: optional(value.reason, entry => text(entry, { max: 120 })),
    read: optional(value.read, boolean), dismissed: optional(value.dismissed, boolean),
    status: optional(value.status, entry => oneOf(entry, ['active', 'done'] as const)),
  });
  if (update.reason !== undefined && update.rating !== 'down') throw new InvalidInput();
  if (update.rating === undefined && update.read === undefined && update.dismissed === undefined && update.status === undefined) {
    throw new InvalidInput();
  }
  return update;
}
function parseItem(input: unknown): Readonly<{ profile: string; itemId: string }> {
  const value = fields(input, ['profile', 'itemId']);
  return Object.freeze({ profile: identifier(value.profile, 128), itemId: boardItemId(value.itemId) });
}

// After a "not sure" Turn into a goal: did the goal get made?
export type PromoteCheck = Readonly<{ state: 'goal' | 'idea' | 'missing' }>;

export const BOARD_CALLS = Object.freeze({
  // Thumbs up/down (+ reason), read, hide/undo, goal done. An absolute set.
  'board.update': defineCall<WorkspaceBoardItem>()(parseUpdate),
  'board.read': defineCall<Readonly<{ updated: number }>>()(input => {
    const value = fields(input, ['profile', 'itemIds', 'read']);
    const itemIds = list(value.itemIds, 200, boardItemId);
    if (!itemIds.length || new Set(itemIds).size !== itemIds.length) throw new InvalidInput();
    return Object.freeze({ profile: identifier(value.profile, 128), itemIds, read: boolean(value.read) });
  }),
  // Copies an idea into a new goal. Not idempotent: never resent automatically.
  'board.promote': defineCall<WorkspaceBoardItem>()(parseItem),
  // "Let's do it": records the yes. The chat message is a prefill the person sends.
  'board.accept': defineCall<WorkspaceBoardItem>()(parseItem),
  'board.checkPromote': defineCall<PromoteCheck>()(parseItem),
});
