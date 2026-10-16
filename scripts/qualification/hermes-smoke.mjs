#!/usr/bin/env node
// Disposable loopback host only. Provider-free refusal exercise, not a successful AI turn.
// Test encryption adapter only: this does not qualify Electron safeStorage.
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
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
const repository = await createProtectedRepository({ directory, platform: process.platform, protection: {
  isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'gnome_libsecret',
  encryptString(value) { const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', key, iv); return Buffer.concat([iv, c.update(value, 'utf8'), c.final(), c.getAuthTag()]); },
  decryptString(value) { const b = Buffer.from(value), d = createDecipheriv('aes-256-gcm', key, b.subarray(0, 12)); d.setAuthTag(b.subarray(-16)); return Buffer.concat([d.update(b.subarray(12, -16)), d.final()]).toString('utf8'); },
} });
let updates = 0;
const service = createDesktopService({ repository, connect: options => connectGateway({ ...options, socket: connectSocket }), onChange() { updates++; } });
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
  result = await service.handle({ kind: 'newChat', generation: s.generation, profile: s.data.agents[0].id });
  assert.equal(result.ok, true, 'Session creation');
  s = service.snapshot(); assert.ok(s.canSend, 'History reconciled before send');
  const chatId = s.selectedChatId;
  result = await service.handle({ kind: 'draft', generation: s.generation, chatId, text: 'Synthetic client integration check; no AI provider configured.' });
  assert.equal(result.ok, true, 'Draft persisted');
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
  console.log(JSON.stringify({ passed: true, profiles, updates, workspace: ['projects', 'usage', 'scheduled'], evidence: 'Disposable real Hermes; provider-free failure; synthetic encryption adapter' }, null, 2));
} finally { service.dispose(); await repository.close(); key.fill(0); await rm(directory, { recursive: true, force: true }); }
