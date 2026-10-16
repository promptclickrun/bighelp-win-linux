// Main-process Hermes discovery and sign-in. Ported from the shipping app's
// DirectHermesAuthentication (see docs/contracts/HERMES_API.md §2). Every value
// here that is not a HostProblem code is a secret or a host address: never send
// it to a renderer, a log or an error message.
import { createHash, randomBytes } from 'node:crypto';
import { parseJson } from '../platform/http-transport.ts';
import { parseEndpoint } from '../platform/transport-policy.ts';
import { AuthHttpError } from '../platform/auth-http.ts';
import type { AuthHttp, AuthHttpResponse } from '../platform/auth-http.ts';

// Hermes' default dashboard/serve port (hermes_cli/main_dashboard.py, web_server.py).
export const HERMES_DEFAULT_PORT = 9119;

export type HostProblem =
  | 'invalidAddress' | 'plainHttpName' | 'pathNotSupported' | 'unreachable' | 'tls' | 'loginPage' | 'proxyPassword'
  | 'blocked' | 'hostNameRefused' | 'webPage' | 'notHermes' | 'serverUnavailable' | 'rateLimited'
  | 'invalidCredentials' | 'invalidToken' | 'unsupported' | 'notThisComputer' | 'chooseProvider' | 'modeChanged'
  | 'identityChanged' | 'expired' | 'redirectRefused' | 'tokenWithheld' | 'exchangeUncertain' | 'exchangeRefused'
  | 'invalidResponse' | 'setupExpired';

// Fixed plain-word copy. Host text is never shown here.
export const HOST_PROBLEM_TEXT: Readonly<Record<HostProblem, string>> = Object.freeze({
  invalidAddress: 'Enter an address like 192.168.1.20:9119 or hermes.example.com.',
  plainHttpName: "For plain http, use the computer's IP address (like 192.168.1.20), or use an https address.",
  pathNotSupported: "bighelp can't use an address with a path yet. Use the address that reaches Hermes directly.",
  unreachable: 'Could not reach Hermes there. Check that Hermes is running, the address and port, and your VPN or Tailscale.',
  tls: "The secure connection could not be checked. Check the computer's HTTPS certificate.",
  loginPage: "This address opens a login page bighelp can't use. Try the address that reaches Hermes directly.",
  proxyPassword: "This address asks for a password before Hermes. bighelp can't use that kind of sign-in yet.",
  blocked: 'Something in front of Hermes turned bighelp away. Try the address that reaches Hermes directly.',
  hostNameRefused: 'Hermes turned bighelp away because it answers only to its local address. In Hermes, set dashboard.public_url to this https address and set up a Hermes sign-in, then restart Hermes.',
  webPage: 'This address answered with a web page instead of Hermes. Check the address and port.',
  notHermes: 'This address answered, but not like Hermes. Check the address and port.',
  serverUnavailable: "Hermes isn't ready right now. Try again in a moment.",
  rateLimited: 'Hermes is limiting sign-in attempts. Wait a minute, then try again.',
  invalidCredentials: "Hermes didn't accept that username and password.",
  invalidToken: "Hermes didn't accept that token.",
  unsupported: "This Hermes doesn't offer that way of signing in.",
  notThisComputer: 'No sign-in only works when Hermes runs on this computer.',
  chooseProvider: 'Choose how to sign in.',
  modeChanged: 'Hermes changed how it signs people in. Sign in again. Nothing was sent with the old sign-in.',
  identityChanged: 'Hermes answered with a different account. Sign in again to keep chats separate.',
  expired: 'Your sign-in has expired. Sign in again.',
  redirectRefused: 'Hermes sent the sign-in somewhere unexpected, so bighelp stopped. Try again.',
  tokenWithheld: "This Hermes doesn't share its local sign-in. Start it with hermes dashboard or hermes serve, or set up a Hermes username and password.",
  exchangeUncertain: "The sign-in couldn't be confirmed. Start a new sign-in; the one-time code won't be reused.",
  exchangeRefused: "Hermes didn't finish the sign-in. Try again.",
  invalidResponse: "Hermes sent an answer bighelp couldn't read. Check that Hermes is up to date.",
  setupExpired: 'That check is out of date. Check the address again.',
});
// Problems worth retrying on their own: the network or Hermes is not there yet.
const TRANSIENT: ReadonlySet<HostProblem> = new Set(['unreachable', 'serverUnavailable', 'rateLimited']);
export class HostProblemError extends Error {
  readonly problem: HostProblem;
  constructor(problem: HostProblem) { super(HOST_PROBLEM_TEXT[problem]); this.name = 'HostProblemError'; this.problem = problem; }
  get transient(): boolean { return TRANSIENT.has(this.problem); }
}
const fail = (problem: HostProblem): never => { throw new HostProblemError(problem); };

