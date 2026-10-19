import test from 'node:test';
import assert from 'node:assert/strict';
import { createTransportPolicy, parseHttpOperation, HttpStatusError, safeDetail } from '../packages/platform/transport-policy.ts';
import { createDesktopService } from '../apps/desktop/src/main/desktop-service.ts';
import { parseDesktopAction } from '../apps/desktop/src/shared/desktop-api.ts';
import { callFailure } from '../apps/desktop/src/main/calls/context.ts';
import { GatewayOperationError } from '../packages/hermes-client/gateway.ts';

const route = (overrides = {}) => ({ kind: 'route', method: 'GET', path: '/api/cron/jobs', maxBytes: 4096, ...overrides });

test('feature routes accept fixed API paths and refuse traversal, secrets and gateway control', () => {
  const parsed = parseHttpOperation(route({ query: { profile: 'agent' } }));
  assert.deepEqual({ ...parsed, query: { ...parsed.query } }, route({ query: { profile: 'agent' } }));
  assert.ok(Object.isFrozen(parsed) && Object.getPrototypeOf(parsed.query) === null);
  assert.ok(parseHttpOperation(route({ method: 'DELETE', path: '/api/cron/jobs/abc%3A1' })));
  for (const path of ['/api/../auth/me', '/api/cron/..', '/api/x/%2e%2e', '/api/x/%2F', '/api//x', 'https://evil/api', '/apix',
    '/api/auth/me', '/api/gateway/restart', '/api/env', '/api/ops/backup', '/api/config/raw', '/api/hermes/update', '/api/ws',
    '/api/x?y=1', '/api/x#y', '/api/x y', '/api/x\\y']) {
    assert.throws(() => parseHttpOperation(route({ path })), `${path} must be refused`);
  }
  for (const update of [{ method: 'TRACE' }, { maxBytes: 0 }, { maxBytes: 5 * 1024 * 1024 }, { body: '{}' },
    { method: 'POST', body: 'not json' }, { method: 'POST', body: '"text"' }, { query: { 'Bad-Key': 'x' } },
    { query: { profile: 'a\nb' } }, { headers: { Authorization: 'x' } },
    { native: { etag: `"sha256:${'a'.repeat(64)}"`, requestId: '01234567-89ab-4def-8123-456789abcdef' } }]) {
    assert.throws(() => parseHttpOperation(route(update)));
  }
});

test('feature routes carry exact headers, method, body and correlation', async () => {
  const seen = [];
  const policy = createTransportPolicy({ endpoint: 'https://hermes.example', authentication: { kind: 'dashboard', token: 'synthetic' } }, {
    isCurrent: () => true, now: () => 0, socket: async () => ({ close() {} }),
    http: async plan => { seen.push(plan); return { status: 200, url: plan.url, redirected: false, body: { ok: true },
      headers: { 'x-loopdy-request-id': '01234567-89ab-4def-8123-456789abcdef' } }; },
  });
  const signal = new AbortController().signal;
  await policy.request(route({ method: 'PUT', path: '/api/cron/jobs/job1', query: { profile: 'a b' }, body: '{"name":"x"}' }), signal);
  assert.equal(seen[0].url, 'https://hermes.example/api/cron/jobs/job1?profile=a+b');
  assert.equal(seen[0].method, 'PUT');
  assert.equal(seen[0].headers['Content-Type'], 'application/json');
  assert.equal(seen[0].headers['X-Hermes-Session-Token'], 'synthetic');
  assert.equal(seen[0].redirect, 'error');
  const native = { etag: `"sha256:${'a'.repeat(64)}"`, requestId: '01234567-89ab-4def-8123-456789abcdef' };
  const result = await policy.request(route({ method: 'POST', path: '/api/plugins/loopdy/native/board/feedback', body: '{}', native }), signal);
  assert.equal(seen[1].headers['If-Match'], native.etag);
  assert.equal(seen[1].headers['X-Loopdy-Request-ID'], native.requestId);
  assert.equal(result.requestId, native.requestId);
  await assert.rejects(policy.request(route({ method: 'POST', path: '/api/plugins/loopdy/native/board/feedback', body: '{}',
    native: { ...native, requestId: 'fedcba98-7654-4210-9edc-ba9876543210' } }), signal));
});

