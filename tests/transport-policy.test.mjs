import test from 'node:test';
import assert from 'node:assert/strict';
import { createTransportPolicy, parseEndpoint, parseHttpOperation } from '../packages/platform/transport-policy.ts';

const endpoint = 'https://hermes.example:9443';
const etag = `"sha256:${'a'.repeat(64)}"`;
const requestId = '01234567-89ab-4def-8123-456789abcdef';
const config = { endpoint, authentication: { kind: 'provider', token: 'synthetic-bearer' } };
const signal = () => new AbortController().signal;
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function harness(configuration = config) {
  const state = { current: true, clock: 1000, http: [], sockets: [], frames: [], closes: 0, tickets: 0 };
  const adapters = {
    isCurrent: () => state.current,
    now: () => state.clock,
    http: async (plan, abort) => {
      state.http.push({ plan, abort });
      return { status: 200, url: plan.url, redirected: false,
        headers: { etag, 'x-loopdy-request-id': requestId },
        body: plan.url.endsWith('/api/auth/ws-ticket')
          ? { ticket: `synthetic-ticket-${++state.tickets}`, ttl_seconds: 30 } : { ok: true } };
    },
    socket: async (plan, abort, onFrame) => {
      state.sockets.push({ plan, abort, onFrame });
      return { close: () => { state.closes += 1; } };
    },
  };
  const policy = createTransportPolicy(configuration, adapters);
  return { state, adapters, policy };
}

test('canonical HTTPS keeps the exact scheme, host and effective port', () => {
  assert.deepEqual(parseEndpoint('https://HERMES.example:443/'), {
    origin: 'https://hermes.example', socketOrigin: 'wss://hermes.example',
  });
  assert.deepEqual(parseEndpoint(endpoint), { origin: endpoint, socketOrigin: 'wss://hermes.example:9443' });
});
test('canonical retirement detail has one fixed authenticated GET and bounded path identity',async()=>{
 const f=harness();
 await f.policy.request({kind:'canonicalSessionDetail',profile:'agent',storedSessionId:'stored:root-1'},signal());
 const plan=f.state.http.at(-1).plan;
 assert.equal(plan.url,`${endpoint}/api/sessions/stored:root-1?profile=agent`);
 assert.equal(plan.method,'GET');assert.equal(plan.headers.Authorization,'Bearer synthetic-bearer');assert.equal(plan.redirect,'error');assert.equal(plan.maxResponseBytes,2*1024*1024);
 for(const storedSessionId of ['.','..','x/../../auth','x?profile=other','%2e%2e','x\\y',' x'])assert.throws(()=>parseHttpOperation({kind:'canonicalSessionDetail',profile:'agent',storedSessionId}));
 assert.throws(()=>parseHttpOperation({kind:'canonicalSessionDetail',profile:'agent',storedSessionId:'root',url:'/api/config'}));
});

test('reject repaired URLs, malicious authorities, paths and encoded path tricks', () => {
  const bad = [
    '//hermes.example', 'wss://hermes.example', 'file:///tmp/host', 'javascript:alert(1)',
    ' https://hermes.example', 'https://hermes.example\n', 'https:////hermes.example',
    'https://user@hermes.example', 'https://@hermes.example', 'https://hermes.example@evil.example',
    'https://hermes.example#', 'https://hermes.example?','https://hermes.example/#fragment',
    'https://hermes.example/api/../', 'https://hermes.example/./', 'https://hermes.example//',
    'https://hermes.example/%2e%2e', 'https://hermes.example/%252e%252e',
    'https://hermes.example/%2fapi', 'https://hermes.example/%5capi',
    'https://hermes.example\\@evil.example', 'https://%68ermes.example',
    'http://127.1', 'http://2130706433', 'http://0x7f000001', 'http://0177.0.0.1',
    'https://127.1', 'http://[fe80::1%25en0]',
  ];
  for (const value of bad) assert.throws(() => parseEndpoint(value, 'http://127.0.0.1'), undefined, value);
});

