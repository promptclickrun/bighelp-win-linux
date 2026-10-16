// Privileged-only policy. These plans contain credentials: never IPC or log them.
// No Electron, DNS, HTTP, socket, credential store, or connection registry adapter.
export type Endpoint = Readonly<{ origin: string; socketOrigin: string }>;
export type HttpOperation =
  | Readonly<{ kind: 'status' | 'providers' | 'identity' | 'health' | 'nativeContext' }>
  | Readonly<{ kind: 'templateList'; agentId: string; etag: string; requestId: string }>;
export type HttpResult = Readonly<{ body: unknown; etag?: string; requestId?: string }>;
export type HttpPlan = Readonly<{
  url: string; method: 'GET' | 'POST'; headers: Readonly<Record<string, string>>;
  body?: string; redirect: 'error'; credentials: 'omit'; maxResponseBytes: number;
}>;
export type SocketPlan = Readonly<{
  url: string; headers: Readonly<Record<string, string>>; protocols: readonly string[];
  followRedirects: false; cookies: 'omit';
  // Provider adapter must initiate its single handshake before this deadline.
  ticketExpiresAt?: number;
}>;
export type SocketHandle = Readonly<{ close(): void }>;
export type TransportAdapters = Readonly<{
  // Must enforce redirect/cookie/byte limits BEFORE following or buffering.
  // Return {status, url, redirected:false, body:<decoded unknown>, headers?}.
  // headers uses lowercase keys and rejects duplicate critical headers.
  http(plan: HttpPlan, signal: AbortSignal): Promise<unknown>;
  // Deliver opaque decoded frames; framing/negotiation belong to another lane.
  socket(plan: SocketPlan, signal: AbortSignal, onFrame: (frame: unknown) => void): Promise<SocketHandle>;
  // Captured immutable owner lease from the connection coordinator, not URL equality.
  isCurrent(): boolean;
  // Monotonic milliseconds, including time spent waiting for a ticket response.
  now(): number;
}>;

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Expected object');
  return value as Record<string, unknown>;
}
function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new TypeError('Unexpected field');
}
function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max
      || !value.isWellFormed() || /[\x00-\x1f\x7f]/u.test(value)) throw new TypeError('Invalid text');
  return value;
}
function headerValue(value: unknown): string {
  const result = text(value, 8192);
  if (!/^[\x20-\x7e]+$/u.test(result) || result.trim() !== result) throw new TypeError('Invalid header value');
  return result;
}

