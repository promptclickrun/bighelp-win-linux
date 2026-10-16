// Main-process only. Never expose this adapter or its protection provider to IPC.
import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, rename, rmdir, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { join, resolve, parse } from 'node:path';
import type { JsonValue } from '../contracts/rpc.ts';
export type { JsonValue } from '../contracts/rpc.ts';

export interface StringProtection {
  isEncryptionAvailable(): boolean;
  getSelectedStorageBackend?(): string;
  encryptString(value: string): Uint8Array;
  decryptString(value: Uint8Array): string;
}
export type ProtectedValue = Readonly<{ revision: number; value: JsonValue }>;
const MAX_JSON_BYTES = 1024 * 1024;
const MAX_FILE_BYTES = MAX_JSON_BYTES + 64 * 1024;
const missing = (error: unknown) => error instanceof Error && 'code' in error && error.code === 'ENOENT';
function keyName(key: string): string {
  if (typeof key !== 'string' || !key.length || Buffer.byteLength(key) > 1024 || !key.isWellFormed()) throw Error('Invalid repository key');
  return `${createHash('sha256').update(key).digest('hex')}.enc`;
}
function validateJson(value: unknown, depth = 0, budget = { remaining: 100_000 }): asserts value is JsonValue {
  if (--budget.remaining < 0 || depth > 64) throw Error('JSON complexity limit');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (typeof value !== 'object' || value === null) throw Error('Invalid JSON value');
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw Error('Invalid JSON object');
  if (Object.getOwnPropertySymbols(value).length) throw Error('Invalid JSON properties');
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !('value' in descriptor)) throw Error('Invalid JSON array');
      validateJson(descriptor.value, depth + 1, budget);
    }
  } else {
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
      if (!descriptor.enumerable || !('value' in descriptor)) throw Error('Invalid JSON properties');
      validateJson(descriptor.value, depth + 1, budget);
    }
  }
}
async function safeDirectory(directory: string): Promise<string> {
  const absolute = resolve(directory);
  let current = parse(absolute).root;
  for (const component of absolute.slice(current.length).split(/[\\/]/).filter(Boolean)) {
    current = join(current, component);
    try { await mkdir(current, { mode: 0o700 }); } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
    }
    const stat = await lstat(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw Error('Unsafe repository directory');
  }
  return realpath(absolute);
}