test('private HTTP requires precise opt-in and a literal, with no DNS exception', () => {
  const allowed = ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.254', '192.168.1.2',
    '100.64.0.1', '100.127.255.254', '[::1]', '[fd12::1]', '[fc00::1]'];
  for (const host of allowed) {
    const origin = `http://${host}:9119`;
    assert.equal(parseEndpoint(origin, origin).socketOrigin, `ws://${host}:9119`);
    assert.throws(() => parseEndpoint(origin));
    assert.throws(() => parseEndpoint(origin, origin + '/'));
    assert.throws(() => parseEndpoint(origin, origin.replace('9119', '9120')));
    assert.throws(() => parseEndpoint(origin, origin.replace('http:', 'https:')));
  }
  for (const host of ['hermes.example', 'localhost', 'private.local', '10.1.2.3.evil.example',
    '8.8.8.8', '0.0.0.0', '169.254.169.254', '172.15.0.1', '172.32.0.1', '100.63.255.255',
    '100.128.0.1', '[::]', '[::ffff:127.0.0.1]', '[fe80::1]', '[2001:db8::1]']) {
    const origin = `http://${host}`;
    assert.throws(() => parseEndpoint(origin, origin), undefined, origin);
  }
});

test('finite operations cannot accept URL, method, body, headers or an arbitrary route', async () => {
  const { policy, state } = harness();
  for (const input of [null, [], { kind: 'fetch', url: endpoint }, { kind: '__proto__' },
    { kind: 'status', url: 'https://evil.example' }, { kind: 'health', method: 'DELETE' },
    { kind: 'nativeContext', headers: { Authorization: 'bad' } },
    { kind: 'status', path: '/api/%2e%2e/admin' }, { kind: 'status', body: {} }]) {
    await assert.rejects(policy.request(input, signal()));
  }
  assert.equal(state.http.length, 0);
});

test('fixed HTTP routes preserve legacy plugin spelling and exact precondition headers', async () => {
  const { policy, state } = harness();
  const expected = {
    status: '/api/status', providers: '/api/auth/providers', identity: '/api/auth/me',
    health: '/api/health', nativeContext: '/api/plugins/loopdy/native/context',
  };
  for (const [kind, route] of Object.entries(expected)) {
    const result = await policy.request({ kind }, signal());
    assert.deepEqual(result.body, { ok: true });
    if (kind === 'nativeContext') assert.equal(result.etag, etag);
    const { plan } = state.http.at(-1);
    assert.equal(plan.url, endpoint + route);
    assert.equal(plan.method, 'GET');
    assert.equal(plan.body, undefined);
    assert.equal(plan.headers.Authorization, 'Bearer synthetic-bearer');
    assert.equal(plan.redirect, 'error');
    assert.equal(plan.credentials, 'omit');
    assert.ok(Object.isFrozen(plan));
    assert.ok(Object.isFrozen(plan.headers));
  }
  const native = await policy.request({ kind: 'templateList', agentId: 'exact-agent', etag, requestId }, signal());
  assert.deepEqual(native, { body: { ok: true }, etag, requestId });
  const { plan } = state.http.at(-1);
  assert.equal(plan.url, endpoint + '/api/plugins/loopdy/native/cards/templates/list');
  assert.equal(plan.method, 'POST');
  assert.equal(plan.body, '{"agentId":"exact-agent"}');
  assert.equal(plan.headers['If-Match'], etag);
  assert.equal(plan.headers['X-Loopdy-Request-ID'], requestId);
  assert.equal(plan.maxResponseBytes, 196608);
  assert.equal(state.http.find(item => item.plan.url.endsWith('/context')).plan.maxResponseBytes, 16384);
});

test('native context requires ETag and template responses must echo exact correlation', async () => {
  for (const headers of [undefined, {}, { etag: 'W/' + etag }, { etag, 'x-loopdy-request-id': 'wrong' },
    { etag: `"sha256:${'b'.repeat(64)}"`, 'x-loopdy-request-id': requestId }]) {
    const { policy, adapters } = harness();
    adapters.http = async plan => ({ status: 200, url: plan.url, redirected: false, body: {}, headers });
    await assert.rejects(policy.request({ kind: 'templateList', agentId: 'agent', etag, requestId }, signal()));
  }
  const { policy, adapters } = harness();
  adapters.http = async plan => ({ status: 200, url: plan.url, redirected: false, body: {} });
  await assert.rejects(policy.request({ kind: 'nativeContext' }, signal()));
});

