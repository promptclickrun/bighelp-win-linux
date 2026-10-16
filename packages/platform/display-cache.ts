// Main-process only. This disposable display cache is never runtime, prompt,
// selection, credential, send-journal or permission authority. No IPC adapter.
// See docs/contracts/STATE_AND_SECURITY.md §§2,4,5. Hermes owns saved history.
import { createHash } from 'node:crypto';
import type { createProtectedRepository } from './protected-repository.ts';
import { workspaceProfile } from '../contracts/workspace.ts';

export type DisplayCacheScope = Readonly<{ hostId: string; principalId: string }>;
export type CachedTranscriptItem =
  | Readonly<{ kind: 'day'; id: string; label: string }>
  | Readonly<{ kind: 'message'; id: string; direction: 'in' | 'out'; paragraphs: readonly string[]; bullets?: readonly string[] }>
  | Readonly<{ kind: 'tool'; id: string; label: string; detail: string }>;
export type CachedProfile = Readonly<{ profileId: string; name: string; summary: string; color: string }>;
export type CachedSession = Readonly<{
  profileId: string; storedSessionId: string; title: string; preview: string;
  // Local time when authoritative history was observed. Not host execution time,
  // a lease, freshness guarantee, or proof that a send completed.
  historyUpdatedAt: number; transcript: readonly CachedTranscriptItem[];
}>;
export type DisplayCacheData = Readonly<{
  hostLabel: string; profiles: readonly CachedProfile[]; sessions: readonly CachedSession[];
}>;
export type DisplayCacheRecord = Readonly<{ revision: number; data: DisplayCacheData }>;
type Repository = Pick<Awaited<ReturnType<typeof createProtectedRepository>>, 'read' | 'write'>;
const MAX_BYTES = 1024 * 1024;
const MAX_ROWS = 4096;
const invalid = (reason = 'data'): never => { throw new TypeError(`Invalid display cache ${reason}`); };
function object(value: unknown, keys: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.getOwnPropertySymbols(value).length || Object.keys(descriptors).some(key => !keys.includes(key) && !optional.includes(key))
    || keys.some(key => !Object.hasOwn(descriptors, key))) return invalid('fields');
  const result: Record<string, unknown> = Object.create(null);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!descriptor.enumerable || !('value' in descriptor)) return invalid('properties');
    result[key] = descriptor.value;
  }
  return result;
}
function array(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max || Object.getOwnPropertySymbols(value).length
    || Object.getOwnPropertyNames(value).length !== value.length + 1) return invalid('collection limit');
  return Array.from({ length: value.length }, (_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) return invalid('properties');
    return descriptor.value;
  });
}
function text(value: unknown, max: number, empty = true): string {
  if (typeof value !== 'string' || !value.isWellFormed() || Buffer.byteLength(value) > max
    || (!empty && !value.trim()) || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(value)) return invalid('text');
  return value;
}
function identity(value: unknown, max = 256): string {
  const result = text(value, max, false);
  if (result.trim() !== result || /\s/u.test(result)) return invalid('identity');
  return result;
}
function profile(value: unknown): string {
  try { return workspaceProfile(value); } catch { return invalid('profile identity'); }
}
function scopeCopy(value: unknown): DisplayCacheScope {
  const row = object(value, ['hostId', 'principalId']);
  return Object.freeze({ hostId: identity(row.hostId), principalId: identity(row.principalId) });
}
function keyFor(scope: DisplayCacheScope): string {
  // A version-independent key prevents downgrade writes from hiding newer data.
  return `display-cache:${createHash('sha256').update(JSON.stringify([scope.hostId, scope.principalId])).digest('hex')}`;
}
export function displayCacheKey(scope: DisplayCacheScope): string { return keyFor(scopeCopy(scope)); }
function unique<T>(values: T[], key: (item: T) => string): T[] {
  if (new Set(values.map(key)).size !== values.length) return invalid('duplicate identity');
  return values;
}
function freeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function dataCopy(value: unknown, stored = false): DisplayCacheData {
  const row = object(value, ['hostLabel', 'profiles', 'sessions']);
  let nodes = 0, bytes = 0, rowCount = 0;
  const countText = (value: unknown, max: number, empty = true) => {
    const result = text(value, max, empty);
    bytes += Buffer.byteLength(result); nodes++;
    if (bytes > 64 * MAX_BYTES || nodes > 60_000) return invalid('input limit');
    return result;
  };
  const profiles = unique(array(row.profiles, 256).map(value => {
    const item = object(value, ['profileId', 'name', 'summary', 'color']);
    return { profileId: profile(item.profileId), name: countText(item.name, 512, false),
      summary: countText(item.summary, 2048), color: countText(item.color, 32, false) };
  }), item => item.profileId);
  const knownProfiles = new Set(profiles.map(item => item.profileId));
  const sessions = unique(array(row.sessions, 256).map(value => {
    const item = object(value, ['profileId', 'storedSessionId', 'title', 'preview', 'historyUpdatedAt', 'transcript']);
    const profileId = profile(item.profileId), storedSessionId = identity(item.storedSessionId);
    if (!knownProfiles.has(profileId)) return invalid('unlisted profile');
    if (typeof item.historyUpdatedAt !== 'number' || !Number.isSafeInteger(item.historyUpdatedAt) || item.historyUpdatedAt < 0) return invalid('history observation time');
    const transcript = unique(array(item.transcript, stored ? 512 : 8192).map(value => {
      if (++rowCount > (stored ? MAX_ROWS : 16_384)) return invalid('history collection limit');
      const kind = object(value, ['kind', 'id'], ['label', 'detail', 'direction', 'paragraphs', 'bullets']).kind;
      if (kind === 'day') {
        const part = object(value, ['kind', 'id', 'label']);
        return { kind, id: identity(part.id, 512), label: countText(part.label, 512) } as const;
      }
      if (kind === 'tool') {
        const part = object(value, ['kind', 'id', 'label', 'detail']);
        return { kind, id: identity(part.id, 512), label: countText(part.label, 512), detail: countText(part.detail, 65536) } as const;
      }
      if (kind === 'message') {
        const part = object(value, ['kind', 'id', 'direction', 'paragraphs'], ['bullets']);
        if (part.direction !== 'in' && part.direction !== 'out') return invalid('message direction');
        return { kind, id: identity(part.id, 512), direction: part.direction,
          paragraphs: array(part.paragraphs, 64).map(value => countText(value, 65536)),
          ...(part.bullets === undefined ? {} : { bullets: array(part.bullets, 64).map(value => countText(value, 65536)) }) } as const;
      }
      return invalid('transcript kind');
    }), item => item.id);
    return { profileId, storedSessionId, title: countText(item.title, 512), preview: countText(item.preview, 2048),
      historyUpdatedAt: item.historyUpdatedAt, transcript };
  }), item => JSON.stringify([item.profileId, item.storedSessionId]));
  return { hostLabel: countText(row.hostLabel, 512, false), profiles, sessions };
}
function envelope(scope: DisplayCacheScope, data: DisplayCacheData) {
  return { version: 1, hostId: scope.hostId, principalId: scope.principalId, data };
}
function fits(key: string, scope: DisplayCacheScope, data: DisplayCacheData): boolean {
  // Include every repository-envelope byte, reserving the largest safe revision.
  return Buffer.byteLength(JSON.stringify({ version: 1, key, revision: Number.MAX_SAFE_INTEGER, value: envelope(scope, data) })) <= MAX_BYTES;
}
function trim(key: string, scope: DisplayCacheScope, data: DisplayCacheData): DisplayCacheData {
  const sessions = data.sessions.map(item => ({ ...item, transcript: item.transcript.slice(-512) }));
  const result = { ...data, sessions };
  const oldest = [...sessions].sort((left, right) => left.historyUpdatedAt - right.historyUpdatedAt
    || (left.profileId < right.profileId ? -1 : left.profileId > right.profileId ? 1 : 0)
    || (left.storedSessionId < right.storedSessionId ? -1 : left.storedSessionId > right.storedSessionId ? 1 : 0));
  let rows = sessions.reduce((count, item) => count + item.transcript.length, 0);
  let bytes = Buffer.byteLength(JSON.stringify({ version: 1, key, revision: Number.MAX_SAFE_INTEGER, value: envelope(scope, result) }));
  for (const session of oldest) {
    let remove = 0;
    while (remove < session.transcript.length && (rows > MAX_ROWS || bytes > MAX_BYTES)) {
      bytes -= Buffer.byteLength(JSON.stringify(session.transcript[remove])) + (session.transcript.length - remove > 1 ? 1 : 0);
      remove++; rows--;
    }
    session.transcript.splice(0, remove);
  }
  if (!fits(key, scope, result)) return invalid('catalog size limit');
  return freeze(result);
}
function decoded(scope: DisplayCacheScope, key: string, value: unknown): DisplayCacheData {
  const row = object(value, ['version', 'hostId', 'principalId', 'data']);
  if (row.version !== 1) return invalid('unsupported version');
  if (row.hostId !== scope.hostId || row.principalId !== scope.principalId) return invalid('scope identity');
  const data = dataCopy(row.data, true);
  if (!fits(key, scope, data)) return invalid('size limit');
  return freeze(data);
}

export function createDisplayCache(repository: Repository) {
  return Object.freeze({
    async read(input: DisplayCacheScope): Promise<DisplayCacheRecord | null> {
      const scope = scopeCopy(input), key = keyFor(scope), stored = await repository.read(key);
      return stored === null ? null : Object.freeze({ revision: stored.revision, data: decoded(scope, key, stored.value) });
    },
    async replace(input: DisplayCacheScope, expectedRevision: number | null, value: DisplayCacheData): Promise<DisplayCacheRecord> {
      // Synchronous validation/copy before the first await prevents caller edits
      // from changing a queued write. Never auto-retry CAS conflicts.
      const scope = scopeCopy(input), key = keyFor(scope), data = trim(key, scope, dataCopy(value));
      const current = await repository.read(key);
      // Preserve unsupported/corrupted existing data even with a matching CAS.
      if (current !== null) decoded(scope, key, current.value);
      if (expectedRevision !== null && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1)) return invalid('expected revision');
      if ((current?.revision ?? null) !== expectedRevision) throw Error('Display cache revision conflict');
      const saved = await repository.write(key, expectedRevision, envelope(scope, data));
      return Object.freeze({ revision: saved.revision, data });
    },
  });
}
