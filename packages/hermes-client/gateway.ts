import { createTransportPolicy } from '../platform/transport-policy.ts';
import type { HttpPlan, SocketPlan, HttpOperation, HttpResult } from '../platform/transport-policy.ts';
import { boundedHttp } from '../platform/http-transport.ts';
import { decodeRpcFrame, encodeServerReply } from '../contracts/rpc.ts';
import type { RpcEvent, RpcServerRequest, ServerReply, RpcResult, RpcFailure } from '../contracts/rpc.ts';
import { encodeProbe, encodeTextRequest, parseGatewayCapabilities } from '../contracts/rpc-methods.ts';
import { decodeOpenRequests, encodeSessionOperation } from '../contracts/session.ts';
import type { DesktopRpcOperation } from '../contracts/session.ts';
import type { TextRequest } from '../domain/text-send.ts';
export type GatewaySocket = { send(text: string): void; close(): void };
export type Gateway = Readonly<{
 operation(operation: DesktopRpcOperation): Promise<unknown>;
 submitText(request: TextRequest): Promise<unknown>;
 restoreRequests(requests: unknown, runtimeId: string): void;
 close(): void; readonly exclusiveSubmit: boolean;
 requestHttp(operation: HttpOperation): Promise<HttpResult>;
}>;
type Reply = RpcResult | RpcFailure;
type Pending = { resolve(reply: Reply): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout>; mutation: boolean };
export async function connectGateway(options: Readonly<{
 configuration: unknown; isCurrent(): boolean;
 http?: (plan: HttpPlan, signal: AbortSignal) => Promise<unknown>;
 socket(plan: SocketPlan, signal: AbortSignal, onFrame: (frame: unknown) => void, onClosed: () => void): Promise<GatewaySocket>;
 onEvent(event: RpcEvent): void;
 onRequest(request: RpcServerRequest, signal: AbortSignal): Promise<ServerReply>;
 onClosed(): void;
}>): Promise<Gateway> {
 const lifetime = new AbortController();
 let handle: GatewaySocket | undefined, policyHandle: { close(): void } | undefined;
 let closed = false, ready = false, negotiating = false, connected = false, exclusive = false, sequence = 0;
 const pending = new Map<string, Pending>(), used = new Set<string>(), seen = new Map<string, string>();
 const server = new Map<string, { request: RpcServerRequest; controller: AbortController; response?: string }>();
 let resolveReady!: () => void, rejectReady!: (error: Error) => void;
 const completion = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
 // Opening can fail before a caller reaches the await below.
 void completion.catch(() => {});
 const startup = setTimeout(close, 20000);
 function close(): void {
  if (closed) return;
  closed = true; clearTimeout(startup); lifetime.abort();
  for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error(entry.mutation ? 'outcome-unknown' : 'transport-unavailable')); }
  pending.clear(); for (const entry of server.values()) entry.controller.abort(); server.clear();
  if (policyHandle) policyHandle.close(); else handle?.close(); rejectReady(new Error('Gateway unavailable'));
  try { options.onClosed(); } catch { /* Consumer cannot prevent retirement. */ }
 }
 function current(): boolean { if (closed) return false; if (!options.isCurrent()) { close(); return false; } return true; }
 function send(text: string): void { if (!current() || !handle) throw new Error('Gateway unavailable'); try { handle.send(text); } catch { close(); throw new Error('outcome-unknown'); } }
 function request(id: string, wire: string, mutation: boolean): Promise<Reply> {
  if (!current() || !handle || used.has(id) || pending.size >= 64 || used.size >= 4096) return Promise.reject(new Error('Gateway unavailable'));
  used.add(id);
  return new Promise((resolve, reject) => {
   const timer = setTimeout(() => { if (!current()) return; const entry = pending.get(id); if (!entry) return; pending.delete(id); reject(new Error(mutation ? 'outcome-unknown' : 'request-timeout')); close(); }, 20000);
   pending.set(id, { resolve, reject, timer, mutation });
   try { send(wire); } catch { /* close settles all pending requests. */ }
  });
 }
 function nextId(): string { let id: string; do { id = `desktop:${++sequence}`; } while (used.has(id)); return id; }
 function flush(): void {
  if (!current() || !ready || !handle) return;
  for (const [id, entry] of server) if (entry.response) { server.delete(id); try { send(entry.response); } catch { return; } }
 }
 async function negotiate(): Promise<void> {
  if (!current() || !ready || !handle || negotiating) return;
  negotiating = true; flush();
  try {
   let id = nextId(); const capabilities = await request(id, encodeProbe(id, 'client.capabilities'), false);
   if (!current() || capabilities.kind !== 'result') throw new Error();
   id = nextId(); const manifest = await request(id, encodeProbe(id, 'gateway.capabilities'), false);
   if (!current() || manifest.kind !== 'result') throw new Error();
   exclusive = parseGatewayCapabilities(manifest.result).perSessionExclusiveSubmit;
   connected = true; clearTimeout(startup); resolveReady();
  } catch { close(); }
 }
 function acceptServer(item: RpcServerRequest): void {
  if (!current()) return;
  const previous = seen.get(item.id);
  if (previous !== undefined) { if (previous !== item.method) close(); return; }
  if (server.size >= 64 || seen.size >= 4096) { close(); return; }
  seen.set(item.id, item.method);
  const entry: { request: RpcServerRequest; controller: AbortController; response?: string } = { request: item, controller: new AbortController() };
  server.set(item.id, entry);
  void (async () => {
   try {
    if (!current() || server.get(item.id) !== entry) return;
    const result = await options.onRequest(item, entry.controller.signal);
    if (!current() || server.get(item.id) !== entry) return;
    entry.response = encodeServerReply(item.id, result); flush();
   } catch { if (current() && server.get(item.id) === entry) close(); }
  })();
 }
 function frame(input: unknown): void {
  if (!current()) return;
  try {
   for (const item of decodeRpcFrame(input)) {
    if (!current()) return;
    if (item.kind === 'result' || item.kind === 'error') {
     const entry = pending.get(item.id); if (!entry) continue;
     pending.delete(item.id); clearTimeout(entry.timer); entry.resolve(item); continue;
    }
    if (item.kind === 'request') {
     acceptServer(item); continue;
    }
    if (item.params.type === 'gateway.ready') { if (ready) { close(); return; } ready = true; void negotiate(); }
    else if (item.params.type === 'request.cancel') {
     const payload = item.params.payload as { id: string; method: string };
     const entry = server.get(payload.id);
     if (entry?.request.method === payload.method) { server.delete(payload.id); entry.controller.abort(); }
    }
    if (current()) options.onEvent(item);
   }
  } catch { close(); }
 }
 let policy: ReturnType<typeof createTransportPolicy>;
 try { policy = createTransportPolicy(options.configuration, {
  http: options.http ?? boundedHttp, isCurrent: options.isCurrent, now: () => performance.now(),
  socket: async (plan, signal, callback) => {
   const opened = await options.socket(plan, signal, callback, () => { close(); });
   handle = opened;
   if (!current()) { opened.close(); throw new Error('Gateway unavailable'); }
   void negotiate(); return opened;
  },
 }); } catch { close(); throw new Error('Gateway unavailable'); }
 try { policyHandle = await policy.createSocketAttempt(frame).open(lifetime.signal); if (!current()) throw new Error(); await completion; }
 catch { close(); throw new Error('Gateway unavailable'); }
 function result(reply: Reply): unknown { if (reply.kind === 'error') throw new Error('Host operation failed'); return reply.result; }
 return Object.freeze({
  restoreRequests(requests: unknown, runtimeId: string): void {
   if (!current() || !connected) throw new Error('Gateway unavailable');
   const restored = decodeOpenRequests(requests, runtimeId);
   if (!current()) throw new Error('Gateway unavailable');
   // Preflight capacity and ID/method conflicts before any handler is invoked.
   const unseen = restored.filter(item => !seen.has(item.id));
   if (server.size + unseen.length > 64 || seen.size + unseen.length > 4096
     || restored.some(item => seen.has(item.id) && seen.get(item.id) !== item.method)) {
    close(); throw new Error('Invalid request recovery');
   }
   for (const item of restored) acceptServer({kind:'request',...item});
  },
  close, get exclusiveSubmit() { return exclusive; },
  async operation(operation: DesktopRpcOperation): Promise<unknown> {
   if (!current() || !connected) throw new Error('Gateway unavailable');
   const id = nextId(), wire = encodeSessionOperation(id, operation);
   const mutation = ['sessionCreate', 'sessionResume', 'sessionInterrupt'].includes(operation.kind);
   const reply = await request(id, wire, mutation);
   if (!current()) throw new Error(mutation ? 'outcome-unknown' : 'Gateway unavailable');
   return result(reply);
  },
  async submitText(input: TextRequest): Promise<unknown> {
   if (!current() || !connected || !exclusive) throw new Error('Gateway unavailable');
   const wire = encodeTextRequest(input); const captured = JSON.parse(wire) as { id: string };
   const reply = await request(captured.id, wire, true);
   if (!current()) throw new Error('outcome-unknown');
   return reply.kind === 'result' ? { jsonrpc: '2.0', id: reply.id, result: reply.result }
    : { jsonrpc: '2.0', id: reply.id, error: { code: reply.code, message: reply.message, ...(reply.reason === undefined ? {} : { data: { reason: reply.reason } }) } };
  },
  async requestHttp(operation: HttpOperation): Promise<HttpResult> { if (!current()) throw new Error('Gateway unavailable'); return policy.request(operation, lifetime.signal); },
 });
}