test('native authority values are validated, never normalized or repaired', () => {
  const operation = { kind: 'templateList', agentId: 'agent', etag, requestId };
  for (const update of [{ agentId: '' }, { agentId: ' default' }, { agentId: '\ud800' },
    { etag: 'W/' + etag }, { etag: '*' }, { etag: etag.toUpperCase() },
    { requestId: requestId.toUpperCase() }, { requestId: requestId + '\r\nBad: yes' },
    { route: '/other' }]) assert.throws(() => parseHttpOperation({ ...operation, ...update }));
  assert.ok(Object.isFrozen(parseHttpOperation(operation)));
});

test('custom and Cloudflare headers are copied into exact-origin HTTP and WS only', async () => {
  const configuration = { ...config, proxy: {
    custom: [{ name: 'X-Access-Secret', value: 'synthetic-custom' }],
    cloudflare: { clientId: 'synthetic-id', clientSecret: 'synthetic-secret' },
  } };
  const { policy, state } = harness(configuration);
  configuration.proxy.custom[0].value = 'changed-after-capture';
  configuration.authentication = { kind: 'provider', token: 'changed' };
  await policy.request({ kind: 'health' }, signal());
  await policy.createSocketAttempt(() => {}).open(signal());
  for (const { plan } of [...state.http, ...state.sockets]) {
    assert.equal(plan.headers['X-Access-Secret'], 'synthetic-custom');
    assert.equal(plan.headers['CF-Access-Client-Id'], 'synthetic-id');
    assert.equal(plan.headers['CF-Access-Client-Secret'], 'synthetic-secret');
  }
  assert.equal(state.sockets[0].plan.headers.Authorization, undefined);
  assert.equal(state.sockets[0].plan.url, 'wss://hermes.example:9443/api/ws');
  assert.equal(state.sockets[0].plan.followRedirects, false);
  assert.equal(state.sockets[0].plan.cookies, 'omit');
  assert.equal(state.sockets[0].plan.ticketExpiresAt, 31000);
});

test('reserved headers, duplicates and header injection are refused', () => {
  for (const name of ['Authorization', 'cOoKiE', 'Host', 'Content-Length', 'Sec-WebSocket-Key',
    'X-Hermes-Session-Token', 'X-Loopdy-Request-ID', 'CF-Access-Client-Secret', 'If-Match',
    'Connection', 'Proxy-Authorization', 'Transfer-Encoding', 'Origin', 'X-Forwarded-Host', 'X-Foo\r\nBad']) {
    assert.throws(() => harness({ ...config, proxy: { custom: [{ name, value: 'x' }] } }), undefined, name);
  }
  for (const custom of [
    [{ name: 'X-Test', value: 'x\r\nAuthorization: bad' }],
    [{ name: 'X-Test', value: 'x' }, { name: 'x-test', value: 'y' }],
    Array.from({ length: 17 }, (_, i) => ({ name: `X-Test-${i}`, value: 'x' })),
  ]) assert.throws(() => harness({ ...config, proxy: { custom } }));
});

test('Basic is finite dashboard-only; Cloudflare requires TLS and excludes Basic', async () => {
  const basic = 'Basic c3ludGhldGljOnRlc3Q=';
  assert.throws(() => harness({ ...config, proxy: { basic } }));
  const local = { endpoint: 'http://127.0.0.1:9119', approvedPrivateHttpOrigin: 'http://127.0.0.1:9119',
    authentication: { kind: 'dashboard', token: 'synthetic+/=' }, proxy: { basic } };
  const { policy, state } = harness(local);
  await policy.request({ kind: 'health' }, signal());
  await policy.createSocketAttempt(() => {}).open(signal());
  assert.equal(state.http[0].plan.headers.Authorization, basic);
  assert.equal(state.http[0].plan.headers['X-Hermes-Session-Token'], 'synthetic+/=');
  assert.equal(state.sockets[0].plan.url, 'ws://127.0.0.1:9119/api/ws?token=synthetic%2B%2F%3D');
  assert.equal(state.sockets[0].plan.headers.Authorization, basic);
  assert.equal(state.sockets[0].plan.headers['X-Hermes-Session-Token'], 'synthetic+/=');
  // Hermes 0.21.7 accepts the dashboard-token path WITHOUT selecting a
  // subprotocol (hermes_cli/web_server_chat.py sets one only for tickets). A
  // standards-compliant client that offered one must then fail the handshake,
  // which the live host reproduced. Dashboard sockets offer none.
  assert.deepEqual(state.sockets[0].plan.protocols, []);
  assert.equal(state.http.length, 1); // Dashboard sockets never mint provider tickets.
  const cloudflare = { clientId: 'synthetic', clientSecret: 'synthetic' };
  assert.throws(() => harness({ ...local, proxy: { cloudflare } }));
  assert.throws(() => harness({ ...local, endpoint, proxy: { cloudflare, basic } }));
});

