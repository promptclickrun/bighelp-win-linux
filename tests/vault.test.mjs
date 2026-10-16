import test from 'node:test';
import assert from 'node:assert/strict';
import { createDesktopService } from '../apps/desktop/src/main/desktop-service.ts';
import { parseDesktopAction } from '../apps/desktop/src/shared/desktop-api.ts';
import { VAULT_HANDLERS, VAULT_UNSUPPORTED } from '../apps/desktop/src/main/calls/vault.ts';
import { callFailure } from '../apps/desktop/src/main/calls/context.ts';
import { GatewayOperationError } from '../packages/hermes-client/gateway.ts';
import { decodeVaultItems, decodeVaultSources, encodeVaultLogin, vaultSite, usernameType } from '../packages/contracts/vault.ts';

// Obviously fake values. Every published or returned byte is searched for them.
const PASSWORD = 'FAKE-vault-password-7f3c9d';
const MASTER = 'FAKE-master-password-21ab';

// Shapes recorded from a disposable Hermes (tui_gateway methods_vault, 2026-10).
const LIST = { items: [{ id: 'vault_d7c03fda7fde', kind: 'login', label: 'Probe example', origin: 'https://example.com',
  created_at: '2026-10-16T22:09:34.744028+00:00', identifier: 'probe@example.com', identifier_type: 'email', backend: 'local' }] };
const SOURCES = { sources: [
  { name: 'local', display_name: 'Hermes vault', enabled: true, needs_unlock: false, unlocked: true, installed: true },
  { name: 'onepassword', display_name: '1Password', enabled: false, needs_unlock: true, unlocked: false, installed: false },
  { name: 'bitwarden', display_name: 'Bitwarden', enabled: false, needs_unlock: true, unlocked: false, installed: false }] };

const call = (name, input) => ({ kind: 'call', connection: 1, name, input });

test('vault calls refuse unknown fields, bad sites, empty secrets and Hermes\' own vault as a manager', () => {
  const add = { profile: 'agent', site: 'example.com', username: 'sam@example.com', password: PASSWORD };
  assert.equal(parseDesktopAction(call('vault.add', add)).input.site, 'https://example.com');
  for (const input of [{ ...add, extra: true }, { ...add, password: '' }, { ...add, password: 'a\nb' }, { ...add, password: 'x'.repeat(4097) },
    { ...add, site: 'not a site' }, { ...add, site: 'ftp://example.com' }, { ...add, site: 'https://user:pw@example.com' }, { ...add, site: 'intranet' },
    { ...add, username: '   ' }, { ...add, profile: ' agent' }, { site: add.site, username: add.username, password: PASSWORD }]) {
    assert.throws(() => parseDesktopAction(call('vault.add', input)));
  }
  assert.throws(() => parseDesktopAction(call('vault.read', { profile: 'agent', url: '/api/env' })));
  assert.throws(() => parseDesktopAction(call('vault.remove', { profile: 'agent', id: '' })));
  for (const source of ['local', '../x', 'one password', '', 7]) {
    assert.throws(() => parseDesktopAction(call('vault.unlock', { profile: 'agent', source, password: MASTER })));
    assert.throws(() => parseDesktopAction(call('vault.lock', { profile: 'agent', source })));
  }
  assert.throws(() => parseDesktopAction(call('vault.unlock', { profile: 'agent', source: 'onepassword', password: '' })));
  assert.throws(() => parseDesktopAction(call('vault.useSource', { profile: 'agent', source: 'onepassword', enabled: 'yes' })));
  // Refusals never repeat the typed value.
  try { parseDesktopAction(call('vault.add', { ...add, password: `${PASSWORD}\n` })); } catch (error) { assert.equal(String(error).includes(PASSWORD), false); }
});

test('typed sites become the exact origin Hermes binds a login to', () => {
  assert.equal(vaultSite('Example.COM/login?x=1'), 'https://example.com');
  assert.equal(vaultSite('http://localhost:8080/a'), 'http://localhost:8080');
  assert.equal(vaultSite(' https://shop.example.org:443/ '), 'https://shop.example.org');
  for (const bad of ['', 'example', 'exa mple.com', 'javascript:alert(1)', 'file:///etc/passwd', '.example.com', 'https://a:b@example.com']) {
    assert.equal(vaultSite(bad), null, bad);
  }
  assert.deepEqual(['sam@example.com', '+15550100', 'sam'].map(usernameType), ['email', 'phone', 'username']);
});

