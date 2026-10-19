// Main-only records for the saved computer, in the protected repository.
// desktop:host        {version:2,label,origin,plainHttp,method}   (no secrets)
// desktop:credential  {version:1,origin,credential}               (tokens; main only)
// The credential is bound to the exact origin it was issued for. Never IPC.
import { parseEndpoint } from '../../../../packages/platform/transport-policy.ts';
import { validToken } from '../../../../packages/hermes-client/host-auth.ts';
import type { HostCredential, SignInMethod } from '../../../../packages/hermes-client/host-auth.ts';
import type { ProtectedValue } from '../../../../packages/platform/protected-repository.ts';
import type { JsonValue } from '../../../../packages/contracts/rpc.ts';
import { parseDesktopAction } from '../shared/desktop-api.ts';

export type HostRepository = Readonly<{
  read(key: string): Promise<ProtectedValue | null>;
  write(key: string, revision: number | null, value: JsonValue): Promise<ProtectedValue>;
  remove?(key: string, revision: number | null): Promise<void>;
}>;
export type HostRecord = Readonly<{ label: string; origin: string; plainHttp: boolean; method: SignInMethod }>;
// credential is null when it cannot be read; the person signs in again.
export type StoredHost = Readonly<{ record: HostRecord; credential: HostCredential | null }>;

const HOST = 'desktop:host', CREDENTIAL = 'desktop:credential';
const object = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const exact = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const identityText = (value: unknown, max: number) => value === null
  || (typeof value === 'string' && value.length > 0 && value.length <= max && value.isWellFormed() && !/[\x00-\x1f\x7f]/u.test(value));

export function hostLabel(value: unknown): string {
  if (typeof value !== 'string' || !value.isWellFormed() || /[\x00-\x1f\x7f]/u.test(value)) throw new TypeError('Invalid name');
  const label = value.trim();
  if (!label || label.length > 100) throw new TypeError('Invalid name');
  return label;
}
function origin(value: unknown, plainHttp: unknown): string {
  if (typeof value !== 'string' || typeof plainHttp !== 'boolean' || value.startsWith('http:') !== plainHttp) throw new TypeError('Invalid host');
  const endpoint = parseEndpoint(value, plainHttp ? value : undefined);
  if (endpoint.origin !== value) throw new TypeError('Invalid host');
  return value;
}
function parseRecord(value: unknown): HostRecord {
  const row = object(value);
  if (!row || !exact(row, ['version', 'label', 'origin', 'plainHttp', 'method']) || row.version !== 2
    || (row.method !== 'automatic' && row.method !== 'password' && row.method !== 'token')) throw new TypeError('Invalid host');
  return Object.freeze({ label: hostLabel(row.label), origin: origin(row.origin, row.plainHttp), plainHttp: row.plainHttp as boolean, method: row.method });
}
export function parseCredential(value: unknown): HostCredential {
  const row = object(value);
  if (row?.kind === 'dashboard' && exact(row, ['kind', 'token', 'automatic']) && validToken(row.token) && typeof row.automatic === 'boolean') {
    return Object.freeze({ kind: 'dashboard', token: row.token, automatic: row.automatic });
  }
  if (row?.kind === 'bearer' && exact(row, ['kind', 'accessToken', 'refreshToken', 'expiresAt', 'provider', 'userId'])
    && validToken(row.accessToken) && (row.refreshToken === null || validToken(row.refreshToken))
    && (row.expiresAt === null || (typeof row.expiresAt === 'number' && Number.isFinite(row.expiresAt) && row.expiresAt > 0))
    && identityText(row.provider, 256) && identityText(row.userId, 1024) && (row.provider === null) === (row.userId === null)) {
    return Object.freeze({ kind: 'bearer', accessToken: row.accessToken, refreshToken: row.refreshToken as string | null,
      expiresAt: row.expiresAt as number | null, provider: row.provider as string | null, userId: row.userId as string | null });
  }
  throw new TypeError('Invalid credential');
}
function credentialValue(credential: HostCredential): JsonValue {
  return credential.kind === 'dashboard' ? { kind: 'dashboard', token: credential.token, automatic: credential.automatic }
    : { kind: 'bearer', accessToken: credential.accessToken, refreshToken: credential.refreshToken, expiresAt: credential.expiresAt,
      provider: credential.provider, userId: credential.userId };
}
// Earlier builds stored the whole pasted-token form as desktop:host.
function legacy(value: unknown): StoredHost | null {
  const row = object(value);
  if (!row || !Object.hasOwn(row, 'endpoint')) return null;
  const action = parseDesktopAction({ kind: 'connect', host: value });
  if (action.kind !== 'connect') return null;
  const host = action.host;
  const endpoint = parseEndpoint(host.endpoint, host.allowPrivateHttp ? host.endpoint.replace(/\/$/u, '') : undefined);
  if (!validToken(host.token)) return null;
  const credential: HostCredential = host.authentication === 'dashboard'
    ? { kind: 'dashboard', token: host.token, automatic: false }
    : { kind: 'bearer', accessToken: host.token, refreshToken: null, expiresAt: null, provider: null, userId: null };
  return Object.freeze({ record: Object.freeze({ label: hostLabel(host.label), origin: endpoint.origin,
    plainHttp: endpoint.origin.startsWith('http:'), method: 'token' }), credential: Object.freeze(credential) });
}