test('redirects, origin/protocol/port changes and misleading completion metadata fail without retry', async () => {
  for (const update of [
    { status: 301 }, { status: 302 }, { status: 307 }, { status: 308 }, { redirected: true },
    { url: 'https://hermes.example.evil.example/api/status' },
    { url: 'http://hermes.example:9443/api/status' }, { url: 'https://hermes.example/api/status' },
    { url: endpoint + '/api/%73tatus' }, { status: 401 }, { status: 500 }, { status: NaN },
  ]) {
    const { policy, adapters } = harness();
    let calls = 0;
    adapters.http = async plan => {
      calls += 1;
      return { status: 200, url: plan.url, redirected: false, body: {}, ...update };
    };
    await assert.rejects(policy.request({ kind: 'status' }, signal()));
    assert.equal(calls, 1);
  }
});

test('fresh provider ticket per one-shot socket, never a bearer in WS URL or headers', async () => {
  const { policy, state } = harness();
  const attempt = policy.createSocketAttempt(() => {});
  await attempt.open(signal());
  await assert.rejects(attempt.open(signal()));
  await policy.createSocketAttempt(() => {}).open(signal());
  assert.equal(state.http.length, 2);
  assert.equal(state.sockets.length, 2);
  for (const { plan } of state.http) {
    assert.equal(plan.url, endpoint + '/api/auth/ws-ticket');
    assert.equal(plan.method, 'POST');
    assert.equal(plan.body, '{}');
  }
  assert.deepEqual(state.sockets.map(item => item.plan.protocols), [
    ['hermes-gateway-v1', 'hermes-gateway-ticket.synthetic-ticket-1'],
    ['hermes-gateway-v1', 'hermes-gateway-ticket.synthetic-ticket-2'],
  ]);
  assert.equal(JSON.stringify(state.sockets.map(item => item.plan)).includes('synthetic-bearer'), false);
});

test('invalid, expired and backwards-clock tickets never reach the socket adapter', async () => {
  for (const [body, now] of [
    [{ ticket: 'good', ttl_seconds: 0 }, 1000], [{ ticket: 'good', ttl_seconds: 301 }, 1000],
    [{ ticket: 'good', ttl_seconds: '30' }, 1000], [{ ticket: 'good', ttl_seconds: Infinity }, 1000],
    [{ ticket: 'good', ttl_seconds: 1 }, 2000], [{ ticket: 'good', ttl_seconds: 30 }, 999],
    [{ ticket: 'good', ttl_seconds: 30 }, NaN], [{ ticket: 'bad.ticket', ttl_seconds: 30 }, 1000],
    [{ ticket: 'bad\r\n', ttl_seconds: 30 }, 1000], [{ ticket: '', ttl_seconds: 30 }, 1000],
    [{ ticket: 'a'.repeat(4097), ttl_seconds: 30 }, 1000], [null, 1000],
  ]) {
    const { policy, adapters, state } = harness();
    adapters.http = async plan => {
      state.clock = now;
      return { status: 200, url: plan.url, redirected: false, body };
    };
    const attempt = policy.createSocketAttempt(() => {});
    await assert.rejects(attempt.open(signal()));
    await assert.rejects(attempt.open(signal()));
    assert.equal(state.sockets.length, 0);
  }
});

test('stale or cancelled work is blocked before HTTP and after late HTTP completion', async () => {
  for (const mode of ['stale', 'abort']) {
    const { policy, adapters, state } = harness();
    const controller = new AbortController();
    const pending = deferred();
    let captured;
    adapters.http = async (plan, abort) => { captured = { plan, abort }; return pending.promise; };
    const result = policy.request({ kind: 'nativeContext' }, controller.signal);
    if (mode === 'stale') state.current = false;
    else controller.abort();
    pending.resolve({ status: 200, url: captured.plan.url, redirected: false, body: { private: 'old owner' } });
    await assert.rejects(result);
    captured = undefined;
    await assert.rejects(policy.request({ kind: 'health' }, controller.signal));
    assert.equal(captured, undefined);
  }
});