test('vault replies decode to labels only and drop secrets, unknown fields and malformed rows', () => {
  const hostile = { items: [...LIST.items,
    { id: 'vault_2', kind: 'login', label: 'Leaky', origin: 'https://leak.example', identifier: 'x', backend: 'local',
      password: PASSWORD, secret: { password: PASSWORD }, otp_secret: 'JBSWY3DPEHPK3PXP', path: '/home/private/vault.json.enc' },
    { id: 'vault_3', kind: 'payment', label: 'Card ending 4242', backend: 'local', card_number: '4242424242424242', identifier: 'should-not-show' },
    { id: 'manager-1', kind: 'login', label: '', origin: 'https://Shop.Example.org/x', identifier: 'sam', backend: 'onepassword', has_otp: true },
    { id: '', kind: 'login', label: 'No id', backend: 'local' }, { id: 'x', kind: 'note', label: 'Unknown kind', backend: 'local' },
    { id: 'y', kind: 'login', label: 'Bad‮Label', backend: 'local' }, { id: 'z', kind: 'login', label: 'No source' }, 'row', null,
    { ...LIST.items[0], label: 'Duplicate id' }] };
  const items = decodeVaultItems(hostile);
  assert.deepEqual(items.map(item => item.id), ['vault_3', 'vault_2', 'vault_d7c03fda7fde', 'manager-1']);
  assert.deepEqual(items.find(item => item.id === 'vault_d7c03fda7fde'), { id: 'vault_d7c03fda7fde', kind: 'login', label: 'Probe example',
    site: 'https://example.com', username: 'probe@example.com', source: 'local', makesCodes: false, addedAt: '2026-10-16T22:09:34.744028+00:00' });
  assert.deepEqual(items.find(item => item.id === 'manager-1'), { id: 'manager-1', kind: 'login', label: 'shop.example.org',
    site: 'https://shop.example.org', username: 'sam', source: 'onepassword', makesCodes: true, addedAt: null });
  assert.equal(items.find(item => item.id === 'vault_3').username, null);
  const text = JSON.stringify(items);
  for (const secret of [PASSWORD, 'JBSWY3DPEHPK3PXP', '4242424242424242', '/home/private', 'should-not-show']) assert.equal(text.includes(secret), false, secret);
  assert.ok(Object.isFrozen(items) && items.every(Object.isFrozen));
  const sources = decodeVaultSources({ sources: [...SOURCES.sources, { name: 'bad name', display_name: 'X' }, { name: 'local' }, { name: 'keeper', token: 'abc' }] });
  assert.deepEqual(sources.map(source => source.name), ['local', 'onepassword', 'bitwarden', 'keeper']);
  assert.deepEqual(sources[1], { name: 'onepassword', displayName: '1Password', enabled: false, needsUnlock: true, unlocked: false, installed: false });
  assert.equal(JSON.stringify(sources).includes('abc'), false);
  for (const bad of [null, [], { items: {} }, { sources: 'x' }]) {
    assert.throws(() => decodeVaultItems(bad)); assert.throws(() => decodeVaultSources(bad));
  }
});

function context(reply) {
  const sent = [];
  return { sent, value: Object.freeze({
    async rpc(method, params, options) { sent.push({ method, params: structuredClone(params), options }); return reply(method, params); },
    requireProfile: profile => { if (profile !== 'agent') throw new Error('stale'); return profile; },
  }) };
}

