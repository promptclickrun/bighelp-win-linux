// Chat list host calls.
//
// Stored chats change through Hermes' fenced session mutation
// (hermes_cli/web_server_sessions.py): read the mutation snapshot, then send
// request_id + expected_revision (+ expected_generation). A lost reply keeps that
// identity, so an explicit retry of the same change replays Hermes' receipt.
//
// Two Hermes rules shape the rest:
// - The chat open in this window is live. It renames through its runtime
//   (session.title), as Hermes clients do for live chats.
// - `hermes serve` refuses fenced writes while a gateway runtime owns the store
//   (409 "Exclusive maintenance refused ..."), before anything changes. Archive and
//   delete then use the WebSocket methods that write the same store.
import { decodeChatSearch, decodeMutationReceipt, decodeMutationSnapshot, HIDDEN_CHAT_SOURCES } from '../../../../../packages/contracts/chat-list.ts';
import type { ChatSearchHit } from '../../../../../packages/contracts/chat-list.ts';
import { jsonObject } from '../../../../../packages/contracts/rpc.ts';
import type { JsonObject } from '../../../../../packages/contracts/rpc.ts';
import { GatewayOperationError } from '../../../../../packages/hermes-client/gateway.ts';
import type { HttpResult } from '../../../../../packages/platform/transport-policy.ts';
import { HttpStatusError } from '../../../../../packages/platform/transport-policy.ts';
import type { CHAT_LIST_CALLS, ChatCapabilities, ChatSearch } from '../../shared/calls/chats.ts';
import type { CallContext, Route } from './context.ts';
import { CallError } from './context.ts';
import type { CallHandlers } from './index.ts';

const sessionPath = (id: string) => `/api/sessions/${encodeURIComponent(id)}`;
const PROBE_ID = 'bighelp-capability-probe';
const GONE = 'That chat is no longer on your computer.';
const CHANGED = 'This chat changed on your computer. Try again.';
const BUSY = 'Hermes on your computer is busy with other work and cannot change chats right now. Try again in a few minutes.';

type MutationIdentity = Readonly<{ request_id: string; expected_revision: number; expected_generation?: number }>;
type Intent = readonly ['rename', string] | readonly ['archive'] | readonly ['delete'];
// One retained identity per pending change, per verified connection. The map is
// keyed by the connection's identity object, so a new lease never reuses it.
const retained = new WeakMap<object, Map<string, MutationIdentity>>();
const RETAINED_MAX = 64;

// The store's gateway owner refused a maintenance write; nothing was applied.
class StoreOwnerBusy extends CallError { constructor() { super('conflict', BUSY); } }

// Hermes answers these when it refused the write outright (nothing applied).
function definite(error: unknown): boolean {
  return error instanceof HttpStatusError && ((error.status >= 400 && error.status < 500)
    || (error.status === 503 && ['runtime_draining', 'storage_unavailable'].includes(error.detail)));
}
function titleRefusal(detail: string): CallError | null {
  if (/too long/iu.test(detail)) return new CallError('invalid', 'Use a name up to 100 characters.');
  // Hermes names the other session's ID here; never show it.
  if (/already in use/iu.test(detail)) return new CallError('invalid', 'Another chat already has that name.');
  return null;
}
function writeFailure(error: unknown, rename: boolean): unknown {
  if (!(error instanceof HttpStatusError)) return error;
  const { status, detail } = error;
  if (status === 409 && detail === 'session_busy') return new CallError('conflict', 'This chat is busy. Try again when the agent finishes.');
  if (status === 409 && /maintenance|already owns/iu.test(detail)) return new StoreOwnerBusy();
  if (status === 409 || status === 412) return new CallError('conflict', CHANGED);
  if (status === 404) return new CallError('stale', GONE);
  if (status === 401 || status === 403) return new CallError('denied', 'Hermes did not accept this sign-in for that change.');
  if (rename && status === 400) return titleRefusal(detail) ?? new CallError('invalid', 'Hermes could not accept that name.');
  if (status >= 400 && status < 500) return new CallError('invalid', 'Hermes could not accept that change.');
  if (definite(error)) return new CallError('unavailable', 'Hermes is busy. Nothing was changed. Try again in a moment.');
  return error;
}
function rpcFailure(error: unknown): unknown {
  if (!(error instanceof GatewayOperationError)) return error;
  if (error.code === 4021 || error.code === 4022) return titleRefusal(error.detail) ?? new CallError('invalid', 'Hermes could not accept that name.');
  if (error.code === 4023) return new CallError('conflict', 'This chat is open in another app on your computer. Close it there, then try again.');
  if (error.code === 4001 || error.code === 4007) return new CallError('stale', GONE);
  if (error.code === 4000 || error.code === -32601) return new CallError('unsupported', 'The Hermes on your computer cannot change chats from here. A Hermes update may be needed.');
  if (error.code === 5006 || error.code === 5007 || error.code === 5036) return new CallError('unavailable', 'Hermes could not save that change. Try again.');
  return error;
}
async function rpcWrite(context: CallContext, method: string, params: JsonObject): Promise<Record<string, unknown>> {
  let reply: unknown;
  try { reply = await context.rpc(method, params, { mutation: true }); }
  catch (error) { throw rpcFailure(error); }
  // An acknowledgement we cannot read may still have been applied.
  if (!jsonObject(reply)) throw new Error('outcome-unknown');
  return reply;
}

