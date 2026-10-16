import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { setImmediate as turn } from 'node:timers/promises';
import { connectSocket } from '../packages/platform/socket-transport.ts';

const MAX = 4 * 1024 * 1024;
function frame(opcode, bytes = Buffer.alloc(0), final = true) {
 const data = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
 const prefix = data.length < 126 ? 2 : data.length < 65536 ? 4 : 10;
 const head = Buffer.alloc(prefix); head[0] = (final ? 128 : 0) | opcode;
 head[1] = prefix === 2 ? data.length : prefix === 4 ? 126 : 127;
 if (prefix === 4) head.writeUInt16BE(data.length, 2);
 if (prefix === 10) head.writeBigUInt64BE(BigInt(data.length), 2);
 return Buffer.concat([head, data]);
}
function accept(req, socket, options = {}) {
 const nonce = createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
 const protocol = options.protocol ?? (req.headers['sec-websocket-protocol'] ? 'hermes-gateway-v1' : undefined);
 socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
  + `Sec-WebSocket-Accept: ${options.accept ?? nonce}\r\n`
  + (protocol ? `Sec-WebSocket-Protocol: ${protocol}\r\n` : '') + (options.extra ?? '') + '\r\n');
}
async function fixture(t, handler) {
 const sockets = new Set();
 const server = createServer();
 server.on('connection', socket => { sockets.add(socket); socket.on('error', () => {}); socket.on('close', () => sockets.delete(socket)); });
 server.on('upgrade', handler);
 await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
 t.after(async () => { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); });
 return { url: `ws://127.0.0.1:${server.address().port}/api/ws`, headers: {}, protocols: [], followRedirects: false, cookies: 'omit' };
}
function client(plan) {
 const abort = new AbortController(), frames = [];
 let count = 0, done;
 const closed = new Promise(resolve => { done = resolve; });
 const opening = connectSocket(plan, abort.signal, value => frames.push(value), () => { count++; done(); });
 return { abort, frames, opening, closed, get count() { return count; } };
}
function readClientFrames(socket, callback) {
 let pending = Buffer.alloc(0);
 socket.on('data', chunk => {
  pending = Buffer.concat([pending, chunk]);
  while (pending.length >= 2) {
   const marker = pending[1] & 127, prefix = marker < 126 ? 2 : marker === 126 ? 4 : 10;
   if (pending.length < prefix + 4) return;
   const size = prefix === 2 ? marker : prefix === 4 ? pending.readUInt16BE(2) : Number(pending.readBigUInt64BE(2));
   if (pending.length < prefix + 4 + size) return;
   assert.ok(pending[1] & 128, 'Every client frame is masked');
   const mask = pending.subarray(prefix, prefix + 4), data = Buffer.from(pending.subarray(prefix + 4, prefix + 4 + size));
   for (let i = 0; i < size; i++) data[i] ^= mask[i % 4];
   const opcode = pending[0] & 15; pending = pending.subarray(prefix + 4 + size); callback(opcode, data);
  }
 });
}

test('real upgrade forwards same-origin proxy headers, fragments UTF-8, masks sends and pongs', async t => {
 let request, peer, pongDone, textDone;
 const pong = new Promise(resolve => { pongDone = resolve; }), sent = new Promise(resolve => { textDone = resolve; });
 const plan = await fixture(t, (req, socket) => {
  request = req; peer = socket; accept(req, socket);
  readClientFrames(socket, (op, data) => { if (op === 10) pongDone(data.toString()); if (op === 1) textDone(data.toString()); });
 });
 plan.headers = { Authorization: 'Basic cHJveHk6c2VjcmV0', 'X-Hermes-Session-Token': 'synthetic', 'X-Proxy-Key': 'synthetic-proxy' };
 plan.url += '?token=synthetic';
 const c = client(plan), handle = await c.opening;
 assert.equal(request.url, '/api/ws?token=synthetic');
 assert.equal(request.headers.authorization, plan.headers.Authorization);
 assert.equal(request.headers['x-proxy-key'], 'synthetic-proxy');
 assert.equal(request.headers.cookie, undefined);
 assert.equal(request.headers['sec-websocket-extensions'], undefined);
 assert.equal(request.headers['sec-websocket-protocol'], undefined);
 const encoded = Buffer.from('hello 🌍');
 peer.write(frame(1, encoded.subarray(0, 8), false)); peer.write(frame(9, 'ping'));
 peer.write(frame(0, encoded.subarray(8)));
 handle.send('outgoing');
 assert.equal(await pong, 'ping'); assert.equal(await sent, 'outgoing');
 for (let i = 0; i < 20 && c.frames.length === 0; i++) await turn();
 assert.deepEqual(c.frames, ['hello 🌍']);
 handle.close(); handle.close(); c.abort.abort(); await c.closed; assert.equal(c.count, 1);
});