test('vault requests have the exact Hermes shapes', async () => {
  const replies = { 'vault.list': LIST, 'vault.sources': SOURCES, 'vault.add': { id: 'vault_new' }, 'vault.remove': { removed: true },
    'vault.unlock': { name: 'onepassword', unlocked: true }, 'vault.lock': { locked: true }, 'vault.source.set': { name: 'onepassword', enabled: false } };
  const c = context(method => replies[method]);
  const read = await VAULT_HANDLERS['vault.read'].run(c.value, { profile: 'agent' });
  assert.equal(read.items.length, 1); assert.equal(read.sources.length, 3);
  await VAULT_HANDLERS['vault.add'].run(c.value, { profile: 'agent', site: 'https://example.com', username: ' sam@example.com ', password: PASSWORD });
  await VAULT_HANDLERS['vault.add'].run(c.value, { profile: 'agent', site: 'https://example.com', username: 'sam', password: PASSWORD, label: 'Work' });
  assert.deepEqual(await VAULT_HANDLERS['vault.remove'].run(c.value, { profile: 'agent', id: 'vault_d7c03fda7fde' }), { removed: true });
  assert.deepEqual(await VAULT_HANDLERS['vault.unlock'].run(c.value, { profile: 'agent', source: 'onepassword', password: MASTER }), { unlocked: true });
  assert.deepEqual(await VAULT_HANDLERS['vault.lock'].run(c.value, { profile: 'agent', source: 'onepassword' }), { locked: true });
  assert.deepEqual(await VAULT_HANDLERS['vault.useSource'].run(c.value, { profile: 'agent', source: 'onepassword', enabled: false }), { enabled: false });
  assert.deepEqual(c.sent.map(({ method, params }) => [method, params]), [
    ['vault.list', { profile: 'agent' }], ['vault.sources', { profile: 'agent' }],
    ['vault.add', { profile: 'agent', kind: 'login', label: 'example.com', origin: 'https://example.com',
      secret: { identifier_type: 'email', identifier: 'sam@example.com', password: PASSWORD } }],
    ['vault.add', { profile: 'agent', kind: 'login', label: 'Work', origin: 'https://example.com',
      secret: { identifier_type: 'username', identifier: 'sam', password: PASSWORD } }],
    ['vault.remove', { profile: 'agent', id: 'vault_d7c03fda7fde' }],
    ['vault.unlock', { profile: 'agent', name: 'onepassword', password: MASTER }],
    ['vault.lock', { profile: 'agent', name: 'onepassword' }],
    ['vault.source.set', { profile: 'agent', name: 'onepassword', enabled: false }]]);
  assert.equal(c.sent[0].options.mutation, false);
  assert.notEqual(c.sent.find(entry => entry.method === 'vault.unlock').options.mutation, false);
  // Each secret went to the host exactly once, in its own request.
  assert.equal(c.sent.filter(entry => JSON.stringify(entry).includes(MASTER)).length, 1);
  assert.throws(() => encodeVaultLogin('agent', { site: 'nope', username: 'sam', password: PASSWORD }));
  await assert.rejects(VAULT_HANDLERS['vault.read'].run(c.value, { profile: 'other' }));
});

test('a host without the vault gets one plain sentence; refusals of secret calls never echo host text', async () => {
  const missing = context(() => { throw new GatewayOperationError(-32601, '', 'unknown method: vault.list'); }).value;
  for (const [name, input] of [['vault.read', { profile: 'agent' }], ['vault.add', { profile: 'agent', site: 'https://example.com', username: 'sam', password: PASSWORD }],
    ['vault.unlock', { profile: 'agent', source: 'onepassword', password: MASTER }]]) {
    const failure = await VAULT_HANDLERS[name].run(missing, input).then(() => null, error => callFailure(error, VAULT_HANDLERS[name].mutation));
    assert.deepEqual(failure, { ok: false, code: 'unsupported', message: VAULT_UNSUPPORTED });
  }
  assert.equal(VAULT_UNSUPPORTED, "Your Hermes doesn't have a vault yet. Update Hermes on your computer to use it.");
  // A host that echoed the secret in its error still cannot get it to the window.
  const echo = context((method, params) => { throw new GatewayOperationError(5095, '', `bad value ${params.password ?? params.secret?.password}`); }).value;
  for (const [name, input] of [['vault.add', { profile: 'agent', site: 'https://example.com', username: 'sam', password: PASSWORD }],
    ['vault.unlock', { profile: 'agent', source: 'onepassword', password: MASTER }]]) {
    const failure = await VAULT_HANDLERS[name].run(echo, input).then(() => null, error => callFailure(error, true));
    assert.equal(failure.code, 'invalid');
    assert.equal(JSON.stringify(failure).includes(PASSWORD) || JSON.stringify(failure).includes(MASTER), false);
  }
  // A lost reply to a write is never success and is not retried.
  let attempts = 0;
  const lost = context(() => { attempts++; throw new Error('outcome-unknown'); }).value;
  const failure = await VAULT_HANDLERS['vault.add'].run(lost, { profile: 'agent', site: 'https://example.com', username: 'sam', password: PASSWORD })
    .then(() => null, error => callFailure(error, true));
  assert.equal(failure.code, 'unknown'); assert.equal(attempts, 1);
  const odd = context(() => ({ removed: 'yes' })).value;
  assert.equal((await VAULT_HANDLERS['vault.remove'].run(odd, { profile: 'agent', id: 'x' }).catch(error => callFailure(error, true))).code, 'unknown');
});