async function mutate(context: CallContext, profile: string, chatId: string, intent: Intent, operation: 'sidebar' | 'delete',
  send: (identity: MutationIdentity) => Promise<HttpResult>, before?: () => Promise<void>): Promise<void> {
  let store = retained.get(context.identity);
  if (!store) { store = new Map(); retained.set(context.identity, store); }
  const chatKey = JSON.stringify([profile, chatId]);
  const key = JSON.stringify([profile, chatId, ...intent]);
  let identity = store.get(key);
  if (!identity) {
    let snapshot;
    try {
      snapshot = decodeMutationSnapshot((await context.http({ method: 'GET', path: `${sessionPath(chatId)}/mutation-snapshot`,
        query: { profile }, maxBytes: 16384 })).body, chatId);
    } catch (error) {
      if (error instanceof HttpStatusError && [404, 405, 501].includes(error.status)) {
        throw new CallError('unsupported', 'The Hermes on your computer cannot change chats from here. A Hermes update may be needed.');
      }
      if (error instanceof HttpStatusError && (error.status === 401 || error.status === 403)) throw writeFailure(error, false);
      throw new CallError('unavailable', 'Could not reach Hermes. Nothing was changed. Try again.');
    }
    if (!snapshot.exists) throw new CallError('stale', GONE);
    identity = Object.freeze({ request_id: context.requestId(), expected_revision: snapshot.revision,
      ...(snapshot.generation === null ? {} : { expected_generation: snapshot.generation }) });
    if (store.size >= RETAINED_MAX) store.delete(store.keys().next().value!);
    store.set(key, identity);
  }
  await before?.();
  try {
    decodeMutationReceipt((await send(identity)).body, chatId, operation);
  } catch (error) {
    if (definite(error)) store.delete(key);
    throw writeFailure(error, intent[0] === 'rename');
  }
  // Acknowledged: any other retained change for this chat has a superseded revision.
  for (const other of [...store.keys()]) if (other.startsWith(chatKey.slice(0, -1) + ',')) store.delete(other);
}

async function settle(context: CallContext, profile: string, chatId: string, leave: boolean): Promise<void> {
  if (leave) context.closeChat(profile, chatId);
  // The change is confirmed; a failed re-read must not turn it into an unknown outcome.
  await context.refreshCatalog().catch(() => {});
}
function openRuntime(context: CallContext, profile: string, chatId: string): string | null {
  const open = context.openChat();
  return open && open.profile === profile && open.storedSessionId === chatId ? open.runtimeId : null;
}

// Live runtimes Hermes holds for a stored chat (session.active_list). An older
// Hermes without the method returns none; the delete itself still decides.
async function liveRuntimes(context: CallContext, profile: string, chatId: string): Promise<Set<string>> {
  let reply: unknown = null;
  try { reply = await context.rpc('session.active_list', { profile }, { mutation: false }); } catch { /* none known */ }
  const rows = jsonObject(reply) && Array.isArray(reply.sessions) ? reply.sessions.filter(jsonObject) : [];
  const live = rows.filter(row => row.session_key === chatId && typeof row.id === 'string' && row.id.length > 0 && row.id.length <= 512);
  if (live.some(row => row.status !== 'idle')) throw new CallError('conflict', 'This chat is busy. Try again when the agent finishes.');
  return new Set(live.map(row => String(row.id)));
}

async function probe(context: CallContext, route: Route, accept: (body: unknown) => boolean): Promise<boolean> {
  try { return accept((await context.http(route)).body); }
  catch (error) {
    if (error instanceof HttpStatusError && [404, 405, 501].includes(error.status)) return false;
    throw error;
  }
}

