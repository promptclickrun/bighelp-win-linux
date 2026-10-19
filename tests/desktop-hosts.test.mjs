import test from 'node:test';
import assert from 'node:assert/strict';
import { createDesktopService } from '../apps/desktop/src/main/desktop-service.ts';
import { PASSWORD_CALLBACK } from '../packages/hermes-client/host-auth.ts';
import { AuthHttpError } from '../packages/platform/auth-http.ts';
import { parseDesktopAction } from '../apps/desktop/src/shared/desktop-api.ts';

const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(check) { for (let i = 0; i < 200; i++) { if (check()) return; await tick(); } assert.fail('Condition did not settle'); }
const json = (status, body) => ({ status, contentType: 'application/json', text: JSON.stringify(body), location: null, setCookie: [], challenged: false });
const html = text => ({ status: 200, contentType: 'text/html', text, location: null, setCookie: [], challenged: false });
const status = { version: '0.22.1', auth_required: false, auth_providers: [], auth_flows: [], gateway_running: false };
const now = Date.parse('2026-10-16T12:00:00Z');

// A synthetic Hermes reached only through main's credential-free/sign-in adapter.
function hermes() {
  const state = { token: 'local-token-1', gated: false, requests: [] };
  state.http = async request => {
    const url = new URL(request.url);
    if (url.protocol === 'https:') throw new AuthHttpError('no', true); // a plain-http Hermes
    state.requests.push({ url: request.url, path: url.pathname, headers: request.headers, body: request.body });
    if (url.pathname === '/api/status') return json(200, state.gated ? { ...status, auth_required: true, auth_providers: ['basic'], auth_flows: ['cookie', 'native_pkce'] } : status);
    if (url.pathname === '/api/auth/providers') return json(200, { providers: [{ name: 'basic', display_name: 'Username & Password', supports_password: true }] });
    if (url.pathname === '/') return html(`<script>window.__HERMES_SESSION_TOKEN__="${state.token}";window.__HERMES_AUTH_REQUIRED__=false;</script>`);
    if (url.pathname === '/auth/native/authorize') {
      state.pkce = url.searchParams.get('state');
      return { ...json(302, {}), text: '', location: '/login', setCookie: ['hermes_session_pkce=synthetic; Max-Age=600; Path=/; HttpOnly'] };
    }
    if (url.pathname === '/auth/password-login') return JSON.parse(request.body).password === 'correct horse'
      ? json(200, { ok: true, next: `${PASSWORD_CALLBACK}?code=gw&state=${encodeURIComponent(state.pkce)}` }) : json(401, { detail: 'Invalid credentials' });
    if (url.pathname === '/auth/native/token') return json(200, { access_token: 'access-1', refresh_token: 'refresh-1', token_type: 'Bearer',
      expires_at: Math.floor(now / 1000) + 43200, provider: 'basic', user_id: 'alice' });
    if (url.pathname === '/api/auth/me') {
      if (request.headers.Authorization === 'Bearer access-1') return json(200, { user_id: 'alice', provider: 'basic', expires_at: 0 });
      if (request.headers['X-Hermes-Session-Token'] === state.token) return json(200, { user_id: 'local', provider: 'loopback', expires_at: 0 });
      return json(401, { detail: 'Unauthorized' });
    }
    return json(404, { detail: 'Not Found' });
  };
  return state;
}
function fixture(options = {}) {
  const values = options.values ?? new Map(), calls = [], host = options.host ?? hermes();
  let callbacks, identityUser = 'alice';
  const repository = { async read(key) { return structuredClone(values.get(key) ?? null); },
    async write(key, revision, value) { assert.equal(values.get(key)?.revision ?? null, revision, key);
      const next = { revision: (revision ?? 0) + 1, value: structuredClone(value) }; values.set(key, next); calls.push(['write', key]); return next; },
    async remove(key, revision) { assert.equal(values.get(key)?.revision ?? null, revision, key); values.delete(key); calls.push(['remove', key]); } };
  const gateway = { exclusiveSubmit: true, close() { calls.push(['close']); },
    async requestHttp(op) { return { body: op.kind === 'identity' ? { provider: 'basic', user_id: identityUser } : { ok: true, auth_required: false } }; },
    async operation(op) { if (op.kind === 'profilesList') return { profiles: [{ name: 'agent', display_name: 'Agent' }] };
      if (op.kind === 'sessionList') return { sessions: [{ id: 'stored', profile: 'agent', title: 'Saved chat' }] };
      if (op.kind === 'sessionResume') return { session_id: 'runtime', stored_session_id: 'stored', info: { profile_name: 'agent' }, running: false };
      if (op.kind === 'sessionHistory') return { count: 1, messages: [{ row_id: 1, role: 'user', text: 'Saved words' }] }; return {}; },
    async submitText() { calls.push(['submit']); return {}; } };
  const timers = { pending: [], set(callback) { this.pending.push(callback); return this.pending.length; }, clear() { this.pending.length = 0; } };
  const service = createDesktopService({ repository, hostHttp: host.http, timers, now: () => now, onChange() {},
    connect: async config => { calls.push(['connect', config.configuration]); callbacks = config; return gateway; } });
  return { service, values, calls, host, timers, get callbacks() { return callbacks; }, set identityUser(value) { identityUser = value; } };
}
const secretsIn = (f, value) => JSON.stringify(f.service.snapshot()).includes(value);