test('provider selects only gateway protocol, fresh keys, cookie jar absent', async t => {
 const keys = [], cookies = [];
 const plan = await fixture(t, (req, socket) => {
  keys.push(req.headers['sec-websocket-key']); cookies.push(req.headers.cookie);
  assert.equal(req.headers['sec-websocket-protocol'], 'hermes-gateway-v1,hermes-gateway-ticket.synthetic');
  accept(req, socket, { extra: 'Set-Cookie: synthetic=value\r\n' });
 });
 plan.protocols = ['hermes-gateway-v1', 'hermes-gateway-ticket.synthetic']; plan.ticketExpiresAt = performance.now() + 10000;
 for (let i = 0; i < 2; i++) { const c = client(plan); await c.opening; c.abort.abort(); await c.closed; }
 assert.notEqual(keys[0], keys[1]); assert.deepEqual(cookies, [undefined, undefined]);
});

test('rejects failed, duplicate, extended, redirected and wrong-subprotocol handshakes', async t => {
 const cases = [
  { accept: 'wrong' }, { extra: 'Sec-WebSocket-Accept: duplicate\r\n' },
  { extra: 'Sec-WebSocket-Extensions: permessage-deflate\r\n' }, { protocol: 'unrequested' },
  { extra: 'Connection: Upgrade\r\n' }, { redirect: true }, { status: true },
  { provider: true, protocol: 'hermes-gateway-ticket.synthetic' }, { provider: true, protocol: '' },
 ];
 for (const options of cases) await t.test(JSON.stringify(options), async t => {
  let requests = 0;
  const plan = await fixture(t, (req, socket) => {
   requests++;
   if (options.redirect) socket.end('HTTP/1.1 302 Found\r\nLocation: /secret-target\r\nContent-Length: 0\r\n\r\n');
   else if (options.status) socket.end('HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n');
   else accept(req, socket, options);
  });
  if (options.provider) { plan.protocols = ['hermes-gateway-v1', 'hermes-gateway-ticket.synthetic']; plan.ticketExpiresAt = performance.now() + 10000; }
  const c = client(plan); await assert.rejects(c.opening, { message: 'Socket unavailable' }); await c.closed;
  assert.equal(requests, 1); assert.equal(c.count, 1); assert.deepEqual(c.frames, []);
 });
});

test('rejects oversized declared lengths before payload, invalid UTF-8, binary and framing violations', async t => {
 const enormous = Buffer.alloc(10); enormous[0] = 129; enormous[1] = 127; enormous.writeBigUInt64BE(BigInt(MAX + 1), 2);
 const cases = [enormous, frame(2, 'binary'), frame(1, Buffer.from([0xc3, 0x28])),
  Buffer.from([0x81, 0x80, 0, 0, 0, 0]), Buffer.from([0xc1, 0]), frame(3), frame(0),
  frame(9, 'ping', false), Buffer.from([0x89, 126, 0, 126]), frame(8, Buffer.from([1])),
  frame(8, Buffer.from([3, 237])), frame(8, Buffer.from([3, 232, 0xc3, 0x28])),
  Buffer.concat([frame(1, 'unfinished', false), frame(1, 'new message')]),
 ];
 for (const [index, invalid] of cases.entries()) await t.test(String(index), async t => {
  let peer;
  const plan = await fixture(t, (req, socket) => { peer = socket; accept(req, socket); });
  const c = client(plan); await c.opening; peer.write(invalid); await c.closed;
  assert.deepEqual(c.frames, []); assert.equal(c.count, 1); c.abort.abort();
 });
});

