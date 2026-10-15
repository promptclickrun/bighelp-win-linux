import { parseOwner, sameLease, transitionSend, recoverSend } from './chat-contract.ts';
import type { Owner, SendIntent } from './chat-contract.ts';

export type TextRequest = Readonly<{
  jsonrpc: '2.0'; id: string; method: 'prompt.submit';
  params: Readonly<{ session_id: string; profile: string; text: string }>;
}>;
export type TextIntent = SendIntent & Readonly<{ request: TextRequest }>;
// Trusted in-memory snapshot recovery, not a durable-record decoder.
export function recoverTextSend(intent: TextIntent): TextIntent {
  const request: TextRequest = Object.freeze({ ...intent.request, params: Object.freeze({ ...intent.request.params }) });
  return Object.freeze({ ...recoverSend(intent), request });
}

export type TextSendAdapters = Readonly<{
  // A ready, caught-up exclusive-submit lease only, otherwise null. The adapter
  // verifies auth, endpoint, capabilities and current writer before returning it.
  currentOwner: () => Owner | null;
  // Resolve only after durable commit. Serialize/CAS by intent ID and revision;
  // this closure's one-shot guard does not provide cross-process exclusion.
  commit: (snapshot: TextIntent) => Promise<void>;
  submit: (request: TextRequest) => Promise<unknown>;
}>;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Decoded-frame classifier only, not a raw JSON parser. A future transport must
// enforce framing bounds and reject duplicate critical keys before decoding.
export function classifyReceipt(value: unknown, requestId: string): 'streaming' | 'unknown' {
  if (!record(value) || value.jsonrpc !== '2.0' || value.id !== requestId
    || 'error' in value || !record(value.result) || value.result.status !== 'streaming') return 'unknown';
  return 'streaming';
}

// Trusted privileged/domain API, never a renderer-exposed arbitrary send bridge.
// The caller serializes new intents for the session. Creating another closure
// for an existing intent is prohibited; recovery uses inspection, not this API.
export function createTextSend(
  input: Readonly<{ id: string; requestId: string; owner: Owner; text: string }>,
  adapters: TextSendAdapters,
): () => Promise<TextIntent> {
  const owner = parseOwner(input.owner);
  for (const id of [input.id, input.requestId]) {
    if (typeof id !== 'string' || id.trim().length === 0 || !id.isWellFormed()) throw new TypeError('Invalid send identity');
  }
  if (new TextEncoder().encode(input.requestId).byteLength > 1024) throw new TypeError('Invalid request ID byte length');
  if (typeof input.text !== 'string' || !input.text.isWellFormed()) throw new TypeError('Invalid text');
  const request: TextRequest = Object.freeze({
    jsonrpc: '2.0', id: input.requestId, method: 'prompt.submit',
    params: Object.freeze({ session_id: owner.runtimeId, profile: owner.profileId, text: input.text }),
  });
  const original: SendIntent = Object.freeze({ id: input.id, owner, phase: 'editing' });
  let consumed = false;
  const snapshot = (state: SendIntent): TextIntent => Object.freeze({ ...state, request });
  const checkOwner = () => {
    if (!sameLease(owner, adapters.currentOwner())) throw new Error('Stale send owner');
  };
  return async () => {
    if (consumed) throw new Error('Send permit already consumed');
    consumed = true;
    checkOwner();
    const prepared = transitionSend(original, { type: 'persisted' }, owner);
    await adapters.commit(snapshot(prepared));
    checkOwner();
    const dispatched = transitionSend(prepared, { type: 'dispatch' }, owner);
    await adapters.commit(snapshot(dispatched));
    checkOwner();
    let status: 'streaming' | 'unknown' = 'unknown';
    try {
      const response = await adapters.submit(request);
      if (sameLease(owner, adapters.currentOwner())) status = classifyReceipt(response, request.id);
    } catch {
      // After transport invocation, an exception cannot prove non-delivery.
    }
    // Commit evidence only to the ORIGINAL owner even when selection changed.
    // The caller must separately fence publication into current presentation.
    const result = snapshot(transitionSend(dispatched, { type: 'receipt', status }, owner));
    await adapters.commit(result);
    return result;
  };
}