test('"This computer" probes without credentials, then connects with the re-read session token', async () => {
  const f = fixture();
  const probed = await f.service.handle({ kind: 'probeHost', target: { kind: 'thisComputer', port: 9119 } });
  assert.equal(probed.ok, true);
  const setup = probed.snapshot.hosts.setup;
  assert.deepEqual({ ...setup, probeId: 'id' }, { probeId: 'id', thisComputer: true, plainHttp: true, version: '0.22.1', signInRequired: false,
    methods: ['automatic', 'token'], providers: [], replacing: false });
  assert.equal(f.host.requests.some(request => request.headers.Authorization || request.headers['X-Hermes-Session-Token'] || request.headers.Cookie), false);
  const signedIn = await f.service.handle({ kind: 'signIn', probeId: setup.probeId, label: 'This computer', method: 'automatic' });
  assert.equal(signedIn.ok, true);
  const s = f.service.snapshot();
  assert.equal(s.status, 'connected'); assert.equal(s.hosts.setup, null);
  assert.deepEqual(s.hosts.saved, { label: 'This computer', thisComputer: true, signIn: 'automatic', account: null, plainHttp: true, version: '0.22.1' });
  const connect = f.calls.find(call => call[0] === 'connect')[1];
  assert.deepEqual(connect, { endpoint: 'http://127.0.0.1:9119', approvedPrivateHttpOrigin: 'http://127.0.0.1:9119',
    authentication: { kind: 'dashboard', token: 'local-token-1' }, proxy: {} });
  assert.equal(typeof f.callbacks.credential.renew, 'function');
  assert.deepEqual(f.values.get('desktop:credential').value, { version: 1, origin: 'http://127.0.0.1:9119',
    credential: { kind: 'dashboard', token: 'local-token-1', automatic: true } });
  assert.deepEqual(f.values.get('desktop:host').value, { version: 2, label: 'This computer', origin: 'http://127.0.0.1:9119', plainHttp: true, method: 'automatic' });
  assert.equal(secretsIn(f, 'local-token-1') || secretsIn(f, '127.0.0.1'), false);
  // Hermes restarted with a new token: the reconnect re-reads it and stores it first.
  f.host.token = 'local-token-2';
  f.callbacks.onClosed(); f.timers.pending.shift()();
  await until(() => f.service.snapshot().status === 'connected');
  const order = f.calls.map(call => call[0] === 'connect' ? `connect:${call[1].authentication.token}` : call.join(':'));
  const stored = order.lastIndexOf('write:desktop:credential'), used = order.indexOf('connect:local-token-2');
  assert.ok(stored !== -1 && used > stored, order.join(' '));
  assert.equal(f.values.get('desktop:credential').value.credential.token, 'local-token-2');
  f.service.dispose();
});

