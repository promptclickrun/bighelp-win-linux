import { boundedString, encodeBoundedJson } from './rpc.ts';

// Display-only projections. Unknown metadata is discarded; no route, credential,
// code, attachment URL, prompt or executable action crosses this boundary.
export type WorkspaceOwner = Readonly<{
  hostId: string; principalId: string; profileId: string;
  authGeneration: number; connectionGeneration: number;
}>;
export type WorkspaceIdentity = Readonly<{ kind: 'dashboard' }>
  | Readonly<{ kind: 'provider'; providerId: string; userId: string }>;
export type WorkspaceTab = 'feed' | 'ideas' | 'goals';
export type WorkspaceDays = 7 | 30 | 90;
export type WorkspaceResult<T> = Readonly<{ status: 'loaded'; data: T }>
  | Readonly<{ status: 'unsupported'; reason: 'host-update' | 'plugin-update' }>;
export type WorkspaceProject = Readonly<{
  id: string; name: string; description?: string; archived: boolean;
  folders: readonly Readonly<{ path: string; label?: string; primary: boolean }>[];
}>;
export type WorkspaceProjects = Readonly<{ projects: readonly WorkspaceProject[]; activeId: string | null }>;
export type WorkspaceUsageMetrics = Readonly<{
  inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; reasoningTokens?: number;
  estimatedCost?: number; actualCost?: number; sessions?: number; apiCalls?: number;
}>;
export type WorkspaceUsage = Readonly<{
  days: WorkspaceDays; totals: WorkspaceUsageMetrics;
  daily: readonly (WorkspaceUsageMetrics & Readonly<{ day: string }>)[];
  models: readonly (WorkspaceUsageMetrics & Readonly<{ name: string }>)[];
}>;
export type WorkspaceScheduled = Readonly<{ tasks: readonly Readonly<{
  id: string; name: string; schedule: string; state: 'scheduled' | 'running' | 'paused' | 'completed' | 'error';
  enabled: boolean; nextRunAt?: string; lastResult?: string;
}>[] }>;
export type WorkspaceBoard = Readonly<{ tab: WorkspaceTab; items: readonly Readonly<{
  id: string; kind: 'feed' | 'idea' | 'goal'; title: string; body?: string; status?: string;
  note?: string; category?: string; createdAt?: string; updatedAt?: string; read?: boolean; dismissed?: boolean;
}>[] }>;

const invalid = (): never => { throw new TypeError('Invalid workspace response'); };
function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
function bounded(value: unknown, maximumBytes = 2 * 1024 * 1024): Record<string, unknown> {
  encodeBoundedJson(value, maximumBytes);
  return object(value);
}
function text(value: unknown, max: number, empty = false): string {
  const result = boundedString(value, max);
  if ((!empty && !result.trim()) || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/u.test(result)) return invalid();
  return result;
}
function identifier(value: unknown, max = 256): string {
  const result = text(value, max);
  if (result.trim() !== result || /\s/u.test(result)) return invalid();
  return result;
}
function optionalText(value: unknown, max: number): string | undefined {
  return value === undefined || value === null ? undefined : text(value, max, true);
}
function optionalField<K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> {
  return value === undefined ? {} : { [key]: value } as Record<K, V>;
}
function rows(value: unknown, max: number): readonly unknown[] {
  if (!Array.isArray(value) || value.length > max) return invalid();
  return value;
}
function boolean(value: unknown): boolean { if (typeof value !== 'boolean') return invalid(); return value; }
function unique<T>(values: T[], key: (value: T) => string): readonly T[] {
  if (new Set(values.map(key)).size !== values.length) return invalid();
  return Object.freeze(values);
}
function profileEcho(row: Record<string, unknown>, profile: string): void {
  for (const key of ['profile', 'profileId', 'agentId']) {
    if (row[key] !== undefined && row[key] !== profile) return invalid();
  }
}
export function workspaceProfile(value: unknown): string {
  const result = identifier(value, 128);
  if (result === 'all' || result === '.' || result === '..' || /[/\\]/u.test(result)) return invalid();
  return result;
}
export function workspaceDays(value: unknown): WorkspaceDays {
  if (value !== 7 && value !== 30 && value !== 90) return invalid();
  return value;
}
export function workspaceTab(value: unknown): WorkspaceTab {
  if (value !== 'feed' && value !== 'ideas' && value !== 'goals') return invalid();
  return value;
}
export function workspaceETag(value: unknown): string {
  const tag = identifier(value, 73);
  if (!/^"sha256:[0-9a-f]{64}"$/u.test(tag)) return invalid();
  return tag;
}
// The plugin refuses anything but a lowercase RFC 4122 version 1-5, variant 8-b
// UUID (native_api.py _REQUEST_ID); crypto.randomUUID() makes version 4.
export function workspaceRequestId(value: unknown): string {
  const id = identifier(value, 36);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(id)) return invalid();
  return id;
}
export function parseWorkspaceOwner(value: unknown): WorkspaceOwner {
  const input = object(value);
  function generation(key: string): number {
    const number = input[key];
    if (typeof number !== 'number' || !Number.isSafeInteger(number) || number < 0) return invalid();
    return number;
  }
  return Object.freeze({ hostId: identifier(input.hostId), principalId: identifier(input.principalId),
    profileId: workspaceProfile(input.profileId), authGeneration: generation('authGeneration'),
    connectionGeneration: generation('connectionGeneration') });
}
export function parseWorkspaceIdentity(value: unknown): WorkspaceIdentity {
  const input = object(value);
  if (input.kind === 'dashboard') return Object.freeze({ kind: 'dashboard' });
  if (input.kind !== 'provider') return invalid();
  return Object.freeze({ kind: 'provider', providerId: identifier(input.providerId), userId: identifier(input.userId) });
}
export function sameWorkspaceOwner(owner: WorkspaceOwner, current: WorkspaceOwner | null): boolean {
  return current !== null && owner.hostId === current.hostId && owner.principalId === current.principalId
    && owner.profileId === current.profileId && owner.authGeneration === current.authGeneration
    && owner.connectionGeneration === current.connectionGeneration;
}

