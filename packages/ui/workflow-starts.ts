// Run starts that went out in this window session, by workflow. A start is
// recorded here before it is sent and stays until the host answers for its
// token, or the person forgets it. It outlives the Workflows page (leaving and
// coming back, or a reconnect to the same computer) but not a restart of the
// app. Workflow IDs are random per computer, so one never names another's.
import { useEffect, useState } from 'react';
import type { StartIntent, StartReply, StartRequest, StartSettled } from '../domain/workflows.ts';
import { settleStart, startRequest } from '../domain/workflows.ts';

// `uncertain`: an earlier send of this start had a lost answer.
export type PendingStart = Readonly<{ intent: StartIntent; uncertain: boolean }>;
const pending = new Map<string, PendingStart>();
const listeners = new Set<() => void>();
const notify = () => { for (const listener of [...listeners]) listener(); };

export function pendingStart(workflowId: string): PendingStart | null { return pending.get(workflowId) ?? null; }
// Only the start the person is looking at is forgotten, never one sent since.
export function forgetStart(intent: StartIntent): void {
  if (pending.get(intent.workflowId)?.intent.clientRunToken === intent.clientRunToken && pending.delete(intent.workflowId)) notify();
}

// One send at a time per workflow. The intent is recorded before it goes out.
export async function sendStart(intent: StartIntent, uncertain: boolean,
  send: (request: StartRequest) => Promise<StartReply>): Promise<StartSettled | null> {
  if (pending.get(intent.workflowId)?.intent.state === 'sending') return null;
  pending.set(intent.workflowId, Object.freeze({ intent, uncertain })); notify();
  let reply: StartReply;
  try { reply = await send(startRequest(intent)); }
  catch { reply = Object.freeze({ ok: false, code: 'unknown', message: '' }); }
  const settled = settleStart(intent, reply, uncertain);
  if (pending.get(intent.workflowId)?.intent.clientRunToken === intent.clientRunToken) {
    if (settled.intent) pending.set(intent.workflowId, Object.freeze({ intent: settled.intent, uncertain: true }));
    else pending.delete(intent.workflowId);
    notify();
  }
  return settled;
}

export function usePendingStart(workflowId: string): PendingStart | null {
  const [entry, setEntry] = useState<PendingStart | null>(() => pendingStart(workflowId));
  useEffect(() => {
    const update = () => setEntry(pendingStart(workflowId));
    update();
    listeners.add(update);
    return () => { listeners.delete(update); };
  }, [workflowId]);
  return entry;
}