test('username and password sign-in keeps only renewable tokens in main and never shows them', async () => {
  const f = fixture(); f.host.gated = true;
  const probed = await f.service.handle({ kind: 'probeHost', target: { kind: 'address', address: '192.168.1.20:9119' } });
  assert.equal(probed.ok, true);
  const setup = probed.snapshot.hosts.setup;
  assert.deepEqual(setup.methods, ['password', 'token']); assert.deepEqual(setup.providers, [{ id: 'basic', name: 'Username & Password' }]);
  const wrong = await f.service.handle({ kind: 'signIn', probeId: setup.probeId, label: 'Studio PC', method: 'password', provider: '', username: 'alice', password: 'nope' });
  assert.deepEqual(wrong, { ok: false, message: "Hermes didn't accept that username and password." });
  assert.equal(f.service.snapshot().notice, '');
  const result = await f.service.handle({ kind: 'signIn', probeId: setup.probeId, label: 'Studio PC', method: 'password', provider: '', username: 'alice', password: 'correct horse' });
  assert.equal(result.ok, true);
  const s = f.service.snapshot();
  assert.equal(s.status, 'connected');
  assert.deepEqual(s.hosts.saved, { label: 'Studio PC', thisComputer: false, signIn: 'password', account: 'alice', plainHttp: true, version: '0.22.1' });
  assert.deepEqual(f.calls.find(call => call[0] === 'connect')[1].authentication, { kind: 'provider', token: 'access-1' });
  assert.deepEqual(f.values.get('desktop:credential').value.credential, { kind: 'bearer', accessToken: 'access-1', refreshToken: 'refresh-1',
    expiresAt: Math.floor(now / 1000) + 43200, provider: 'basic', userId: 'alice' });
  for (const secret of ['correct horse', 'access-1', 'refresh-1', 'synthetic', '192.168.1.20']) assert.equal(secretsIn(f, secret), false, secret);
  assert.equal(JSON.stringify([...f.values]).includes('correct horse'), false);
  // A different account at the same computer is refused and stops reconnecting.
  f.identityUser = 'mallory'; f.callbacks.onClosed(); f.timers.pending.shift()();
  await until(() => f.service.snapshot().hosts.reconnect.state === 'signIn');
  assert.equal(f.service.snapshot().status, 'disconnected');
  f.service.dispose();
});

test('a computer that turned sign-in on is refused without sending the old token', async () => {
  const f = fixture();
  const setup = (await f.service.handle({ kind: 'probeHost', target: { kind: 'thisComputer', port: 9119 } })).snapshot.hosts.setup;
  await f.service.handle({ kind: 'signIn', probeId: setup.probeId, label: 'This computer', method: 'automatic' });
  const before = f.host.requests.length, connects = f.calls.filter(call => call[0] === 'connect').length;
  f.host.gated = true; f.callbacks.onClosed(); f.timers.pending.shift()();
  await until(() => f.service.snapshot().hosts.reconnect.state === 'signIn');
  const later = f.host.requests.slice(before);
  assert.deepEqual(later.map(request => request.path), ['/api/status', '/api/auth/providers']);
  assert.equal(later.some(request => request.headers['X-Hermes-Session-Token'] || request.headers.Authorization), false);
  assert.equal(f.calls.filter(call => call[0] === 'connect').length, connects);
  assert.match(f.service.snapshot().notice, /Sign in again/);
  f.service.dispose();
});

test('rename keeps the sign-in; forget removes the sign-in, record and saved chat list', async () => {
  const f = fixture();
  const setup = (await f.service.handle({ kind: 'probeHost', target: { kind: 'thisComputer', port: 9119 } })).snapshot.hosts.setup;
  await f.service.handle({ kind: 'signIn', probeId: setup.probeId, label: 'This computer', method: 'automatic' });
  await f.service.handle({ kind: 'openChat', generation: f.service.snapshot().generation, chatId: 'stored' });
  await until(() => [...f.values.keys()].some(key => key.startsWith('display-cache:')) && f.values.has('desktop:cacheOwner'));
  assert.equal((await f.service.handle({ kind: 'renameHost', label: '  Studio PC  ' })).ok, true);
  assert.equal(f.service.snapshot().hosts.saved.label, 'Studio PC'); assert.equal(f.service.snapshot().data.host.label, 'Studio PC');
  assert.equal(f.values.get('desktop:host').value.label, 'Studio PC'); assert.equal(f.values.get('desktop:credential').value.credential.token, 'local-token-1');
  assert.equal((await f.service.handle({ kind: 'renameHost', label: '\n' })).ok, false);
  assert.equal((await f.service.handle({ kind: 'forgetHost' })).ok, true);
  const s = f.service.snapshot();
  assert.equal(s.status, 'disconnected'); assert.equal(s.hosts.saved, null); assert.equal(s.data.host, null); assert.deepEqual(s.data.chats, []);
  for (const key of ['desktop:credential', 'desktop:host', 'desktop:cacheOwner']) assert.equal(f.values.has(key), false, key);
  assert.equal([...f.values.keys()].some(key => key.startsWith('display-cache:')), false);
  assert.equal(f.values.get('desktop:autoConnect').value, false);
  assert.ok(f.calls.some(call => call[0] === 'close'));
  // Nothing comes back on the next start.
  const restarted = fixture({ values: f.values, host: f.host });
  await restarted.service.initialize();
  assert.equal(restarted.service.snapshot().hosts.saved, null); assert.equal(restarted.calls.some(call => call[0] === 'connect'), false);
  f.service.dispose(); restarted.service.dispose();
});

