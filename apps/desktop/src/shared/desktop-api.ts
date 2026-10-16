import type { ViewData } from '../../../../packages/ui/view-model.ts';
import type { InteractivePrompt } from '../../../../packages/contracts/prompts.ts';
import type { WorkspaceBoard, WorkspaceDays, WorkspaceProjects, WorkspaceScheduled, WorkspaceUsage } from '../../../../packages/contracts/workspace.ts';
import { CALLS, isCallName } from './calls/index.ts';
import { safeLink } from './links.ts';
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
export type DesktopSnapshot = Readonly<{
  // generation retires chat selections; connection retires the whole host lease.
  generation: number; connection: number; revision: number; status: 'disconnected' | 'connecting' | 'connected';
  data: ViewData; selectedChatId: string | null; running: boolean; canSend: boolean;
  notice: string; storageAvailable: boolean;
  prompts: readonly Readonly<{ id: string; prompt: InteractivePrompt }>[];
  drafts: Readonly<Record<string, string>>;
  workspace: DesktopWorkspace | null;
}>;
export type DesktopResult = Readonly<{ ok: true; snapshot: DesktopSnapshot }> | Readonly<{ ok: false; message: string }>;
export type DesktopAction =
  | Readonly<{ kind: 'snapshot' }>
  | Readonly<{ kind: 'disconnect' }>
  | Readonly<{ kind: 'cancelNavigation'; generation: number; requestId: string }>
  | Readonly<{ kind: 'refresh' }>
  | Readonly<{ kind: 'connect'; host: HostInput }>
  | Readonly<{ kind: 'canonicalChat'; generation: number; profile: string; requestId: string }>
  | Readonly<{ kind: 'newChat'; generation: number; profile: string }>
  | Readonly<{ kind: 'openChat'; generation: number; chatId: string }>
  | Readonly<{ kind: 'send'; generation: number; chatId: string; text: string }>
  | Readonly<{ kind: 'interrupt'; generation: number; chatId: string }>
  | Readonly<{ kind: 'answer'; generation: number; promptId: string; answer: unknown }>
  | Readonly<{ kind: 'draft'; generation: number; chatId: string; text: string }>
  | Readonly<{ kind: 'workspace'; generation: number; profile: string; page: WorkspacePage; days: WorkspaceDays }>
  | { [K in CallName]: Readonly<{ kind: 'call'; connection: number; name: K; input: CallInput<K> }> }[CallName];

export type DesktopApi = Readonly<{
  snapshot(): Promise<DesktopResult>;
  connect(host: HostInput): Promise<DesktopResult>;
  disconnect(): Promise<DesktopResult>;
  refresh(): Promise<DesktopResult>;
  canonicalChat(generation: number, profile: string, requestId: string): Promise<DesktopResult>;
  cancelNavigation(generation: number, requestId: string): Promise<DesktopResult>;
  newChat(generation: number, profile: string): Promise<DesktopResult>;
  openChat(generation: number, chatId: string): Promise<DesktopResult>;
  send(generation: number, chatId: string, text: string): Promise<DesktopResult>;
  interrupt(generation: number, chatId: string): Promise<DesktopResult>;
  answer(generation: number, promptId: string, answer: unknown): Promise<DesktopResult>;
  draft(generation: number, chatId: string, text: string): Promise<DesktopResult>;
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

// Validate every renderer operation again in main. There is no URL, method,
// filesystem or shell dispatch except the explicit one-time host setup input.
export function parseDesktopAction(value: unknown): DesktopAction {
  const input = object(value);
  const kind = input.kind;
  if (kind === 'snapshot' || kind === 'disconnect' || kind === 'refresh') {
    keys(input, ['kind']); return { kind };
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
  if (kind === 'openChat' || kind === 'interrupt') {
    keys(input, ['kind', 'generation', 'chatId']); return { kind, generation, chatId: text(input.chatId) };
  }
  if (kind === 'send' || kind === 'draft') {
    keys(input, ['kind', 'generation', 'chatId', 'text']);
    if (typeof input.text !== 'string' || input.text.length > 262144 || !input.text.isWellFormed() || input.text.includes('\0')
      || (kind === 'send' && !input.text.trim())) throw new TypeError('Invalid message');
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
