import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeRpcFrame, encodeBoundedJson, encodeServerReply, rpcId, RPC_LIMITS, RpcProtocolError } from '../packages/contracts/rpc.ts';
import { encodeProbe, encodeTextRequest, parseGatewayCapabilities } from '../packages/contracts/rpc-methods.ts';

const result = (id = 'rpc-1', value = { status: 'streaming' }) => JSON.stringify({ jsonrpc: '2.0', id, result: value });
const event = params => JSON.stringify({ jsonrpc: '2.0', method: 'event', params });

test('newline framing preserves exact IDs, streaming, and additive inert metadata', () => {
  const frames = decodeRpcFrame(` \r\n${result('e\u0301', { status: 'streaming', future: { value: '😀' } })}\n${event({ type: 'message.delta', session_id: 'runtime', seq: 12, payload: {} })}\n`);
  assert.equal(frames.length, 2);
  assert.equal(frames[0].id, 'e\u0301');
  assert.equal(frames[0].result.status, 'streaming');
  assert.equal(frames[1].params.seq, 12);
  assert.ok(Object.isFrozen(frames[0].result.future));
  assert.throws(() => { frames[0].result.status = 'complete'; }, TypeError);
  assert.equal(decodeRpcFrame(result('', null))[0].id, ''); // Upstream permits empty string IDs.
});

test('ambiguous critical fields, escaped duplicates, and nested duplicates are rejected', () => {
  for (const text of [
    '{"jsonrpc":"2.0","id":"a","id":"b","result":{}}',
    '{"jsonrpc":"2.0","id":"a","\\u0069d":"b","result":{}}',
    '{"jsonrpc":"2.0","id":"a","result":{"status":"streaming","status":"complete"}}',
    '{"jsonrpc":"2.0","id":"a","result":null,"error":{"code":1,"message":"x"}}',
    '{"jsonrpc":"2.0","id":"a","method":"clarify","result":{}}',
    '{"jsonrpc":"2.0","id":"a","result":{},"params":{}}',
    '{"jsonrpc":"2.0","method":"event","id":null,"params":{"type":"gateway.ready"}}',
    '{"jsonrpc":"2.0","id":1,"result":{}}',
    '[{"jsonrpc":"2.0","id":"a","result":{}}]',
    '{"jsonrpc":"2.0","method":"clarify"}',
    '{"jsonrpc":"2.0","id":"a","method":"bad method"}',
    '{"jsonrpc":"2.0","id":"a","result":1e999}',
    '{"jsonrpc":"2.0","id":"a","result":9007199254740993}',
    '{"jsonrpc":"2.0","id":"a","result":"\\ud800"}',
    '{"jsonrpc":"2.0","id":"a","result":01}',
    '{"jsonrpc":"2.0","id":"a","result":{},}',
    '\n \t\r', 'null', 'false', '{} garbage',
  ]) assert.throws(() => decodeRpcFrame(text), RpcProtocolError, text);
});

test('inbound frame, line count, depth, IDs, methods and Unicode use hard bounds', () => {
  assert.throws(() => decodeRpcFrame(' '.repeat(RPC_LIMITS.inboundBytes + 1)), RpcProtocolError);
  assert.throws(() => decodeRpcFrame('😀'.repeat(RPC_LIMITS.inboundBytes / 4 + 1)), RpcProtocolError);
  assert.throws(() => decodeRpcFrame(new Uint8Array([123, 125])), RpcProtocolError);
  assert.equal(decodeRpcFrame(Array(RPC_LIMITS.lineObjects).fill(result()).join('\n')).length, RPC_LIMITS.lineObjects);
  assert.throws(() => decodeRpcFrame(Array(RPC_LIMITS.lineObjects + 1).fill(result()).join('\n')), RpcProtocolError);
  const nested = depth => `{"jsonrpc":"2.0","id":"a","result":${'['.repeat(depth)}0${']'.repeat(depth)}}`;
  assert.equal(decodeRpcFrame(nested(63)).length, 1);
  assert.throws(() => decodeRpcFrame(nested(64)), RpcProtocolError);
  assert.equal(rpcId('😀'.repeat(256)).length, 512);
  assert.throws(() => rpcId('😀'.repeat(257)), RpcProtocolError);
  assert.throws(() => decodeRpcFrame(JSON.stringify({ jsonrpc: '2.0', id: 'a', method: 'm'.repeat(257) })), RpcProtocolError);
});