export type DashboardCredential = Readonly<{ kind: 'dashboard'; token: string; automatic: boolean }>;
export type BearerCredential = Readonly<{
  kind: 'bearer'; accessToken: string; refreshToken: string | null; expiresAt: number | null;
  // The verified account. Null only for a pasted token before its first check.
  provider: string | null; userId: string | null;
}>;
export type HostCredential = DashboardCredential | BearerCredential;

export type HostProvider = Readonly<{ id: string; name: string; password: boolean }>;
export type HostCandidate = Readonly<{ origin: string; plainHttp: boolean; loopback: boolean }>;
export type HostDiscovery = HostCandidate & Readonly<{
  authRequired: boolean; nativePkce: boolean; version: string | null; providers: readonly HostProvider[];
}>;
export type ProbeTarget = Readonly<{ kind: 'thisComputer'; port: number }> | Readonly<{ kind: 'address'; address: string }>;
export type SignInMethod = 'automatic' | 'password' | 'token';

const TOKEN = /^[\x21-\x7e]{1,8192}$/u;
export function validToken(value: unknown): value is string { return typeof value === 'string' && TOKEN.test(value); }
const isLoopback = (hostname: string) => hostname === '[::1]' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/u.test(hostname);

function candidate(raw: string, http: boolean): HostCandidate | null {
  try {
    const origin = new URL(raw).origin;
    const endpoint = parseEndpoint(raw, http ? origin : undefined);
    return Object.freeze({ origin: endpoint.origin, plainHttp: http, loopback: isLoopback(new URL(endpoint.origin).hostname) });
  } catch { return null; }
}

