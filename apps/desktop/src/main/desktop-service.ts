import { createHash, randomUUID } from 'node:crypto';
import { createChatDisplayRecovery, offlineDisplay, recoveryBinding } from './chat-display-recovery.ts';
import type { DisplayCacheData, DisplayCacheScope } from '../../../../packages/platform/display-cache.ts';
import { createTextSend } from '../../../../packages/domain/text-send.ts';
import type { TextIntent } from '../../../../packages/domain/text-send.ts';
import { transitionSend } from '../../../../packages/domain/chat-contract.ts';
import type { Owner } from '../../../../packages/domain/chat-contract.ts';
import type { JsonValue, JsonObject, RpcEvent, RpcServerRequest, ServerReply } from '../../../../packages/contracts/rpc.ts';
import { jsonObject } from '../../../../packages/contracts/rpc.ts';
import { decodeProfiles, decodeSessionList, decodeSessionReceipt } from '../../../../packages/contracts/session.ts';
import { decodeRestHistory, decodeRpcHistory, HISTORY_LIMITS } from '../../../../packages/contracts/history.ts';
import { EMPTY_LIVE, addOutgoing, afterHistory, reduceLive } from '../../../../packages/domain/live-turn.ts';
import type { LiveTurn } from '../../../../packages/domain/live-turn.ts';
import { admit, referenceText } from '../../../../packages/domain/attachments.ts';
import type { StagedFile } from '../../../../packages/domain/attachments.ts';
import { parseInteractivePrompt, encodeInteractiveAnswer } from '../../../../packages/contracts/prompts.ts';
import type { InteractivePrompt } from '../../../../packages/contracts/prompts.ts';
import type { Gateway } from '../../../../packages/hermes-client/gateway.ts';
import { GatewayOperationError } from '../../../../packages/hermes-client/gateway.ts';
import { createCanonicalChatClient } from '../../../../packages/hermes-client/canonical-chat.ts';
import type { CanonicalState } from '../../../../packages/contracts/canonical-chat.ts';
import { createWorkspaceClient } from '../../../../packages/hermes-client/workspace.ts';
import type { WorkspaceIdentity, WorkspaceOwner } from '../../../../packages/contracts/workspace.ts';
import { parseEndpoint } from '../../../../packages/platform/transport-policy.ts';
import type { ProtectedValue } from '../../../../packages/platform/protected-repository.ts';
import { EMPTY_DATA } from '../../../../packages/ui/view-model.ts';
import { plainPreview } from '../../../../packages/ui/markdown.ts';
import type { ViewData, ChatView, TranscriptItem } from '../../../../packages/ui/view-model.ts';
import { parseDesktopAction } from '../shared/desktop-api.ts';
import type { DesktopAction, DesktopAlert, DesktopSnapshot, DesktopResult, DesktopWorkspace, HostInput } from '../shared/desktop-api.ts';
import { DEFAULT_PREFERENCES, restorePreferences } from '../shared/preferences.ts';
import type { Preferences } from '../shared/preferences.ts';
import type { CallInput, CallName, CallOutput } from '../shared/calls/index.ts';
import type { CallFailure } from '../shared/call.ts';
import { HANDLERS } from './calls/index.ts';
import type { CallHandler } from './calls/index.ts';
import { CallError, callFailure } from './calls/context.ts';
import type { CallContext } from './calls/context.ts';

type Repository = Readonly<{ read(key: string): Promise<ProtectedValue | null>;
  write(key: string, revision: number | null, value: JsonValue): Promise<ProtectedValue> }>;
type ConnectOptions = Readonly<{ configuration: unknown; isCurrent: () => boolean;
  onEvent: (event: RpcEvent) => void; onRequest: (request: RpcServerRequest, signal: AbortSignal) => Promise<ServerReply>;
  onClosed: () => void }>;
type PendingPrompt = { prompt: InteractivePrompt; resolve: (reply: ServerReply) => void; cancel: () => void };
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const safeJson = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue;
function journal(value: JsonValue | undefined): JsonObject[] {
  if (value === undefined) return [];
  if (!jsonObject(value) || value.version !== 1 || !Array.isArray(value.intents) || value.intents.length > 64
    || value.intents.some(entry => !jsonObject(entry) || typeof entry.id !== 'string'
      || !['prepared', 'dispatched', 'accepted', 'unknown', 'rejected', 'reconciling', 'complete'].includes(String(entry.phase)))) throw Error('Invalid send journal');
  const entries = value.intents as JsonObject[];
  if (new Set(entries.map(entry => entry.id)).size !== entries.length) throw Error('Invalid send journal');
  return entries;
}

// A refusal with words the person can act on; anything else gets generic copy.
class UserFacingError extends Error {}

