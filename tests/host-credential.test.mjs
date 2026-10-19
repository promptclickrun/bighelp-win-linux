import test from 'node:test';
import assert from 'node:assert/strict';
import { createCredentialSession, REFRESH_RESEND_WINDOW_MS } from '../packages/hermes-client/host-credential.ts';
import { AuthHttpError } from '../packages/platform/auth-http.ts';

const origin = 'https://studio.example';
const start = Date.parse('2026-10-16T12:00:00Z');
const json = (status, body) => ({ status, contentType: 'application/json', text: JSON.stringify(body), location: null, setCookie: [], challenged: false });
const bearer = (extra = {}) => Object.freeze({ kind: 'bearer', accessToken: 'access-1', refreshToken: 'refresh-1',
  expiresAt: Math.floor(start / 1000) + 10, provider: 'basic', userId: 'alice', ...extra });
const renewed = (user = 'alice') => json(200, { access_token: 'access-2', refresh_token: 'refresh-2', token_type: 'Bearer',
  expires_at: Math.floor(start / 1000) + 43200, provider: 'basic', user_id: user });
// One fake Hermes refresh route; `answer` decides each reply. Events record order.
function fixture(answer, initial = bearer()) {
  let clock = start;
  const events = [], stored = [];
  const http = async request => {
    const body = JSON.parse(request.body ?? '{}');
    events.push(`POST ${new URL(request.url).pathname} ${body.refresh_token ?? ''}`);
    return answer(request, body);
  };
  const session = createCredentialSession({ origin, initial, http, now: () => clock });
  session.attach(async (previous, next) => { events.push(`persist ${next.kind === 'bearer' ? next.refreshToken : next.token}`); stored.push(next); });
  return { session, events, stored, advance(ms) { clock += ms; } };
}

test('an expiring sign-in renews once for concurrent callers, retiring the old refresh token first', async () => {
  let release;
  const f = fixture(() => new Promise(resolve => { release = () => resolve(renewed()); }));
  const first = f.session.current(), second = f.session.current();
  while (!release) await new Promise(resolve => setImmediate(resolve));
  // The rotating token is stored as consumed BEFORE the request leaves.
  assert.deepEqual(f.events, ['persist null', 'POST /auth/native/refresh refresh-1']);
  release();
  assert.deepEqual(await Promise.all([first, second]), ['access-2', 'access-2']);
  assert.deepEqual(f.events, ['persist null', 'POST /auth/native/refresh refresh-1', 'persist refresh-2']);
  assert.equal(f.session.credential.refreshToken, 'refresh-2');
  assert.equal(await f.session.current(), 'access-2');
  assert.equal(f.events.filter(event => event.startsWith('POST')).length, 1);
});

test('provider outage or an unsent request restores the old refresh token; expiry asks for sign-in', async () => {
  for (const failure of [() => json(503, { detail: "Auth provider 'basic' unreachable" }), () => { throw new AuthHttpError('no'); }]) {
    const f = fixture(failure);
    await assert.rejects(f.session.current(), error => error.problem === 'serverUnavailable');
    assert.equal(f.session.credential.refreshToken, 'refresh-1');
    assert.deepEqual(f.events, ['persist null', 'POST /auth/native/refresh refresh-1', 'persist refresh-1']);
    assert.equal(f.session.problem, null);
  }
  const expired = fixture(() => json(401, { error: 'session_expired', detail: 'Refresh token expired or invalid; start a new sign-in.' }));
  await assert.rejects(expired.session.current(), error => error.problem === 'expired');
  assert.equal(expired.session.problem, 'expired');
  await assert.rejects(expired.session.current(), error => error.problem === 'expired');
  assert.equal(expired.events.filter(event => event.startsWith('POST')).length, 1);
});

test('a renewed sign-in for another account is refused and never stored', async () => {
  const f = fixture(() => renewed('mallory'));
  await assert.rejects(f.session.current(), error => error.problem === 'identityChanged');
  assert.equal(f.session.problem, 'identityChanged');
  assert.equal(f.stored.some(credential => credential.userId === 'mallory'), false);
  assert.equal(f.session.credential.refreshToken, null);
});

