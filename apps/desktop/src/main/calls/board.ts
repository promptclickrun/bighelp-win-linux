// Feed, Ideas and Goals actions through the bighelp plugin (native/board/*).
// Gated on the plugin's advertised features exactly as the Mac app gates them
// (DirectHermesNativeContext.swift, AgentBoard.swift). Nothing here calls a model.
import { BOARD_FEATURES, decodeBoardItem, decodeBoardItems } from '../../../../../packages/contracts/workspace.ts';
import type { WorkspaceBoardItem } from '../../../../../packages/contracts/workspace.ts';
import { HttpStatusError } from '../../../../../packages/platform/transport-policy.ts';
import type { BOARD_CALLS } from '../../shared/calls/board.ts';
import type { CallContext } from './context.ts';
import { CallError } from './context.ts';
import type { CallHandlers } from './index.ts';
import type { PluginContext } from './plugin.ts';
import { nativePost, pluginAgentId, requirePluginFeature } from './plugin.ts';

const WRITE_BYTES = 196_608;
const LIST_BYTES = 2 * 1024 * 1024;
const outdated = () => new CallError('unsupported', 'This needs a newer version of the bighelp plugin on your Hermes computer.');

// The plugin's fixed refusals, said plainly. Each is refused before any change.
function refusal(error: unknown): never {
  if (error instanceof HttpStatusError) {
    if (error.code === 'board_item_unavailable') throw new CallError('stale', 'That item is no longer on the board. Refresh to see the latest.');
    if (error.code === 'profile_not_found') throw new CallError('stale', 'That agent is no longer on your computer.');
    if (error.code === 'board_unavailable') throw new CallError('unsupported', 'Feed, Ideas and Goals are not available on this computer right now.');
  }
  throw error;
}
// A 2xx reply the app cannot read means the change may have happened.
function confirmed(body: unknown, agentId: string, check: (item: WorkspaceBoardItem) => boolean): WorkspaceBoardItem {
  let item: WorkspaceBoardItem;
  try { item = decodeBoardItem(body, agentId); } catch { throw new Error('outcome-unknown'); }
  if (!check(item)) throw new Error('outcome-unknown');
  return item;
}
// update and read are absolute sets: after 412 (the plugin's context changed)
// they go once more with a fresh context and a new request ID, as on the Mac.
// promote and accept never do: the plugin can answer 412 after making them.
async function repeatable(context: CallContext, send: (plugin: PluginContext) => Promise<unknown>): Promise<unknown> {
  try { return await send(await requirePluginFeature(context, BOARD_FEATURES.board)); }
  catch (error) {
    if (!(error instanceof HttpStatusError && error.status === 412)) throw error;
    return send(await requirePluginFeature(context, BOARD_FEATURES.board));
  }
}
async function once(context: CallContext, feature: string, route: string, body: Readonly<Record<string, unknown>>): Promise<unknown> {
  const plugin = await requirePluginFeature(context, BOARD_FEATURES.board);
  if (!plugin.features.includes(feature)) throw outdated();
  try { return await nativePost(context, plugin, route, body, WRITE_BYTES, true); }
  catch (error) {
    if (error instanceof HttpStatusError && error.status === 412) throw new Error('outcome-unknown');
    throw error;
  }
}

export const BOARD_HANDLERS: Pick<CallHandlers, keyof typeof BOARD_CALLS> = Object.freeze({
  'board.update': {
    mutation: true,
    async run(context, input) {
      const agentId = pluginAgentId(context, input.profile);
      try {
        const body = await repeatable(context, plugin => {
          const feedback = plugin.features.includes(BOARD_FEATURES.feedback);
          const payload: Record<string, unknown> = { agentId, itemId: input.itemId };
          if (input.rating !== undefined) {
            if (feedback) payload.rating = input.rating;
            // An older plugin only has the heart: no thumbs down there.
            else if (input.rating === 'down') throw outdated();
            else payload.liked = input.rating === 'up';
          }
          if ((input.reason !== undefined || input.read !== undefined) && !feedback) throw outdated();
          if (input.reason !== undefined) payload.reason = input.reason;
          if (input.read !== undefined) payload.read = input.read;
          if (input.dismissed !== undefined) payload.dismissed = input.dismissed;
          if (input.status !== undefined) payload.status = input.status;
          return nativePost(context, plugin, 'board/update', payload, WRITE_BYTES, true);
        });
        return confirmed(body, agentId, item => item.id === input.itemId);
      } catch (error) { return refusal(error); }
    },
  },
  'board.read': {
    mutation: true,
    async run(context, input) {
      const agentId = pluginAgentId(context, input.profile);
      try {
        const body = await repeatable(context, plugin => {
          if (!plugin.features.includes(BOARD_FEATURES.feedback)) throw outdated();
          return nativePost(context, plugin, 'board/read', { agentId, itemIds: input.itemIds, read: input.read }, WRITE_BYTES, true);
        });
        const reply = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
        const updated = reply.updated;
        if (reply.agentId !== agentId || typeof updated !== 'number' || !Number.isSafeInteger(updated) || updated < 0
          || updated > input.itemIds.length) throw new Error('outcome-unknown');
        return Object.freeze({ updated });
      } catch (error) { return refusal(error); }
    },
  },
  'board.promote': {
    mutation: true,
    async run(context, input) {
      const agentId = pluginAgentId(context, input.profile);
      try {
        const body = await once(context, BOARD_FEATURES.feedback, 'board/promote', { agentId, itemId: input.itemId });
        return confirmed(body, agentId, item => item.kind === 'goal');
      } catch (error) { return refusal(error); }
    },
  },
  'board.accept': {
    mutation: true,
    async run(context, input) {
      const agentId = pluginAgentId(context, input.profile);
      try {
        const body = await once(context, BOARD_FEATURES.answers, 'board/accept', { agentId, itemId: input.itemId });
        return confirmed(body, agentId, item => item.id === input.itemId && item.kind === 'idea');
      } catch (error) { return refusal(error); }
    },
  },
  // After a "not sure" Turn into a goal (AgentBoard.swift promote): the plugin
  // copies the idea into a new goal, then marks the idea answered and hidden, in
  // separate steps. Either trace means a goal exists, so a retry would duplicate it.
  'board.checkPromote': {
    mutation: false,
    async run(context, input) {
      const agentId = pluginAgentId(context, input.profile);
      try {
        const plugin = await requirePluginFeature(context, BOARD_FEATURES.board);
        const body = await nativePost(context, plugin, 'board/list',
          { agentId, kinds: ['idea', 'goal'], limit: 200, includeDismissed: true }, LIST_BYTES, false);
        let items: readonly WorkspaceBoardItem[];
        try { items = decodeBoardItems(body, agentId); }
        catch { throw new CallError('unavailable', 'The bighelp plugin on your computer sent an unexpected reply. Try again.'); }
        const idea = items.find(item => item.id === input.itemId && item.kind === 'idea');
        if (!idea) return Object.freeze({ state: 'missing' as const });
        const source = idea.source ?? 'From an idea';
        const made = idea.answer === 'goal' || items.some(item => item.kind === 'goal' && item.title === idea.title && item.source === source);
        return Object.freeze({ state: made ? 'goal' as const : 'idea' as const });
      } catch (error) { return refusal(error); }
    },
  },
});
