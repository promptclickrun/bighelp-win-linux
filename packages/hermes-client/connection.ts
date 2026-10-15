import { parseOwner, sameLease } from '../domain/chat-contract.ts';
import type { Owner } from '../domain/chat-contract.ts';
import type { TextRequest } from '../domain/text-send.ts';
import { decodeRpcFrame, encodeServerReply, RpcProtocolError } from '../contracts/rpc.ts';
import type { RpcEvent, RpcFrame, RpcResult, RpcFailure, RpcServerRequest, ServerReply } from '../contracts/rpc.ts';
import { encodeProbe, encodeTextRequest, parseGatewayCapabilities, SERVER_REQUEST_METHODS } from '../contracts/rpc-methods.ts';
import type { ProbeMethod, ServerRequestMethod } from '../contracts/rpc-methods.ts';

export type ConnectionLease = Readonly<{ owner: Owner; generation: number }>;
export type ConnectionTransport = Readonly<{
  // Install callbacks before opening/delivering frames. Authentication, exact
  // origin, fresh tickets and transport byte limits belong to this adapter.
  start: (callbacks: Readonly<{ frame: (text: unknown) => void; closed: () => void }>) => void;
  // Synchronously enqueue in call order or throw. A throw is NOT non-delivery.
  send: (text: string) => void;
  close: () => void;
}>;
export type ServerRequestHandler = (request: RpcServerRequest, context: Readonly<{
  lease: ConnectionLease; signal: AbortSignal;
}>) => Promise<ServerReply>;
export type ServerHandlers = Readonly<Partial<Record<ServerRequestMethod, ServerRequestHandler>>>;
export type ConnectionFailure = 'not-ready' | 'owner-changed' | 'capacity' | 'outcome-unknown' | 'transport-unavailable';
export class ConnectionError extends Error {
  readonly kind: ConnectionFailure;
  constructor(kind: ConnectionFailure) { super(kind); this.name = 'ConnectionError'; this.kind = kind; }
}
export type RpcReceipt = Readonly<{ jsonrpc: '2.0'; id: string; result: unknown }>
  | Readonly<{ jsonrpc: '2.0'; id: string; error: Readonly<{ code: number; message: string; data?: { reason: string } }> }>;
type Reply = RpcResult | RpcFailure;
type Pending = { mutation: boolean; resolve: (reply: Reply) => void; reject: (error: ConnectionError) => void; cancel: () => void };
type ServerPending = { request: RpcServerRequest; controller: AbortController; response?: string };
type Slot = {
  lease: ConnectionLease; transport: ConnectionTransport; handlers: Map<string, ServerRequestHandler>;
  phase: 'opening' | 'negotiating' | 'ready' | 'closed'; gatewayReady: boolean;
  serverRequests: 'unadvertised' | 'pending' | 'enabled' | 'unsupported';
  exclusiveSubmit: boolean; reconciled: boolean;
  pending: Map<string, Pending>; usedIds: Set<string>; server: Map<string, ServerPending>; seenServerIds: Set<string>;
  cancelReady: () => void;
};
export const CONNECTION_LIMITS = Object.freeze({ pending: 64, serverRequests: 64, identitiesPerSocket: 4096 });