test('a lost reply may resend the same refresh token only inside the 25 second window', async () => {
  let lose = true;
  const f = fixture(() => { if (lose) throw new AuthHttpError('maybe'); return renewed(); });
  await assert.rejects(f.session.current(), error => error.problem === 'unreachable');
  assert.equal(f.session.credential.refreshToken, null); // consumed, never replayed after a restart
  f.advance(REFRESH_RESEND_WINDOW_MS - 1000); lose = false;
  assert.equal(await f.session.current(), 'access-2');
  assert.deepEqual(f.events.filter(event => event.startsWith('POST')), ['POST /auth/native/refresh refresh-1', 'POST /auth/native/refresh refresh-1']);
  const late = fixture(() => { throw new AuthHttpError('maybe'); });
  await assert.rejects(late.session.current());
  late.advance(REFRESH_RESEND_WINDOW_MS + 1);
  await assert.rejects(late.session.current(), error => error.problem === 'expired');
  assert.equal(late.events.filter(event => event.startsWith('POST')).length, 1);
});

test('nothing is sent when the consumed state cannot be stored first', async () => {
  const session = createCredentialSession({ origin, initial: bearer(), now: () => start,
    http: async () => { assert.fail('Refresh must not be sent'); } });
  session.attach(async () => { throw Error('Disk unavailable'); });
  await assert.rejects(session.current());
  assert.equal(session.credential.refreshToken, 'refresh-1');
});

test('a turned-away token renews once; a pasted token without refresh asks for sign-in', async () => {
  const f = fixture(() => renewed(), bearer({ expiresAt: Math.floor(start / 1000) + 3600 }));
  assert.equal(await f.session.renew('access-1'), 'access-2');
  assert.equal(await f.session.renew('access-1'), 'access-2'); // someone already renewed it
  assert.equal(f.events.filter(event => event.startsWith('POST')).length, 1);
  const pasted = createCredentialSession({ origin, initial: bearer({ refreshToken: null, expiresAt: null }), now: () => start, http: async () => assert.fail() });
  assert.equal(await pasted.renew('access-1'), null);
  assert.equal(pasted.problem, 'expired');
  // A retired lease neither receives nor renews tokens.
  const stale = fixture(() => renewed(), bearer({ expiresAt: null }));
  const source = stale.session.source(() => false);
  assert.equal(await source.renew('access-1'), null);
  await assert.rejects(source.current());
});

test('"this computer" re-reads a rotated dashboard token and stores it before use', async () => {
  let token = 'dashboard-token-1';
  const page = () => `<script>window.__HERMES_SESSION_TOKEN__="${token}";window.__HERMES_AUTH_REQUIRED__=false;</script>`;
  const events = [];
  const session = createCredentialSession({ origin: 'http://127.0.0.1:9119', now: () => start,
    initial: { kind: 'dashboard', token: 'dashboard-token-1', automatic: true },
    http: async request => { events.push(`GET ${new URL(request.url).pathname}`); return { status: 200, contentType: 'text/html', text: page(), location: null, setCookie: [], challenged: false }; } });
  session.attach(async (_previous, next) => { events.push(`persist ${next.token}`); });
  await session.rescrape();
  assert.deepEqual(events, ['GET /']); // unchanged token: nothing stored
  token = 'dashboard-token-2';
  assert.equal(await session.renew('dashboard-token-1'), 'dashboard-token-2');
  assert.deepEqual(events, ['GET /', 'GET /', 'persist dashboard-token-2']);
  // A pasted session token is never re-read: after a Hermes restart, paste again.
  const pasted = createCredentialSession({ origin: 'http://127.0.0.1:9119', now: () => start,
    initial: { kind: 'dashboard', token: 'pasted', automatic: false }, http: async () => assert.fail() });
  assert.equal(await pasted.renew('pasted'), null);
});

test('a pasted token learns its account once; afterwards the account must not change', async () => {
  const stored = [];
  const session = createCredentialSession({ origin, now: () => start, http: null,
    initial: { kind: 'bearer', accessToken: 'pasted', refreshToken: null, expiresAt: null, provider: null, userId: null } });
  session.attach(async (_previous, next) => { stored.push(next); });
  await session.adopt({ provider: 'nous', userId: 'alice', expiresAt: 1900000000 });
  assert.deepEqual(stored.at(-1), { kind: 'bearer', accessToken: 'pasted', refreshToken: null, expiresAt: 1900000000, provider: 'nous', userId: 'alice' });
  await session.adopt({ provider: 'nous', userId: 'alice', expiresAt: null });
  await assert.rejects(session.adopt({ provider: 'nous', userId: 'mallory', expiresAt: null }), error => error.problem === 'identityChanged');
  assert.equal(stored.length, 1);
});