test('fragment count and aggregate size are bounded', async t => {
 for (const mode of ['fragments', 'bytes']) await t.test(mode, async t => {
  let peer;
  const plan = await fixture(t, (req, socket) => { peer = socket; accept(req, socket); });
  const c = client(plan); await c.opening;
  if (mode === 'fragments') peer.write(Buffer.concat([frame(1, '', false), ...Array.from({ length: 4096 }, () => frame(0, '', false))]));
  else { peer.write(frame(1, Buffer.alloc(MAX), false)); peer.write(frame(0, 'x')); }
  await c.closed; assert.deepEqual(c.frames, []);
 });
});

test('expired tickets, cookie injection, already-aborted signals dispatch no requests', async t => {
 let requests = 0;
 const base = await fixture(t, () => { requests++; });
 const invalid = [
  { ...base, protocols: ['hermes-gateway-v1', 'hermes-gateway-ticket.synthetic'], ticketExpiresAt: performance.now() - 1 },
  { ...base, headers: { Cookie: 'synthetic' } },
  { ...base, headers: { Host: 'wrong-origin' } },
 ];
 for (const plan of invalid) { const c = client(plan); await assert.rejects(c.opening, { message: 'Socket unavailable' }); assert.equal(c.count, 1); }
 const controller = new AbortController(); controller.abort();
 await assert.rejects(connectSocket(base, controller.signal, () => {}, () => {}), { message: 'Socket unavailable' });
 assert.equal(requests, 0);
});

test('abort while opening, peer disconnect, and bounded outgoing queue notify once', async t => {
 for (const mode of ['opening', 'disconnect', 'outgoing']) await t.test(mode, async t => {
  let peer;
  const plan = await fixture(t, (req, socket) => { peer = socket; if (mode !== 'opening') accept(req, socket); });
  const c = client(plan);
  if (mode === 'opening') { c.abort.abort(); await assert.rejects(c.opening, { message: 'Socket unavailable' }); }
  else {
   const handle = await c.opening;
   if (mode === 'disconnect') peer.destroy();
   else {
    handle.send('x'.repeat(MAX));
    assert.throws(() => handle.send('another'), { message: 'Socket unavailable' });
   }
  }
  await c.closed; c.abort.abort(); await turn(); assert.equal(c.count, 1);
 });
});

test('heartbeat uses a matching pong and terminates an unresponsive live socket', async t => {
 let peer, pingDone;
 const ping = new Promise(resolve => { pingDone = resolve; });
 const plan = await fixture(t, (req, socket) => {
  peer = socket; accept(req, socket);
  readClientFrames(socket, (op, data) => { if (op === 9) pingDone(data); });
 });
 t.mock.timers.enable({ apis: ['setTimeout'] });
 const c = client(plan); await c.opening;
 t.mock.timers.tick(30000);
 const token = await ping;
 peer.write(frame(10, token));
 for (let i = 0; i < 20; i++) await turn();
 t.mock.timers.tick(20000); assert.equal(c.count, 0);
 t.mock.timers.tick(10000);
 for (let i = 0; i < 20; i++) await turn();
 t.mock.timers.tick(20000); await c.closed; assert.equal(c.count, 1);
});

test('absolute handshake deadline closes a peer that never upgrades', async t => {
 let arrived;
 const received = new Promise(resolve => { arrived = resolve; });
 const plan = await fixture(t, () => arrived());
 t.mock.timers.enable({ apis: ['setTimeout'] });
 const c = client(plan);
 const rejected = assert.rejects(c.opening, { message: 'Socket unavailable' });
 await received; t.mock.timers.tick(20000); await rejected; await c.closed;
 assert.equal(c.count, 1);
});

test('incremental frame headers and close reply preserve exact payload', async t => {
 let peer, finished;
 const reply = new Promise(resolve => { finished = resolve; });
 const plan = await fixture(t, (req, socket) => {
  peer = socket; accept(req, socket);
  readClientFrames(socket, (opcode, data) => { if (opcode === 8) { finished(data); socket.end(); } });
 });
 const c = client(plan); await c.opening;
 const wire = frame(1, 'x'.repeat(126));
 for (const byte of wire.subarray(0, 4)) { peer.write(Buffer.from([byte])); await turn(); }
 peer.write(wire.subarray(4));
 const goodbye = Buffer.concat([Buffer.from([3, 232]), Buffer.from('done')]);
 peer.write(frame(8, goodbye));
 assert.deepEqual(await reply, goodbye); await c.closed;
 assert.deepEqual(c.frames, ['x'.repeat(126)]); assert.equal(c.count, 1);
});
