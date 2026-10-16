#!/usr/bin/env node
// Disposable loopback host only. Provider-free refusal exercise, not a successful AI turn.
// Test encryption adapter only: this does not qualify Electron safeStorage.
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { createDisplayCache } from '../../packages/platform/display-cache.ts';
import { createProtectedRepository } from '../../packages/platform/protected-repository.ts';
import { connectGateway } from '../../packages/hermes-client/gateway.ts';
import { connectSocket } from '../../packages/platform/socket-transport.ts';
import { createDesktopService } from '../../apps/desktop/src/main/desktop-service.ts';
const [endpoint, tokenFile] = process.argv.slice(2);
if (!endpoint || !tokenFile || !/^http:\/\/127\.0\.0\.1:[0-9]+$/u.test(endpoint)) throw Error('Usage: hermes-smoke.mjs http://127.0.0.1:PORT SYNTHETIC_TOKEN_FILE');
const token = (await readFile(tokenFile, 'utf8')).trim();
const modelResponse = await fetch(endpoint + '/api/model/options', { headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(10000) });
assert.equal(modelResponse.status, 200);
const model = await modelResponse.json();
assert.deepEqual(model.providers, [], 'Disposable host must have no provider before a prompt');
const directory = await mkdtemp(join(tmpdir(), 'bighelp-live-test-')), key = randomBytes(32);
const protection = {
  isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'gnome_libsecret',
  encryptString(value) { const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', key, iv); return Buffer.concat([iv, c.update(value, 'utf8'), c.final(), c.getAuthTag()]); },
  decryptString(value) { const b = Buffer.from(value), d = createDecipheriv('aes-256-gcm', key, b.subarray(0, 12)); d.setAuthTag(b.subarray(-16)); return Buffer.concat([d.update(b.subarray(12, -16)), d.final()]).toString('utf8'); },
};
const reopen = () => createProtectedRepository({ directory, platform: process.platform, protection });
let repository = await reopen();
let updates = 0;
let service = createDesktopService({ repository, connect: options => connectGateway({ ...options, socket: connectSocket }), onChange() { updates++; } });
try {
  let result = await service.handle({ kind: 'connect', host: { label: 'Disposable test', endpoint, authentication: 'dashboard', token, allowPrivateHttp: true } });
  assert.equal(result.ok, true, 'Host connection');
  let s = service.snapshot(); assert.ok(s.data.agents.length, 'At least one actual profile');
  const profiles = s.data.agents.length;
  for (const page of ['projects', 'usage', 'scheduled']) {
    result = await service.handle({ kind: 'workspace', generation: s.generation, profile: s.data.agents[0].id, page, days: 30 });
    assert.equal(result.ok, true, `${page} read action`);
    assert.equal(service.snapshot().workspace?.status, 'loaded', `${page} stock-host catalog`);
  }
  const profile = s.data.agents[0].id;
  result = await service.handle({ kind: 'canonicalChat', generation: service.snapshot().generation, profile, requestId: 'qualification-first' });
  assert.equal(result.ok, true, 'Canonical agent entry');
  const canonicalId = service.snapshot().selectedChatId;
  assert.ok(canonicalId, 'Actual canonical saved identity');
  result = await service.handle({ kind: 'canonicalChat', generation: service.snapshot().generation, profile, requestId: 'qualification-second' });
  assert.equal(result.ok, true, 'Repeated canonical agent entry');
  assert.equal(service.snapshot().selectedChatId, canonicalId, 'Canonical entries retain exact saved identity');
  result = await service.handle({ kind: 'newChat', generation: service.snapshot().generation, profile });
  assert.equal(result.ok, true, 'Session creation');
  s = service.snapshot(); assert.ok(s.canSend, 'History reconciled before send');
  const chatId = s.selectedChatId;
  assert.notEqual(chatId, canonicalId, 'Ordinary New chat stays distinct from canonical Bot Chat');
  result = await service.handle({ kind: 'draft', generation: s.generation, chatId, text: 'Synthetic client integration check; no AI provider configured.' });
  assert.equal(result.ok, true, 'Draft persisted');
  const beforePrompt = await fetch(endpoint + '/api/model/options', { headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(10000) });
  assert.equal(beforePrompt.status, 200);
  assert.deepEqual((await beforePrompt.json()).providers, [], 'Recheck zero configured providers immediately before prompt');
  result = await service.handle({ kind: 'send', generation: s.generation, chatId, text: 'Synthetic client integration check; no AI provider configured.' });
  assert.equal(result.ok, true, 'Streaming admission');
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline && (service.snapshot().running || !service.snapshot().canSend)) await new Promise(resolve => setTimeout(resolve, 100));
  s = service.snapshot(); assert.equal(s.running, false, 'Actual turn bookend'); assert.equal(s.canSend, true, 'History reconciled after turn');
  assert.equal(JSON.stringify(s).includes(token), false, 'No credentials in renderer snapshot');
  assert.ok(s.data.chats.find(c => c.id === chatId)?.transcript.some(item => item.kind === 'message' && item.direction === 'out'), 'Authoritative history retains prompt');
  await service.handle({ kind: 'disconnect' });
  result = await service.handle({ kind: 'connect', host: { label: 'Disposable test', endpoint, authentication: 'dashboard', token, allowPrivateHttp: true } });
  assert.equal(result.ok, true, 'Reconnect');
  result = await service.handle({ kind: 'openChat', generation: service.snapshot().generation, chatId });
  assert.equal(result.ok, true, 'Saved session resumes without re-send');
  // Wait for the independent display writer before simulating process exit.
  const ownerDeadline = Date.now() + 10000;
  let savedOwner;
  while (Date.now() < ownerDeadline && !(savedOwner = await repository.read('desktop:cacheOwner'))) await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(savedOwner, 'Encrypted verified cache owner persisted');
  const scope = { hostId: savedOwner.value.hostId, principalId: savedOwner.value.principalId };
  const cache = createDisplayCache(repository), cacheDeadline = Date.now() + 10000;
  let savedHistory;
  while (Date.now() < cacheDeadline) {
    savedHistory = (await cache.read(scope))?.data.sessions.find(row => row.storedSessionId === chatId);
    if (savedHistory?.transcript.some(item => item.kind === 'message' && item.direction === 'out')) break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.ok(savedHistory?.transcript.some(item => item.kind === 'message' && item.direction === 'out'), 'Authoritative provider-free history persisted');
  assert.equal(JSON.stringify(savedHistory).includes('delivery'), false, 'No pending or unknown optimistic cache rows');
  await service.shutdown(); await repository.close(); repository = await reopen();
  let rejectedConnections = 0;
  service = createDesktopService({ repository, connect: async () => { rejectedConnections++; throw Error('Synthetic rejected transport'); }, onChange() { updates++; } });
  await service.initialize();
  assert.equal(rejectedConnections, 1, 'Cold startup tried its saved connection once');
  assert.equal((await service.handle({ kind: 'openChat', generation: service.snapshot().generation, chatId })).ok, true, 'Cached saved history selection');
  s = service.snapshot();
  assert.equal(s.status, 'disconnected'); assert.equal(s.data.host.state, 'offline'); assert.equal(s.canSend, false); assert.equal(s.running, false); assert.deepEqual(s.prompts, []); assert.equal(s.workspace, null);
  assert.deepEqual(s.data.chats.find(row => row.id === chatId).transcript, savedHistory.transcript, 'Reopened protected authoritative history');
  assert.equal((await service.handle({ kind: 'send', generation: s.generation, chatId, text: 'Must stay offline' })).ok, false, 'No offline sends');
  assert.equal((await service.handle({ kind: 'canonicalChat', generation: s.generation, profile, requestId: 'offline-canonical' })).ok, false, 'No canonical lookup from cached agent');
  assert.equal(JSON.stringify(s).includes(token), false, 'Recovery snapshot contains no token');
  await service.handle({ kind: 'disconnect' }); await service.shutdown(); await repository.close(); repository = await reopen();
  let disconnectedConnections = 0;
  service = createDesktopService({ repository, connect: async () => { disconnectedConnections++; throw Error('Must not connect'); }, onChange() { updates++; } });
  await service.initialize(); assert.equal(disconnectedConnections, 0, 'Explicit disconnect survives process/repository reconstruction');
  assert.equal((await service.handle({ kind: 'openChat', generation: service.snapshot().generation, chatId })).ok, true, 'Disconnected startup still permits cached saved history');
  assert.equal(service.snapshot().canSend, false);
  console.log(JSON.stringify({ passed: true, profiles, updates, workspace: ['projects', 'usage', 'scheduled'], canonicalIdentityStable: true, ordinaryChatDistinct: true,
    offlineHistoryRestored: true, disconnectedAutomaticConnections: disconnectedConnections, evidence: 'Disposable real Hermes; provider-free failure; synthetic encryption adapter' }, null, 2));
} finally { await service.shutdown(); await repository.close(); key.fill(0); await rm(directory, { recursive: true, force: true }); }
