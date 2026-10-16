// Main-only display recovery. None of these records authorize host operations.
import { createHash } from 'node:crypto';
import { createDisplayCache, normalizeDisplayCache } from '../../../../packages/platform/display-cache.ts';
import type { CachedTranscriptItem, DisplayCacheData, DisplayCacheScope } from '../../../../packages/platform/display-cache.ts';
import type { ProtectedValue } from '../../../../packages/platform/protected-repository.ts';
import type { JsonValue } from '../../../../packages/contracts/rpc.ts';
import { jsonObject } from '../../../../packages/contracts/rpc.ts';
import { displayCacheKey } from '../../../../packages/platform/display-cache.ts';
import type { ViewData, ChatView, TranscriptItem } from '../../../../packages/ui/view-model.ts';

// The offline cache keeps a plain reading copy: text and tool labels only.
// Reasoning, notices, tool input/output and delivery state are not retained.
export function cacheTranscript(items: readonly TranscriptItem[]): CachedTranscriptItem[] {
  const result: CachedTranscriptItem[] = [];
  for (const item of items) {
    if (item.kind === 'day') result.push({ kind: 'day', id: item.id, label: item.label });
    else if (item.kind === 'message') {
      // Unconfirmed or still-streaming rows are not saved history.
      if (item.delivery !== undefined || item.streaming) throw new TypeError('Not authoritative history');
      result.push({ kind: 'message', id: item.id, direction: item.direction, paragraphs: [...item.paragraphs] });
    }
    else if (item.kind === 'tool') result.push({ kind: 'tool', id: item.id, label: item.label, detail: item.detail });
  }
  return result;
}

type Repository = Readonly<{ read(key: string): Promise<ProtectedValue | null>;
  write(key: string, revision: number | null, value: JsonValue): Promise<ProtectedValue>;
  remove?(key: string, revision: number | null): Promise<void> }>;