export function createHostStore(repository: HostRepository) {
  // One writer for these keys; every write reads the current revision first.
  let tail: Promise<unknown> = Promise.resolve();
  function serial<T>(task: () => Promise<T>): Promise<T> {
    const result = tail.then(task);
    tail = result.catch(() => undefined);
    return result;
  }
  async function put(key: string, value: JsonValue): Promise<void> {
    const current = await repository.read(key);
    await repository.write(key, current?.revision ?? null, value);
  }
  async function drop(key: string): Promise<void> {
    const current = await repository.read(key);
    if (!current) return;
    if (repository.remove) await repository.remove(key, current.revision);
    else await repository.write(key, current.revision, null);
  }
  // The credential first: a host record never points at a missing sign-in.
  async function write(record: HostRecord, credential: HostCredential): Promise<void> {
    await put(CREDENTIAL, { version: 1, origin: record.origin, credential: credentialValue(credential) });
    await put(HOST, { version: 2, label: record.label, origin: record.origin, plainHttp: record.plainHttp, method: record.method });
  }
  async function readCredential(expectedOrigin: string): Promise<HostCredential | null> {
    const stored = await repository.read(CREDENTIAL);
    const row = object(stored?.value);
    if (!row || !exact(row, ['version', 'origin', 'credential']) || row.version !== 1 || row.origin !== expectedOrigin) return null;
    try { return parseCredential(row.credential); } catch { return null; }
  }
  return Object.freeze({
    load(): Promise<StoredHost | null> {
      return serial(async () => {
        const stored = await repository.read(HOST);
        if (!stored || stored.value === null) return null;
        const old = legacy(stored.value);
        if (old) {
          // Move the token out of the host record now: later renewals and account
          // checks compare against desktop:credential.
          try { if (old.credential) await write(old.record, old.credential); } catch { /* The next save retries. */ }
          return old;
        }
        const record = parseRecord(stored.value);
        return Object.freeze({ record, credential: await readCredential(record.origin) });
      });
    },
    save(record: HostRecord, credential: HostCredential): Promise<void> {
      return serial(() => write(record, credential));
    },
    // Compare-and-swap: only replaces exactly the sign-in the caller holds.
    rotate(origin: string, previous: HostCredential, next: HostCredential): Promise<void> {
      return serial(async () => {
        const stored = await readCredential(origin);
        if (!stored || JSON.stringify(stored) !== JSON.stringify(previous)) throw Error('Sign-in changed');
        await put(CREDENTIAL, { version: 1, origin, credential: credentialValue(next) });
      });
    },
    rename(origin: string, label: string): Promise<HostRecord> {
      return serial(async () => {
        const stored = await repository.read(HOST);
        const record = parseRecord(stored?.value);
        if (record.origin !== origin) throw Error('Host changed');
        const next = Object.freeze({ ...record, label: hostLabel(label) });
        await put(HOST, { version: 2, label: next.label, origin, plainHttp: next.plainHttp, method: next.method });
        return next;
      });
    },
    forget(): Promise<void> {
      return serial(async () => { await drop(CREDENTIAL); await drop(HOST); });
    },
  });
}