// Intentionally excludes link-local/metadata, mapped IPv6 and DNS names. No DNS
// lookup can turn an unapproved plaintext name into an approved destination.
function privateLiteral(host: string): boolean {
  if (host === '[::1]' || /^\[f[cd][0-9a-f]{2}:/u.test(host)) return true;
  const parts = host.split('.');
  if (parts.length !== 4 || parts.some(part => !/^(0|[1-9][0-9]{0,2})$/u.test(part) || Number(part) > 255)) return false;
  const [a = -1, b = -1] = parts.map(Number);
  return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

export function parseEndpoint(value: unknown, approvedPrivateHttpOrigin?: unknown): Endpoint {
  const raw = text(value, 2048);
  // Reject syntax WHATWG URL otherwise silently repairs: whitespace, backslashes,
  // encoded authorities/paths, dot segments, even empty userinfo/query/fragment.
  if (!/^https?:\/\/[^/?#@%\\\s]+\/?$/u.test(raw)) throw new TypeError('Expected root HTTP(S) endpoint');
  const url = new URL(raw);
  if (!url.hostname || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new TypeError('Invalid endpoint');
  }
  const authority = raw.slice(raw.indexOf('://') + 3).replace(/\/$/u, '');
  const literalHost = authority.startsWith('[') ? authority.slice(0, authority.indexOf(']') + 1)
    : authority.split(':')[0];
  // Reject numeric IP aliases (127.1, octal, hex, decimal), rather than approving
  // an origin whose human spelling hides its destination.
  if (/^\d+\.\d+\.\d+\.\d+$/u.test(url.hostname) && literalHost !== url.hostname) {
    throw new TypeError('Noncanonical IP address');
  }
  if (url.protocol === 'http:' && (approvedPrivateHttpOrigin !== url.origin || !privateLiteral(url.hostname))) {
    throw new TypeError('Private HTTP requires exact-origin approval and a private literal');
  }
  return Object.freeze({ origin: url.origin, socketOrigin: url.origin.replace(/^http/u, 'ws') });
}

type Authentication = Readonly<{ kind: 'provider' | 'dashboard'; token: string }>;
function parseAuthentication(value: unknown): Authentication {
  const input = record(value);
  exactKeys(input, ['kind', 'token']);
  if (input.kind !== 'provider' && input.kind !== 'dashboard') throw new TypeError('Invalid authentication');
  const token = headerValue(input.token);
  if (/\s/u.test(token)) throw new TypeError('Invalid authentication token');
  return Object.freeze({ kind: input.kind, token });
}

function proxyHeaders(value: unknown, endpoint: Endpoint, auth: Authentication): Readonly<Record<string, string>> {
  const input = record(value);
  exactKeys(input, ['custom', 'cloudflare', 'basic']);
  if (input.cloudflare !== undefined && input.basic !== undefined) throw new TypeError('Conflicting proxy modes');
  const headers: Record<string, string> = {};
  if (input.custom !== undefined) {
    if (!Array.isArray(input.custom) || input.custom.length > 16) throw new TypeError('Invalid custom headers');
    const names = new Set<string>();
    for (const entry of input.custom) {
      const pair = record(entry);
      exactKeys(pair, ['name', 'value']);
      const name = text(pair.name, 128);
      const lower = name.toLowerCase();
      if (!/^[a-zA-Z0-9-]+$/u.test(name) || names.has(lower)
          || /^(sec-|x-hermes-|x-loopdy-|cf-access-|proxy-|content-|access-control-|x-forwarded-|if-|accept-)/u.test(lower)
          || ['authorization', 'cookie', 'cookie2', 'host', 'connection', 'upgrade', 'te', 'trailer',
            'transfer-encoding', 'accept', 'accept-encoding', 'accept-language', 'user-agent',
            'origin', 'referer', 'range', 'expect', 'if-match', 'if-none-match', 'cache-control',
            'pragma', 'forwarded', 'via', 'keep-alive'].includes(lower)) throw new TypeError('Reserved or duplicate header');
      names.add(lower);
      headers[name] = headerValue(pair.value);
    }
  }
  if (input.cloudflare !== undefined) {
    if (!endpoint.origin.startsWith('https:')) throw new TypeError('Cloudflare Access requires HTTPS');
    const cf = record(input.cloudflare);
    exactKeys(cf, ['clientId', 'clientSecret']);
    headers['CF-Access-Client-Id'] = headerValue(cf.clientId);
    headers['CF-Access-Client-Secret'] = headerValue(cf.clientSecret);
  }
  if (input.basic !== undefined) {
    // Provider Bearer uses Authorization too. No invented alternate bearer header.
    if (auth.kind === 'provider') throw new TypeError('Provider bearer and proxy Basic conflict');
    const basic = headerValue(input.basic);
    if (!/^Basic [A-Za-z0-9+/]+={0,2}$/u.test(basic)) throw new TypeError('Invalid Basic credential');
    headers.Authorization = basic;
  }
  return Object.freeze(headers);
}

export function parseHttpOperation(value: unknown): HttpOperation {
  const input = record(value);
  switch (input.kind) {
    case 'status': case 'providers': case 'identity': case 'health': case 'nativeContext':
      exactKeys(input, ['kind']);
      return Object.freeze({ kind: input.kind });
    case 'templateList': {
      exactKeys(input, ['kind', 'agentId', 'etag', 'requestId']);
      const agentId = text(input.agentId, 256);
      if (agentId.trim() !== agentId) throw new TypeError('Invalid agent identity');
      const etag = text(input.etag, 73);
      const requestId = text(input.requestId, 36);
      if (!/^"sha256:[0-9a-f]{64}"$/u.test(etag)
          || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(requestId)) {
        throw new TypeError('Invalid native preconditions');
      }
      return Object.freeze({ kind: 'templateList', agentId, etag, requestId });
    }
    default: throw new TypeError('Unsupported HTTP operation');
  }
}

function checkResponse(value: unknown, plan: HttpPlan): Record<string, unknown> {
  const response = record(value);
  if (response.redirected !== false || response.url !== plan.url) throw new Error('Redirect or destination mismatch');
  if (typeof response.status !== 'number' || !Number.isInteger(response.status)
      || response.status < 200 || response.status >= 300) throw new Error('Host request failed');
  return response;
}

// Each instance captures one verified owner binding and copied credential values.
// Retire it on owner replacement. Do not wire this factory directly to preload IPC.
export function createTransportPolicy(configuration: unknown, adapters: TransportAdapters) {
  const config = record(configuration);
  exactKeys(config, ['endpoint', 'approvedPrivateHttpOrigin', 'authentication', 'proxy']);
  const endpoint = parseEndpoint(config.endpoint, config.approvedPrivateHttpOrigin);
  const auth = parseAuthentication(config.authentication);
  const proxy = proxyHeaders(config.proxy ?? {}, endpoint, auth);
  const authenticated = Object.freeze({ ...proxy, ...(auth.kind === 'provider'
    ? { Authorization: `Bearer ${auth.token}` } : { 'X-Hermes-Session-Token': auth.token }) });
  function current(signal: AbortSignal): void {
    if (signal.aborted || !adapters.isCurrent()) throw new Error('Transport cancelled or stale');
  }
  function plan(path: string, method: 'GET' | 'POST', headers: Readonly<Record<string, string>>,
    maxResponseBytes: number, body?: string): HttpPlan {
    return Object.freeze({ url: endpoint.origin + path, method, headers, maxResponseBytes,
      redirect: 'error', credentials: 'omit', ...(body === undefined ? {} : { body }) });
  }
  async function send(request: HttpPlan, signal: AbortSignal): Promise<Record<string, unknown>> {
    current(signal);
    try {
      const response = await adapters.http(request, signal);
      current(signal);
      return checkResponse(response, request);
    } catch {
      // Never return the adapter's URL/header-bearing exception or cause.
      throw new Error('Host request failed or retired');
    }
  }
  async function request(value: unknown, signal: AbortSignal): Promise<HttpResult> {
    const operation = parseHttpOperation(value);
    let prepared: HttpPlan;
    switch (operation.kind) {
      case 'status': prepared = plan('/api/status', 'GET', authenticated, 65536); break;
      case 'providers': prepared = plan('/api/auth/providers', 'GET', authenticated, 65536); break;
      case 'identity': prepared = plan('/api/auth/me', 'GET', authenticated, 65536); break;
      case 'health': prepared = plan('/api/health', 'GET', authenticated, 65536); break;
      case 'nativeContext': prepared = plan('/api/plugins/loopdy/native/context', 'GET', authenticated, 16384); break;
      case 'templateList':
        prepared = plan('/api/plugins/loopdy/native/cards/templates/list', 'POST', Object.freeze({
          ...authenticated, 'Content-Type': 'application/json', 'If-Match': operation.etag,
          'X-Loopdy-Request-ID': operation.requestId,
        }), 196608, JSON.stringify({ agentId: operation.agentId }));
        break;
    }
    const response = await send(prepared, signal);
    current(signal);
    if (operation.kind === 'nativeContext' || operation.kind === 'templateList') {
      const headers = record(response.headers);
      const etag = text(headers.etag, 73);
      if (!/^"sha256:[0-9a-f]{64}"$/u.test(etag)) throw new Error('Invalid native response ETag');
      if (operation.kind === 'templateList') {
        if (etag !== operation.etag || headers['x-loopdy-request-id'] !== operation.requestId) {
          throw new Error('Native response correlation mismatch');
        }
        return Object.freeze({ body: response.body, etag, requestId: operation.requestId });
      }
      return Object.freeze({ body: response.body, etag });
    }
    return Object.freeze({ body: response.body });
  }

  // One attempt per closure, even on failure. Provider tickets never leave this
  // attempt except in the privileged adapter's subprotocol plan. No retry/cache.
  function createSocketAttempt(onFrame: (frame: unknown) => void) {
    let used = false;
    return Object.freeze({
      async open(signal: AbortSignal): Promise<SocketHandle> {
        if (used) throw new Error('Socket attempt already used');
        used = true;
        current(signal);
        const controller = new AbortController();
        let retired = false;
        let handle: SocketHandle | undefined;
        function close(): void {
          if (retired) return;
          retired = true;
          controller.abort();
          signal.removeEventListener('abort', close);
          handle?.close();
        }
        signal.addEventListener('abort', close, { once: true });
        try {
          let url = endpoint.socketOrigin + '/api/ws';
          let headers: Readonly<Record<string, string>>;
          let protocols: readonly string[];
          let ticketExpiresAt: number | undefined;
          if (auth.kind === 'provider') {
            const started = adapters.now();
            if (!Number.isFinite(started) || started < 0) throw new Error('Invalid clock');
            const response = await send(plan('/api/auth/ws-ticket', 'POST', Object.freeze({
              ...authenticated, 'Content-Type': 'application/json',
            }), 16384, '{}'), controller.signal);
            const body = record(response.body);
            const ticket = text(body.ticket, 4096);
            const ttl = body.ttl_seconds;
            if (!/^[A-Za-z0-9_-]+$/u.test(ticket) || typeof ttl !== 'number'
                || !Number.isFinite(ttl) || ttl <= 0 || ttl > 300) throw new Error('Invalid socket ticket');
            ticketExpiresAt = started + ttl * 1000;
            const now = adapters.now();
            if (!Number.isFinite(now) || now < started || now >= ticketExpiresAt) throw new Error('Expired socket ticket');
            headers = proxy;
            protocols = Object.freeze(['hermes-gateway-v1', `hermes-gateway-ticket.${ticket}`]);
          } else {
            url += `?token=${encodeURIComponent(auth.token)}`;
            headers = authenticated;
            // Hermes selects hermes-gateway-v1 only on the ticket path. Offering it
            // here makes a compliant client reject the server's protocol-less accept.
            protocols = Object.freeze([]);
          }
          current(controller.signal);
          handle = await adapters.socket(Object.freeze({ url, headers, protocols,
            followRedirects: false, cookies: 'omit',
            ...(ticketExpiresAt === undefined ? {} : { ticketExpiresAt }) }), controller.signal, frame => {
            if (retired) return;
            if (signal.aborted || !adapters.isCurrent()) { close(); return; }
            onFrame(frame);
          });
          // close() may have run while the connector had no handle to close.
          if (retired) { handle.close(); throw new Error('Transport cancelled or stale'); }
          current(controller.signal);
          return Object.freeze({ close });
        } catch {
          close();
          // Adapter failures can contain credential-bearing URLs: do not propagate.
          throw new Error('Socket attempt failed or retired');
        }
      },
    });
  }
  return Object.freeze({ request, createSocketAttempt });
}
