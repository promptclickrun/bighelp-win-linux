import type { ViewData } from '../../../../packages/ui/view-model.ts';
import type { InteractivePrompt } from '../../../../packages/contracts/prompts.ts';
import type { WorkspaceBoard, WorkspaceDays, WorkspaceProjects, WorkspaceScheduled, WorkspaceUsage } from '../../../../packages/contracts/workspace.ts';
import { CALLS, isCallName } from './calls/index.ts';
import { safeLink } from './links.ts';
import { parsePreferenceChanges } from './preferences.ts';
import type { Preferences } from './preferences.ts';
import type { TodoItem } from '../../../../packages/domain/live-turn.ts';
import type { AppCommand } from './links.ts';
import type { CallInput, CallName, CallResult } from './calls/index.ts';

export type WorkspacePage = 'projects' | 'usage' | 'scheduled' | 'feed' | 'ideas' | 'goals';
export type DesktopWorkspace = Readonly<{ profile: string }> & (
  | Readonly<{ page: WorkspacePage; status: 'loading' | 'unavailable' | 'unsupported' }>
  | Readonly<{ page: 'projects'; status: 'loaded'; data: WorkspaceProjects }>
  | Readonly<{ page: 'usage'; status: 'loaded'; data: WorkspaceUsage }>
  | Readonly<{ page: 'scheduled'; status: 'loaded'; data: WorkspaceScheduled }>
  | Readonly<{ page: 'feed' | 'ideas' | 'goals'; status: 'loaded'; data: WorkspaceBoard }>);

export type HostInput = Readonly<{
  label: string; endpoint: string; authentication: 'dashboard' | 'provider'; token: string; allowPrivateHttp: boolean;
}>;
// Where to look for Hermes. Main turns this into exact origins and probes them
// with no credentials. "saved" re-checks the saved computer (change sign-in).
export type ProbeTargetInput = Readonly<{ kind: 'thisComputer'; port: number }> | Readonly<{ kind: 'address'; address: string }>
  | Readonly<{ kind: 'saved' }>;
// Write-only: the password or token crosses IPC once and is never returned.
export type SignInInput = Readonly<{ probeId: string; label: string }> & (
  | Readonly<{ method: 'automatic' }>
  | Readonly<{ method: 'password'; provider: string; username: string; password: string }>
  | Readonly<{ method: 'token'; token: string }>);
