import { createHash, randomUUID } from 'node:crypto';
import { createChatDisplayRecovery, offlineDisplay, recoveryBinding } from './chat-display-recovery.ts';
import type { DisplayCacheData, DisplayCacheScope } from '../../../../packages/platform/display-cache.ts';
import { createTextSend } from '../../../../packages/domain/text-send.ts';
import type { TextIntent } from '../../../../packages/domain/text-send.ts';
import { transitionSend } from '../../../../packages/domain/chat-contract.ts';
import type { Owner } from '../../../../packages/domain/chat-contract.ts';
import type { JsonValue, JsonObject, RpcEvent, RpcServerRequest, ServerReply } from '../../../../packages/contracts/rpc.ts';
import { jsonObject } from '../../../../packages/contracts/rpc.ts';
import { decodeProfiles, decodeSessionList, decodeSessionReceipt, decodeSessionHistory } from '../../../../packages/contracts/session.ts';
import { parseInteractivePrompt, encodeInteractiveAnswer } from '../../../../packages/contracts/prompts.ts';
import type { InteractivePrompt } from '../../../../packages/contracts/prompts.ts';
import type { Gateway } from '../../../../packages/hermes-client/gateway.ts';
import { createCanonicalChatClient } from '../../../../packages/hermes-client/canonical-chat.ts';
import type { CanonicalState } from '../../../../packages/contracts/canonical-chat.ts';
import { createWorkspaceClient } from '../../../../packages/hermes-client/workspace.ts';
import type { WorkspaceIdentity, WorkspaceOwner } from '../../../../packages/contracts/workspace.ts';
import { parseEndpoint } from '../../../../packages/platform/transport-policy.ts';
import type { ProtectedValue } from '../../../../packages/platform/protected-repository.ts';
import { EMPTY_DATA } from '../../../../packages/ui/view-model.ts';
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