export function decodeWorkspaceProjects(value: unknown, profile: string): WorkspaceProjects {
  workspaceProfile(profile);
  const payload = bounded(value, 4 * 1024 * 1024); profileEcho(payload, profile);
  const projects = unique(rows(payload.projects, 1000).map(value => {
    const row = object(value); profileEcho(row, profile);
    const folders = unique(rows(row.folders, 100).map(value => {
      const folder = object(value);
      return Object.freeze({ path: text(folder.path, 4096), ...optionalField('label', optionalText(folder.label, 512)),
        primary: boolean(folder.is_primary) });
    }), folder => folder.path);
    return Object.freeze({ id: identifier(row.id, 128), name: text(row.name, 200),
      ...optionalField('description', optionalText(row.description, 8192)), archived: boolean(row.archived), folders });
  }), project => project.id);
  const active = payload.active_id === null ? null : identifier(payload.active_id, 128);
  // Hermes may retain a deleted/archived active pointer. A read never repairs it.
  const activeId = projects.some(project => project.id === active && !project.archived) ? active : null;
  return Object.freeze({ projects, activeId });
}

const metricKeys = [
  ['inputTokens', 'input_tokens', 'total_input'], ['outputTokens', 'output_tokens', 'total_output'],
  ['cacheReadTokens', 'cache_read_tokens', 'total_cache_read'], ['reasoningTokens', 'reasoning_tokens', 'total_reasoning'],
  ['estimatedCost', 'estimated_cost', 'total_estimated_cost'], ['actualCost', 'actual_cost', 'total_actual_cost'],
  ['sessions', 'sessions', 'total_sessions'], ['apiCalls', 'api_calls', 'total_api_calls'],
] as const;
function metrics(row: Record<string, unknown>, total = false): WorkspaceUsageMetrics {
  const result: Partial<Record<keyof WorkspaceUsageMetrics, number>> = {};
  for (const [key, ordinary, summed] of metricKeys) {
    const value = row[total ? summed : ordinary];
    const money = key === 'estimatedCost' || key === 'actualCost';
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER
      && (money || Number.isSafeInteger(value))) result[key] = value;
  }
  return Object.freeze(result);
}
function day(value: unknown): string {
  const result = text(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(result)) return invalid();
  const instant = Date.parse(`${result}T00:00:00Z`);
  if (!Number.isFinite(instant) || new Date(instant).toISOString().slice(0, 10) !== result) return invalid();
  return result;
}
export function decodeWorkspaceUsage(value: unknown, profile: string, days: WorkspaceDays): WorkspaceUsage {
  workspaceProfile(profile); workspaceDays(days);
  const payload = bounded(value); profileEcho(payload, profile);
  if (payload.daily === undefined && payload.totals === undefined) return invalid();
  const daily = (payload.daily === undefined ? [] : rows(payload.daily, 800)).map(value => {
    const row = object(value); return Object.freeze({ day: day(row.day), ...metrics(row) });
  });
  const models = (payload.by_model === undefined ? [] : rows(payload.by_model, 200)).map(value => {
    const row = object(value); return Object.freeze({ name: text(row.model, 160), ...metrics(row) });
  });
  return Object.freeze({ days, totals: payload.totals === undefined ? Object.freeze({}) : metrics(object(payload.totals), true),
    daily: unique(daily, row => row.day), models: Object.freeze(models) });
}