export type SignInKind = 'automatic' | 'password' | 'accessToken' | 'sessionToken';
// Safe display facts about the saved computer. Never an address or a secret.
export type DesktopSavedHost = Readonly<{
  label: string; thisComputer: boolean; signIn: SignInKind | null; account: string | null; plainHttp: boolean; version: string | null;
}>;
export type DesktopReconnect = Readonly<{ state: 'idle' | 'waiting' | 'trying' | 'signIn'; delaySeconds: number }>;
// The result of the last probe: what this computer needs to sign in.
export type DesktopSetup = Readonly<{
  probeId: string; thisComputer: boolean; plainHttp: boolean; version: string | null; signInRequired: boolean;
  methods: readonly ('automatic' | 'password' | 'token')[]; providers: readonly Readonly<{ id: string; name: string }>[];
  replacing: boolean;
}>;
// Why protected storage could not open (Linux keyrings need guidance).
export type StorageIssue = 'keyringMissing' | 'keyringLocked' | 'protectionUnavailable' | 'storageFailed';
export type DesktopHosts = Readonly<{
  saved: DesktopSavedHost | null; reconnect: DesktopReconnect; setup: DesktopSetup | null; storageIssue: StorageIssue | null;
}>;
export type DesktopSnapshot = Readonly<{
  // generation retires chat selections; connection retires the whole host lease.
  generation: number; connection: number; revision: number; status: 'disconnected' | 'connecting' | 'connected';
  data: ViewData; selectedChatId: string | null; running: boolean; canSend: boolean;
  notice: string; storageAvailable: boolean;
  prompts: readonly Readonly<{ id: string; prompt: InteractivePrompt }>[];
  drafts: Readonly<Record<string, string>>;
  workspace: DesktopWorkspace | null;
  preferences: Preferences;
  // The open chat's reply in progress: still status words, to-dos, context use.
  // Files chosen for the open chat's next message (names and sizes only).
  attachments: readonly PendingAttachment[];
  turn: Readonly<{ key: string | null; model: Readonly<{ name: string; provider: string; reasoning: string }> | null; status: string; todos: readonly TodoItem[]; context: Readonly<{ used: number; max: number }> | null; startedAt: number | null }>;
  hosts?: DesktopHosts;
}>;
export type PendingAttachment = Readonly<{ id: string; name: string; size: number; kind: 'image' | 'file' }>;
// Something that needs a person while bighelp runs. Main decides whether to show
// an OS notification (preferences, focus, the chat on screen); never a decision path.
export type DesktopAlert = Readonly<{
  kind: 'approval' | 'question' | 'reply' | 'failed'; chatId: string; agentName: string; text: string;
}>;
export type DesktopResult = Readonly<{ ok: true; snapshot: DesktopSnapshot }> | Readonly<{ ok: false; message: string }>;
export type DesktopAction =
  | Readonly<{ kind: 'snapshot' }>
  | Readonly<{ kind: 'disconnect' }>
  | Readonly<{ kind: 'cancelNavigation'; generation: number; requestId: string }>
  | Readonly<{ kind: 'refresh' }>
  | Readonly<{ kind: 'preferences'; changes: Partial<Preferences> }>
  | Readonly<{ kind: 'connect'; host: HostInput }>
  | Readonly<{ kind: 'probeHost'; target: ProbeTargetInput }>
  | (Readonly<{ kind: 'signIn' }> & SignInInput)
  | Readonly<{ kind: 'cancelSetup' }> | Readonly<{ kind: 'forgetHost' }> | Readonly<{ kind: 'reconnectNow' }> | Readonly<{ kind: 'connectSaved' }>
  | Readonly<{ kind: 'renameHost'; label: string }>
  | Readonly<{ kind: 'canonicalChat'; generation: number; profile: string; requestId: string }>
  | Readonly<{ kind: 'newChat'; generation: number; profile: string }>
  // profile: only for a chat found by host search that is not in the loaded list.
  | Readonly<{ kind: 'openChat'; generation: number; chatId: string; profile?: string }>
  | Readonly<{ kind: 'send'; generation: number; chatId: string; text: string }>
  | Readonly<{ kind: 'interrupt'; generation: number; chatId: string }>
  | Readonly<{ kind: 'answer'; generation: number; promptId: string; answer: unknown }>
  | Readonly<{ kind: 'draft'; generation: number; chatId: string; text: string }>
  | Readonly<{ kind: 'attach'; generation: number; chatId: string }>
  | Readonly<{ kind: 'attachDropped'; generation: number; chatId: string; files: readonly Readonly<{ name: string; bytes: Uint8Array }>[] }>
  | Readonly<{ kind: 'detach'; generation: number; chatId: string; attachmentId: string }>
  | Readonly<{ kind: 'workspace'; generation: number; profile: string; page: WorkspacePage; days: WorkspaceDays }>
  | { [K in CallName]: Readonly<{ kind: 'call'; connection: number; name: K; input: CallInput<K> }> }[CallName];

