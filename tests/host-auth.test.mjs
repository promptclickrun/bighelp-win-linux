import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { HERMES_DEFAULT_PORT, HOST_PROBLEM_TEXT, PASSWORD_CALLBACK, discover, passwordSignIn, pkceCookie, probe, probeCandidates,
  readDashboardToken, scrapeDashboardToken, signInMethods } from '../packages/hermes-client/host-auth.ts';
import { AuthHttpError } from '../packages/platform/auth-http.ts';

// Shapes copied from Hermes 0.22.1 (hermes_cli/web_routers/status.py, dashboard_auth/routes.py,
// web_server_dashboard.py). Tokens and names are synthetic.
const TOKEN = 'synthetic-dashboard-token_0123456789abcdefghijklmnopqrstu';
const ungated = { version: '0.22.1', release_date: '2026.9.24', gateway_running: false, active_sessions: 0, auth_required: false,
  auth_providers: [], auth_flows: [], install_id: 'synthetic', profiles: ['default'], overall: 'degraded' };
const gated = { ...ungated, auth_required: true, auth_providers: ['basic'], auth_flows: ['cookie', 'native_pkce'] };
const servePage = `<!doctype html><html><head><script>window.__HERMES_SESSION_TOKEN__=${JSON.stringify(TOKEN)};window.__HERMES_AUTH_REQUIRED__=false;</script></head><body>Headless backend (hermes serve): web UI disabled.</body></html>`;
const reply = (status, body, extra = {}) => Object.freeze({ status, contentType: typeof body === 'string' ? 'text/html' : 'application/json',
  text: body === null ? '' : typeof body === 'string' ? body : JSON.stringify(body), location: null, setCookie: [], challenged: false, ...extra });
function host(routes) {
  const requests = [];
  const http = async request => {
    const url = new URL(request.url);
    requests.push({ ...request, path: url.pathname, query: url.searchParams, json: request.body ? JSON.parse(request.body) : undefined });
    const route = routes[`${request.method} ${url.pathname}`];
    if (!route) return reply(404, { detail: 'Not Found' });
    return route(requests.at(-1));
  };
  return { http, requests };
}
const problem = name => error => error?.problem === name && error.message === HOST_PROBLEM_TEXT[name];
const now = () => Date.parse('2026-10-16T12:00:00Z');

