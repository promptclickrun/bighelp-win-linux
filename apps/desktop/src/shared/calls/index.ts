// The complete list of host calls the renderer can request. Each feature adds
// its own module; main implements every entry (see main/calls/index.ts).
import type { CallDefinition, CallFailure } from '../call.ts';
import { AGENT_CALLS } from './agents.ts';
import { HOST_CALLS } from './host.ts';
import { CHAT_CALLS } from './chat.ts';
import { SETTINGS_CALLS } from './settings.ts';
import { KANBAN_CALLS } from './kanban.ts';
import { CHAT_LIST_CALLS } from './chats.ts';
import { PROJECT_CALLS } from './projects.ts';
import { SCHEDULE_CALLS } from './schedules.ts';
import { BOARD_CALLS } from './board.ts';
import { FILES_CALLS } from './files.ts';
import { VAULT_CALLS } from './vault.ts';
import { WORKFLOW_CALLS } from './workflows.ts';

// One line per feature module; keep the list in this order.
export const CALLS = Object.freeze({
  ...HOST_CALLS,
  ...CHAT_CALLS,
  ...SETTINGS_CALLS,
  ...KANBAN_CALLS,
  ...AGENT_CALLS,
  ...CHAT_LIST_CALLS,
  ...SCHEDULE_CALLS,
  ...PROJECT_CALLS,
  ...BOARD_CALLS,
  ...FILES_CALLS,
  ...VAULT_CALLS,
  ...WORKFLOW_CALLS,
});

export type CallName = keyof typeof CALLS;
export type CallInput<K extends CallName> = ReturnType<(typeof CALLS)[K]['parse']>;
export type CallOutput<K extends CallName> = (typeof CALLS)[K] extends CallDefinition<unknown, infer Output> ? Output : never;
export type CallResult<K extends CallName> = Readonly<{ ok: true; value: CallOutput<K> }> | CallFailure;

export function isCallName(value: unknown): value is CallName {
  return typeof value === 'string' && Object.hasOwn(CALLS, value);
}
