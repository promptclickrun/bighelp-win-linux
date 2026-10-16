import { encodeBoundedJson } from './rpc.ts';

// Hermes' bundled Kanban plugin (/api/plugins/kanban). Display-only projections:
// strict about the values that route a write (board slug, task ID, status),
// tolerant of additive display fields. Host paths, PIDs, logs, claim locks and
// idempotency keys never leave main.

export const KANBAN_STATUSES = Object.freeze(['triage', 'todo', 'scheduled', 'ready', 'running', 'blocked', 'review', 'done', 'archived'] as const);
export type KanbanStatus = typeof KANBAN_STATUSES[number];
// A status this app does not know. Shown read-only; never moved.
export type KanbanCardStatus = KanbanStatus | 'other';
export type KanbanBlockKind = 'dependency' | 'needs_input' | 'capability' | 'transient';

export type KanbanCard = Readonly<{
  id: string; title: string; status: KanbanCardStatus; assignee: string | null; priority: number;
  blockKind: KanbanBlockKind | null; summary?: string; commentCount: number; children: number;
  createdAt?: number; completedAt?: number;
}>;
export type KanbanBoardMeta = Readonly<{ slug: string; name: string; open: number; total: number }>;
export type KanbanBoards = Readonly<{ boards: readonly KanbanBoardMeta[]; current: string | null }>;
export type KanbanSnapshot = Readonly<{ cards: readonly KanbanCard[]; assignees: readonly string[] }>;
export type KanbanComment = Readonly<{ id: number; author: string; body: string; createdAt?: number }>;
export type KanbanEvent = Readonly<{ id: number; kind: string; createdAt?: number; status?: KanbanStatus; assignee?: string | null }>;
export type KanbanRun = Readonly<{ id: number; agent: string | null; outcome?: string; summary?: string; failed: boolean;
  startedAt?: number; endedAt?: number }>;
export type KanbanTaskDetail = Readonly<{
  card: KanbanCard; body?: string; result?: string; comments: readonly KanbanComment[];
  events: readonly KanbanEvent[]; runs: readonly KanbanRun[];
}>;

export const KANBAN_LIMITS = Object.freeze({
  boardBytes: 4 * 1024 * 1024 - 256, detailBytes: 2 * 1024 * 1024, smallBytes: 262144,
  boards: 200, cards: 5000, comments: 1000, events: 5000, runs: 500,
  title: 500, body: 65536, comment: 10000, note: 2000,
});

const invalid = (): never => { throw new TypeError('Invalid Kanban response'); };
function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
function bounded(value: unknown, maximumBytes: number): Record<string, unknown> {
  encodeBoundedJson(value, maximumBytes);
  return object(value);
}
function rows(value: unknown, max: number): readonly unknown[] {
  if (!Array.isArray(value) || value.length > max) return invalid();
  return value;
}

const SLUG = /^[a-z0-9][a-z0-9_-]{0,63}$/u;
const TASK_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u;
// Hermes profile names (hermes_cli PROFILE_ID_RE); Kanban lowercases assignees.
const PROFILE = /^[a-z0-9][a-z0-9_-]{0,63}$/u;
export function isKanbanBoardSlug(value: unknown): value is string { return typeof value === 'string' && SLUG.test(value); }
export function isKanbanTaskId(value: unknown): value is string { return typeof value === 'string' && TASK_ID.test(value); }
export function isKanbanAssignee(value: unknown): value is string { return typeof value === 'string' && PROFILE.test(value); }
export function isKanbanStatus(value: unknown): value is KanbanStatus {
  return typeof value === 'string' && (KANBAN_STATUSES as readonly string[]).includes(value);
}