test('address candidates: this computer, typed schemes, private literals and plain-http DNS refusal', () => {
  assert.equal(HERMES_DEFAULT_PORT, 9119);
  assert.deepEqual(probeCandidates({ kind: 'thisComputer', port: 9119 }), [{ origin: 'http://127.0.0.1:9119', plainHttp: true, loopback: true }]);
  assert.deepEqual(probeCandidates({ kind: 'address', address: '192.168.1.20:9119' }).map(c => c.origin), ['https://192.168.1.20:9119', 'http://192.168.1.20:9119']);
  assert.deepEqual(probeCandidates({ kind: 'address', address: 'localhost:9119' }).map(c => c.origin), ['https://127.0.0.1:9119', 'http://127.0.0.1:9119']);
  assert.deepEqual(probeCandidates({ kind: 'address', address: 'studio.local:9119' }).map(c => c.origin), ['https://studio.local:9119']);
  assert.deepEqual(probeCandidates({ kind: 'address', address: 'https://Hermes.Example.com/' }).map(c => c.origin), ['https://hermes.example.com']);
  assert.deepEqual(probeCandidates({ kind: 'address', address: 'http://100.101.102.103:9119' }), [{ origin: 'http://100.101.102.103:9119', plainHttp: true, loopback: false }]);
  assert.deepEqual(probeCandidates({ kind: 'address', address: '::1' }).map(c => c.origin), ['https://[::1]', 'http://[::1]']);
  assert.throws(() => probeCandidates({ kind: 'address', address: 'http://studio.local:9119' }), problem('plainHttpName'));
  assert.match(HOST_PROBLEM_TEXT.plainHttpName, /use the computer's IP address \(like 192\.168\.1\.20\), or use an https address/);
  assert.throws(() => probeCandidates({ kind: 'address', address: 'https://hermes.example.com/hermes' }), problem('pathNotSupported'));
  for (const address of ['', 'ftp://host', 'user@host', 'a b', 'host?x=1', 'http://8.8.8.8:80%2f', '127.1', 'https://host#x', ' host'])
    assert.throws(() => probeCandidates({ kind: 'address', address }), error => !!error?.problem, address);
  for (const port of [0, 65536, 1.5]) assert.throws(() => probeCandidates({ kind: 'thisComputer', port }), problem('invalidAddress'));
});

test('discovery is credential-free, strict about auth_required and reads the sign-in methods', async () => {
  const local = host({ 'GET /api/status': () => reply(200, ungated) });
  const found = await discover(local.http, { origin: 'http://127.0.0.1:9119', plainHttp: true, loopback: true });
  assert.equal(found.authRequired, false); assert.equal(found.version, '0.22.1');
  assert.deepEqual(signInMethods(found), ['automatic', 'token']);
  const headers = local.requests[0].headers;
  assert.deepEqual(Object.keys(headers).sort(), ['Accept', 'Cache-Control']);
  const remote = host({ 'GET /api/status': () => reply(200, gated),
    'GET /api/auth/providers': () => reply(200, { providers: [{ name: 'basic', display_name: 'Username & Password', supports_password: true }] }) });
  const signedIn = await discover(remote.http, { origin: 'https://studio.example', plainHttp: false, loopback: false });
  assert.deepEqual(signInMethods(signedIn), ['password', 'token']);
  assert.deepEqual(signedIn.providers, [{ id: 'basic', name: 'Username & Password', password: true }]);
  // A provider list failure never removes token sign-in; it only hides passwords.
  const failing = host({ 'GET /api/status': () => reply(200, gated), 'GET /api/auth/providers': () => reply(503, { detail: 'no auth providers registered' }) });
  assert.deepEqual(signInMethods(await discover(failing.http, { origin: 'https://studio.example', plainHttp: false, loopback: false })), ['token']);
  // A remote ungated answer never offers "no sign-in".
  assert.deepEqual(signInMethods(await discover(local.http, { origin: 'http://192.168.1.20:9119', plainHttp: true, loopback: false })), ['token']);
});

test('discovery maps gates, pages and failures to plain problems', async () => {
  const target = { origin: 'https://studio.example', plainHttp: false, loopback: false };
  const cases = [
    [reply(302, null, { location: 'https://login.example/' }), 'loginPage'],
    [reply(401, null, { challenged: true }), 'proxyPassword'],
    [reply(403, null), 'blocked'],
    [reply(400, { detail: 'Invalid Host header. Dashboard requests must use the bound hostname or the configured public hostname.' }), 'hostNameRefused'],
    [reply(200, '<html>Sign in</html>'), 'webPage'],
    [reply(404, { detail: 'Not Found' }), 'notHermes'],
    [reply(200, { auth_required: 'no' }), 'notHermes'],
    [reply(200, { auth_required: true, auth_flows: ['native_pkce', 'native_pkce'] }), 'invalidResponse'],
    [reply(502, null), 'serverUnavailable'],
  ];
  for (const [response, name] of cases) await assert.rejects(discover(async () => response, target), problem(name), name);
  await assert.rejects(discover(async () => { throw new AuthHttpError('no'); }, target), problem('unreachable'));
  await assert.rejects(discover(async () => { throw new AuthHttpError('no', true); }, target), problem('tls'));
  // A bare private literal falls back from HTTPS to plain HTTP only when HTTPS cannot be reached.
  const tried = [];
  const found = await probe(async request => { tried.push(request.url); if (request.url.startsWith('https:')) throw new AuthHttpError('no', true); return reply(200, ungated); },
    { kind: 'address', address: '192.168.1.20:9119' });
  assert.deepEqual(tried, ['https://192.168.1.20:9119/api/status', 'http://192.168.1.20:9119/api/status']);
  assert.equal(found.origin, 'http://192.168.1.20:9119'); assert.equal(found.plainHttp, true);
  await assert.rejects(probe(async () => reply(302, null), { kind: 'address', address: '192.168.1.20:9119' }), problem('loginPage'));
});

test('dashboard bootstrap accepts exactly one inert token on a sign-in-off page', async () => {
  assert.equal(scrapeDashboardToken(servePage), TOKEN);
  const spa = `<html><head><style>x</style><script type="module" src="/assets/app.js"></script><script>window.__HERMES_SESSION_TOKEN__="${TOKEN}";window.__HERMES_DASHBOARD_EMBEDDED_CHAT__=false;window.__HERMES_BASE_PATH__="";window.__HERMES_AUTH_REQUIRED__=false;window.__HERMES_INITIAL_PROFILE__="";</script></head><body></body></html>`;
  assert.equal(scrapeDashboardToken(spa), TOKEN);
  const twoTokens = servePage.replace('</script>', `</script><script>window.__HERMES_SESSION_TOKEN__="other-token";</script>`);
  assert.throws(() => scrapeDashboardToken(twoTokens), problem('unsupported'));
  assert.throws(() => scrapeDashboardToken(servePage.replace('__HERMES_AUTH_REQUIRED__=false', '__HERMES_AUTH_REQUIRED__=true')), problem('modeChanged'));
  assert.throws(() => scrapeDashboardToken(servePage.replace('window.__HERMES_AUTH_REQUIRED__=false;', '')), problem('unsupported'));
  assert.throws(() => scrapeDashboardToken(servePage + '<script>window.__HERMES_AUTH_REQUIRED__=false;</script>'), problem('unsupported'));
  // The gateway listener withholds the token; text outside a script is never read.
  const withheld = `<html><script>window.__HERMES_AUTH_REQUIRED__=false;</script><body>window.__HERMES_SESSION_TOKEN__="${TOKEN}";</body></html>`;
  assert.throws(() => scrapeDashboardToken(withheld), problem('tokenWithheld'));
  assert.throws(() => scrapeDashboardToken(servePage.replace(JSON.stringify(TOKEN), '"has space"')), problem('invalidResponse'));
  assert.throws(() => scrapeDashboardToken('<script>'.repeat(300)), problem('invalidResponse'));
  assert.throws(() => scrapeDashboardToken(servePage + ' '.repeat(1024 * 1024)), problem('invalidResponse'));
  const origin = 'http://127.0.0.1:9119';
  assert.equal(await readDashboardToken(async request => { assert.equal(request.headers.Accept, 'text/html'); return reply(200, servePage); }, origin), TOKEN);
  await assert.rejects(readDashboardToken(async () => reply(200, { token: TOKEN }), origin), problem('unsupported'));
  await assert.rejects(readDashboardToken(async () => reply(302, null, { location: '/login' }), origin), problem('loginPage'));
  await assert.rejects(readDashboardToken(async () => reply(404, { error: 'Headless backend' }), origin), problem('unsupported'));
});

// A synthetic Hermes that follows the native password flow (routes.py:289-335, 439-493, 569-586).
function passwordHost(options = {}) {
  const origin = options.origin ?? 'http://192.168.1.20:9119';
  const secure = origin.startsWith('https:');
  let challenge, state, codes = 0;
  const routes = {
    'GET /auth/native/authorize': request => {
      challenge = request.query.get('code_challenge'); state = request.query.get('state');
      assert.equal(request.query.get('code_challenge_method'), 'S256'); assert.equal(request.query.get('redirect_uri'), PASSWORD_CALLBACK);
      assert.equal(request.query.get('provider'), 'basic'); assert.equal(request.headers.Cookie, undefined);
      const name = secure ? '__Host-hermes_session_pkce' : 'hermes_session_pkce';
      return reply(302, '', { location: options.location ?? '/login', setCookie: options.cookies ?? [
        `${name}=eyJicm9rZXIiOiJ4In0; expires=Fri, 16 Oct 2026 12:10:00 GMT; HttpOnly; Max-Age=600; Path=/; SameSite=lax${secure ? '; Secure' : ''}`] });
    },
    'POST /auth/password-login': request => {
      if (options.loginStatus) return reply(options.loginStatus, { detail: 'Refused' });
      assert.match(request.headers.Cookie, /^(?:__Host-)?hermes_session_pkce=eyJicm9rZXIiOiJ4In0$/u);
      assert.deepEqual(request.json, { provider: 'basic', username: 'alice', password: 'correct horse', next: '' });
      const next = options.next?.(state) ?? `${PASSWORD_CALLBACK}?code=gw-code&state=${encodeURIComponent(state)}`;
      return reply(200, { ok: true, next });
    },
    'POST /auth/native/token': request => {
      codes++;
      if (options.lostExchange) throw new AuthHttpError('maybe');
      const expected = createHash('sha256').update(request.json.code_verifier, 'ascii').digest('base64url');
      assert.equal(expected, challenge); assert.equal(request.json.code, 'gw-code');
      return reply(200, { access_token: 'synthetic-access', refresh_token: 'synthetic-refresh', token_type: 'Bearer',
        expires_at: Math.floor(now() / 1000) + 43200, provider: 'basic', user_id: 'alice' });
    },
    'GET /api/auth/me': request => {
      assert.equal(request.headers.Authorization, 'Bearer synthetic-access');
      return reply(200, { user_id: options.meUser ?? 'alice', email: '', display_name: 'Alice', org_id: '', provider: 'basic', expires_at: 0 });
    },
  };
  const fake = host(routes);
  return { ...fake, origin, get codes() { return codes; } };
}
const login = { provider: 'basic', username: 'alice', password: 'correct horse' };

test('password sign-in runs authorize, password, one code exchange and the identity check', async () => {
  for (const origin of ['http://192.168.1.20:9119', 'https://studio.example']) {
    const fake = passwordHost({ origin });
    const credential = await passwordSignIn(fake.http, origin, login, now);
    assert.deepEqual(credential, { kind: 'bearer', accessToken: 'synthetic-access', refreshToken: 'synthetic-refresh',
      expiresAt: Math.floor(now() / 1000) + 43200, provider: 'basic', userId: 'alice' });
    assert.deepEqual(fake.requests.map(request => `${request.method} ${request.path}`),
      ['GET /auth/native/authorize', 'POST /auth/password-login', 'POST /auth/native/token', 'GET /api/auth/me']);
    // Only the password-login request carries the password; nothing else carries a cookie.
    assert.equal(fake.requests.filter(request => request.body?.includes('correct horse')).length, 1);
    assert.equal(fake.requests.filter(request => request.headers.Cookie).length, 1);
  }
});

test('password sign-in fails closed on redirects, cookies, callbacks, refusals and identity', async () => {
  const origin = 'http://192.168.1.20:9119';
  const cases = [
    [{ location: 'https://evil.example/login' }, 'redirectRefused'],
    [{ cookies: [] }, 'invalidResponse'],
    [{ cookies: ['hermes_session_pkce=a; Max-Age=600; Path=/', 'hermes_session_pkce=b; Max-Age=600; Path=/'] }, 'invalidResponse'],
    [{ cookies: ['hermes_session_pkce=a; Max-Age=600; Path=/; Domain=evil.example'] }, 'invalidResponse'],
    [{ cookies: ['hermes_session_pkce=a; Max-Age=0; Path=/'] }, 'invalidResponse'],
    [{ cookies: ['hermes_session_pkce=a b; Max-Age=600; Path=/'] }, 'invalidResponse'],
    [{ next: state => `${PASSWORD_CALLBACK}?code=gw-code&state=${encodeURIComponent(state)}&extra=1` }, 'invalidResponse'],
    [{ next: () => `${PASSWORD_CALLBACK}?code=gw-code&state=wrong` }, 'invalidResponse'],
    [{ next: state => `http://127.0.0.1:49153/loopdy-native-callback?code=gw-code&state=${encodeURIComponent(state)}` }, 'redirectRefused'],
    [{ loginStatus: 401 }, 'invalidCredentials'],
    [{ loginStatus: 404 }, 'unsupported'],
    [{ loginStatus: 429 }, 'rateLimited'],
    [{ loginStatus: 503 }, 'serverUnavailable'],
    [{ meUser: 'mallory' }, 'identityChanged'],
  ];
  for (const [options, name] of cases) {
    const fake = passwordHost({ ...options, origin });
    await assert.rejects(passwordSignIn(fake.http, origin, login, now), problem(name), name);
  }
  // HTTPS requires the __Host- cookie with Secure; the bare name is refused there.
  const https = passwordHost({ origin: 'https://studio.example', cookies: ['hermes_session_pkce=a; Max-Age=600; Path=/'] });
  await assert.rejects(passwordSignIn(https.http, 'https://studio.example', login, now), problem('invalidResponse'));
  // A lost code-exchange answer is never retried: the code is single use.
  const lost = passwordHost({ lostExchange: true, origin });
  await assert.rejects(passwordSignIn(lost.http, origin, login, now), problem('exchangeUncertain'));
  assert.equal(lost.codes, 1);
});

test('the PKCE cookie is checked like a browser would for this exact origin', () => {
  const at = now();
  assert.equal(pkceCookie(['hermes_session_pkce=abc_-=; Max-Age=600; Path=/; HttpOnly'], 'http://127.0.0.1:9119', at), 'hermes_session_pkce=abc_-=');
  assert.equal(pkceCookie(['hermes_session_pkce=abc; Path=/; Domain=127.0.0.1; Expires=Fri, 16 Oct 2026 12:05:00 GMT'], 'http://127.0.0.1:9119', at), 'hermes_session_pkce=abc');
  for (const line of ['hermes_session_pkce=abc; Max-Age=600', 'hermes_session_pkce=abc; Path=/', 'hermes_session_pkce=abc; Path=/x; Max-Age=600',
    'hermes_session_pkce=abc; Path=/; Expires=Fri, 16 Oct 2026 11:00:00 GMT', 'hermes_session_pkce=abc; Path=/; Path=/; Max-Age=600'])
    assert.throws(() => pkceCookie([line], 'http://127.0.0.1:9119', at), problem('invalidResponse'), line);
  assert.throws(() => pkceCookie(['__Host-hermes_session_pkce=abc; Path=/; Max-Age=600'], 'https://studio.example', at), problem('invalidResponse'));
});
