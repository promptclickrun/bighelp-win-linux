// Chat list wire codecs: REST session activity, search and the fenced
// mutation snapshot (Hermes hermes_cli/web_routers/sessions.py). Every decoder
// returns frozen, bounded plain data. Display fields are tolerant (a bad title
// falls back); identities, flags and revisions are strict.
import { contractObject, contractText, coordinate, epochMs } from './session.ts';
import { encodeBoundedJson, jsonObject, RpcProtocolError } from './rpc.ts';

const fail = (): never => { throw new RpcProtocolError(); };
const MAX_REPLY_BYTES = 4 * 1024 * 1024 - 256;
// Hermes' internal listing sources (hermes_state_sessions.INTERNAL_LISTING_SOURCES).
// session.list already hides them; the REST search must be told to.
export const HIDDEN_CHAT_SOURCES = Object.freeze(['kanban', 'tool', 'oneshot'] as const);

function bounded(value: unknown): Record<string, unknown> {
  encodeBoundedJson(value, MAX_REPLY_BYTES);
  return contractObject(value);
}
function display(value: unknown, fallback: string, max: number): string {
  if (typeof value !== 'string') return fallback;
  try { return contractText(value, max * 4, true).replace(/\s+/gu, ' ').trim().slice(0, max) || fallback; }
  catch { return fallback; }
}

// A chat the person can open or change: the id must also be a safe route segment.
function routeId(value: unknown): string {
  const id = coordinate(value);
  if (!/^[A-Za-z0-9_.:-]+$/u.test(id) || id === '.' || id === '..') return fail();
  return id;
}
// 0/1 integers and booleans both appear on the wire; anything else is refused.
function flag(value: unknown): boolean {
  if (value === undefined || value === null || value === false || value === 0) return false;
  if (value === true || value === 1) return true;
  return fail();
}

export type ChatActivity = Readonly<{ id: string; updatedAt: number }>;
// GET /api/sessions?order=recent: only the last-activity time per listed chat.
// Membership and titles stay with session.list; malformed rows are skipped.
export function decodeChatActivity(value: unknown, profile: string): readonly ChatActivity[] {
  coordinate(profile);
  const page = bounded(value);
  if (!Array.isArray(page.sessions) || page.sessions.length > 1000) return fail();
  const rows: ChatActivity[] = [];
  for (const entry of page.sessions) {
    if (!jsonObject(entry)) continue;
    let id: string;
    try { id = coordinate(entry.id); } catch { continue; }
    if (entry.profile !== undefined && entry.profile !== profile) return fail();
    const updatedAt = epochMs(entry.last_active) ?? epochMs(entry.last_activity_at);
    if (updatedAt !== null && !rows.some(row => row.id === id)) rows.push(Object.freeze({ id, updatedAt }));
  }
  return Object.freeze(rows);
}

// Hermes marks content hits as ">>>term<<<". Split into plain parts; never markup.
export type SnippetPart = Readonly<{ text: string; match: boolean }>;
export function snippetParts(value: unknown): readonly SnippetPart[] {
  const text = display(value, '', 400);
  const parts: SnippetPart[] = [];
  let rest = text, guard = 0;
  while (rest && guard++ < 64) {
    const open = rest.indexOf('>>>');
    const close = open < 0 ? -1 : rest.indexOf('<<<', open + 3);
    if (open < 0 || close < 0) { parts.push({ text: rest.replaceAll('>>>', '').replaceAll('<<<', ''), match: false }); break; }
    if (open > 0) parts.push({ text: rest.slice(0, open).replaceAll('<<<', ''), match: false });
    const hit = rest.slice(open + 3, close);
    if (hit) parts.push({ text: hit, match: true });
    rest = rest.slice(close + 3);
  }
  return Object.freeze(parts.filter(part => part.text).map(part => Object.freeze(part)));
}

export type ChatSearchHit = Readonly<{
  id: string; profile: string; title: string; preview: string; snippet: readonly SnippetPart[];
  startedAt: number | null; updatedAt: number | null; archived: boolean;
}>;
// GET /api/sessions/search. Results arrive at the compression tip; the tip id
// is what session.resume and the list use.
export function decodeChatSearch(value: unknown, profile: string): readonly ChatSearchHit[] {
  coordinate(profile);
  const reply = bounded(value);
  if (!Array.isArray(reply.results) || reply.results.length > 100) return fail();
  const hits: ChatSearchHit[] = [];
  for (const entry of reply.results) {
    if (!jsonObject(entry)) continue;
    let id: string;
    try { id = routeId(entry.session_id ?? entry.id); } catch { continue; }
    if (entry.profile !== undefined && entry.profile !== profile) return fail();
    if (typeof entry.source === 'string' && (HIDDEN_CHAT_SOURCES as readonly string[]).includes(entry.source)) continue;
    if (hits.some(hit => hit.id === id)) continue;
    hits.push(Object.freeze({ id, profile, title: display(entry.title, 'Untitled chat', 200),
      preview: display(entry.preview, '', 200), snippet: snippetParts(entry.snippet),
      startedAt: epochMs(entry.started_at) ?? epochMs(entry.session_started),
      updatedAt: epochMs(entry.last_active), archived: flag(entry.archived) }));
  }
  return Object.freeze(hits);
}

export type ChatDetail = Readonly<{
  id: string; title: string; preview: string; startedAt: number | null; updatedAt: number | null; hidden: boolean;
}>;
// GET /api/sessions/{id}: used only to title a chat opened from search.
export function decodeChatDetail(value: unknown, id: string, profile: string): ChatDetail {
  coordinate(id); coordinate(profile);
  const row = bounded(value);
  if (row.id !== id) return fail();
  for (const key of ['profile', 'profile_name']) {
    if (row[key] !== undefined && row[key] !== null && row[key] !== profile) return fail();
  }
  return Object.freeze({ id, title: display(row.title, 'Untitled chat', 200), preview: display(row.preview, '', 200),
    startedAt: epochMs(row.started_at), updatedAt: epochMs(row.last_active) ?? epochMs(row.last_activity_at),
    hidden: flag(row.hidden) });
}

export type MutationSnapshot = Readonly<{ exists: boolean; revision: number; generation: number | null }>;
// GET /api/sessions/{id}/mutation-snapshot. Exact counters or a refusal.
export function decodeMutationSnapshot(value: unknown, id: string): MutationSnapshot {
  coordinate(id);
  const row = bounded(value);
  const revision = row.runtime_revision, generation = row.runtime_generation;
  if (row.session_id !== id || typeof row.exists !== 'boolean'
    || typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0) return fail();
  if (row.exists && (typeof generation !== 'number' || !Number.isSafeInteger(generation) || generation < 0)) return fail();
  return Object.freeze({ exists: row.exists, revision,
    generation: typeof generation === 'number' && Number.isSafeInteger(generation) && generation >= 0 ? generation : null });
}

// PATCH/DELETE /api/sessions/{id} acknowledgements.
export function decodeMutationReceipt(value: unknown, id: string, operation: 'sidebar' | 'delete'): void {
  const row = bounded(value);
  if (row.ok !== true) return fail();
  if (operation === 'delete' && row.already_absent === true) return;
  if (row.session_id !== id || row.operation !== operation) return fail();
}