// Display text: drop controls and bidirectional overrides, keep newlines when asked,
// and cut very long values instead of failing a whole board over one card.
const LINE_CONTROLS = /[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]+/gu;
const TEXT_CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f‪-‮⁦-⁩]+/gu;
function display(value: unknown, max: number, multiline = false): string | undefined {
  if (typeof value !== 'string' || !value.isWellFormed()) return undefined;
  const cleaned = multiline ? value.replace(TEXT_CONTROLS, '').replace(/\r\n?/gu, '\n') : value.replace(LINE_CONTROLS, ' ');
  const trimmed = (multiline ? cleaned : cleaned.replace(/\s+/gu, ' ')).trim();
  if (!trimmed) return undefined;
  if (trimmed.length <= max) return trimmed;
  const cut = trimmed.slice(0, max - 1);
  return `${cut.isWellFormed() ? cut : cut.slice(0, -1)}…`;
}
function optionalField<K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> {
  return value === undefined ? {} : { [key]: value } as Record<K, V>;
}
function count(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
function epoch(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 253402300799 ? value : undefined;
}
function rowId(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return invalid();
  return value;
}
function assignee(value: unknown): string | null {
  // An assignee is display data and a picker default, never a route.
  return typeof value === 'string' && PROFILE.test(value) ? value : null;
}
const BLOCK_KINDS: readonly KanbanBlockKind[] = ['dependency', 'needs_input', 'capability', 'transient'];

export function decodeKanbanCard(value: unknown): KanbanCard {
  const row = object(value);
  if (!isKanbanTaskId(row.id)) return invalid();
  const status: KanbanCardStatus = isKanbanStatus(row.status) ? row.status : 'other';
  const links = row.link_counts && typeof row.link_counts === 'object' && !Array.isArray(row.link_counts)
    ? row.link_counts as Record<string, unknown> : {};
  const priority = typeof row.priority === 'number' && Number.isSafeInteger(row.priority) ? Math.max(-1000, Math.min(1000, row.priority)) : 0;
  return Object.freeze({
    id: row.id, title: display(row.title, KANBAN_LIMITS.title) ?? 'Untitled task', status, assignee: assignee(row.assignee), priority,
    blockKind: BLOCK_KINDS.find(kind => kind === row.block_kind) ?? null,
    ...optionalField('summary', display(row.latest_summary, 4000, true)),
    commentCount: count(row.comment_count), children: count(links.children),
    ...optionalField('createdAt', epoch(row.created_at)), ...optionalField('completedAt', epoch(row.completed_at)),
  });
}

export function decodeKanbanBoards(value: unknown): KanbanBoards {
  const payload = bounded(value, KANBAN_LIMITS.smallBytes * 4);
  const boards: KanbanBoardMeta[] = [];
  for (const entry of rows(payload.boards, KANBAN_LIMITS.boards)) {
    const row = object(entry);
    if (!isKanbanBoardSlug(row.slug)) return invalid();
    if (row.archived === true) continue;
    const counts = row.counts && typeof row.counts === 'object' && !Array.isArray(row.counts) ? row.counts as Record<string, unknown> : {};
    let open = 0;
    for (const status of ['triage', 'todo', 'scheduled', 'ready', 'running', 'blocked', 'review'] as const) open += count(counts[status]);
    boards.push(Object.freeze({ slug: row.slug, name: display(row.name, 120) ?? row.slug, open, total: count(row.total) }));
  }
  if (new Set(boards.map(board => board.slug)).size !== boards.length) return invalid();
  const current = isKanbanBoardSlug(payload.current) && boards.some(board => board.slug === payload.current) ? payload.current : null;
  return Object.freeze({ boards: Object.freeze(boards), current });
}

export function decodeKanbanSnapshot(value: unknown): KanbanSnapshot {
  const payload = bounded(value, KANBAN_LIMITS.boardBytes);
  const cards: KanbanCard[] = [];
  for (const column of rows(payload.columns, 32)) {
    const tasks = object(column).tasks;
    for (const task of rows(tasks, KANBAN_LIMITS.cards)) {
      cards.push(decodeKanbanCard(task));
      if (cards.length > KANBAN_LIMITS.cards) return invalid();
    }
  }
  if (new Set(cards.map(card => card.id)).size !== cards.length) return invalid();
  const assignees = payload.assignees === undefined ? [] : rows(payload.assignees, 500).filter(isKanbanAssignee);
  return Object.freeze({ cards: Object.freeze(cards), assignees: Object.freeze([...new Set(assignees)]) });
}

// `{task}` from create and update. A missing task means the row vanished mid-request.
export function decodeKanbanTaskReply(value: unknown): KanbanCard {
  return decodeKanbanCard(bounded(value, KANBAN_LIMITS.detailBytes).task);
}

export function decodeKanbanTaskDetail(value: unknown): KanbanTaskDetail {
  const payload = bounded(value, KANBAN_LIMITS.detailBytes);
  const task = object(payload.task);
  const links = payload.links && typeof payload.links === 'object' && !Array.isArray(payload.links) ? payload.links as Record<string, unknown> : {};
  const children = Array.isArray(links.children) ? links.children.length : 0;
  const card = Object.freeze({ ...decodeKanbanCard(task), children });
  const comments = rows(payload.comments ?? [], KANBAN_LIMITS.comments).map(entry => {
    const row = object(entry);
    return Object.freeze({ id: rowId(row.id), author: display(row.author, 80) ?? 'Someone',
      body: display(row.body, KANBAN_LIMITS.comment, true) ?? '', ...optionalField('createdAt', epoch(row.created_at)) });
  });
  const events = rows(payload.events ?? [], KANBAN_LIMITS.events).map(entry => {
    const row = object(entry);
    const kind = typeof row.kind === 'string' && /^[a-z][a-z0-9_]{0,63}$/u.test(row.kind) ? row.kind : 'other';
    const data = row.payload && typeof row.payload === 'object' && !Array.isArray(row.payload) ? row.payload as Record<string, unknown> : {};
    return Object.freeze({ id: rowId(row.id), kind, ...optionalField('createdAt', epoch(row.created_at)),
      ...optionalField('status', isKanbanStatus(data.status) ? data.status : undefined),
      ...(kind === 'assigned' && Object.hasOwn(data, 'assignee') ? { assignee: assignee(data.assignee) } : {}) });
  });
  const runs = rows(payload.runs ?? [], KANBAN_LIMITS.runs).map(entry => {
    const row = object(entry);
    const outcome = typeof row.outcome === 'string' && /^[a-z][a-z0-9_]{0,63}$/u.test(row.outcome) ? row.outcome : undefined;
    // Run errors are raw host text: report that one happened, not what it said.
    return Object.freeze({ id: rowId(row.id), agent: assignee(row.profile), ...optionalField('outcome', outcome),
      ...optionalField('summary', display(row.summary, 4000, true)), failed: typeof row.error === 'string' && row.error.trim().length > 0,
      ...optionalField('startedAt', epoch(row.started_at)), ...optionalField('endedAt', epoch(row.ended_at)) });
  });
  return Object.freeze({ card, ...optionalField('body', display(task.body, KANBAN_LIMITS.body, true)),
    ...optionalField('result', display(task.result, 8000, true)), comments: Object.freeze(comments),
    events: Object.freeze(events), runs: Object.freeze(runs) });
}

// GET /orchestration: only whether Auto plan (host-wide, may spend) is on.
export function decodeKanbanAutoPlan(value: unknown): boolean | null {
  const payload = bounded(value, KANBAN_LIMITS.smallBytes);
  return typeof payload.auto_decompose === 'boolean' ? payload.auto_decompose : null;
}