// The saved computer as display recovery sees it: its exact origin and the
// authority it was signed in as (null until a pasted token is first verified).
// Never a token: a rotating "this computer" token must not lose the cache.
export type RecoveryHost = Readonly<{ label: string; origin: string; principalId: string | null }>;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export function recoveryBinding(host: RecoveryHost): string {
  return hash(JSON.stringify([host.origin, host.principalId ?? 'unverified']));
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
  // One serial worker for the single selected host. It retains one admitted
  // immutable write and the latest bounded active projection, never one closure
  // per update/scope. These tasks never enter draft/canonical/send barriers.
  type State = {
    scope: DisplayCacheScope; isCurrent: () => boolean; ownerValue: JsonValue;
    empty: DisplayCacheData; data: DisplayCacheData; seed: DisplayCacheData | null;
    catalogSeen: boolean; loaded: boolean; writable: boolean; dirty: boolean; revision: number | null;
  };
  let active: State | null = null, worker: Promise<void> | null = null;
  const current = (state: State) => active === state && state.isCurrent();
  const needsWork = () => active !== null && current(active) && (!active.loaded || (active.writable && active.dirty));
  function retire(state: State) {
    state.data = state.empty; state.seed = null; state.dirty = false; state.writable = false;
  }
  function mergeHistory(state: State, data: DisplayCacheData, saved: DisplayCacheData): DisplayCacheData {
    return normalizeDisplayCache(state.scope, { ...data, sessions: data.sessions.map(session => {
      const history = saved.sessions.find(row => row.profileId === session.profileId && row.storedSessionId === session.storedSessionId);
      return history && session.historyUpdatedAt === 0
        ? { ...session, preview: history.preview, transcript: history.transcript, historyUpdatedAt: history.historyUpdatedAt } : session;
    }) });
  }
  async function run() {
    while (active && current(active)) {
      const state = active;
      if (!state.loaded) {
        state.loaded = true;
        try {
          const previous = await repository.read('desktop:cacheOwner');
          if (previous) pointer(previous.value); // Preserve unsupported/corrupt versions.
          if (current(state)) await repository.write('desktop:cacheOwner', previous?.revision ?? null, state.ownerValue);
        } catch { /* Owner-local failure cannot enter send barriers. */ }
        if (!current(state)) continue;
        try {
          const record = await cache.read(state.scope);
          if (!current(state)) continue;
          state.revision = record?.revision ?? null;
          if (record) {
            // A seed is bounded and needed only until the first live catalog.
            // Never resurrect sessions removed from that catalog.
            if (state.catalogSeen) state.data = mergeHistory(state, state.data, record.data);
            else state.seed = record.data;
          }
        } catch { state.writable = false; }
      }
      if (!current(state)) continue;
      if (!state.writable || !state.dirty) return;
      state.dirty = false;
      const captured = state.data; // Already copied, frozen and bounded before admission.
      try {
        const saved = await cache.replace(state.scope, state.revision, captured);
        if (current(state)) {
          state.revision = saved.revision;
          if (state.data === captured) state.data = saved.data;
        }
      } catch { state.writable = false; state.dirty = false; } // No stale CAS retry.
    }
  }
  function schedule() {
    if (worker || !needsWork()) return;
    const pending = Promise.resolve().then(run).finally(() => {
      if (worker === pending) worker = null;
      if (needsWork()) schedule();
    });
    worker = pending;
  }
  function update(state: State, project: () => DisplayCacheData) {
    if (!current(state)) return;
    try {
      // Replace the sole latest projection synchronously. Invalid/oversized
      // inputs are never retained, nor queued as deferred full-history copies.
      state.data = normalizeDisplayCache(state.scope, project());
      state.dirty = true; schedule();
    } catch { state.writable = false; state.dirty = false; }
  }
  return Object.freeze({
    async drain(): Promise<void> { while (worker) await worker; },
    async restore(host: RecoveryHost, isCurrent: () => boolean): Promise<Readonly<{scope: DisplayCacheScope; data: DisplayCacheData}> | null> {
      try {
        if (host.principalId === null) return null;
        const stored = await repository.read('desktop:cacheOwner');
        if (!isCurrent() || !stored) return null;
        const saved = pointer(stored.value), fingerprint = recoveryBinding(host);
        if (saved.fingerprint !== fingerprint || saved.hostId !== hash(host.origin) || saved.principalId !== host.principalId) return null;
        const scope = { hostId: saved.hostId, principalId: saved.principalId };
        const record = await cache.read(scope);
        // Renderer chat IDs are globally unique within the selected authority.
        if (!isCurrent() || !record || new Set(record.data.sessions.map(row => row.storedSessionId)).size !== record.data.sessions.length) return null;
        return { scope, data: record.data };
      } catch { return null; }
    },
    // Forget the saved computer: drop its display cache and the owner pointer.
    // Call after the live owner is retired and drain() has finished.
    async forget(): Promise<void> {
      if (active) { retire(active); active = null; }
      const remove = async (key: string) => {
        const current = await repository.read(key);
        if (!current) return;
        if (repository.remove) await repository.remove(key, current.revision);
        else await repository.write(key, current.revision, null);
      };
      const stored = await repository.read('desktop:cacheOwner');
      if (!stored) return;
      try { const saved = pointer(stored.value); await remove(displayCacheKey({ hostId: saved.hostId, principalId: saved.principalId })); }
      catch { /* An unreadable pointer still goes below. */ }
      await remove('desktop:cacheOwner');
    },
    activate(host: RecoveryHost, input: DisplayCacheScope, isCurrent: () => boolean) {
      if (active) retire(active);
      const scope = { ...input };
      const empty = normalizeDisplayCache(scope, { hostLabel: host.label, profiles: [], sessions: [] });
      const state: State = { scope, isCurrent, ownerValue: { version: 1, fingerprint: recoveryBinding(host), ...scope },
        empty, data: empty, seed: null, catalogSeen: false, loaded: false, writable: true, dirty: false, revision: null };
      active = state; schedule();
      return Object.freeze({
        get data(): DisplayCacheData { return state.data; },
        catalog(view: ViewData) {
          update(state, () => {
            const catalog = { hostLabel: view.host?.label ?? host.label,
              profiles: view.agents.map(agent => ({ profileId: agent.id, name: agent.name, summary: agent.summary, color: agent.color })),
              sessions: view.chats.map(chat => ({ profileId: chat.agentId, storedSessionId: chat.id, title: chat.title,
                preview: chat.preview, historyUpdatedAt: 0, transcript: [] })) };
            const next = mergeHistory(state, catalog, state.data);
            const result = state.seed ? mergeHistory(state, next, state.seed) : next;
            state.catalogSeen = true; state.seed = null;
            return result;
          });
        },
        history(chat: ChatView) {
          // Only fenced authoritative history from the current catalog is admitted.
          update(state, () => ({ ...state.data, sessions: state.data.sessions.map(session =>
            session.profileId === chat.agentId && session.storedSessionId === chat.id
              ? { ...session, preview: chat.preview, transcript: cacheTranscript(chat.transcript), historyUpdatedAt: Date.now() } : session) }));
        },
      });
    },
  });
}