export const CHAT_LIST_HANDLERS: Pick<CallHandlers, keyof typeof CHAT_LIST_CALLS> = Object.freeze({
  'chats.capabilities': {
    mutation: false,
    async run(context): Promise<ChatCapabilities> {
      const [search, manage] = await Promise.all([
        // An empty query answers {"results":[]} without reading the store.
        probe(context, { method: 'GET', path: '/api/sessions/search', query: { q: '' }, maxBytes: 4096 },
          body => jsonObject(body) && Array.isArray(body.results)),
        // A missing session answers exists:false; an older Hermes has no route.
        probe(context, { method: 'GET', path: `${sessionPath(PROBE_ID)}/mutation-snapshot`, maxBytes: 4096 }, body => {
          try { return !decodeMutationSnapshot(body, PROBE_ID).exists; } catch { return false; }
        }),
      ]);
      return Object.freeze({ search, manage });
    },
  },
  'chats.search': {
    mutation: false,
    async run(context, input): Promise<ChatSearch> {
      const profiles = input.profiles.map(profile => context.requireProfile(profile));
      const settled = await Promise.allSettled(profiles.map(async profile => decodeChatSearch((await context.http({
        method: 'GET', path: '/api/sessions/search', maxBytes: 1024 * 1024,
        query: { q: input.query, profile, limit: '20', exclude_sources: HIDDEN_CHAT_SOURCES.join(',') },
      })).body, profile)));
      const results: ChatSearchHit[] = [];
      for (const outcome of settled) if (outcome.status === 'fulfilled') results.push(...outcome.value);
      const failed = settled.filter(outcome => outcome.status === 'rejected');
      if (failed.length === settled.length) throw (failed[0] as PromiseRejectedResult).reason;
      const time = (hit: ChatSearchHit) => hit.updatedAt ?? hit.startedAt ?? 0;
      results.sort((left, right) => time(right) - time(left));
      return Object.freeze({ results: Object.freeze(results.slice(0, 50)), partial: failed.length > 0 });
    },
  },
  'chats.rename': {
    mutation: true,
    async run(context, input): Promise<Readonly<{ title: string }>> {
      const profile = context.requireProfile(input.profile);
      const runtimeId = openRuntime(context, profile, input.chatId);
      let title = input.title, renamed = false;
      if (runtimeId) {
        let reply: Record<string, unknown> | null = null;
        // A runtime Hermes no longer holds (4001) falls through to the stored chat.
        try { reply = await rpcWrite(context, 'session.title', { session_id: runtimeId, title: input.title }); }
        catch (error) { if (!(error instanceof CallError && error.code === 'stale')) throw error; }
        if (reply) {
          if (typeof reply.title !== 'string') throw new Error('outcome-unknown');
          if (reply.title.length > 0 && reply.title.length <= 400) title = reply.title;
          renamed = true;
        }
      }
      if (!renamed) {
        try {
          await mutate(context, profile, input.chatId, ['rename', input.title], 'sidebar', identity => context.http({
            method: 'PATCH', path: sessionPath(input.chatId), maxBytes: 65536,
            body: JSON.stringify({ profile, title: input.title, ...identity }),
          }));
        } catch (error) {
          if (error instanceof StoreOwnerBusy) throw new CallError('conflict', 'Hermes on your computer is busy with other work, so only an open chat can be renamed right now. Open this chat and try again.');
          throw error;
        }
      }
      await settle(context, profile, input.chatId, false);
      return Object.freeze({ title });
    },
  },
  'chats.archive': {
    mutation: true,
    async run(context, input): Promise<Readonly<{ archived: true }>> {
      const profile = context.requireProfile(input.profile);
      try {
        await mutate(context, profile, input.chatId, ['archive'], 'sidebar', identity => context.http({
          method: 'PATCH', path: sessionPath(input.chatId), maxBytes: 65536,
          body: JSON.stringify({ profile, archived: true, ...identity }),
        }));
      } catch (error) {
        if (!(error instanceof StoreOwnerBusy)) throw error;
        const reply = await rpcWrite(context, 'session.archive', { session_id: input.chatId, archived: true, profile });
        if (reply.archived !== true) throw new Error('outcome-unknown');
      }
      await settle(context, profile, input.chatId, true);
      return Object.freeze({ archived: true });
    },
  },
  'chats.delete': {
    mutation: true,
    async run(context, input): Promise<Readonly<{ deleted: true }>> {
      const profile = context.requireProfile(input.profile);
      // End the chat's idle live runtimes first (this window's open chat, and ones
      // left from chats opened earlier), so nothing writes to the rows being deleted
      // and Hermes does not refuse an "active session". A running chat is refused.
      // If the delete then fails, the chat stays listed and can be reopened.
      const before = async () => {
        const runtimes = await liveRuntimes(context, profile, input.chatId);
        const open = openRuntime(context, profile, input.chatId);
        if (open) { context.closeChat(profile, input.chatId); runtimes.add(open); }
        for (const runtime of runtimes) await context.rpc('session.close', { session_id: runtime }, { mutation: true }).catch(() => {});
      };
      try {
        await mutate(context, profile, input.chatId, ['delete'], 'delete', identity => {
          // Hermes requires all three fence values for DELETE, as query parameters.
          if (identity.expected_generation === undefined) throw new CallError('conflict', CHANGED);
          return context.http({ method: 'DELETE', path: sessionPath(input.chatId), maxBytes: 65536, query: { profile,
            request_id: identity.request_id, expected_revision: String(identity.expected_revision),
            expected_generation: String(identity.expected_generation) } });
        }, before);
      } catch (error) {
        if (!(error instanceof StoreOwnerBusy)) throw error;
        try {
          const reply = await rpcWrite(context, 'session.delete', { session_id: input.chatId, profile });
          if (reply.deleted !== input.chatId) throw new Error('outcome-unknown');
        } catch (failure) {
          // Already gone is the outcome the person asked for.
          if (!(failure instanceof CallError && failure.code === 'stale')) throw failure;
        }
      }
      await settle(context, profile, input.chatId, true);
      return Object.freeze({ deleted: true });
    },
  },
});
