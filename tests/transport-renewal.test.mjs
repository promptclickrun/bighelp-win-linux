import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createTransportPolicy, HttpStatusError } from '../packages/platform/transport-policy.ts';
import { boundedHttp } from '../packages/platform/http-transport.ts';

const endpoint = 'https://hermes.example';
const signal = () => new AbortController().signal;
// statuses: per-request reply status; the credential source renews to `fresh`.
function harness({ kind = 'provider', statuses = [], challenged = false, fresh = 'fresh-token' } = {}) {
  const state = { http: [], sockets: [], renewals: [] };
  const credential = {
    current: async () => 'current-token',
    renew: async rejected => { state.renewals.push(rejected); return fresh; },
  };
  const policy = createTransportPolicy({ endpoint, authentication: { kind, token: 'configured-token' } }, {
    isCurrent: () => true, now: () => 1000, credential,
    http: async plan => {
      state.http.push(plan);
      const status = statuses.shift() ?? 200;
      return { status, url: plan.url, redirected: false, body: plan.url.endsWith('/api/auth/ws-ticket') && status === 200
        ? { ticket: 'ticket-1', ttl_seconds: 30 } : status === 200 ? { ok: true } : { detail: 'Unauthorized' },
        headers: challenged ? { 'www-authenticate': 'present' } : {} };
    },
    socket: async plan => { state.sockets.push(plan); return { close() {} }; },
  });
  return { policy, state };
}
const auth = plan => plan.headers.Authorization ?? plan.headers['X-Hermes-Session-Token'];

test('a request uses the current token and resends once after Hermes turns it away', async () => {
  const f = harness({ statuses: [401, 200] });
  assert.deepEqual((await f.policy.request({ kind: 'health' }, signal())).body, { ok: true });
  assert.deepEqual(f.state.http.map(auth), ['Bearer current-token', 'Bearer fresh-token']);
  assert.deepEqual(f.state.renewals, ['current-token']);
  // Never a loop: a second refusal is final.
  const twice = harness({ statuses: [401, 401] });
  await assert.rejects(twice.policy.request({ kind: 'health' }, signal()), error => error instanceof HttpStatusError && error.status === 401);
  assert.equal(twice.state.http.length, 2);
});

test('a proxy challenge, another status or no renewal is final and never renews', async () => {
  for (const options of [{ statuses: [401], challenged: true }, { statuses: [403] }, { statuses: [401], fresh: null }, { statuses: [401], fresh: 'current-token' }]) {
    const f = harness(options);
    await assert.rejects(f.policy.request({ kind: 'health' }, signal()), error => error instanceof HttpStatusError);
    assert.equal(f.state.http.length, 1, JSON.stringify(options));
  }
});

test('each socket mints a fresh ticket, renewing once when the mint is refused', async () => {
  const f = harness({ statuses: [401, 200] });
  await f.policy.createSocketAttempt(() => {}).open(signal());
  assert.deepEqual(f.state.http.map(auth), ['Bearer current-token', 'Bearer fresh-token']);
  assert.deepEqual(f.state.sockets[0].protocols, ['hermes-gateway-v1', 'hermes-gateway-ticket.ticket-1']);
  assert.equal(JSON.stringify(f.state.sockets[0]).includes('token'), false);
  // Dashboard sockets carry the current (re-read) token, never the configured one.
  const dashboard = harness({ kind: 'dashboard' });
  await dashboard.policy.createSocketAttempt(() => {}).open(signal());
  assert.equal(dashboard.state.sockets[0].url, 'wss://hermes.example/api/ws?token=current-token');
  assert.equal(dashboard.state.sockets[0].headers['X-Hermes-Session-Token'], 'current-token');
});

test('bounded HTTP reports only whether a refusal carried a proxy challenge', async () => {
  const server = createServer((request, response) => {
    if (request.url === '/challenged') response.writeHead(401, { 'www-authenticate': 'Basic realm="proxy", charset="UTF-8"', 'content-type': 'application/json' });
    else response.writeHead(401, { 'content-type': 'application/json' });
    response.end('{"detail":"Unauthorized"}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const plan = path => ({ url: origin + path, method: 'GET', headers: {}, redirect: 'error', credentials: 'omit', maxResponseBytes: 4096 });
  try {
    assert.deepEqual((await boundedHttp(plan('/challenged'), signal())).headers['www-authenticate'], 'present');
    assert.equal((await boundedHttp(plan('/plain'), signal())).headers['www-authenticate'], undefined);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