test('events and request.cancel require typed exact routing fields', () => {
  const good = { type: 'request.cancel', payload: { id: 'q', method: 'clarify', reason: 'expired' } };
  assert.equal(decodeRpcFrame(event(good))[0].params.payload.id, 'q');
  for (const params of [
    { type: 'gateway.ready', payload: null }, { type: 'x', session_id: 4 },
    { type: 'x', seq: 1.5 }, { type: '' },
    { ...good, payload: { ...good.payload, extra: true } },
    { ...good, payload: { id: 'q', method: 'clarify' } },
    { ...good, payload: { ...good.payload, reason: 'x'.repeat(4097) } },
  ]) assert.throws(() => decodeRpcFrame(event(params)), RpcProtocolError);
});

test('error classification retains integer code, bounded message and machine reason', () => {
  const frame = decodeRpcFrame(JSON.stringify({ jsonrpc: '2.0', id: 'q', error: {
    code: 4090, message: 'Busy', data: { reason: 'MAX_CONCURRENT_SESSIONS', extra: true },
  } }))[0];
  assert.deepEqual(frame, { kind: 'error', id: 'q', code: 4090, message: 'Busy', reason: 'MAX_CONCURRENT_SESSIONS' });
  for (const error of [{ code: 1.1, message: 'x' }, { code: 1, message: 'x'.repeat(4097) }, { code: 1 }]) {
    assert.throws(() => decodeRpcFrame(JSON.stringify({ jsonrpc: '2.0', id: 'q', error })), RpcProtocolError);
  }
});

test('outbound encoding is bounded before full serialization and has no toJSON or accessor execution', () => {
  let called = false;
  assert.throws(() => encodeBoundedJson({ toJSON() { called = true; } }, 100), RpcProtocolError);
  assert.throws(() => encodeBoundedJson({ get value() { called = true; } }, 100), RpcProtocolError);
  assert.equal(called, false);
  const cycle = {}; cycle.self = cycle;
  for (const value of [cycle, new Date(), undefined, NaN, Infinity, 1n, '\ud800', new Array(5)]) {
    assert.throws(() => encodeBoundedJson(value, 100), RpcProtocolError);
  }
  const encoded = encodeBoundedJson({ value: '\u0000"\\😀' }, 100);
  assert.equal(JSON.parse(encoded).value, '\u0000"\\😀');
  assert.throws(() => encodeBoundedJson('\u0000'.repeat(20), 100), RpcProtocolError);
  assert.equal(encodeBoundedJson('😀', 6), '"😀"');
  assert.throws(() => encodeBoundedJson('😀', 5), RpcProtocolError);
  const prototype = decodeRpcFrame('{"jsonrpc":"2.0","id":"q","result":{"__proto__":{"polluted":true}}}')[0].result;
  assert.equal(Object.getPrototypeOf(prototype), null);
  assert.equal({}.polluted, undefined);
});

test('server response ID cannot be overridden, normalized or regenerated by handler output', () => {
  assert.equal(JSON.parse(encodeServerReply('e\u0301', { result: {} })).id, 'e\u0301');
  for (const reply of [
    { id: 'forged', result: {} }, { jsonrpc: '3.0', result: {} },
    { result: {}, error: { code: 1, message: 'x' } }, { method: 'clarify', result: {} },
    { error: { code: 1, message: '' } },
  ]) assert.throws(() => encodeServerReply('original', reply), RpcProtocolError);
  assert.throws(() => encodeServerReply('q', { result: 'x'.repeat(RPC_LIMITS.serverResponseBytes) }), RpcProtocolError);
});

test('finite method builders reject arbitrary operations and extra text fields', () => {
  assert.deepEqual(JSON.parse(encodeProbe('a', 'client.capabilities')).params, { server_requests: true });
  for (const method of ['gateway.capabilities', 'gateway.ping']) assert.deepEqual(JSON.parse(encodeProbe('a', method)).params, {});
  assert.throws(() => encodeProbe('a', 'shell.exec'), RpcProtocolError);
  const request = { jsonrpc: '2.0', id: 'a', method: 'prompt.submit', params: { session_id: 'runtime', profile: 'default', text: 'Hello' } };
  assert.deepEqual(JSON.parse(encodeTextRequest(request)), request);
  for (const input of [
    { ...request, method: 'session.interrupt' }, { ...request, extra: true },
    { ...request, params: { ...request.params, queued: true } },
    { ...request, params: { ...request.params, text: 'x'.repeat(1024 * 1024 + 1) } },
  ]) assert.throws(() => encodeTextRequest(input), RpcProtocolError);
  assert.deepEqual(parseGatewayCapabilities({ per_session_exclusive_submit: false, future: true }), { perSessionExclusiveSubmit: false });
  assert.throws(() => parseGatewayCapabilities({ per_session_exclusive_submit: 'true' }), RpcProtocolError);
});