export function createDesktopService(adapters: Readonly<{
  repository: Repository | null; connect: (options: ConnectOptions) => Promise<Gateway>;
  onChange: (snapshot: DesktopSnapshot) => void;
  // Optional desktop integrations owned by main (notifications, tray, login item).
  onPreferences?: (preferences: Preferences) => void;
  notify?: (alert: DesktopAlert) => void;
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
  let stream = '', streamId = '', lastSequence: number | null = null;
  let turnBookends = 0;
  let historyRevision = 0;
  let acceptedSend: { intent: TextIntent; key: string; bookend: number; settlement?: Promise<void> } | null = null;
  const prompts = new Map<string, PendingPrompt>();
  const revisions = new Map<string, number>();
  let writes = Promise.resolve();
  const canSend = () => status === 'connected' && !!owner && !!gateway?.exclusiveSubmit && !!adapters.repository
    && reconciled && !running && !sending && !navigating;
  function snapshot(): DesktopSnapshot {
    return structuredClone({ generation, connection: hostGeneration, revision: ++snapshotRevision, status, data, selectedChatId, running, canSend: canSend(), notice,
      storageAvailable: !!adapters.repository, prompts: [...prompts].map(([id, entry]) => ({ id, prompt: entry.prompt })), drafts, workspace,
      preferences });
  }
  const publish = () => adapters.onChange(snapshot());
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
    navigation = null; navigationIds = null; ++hostGeneration; ++generation; owner = null; acceptedSend = null; reconciled = false; running = false; sending = false; navigating = false;
    ++workspaceRevision; workspace = null; identity = null;
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
  async function history(captured: Owner, connection: Gateway) {
    const revision = ++historyRevision;
    const messages = decodeSessionHistory(await connection.operation({ kind: 'sessionHistory', profile: captured.profileId, runtimeId: captured.runtimeId }));
    if (owner !== captured || gateway !== connection || revision !== historyRevision) return;
    const accepted = acceptedSend;
    if (accepted && !running && turnBookends > accepted.bookend) {
      // Only a known accepted send with a live terminal bookend can complete.
      // Recovered/unknown records are never promoted merely by seeing history.
      accepted.settlement ??= (async () => {
        const terminal = { ...transitionSend(accepted.intent, { type: 'terminalVerified' }, captured), request: accepted.intent.request };
        await commitIntent(accepted.key, terminal);
        await commitIntent(accepted.key, { ...transitionSend(terminal, { type: 'historyVerified' }, captured), request: terminal.request });
      })();
      await accepted.settlement;
      if (acceptedSend === accepted) acceptedSend = null;
      if (owner !== captured || gateway !== connection || revision !== historyRevision) return;
    }
    updateChat(captured.storedSessionId, chat => ({ ...chat, transcript: messages.map(row => ({ kind: 'message', id: row.id,
      direction: row.role === 'user' ? 'out' : 'in', paragraphs: [row.text] })), preview: messages.at(-1)?.text.slice(0, 160) ?? '' }));
    const authoritative = data.chats.find(chat => chat.id === captured.storedSessionId && chat.agentId === captured.profileId);
    if (authoritative) liveRecovery?.history(authoritative);
    reconciled = true; publish();
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
    const type = event.params.type, payload = event.params.payload;
    if (!jsonObject(payload)) return;
    if (['message.start', 'message.delta', 'message.complete', 'message.interim', 'session.reclaimed', 'error'].includes(String(type))
      || (type === 'session.info' && typeof payload.running === 'boolean')) ++historyRevision;
    if (type === 'session.reclaimed') { retire(); notice = 'Another client took over this session. Reconnect to continue.'; publish(); return; }
    if (type === 'message.start') { running = true; stream = ''; streamId = `stream:${randomUUID()}`; }
    if (type === 'message.delta' || type === 'message.complete' || type === 'message.interim') {
      if (typeof payload.text === 'string') {
        stream = type === 'message.delta' ? stream + payload.text : payload.text;
        if (Buffer.byteLength(stream) > 1024 * 1024) { retire(); notice = 'This response exceeds the display limit. Reopen its saved history.'; publish(); return; }
        if (!streamId) streamId = `stream:${randomUUID()}`;
        running = true;
        const item: TranscriptItem = { kind: 'message', id: streamId, direction: 'in', paragraphs: [stream] };
        updateChat(captured.storedSessionId, chat => ({ ...chat, transcript: [...chat.transcript.filter(row => row.id !== streamId), item] }));
      }
      if (type !== 'message.delta') { stream = ''; streamId = ''; }
    }
    if (type === 'error' || (type === 'message.complete' && payload.status === 'error')) {
      notice = 'Hermes reported a problem. Check the conversation before trying again.';
    }
    if (type === 'session.info' && typeof payload.running === 'boolean') {
      running = payload.running;
      if (!running && connection) {
        ++turnBookends;
        reconciled = false;
        void history(captured, connection).catch(() => { if (owner === captured) { notice = 'Could not check saved history. Reopen the chat before sending.'; publish(); } });
      }
    }
    publish();
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
    navigating = true; reconciled = false; owner = null; selectedChatId = null; acceptedSend = null; clearPrompts(); ++generation;
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
      selectedChatId = receipt.storedSessionId; running = receipt.running; lastSequence = null; stream = ''; streamId = '';
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
        navigation = null; navigationIds = null; ++generation; owner = null; selectedChatId = null; acceptedSend = null;
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
    if (action.kind === 'interrupt') {
      await connection.operation({ kind: 'sessionInterrupt', profile: captured.profileId, runtimeId: captured.runtimeId }); return;
    }
    if (!canSend()) throw Error('Chat is not ready');
    sending = true; let dispatchAttempted = false;
    const intentKey = `journal:${scope(captured.profileId, action.chatId)}`, draftKey = `draft:${scope(captured.profileId, action.chatId)}`;
    const draftRevision = revisions.get(draftKey) ?? null;
    let bookendAtDispatch = turnBookends; publish();
    try {
      const result = await createTextSend({ id: randomUUID(), requestId: randomUUID(), owner: captured, text: action.text }, {
        currentOwner: () => owner === captured && status === 'connected' ? captured : null,
        commit: intent => commitIntent(intentKey, intent), submit: request => { dispatchAttempted = true; bookendAtDispatch = turnBookends; return connection.submitText(request); },
      })();
      if (owner !== captured) return;
      const pending: TranscriptItem = { kind: 'message', id: result.id, direction: 'out', paragraphs: [action.text],
        delivery: result.phase === 'accepted' ? 'pending' : 'unknown' };
      updateChat(action.chatId, chat => ({ ...chat, transcript: [...chat.transcript, pending] }));
      if (result.phase === 'accepted') {
        acceptedSend = { intent: result, key: intentKey, bookend: bookendAtDispatch };
        const cleared = await clearSentDraft(draftKey, draftRevision, action.text);
        if (owner !== captured) return;
        if (cleared) drafts = { ...drafts, [action.chatId]: '' };
        if (turnBookends === bookendAtDispatch) { running = true; notice = 'Hermes accepted your message.'; }
        else { await history(captured, connection); }
      } else { reconciled = false; notice = 'Not sure this arrived. Reopen the chat to check saved history. Nothing will be resent automatically.'; }
    } catch (error) {
      if (owner === captured && dispatchAttempted) { reconciled = false; notice = 'The send outcome could not be saved. Reopen the chat to check history before sending again.'; }
      throw error;
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
      catch { const message = status === 'connecting' ? 'Could not connect. Check the address, sign-in token, and secure storage.'
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
        acceptedSend = null; running = false; sending = false; navigating = false; reconciled = false;
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