test('cancellation or owner change during ticket mint prevents socket connection', async () => {
  for (const mode of ['stale', 'abort']) {
    const { policy, adapters, state } = harness();
    const controller = new AbortController();
    const pending = deferred();
    adapters.http = async plan => {
      await pending.promise;
      return { status: 200, url: plan.url, redirected: false, body: { ticket: 'fresh', ttl_seconds: 30 } };
    };
    const result = policy.createSocketAttempt(() => {}).open(controller.signal);
    if (mode === 'stale') state.current = false;
    else controller.abort();
    pending.resolve();
    await assert.rejects(result);
    assert.equal(state.sockets.length, 0);
  }
});

test('late connector completion closes retired socket and suppresses raced frames', async () => {
  for (const mode of ['stale', 'abort']) {
    const { policy, adapters, state } = harness({ ...config, authentication: { kind: 'dashboard', token: 'synthetic' } });
    const pending = deferred();
    const controller = new AbortController();
    let callback;
    adapters.socket = async (_plan, _abort, onFrame) => { callback = onFrame; return pending.promise; };
    const result = policy.createSocketAttempt(frame => state.frames.push(frame)).open(controller.signal);
    if (mode === 'stale') state.current = false;
    else controller.abort();
    callback({ jsonrpc: '2.0', id: 'synthetic-send', result: { status: 'streaming' } });
    pending.resolve({ close: () => { state.closes += 1; } });
    await assert.rejects(result);
    assert.equal(state.closes, 1);
    assert.deepEqual(state.frames, []);
  }
});

test('opaque streaming receipt passes once while current; retirement drops late callbacks', async () => {
  const { policy, state } = harness();
  const controller = new AbortController();
  const handle = await policy.createSocketAttempt(frame => state.frames.push(frame)).open(controller.signal);
  const receipt = { jsonrpc: '2.0', id: 'synthetic-send', result: { status: 'streaming' } };
  state.sockets[0].onFrame(receipt);
  assert.deepEqual(state.frames, [receipt]); // No fabricated terminal/completed receipt.
  controller.abort();
  handle.close();
  state.sockets[0].onFrame(receipt);
  assert.equal(state.frames.length, 1);
  assert.equal(state.closes, 1);
  assert.equal(state.sockets[0].abort.aborted, true);
});

test('owner invalidation on an open socket retires it permanently, even if predicate later returns true', async () => {
  const { policy, state } = harness();
  await policy.createSocketAttempt(frame => state.frames.push(frame)).open(signal());
  state.current = false;
  state.sockets[0].onFrame({ old: true });
  state.current = true;
  state.sockets[0].onFrame({ stillOld: true });
  assert.equal(state.frames.length, 0);
  assert.equal(state.closes, 1);
});

test('owner is rechecked at the final HTTP await boundary', async () => {
  const { policy, adapters, state } = harness();
  adapters.http = async plan => {
    queueMicrotask(() => queueMicrotask(() => { state.current = false; }));
    return { status: 200, url: plan.url, redirected: false, body: { oldOwner: true } };
  };
  await assert.rejects(policy.request({ kind: 'health' }, signal()));
});

test('concurrent open calls consume a single permit before ticket I/O', async () => {
  const { policy, adapters, state } = harness();
  const pending = deferred();
  const original = adapters.http;
  adapters.http = async (plan, abort) => { await pending.promise; return original(plan, abort); };
  const attempt = policy.createSocketAttempt(() => {});
  const first = attempt.open(signal());
  await assert.rejects(attempt.open(signal()));
  pending.resolve();
  await first;
  assert.equal(state.http.length, 1);
  assert.equal(state.sockets.length, 1);
});

test('socket failures stay one-shot and redact adapter details', async () => {
  const { policy, adapters, state } = harness();
  adapters.socket = async () => { throw new Error('secret ticket in wss://private.example'); };
  const attempt = policy.createSocketAttempt(() => {});
  await assert.rejects(attempt.open(signal()), error => {
    assert.equal(error.message, 'Socket attempt failed or retired');
    assert.equal(error.cause, undefined);
    return true;
  });
  await assert.rejects(attempt.open(signal()));
  assert.equal(state.http.length, 1);
});

test('adapter failure cannot return a credential-bearing HTTP error to its caller', async () => {
  const { policy, adapters } = harness();
  adapters.http = async () => { throw new Error('Bearer synthetic-bearer at https://secret.example'); };
  await assert.rejects(policy.request({ kind: 'health' }, signal()), error => {
    assert.equal(error.message.includes('synthetic-bearer'), false);
    assert.equal(error.message.includes('secret.example'), false);
    return true;
  });
});