export function createDesktopService(adapters: Readonly<{
  repository: Repository | null; connect: (options: ConnectOptions) => Promise<Gateway>;
  onChange: (snapshot: DesktopSnapshot) => void;
  // Optional desktop integrations owned by main (notifications, tray, login item).
  onPreferences?: (preferences: Preferences) => void;
  notify?: (alert: DesktopAlert) => void;
  // System file picker owned by main; returns names and bytes, or null if cancelled.
  pickFiles?: () => Promise<readonly Readonly<{ name: string; bytes: Uint8Array }>[] | null>;
}>) {
  let preferences: Preferences = DEFAULT_PREFERENCES;
  const displayRecovery = adapters.repository ? createChatDisplayRecovery(adapters.repository) : null;
  let liveRecovery: ReturnType<NonNullable<typeof displayRecovery>['activate']> | null = null;
  let recovered: { binding: string; scope: DisplayCacheScope; data: DisplayCacheData } | null = null;
  let liveBinding = '';
  let shuttingDown = false, shutdownPromise: Promise<void> | undefined;
  let generation = 0, hostGeneration = 0;
  let snapshotRevision = 0;
  let actionRevision = 0;
  let status: DesktopSnapshot['status'] = 'disconnected';
  let data: ViewData = EMPTY_DATA;
  let gateway: Gateway | undefined;
  let hostId = '', principalId = '', selectedChatId: string | null = null;
  let identity: WorkspaceIdentity | null = null, workspace: DesktopWorkspace | null = null;
  let workspaceRevision = 0;
  let navigation: {requestId: string; initiatingGeneration: number; generation: number} | null = null;
  let navigationIds: {initiatingGeneration: number; ids: Set<string>} | null = null;
  let owner: Owner | null = null;
  let running = false, sending = false, navigating = false, reconciled = false;
  let notice = adapters.repository ? '' : 'Secure storage is unavailable. Unlock your system key store to connect.';
  let drafts: Record<string, string> = Object.create(null);
  let lastSequence: number | null = null;
  // Saved history of the open chat, plus rows of live turns not yet saved.
  let base: readonly TranscriptItem[] = [];
  let live: LiveTurn = EMPTY_LIVE;
  let publishTimer: ReturnType<typeof setTimeout> | undefined;
  // Files chosen for the next message of exactly one chat, held in main only.
  let staged: { chatId: string; files: readonly StagedFile[] } | null = null;
  let turnBookends = 0;
  let historyRevision = 0;
  // Accepted sends awaiting a live terminal bookend and saved history. Several can
  // be pending when messages are queued behind a running turn.
  type AcceptedSend = { intent: TextIntent; key: string; bookend: number; settlement?: Promise<void> };
  let acceptedSends: AcceptedSend[] = [];
  const prompts = new Map<string, PendingPrompt>();
  const revisions = new Map<string, number>();
  let writes = Promise.resolve();
  const canSend = () => status === 'connected' && !!owner && !!gateway?.exclusiveSubmit && !!adapters.repository
    && reconciled && !running && !sending && !navigating;
  // While a reply runs, a send steers, queues or interrupts per Settings → Chat.
  const canSendBusy = () => status === 'connected' && !!owner && !!gateway?.exclusiveSubmit && !!adapters.repository
    && reconciled && running && !sending && !navigating;
  function snapshot(): DesktopSnapshot {
    // Only the open chat's transcript crosses IPC; lists need titles and previews.
    const visible: ViewData = { ...data, chats: data.chats.map(chat => chat.id === selectedChatId || !chat.transcript.length ? chat : { ...chat, transcript: [] }) };
    return structuredClone({ generation, connection: hostGeneration, revision: ++snapshotRevision, status, data: visible, selectedChatId, running, canSend: canSend() || canSendBusy(), notice,
      storageAvailable: !!adapters.repository, prompts: [...prompts].map(([id, entry]) => ({ id, prompt: entry.prompt })), drafts, workspace,
      preferences, attachments: staged && staged.chatId === selectedChatId
        ? staged.files.map(file => ({ id: file.id, name: file.name, size: file.bytes.byteLength, kind: file.kind })) : [],
      turn: { key: live.turn, model: live.model, status: live.status, todos: live.todos, context: live.context, startedAt: live.startedAt } });
  }
  const publish = () => { clearTimeout(publishTimer); publishTimer = undefined; adapters.onChange(snapshot()); };
  // Streaming text arrives many times a second; coalesce those updates.
  const publishSoon = () => { publishTimer ??= setTimeout(publish, 80); };
  function save(key: string, value: unknown): Promise<void> {
    const captured = safeJson(value);
    const result = writes.then(async () => {
      if (!adapters.repository) throw Error('Secure storage unavailable');
      const current = revisions.has(key) ? revisions.get(key)! : (await adapters.repository.read(key))?.revision ?? null;
      const stored = await adapters.repository.write(key, current, captured);
      revisions.set(key, stored.revision);
    });
    writes = result.catch(() => {}); return result;
  }
  function clearSentDraft(key: string, revision: number | null, submitted: string): Promise<boolean> {
    const result = writes.then(async () => {
      if (!adapters.repository) return false;
      const current = await adapters.repository.read(key);
      if (!current || current.revision !== revision || current.value !== submitted) return false;
      const stored = await adapters.repository.write(key, revision, '');
      revisions.set(key, stored.revision); return true;
    });
    writes = result.then(() => {}, () => {}); return result;
  }
  function commitIntent(key: string, intent: TextIntent): Promise<void> {
    const captured = safeJson(intent);
    const result = writes.then(async () => {
      if (!adapters.repository) throw Error('Secure storage unavailable');
      const current = await adapters.repository.read(key);
      let entries = journal(current?.value).filter(entry => entry.id !== intent.id);
      // Retain every unresolved send, including late receipts from retired leases.
      if (intent.phase === 'prepared') entries = entries.filter(entry => entry.phase !== 'complete' && entry.phase !== 'rejected');
      if (entries.length >= 64) throw Error('Send journal requires reconciliation');
      const stored = await adapters.repository.write(key, current?.revision ?? null, { version: 1, intents: [...entries, captured] });
      revisions.set(key, stored.revision);
    });
    writes = result.catch(() => {}); return result;
  }
  const scope = (profile: string, chatId: string) => digest(JSON.stringify([hostId, principalId, profile, chatId]));
  function clearPrompts() { for (const entry of [...prompts.values()]) entry.cancel(); prompts.clear(); }
  function retire(clear = false) {
    if (liveRecovery) recovered = { binding: liveBinding, scope: {hostId, principalId}, data: liveRecovery.data };
    liveRecovery = null;
    navigation = null; navigationIds = null; ++hostGeneration; ++generation; owner = null; acceptedSends = []; reconciled = false; running = false; sending = false; navigating = false;
    ++workspaceRevision; workspace = null; identity = null; base = []; live = EMPTY_LIVE; clearTimeout(publishTimer); publishTimer = undefined; staged = null;
    clearPrompts(); const old = gateway; gateway = undefined; old?.close(); status = 'disconnected';
    if (clear) { recovered = null; data = EMPTY_DATA; drafts = Object.create(null); selectedChatId = null; }
    else if (recovered) data = offlineDisplay(recovered.data);
    else if (data.host) data = { ...data, host: { ...data.host, state: 'offline' } };
  }
  function updateChat(chatId: string, update: (chat: ChatView) => ChatView) {
    data = { ...data, chats: data.chats.map(chat => chat.id === chatId ? update(chat) : chat) };
  }
  function requireGeneration(value: number) { if (value !== generation || status !== 'connected' || !gateway) throw Error('Selection changed'); }
  function requireChat(chatId: string) {
    if (!owner || selectedChatId !== chatId || owner.storedSessionId !== chatId) throw Error('Chat changed'); return owner;
  }
  // REST rows carry tool results; the RPC projection is the fallback for older
  // hosts, unusual IDs or a page beyond the response bound.
  async function readHistory(captured: Owner, connection: Gateway): Promise<readonly TranscriptItem[]> {
    if (/^[A-Za-z0-9_.:-]+$/u.test(captured.storedSessionId) && captured.storedSessionId !== '.' && captured.storedSessionId !== '..') {
      try {
        const response = await connection.requestHttp({ kind: 'route', method: 'GET', path: `/api/sessions/${encodeURIComponent(captured.storedSessionId)}/messages`,
          query: { profile: captured.profileId, order: 'latest', limit: '500', include_compacted: 'true', inline_images: 'false' },
          maxBytes: HISTORY_LIMITS.responseBytes });
        return decodeRestHistory(response.body);
      } catch { if (owner !== captured || gateway !== connection) throw Error('Chat changed'); }
    }
    return decodeRpcHistory(await connection.operation({ kind: 'sessionHistory', profile: captured.profileId, runtimeId: captured.runtimeId }));
  }
  function applyTranscript(chatId: string) {
    const items = [...base, ...live.items];
    const last = [...items].reverse().find(item => item.kind === 'message' && item.paragraphs.join('').trim());
    updateChat(chatId, chat => ({ ...chat, transcript: items,
      preview: last?.kind === 'message' ? plainPreview(last.paragraphs.join('\n')) : chat.preview }));
  }
  async function history(captured: Owner, connection: Gateway) {
    const revision = ++historyRevision;
    const items = await readHistory(captured, connection);
    if (owner !== captured || gateway !== connection || revision !== historyRevision) return;
    for (const accepted of acceptedSends.filter(entry => !running && turnBookends > entry.bookend)) {
      // Only a known accepted send with a live terminal bookend can complete.
      // Recovered/unknown records are never promoted merely by seeing history.
      accepted.settlement ??= (async () => {
        const terminal = { ...transitionSend(accepted.intent, { type: 'terminalVerified' }, captured), request: accepted.intent.request };
        await commitIntent(accepted.key, terminal);
        await commitIntent(accepted.key, { ...transitionSend(terminal, { type: 'historyVerified' }, captured), request: terminal.request });
      })();
      await accepted.settlement;
      acceptedSends = acceptedSends.filter(entry => entry !== accepted);
      if (owner !== captured || gateway !== connection || revision !== historyRevision) return;
    }
    base = items; live = afterHistory(live);
    applyTranscript(captured.storedSessionId);
    const authoritative = data.chats.find(chat => chat.id === captured.storedSessionId && chat.agentId === captured.profileId);
    if (authoritative) liveRecovery?.history({ ...authoritative, transcript: base });
    reconciled = true; publish();
  }
  function agentName(profile: string): string { return data.agents.find(agent => agent.id === profile)?.name ?? 'Your agent'; }
  function alert(kind: DesktopAlert['kind'], chatId: string, profile: string, text: string) {
    try { adapters.notify?.(Object.freeze({ kind, chatId, agentName: agentName(profile), text: text.slice(0, 600) })); } catch { /* Alerts never affect chat state. */ }
  }
  function event(event: RpcEvent, current: number) {
    if (shuttingDown || current !== hostGeneration || !owner || event.params.session_id !== owner.runtimeId) return;
    const captured = owner, connection = gateway;
    const sequence = event.params.seq;
    if (typeof sequence === 'number') {
      if (lastSequence !== null && sequence <= lastSequence) return;
      if (lastSequence !== null && sequence > lastSequence + 1) { reconciled = false; notice = 'Some updates were missed. Reopen this chat to check its saved history.'; }
      lastSequence = sequence;
    }
    const type = String(event.params.type);
    // Hermes sends a bare message.start; an absent payload is an empty one.
    const payload = event.params.payload === undefined ? {} : event.params.payload;
    if (!jsonObject(payload)) return;
    if (['message.start', 'message.delta', 'message.complete', 'message.interim', 'session.reclaimed', 'error'].includes(type)
      || (type === 'session.info' && typeof payload.running === 'boolean')) ++historyRevision;
    if (type === 'session.reclaimed') { retire(); notice = 'Another client took over this session. Reconnect to continue.'; publish(); return; }
    const wasRunning = running;
    live = reduceLive(live, type, payload, Date.now());
    if (type === 'message.start' || type === 'message.delta') running = true;
    if (type === 'session.title' && typeof payload.title === 'string' && payload.session_id === captured.storedSessionId) {
      const title = payload.title.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]+/gu, ' ').trim().slice(0, 200);
      if (title) updateChat(captured.storedSessionId, chat => ({ ...chat, title }));
    }
    applyTranscript(captured.storedSessionId);
    if (type === 'session.info' && typeof payload.running === 'boolean') {
      running = payload.running;
      if (!running && connection) {
        ++turnBookends;
        reconciled = false;
        if (wasRunning) {
          const reply = [...live.items].reverse().find(item => item.kind === 'message' && item.direction === 'in');
          alert(live.failure ? 'failed' : 'reply', captured.storedSessionId, captured.profileId,
            live.failure ?? (reply?.kind === 'message' ? plainPreview(reply.paragraphs.join('\n'), 400) : ''));
        }
        void history(captured, connection).catch(() => { if (owner === captured) { notice = 'Could not check saved history. Reopen the chat before sending.'; publish(); } });
      }
    }
    if (type === 'message.delta' || type === 'reasoning.delta' || type === 'session.usage' || type === 'thinking.delta') publishSoon(); else publish();
  }
  async function request(request: RpcServerRequest, signal: AbortSignal, current: number): Promise<ServerReply> {
    if (shuttingDown || current !== hostGeneration || !owner || signal.aborted) return { error: { code: -32000, message: 'Session unavailable' } };
    if (request.method !== 'approval' && request.method !== 'clarify') return { error: { code: -32601, message: 'This prompt is not supported by this desktop build' } };
    let prompt: InteractivePrompt;
    try { prompt = parseInteractivePrompt(request.method, request.params, owner.runtimeId); }
    catch { return { error: { code: -32602, message: 'Invalid prompt' } }; }
    if (prompts.size >= 64 || prompts.has(request.id)) return { error: { code: -32000, message: 'Prompt unavailable' } };
    return new Promise(resolve => {
      const cancel = () => {
        const entry = prompts.get(request.id); if (!entry) return;
        prompts.delete(request.id); signal.removeEventListener('abort', cancel);
        resolve({ error: { code: -32000, message: 'Prompt retired' } }); publish();
      };
      prompts.set(request.id, { prompt, resolve: reply => { signal.removeEventListener('abort', cancel); resolve(reply); }, cancel });
      signal.addEventListener('abort', cancel, { once: true }); publish();
      if (owner) alert(prompt.kind === 'approval' ? 'approval' : 'question', owner.storedSessionId, owner.profileId,
        prompt.kind === 'approval' ? prompt.description ?? prompt.command ?? '' : prompt.questions[0]?.question ?? '');
    });
  }
  async function restoreOffline(host: HostInput, current: number) {
    const selection = generation;
    const isCurrent = () => !shuttingDown && current === hostGeneration && selection === generation && status !== 'connected';
    const saved = await displayRecovery?.restore(host, isCurrent);
    if (!saved || !isCurrent()) return;
    const binding = recoveryBinding(host);
    // A persisted projection can lag authoritative history already held in memory.
    if (recovered?.binding === binding) return;
    recovered = { ...saved, binding };
    data = offlineDisplay(saved.data); selectedChatId = null;
    notice = 'Saved chats are read-only while offline. Connect to check for updates.'; publish();
  }
  async function connect(host: HostInput) {
    if (!adapters.repository) throw Error('Secure storage unavailable');
    const endpoint = parseEndpoint(host.endpoint, host.allowPrivateHttp ? host.endpoint.replace(/\/$/u, '') : undefined);
    const binding = recoveryBinding(host);
    const previous = liveRecovery && liveBinding === binding
      ? { binding, scope: {hostId, principalId}, data: liveRecovery.data }
      : recovered?.binding === binding ? recovered : null;
    retire(true); recovered = previous;
    if (previous) data = offlineDisplay(previous.data);
    status = 'connecting'; notice = 'Connecting…'; publish();
    const current = hostGeneration;
    let connection: Gateway;
    try { connection = await adapters.connect({ configuration: {
      endpoint: endpoint.origin, ...(host.allowPrivateHttp ? { approvedPrivateHttpOrigin: endpoint.origin } : {}),
      authentication: { kind: host.authentication, token: host.token }, proxy: {},
    }, isCurrent: () => !shuttingDown && current === hostGeneration,
    onEvent: frame => event(frame, current), onRequest: (frame, signal) => request(frame, signal, current),
    onClosed: () => { if (!shuttingDown && current === hostGeneration) { retire(); notice = 'Connection closed. Reconnect to check your chats. Nothing is resent automatically.'; publish(); } } }); }
    catch { if (!shuttingDown && current === hostGeneration) { retire(); const failed = hostGeneration; await restoreOffline(host, failed);
      if (!shuttingDown && failed === hostGeneration) { notice = recovered ? 'Saved chats are read-only while offline. Connect to check for updates.' : 'Could not connect. Check the address and sign-in token.'; publish(); } } throw Error('Unable to connect'); }
    if (shuttingDown || current !== hostGeneration) { connection.close(); throw Error('Host changed'); }
    gateway = connection;
    try {
      let principal = `dashboard:${digest(host.token)}`;
      let verified: WorkspaceIdentity = { kind: 'dashboard' };
      if (host.authentication === 'provider') {
        const identity = (await connection.requestHttp({ kind: 'identity' })).body;
        if (!jsonObject(identity) || typeof identity.provider !== 'string' || !identity.provider || typeof identity.user_id !== 'string' || !identity.user_id) throw Error('Identity unavailable');
        principal = digest(JSON.stringify([identity.provider, identity.user_id]));
        verified = { kind: 'provider', providerId: identity.provider, userId: identity.user_id };
      } else {
        const health = (await connection.requestHttp({ kind: 'health' })).body;
        if (!jsonObject(health) || health.ok !== true || typeof health.auth_required !== 'boolean') throw Error('Host identity unavailable');
      }
      if (shuttingDown || current !== hostGeneration) throw Error('Host changed');
      // A newly verified principal retires the previous display immediately.
      if (recovered && (recovered.scope.hostId !== digest(endpoint.origin) || recovered.scope.principalId !== principal)) {
        recovered = null; data = EMPTY_DATA; drafts = Object.create(null); selectedChatId = null; publish();
      }
      await save('desktop:host', host);
      if (shuttingDown || current !== hostGeneration) throw Error('Host changed');
      await save('desktop:autoConnect', true);
      if (shuttingDown || current !== hostGeneration) throw Error('Host changed');
      hostId = digest(endpoint.origin); principalId = principal; identity = verified;
      recovered = null; liveBinding = binding;
      liveRecovery = displayRecovery?.activate(host, {hostId, principalId}, () => current === hostGeneration) ?? null;
      const profiles = decodeProfiles(await connection.operation({ kind: 'profilesList' }));
      if (shuttingDown || current !== hostGeneration) throw Error('Host changed');
      data = { sample: false, host: { label: host.label, state: 'connected' }, agents: profiles.map(row => ({ ...row, color: '#D27B5B' })), chats: [], workflows: [] };
      status = 'connected'; notice = profiles.length ? 'Choose an agent to start a chat.' : 'This computer has no available agents.';
      await refresh();
    } catch { if (!shuttingDown && current === hostGeneration) { retire(); notice = 'Could not connect. Check the address, sign-in token, and secure storage.'; publish(); } else connection.close(); throw Error('Unable to connect'); }
  }
  async function reloadProfiles() {
    const connection = gateway, current = hostGeneration;
    if (!connection || status !== 'connected') throw Error('Not connected');
    const profiles = decodeProfiles(await connection.operation({ kind: 'profilesList' }));
    if (shuttingDown || current !== hostGeneration || connection !== gateway) return;
    const colors = new Map(data.agents.map(agent => [agent.id, agent.color]));
    data = { ...data, agents: profiles.map(row => ({ ...row, color: colors.get(row.id) ?? '#D27B5B' })) };
    await refresh();
  }
  async function refresh() {
    const connection = gateway, current = hostGeneration;
    if (!connection || status !== 'connected') throw Error('Not connected');
    const chats: ChatView[] = [];
    for (const agent of data.agents) {
      const rows = decodeSessionList(await connection.operation({ kind: 'sessionList', profile: agent.id }), agent.id);
      if (shuttingDown || current !== hostGeneration || connection !== gateway) return;
      for (const row of rows) {
        if (chats.some(chat => chat.id === row.id)) throw Error('Ambiguous session identity');
        chats.push({ id: row.id, agentId: row.profile, title: row.title, preview: row.preview,
          transcript: data.chats.find(chat => chat.id === row.id && chat.agentId === row.profile)?.transcript ?? [] });
      }
    }
    // Newly created sessions can be lazy and absent until their first prompt.
    const active = data.chats.find(chat => chat.id === selectedChatId);
    if (active && !chats.some(chat => chat.id === active.id)) chats.unshift(active);
    data = { ...data, chats }; liveRecovery?.catalog(data); publish();
  }
  async function open(profile: string, storedSessionId?: string, canonical = false, requestId?: string, initiatingGeneration = generation) {
    if (sending || !gateway || !data.agents.some(agent => agent.id === profile)) throw Error('Session unavailable');
    const connection = gateway, current = hostGeneration;
    navigating = true; reconciled = false; owner = null; selectedChatId = null; acceptedSends = []; clearPrompts(); ++generation; staged = null;
    navigation = requestId ? {requestId, initiatingGeneration, generation} : null; publish();
    // Ordinary/saved-chat supersession admits no more entries from the older
    // canonical initiating generation, so its tombstones can be retired.
    if (!canonical) navigationIds = null;
    ++workspaceRevision; workspace = null;
    const selection = generation;
    const isCurrent = () => !shuttingDown && current === hostGeneration && connection === gateway && selection === generation;
    try {
      let receipt;
      if (canonical) {
        const captured: WorkspaceOwner = { hostId, principalId, profileId: profile, authGeneration: current, connectionGeneration: selection };
        const stateKey = `canonical:${digest(JSON.stringify([hostId, principalId, profile]))}`;
        const client = createCanonicalChatClient({ owner: captured, currentOwner: () => isCurrent() ? captured : null,
          operation: operation => connection.operation(operation),
          sessionDetail: async storedSessionId => (await connection.requestHttp({kind:'canonicalSessionDetail',profile,storedSessionId})).body,
          readState: async () => { await writes; return (await adapters.repository?.read(stateKey))?.value; },
          saveState: (state: CanonicalState) => {
            const result = writes.then(async () => {
              if (!isCurrent() || !adapters.repository) throw Error('Selection changed');
              const previous = await adapters.repository.read(stateKey);
              if (!isCurrent()) throw Error('Selection changed');
              const stored = await adapters.repository.write(stateKey, previous?.revision ?? null, safeJson(state));
              revisions.set(stateKey, stored.revision);
            });
            writes = result.catch(() => {}); return result;
          },
        });
        receipt = (await client.resolve()).receipt;
      } else receipt = decodeSessionReceipt(await connection.operation(storedSessionId === undefined
        ? { kind: 'sessionCreate', profile } : { kind: 'sessionResume', profile, storedSessionId }), profile);
      if (!isCurrent()) return;
      if (data.chats.some(chat => chat.id === receipt.storedSessionId && chat.agentId !== profile)) throw Error('Ambiguous session identity');
      selectedChatId = receipt.storedSessionId; running = receipt.running; lastSequence = null;
      base = data.chats.find(chat => chat.id === receipt.storedSessionId)?.transcript.filter(item => item.kind !== 'notice') ?? [];
      live = receipt.running ? Object.freeze({ ...EMPTY_LIVE, running: true, turn: 'live:resumed', status: 'Working' }) : EMPTY_LIVE;
      const captured: Owner = { hostId, principalId, profileId: profile, storedSessionId: receipt.storedSessionId, runtimeId: receipt.runtimeId,
        authGeneration: current, connectionGeneration: generation };
      owner = captured;
      if (receipt.openRequests.length) connection.restoreRequests(receipt.openRequests, captured.runtimeId);
      if (!data.chats.some(chat => chat.id === selectedChatId && chat.agentId === profile)) data = { ...data, chats: [{ id: selectedChatId,
        agentId: profile, title: canonical ? 'Bot Chat' : 'New chat', preview: '', transcript: [] }, ...data.chats].slice(0, 10000) };
      liveRecovery?.catalog(data);
      const savedDraft = await adapters.repository?.read(`draft:${scope(profile, selectedChatId)}`);
      if (owner !== captured) return;
      if (typeof savedDraft?.value === 'string') drafts = { ...drafts, [selectedChatId]: savedDraft.value };
      const pending = await adapters.repository?.read(`journal:${scope(profile, selectedChatId)}`);
      if (owner !== captured) return;
      notice = journal(pending?.value).some(entry => ['prepared', 'dispatched', 'accepted', 'reconciling', 'unknown'].includes(String(entry.phase)))
        ? 'An earlier send may have run. Check saved history before sending again. Nothing was resent.' : '';
      await history(captured, connection);
    } finally { if (isCurrent()) { navigation = null; navigationIds = null; navigating = false; publish(); } }
  }
  async function act(action: DesktopAction) {
    if (shuttingDown) throw Error('Application is closing');
    if (action.kind === 'call') throw Error('Feature calls use their own channel');
    if (action.kind === 'snapshot') return;
    if (action.kind === 'connect') { await connect(action.host); return; }
    if (action.kind === 'disconnect') { retire(true); notice = ''; publish(); if (adapters.repository) await save('desktop:autoConnect', false); return; }
    if (action.kind === 'refresh') { await refresh(); return; }
    if (action.kind === 'preferences') {
      const next = Object.freeze({ ...preferences, ...action.changes });
      if (adapters.repository) await save('desktop:preferences', next);
      preferences = next; publish();
      try { adapters.onPreferences?.(preferences); } catch { /* Integration failures never block the choice. */ }
      return;
    }
    if (action.kind === 'cancelNavigation') {
      if (navigation?.requestId === action.requestId && navigation.initiatingGeneration === action.generation) {
        navigation = null; navigationIds = null; ++generation; owner = null; selectedChatId = null; acceptedSends = [];
        clearPrompts(); navigating = false; running = false; reconciled = false; publish();
      }
      return;
    }
    if (action.kind === 'openChat' && status === 'disconnected' && action.generation === generation && recovered) {
      const chat = recovered.data.sessions.find(row => row.storedSessionId === action.chatId);
      if (!chat) throw Error('Chat unavailable');
      const savedOwner = recovered;
      const selection = ++generation; selectedChatId = chat.storedSessionId; owner = null; workspace = null;
      notice = 'Saved chats are read-only while offline. Connect to check for updates.'; publish();
      // Drafts remain independently protected; reading one grants no edit lease.
      try {
        const key = digest(JSON.stringify([savedOwner.scope.hostId, savedOwner.scope.principalId, chat.profileId, chat.storedSessionId]));
        const draft = await adapters.repository?.read(`draft:${key}`);
        if (generation === selection && recovered === savedOwner && status === 'disconnected' && typeof draft?.value === 'string') {
          drafts = { ...drafts, [chat.storedSessionId]: draft.value }; publish();
        }
      } catch { /* A missing/corrupt draft does not hide cached saved history. */ }
      return;
    }
    if (!(['canonicalChat', 'newChat', 'openChat'].includes(action.kind) && navigating && navigation?.initiatingGeneration === action.generation)) requireGeneration(action.generation);
    if (action.kind === 'workspace') {
      if (!identity || !data.agents.some(agent => agent.id === action.profile)) throw Error('Agent unavailable');
      const connection = gateway!, current = hostGeneration, selection = generation, revision = ++workspaceRevision;
      const captured: WorkspaceOwner = { hostId, principalId, profileId: action.profile, authGeneration: current, connectionGeneration: selection };
      const isCurrent = () => !shuttingDown && current === hostGeneration && selection === generation && revision === workspaceRevision && connection === gateway;
      const client = createWorkspaceClient({ owner: captured, identity, currentOwner: () => isCurrent() ? captured : null,
        http: operation => connection.requestHttp(operation), projects: profile => connection.operation({ kind: 'projectsList', profile }), nextRequestId: randomUUID });
      workspace = { profile: action.profile, page: action.page, status: 'loading' }; publish();
      try {
        // Keep page and DTO paired; no unvalidated raw host result reaches IPC.
        if (action.page === 'projects') {
          const result = await client.projects();
          if (isCurrent()) workspace = result.status === 'loaded' ? { profile: action.profile, page: action.page, ...result } : { profile: action.profile, page: action.page, status: 'unsupported' };
        } else if (action.page === 'usage') {
          const result = await client.usage(action.days);
          if (isCurrent()) workspace = result.status === 'loaded' ? { profile: action.profile, page: action.page, ...result } : { profile: action.profile, page: action.page, status: 'unsupported' };
        } else if (action.page === 'scheduled') {
          const result = await client.scheduled();
          if (isCurrent()) workspace = result.status === 'loaded' ? { profile: action.profile, page: action.page, ...result } : { profile: action.profile, page: action.page, status: 'unsupported' };
        } else {
          const result = await client.board(action.page);
          if (isCurrent()) workspace = result.status === 'loaded' ? { profile: action.profile, page: action.page, ...result } : { profile: action.profile, page: action.page, status: 'unsupported' };
        }
      } catch { if (isCurrent()) workspace = { profile: action.profile, page: action.page, status: 'unavailable' }; }
      if (isCurrent()) publish(); return;
    }
    if (action.kind === 'canonicalChat') {
      // Reject before rotating tombstones: a failed admission must leave the
      // older initiating generation's replay fence intact.
      if (sending || !gateway || !data.agents.some(agent => agent.id === action.profile)) throw Error('Session unavailable');
      // Keep tombstones only while this initiating generation can supersede an
      // in-flight navigation. Settled/replaced generations are already fenced.
      if (!navigating || navigationIds?.initiatingGeneration !== action.generation) navigationIds = {initiatingGeneration: action.generation, ids: new Set()};
      if (navigationIds.ids.has(action.requestId) || navigationIds.ids.size >= 4096) throw Error('Navigation unavailable');
      navigationIds.ids.add(action.requestId);
      await open(action.profile, undefined, true, action.requestId, action.generation); return;
    }
    if (action.kind === 'newChat') { await open(action.profile); return; }
    if (action.kind === 'openChat') {
      const chat = data.chats.find(chat => chat.id === action.chatId); if (!chat) throw Error('Chat unavailable');
      await open(chat.agentId, chat.id); return;
    }
    if (action.kind === 'answer') {
      const entry = prompts.get(action.promptId); if (!entry || entry.prompt.runtimeId !== owner?.runtimeId) throw Error('Prompt expired');
      const result = encodeInteractiveAnswer(entry.prompt, action.answer); prompts.delete(action.promptId); entry.resolve({ result }); publish(); return;
    }
    const captured = requireChat(action.chatId), connection = gateway!;
    if (action.kind === 'draft') {
      const key = `draft:${scope(captured.profileId, action.chatId)}`; await save(key, action.text);
      if (owner === captured) { drafts = { ...drafts, [action.chatId]: action.text }; publish(); } return;
    }
    if (action.kind === 'attach' || action.kind === 'attachDropped') {
      if (action.kind === 'attach' && !adapters.pickFiles) throw new UserFacingError('Adding files is not available here.');
      const chosen = action.kind === 'attachDropped' ? action.files : await adapters.pickFiles!();
      if (!chosen?.length || owner !== captured) return;
      const result = admit(staged?.chatId === action.chatId ? staged.files : [], chosen, () => randomUUID());
      staged = { chatId: action.chatId, files: result.files };
      notice = result.problem; publish(); return;
    }
    if (action.kind === 'detach') {
      if (staged?.chatId === action.chatId) staged = { chatId: action.chatId, files: staged.files.filter(file => file.id !== action.attachmentId) };
      publish(); return;
    }
    if (action.kind === 'interrupt') {
      await connection.operation({ kind: 'sessionInterrupt', profile: captured.profileId, runtimeId: captured.runtimeId }); return;
    }
    // Capture before dispatch: a fast host can start the reply before its receipt.
    const busyAtDispatch = running;
    const files = staged?.chatId === action.chatId ? staged.files : [];
    if (!action.text.trim() && !files.length) throw new UserFacingError('Write a message first.');
    if (running) {
      if (!canSendBusy()) throw new UserFacingError('Wait a moment, then send again.');
      // Files can only wait in the queue; they never steer or interrupt a reply.
      if (preferences.busyMode === 'steer' && !files.length) { await steer(captured, connection, action.chatId, action.text); return; }
      if (preferences.busyMode === 'interrupt' && !files.length) {
        let stopped = false;
        try { const reply = await connection.operation({ kind: 'sessionInterrupt', profile: captured.profileId, runtimeId: captured.runtimeId }); stopped = jsonObject(reply) && reply.status === 'interrupted'; }
        catch { stopped = false; }
        if (!stopped) throw new UserFacingError("The current reply couldn't be stopped. Your message is still in the box.");
        if (owner !== captured) return;
      }
      // queue (or after interrupt): prompt.submit with queued:true, journaled below.
    } else if (!canSend()) throw Error('Chat is not ready');
    if (/^\/[A-Za-z0-9._-]{1,96}(?:\s|$)/u.test(action.text.trimStart()) && !files.length) {
      // Commands never travel as plain text; mid-reply they would be read as words.
      if (running) throw new UserFacingError('Commands run when the current reply finishes. Send it again then.');
      await runCommand(captured, connection, action.chatId, action.text.trim()); return;
    }
    await journaledSend({ captured, connection, chatId: action.chatId, draftText: action.text, submitText: action.text, display: action.text, files, busyAtDispatch });
  }
  // Persist intent, stage files, then one prompt.submit (HERMES_API.md §6 Send).
  async function journaledSend(input: Readonly<{ captured: Owner; connection: Gateway; chatId: string; draftText: string; submitText: string;
    display: string; files: readonly StagedFile[]; busyAtDispatch: boolean }>) {
    const { captured, connection, chatId, files } = input;
    sending = true; let dispatchAttempted = false;
    const intentKey = `journal:${scope(captured.profileId, chatId)}`, draftKey = `draft:${scope(captured.profileId, chatId)}`;
    const draftRevision = revisions.get(draftKey) ?? null;
    let bookendAtDispatch = turnBookends; publish();
    try {
      const references = files.length ? await upload(captured, connection, files) : [];
      if (owner !== captured) return;
      const text = [input.submitText, ...references].filter(part => part.trim()).join('\n');
      const result = await createTextSend({ id: randomUUID(), requestId: randomUUID(), owner: captured, text }, {
        currentOwner: () => owner === captured && status === 'connected' ? captured : null,
        commit: intent => commitIntent(intentKey, intent), submit: request => { dispatchAttempted = true; bookendAtDispatch = turnBookends; return connection.submitText(request); },
      })();
      if (owner !== captured) return;
      live = addOutgoing(live, result.id, input.display, result.phase === 'accepted' ? 'pending' : 'unknown', files.map(file => file.kind === 'image' ? 'Photo' : file.name));
      if (staged?.chatId === chatId) staged = { chatId, files: staged.files.filter(file => !files.includes(file)) };
      applyTranscript(chatId);
      if (result.phase === 'accepted') {
        acceptedSends = [...acceptedSends, { intent: result, key: intentKey, bookend: bookendAtDispatch }];
        const cleared = await clearSentDraft(draftKey, draftRevision, input.draftText);
        if (owner !== captured) return;
        if (cleared) drafts = { ...drafts, [chatId]: '' };
        if (input.busyAtDispatch) notice = 'Queued. It runs when the current reply finishes.';
        else if (turnBookends === bookendAtDispatch) { running = true; notice = ''; }
        else { await history(captured, connection); }
      } else { reconciled = false; notice = 'Not sure this arrived. Reopen the chat to check saved history. Nothing will be resent automatically.'; }
    } catch (error) {
      if (owner === captured && dispatchAttempted) { reconciled = false; notice = 'The send outcome could not be saved. Reopen the chat to check history before sending again.'; }
      throw error;
    } finally { if (owner === captured) { sending = false; publish(); } }
  }
  // A leading /command runs through Hermes's command path (slash.exec, then
  // command.dispatch for skills/plugins), never as prompt text. Results that
  // expand into a prompt go through the same journaled send.
  async function runCommand(captured: Owner, connection: Gateway, chatId: string, text: string) {
    const token = text.split(/\s+/u)[0] ?? '', name = token.slice(1).toLowerCase(), arg = text.slice(token.length).trim();
    const draftKey = `draft:${scope(captured.profileId, chatId)}`, draftRevision = revisions.get(draftKey) ?? null;
    const session = { session_id: captured.runtimeId, profile: captured.profileId };
    const options = { mutation: true, timeoutMs: 120000 } as const;
    const id = `command:${randomUUID()}`;
    let reply: unknown;
    sending = true; publish();
    try {
      try { reply = await connection.call('slash.exec', { ...session, command: text }, options); }
      catch (error) {
        if (!(error instanceof GatewayOperationError) || error.code !== 4018) throw error;
        reply = await connection.call('command.dispatch', { ...session, name, ...(arg ? { arg } : {}) }, options);
      }
      if (jsonObject(reply) && reply.type === 'alias' && typeof reply.target === 'string' && /^\/?[A-Za-z0-9._-]{1,96}$/u.test(reply.target)) {
        reply = await connection.call('command.dispatch', { ...session, name: reply.target.replace(/^\//u, ''), ...(arg ? { arg } : {}) }, options);
      }
    } catch (error) {
      if (owner === captured) { sending = false; publish(); }
      if (error instanceof GatewayOperationError) {
        throw new UserFacingError(error.code === 4018 ? `Hermes doesn't know ${token}. Your text is still in the box.`
          : `Hermes couldn't run ${token}${error.detail ? `: ${error.detail.replace(/[.!?]?$/u, '.')}` : '.'} Your text is still in the box.`);
      }
      throw new UserFacingError(`Not sure ${token} ran. It won't be sent again automatically.`);
    }
    if (owner !== captured) return;
    sending = false;
    const row = jsonObject(reply) ? reply : {};
    if ((row.type === 'skill' || row.type === 'send') && typeof row.message === 'string' && row.message.trim()) {
      const display = typeof row.display === 'string' && row.display.trim() ? row.display.slice(0, 4000) : text;
      if (typeof row.notice === 'string' && row.notice.trim()) notice = row.notice.slice(0, 300);
      await journaledSend({ captured, connection, chatId, draftText: text, submitText: row.message, display, files: [], busyAtDispatch: running });
      return;
    }
    if (row.type === 'prefill' && typeof row.message === 'string') {
      // Hermes hands text back to edit (for example /undo); nothing is sent.
      await save(draftKey, row.message);
      if (owner === captured) { drafts = { ...drafts, [chatId]: row.message }; notice = typeof row.notice === 'string' ? row.notice.slice(0, 300) : ''; publish(); }
      return;
    }
    const output = typeof row.output === 'string' ? row.output : typeof row.message === 'string' ? row.message : '';
    live = Object.freeze({ ...live, items: Object.freeze([...live.items,
      Object.freeze({ kind: 'message', id: `${id}:out`, direction: 'out', paragraphs: Object.freeze([text]), turn: id }),
      // Command output is formatted for a terminal; show it as preformatted text.
      Object.freeze({ kind: 'message', id: `${id}:in`, direction: 'in', paragraphs: Object.freeze([output.trim()
        ? `\`\`\`text\n${output.replace(/^\n+|\s+$/gu, '').replace(/```/gu, 'ˋˋˋ').slice(0, 256 * 1024)}\n\`\`\`` : `Hermes ran ${token}.`]), turn: id }),
    ] as TranscriptItem[]) });
    applyTranscript(chatId);
    const cleared = await clearSentDraft(draftKey, draftRevision, text);
    if (owner === captured) { if (cleared) drafts = { ...drafts, [chatId]: '' }; notice = ''; publish(); }
  }
  // Stage files on the live session in the chosen order. Images join the session's
  // image queue (claimed by the next prompt); other files return @file: references.
  // Hermes binds neither to one message: another client could interleave.
  async function upload(captured: Owner, connection: Gateway, files: readonly StagedFile[]): Promise<string[]> {
    const references: string[] = [], queued: string[] = [];
    const options = { mutation: true, timeoutMs: 120000, maxBytes: 12 * 1024 * 1024 } as const;
    for (const file of files) {
      const base64 = Buffer.from(file.bytes).toString('base64');
      let reply: unknown;
      try {
        reply = file.kind === 'image'
          ? await connection.call('image.attach_bytes', { session_id: captured.runtimeId, filename: file.name, content_base64: base64 }, options)
          : await connection.call('file.attach', { session_id: captured.runtimeId, name: file.name, data_url: `data:${file.mime};base64,${base64}` }, options);
      } catch (error) {
        if (error instanceof GatewayOperationError) {
          // A definite refusal: take back images already queued, then stop.
          for (const path of queued) await connection.call('image.detach', { session_id: captured.runtimeId, path }).catch(() => undefined);
          throw new UserFacingError(`Couldn't add ${file.name}${error.detail ? `: ${error.detail.replace(/[.!?]?$/u, '.')}` : '.'} Nothing was sent.`);
        }
        notice = 'Not sure the files finished uploading. Nothing was sent. Check the chat before sending again.';
        throw new UserFacingError(notice);
      }
      if (file.kind === 'image') {
        if (!jsonObject(reply) || reply.attached !== true) throw new UserFacingError(`Hermes didn't accept ${file.name}. Nothing was sent.`);
        if (typeof reply.path === 'string' && reply.path.length <= 4096) queued.push(reply.path);
      } else {
        const reference = referenceText(reply);
        if (!reference) throw new UserFacingError(`Hermes didn't accept ${file.name}. Nothing was sent.`);
        references.push(reference);
      }
      if (owner !== captured) throw Error('Chat changed');
    }
    return references;
  }
  // Steer adds the message to the reply in progress. It is not a new turn, so it
  // is not journaled; a lost reply keeps the draft and says so, never resends.
  async function steer(captured: Owner, connection: Gateway, chatId: string, text: string) {
    const draftKey = `draft:${scope(captured.profileId, chatId)}`, draftRevision = revisions.get(draftKey) ?? null;
    const id = `steer:${randomUUID()}`;
    sending = true; publish();
    try {
      let reply: unknown;
      try { reply = await connection.call('session.steer', { session_id: captured.runtimeId, profile: captured.profileId, text }); }
      catch (error) {
        if (error instanceof GatewayOperationError) throw new UserFacingError(error.code === 4010
          ? "This agent can't take a message while it works. In Settings → Chat, choose Queue instead."
          : "Hermes couldn't add this to the current reply. Your message is still in the box.");
        if (owner === captured) {
          live = addOutgoing(live, id, text, 'unknown'); applyTranscript(chatId);
          notice = 'Not sure this reached the agent. Your message is still in the box. Check the reply before sending it again.';
        }
        return;
      }
      if (!jsonObject(reply) || reply.status !== 'queued') {
        throw new UserFacingError("Hermes couldn't add this to the current reply. Your message is still in the box. Send it again when the reply finishes.");
      }
      if (owner !== captured) return;
      live = addOutgoing(live, id, text, 'pending');
      if (live.turn) live = Object.freeze({ ...live, items: live.items.map(item => item.id === id ? Object.freeze({ ...item, turn: live.turn ?? undefined }) as TranscriptItem : item) });
      applyTranscript(chatId);
      const cleared = await clearSentDraft(draftKey, draftRevision, text);
      if (owner !== captured) return;
      if (cleared) drafts = { ...drafts, [chatId]: '' };
      notice = 'Added to the reply in progress.';
    } finally { if (owner === captured) { sending = false; publish(); } }
  }
  async function runCall<K extends CallName>(name: K, input: CallInput<K>, context: CallContext): Promise<CallOutput<K>> {
    return (HANDLERS[name] as CallHandler<K>).run(context, input);
  }
  return Object.freeze({ snapshot,
    // Finite feature calls. Results are validated DTOs for the caller only.
    async call(value: unknown): Promise<Readonly<{ ok: true; value: unknown }> | CallFailure> {
      let action: DesktopAction;
      try { action = parseDesktopAction(value); } catch { return { ok: false, code: 'invalid', message: 'Check the details and try again.' }; }
      if (action.kind !== 'call') return { ok: false, code: 'invalid', message: 'Check the details and try again.' };
      const connection = gateway, current = hostGeneration, verified = identity;
      if (shuttingDown || action.connection !== current || status !== 'connected' || !connection || !verified) {
        return { ok: false, code: 'stale', message: 'Connect to your computer first.' };
      }
      const isCurrent = () => !shuttingDown && current === hostGeneration && connection === gateway && status === 'connected';
      const context: CallContext = Object.freeze({
        rpc: (method: string, params: JsonObject, options?: Parameters<Gateway['call']>[2]) => {
          if (!isCurrent()) return Promise.reject(Error('Host changed'));
          return connection.call(method, params, options);
        },
        http: (route: Parameters<CallContext['http']>[0]) => {
          if (!isCurrent()) return Promise.reject(Error('Host changed'));
          return connection.requestHttp({ kind: 'route', ...route });
        },
        nativeContext: () => {
          if (!isCurrent()) return Promise.reject(Error('Host changed'));
          return connection.requestHttp({ kind: 'nativeContext' });
        },
        identity: verified,
        requireProfile: (profile: string) => {
          if (!data.agents.some(agent => agent.id === profile)) throw new CallError('stale', 'That agent is no longer on your computer.');
          return profile;
        },
        openChat: () => owner && selectedChatId === owner.storedSessionId
          ? Object.freeze({ profile: owner.profileId, storedSessionId: owner.storedSessionId, runtimeId: owner.runtimeId }) : null,
        isCurrent,
        refreshCatalog: async () => { if (isCurrent()) await reloadProfiles(); },
        requestId: () => randomUUID(),
      });
      const mutation = HANDLERS[action.name].mutation;
      try {
        const result = await runCall(action.name, action.input as CallInput<typeof action.name>, context);
        if (!isCurrent()) return { ok: false, code: mutation ? 'unknown' : 'stale', message: mutation ? 'The connection changed. Check whether this finished before trying again.' : 'The connection changed. Try again.' };
        return { ok: true, value: structuredClone(result) };
      } catch (error) { return callFailure(error, mutation); }
    },
    async initialize(): Promise<void> {
      if (!adapters.repository || shuttingDown) return;
      // Capture the host lease before any await: a disconnect during startup wins.
      const current = hostGeneration;
      try {
        const stored = await adapters.repository.read('desktop:preferences');
        if (stored) { preferences = restorePreferences(stored.value); revisions.set('desktop:preferences', stored.revision); publish(); }
      } catch { /* Defaults apply; a corrupt record is never overwritten silently. */ }
      try { adapters.onPreferences?.(preferences); } catch { /* Integration failures never block startup. */ }
      try {
        const enabled = await adapters.repository.read('desktop:autoConnect');
        if (shuttingDown || current !== hostGeneration) return;
        const saved = await adapters.repository.read('desktop:host');
        if (!saved || shuttingDown || current !== hostGeneration) return;
        const action = parseDesktopAction({ kind: 'connect', host: saved.value });
        if (action.kind !== 'connect') return;
        const selection = generation;
        await restoreOffline(action.host, current);
        if (shuttingDown || current !== hostGeneration || selection !== generation || enabled?.value !== true) return;
        await act(action);
      } catch { if (!shuttingDown && current === hostGeneration) { notice = 'Could not restore the connection. Connect again in Settings.'; publish(); } }
    },
    async handle(value: unknown): Promise<DesktopResult> {
      const revision = ++actionRevision;
      let current = generation;
      try { const pending = act(parseDesktopAction(value)); current = generation; await pending; return { ok: true, snapshot: snapshot() }; }
      catch (error) { const message = error instanceof UserFacingError ? error.message : status === 'connecting' ? 'Could not connect. Check the address, sign-in token, and secure storage.'
        : 'The action could not finish. Check the connection and current selection before trying again.';
        if (revision === actionRevision && current === generation) { notice = message; publish(); }
        return { ok: false, message }; }
    },
    shutdown(): Promise<void> {
      shutdownPromise ??= (async () => {
        // Stop every live consumer first, but retain the cache generation until
        // its already captured authoritative projections have had a short drain.
        shuttingDown = true; ++generation; ++workspaceRevision;
        navigation = null; navigationIds = null; workspace = null; owner = null;
        acceptedSends = []; running = false; sending = false; navigating = false; reconciled = false;
        clearPrompts(); const connection = gateway; gateway = undefined; status = 'disconnected'; connection?.close();
        let deadline: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([displayRecovery?.drain() ?? Promise.resolve(),
            new Promise<void>(resolve => { deadline = setTimeout(resolve, 2000); })]);
        } finally { clearTimeout(deadline); retire(true); }
      })();
      return shutdownPromise;
    },
    dispose() { shuttingDown = true; retire(true); },
  });
}