// The addresses to try, in order. A typed scheme is used exactly; a bare private
// IP literal tries HTTPS, then plain HTTP. Plain HTTP never goes to a DNS name.
export function probeCandidates(target: ProbeTarget): readonly HostCandidate[] {
  if (target.kind === 'thisComputer') {
    if (!Number.isSafeInteger(target.port) || target.port < 1 || target.port > 65535) return fail('invalidAddress');
    return Object.freeze([candidate(`http://127.0.0.1:${target.port}`, true) ?? fail('invalidAddress')]);
  }
  const raw = target.address;
  if (typeof raw !== 'string' || !raw || raw.length > 2048 || !raw.isWellFormed() || /[\s\x00-\x1f\x7f\\]/u.test(raw)) return fail('invalidAddress');
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//iu.exec(raw);
  if (scheme && !/^https?$/iu.test(scheme[1] ?? '')) return fail('invalidAddress');
  const rest = scheme ? raw.slice(scheme[0].length) : raw;
  const slash = rest.indexOf('/');
  let authority = slash === -1 ? rest : rest.slice(0, slash);
  const path = slash === -1 ? '' : rest.slice(slash);
  if (/[?#@%]/u.test(authority) || /[?#]/u.test(path) || !authority) return fail('invalidAddress');
  if (path && path !== '/') return fail('pathNotSupported');
  // A bare IPv6 literal without brackets; there is then no port.
  if (!authority.startsWith('[') && (authority.match(/:/gu)?.length ?? 0) > 1) authority = `[${authority}]`;
  // "localhost" can resolve anywhere; the person means this computer's loopback.
  authority = authority.replace(/^localhost(?=:|$)/iu, '127.0.0.1');
  const kind = scheme ? (scheme[1] ?? '').toLowerCase() : '';
  const https = candidate(`https://${authority}`, false), http = candidate(`http://${authority}`, true);
  if (kind === 'https') return Object.freeze([https ?? fail('invalidAddress')]);
  if (kind === 'http') return Object.freeze([http ?? (https ? fail('plainHttpName') : fail('invalidAddress'))]);
  if (!https) return fail('invalidAddress');
  return Object.freeze(http ? [https, http] : [https]);
}

type CallOptions = Readonly<{ method?: 'GET' | 'POST'; accept: 'json' | 'html'; json?: Readonly<Record<string, string>>;
  headers?: Readonly<Record<string, string>>; maxBytes?: number; timeoutMs?: number; signal?: AbortSignal }>;
async function call(http: AuthHttp, origin: string, path: string, options: CallOptions): Promise<AuthHttpResponse> {
  const headers: Record<string, string> = { ...options.headers,
    Accept: options.accept === 'json' ? 'application/json' : 'text/html', 'Cache-Control': 'no-store' };
  if (options.json) headers['Content-Type'] = 'application/json';
  return http(Object.freeze({ url: origin + path, method: options.method ?? 'GET', headers: Object.freeze(headers),
    ...(options.json ? { body: JSON.stringify(options.json) } : {}),
    maxBytes: options.maxBytes ?? 65536, timeoutMs: options.timeoutMs ?? 15000 }), options.signal ?? new AbortController().signal);
}
function object(response: AuthHttpResponse): Record<string, unknown> | null {
  if (response.text === null || !response.text.trim()) return null;
  try {
    const value = parseJson(response.text);
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch { return null; }
}
function transportProblem(error: unknown): never {
  if (error instanceof HostProblemError) throw error;
  if (error instanceof AuthHttpError) return fail(error.tls ? 'tls' : 'unreachable');
  return fail('unreachable');
}
// Status meanings common to every sign-in route.
function statusProblem(response: AuthHttpResponse): HostProblem {
  const status = response.status;
  if (status >= 300 && status < 400) return 'loginPage';
  if ((status === 401 || status === 403) && response.challenged) return 'proxyPassword';
  if (status === 404 || status === 405) return 'unsupported';
  if (status === 429) return 'rateLimited';
  if (status >= 500) return 'serverUnavailable';
  return 'invalidResponse';
}
function printable(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= max && value.isWellFormed()
    && !/[\x00-\x1f\x7f-\x9f‪-‮⁦-⁩]/u.test(value) && value.trim() === value ? value : null;
}

// Credential-free GET /api/status (plus /api/auth/providers when sign-in is on).
export async function discover(http: AuthHttp, target: HostCandidate, signal?: AbortSignal): Promise<HostDiscovery> {
  let response: AuthHttpResponse;
  try { response = await call(http, target.origin, '/api/status', { accept: 'json', timeoutMs: 8000, ...(signal ? { signal } : {}) }); }
  catch (error) { return transportProblem(error); }
  const body = object(response);
  if (response.status === 400 && typeof body?.detail === 'string' && body.detail.startsWith('Invalid Host header')) return fail('hostNameRefused');
  if (response.status === 401 || response.status === 403) return fail(response.challenged ? 'proxyPassword' : 'blocked');
  if ((response.status >= 200 && response.status < 300 || response.status === 400) && response.contentType === 'text/html') return fail('webPage');
  if (response.status < 200 || response.status >= 300) {
    const problem = statusProblem(response);
    return fail(problem === 'unsupported' || problem === 'invalidResponse' ? 'notHermes' : problem);
  }
  if (!body || typeof body.auth_required !== 'boolean') return fail('notHermes');
  const flows = body.auth_flows ?? [];
  if (!Array.isArray(flows) || flows.length > 32 || new Set(flows).size !== flows.length
    || flows.some(flow => typeof flow !== 'string' || !flow || Buffer.byteLength(flow) > 128)) return fail('invalidResponse');
  const nativePkce = flows.includes('native_pkce');
  const version = typeof body.version === 'string' && /^[0-9A-Za-z.+_-]{1,64}$/u.test(body.version) ? body.version : null;
  let providers: readonly HostProvider[] = [];
  if (body.auth_required && nativePkce) providers = await listProviders(http, target.origin, signal);
  return Object.freeze({ ...target, authRequired: body.auth_required, nativePkce, version, providers });
}
// Optional metadata: a failure never removes an advertised sign-in.
async function listProviders(http: AuthHttp, origin: string, signal?: AbortSignal): Promise<readonly HostProvider[]> {
  try {
    const response = await call(http, origin, '/api/auth/providers', { accept: 'json', timeoutMs: 8000, ...(signal ? { signal } : {}) });
    const body = response.status === 200 ? object(response) : null;
    const list = body?.providers;
    if (!Array.isArray(list) || list.length > 64) return [];
    const result: HostProvider[] = [];
    for (const entry of list) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
      const row = entry as Record<string, unknown>;
      const id = typeof row.name === 'string' && /^[\x21-\x7e]{1,128}$/u.test(row.name) ? row.name : null;
      if (!id || typeof row.supports_password !== 'boolean' || result.some(item => item.id === id)) return [];
      const name = row.display_name === undefined || row.display_name === null ? id : printable(row.display_name, 512);
      if (!name) return [];
      result.push(Object.freeze({ id, name, password: row.supports_password }));
    }
    return Object.freeze(result);
  } catch { return []; }
}

export function signInMethods(discovery: HostDiscovery): readonly SignInMethod[] {
  if (!discovery.authRequired) return Object.freeze(discovery.loopback ? ['automatic', 'token'] as const : ['token'] as const);
  const password = discovery.nativePkce && discovery.providers.some(provider => provider.password);
  return Object.freeze(password ? ['password', 'token'] as const : ['token'] as const);
}

// Try each candidate; fall back only when the address could not be reached.
export async function probe(http: AuthHttp, target: ProbeTarget, signal?: AbortSignal): Promise<HostDiscovery> {
  let last: HostProblemError | null = null;
  for (const entry of probeCandidates(target)) {
    try { return await discover(http, entry, signal); } catch (error) {
      if (!(error instanceof HostProblemError)) throw error;
      if (error.problem !== 'unreachable' && error.problem !== 'tls') throw error;
      last = error;
    }
  }
  throw last ?? new HostProblemError('unreachable');
}

// Hermes' inert bootstrap page. Never executed, never followed: plain text
// matching, exactly one token assignment and exactly one "sign-in off" flag.
const SCRIPTS = /<script\b[^>]*>([\s\S]*?)<\/script\s*>/giu;
const ASSIGNMENT = /(?:^|;)\s*window\.__HERMES_SESSION_TOKEN__\s*=\s*("(?:[^"\\]|\\.)*")\s*;/gu;
const MODE = /(?:^|;)\s*window\.__HERMES_AUTH_REQUIRED__\s*=\s*(true|false)\s*;/gu;
export function scrapeDashboardToken(html: string): string {
  if (typeof html !== 'string' || html.length > 1024 * 1024 || (html.match(/<script/giu)?.length ?? 0) > 256) return fail('invalidResponse');
  const tokens: unknown[] = [], modes: string[] = [];
  for (const script of html.matchAll(SCRIPTS)) {
    const body = script[1] ?? '';
    for (const match of body.matchAll(ASSIGNMENT)) {
      try { tokens.push(JSON.parse(match[1] ?? '')); } catch { return fail('invalidResponse'); }
    }
    for (const match of body.matchAll(MODE)) modes.push(match[1] ?? '');
  }
  if (modes.length === 1 && modes[0] === 'true') return fail('modeChanged');
  if (modes.length !== 1 || modes[0] !== 'false' || tokens.length > 1) return fail('unsupported');
  if (tokens.length === 0) return fail('tokenWithheld');
  const token = tokens[0];
  if (!validToken(token)) return fail('invalidResponse');
  return token;
}
export async function readDashboardToken(http: AuthHttp, origin: string, signal?: AbortSignal): Promise<string> {
  let response: AuthHttpResponse;
  try { response = await call(http, origin, '/', { accept: 'html', maxBytes: 1024 * 1024, ...(signal ? { signal } : {}) }); }
  catch (error) { return transportProblem(error); }
  if (response.status < 200 || response.status >= 300) {
    const problem = statusProblem(response);
    return fail(problem === 'serverUnavailable' || problem === 'loginPage' || problem === 'proxyPassword' ? problem : 'unsupported');
  }
  if (response.contentType !== 'text/html' || response.text === null) return fail('unsupported');
  return scrapeDashboardToken(response.text);
}

function base64url(bytes: Uint8Array): string { return Buffer.from(bytes).toString('base64url'); }
// Never listened on: Hermes only checks it is a canonical loopback URL. The code
// comes back in JSON and is redeemed here, so no browser or listener is involved.
export const PASSWORD_CALLBACK = 'http://127.0.0.1:49152/loopdy-native-callback';
const COOKIE_VALUE = /^[A-Za-z0-9_=-]{1,8192}$/u;
// The single PKCE cookie set by /auth/native/authorize, checked like a browser would
// for this exact origin. Returns "name=value" for one request; never stored.
export function pkceCookie(setCookie: readonly string[], origin: string, now: number): string {
  const url = new URL(origin), secure = url.protocol === 'https:';
  const name = secure ? '__Host-hermes_session_pkce' : 'hermes_session_pkce';
  const matches = setCookie.filter(line => line.split(';')[0]?.split('=')[0]?.trim() === name);
  if (matches.length !== 1) return fail('invalidResponse');
  const [pair = '', ...attributes] = (matches[0] ?? '').split(';');
  const value = pair.slice(pair.indexOf('=') + 1).trim();
  const attrs = new Map<string, string>();
  for (const attribute of attributes) {
    const index = attribute.indexOf('=');
    const key = (index === -1 ? attribute : attribute.slice(0, index)).trim().toLowerCase();
    if (attrs.has(key)) return fail('invalidResponse');
    attrs.set(key, index === -1 ? '' : attribute.slice(index + 1).trim());
  }
  const domain = attrs.get('domain');
  const host = url.hostname.replace(/^\[|\]$/gu, '').toLowerCase();
  if (domain !== undefined && domain.replace(/^\./u, '').toLowerCase() !== host) return fail('invalidResponse');
  if (attrs.get('path') !== '/' || (secure && !attrs.has('secure')) || !COOKIE_VALUE.test(value)) return fail('invalidResponse');
  const maxAge = attrs.get('max-age'), expires = attrs.get('expires');
  const alive = maxAge !== undefined ? /^\d+$/u.test(maxAge) && Number(maxAge) > 0
    : expires !== undefined && Date.parse(expires) > now;
  if (!alive) return fail('invalidResponse');
  return `${name}=${value}`;
}

function parseBearer(response: AuthHttpResponse, now: number): BearerCredential {
  const body = object(response);
  if (!body || body.token_type !== 'Bearer' || !validToken(body.access_token)) return fail('invalidResponse');
  const provider = printable(body.provider, 256), userId = printable(body.user_id, 1024);
  const refresh = body.refresh_token === undefined || body.refresh_token === null || body.refresh_token === '' ? null : body.refresh_token;
  if (!provider || !userId || (refresh !== null && !validToken(refresh))
    || typeof body.expires_at !== 'number' || !Number.isFinite(body.expires_at) || body.expires_at * 1000 <= now) return fail('invalidResponse');
  return Object.freeze({ kind: 'bearer', accessToken: body.access_token, refreshToken: refresh, expiresAt: body.expires_at, provider, userId });
}

// Native password sign-in: authorize → PKCE cookie → password-login → one-time
// code → token exchange → identity check. The password is used for one request.
export async function passwordSignIn(http: AuthHttp, origin: string,
  input: Readonly<{ provider: string; username: string; password: string }>, now: () => number, signal?: AbortSignal): Promise<BearerCredential> {
  if (!input.username || input.username.length > 1024 || !input.password || input.password.length > 16384) return fail('invalidCredentials');
  const verifier = base64url(randomBytes(32)), state = base64url(randomBytes(32));
  const challenge = base64url(createHash('sha256').update(verifier, 'ascii').digest());
  const query = new URLSearchParams({ provider: input.provider, code_challenge: challenge, code_challenge_method: 'S256',
    redirect_uri: PASSWORD_CALLBACK, state }).toString();
  const options = signal ? { signal } : {};
  let authorize: AuthHttpResponse;
  try { authorize = await call(http, origin, `/auth/native/authorize?${query}`, { accept: 'html', ...options }); }
  catch (error) { return transportProblem(error); }
  if (authorize.status !== 302) return fail(authorize.status >= 300 && authorize.status < 400 ? 'redirectRefused' : statusProblem(authorize));
  let target: string;
  try { target = new URL(authorize.location ?? '', `${origin}/auth/native/authorize`).href; } catch { return fail('redirectRefused'); }
  if (target !== `${origin}/login`) return fail('redirectRefused');
  const cookie = pkceCookie(authorize.setCookie, origin, now());
  let login: AuthHttpResponse;
  try {
    login = await call(http, origin, '/auth/password-login', { method: 'POST', accept: 'json', headers: { Cookie: cookie },
      json: { provider: input.provider, username: input.username, password: input.password, next: '' }, ...options });
  } catch (error) { return transportProblem(error); }
  if (login.status === 401 && !login.challenged) return fail('invalidCredentials');
  if (login.status === 400) return fail('exchangeRefused');
  if (login.status < 200 || login.status >= 300) return fail(statusProblem(login));
  const body = object(login);
  if (!body || body.ok !== true || typeof body.next !== 'string') return fail('invalidResponse');
  let next: URL;
  try { next = new URL(body.next); } catch { return fail('redirectRefused'); }
  const params = [...next.searchParams];
  const code = next.searchParams.get('code');
  if (params.length !== 2 || next.searchParams.getAll('state').length !== 1 || next.searchParams.getAll('code').length !== 1
    || next.searchParams.get('state') !== state || !code || code.length > 4096) return fail('invalidResponse');
  next.search = '';
  if (next.hash || next.href !== PASSWORD_CALLBACK) return fail('redirectRefused');
  return redeem(http, origin, code, verifier, input.provider, now, signal);
}
// The one-time code is sent once. A lost answer means start again, never resend.
async function redeem(http: AuthHttp, origin: string, code: string, verifier: string, provider: string,
  now: () => number, signal?: AbortSignal): Promise<BearerCredential> {
  let response: AuthHttpResponse;
  try { response = await call(http, origin, '/auth/native/token', { method: 'POST', accept: 'json', json: { code, code_verifier: verifier }, ...(signal ? { signal } : {}) }); }
  catch { return fail('exchangeUncertain'); }
  if (response.status === 400) return fail('exchangeRefused');
  if (response.status < 200 || response.status >= 300) return fail(statusProblem(response));
  let credential: BearerCredential;
  try { credential = parseBearer(response, now()); } catch { return fail('exchangeUncertain'); }
  if (credential.provider !== provider) return fail('identityChanged');
  const identity = await fetchIdentity(http, origin, credential, signal);
  if (!identity || identity.provider !== credential.provider || identity.userId !== credential.userId) return fail('identityChanged');
  return credential;
}

export type HostIdentity = Readonly<{ provider: string; userId: string; expiresAt: number | null }>;
// GET /api/auth/me with this credential. 'expired' means Hermes turned it away.
// Null when a loopback Hermes predates the dashboard identity route.
export async function fetchIdentity(http: AuthHttp, origin: string, credential: HostCredential, signal?: AbortSignal): Promise<HostIdentity | null> {
  const headers = credential.kind === 'bearer' ? { Authorization: `Bearer ${credential.accessToken}` } : { 'X-Hermes-Session-Token': credential.token };
  let response: AuthHttpResponse;
  try { response = await call(http, origin, '/api/auth/me', { accept: 'json', headers, ...(signal ? { signal } : {}) }); }
  catch (error) { return transportProblem(error); }
  if (response.status === 401 && !response.challenged) return fail('expired');
  if (response.status === 404 && credential.kind === 'dashboard') return null;
  if (response.status < 200 || response.status >= 300) return fail(statusProblem(response));
  const body = object(response);
  const provider = printable(body?.provider, 256), userId = printable(body?.user_id, 1024);
  if (!body || !provider || !userId) return fail('invalidResponse');
  const expiresAt = typeof body.expires_at === 'number' && Number.isFinite(body.expires_at) && body.expires_at > 0 ? body.expires_at : null;
  return Object.freeze({ provider, userId, expiresAt });
}

export type RefreshOutcome =
  | Readonly<{ kind: 'renewed'; credential: BearerCredential }>
  | Readonly<{ kind: 'expired' }>
  // Nothing was renewed and the old refresh token still works.
  | Readonly<{ kind: 'unchanged' }>
  // Hermes may have rotated it; the answer was lost.
  | Readonly<{ kind: 'uncertain' }>;
export async function requestRefresh(http: AuthHttp, origin: string, refreshToken: string, provider: string,
  now: () => number, signal?: AbortSignal): Promise<RefreshOutcome> {
  let response: AuthHttpResponse;
  try {
    response = await call(http, origin, '/auth/native/refresh', { method: 'POST', accept: 'json',
      json: { refresh_token: refreshToken, provider }, ...(signal ? { signal } : {}) });
  } catch (error) { return { kind: error instanceof AuthHttpError && error.sent === 'no' ? 'unchanged' : 'uncertain' }; }
  if (response.status === 401 && !response.challenged) return { kind: 'expired' };
  if (response.status === 503) return { kind: 'unchanged' };
  if (response.status < 200 || response.status >= 300) return { kind: 'uncertain' };
  try { return { kind: 'renewed', credential: parseBearer(response, now()) }; } catch { return { kind: 'uncertain' }; }
}