test('an earlier pasted-token record moves its token into the credential record on start', async () => {
  const values = new Map([
    ['desktop:host', { revision: 3, value: { label: 'Old computer', endpoint: 'http://127.0.0.1:9119', authentication: 'dashboard', token: 'local-token-1', allowPrivateHttp: true } }],
    ['desktop:autoConnect', { revision: 1, value: true }]]);
  const f = fixture({ values });
  await f.service.initialize();
  assert.equal(f.service.snapshot().status, 'connected');
  assert.deepEqual(values.get('desktop:host').value, { version: 2, label: 'Old computer', origin: 'http://127.0.0.1:9119', plainHttp: true, method: 'token' });
  assert.deepEqual(values.get('desktop:credential').value.credential, { kind: 'dashboard', token: 'local-token-1', automatic: false });
  assert.equal(f.service.snapshot().hosts.saved.signIn, 'sessionToken');
  f.service.dispose();
});

test('setup refuses stale probes and plain-http names in plain words, outside the chat notice', async () => {
  const f = fixture();
  const refused = await f.service.handle({ kind: 'probeHost', target: { kind: 'address', address: 'http://studio.local:9119' } });
  assert.deepEqual(refused, { ok: false, message: "For plain http, use the computer's IP address (like 192.168.1.20), or use an https address." });
  assert.equal(f.host.requests.length, 0); assert.equal(f.service.snapshot().notice, '');
  const stale = await f.service.handle({ kind: 'signIn', probeId: '00000000-0000-4000-8000-000000000000', label: 'x', method: 'automatic' });
  assert.equal(stale.ok, false); assert.match(stale.message, /out of date/);
  for (const action of [{ kind: 'probeHost', target: { kind: 'address', address: 'x', url: 'https://evil.example' } },
    { kind: 'signIn', probeId: 'not-a-uuid', label: 'x', method: 'automatic' },
    { kind: 'signIn', probeId: '00000000-0000-4000-8000-000000000000', label: 'x', method: 'token', token: 'has space' },
    { kind: 'probeHost', target: { kind: 'thisComputer', port: 70000 } }, { kind: 'renameHost', label: 'x', origin: 'y' }])
    assert.equal((await f.service.handle(action)).ok, false, JSON.stringify(action));
  f.service.dispose();
});

test('host setup actions are finite: exact fields, bounded write-only secrets, no addresses back', () => {
  const probeId = '00000000-0000-4000-8000-000000000000';
  const input = { kind: 'signIn', probeId, label: ' Studio PC ', method: 'password', provider: 'basic', username: 'alice', password: 'pass word ✓' };
  assert.deepEqual(parseDesktopAction(input), { ...input, label: 'Studio PC' });
  assert.deepEqual(parseDesktopAction({ kind: 'probeHost', target: { kind: 'saved' } }), { kind: 'probeHost', target: { kind: 'saved' } });
  for (const kind of ['cancelSetup', 'forgetHost', 'reconnectNow', 'connectSaved']) assert.deepEqual(parseDesktopAction({ kind }), { kind });
  for (const value of [{ ...input, password: 'x'.repeat(16385) }, { ...input, provider: 'bad provider' }, { ...input, extra: true },
    { kind: 'signIn', probeId, label: 'x', method: 'browser' }, { kind: 'probeHost', target: { kind: 'saved', origin: 'http://x' } },
    { kind: 'forgetHost', everything: true }, { kind: 'renameHost', label: 'x'.repeat(101) }])
    assert.throws(() => parseDesktopAction(value), undefined, JSON.stringify(value).slice(0, 80));
});
