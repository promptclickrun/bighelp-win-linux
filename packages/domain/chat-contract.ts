// Internal domain values, not a wire schema or a durable storage format.
// See docs/contracts/STATE_AND_SECURITY.md §§2–4 and HERMES_API.md §3.
// hostId identifies a verified endpoint binding, not a mutable display label.
// principalId is an opaque authority key that distinguishes provider/user pairs
// from verified dashboard-session scopes. It must never contain a credential.
// Rebinding endpoints, reclaiming writers, or returning to a prior host must
// advance generations, even if the runtime string happens to be reused.
export type Owner = Readonly<{
  hostId: string;
  principalId: string;
  profileId: string;
  storedSessionId: string;
  runtimeId: string;
  authGeneration: number;
  connectionGeneration: number;
}>;

const identityFields = ['hostId', 'principalId', 'profileId', 'storedSessionId', 'runtimeId'] as const;
const generationFields = ['authGeneration', 'connectionGeneration'] as const;

export function parseOwner(value: unknown): Owner {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Owner must be an object');
  }
  const input = value as Record<string, unknown>;
  for (const field of identityFields) {
    if (typeof input[field] !== 'string' || input[field].trim().length === 0 || !input[field].isWellFormed()) {
      throw new TypeError(`Invalid owner ${field}`);
    }
  }
  for (const field of generationFields) {
    if (typeof input[field] !== 'number' || !Number.isSafeInteger(input[field]) || input[field] < 0) {
      throw new TypeError(`Invalid owner ${field}`);
    }
  }
  return Object.freeze({
    hostId: input.hostId as string,
    principalId: input.principalId as string,
    profileId: input.profileId as string,
    storedSessionId: input.storedSessionId as string,
    runtimeId: input.runtimeId as string,
    authGeneration: input.authGeneration as number,
    connectionGeneration: input.connectionGeneration as number,
  });
}

// Cache authority survives reconnect, but never principal/profile/session replacement.
export function sameAuthority(captured: Owner, current: Owner | null): boolean {
  return current !== null && captured.hostId === current.hostId
    && captured.principalId === current.principalId && captured.profileId === current.profileId
    && captured.storedSessionId === current.storedSessionId;
}

export function sameLease(captured: Owner, current: Owner | null): boolean {
  return sameAuthority(captured, current) && current !== null
    && captured.runtimeId === current.runtimeId
    && captured.authGeneration === current.authGeneration
    && captured.connectionGeneration === current.connectionGeneration;
}

export type SendPhase = 'editing' | 'prepared' | 'dispatched' | 'accepted'
  | 'unknown' | 'rejected' | 'reconciling' | 'complete';
export type SendIntent = Readonly<{ id: string; owner: Owner; phase: SendPhase }>;
export type SendEvent =
  | Readonly<{ type: 'persisted' | 'dispatch' | 'receiptLost' | 'refused' | 'terminalVerified' | 'historyVerified' }>
  | Readonly<{ type: 'receipt'; status: unknown }>;

// Pure transition specification only. These are candidate next states, not
// evidence of I/O: adapters must commit prepared before advancing to dispatched,
// and commit dispatched before transport. Never publish an uncommitted state.
// No network, disk, retry, approval, or history verification happens in this reducer.
export function transitionSend(intent: SendIntent, event: SendEvent, current: Owner | null): SendIntent {
  if (!sameLease(intent.owner, current)) throw new Error('Stale send owner');
  let next: SendPhase | undefined;
  switch (event.type) {
    case 'persisted':
      if (intent.phase === 'editing') next = 'prepared';
      break;
    case 'dispatch':
      if (intent.phase === 'prepared') next = 'dispatched';
      break;
    case 'receipt':
      if (intent.phase === 'dispatched') next = event.status === 'streaming' ? 'accepted' : 'unknown';
      break;
    case 'receiptLost':
      if (intent.phase === 'dispatched') next = 'unknown';
      break;
    case 'refused':
      if (intent.phase === 'dispatched') next = 'rejected';
      break;
    case 'terminalVerified':
      if (intent.phase === 'accepted') next = 'reconciling';
      break;
    case 'historyVerified':
      if (intent.phase === 'reconciling') next = 'complete';
      break;
  }
  if (next === undefined) throw new Error('Invalid send transition');
  return Object.freeze({ id: intent.id, owner: parseOwner(intent.owner), phase: next });
}

// Recovery is deliberately not a resend mechanism. Unknown outcomes require a
// later authoritative inspection adapter; absence from history is not refusal.
export function recoverSend(intent: SendIntent): SendIntent {
  const phase = intent.phase === 'dispatched' || intent.phase === 'accepted' ? 'unknown' : intent.phase;
  return Object.freeze({ id: intent.id, owner: parseOwner(intent.owner), phase });
}
