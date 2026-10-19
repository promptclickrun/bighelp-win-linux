// What a feature handler may use. Everything here is bound to one verified host
// lease; after a host switch isCurrent() is false and every operation refuses.
import type { JsonObject } from '../../../../../packages/contracts/rpc.ts';
import type { CallOptions } from '../../../../../packages/hermes-client/gateway.ts';
import { GatewayOperationError } from '../../../../../packages/hermes-client/gateway.ts';
import type { HttpResult, RouteOperation } from '../../../../../packages/platform/transport-policy.ts';
import { HttpStatusError } from '../../../../../packages/platform/transport-policy.ts';
import type { WorkspaceIdentity } from '../../../../../packages/contracts/workspace.ts';
import type { CallFailure } from '../../shared/call.ts';
import { InvalidInput } from '../../shared/validate.ts';

export type Route = Omit<RouteOperation, 'kind'>;
export type OpenChat = Readonly<{ profile: string; storedSessionId: string; runtimeId: string }>;

export type CallContext = Readonly<{
  rpc(method: string, params: JsonObject, options?: CallOptions): Promise<unknown>;
  http(route: Route): Promise<HttpResult>;
  // GET /api/plugins/loopdy/native/context with its ETag and no-store checks.
  nativeContext(): Promise<HttpResult>;
  identity: WorkspaceIdentity;
  // Exact profile names the host listed; anything else is refused.
  requireProfile(profile: string): string;
  // The chat open in this window, or null. Chat-scoped calls must match it.
  openChat(): OpenChat | null;
  // Leave the chat if it is the one open in this window, after the host confirmed
  // it was archived or deleted. Selects nothing; never opens another chat.
  closeChat(profile: string, storedSessionId: string): void;
  isCurrent(): boolean;
  // Host path behind an agent-delivered file shown in the open chat, or null.
  mediaPath(chatId: string, ref: string): string | null;
  // Re-read host catalogs after a confirmed change.
  refreshCatalog(): Promise<void>;
  requestId(): string;
  // Save a copy on this computer: the system Save dialog, then read() for the
  // bytes main fetches itself. Resolves the saved file's name, or null if the
  // person cancels. Absent where no window can show a dialog.
  saveCopy?: (suggestedName: string, read: () => Promise<Uint8Array>) => Promise<string | null>;
}>;

// A refusal a person can understand. Handlers throw this for known conditions.
export class CallError extends Error {
  readonly code: CallFailure['code'];
  constructor(code: CallFailure['code'], message: string) { super(message); this.name = 'CallError'; this.code = code; }
}

const unsupported = 'This needs a newer version of Hermes or the bighelp plugin on your computer.';

// Map any thrown value to a safe failure. Raw host text appears only through the
// sanitized single-line detail carried by the transport errors.
export function callFailure(error: unknown, mutation: boolean): CallFailure {
  if (error instanceof CallError) return { ok: false, code: error.code, message: error.message };
  if (error instanceof InvalidInput) return { ok: false, code: 'invalid', message: 'Check the details and try again.' };
  if (error instanceof GatewayOperationError) {
    if (error.code === -32601) return { ok: false, code: 'unsupported', message: unsupported };
    if (error.code === 4090 || error.reason === 'busy') return { ok: false, code: 'conflict', message: 'The agent is busy. Try again when it finishes.' };
    if (error.code === 4022) return { ok: false, code: 'conflict', message: error.detail || 'That name is already used.' };
    if (error.code === 4007) return { ok: false, code: 'stale', message: 'That chat is no longer on your computer.' };
    return { ok: false, code: 'invalid', message: error.detail || 'Hermes could not do that.' };
  }
  if (error instanceof HttpStatusError) {
    // A missing route answers FastAPI's bare "Not Found": that means an older host.
    if ([404, 405, 501].includes(error.status)) return { ok: false, code: 'unsupported',
      message: error.status === 404 && error.detail && !/^not found\.?$/iu.test(error.detail) ? error.detail : unsupported };
    if (error.status === 401 || error.status === 403) return { ok: false, code: 'denied', message: 'Hermes did not accept this sign-in for that action.' };
    if (error.status === 409 || error.status === 412) return { ok: false, code: 'conflict', message: error.detail || 'This changed on your computer. Reload and try again.' };
    if (error.status >= 400 && error.status < 500) return { ok: false, code: 'invalid', message: error.detail || 'Hermes could not accept that.' };
    return mutation
      ? { ok: false, code: 'unknown', message: 'Hermes had a problem. Check whether the change happened before trying again.' }
      : { ok: false, code: 'unavailable', message: 'Hermes had a problem. Try again in a moment.' };
  }
  if (error instanceof Error && error.message === 'outcome-unknown') {
    return { ok: false, code: 'unknown', message: 'Not sure this finished. Check before trying again.' };
  }
  if (error instanceof Error && (error.message === 'Selection changed' || error.message === 'Host changed')) {
    return { ok: false, code: 'stale', message: 'The connection changed. Try again.' };
  }
  return mutation
    ? { ok: false, code: 'unknown', message: 'Not sure this finished. Check before trying again.' }
    : { ok: false, code: 'unavailable', message: 'Could not reach Hermes. Check the connection and try again.' };
}