test('typed secrets never appear in snapshots, call results, failures or protected storage', async () => {
  const sent = [], published = [], values = new Map();
  let fail = false;
  const gateway = { exclusiveSubmit: true, close() {}, restoreRequests() {},
    async requestHttp(op) { if (op.kind === 'health') return { body: { ok: true, auth_required: false } }; throw new Error('unexpected'); },
    async operation(op) { if (op.kind === 'profilesList') return { profiles: [{ name: 'agent' }] }; if (op.kind === 'sessionList') return { sessions: [] }; return {}; },
    async call(method, params) {
      sent.push(JSON.stringify({ method, params }));
      if (fail) throw new GatewayOperationError(5095, '', `could not use ${JSON.stringify(params)}`);
      return { 'vault.add': { id: 'vault_new' }, 'vault.unlock': { name: 'onepassword', unlocked: true }, 'vault.list': LIST, 'vault.sources': SOURCES }[method];
    } };
  const repository = { async read(key) { return values.get(key) ?? null; },
    async write(key, revision, value) { const next = { revision: (revision ?? 0) + 1, value: structuredClone(value) }; values.set(key, next); return next; } };
  const service = createDesktopService({ repository, connect: async () => gateway, onChange: snapshot => published.push(JSON.stringify(snapshot)) });
  await service.handle({ kind: 'connect', host: { label: 'Test', endpoint: 'https://test.invalid', authentication: 'dashboard', token: 'synthetic', allowPrivateHttp: false } });
  const lease = service.snapshot().connection;
  const results = [];
  const add = { profile: 'agent', site: 'example.com', username: 'sam@example.com', password: PASSWORD };
  const unlock = { profile: 'agent', source: 'onepassword', password: MASTER };
  results.push(await service.call({ kind: 'call', connection: lease, name: 'vault.add', input: add }));
  results.push(await service.call({ kind: 'call', connection: lease, name: 'vault.unlock', input: unlock }));
  results.push(await service.call({ kind: 'call', connection: lease, name: 'vault.read', input: { profile: 'agent' } }));
  fail = true;
  results.push(await service.call({ kind: 'call', connection: lease, name: 'vault.add', input: add }));
  results.push(await service.call({ kind: 'call', connection: lease, name: 'vault.unlock', input: unlock }));
  results.push(await service.call({ kind: 'call', connection: lease - 1, name: 'vault.add', input: add }));
  results.push(await service.call({ kind: 'call', connection: lease, name: 'vault.add', input: { ...add, extra: PASSWORD } }));
  assert.deepEqual(results.slice(0, 2), [{ ok: true, value: { saved: true } }, { ok: true, value: { unlocked: true } }]);
  assert.deepEqual(results.slice(3).map(result => result.code), ['invalid', 'invalid', 'stale', 'invalid']);
  const outside = [...results.map(result => JSON.stringify(result)), ...published, JSON.stringify(service.snapshot()), JSON.stringify([...values])].join('\n');
  for (const secret of [PASSWORD, MASTER]) {
    assert.equal(outside.includes(secret), false, 'a typed secret reached data the window or disk can see');
    // Only the two successful and two refused host requests carried it.
    assert.equal(sent.filter(wire => wire.includes(secret)).length, 2);
  }
});
