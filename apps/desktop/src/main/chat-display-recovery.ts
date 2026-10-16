// Main-only display recovery. None of these records authorize host operations.
import { createHash } from 'node:crypto';
import { createDisplayCache } from '../../../../packages/platform/display-cache.ts';
import type { DisplayCacheData, DisplayCacheScope, CachedSession } from '../../../../packages/platform/display-cache.ts';
import type { ProtectedValue } from '../../../../packages/platform/protected-repository.ts';
import type { JsonValue } from '../../../../packages/contracts/rpc.ts';
import { jsonObject } from '../../../../packages/contracts/rpc.ts';
import { parseEndpoint } from '../../../../packages/platform/transport-policy.ts';
import type { HostInput } from '../shared/desktop-api.ts';
import type { ViewData, ChatView } from '../../../../packages/ui/view-model.ts';

type Repository = Readonly<{ read(key: string): Promise<ProtectedValue | null>;
  write(key: string, revision: number | null, value: JsonValue): Promise<ProtectedValue> }>;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export function recoveryBinding(host: HostInput): string {
  const endpoint = parseEndpoint(host.endpoint, host.allowPrivateHttp ? host.endpoint.replace(/\/$/u, '') : undefined);
  return hash(JSON.stringify([endpoint.origin, host.authentication, host.token]));
}
function pointer(value: JsonValue): Readonly<{ version: 1; fingerprint: string; hostId: string; principalId: string }> {
  if (!jsonObject(value) || Object.keys(value).sort().join(',') !== 'fingerprint,hostId,principalId,version' || value.version !== 1
    || typeof value.fingerprint !== 'string' || !/^[a-f0-9]{64}$/u.test(value.fingerprint)
    || typeof value.hostId !== 'string' || !/^[a-f0-9]{64}$/u.test(value.hostId)
    || typeof value.principalId !== 'string' || !/^(?:dashboard:)?[a-f0-9]{64}$/u.test(value.principalId)) throw Error('Invalid cache owner');
  return { version: 1, fingerprint: value.fingerprint, hostId: value.hostId, principalId: value.principalId };
}
export function offlineDisplay(saved: DisplayCacheData): ViewData {
  return { sample: false, host: { label: saved.hostLabel, state: 'offline' },
    agents: saved.profiles.map(profile => ({ id: profile.profileId, name: profile.name, summary: profile.summary, color: profile.color })),
    chats: saved.sessions.map(session => ({ id: session.storedSessionId, agentId: session.profileId, title: session.title,
      preview: session.preview, transcript: session.transcript })), workflows: [] };
}
export function createChatDisplayRecovery(repository: Repository) {
  const cache = createDisplayCache(repository);
  // This queue never participates in credential, draft, canonical or send barriers.
  // Serialize owner updates so an old in-flight write cannot rebind a newer one.
  let ownerWrites = Promise.resolve();
  const scopedWrites = new Map<string, Promise<void>>();
  return Object.freeze({
    async drain(): Promise<void> { await Promise.all([ownerWrites, ...scopedWrites.values()]); },
    async restore(host: HostInput, isCurrent: () => boolean): Promise<Readonly<{scope: DisplayCacheScope; data: DisplayCacheData}> | null> {
      try {
        const stored = await repository.read('desktop:cacheOwner');
        if (!isCurrent() || !stored) return null;
        const saved = pointer(stored.value), fingerprint = recoveryBinding(host);
        const endpoint = parseEndpoint(host.endpoint, host.allowPrivateHttp ? host.endpoint.replace(/\/$/u, '') : undefined);
        if (saved.fingerprint !== fingerprint || saved.hostId !== hash(endpoint.origin)
          || (host.authentication === 'dashboard' ? saved.principalId !== `dashboard:${hash(host.token)}` : saved.principalId.startsWith('dashboard:'))) return null;
        const scope = { hostId: saved.hostId, principalId: saved.principalId };
        const record = await cache.read(scope);
        // Renderer chat IDs are globally unique within the selected authority.
        if (!isCurrent() || !record || new Set(record.data.sessions.map(row => row.storedSessionId)).size !== record.data.sessions.length) return null;
        return { scope, data: record.data };
      } catch { return null; }
    },
    activate(host: HostInput, scope: DisplayCacheScope, isCurrent: () => boolean) {
      const ownerValue = { version: 1, fingerprint: recoveryBinding(host), ...scope };
      ownerWrites = ownerWrites.then(async () => {
        if (!isCurrent()) return;
        const previous = await repository.read('desktop:cacheOwner');
        if (previous) pointer(previous.value); // Preserve unsupported/corrupt versions.
        if (isCurrent()) await repository.write('desktop:cacheOwner', previous?.revision ?? null, ownerValue);
      }).catch(() => {});
      let revision: number | null = null, writable = true;
      let catalog: DisplayCacheData = { hostLabel: host.label, profiles: [], sessions: [] };
      const histories = new Map<string, CachedSession>();
      const key = (profile: string, session: string) => JSON.stringify([profile, session]);
      const project = (): DisplayCacheData => ({ ...catalog, sessions: catalog.sessions.map(session => {
        const saved = histories.get(key(session.profileId, session.storedSessionId));
        return saved ? { ...session, preview: saved.preview, transcript: saved.transcript, historyUpdatedAt: saved.historyUpdatedAt } : session;
      }) });
      let base: DisplayCacheData | null = null;
      const scopeKey = JSON.stringify([scope.hostId, scope.principalId]);
      let queue = (scopedWrites.get(scopeKey) ?? Promise.resolve()).then(async () => {
        if (!isCurrent()) return;
        const record = await cache.read(scope);
        if (!isCurrent()) return;
        revision = record?.revision ?? null; base = record?.data ?? null;
        for (const session of base?.sessions ?? []) {
          const identity = key(session.profileId, session.storedSessionId);
          if (!histories.has(identity)) histories.set(identity, session);
        }
      }).catch(() => { writable = false; });
      scopedWrites.set(scopeKey, queue);
      function persist() {
        // Capture before awaiting; never cache a mutable renderer/live projection.
        const captured = structuredClone(project());
        queue = (scopedWrites.get(scopeKey) ?? queue).then(async () => {
          if (!writable || !isCurrent()) return;
          const value = { ...captured, sessions: captured.sessions.map(session => {
            const saved = base?.sessions.find(row => row.profileId === session.profileId && row.storedSessionId === session.storedSessionId);
            return saved && session.historyUpdatedAt === 0
              ? { ...session, preview: saved.preview, transcript: saved.transcript, historyUpdatedAt: saved.historyUpdatedAt } : session;
          }) };
          const saved = await cache.replace(scope, revision, value);
          revision = saved.revision;
        }).catch(() => { writable = false; }); // No CAS retry, overwrite or send failure.
        scopedWrites.set(scopeKey, queue);
        const pending = queue;
        void pending.then(() => { if (scopedWrites.get(scopeKey) === pending) scopedWrites.delete(scopeKey); });
      }
      return Object.freeze({
        get data(): DisplayCacheData { return project(); },
        catalog(view: ViewData) {
          catalog = { hostLabel: view.host?.label ?? host.label,
            profiles: view.agents.map(agent => ({ profileId: agent.id, name: agent.name, summary: agent.summary, color: agent.color })),
            sessions: view.chats.map(chat => ({ profileId: chat.agentId, storedSessionId: chat.id, title: chat.title,
              preview: chat.preview, historyUpdatedAt: 0, transcript: [] })) };
          persist();
        },
        history(chat: ChatView) {
          // Only service.history() calls this, after authoritative-history fences.
          // The strict cache validator rejects any accidental delivery/live fields.
          histories.set(key(chat.agentId, chat.id), structuredClone({ profileId: chat.agentId, storedSessionId: chat.id,
            title: chat.title, preview: chat.preview, historyUpdatedAt: Date.now(), transcript: chat.transcript }));
          persist();
        },
      });
    },
  });
}