test('host error details are short, single-line and never markup', async () => {
  assert.equal(safeDetail('Invalid cron\nexpression'), 'Invalid cron expression');
  assert.equal(safeDetail('<html>boom</html>'), '');
  assert.equal(safeDetail('x'.repeat(400)).length, 300);
  const policy = createTransportPolicy({ endpoint: 'https://hermes.example', authentication: { kind: 'dashboard', token: 'synthetic' } }, {
    isCurrent: () => true, now: () => 0, socket: async () => ({ close() {} }),
    http: async plan => ({ status: 422, url: plan.url, redirected: false, body: { detail: 'Schedule is not valid' } }),
  });
  await assert.rejects(policy.request(route(), new AbortController().signal),
    error => error instanceof HttpStatusError && error.status === 422 && error.detail === 'Schedule is not valid');
});

test('call failures map to plain words without leaking raw errors', () => {
  assert.equal(callFailure(new GatewayOperationError(-32601), false).code, 'unsupported');
  assert.equal(callFailure(new HttpStatusError(404), false).code, 'unsupported');
  assert.equal(callFailure(new HttpStatusError(409, 'Changed'), true).message, 'Changed');
  assert.equal(callFailure(new HttpStatusError(500), true).code, 'unknown');
  assert.equal(callFailure(new HttpStatusError(500), false).code, 'unavailable');
  assert.equal(callFailure(new Error('outcome-unknown'), true).code, 'unknown');
  assert.equal(callFailure(new Error('secret https://host/?token=abc'), false).message.includes('token'), false);
});

test('renderer calls are finite, validated again in main and bound to the host lease', async () => {
  assert.throws(() => parseDesktopAction({ kind: 'call', connection: 1, name: 'not.a.call', input: {} }));
  assert.throws(() => parseDesktopAction({ kind: 'call', connection: 1, name: 'host.about', input: { extra: true } }));
  assert.throws(() => parseDesktopAction({ kind: 'call', connection: -1, name: 'host.about', input: {} }));
  assert.throws(() => parseDesktopAction({ kind: 'call', connection: 1, name: 'host.about', input: {}, url: '/api/env' }));
  const http = [];
  const gateway = { exclusiveSubmit: true, close() {}, restoreRequests() {},
    async requestHttp(op) {
      http.push(op);
      if (op.kind === 'health') return { body: { ok: true, auth_required: false } };
      if (op.kind === 'nativeContext') throw new HttpStatusError(404);
      if (op.kind === 'route' && op.path === '/api/status') return { body: { version: '1.2.3', gateway_running: true, active_sessions: 2, hermes_home: '/private' } };
      throw new Error('unexpected');
    },
    async operation(op) { if (op.kind === 'profilesList') return { profiles: [{ name: 'agent' }] }; if (op.kind === 'sessionList') return { sessions: [] }; return {}; },
  };
  const values = new Map();
  const repository = { async read(key) { return values.get(key) ?? null; },
    async write(key, revision, value) { const next = { revision: (revision ?? 0) + 1, value }; values.set(key, next); return next; } };
  const service = createDesktopService({ repository, connect: async () => gateway, onChange() {} });
  assert.equal((await service.call({ kind: 'call', connection: 0, name: 'host.about', input: {} })).code, 'stale');
  await service.handle({ kind: 'connect', host: { label: 'Test', endpoint: 'https://test.invalid', authentication: 'dashboard', token: 'synthetic', allowPrivateHttp: false } });
  const lease = service.snapshot().connection;
  const result = await service.call({ kind: 'call', connection: lease, name: 'host.about', input: {} });
  assert.deepEqual(result, { ok: true, value: { version: '1.2.3', releaseDate: null, gatewayRunning: true, activeSessions: 2,
    plugin: { installed: false, version: null, features: [] } } });
  assert.equal(JSON.stringify(result).includes('/private'), false);
  assert.equal((await service.call({ kind: 'call', connection: lease - 1, name: 'host.about', input: {} })).code, 'stale');
  await service.handle({ kind: 'disconnect' });
  assert.equal((await service.call({ kind: 'call', connection: lease, name: 'host.about', input: {} })).code, 'stale');
});