export type DesktopApi = Readonly<{
  snapshot(): Promise<DesktopResult>;
  connect(host: HostInput): Promise<DesktopResult>;
  disconnect(): Promise<DesktopResult>;
  probeHost(target: ProbeTargetInput): Promise<DesktopResult>;
  signIn(input: SignInInput): Promise<DesktopResult>;
  cancelSetup(): Promise<DesktopResult>;
  renameHost(label: string): Promise<DesktopResult>;
  forgetHost(): Promise<DesktopResult>;
  // Try the saved computer now, only while an automatic retry is waiting.
  reconnectNow(): Promise<DesktopResult>;
  // Connect the saved computer (after Disconnect or a failed connect).
  connectSaved(): Promise<DesktopResult>;
  refresh(): Promise<DesktopResult>;
  preferences(changes: Partial<Preferences>): Promise<DesktopResult>;
  canonicalChat(generation: number, profile: string, requestId: string): Promise<DesktopResult>;
  cancelNavigation(generation: number, requestId: string): Promise<DesktopResult>;
  newChat(generation: number, profile: string): Promise<DesktopResult>;
  openChat(generation: number, chatId: string, profile?: string): Promise<DesktopResult>;
  send(generation: number, chatId: string, text: string): Promise<DesktopResult>;
  interrupt(generation: number, chatId: string): Promise<DesktopResult>;
  answer(generation: number, promptId: string, answer: unknown): Promise<DesktopResult>;
  draft(generation: number, chatId: string, text: string): Promise<DesktopResult>;
  // Main opens the system file picker; the window only ever sees names and sizes.
  attach(generation: number, chatId: string): Promise<DesktopResult>;
  // Files dropped on the conversation; read by the window only up to the size limit.
  attachDropped(generation: number, chatId: string, files: readonly Readonly<{ name: string; bytes: Uint8Array }>[]): Promise<DesktopResult>;
  detach(generation: number, chatId: string, attachmentId: string): Promise<DesktopResult>;
  workspace(generation: number, profile: string, page: WorkspacePage, days: WorkspaceDays): Promise<DesktopResult>;
  call<K extends CallName>(connection: number, name: K, input: CallInput<K>): Promise<CallResult<K>>;
  openLink(url: string): Promise<boolean>;
  copyText(text: string): Promise<boolean>;
  onCommand(listener: (command: AppCommand) => void): () => void;
  subscribe(listener: (snapshot: DesktopSnapshot) => void): () => void;
}>;

export const DESKTOP_CHANNEL = 'bighelp:desktop';
export const CALL_CHANNEL = 'bighelp:call';
export const SHELL_CHANNEL = 'bighelp:shell';
export const COMMAND_CHANNEL = 'bighelp:command';
// Window-level conveniences handled by main without any host involvement.
export type ShellAction = Readonly<{ kind: 'openLink'; url: string }> | Readonly<{ kind: 'copyText'; text: string }>;
export function parseShellAction(value: unknown): ShellAction {
  const input = object(value);
  if (input.kind === 'openLink') {
    keys(input, ['kind', 'url']);
    const url = typeof input.url === 'string' ? safeLink(input.url) : null;
    if (!url) throw new TypeError('Invalid link');
    return { kind: 'openLink', url };
  }
  if (input.kind === 'copyText') {
    keys(input, ['kind', 'text']);
    if (typeof input.text !== 'string' || input.text.length > 2 * 1024 * 1024 || !input.text.isWellFormed()) throw new TypeError('Invalid text');
    return { kind: 'copyText', text: input.text };
  }
  throw new TypeError('Unsupported shell action');
}
export const SNAPSHOT_CHANNEL = 'bighelp:snapshot';

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid operation');
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, expected: readonly string[]): void {
  if (Object.keys(value).length !== expected.length || expected.some(key => !Object.hasOwn(value, key))) {
    throw new TypeError('Invalid operation fields');
  }
}
function text(value: unknown, max = 1024): string {
  if (typeof value !== 'string' || !value.length || value.length > max || !value.isWellFormed() || value.includes('\0')) {
    throw new TypeError('Invalid text');
  }
  return value;
}

// A computer name a person typed: one trimmed line.
function hostName(value: unknown): string {
  const label = text(value, 200).trim();
  if (!label || label.length > 100 || /[\x00-\x1f\x7f]/u.test(label)) throw new TypeError('Invalid name');
  return label;
}

