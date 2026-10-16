// Main-process implementations for every renderer call in shared/calls/index.ts.
// The mapped type makes a missing or mistyped handler a compile error.
import type { CallInput, CallName, CallOutput } from '../../shared/calls/index.ts';
import type { CallContext } from './context.ts';
import { AGENT_HANDLERS } from './agents.ts';
import { HOST_HANDLERS } from './host.ts';
import { CHAT_HANDLERS } from './chat.ts';
import { SETTINGS_HANDLERS } from './settings.ts';
import { KANBAN_HANDLERS } from './kanban.ts';

export type CallHandler<K extends CallName> = Readonly<{
  // Writes report an unknown outcome when the reply is lost; reads do not.
  mutation: boolean;
  // Chat-scoped calls run only for the chat currently open in this window.
  run: (context: CallContext, input: CallInput<K>) => Promise<CallOutput<K>>;
}>;
export type CallHandlers = { readonly [K in CallName]: CallHandler<K> };

export const HANDLERS: CallHandlers = Object.freeze({
  ...HOST_HANDLERS,
  ...CHAT_HANDLERS,
  ...SETTINGS_HANDLERS,
  ...KANBAN_HANDLERS,
  ...AGENT_HANDLERS,
});