const nativeRoute = { kind: 'route', method: 'POST', path: '/api/plugins/loopdy/native/board/update', body: '{}', maxBytes: 4096 };
test('proxy-wrapped native ETags are read as the canonical context tag, never sent wrapped', async () => {
  for (const wrapped of ['W/' + etag, etag.replace(/"$/u, '-gzip"'), 'W/' + etag.replace(/"$/u, '-zstd"'),
    etag.replace(/"$/u, '-br"'), etag.replace(/"$/u, '-deflate"')]) {
    const { policy, adapters, state } = harness();
    adapters.http = async plan => { state.http.push({ plan }); return { status: 200, url: plan.url, redirected: false, body: { ok: true },
      headers: { etag: wrapped, 'x-loopdy-request-id': requestId, 'cache-control': 'no-store' } }; };
    assert.equal((await policy.request({ kind: 'nativeContext' }, signal())).etag, etag, wrapped);
    assert.deepEqual(await policy.request({ kind: 'templateList', agentId: 'agent', etag, requestId }, signal()),
      { body: { ok: true }, etag, requestId });
    assert.equal((await policy.request({ ...nativeRoute, native: { etag, requestId } }, signal())).etag, etag);
    const posts = state.http.filter(entry => entry.plan.method === 'POST');
    assert.equal(posts.length, 2);
    for (const { plan } of posts) assert.equal(plan.headers['If-Match'], etag);
  }
  for (const wrapped of ['W/W/' + etag, etag.replace(/"$/u, '-gzip-gzip"'), etag.replace(/"$/u, '-lz4"'), 'w/' + etag,
    etag.toUpperCase(), ` ${etag}`, etag.replace(/"$/u, '";gzip'), `W/${etag}-gzip`, '*']) {
    const { policy, adapters } = harness();
    adapters.http = async plan => ({ status: 200, url: plan.url, redirected: false, body: {},
      headers: { etag: wrapped, 'x-loopdy-request-id': requestId, 'cache-control': 'no-store' } });
    await assert.rejects(policy.request({ kind: 'nativeContext' }, signal()), wrapped);
    await assert.rejects(policy.request({ kind: 'templateList', agentId: 'agent', etag, requestId }, signal()), wrapped);
    const routed = await policy.request({ ...nativeRoute, native: { etag, requestId } }, signal());
    assert.equal(routed.etag, undefined, `${wrapped} is not a context tag`);
  }
});

test('native request IDs must be canonical version 1-5 UUIDs, as the plugin requires', () => {
  const operation = { kind: 'templateList', agentId: 'agent', etag, requestId };
  for (const id of ['01234567-89ab-cdef-0123-456789abcdef', '01234567-89ab-0def-8123-456789abcdef',
    '01234567-89ab-6def-8123-456789abcdef', '01234567-89ab-4def-c123-456789abcdef', '01234567-89ab-4def-7123-456789abcdef',
    '0123456789ab4def8123456789abcdef', '{01234567-89ab-4def-8123-456789abcdef}']) {
    assert.throws(() => parseHttpOperation({ ...operation, requestId: id }), id);
    assert.throws(() => parseHttpOperation({ ...nativeRoute, native: { etag, requestId: id } }), id);
  }
  for (const id of [requestId, crypto.randomUUID(), '01234567-89ab-1def-a123-456789abcdef', '01234567-89ab-5def-b123-456789abcdef']) {
    assert.ok(parseHttpOperation({ ...operation, requestId: id }), id);
    assert.ok(parseHttpOperation({ ...nativeRoute, native: { etag, requestId: id } }), id);
  }
});

test('plugin error codes survive only as fixed identifiers', async () => {
  for (const [body, code] of [[{ error: { code: 'board_item_unavailable', message: 'That item is no longer available.' } }, 'board_item_unavailable'],
    [{ error: { code: 'Bad Code', message: 'x' } }, ''], [{ error: { code: 'x'.repeat(65) } }, ''], [{ detail: 'stock' }, ''], [null, '']]) {
    const { policy, adapters } = harness();
    adapters.http = async plan => ({ status: 404, url: plan.url, redirected: false, body });
    await assert.rejects(policy.request({ ...nativeRoute, native: { etag, requestId } }, signal()),
      error => error.status === 404 && error.code === code);
  }
});