// Validate every renderer operation again in main. There is no URL, method,
// filesystem or shell dispatch except the explicit one-time host setup input.
export function parseDesktopAction(value: unknown): DesktopAction {
  const input = object(value);
  const kind = input.kind;
  if (kind === 'snapshot' || kind === 'disconnect' || kind === 'refresh' || kind === 'cancelSetup' || kind === 'forgetHost'
    || kind === 'reconnectNow' || kind === 'connectSaved') {
    keys(input, ['kind']); return { kind };
  }
  if (kind === 'probeHost') {
    keys(input, ['kind', 'target']);
    const target = object(input.target);
    if (target.kind === 'saved') { keys(target, ['kind']); return { kind, target: { kind: 'saved' } }; }
    if (target.kind === 'thisComputer') {
      keys(target, ['kind', 'port']);
      if (typeof target.port !== 'number' || !Number.isSafeInteger(target.port) || target.port < 1 || target.port > 65535) throw new TypeError('Invalid port');
      return { kind, target: { kind: 'thisComputer', port: target.port } };
    }
    if (target.kind !== 'address') throw new TypeError('Invalid target');
    keys(target, ['kind', 'address']);
    return { kind, target: { kind: 'address', address: text(target.address, 2048) } };
  }
  if (kind === 'signIn') {
    const probeId = text(input.probeId, 36);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(probeId)) throw new TypeError('Invalid probe');
    const label = hostName(input.label);
    if (input.method === 'automatic') { keys(input, ['kind', 'probeId', 'label', 'method']); return { kind, probeId, label, method: 'automatic' }; }
    if (input.method === 'password') {
      keys(input, ['kind', 'probeId', 'label', 'method', 'provider', 'username', 'password']);
      if (typeof input.provider !== 'string' || input.provider.length > 128 || /[^\x21-\x7e]/u.test(input.provider)) throw new TypeError('Invalid provider');
      return { kind, probeId, label, method: 'password', provider: input.provider, username: text(input.username, 1024), password: text(input.password, 16384) };
    }
    if (input.method !== 'token') throw new TypeError('Invalid method');
    keys(input, ['kind', 'probeId', 'label', 'method', 'token']);
    const token = text(input.token, 8192);
    if (!/^[\x21-\x7e]+$/u.test(token)) throw new TypeError('Invalid token');
    return { kind, probeId, label, method: 'token', token };
  }
  if (kind === 'renameHost') {
    keys(input, ['kind', 'label']); return { kind, label: hostName(input.label) };
  }
  if (kind === 'preferences') {
    keys(input, ['kind', 'changes']);
    return { kind, changes: parsePreferenceChanges(input.changes) };
  }
  if (kind === 'connect') {
    keys(input, ['kind', 'host']);
    const host = object(input.host);
    keys(host, ['label', 'endpoint', 'authentication', 'token', 'allowPrivateHttp']);
    if ((host.authentication !== 'dashboard' && host.authentication !== 'provider') || typeof host.allowPrivateHttp !== 'boolean') {
      throw new TypeError('Invalid host');
    }
    return { kind, host: { label: text(host.label, 100), endpoint: text(host.endpoint, 2048),
      authentication: host.authentication, token: text(host.token, 8192), allowPrivateHttp: host.allowPrivateHttp } };
  }
  if (kind === 'call') {
    keys(input, ['kind', 'connection', 'name', 'input']);
    const name = input.name;
    if (typeof input.connection !== 'number' || !Number.isSafeInteger(input.connection) || input.connection < 0 || !isCallName(name)) {
      throw new TypeError('Invalid call');
    }
    // The feature's own strict parser; failures never reach a handler.
    const parsed: unknown = CALLS[name].parse(input.input);
    return { kind, connection: input.connection, name, input: parsed } as DesktopAction;
  }
  if (typeof input.generation !== 'number' || !Number.isSafeInteger(input.generation) || input.generation < 0) {
    throw new TypeError('Invalid generation');
  }
  const generation = input.generation;
  if (kind === 'cancelNavigation') {
    keys(input, ['kind', 'generation', 'requestId']); return {kind, generation, requestId: text(input.requestId, 128)};
  }
  if (kind === 'workspace') {
    keys(input, ['kind', 'generation', 'profile', 'page', 'days']);
    const page = input.page, days = input.days;
    if (page !== 'projects' && page !== 'usage' && page !== 'scheduled' && page !== 'feed' && page !== 'ideas' && page !== 'goals') throw new TypeError('Invalid page');
    if (days !== 7 && days !== 30 && days !== 90) throw new TypeError('Invalid range');
    return { kind, generation, profile: text(input.profile), page, days };
  }
  if (kind === 'canonicalChat') {
    keys(input, ['kind', 'generation', 'profile', 'requestId']);
    return {kind, generation, profile: text(input.profile), requestId: text(input.requestId, 128)};
  }
  if (kind === 'newChat') {
    keys(input, ['kind', 'generation', 'profile']); return { kind, generation, profile: text(input.profile) };
  }
  if (kind === 'openChat' && Object.hasOwn(input, 'profile')) {
    keys(input, ['kind', 'generation', 'chatId', 'profile']);
    return { kind, generation, chatId: text(input.chatId), profile: text(input.profile) };
  }
  if (kind === 'openChat' || kind === 'interrupt') {
    keys(input, ['kind', 'generation', 'chatId']); return { kind, generation, chatId: text(input.chatId) };
  }
  if (kind === 'attach') {
    keys(input, ['kind', 'generation', 'chatId']); return { kind, generation, chatId: text(input.chatId) };
  }
  if (kind === 'attachDropped') {
    keys(input, ['kind', 'generation', 'chatId', 'files']);
    if (!Array.isArray(input.files) || !input.files.length || input.files.length > 10) throw new TypeError('Invalid files');
    const files = input.files.map(entry => {
      const file = object(entry); keys(file, ['name', 'bytes']);
      if (!(file.bytes instanceof Uint8Array) || file.bytes.byteLength > 8 * 1024 * 1024 + 1) throw new TypeError('Invalid file');
      return { name: text(file.name, 1024), bytes: new Uint8Array(file.bytes) };
    });
    return { kind, generation, chatId: text(input.chatId), files };
  }
  if (kind === 'detach') {
    keys(input, ['kind', 'generation', 'chatId', 'attachmentId']);
    return { kind, generation, chatId: text(input.chatId), attachmentId: text(input.attachmentId, 64) };
  }
  if (kind === 'send' || kind === 'draft') {
    keys(input, ['kind', 'generation', 'chatId', 'text']);
    // An empty send is allowed only with attachments; main checks that.
    if (typeof input.text !== 'string' || input.text.length > 262144 || !input.text.isWellFormed() || input.text.includes('\0')) throw new TypeError('Invalid message');
    return { kind, generation, chatId: text(input.chatId), text: input.text };
  }
  if (kind === 'answer') {
    keys(input, ['kind', 'generation', 'promptId', 'answer']);
    // Method-specific validation is performed against the retained prompt by main.
    const answer = input.answer;
    if (typeof answer !== 'string' && (!answer || typeof answer !== 'object' || Array.isArray(answer))) throw new TypeError('Invalid answer');
    const entries = typeof answer === 'string' ? [['answer', answer]] : Object.entries(answer);
    if (entries.length > 10 || entries.some(([key, entry]) => typeof key !== 'string' || key.length > 4096
      || typeof entry !== 'string' || entry.length > 10000 || !entry.isWellFormed() || entry.includes('\0'))) throw new TypeError('Invalid answer');
    return { kind, generation, promptId: text(input.promptId), answer: typeof answer === 'string' ? answer : Object.fromEntries(entries) };
  }
  throw new TypeError('Unsupported operation');
}
