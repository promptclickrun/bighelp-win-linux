// Privileged-only adapter. Plans and underlying library errors contain secrets.
import WebSocket from 'ws';
import { randomBytes } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { GatewaySocket } from '../hermes-client/gateway.ts';
import type { SocketPlan } from './transport-policy.ts';

const MAX_BYTES = 4 * 1024 * 1024;
const DEADLINE_MS = 20000;
const HEARTBEAT_MS = 30000;
const failure = () => new Error('Socket unavailable');
function singleHeader(response: IncomingMessage, name: string): string | undefined {
  const values: string[] = [];
  for (let i = 0; i < response.rawHeaders.length; i += 2) {
    if (response.rawHeaders[i]?.toLowerCase() === name) values.push(response.rawHeaders[i + 1] ?? '');
  }
  if (values.length > 1) throw failure();
  return values[0];
}

export async function connectSocket(plan: SocketPlan, signal: AbortSignal,
  onFrame: (frame: unknown) => void, onClosed: () => void): Promise<GatewaySocket> {
  return new Promise((resolve, reject) => {
    let socket: WebSocket | undefined;
    let opened = false, closing = false, notified = false;
    let handshakeTimer: ReturnType<typeof setTimeout> | undefined;
    let sendTimer: ReturnType<typeof setTimeout> | undefined;
    let closeTimer: ReturnType<typeof setTimeout> | undefined;
    let heartbeatTimer: ReturnType<typeof setTimeout> | undefined;
    let receiveTimer: ReturnType<typeof setTimeout> | undefined;
    let pendingBytes = 0, pendingWrites = 0;
    let expectedPong: Buffer | undefined;
    function retire(): void {
      closing = true;
      clearTimeout(handshakeTimer); clearTimeout(sendTimer); clearTimeout(heartbeatTimer); clearTimeout(receiveTimer);
      signal.removeEventListener('abort', abort);
      if (!opened) reject(failure());
      if (!notified) {
        notified = true;
        try { onClosed(); } catch { /* Consumer cannot prevent cleanup. */ }
      }
    }
    function terminate(): void { retire(); clearTimeout(closeTimer); socket?.terminate(); }
    function abort(): void { terminate(); }
    function close(code = 1000): void {
      if (closing) return;
      retire();
      if (socket?.readyState === WebSocket.OPEN) {
        socket.close(code);
        closeTimer = setTimeout(terminate, 1000);
      } else terminate();
    }
    function write(body: string | Buffer, kind: 'text' | 'ping' | 'pong'): void {
      const size = typeof body === 'string' ? Buffer.byteLength(body, 'utf8') : body.length;
      if (closing || socket?.readyState !== WebSocket.OPEN || size > MAX_BYTES
          || pendingBytes + size + 14 > MAX_BYTES + 14 || pendingWrites >= 1024
          || socket.bufferedAmount + size + 14 > MAX_BYTES + 14) throw failure();
      pendingBytes += size + 14; pendingWrites++;
      if (!sendTimer) sendTimer = setTimeout(terminate, DEADLINE_MS);
      const done = (error?: Error): void => {
        pendingBytes -= size + 14; pendingWrites--;
        if (pendingWrites === 0) { clearTimeout(sendTimer); sendTimer = undefined; }
        if (error) terminate();
      };
      if (kind === 'text') socket.send(body, { binary: false, compress: false }, done);
      else socket[kind](body, true, done);
    }
    function heartbeat(): void {
      heartbeatTimer = setTimeout(() => {
        if (closing) return;
        expectedPong = randomBytes(16);
        try { write(expectedPong, 'ping'); } catch { terminate(); return; }
        receiveTimer = setTimeout(terminate, DEADLINE_MS);
      }, HEARTBEAT_MS);
    }
    try {
      const url = new URL(plan.url);
      if (signal.aborted || plan.followRedirects !== false || plan.cookies !== 'omit'
          || !['ws:', 'wss:'].includes(url.protocol) || url.username || url.password || url.hash
          || url.pathname !== '/api/ws') throw failure();
      const provider = plan.protocols.length !== 0;
      if (provider && (plan.protocols.length !== 2 || plan.protocols[0] !== 'hermes-gateway-v1'
          || !/^hermes-gateway-ticket\.[A-Za-z0-9_-]{1,4096}$/u.test(plan.protocols[1] ?? ''))) throw failure();
      if (provider !== (plan.ticketExpiresAt !== undefined)) throw failure();
      const headers: Record<string, string> = {};
      const seen = new Set<string>();
      for (const [name, value] of Object.entries(plan.headers)) {
        const lower = name.toLowerCase();
        if (!/^[a-zA-Z0-9-]{1,128}$/u.test(name) || seen.has(lower)
            || /^(sec-|proxy-|content-)/u.test(lower)
            || ['cookie', 'cookie2', 'host', 'connection', 'upgrade', 'transfer-encoding', 'expect', 'trailer'].includes(lower)
            || typeof value !== 'string' || value.length > 8192 || !/^[\x20-\x7e]+$/u.test(value)) throw failure();
        seen.add(lower); headers[name] = value;
      }
      // Same monotonic clock as transport policy. There is one attempt and no retry.
      if (plan.ticketExpiresAt !== undefined && (!Number.isFinite(plan.ticketExpiresAt) || performance.now() >= plan.ticketExpiresAt)) throw failure();
      socket = new WebSocket(url, [...plan.protocols], {
        headers, followRedirects: false, perMessageDeflate: false, handshakeTimeout: DEADLINE_MS,
        rejectUnauthorized: true, maxPayload: MAX_BYTES, maxFragments: 4096, maxBufferedChunks: 4096,
        skipUTF8Validation: false, autoPong: false,
      });
      signal.addEventListener('abort', abort, { once: true });
      handshakeTimer = setTimeout(terminate, DEADLINE_MS);
      socket.on('error', terminate);
      socket.on('close', () => { retire(); clearTimeout(closeTimer); });
      socket.on('unexpected-response', (_request, response) => { response.destroy(); terminate(); });
      socket.on('upgrade', response => {
        try {
          // ws validates the nonce accept. Reject duplicate critical headers and
          // the offered ticket being selected as an application subprotocol.
          if (response.statusCode !== 101 || singleHeader(response, 'upgrade')?.toLowerCase() !== 'websocket'
              || !singleHeader(response, 'connection')?.toLowerCase().split(',').map(value => value.trim()).includes('upgrade')
              || singleHeader(response, 'sec-websocket-accept') === undefined
              || singleHeader(response, 'sec-websocket-extensions') !== undefined
              || singleHeader(response, 'sec-websocket-protocol') !== (provider ? 'hermes-gateway-v1' : undefined)) throw failure();
        } catch { terminate(); }
      });
      socket.on('open', () => {
        if (closing || signal.aborted) { terminate(); return; }
        clearTimeout(handshakeTimer); opened = true; heartbeat();
        resolve(Object.freeze({
          send(text: string): void {
            try {
              if (typeof text !== 'string' || !text.isWellFormed()) throw failure();
              write(text, 'text');
            } catch { terminate(); throw failure(); }
          },
          close(): void { close(); },
        }));
      });
      socket.on('message', (data, binary) => {
        if (closing) return;
        if (binary) { close(1003); return; }
        try {
          // binaryType remains nodebuffer; ws validates complete UTF-8 first.
          if (!Buffer.isBuffer(data)) throw failure();
          onFrame(data.toString('utf8'));
        } catch { close(1011); }
      });
      socket.on('ping', data => {
        if (closing) return;
        try { write(data, 'pong'); } catch { terminate(); }
      });
      socket.on('pong', data => {
        if (closing || !expectedPong || !data.equals(expectedPong)) return;
        expectedPong = undefined; clearTimeout(receiveTimer); heartbeat();
      });
    } catch { terminate(); }
  });
}