function timestamp(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  let milliseconds: number;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0 || value > 253402300799) return invalid();
    milliseconds = value * 1000;
  } else {
    const raw = text(value, 128);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(raw)) return invalid();
    day(raw.slice(0, 10)); milliseconds = Date.parse(raw);
    if (!Number.isFinite(milliseconds) || milliseconds < 0 || milliseconds > 253402300799000) return invalid();
  }
  return new Date(milliseconds).toISOString();
}
function schedule(value: unknown): string {
  if (typeof value === 'string') return text(value, 2048);
  const row = object(value);
  if (row.kind === 'cron') return text(row.expr, 2048);
  if (row.kind === 'once') { const raw = text(row.run_at, 128); timestamp(raw); return raw; }
  if (row.kind === 'interval' && typeof row.minutes === 'number' && Number.isFinite(row.minutes)
    && row.minutes > 0 && row.minutes <= Number.MAX_SAFE_INTEGER) return `every ${row.minutes}m`;
  return invalid();
}
export function decodeWorkspaceScheduled(value: unknown, profile: string): WorkspaceScheduled {
  workspaceProfile(profile);
  // DirectHermesWorkspaceClient.swift:92 normalizes the stock REST array.
  const payload = bounded(Array.isArray(value) ? { jobs: value } : value); profileEcho(payload, profile);
  const tasks = unique(rows(payload.jobs, 500).map(value => {
    const row = object(value); profileEcho(row, profile);
    if (row.profile !== profile) return invalid();
    const state = row.state;
    if (state !== 'scheduled' && state !== 'running' && state !== 'paused' && state !== 'completed' && state !== 'error') return invalid();
    const request = schedule(row.schedule);
    return Object.freeze({ id: identifier(row.id, 160), name: text(row.name, 240),
      schedule: optionalText(row.schedule_display, 2048) ?? request, state, enabled: boolean(row.enabled),
      ...optionalField('nextRunAt', timestamp(row.next_run_at)), ...optionalField('lastResult', optionalText(row.last_status, 512)) });
  }), task => task.id);
  return Object.freeze({ tasks });
}

export function decodeWorkspaceBoard(value: unknown, profile: string, tab: WorkspaceTab): WorkspaceBoard {
  workspaceProfile(profile); workspaceTab(tab);
  const payload = bounded(value); profileEcho(payload, profile);
  const items = unique(rows(payload.items, 200).map(value => {
    const row = object(value); profileEcho(row, profile);
    const kind = row.kind;
    if (kind !== 'feed' && kind !== 'idea' && kind !== 'goal') return invalid();
    return Object.freeze({ id: identifier(row.id, 160), kind, title: text(row.title, 1000, true),
      ...optionalField('body', optionalText(row.body, 65536)), ...optionalField('status', optionalText(row.status, 128)),
      ...optionalField('note', optionalText(row.note, 8192)), ...optionalField('category', optionalText(row.category, 128)),
      ...optionalField('createdAt', timestamp(row.createdAt)), ...optionalField('updatedAt', timestamp(row.updatedAt)),
      ...optionalField('read', row.read === undefined ? undefined : boolean(row.read)),
      ...optionalField('dismissed', row.dismissed === undefined ? undefined : boolean(row.dismissed)) });
  }), item => item.id);
  const kind = tab === 'ideas' ? 'idea' : tab === 'goals' ? 'goal' : 'feed';
  return Object.freeze({ tab, items: Object.freeze(items.filter(item => item.kind === kind && item.dismissed !== true)) });
}

// The verified identity is trusted main-process input from /api/auth/me or the
// dashboard-session sign-in. Plugin context can confirm it, never create it.
export function decodeWorkspaceContext(value: unknown, identity: WorkspaceIdentity, etag: unknown,
  cacheControl: unknown): Readonly<{ etag: string; runtimeId: string; board: boolean; pluginVersion: string; features: readonly string[] }> {
  const tag = workspaceETag(etag), payload = bounded(value, 16384);
  if (typeof cacheControl !== 'string' || cacheControl.length > 1024
    || !cacheControl.split(',').some(part => part.trim().toLowerCase() === 'no-store')) return invalid();
  if (payload.schemaVersion !== 1) return invalid();
  const pluginVersion = identifier(payload.pluginVersion, 128); const runtimeId = identifier(payload.runtimeId, 256);
  if (identity.kind === 'dashboard') { if (payload.principal !== null) return invalid(); }
  else {
    const principal = object(payload.principal);
    if (principal.provider !== identity.providerId || principal.userId !== identity.userId) return invalid();
  }
  const features = rows(payload.features, 64).map(value => identifier(value, 128));
  if (!features.includes('native-context-v1') || new Set(features).size !== features.length) return invalid();
  if (payload.servingProfileId !== null) {
    workspaceProfile(payload.servingProfileId);
    if (!features.includes('serving-profile-v1')) return invalid();
  }
  return Object.freeze({ etag: tag, runtimeId, board: features.includes('native-agent-board-v1'), pluginVersion,
    features: Object.freeze([...features]) });
}
