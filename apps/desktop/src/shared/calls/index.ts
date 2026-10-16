// The complete list of host calls the renderer can request. Each feature adds
// its own module; main implements every entry (see main/calls/index.ts).
import type { CallDefinition, CallFailure } from '../call.ts';
import { HOST_CALLS } from './host.ts';
import { KANBAN_CALLS } from './kanban.ts';

export const CALLS = Object.freeze({
  ...HOST_CALLS,
  ...KANBAN_CALLS,
});

export type CallName = keyof typeof CALLS;
export type CallInput<K extends CallName> = ReturnType<(typeof CALLS)[K]['parse']>;
export type CallOutput<K extends CallName> = (typeof CALLS)[K] extends CallDefinition<unknown, infer Output> ? Output : never;
export type CallResult<K extends CallName> = Readonly<{ ok: true; value: CallOutput<K> }> | CallFailure;

export function isCallName(value: unknown): value is CallName {
  return typeof value === 'string' && Object.hasOwn(CALLS, value);
}