// One connection slot for one captured session owner. The application coordinates
// shared sockets/fleet/session adoption; this foundation does not invent it.
export function createConnectionRegistry(adapters: Readonly<{
  currentOwner: () => Owner | null;
  // Must run asynchronously, once, unless cancelled. Inject a monotonic timer;
  // tests use a deterministic scheduler. No background retry lives here.
  deadline: (milliseconds: number, callback: () => void) => (() => void);
  onEvent?: (event: RpcEvent, lease: ConnectionLease) => void;
}>) {
  let active: Slot | undefined;
  let generation = 0;
  let sequence = 0;

  function retire(slot: Slot) {
    if (slot.phase === 'closed') return;
    // Fence before touching transport/abort callbacks, which may be reentrant.
    slot.phase = 'closed'; slot.reconciled = false;
    slot.cancelReady();
    const pending = [...slot.pending.values()]; slot.pending.clear();
    const server = [...slot.server.values()]; slot.server.clear();
    slot.handlers.clear(); slot.usedIds.clear(); slot.seenServerIds.clear();
    for (const entry of pending) {
      entry.cancel();
      entry.reject(new ConnectionError(entry.mutation ? 'outcome-unknown' : 'transport-unavailable'));
    }
    for (const entry of server) entry.controller.abort();
    try { slot.transport.close(); } catch { /* Already fenced and retired. */ }
  }
  function current(slot: Slot): boolean {
    if (slot !== active || slot.phase === 'closed') return false;
    if (!sameLease(slot.lease.owner, adapters.currentOwner())) { retire(slot); return false; }
    return true;
  }
  function requireSlot(lease: ConnectionLease): Slot {
    if (!active || active.lease !== lease || !current(active)) throw new ConnectionError('owner-changed');
    return active;
  }
  function send(slot: Slot, text: string) {
    if (!current(slot)) return;
    try { slot.transport.send(text); } catch { retire(slot); }
  }
  function request(slot: Slot, id: string, wire: string, mutation: boolean, timeout = 45000): Promise<Reply> {
    if (!current(slot)) return Promise.reject(new ConnectionError('owner-changed'));
    if (slot.pending.size >= CONNECTION_LIMITS.pending || slot.usedIds.size >= CONNECTION_LIMITS.identitiesPerSocket
      || slot.usedIds.has(id)) return Promise.reject(new ConnectionError('capacity'));
    return new Promise((resolve, reject) => {
      const entry: Pending = { mutation, resolve, reject, cancel: () => {} };
      slot.usedIds.add(id); slot.pending.set(id, entry);
      entry.cancel = adapters.deadline(timeout, () => {
        if (!current(slot) || slot.pending.get(id) !== entry) return;
        slot.pending.delete(id);
        if (mutation) slot.reconciled = false;
        reject(new ConnectionError(mutation ? 'outcome-unknown' : 'transport-unavailable'));
      });
      send(slot, wire);
    });
  }
  function probe(slot: Slot, method: ProbeMethod): Promise<Reply> {
    const id = `bighelp:${slot.lease.generation}:${++sequence}`;
    return request(slot, id, encodeProbe(id, method), false, method === 'client.capabilities' ? 15000 : 45000);
  }
  async function negotiate(slot: Slot) {
    try {
      if (slot.handlers.size > 0) {
        slot.serverRequests = 'pending';
        const advertisement = await probe(slot, 'client.capabilities');
        if (!current(slot)) return;
        if (advertisement.kind === 'error') {
          // No legacy prompt fallback is implemented. Only method-not-found is
          // compatibility, not arbitrary permission/host errors.
          if (advertisement.code !== -32601) { retire(slot); return; }
          slot.serverRequests = 'unsupported';
        } else slot.serverRequests = 'enabled';
      }
      const manifest = await probe(slot, 'gateway.capabilities');
      if (!current(slot)) return;
      if (manifest.kind !== 'result') { retire(slot); return; }
      slot.exclusiveSubmit = parseGatewayCapabilities(manifest.result).perSessionExclusiveSubmit;
      slot.phase = 'ready';
    } catch { retire(slot); }
  }
  function flushServer(slot: Slot, entry: ServerPending) {
    if (!current(slot) || !slot.gatewayReady || slot.server.get(entry.request.id) !== entry || !entry.response) return;
    slot.server.delete(entry.request.id);
    send(slot, entry.response);
  }
  function acceptServer(slot: Slot, request: RpcServerRequest) {
    if (Object.hasOwn(request.params, 'session_id') && request.params.session_id !== slot.lease.owner.runtimeId) {
      retire(slot); return;
    }
    if (slot.seenServerIds.has(request.id)) return;
    if (slot.server.size >= CONNECTION_LIMITS.serverRequests || slot.seenServerIds.size >= CONNECTION_LIMITS.identitiesPerSocket) {
      retire(slot); return;
    }
    slot.seenServerIds.add(request.id);
    const entry: ServerPending = { request, controller: new AbortController() };
    slot.server.set(request.id, entry);
    const handler = slot.handlers.get(request.method);
    if (!handler) {
      entry.response = encodeServerReply(request.id, { error: { code: -32601, message: 'Method not supported by this client' } });
      flushServer(slot, entry); return;
    }
    // Handler owns the method-specific validation, exact session matching, and
    // explicit user decision. Merely registering it must never grant approval.
    void (async () => {
      try {
        if (!current(slot) || slot.server.get(request.id) !== entry) return;
        const reply = await handler(request, { lease: slot.lease, signal: entry.controller.signal });
        if (!current(slot) || slot.server.get(request.id) !== entry) return;
        entry.response = encodeServerReply(request.id, reply);
        flushServer(slot, entry);
      } catch {
        // Never synthesize a successful/blank answer when a handler fails.
        if (current(slot) && slot.server.get(request.id) === entry) retire(slot);
      }
    })();
  }
  function accept(slot: Slot, frame: RpcFrame) {
    if (!current(slot)) return;
    if (frame.kind === 'result' || frame.kind === 'error') {
      const pending = slot.pending.get(frame.id);
      if (!pending) return;
      slot.pending.delete(frame.id); pending.cancel(); pending.resolve(frame); return;
    }
    if (frame.kind === 'request') { acceptServer(slot, frame); return; }
    if (typeof frame.params.session_id === 'string' && frame.params.session_id !== slot.lease.owner.runtimeId) {
      if (frame.params.type === 'gateway.ready') retire(slot);
      return;
    }
    if (frame.params.type === 'gateway.ready') {
      if (slot.gatewayReady) { retire(slot); return; }
      slot.gatewayReady = true; slot.phase = 'negotiating'; slot.cancelReady();
      for (const pending of slot.server.values()) flushServer(slot, pending);
      if (!current(slot)) return;
      void negotiate(slot);
    } else if (frame.params.type === 'request.cancel') {
      // decodeRpcFrame checked the exact payload and types atomically.
      const payload = frame.params.payload as { id: string; method: string; reason: string };
      const pending = slot.server.get(payload.id);
      if (pending?.request.method === payload.method) {
        slot.server.delete(payload.id); pending.controller.abort();
      }
    } else if (frame.params.type === 'session.reclaimed') {
      // Reclaim requires a fresh owner/socket, not just another reconciliation.
      retire(slot); return;
    }
    if (current(slot)) adapters.onEvent?.(frame, slot.lease);
  }
  function receipt(reply: Reply): RpcReceipt {
    return reply.kind === 'result' ? Object.freeze({ jsonrpc: '2.0', id: reply.id, result: reply.result })
      : Object.freeze({ jsonrpc: '2.0', id: reply.id, error: Object.freeze({ code: reply.code, message: reply.message,
        ...(reply.reason === undefined ? {} : { data: { reason: reply.reason } }),
      }) });
  }

  return Object.freeze({
    connect(owner: Owner, transport: ConnectionTransport, handlers: ServerHandlers): ConnectionLease {
      const captured = parseOwner(owner);
      if (!sameLease(captured, adapters.currentOwner())) throw new ConnectionError('owner-changed');
      const registered = new Map<string, ServerRequestHandler>();
      for (const [method, handler] of Object.entries(handlers)) {
        if (!SERVER_REQUEST_METHODS.some(known => known === method) || typeof handler !== 'function') throw new RpcProtocolError();
        registered.set(method, handler);
      }
      if (active) retire(active);
      const lease = Object.freeze({ owner: captured, generation: ++generation });
      const slot: Slot = { lease, transport, handlers: registered, phase: 'opening', gatewayReady: false,
        serverRequests: 'unadvertised', exclusiveSubmit: false, reconciled: false,
        pending: new Map(), usedIds: new Set(), server: new Map(), seenServerIds: new Set(), cancelReady: () => {} };
      active = slot;
      slot.cancelReady = adapters.deadline(20000, () => { if (current(slot) && !slot.gatewayReady) retire(slot); });
      try {
        transport.start({ frame: text => {
          if (!current(slot)) return;
          try { for (const frame of decodeRpcFrame(text)) accept(slot, frame); } catch { retire(slot); }
        }, closed: () => { if (current(slot)) retire(slot); } });
      } catch { retire(slot); }
      return lease;
    },
    disconnect(lease: ConnectionLease): void {
      if (active?.lease === lease) retire(active);
    },
    snapshot(lease: ConnectionLease) {
      const slot = requireSlot(lease);
      return Object.freeze({ phase: slot.phase, gatewayReady: slot.gatewayReady, serverRequests: slot.serverRequests,
        exclusiveSubmit: slot.exclusiveSubmit, reconciled: slot.reconciled, pending: slot.pending.size, serverPending: slot.server.size });
    },
    // Trusted coordinator fact, NOT renderer input. The caller must finish
    // exact-owner history/replay and verify writer ownership before this call.
    markReconciled(lease: ConnectionLease): void {
      const slot = requireSlot(lease);
      if (slot.phase !== 'ready') throw new ConnectionError('not-ready');
      slot.reconciled = true;
    },
    async ping(lease: ConnectionLease): Promise<RpcReceipt> {
      const slot = requireSlot(lease);
      if (slot.phase !== 'ready') throw new ConnectionError('not-ready');
      const result = await probe(slot, 'gateway.ping');
      requireSlot(lease);
      return receipt(result);
    },
    async submitText(lease: ConnectionLease, input: TextRequest): Promise<RpcReceipt> {
      const slot = requireSlot(lease);
      if (slot.phase !== 'ready' || !slot.reconciled || !slot.exclusiveSubmit || slot.serverRequests !== 'enabled') {
        throw new ConnectionError('not-ready');
      }
      const wire = encodeTextRequest(input);
      // Compare the serialized snapshot, not a mutable caller's object.
      const captured: TextRequest = JSON.parse(wire);
      if (captured.params.session_id !== lease.owner.runtimeId || captured.params.profile !== lease.owner.profileId) {
        throw new ConnectionError('owner-changed');
      }
      const result = await request(slot, captured.id, wire, true);
      if (!current(slot)) throw new ConnectionError('outcome-unknown');
      return receipt(result);
    },
  });
}