export async function createProtectedRepository(options: { directory: string; protection: StringProtection; platform: NodeJS.Platform }) {
  const { protection, platform } = options;
  function requireProtection() {
    if (!protection.isEncryptionAvailable() || (platform === 'linux' &&
      (!protection.getSelectedStorageBackend || protection.getSelectedStorageBackend() === 'basic_text'))) throw Error('Secure protection unavailable');
  }
  requireProtection();
  const directory = await safeDirectory(options.directory);
  const lock = join(directory, '.repository.lock');
  const ownerPath = join(lock, 'owner');
  type LockOwner = { pid: number; nonce: string };
  async function readOwner(): Promise<LockOwner> {
    const file = await open(ownerPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | constants.O_NONBLOCK);
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > 256) throw Error('Invalid lock owner');
      const buffer = Buffer.alloc(257);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
      if (bytesRead > 256) throw Error('Invalid lock owner');
      const owner: unknown = JSON.parse(buffer.subarray(0, bytesRead).toString('utf8'));
      if (!owner || typeof owner !== 'object' || !('pid' in owner) || !('nonce' in owner) ||
        typeof owner.pid !== 'number' || !Number.isSafeInteger(owner.pid) || owner.pid < 1 ||
        typeof owner.nonce !== 'string' || !/^[a-f0-9-]{36}$/.test(owner.nonce)) throw Error('Invalid lock owner');
      return { pid: owner.pid, nonce: owner.nonce };
    } finally { await file.close(); }
  }
  function isDead(pid: number): boolean {
    try { process.kill(pid, 0); return false; } catch (error) {
      return error instanceof Error && 'code' in error && error.code === 'ESRCH';
    }
  }
  async function reclaimDeadOwner(): Promise<void> {
    const before = await lstat(lock);
    if (!before.isDirectory() || before.isSymbolicLink()) throw Error('Invalid lock');
    const owner = await readOwner();
    if (!isDead(owner.pid)) throw Error('Live or ambiguous owner');
    // Claim inside the old directory: no other reclaimer can unlink it, and no
    // new owner can acquire it until our final rmdir. Never steal a claim.
    const claim = join(lock, 'reclaim');
    await mkdir(claim, { mode: 0o700 });
    const after = await lstat(lock);
    const confirmed = await readOwner();
    if (before.dev !== after.dev || before.ino !== after.ino || owner.pid !== confirmed.pid ||
      owner.nonce !== confirmed.nonce || !isDead(confirmed.pid)) throw Error('Lock ownership changed');
    await unlink(ownerPath);
    await rmdir(claim);
    await rmdir(lock);
  }
  try { await mkdir(lock, { mode: 0o700 }); } catch {
    try { await reclaimDeadOwner(); await mkdir(lock, { mode: 0o700 }); }
    catch { throw Error('Repository locked'); }
  }
  const owner: LockOwner = { pid: process.pid, nonce: randomUUID() };
  // Incomplete metadata fails closed rather than guessing that a lock is stale.
  const ownerFile = await open(ownerPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
  try { await ownerFile.writeFile(JSON.stringify(owner)); await ownerFile.sync(); } finally { await ownerFile.close(); }
  const ownedLock = await lstat(lock);
  let closed = false;
  let tail: Promise<unknown> = Promise.resolve();
  function serialized<T>(operation: () => Promise<T>): Promise<T> {
    const result = tail.then(async () => {
      if (closed) throw Error('Repository closed');
      requireProtection();
      return operation();
    });
    tail = result.catch(() => undefined);
    return result;
  }
  async function readValue(key: string): Promise<ProtectedValue | null> {
    const filename = join(directory, keyName(key));
    let stat;
    try { stat = await lstat(filename); } catch (error) { if (missing(error)) return null; throw error; }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > MAX_FILE_BYTES) throw Error('Invalid protected file');
    const file = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | constants.O_NONBLOCK);
    let bytes: Buffer;
    try {
      const actual = await file.stat();
      if (!actual.isFile() || actual.dev !== stat.dev || actual.ino !== stat.ino || actual.size > MAX_FILE_BYTES) throw Error('Protected file changed');
      // Fixed allocation bounds reads even if another actor grows the file.
      const buffer = Buffer.alloc(MAX_FILE_BYTES + 1);
      let length = 0;
      while (length < buffer.length) {
        const result = await file.read(buffer, length, buffer.length - length, length);
        if (!result.bytesRead) break;
        length += result.bytesRead;
      }
      if (!length || length > MAX_FILE_BYTES) throw Error('Protected file size limit');
      bytes = buffer.subarray(0, length);
    } finally { await file.close(); }
    const plaintext = protection.decryptString(bytes);
    if (typeof plaintext !== 'string' || Buffer.byteLength(plaintext) > MAX_JSON_BYTES) throw Error('Protected JSON size limit');
    // Bound nesting before JSON.parse to avoid pathological recursive inputs.
    let depth = 0, quoted = false, escaped = false;
    for (const character of plaintext) {
      if (quoted) { if (escaped) escaped = false; else if (character === '\\') escaped = true; else if (character === '"') quoted = false; }
      else if (character === '"') quoted = true;
      else if (character === '{' || character === '[') { if (++depth > 68) throw Error('JSON depth limit'); }
      else if (character === '}' || character === ']') depth--;
    }
    const envelope: unknown = JSON.parse(plaintext);
    validateJson(envelope);
    if (!envelope || Array.isArray(envelope) || typeof envelope !== 'object') throw Error('Invalid protected envelope');
    const record = envelope as Record<string, JsonValue>;
    if (record['version'] !== 1 || record['key'] !== key ||
      typeof record['revision'] !== 'number' || !Number.isSafeInteger(record['revision']) || record['revision'] < 1 || !Object.hasOwn(record, 'value')) throw Error('Invalid protected envelope');
    return { revision: record['revision'], value: record['value']! };
  }
  function checkRevision(expected: number | null, current: ProtectedValue | null) {
    if (expected !== null && (!Number.isSafeInteger(expected) || expected < 1)) throw Error('Invalid expected revision');
    if ((current?.revision ?? null) !== expected) throw Error('Repository revision conflict');
  }
  return {
    read(key: string) { return serialized(() => readValue(key)); },
    write(key: string, expectedRevision: number | null, value: unknown): Promise<ProtectedValue> {
      // Snapshot synchronously: later caller mutations cannot alter a queued commit.
      let snapshot: JsonValue;
      try {
        keyName(key); validateJson(value);
        const text = JSON.stringify(value);
        if (Buffer.byteLength(text) > MAX_JSON_BYTES) throw Error('JSON size limit');
        snapshot = JSON.parse(text) as JsonValue;
      } catch (error) { return Promise.reject(error); }
      return serialized(async () => {
        const current = await readValue(key);
        checkRevision(expectedRevision, current);
        const revision = (current?.revision ?? 0) + 1;
        if (!Number.isSafeInteger(revision)) throw Error('Revision exhausted');
        const plaintext = JSON.stringify({ version: 1, key, revision, value: snapshot });
        if (Buffer.byteLength(plaintext) > MAX_JSON_BYTES) throw Error('JSON size limit');
        const encrypted = protection.encryptString(plaintext);
        if (!(encrypted instanceof Uint8Array) || !encrypted.length || encrypted.length > MAX_FILE_BYTES) throw Error('Invalid encrypted output');
        const temporary = join(directory, `.${randomUUID()}.tmp`);
        let created = false;
        try {
          const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
          created = true;
          try { await file.writeFile(encrypted); await file.sync(); } finally { await file.close(); }
          await rename(temporary, join(directory, keyName(key)));
          created = false;
        } finally { if (created) await unlink(temporary); }
        return { revision, value: snapshot };
      });
    },
    remove(key: string, expectedRevision: number | null): Promise<void> {
      return serialized(async () => {
        const current = await readValue(key);
        checkRevision(expectedRevision, current);
        if (current) await unlink(join(directory, keyName(key)));
      });
    },
    close(): Promise<void> {
      const result = tail.then(async () => {
        if (!closed) {
          closed = true;
          const currentLock = await lstat(lock);
          const currentOwner = await readOwner();
          if (ownedLock.dev !== currentLock.dev || ownedLock.ino !== currentLock.ino ||
            currentOwner.pid !== owner.pid || currentOwner.nonce !== owner.nonce) throw Error('Lock ownership changed');
          await unlink(ownerPath);
          await rmdir(lock);
        }
      });
      tail = result.catch(() => undefined);
      return result;
    },
  };
}
