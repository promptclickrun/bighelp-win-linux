// Saved chat history → display rows. Hermes owns history; this only projects
// bounded, display-safe text. Two sources: REST /api/sessions/{id}/messages
// (full rows with tool results) and the lighter session.history RPC fallback.
import { encodeBoundedJson, RPC_LIMITS } from './rpc.ts';
import type { TranscriptItem } from '../ui/view-model.ts';
import { isSilenceMarker, preview, toolDetail, toolFailed, toolPhrase } from '../domain/tool-phrases.ts';
import { extractMedia, mediaRef } from '../domain/media.ts';
import type { MediaRecorder } from '../domain/media.ts';

export const HISTORY_LIMITS = Object.freeze({ rows: 2000, textBytes: 1024 * 1024, responseBytes: 4 * 1024 * 1024 - 256 });
const invalid = (): never => { throw new TypeError('Invalid history'); };

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
function clip(text: string): string {
  const safe = text.isWellFormed() ? text : text.toWellFormed();
  return new TextEncoder().encode(safe).byteLength > HISTORY_LIMITS.textBytes ? `${safe.slice(0, HISTORY_LIMITS.textBytes / 4)}\n…` : safe;
}
function contentText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.map(part => {
      if (!part || typeof part !== 'object') return '';
      const row = part as Record<string, unknown>;
      if (row.type === 'text' && typeof row.text === 'string') return row.text;
      if (row.type === 'image_url' || row.type === 'image') return '[image]';
      return '';
    }).filter(Boolean).join('\n');
  }
  return '';
}

// What the person typed, without context Hermes appended for the model.
export function cleanUserText(text: string): Readonly<{ text: string; attachments: readonly string[] }> {
  let body = text.replace(/<memory-context>[\s\S]*?<\/memory-context>/gu, '');
  const footer = /^--- (?:Attached Context|Context Warnings) ---$/mu.exec(body);
  if (footer) body = body.slice(0, footer.index);
  const attachments: string[] = [];
  const lines = body.split('\n').filter(line => {
    const trimmed = line.trim();
    const reference = /^@(image|file):(?:`([^`]+)`|"([^"]+)"|'([^']+)'|(\S+))$/u.exec(trimmed);
    if (reference) {
      const path = reference[2] ?? reference[3] ?? reference[4] ?? reference[5] ?? '';
      const name = path.split(/[\\/]/u).pop() ?? '';
      if (attachments.length < 32) attachments.push(reference[1] === 'image' ? (name.startsWith('pdf_p') ? 'PDF page' : 'Photo') : name || 'File');
      return false;
    }
    // Image parts of a vision message arrive as an [image] line.
    if (trimmed === '[image]') { if (attachments.length < 32) attachments.push('Photo'); return false; }
    if (/^\[(?:Image attached|User attached image|User attached PDF|System note: The following is recalled memory)[^\]]*\]$/u.test(trimmed)) return false;
    return true;
  });
  return Object.freeze({ text: lines.join('\n').trim(), attachments: Object.freeze(attachments) });
}

const DAY = 24 * 60 * 60 * 1000;
export function dayLabel(epochMs: number, now: number = Date.now()): string {
  const date = new Date(epochMs), today = new Date(now);
  const start = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const difference = Math.round((start(today) - start(date)) / DAY);
  if (difference === 0) return 'Today';
  if (difference === 1) return 'Yesterday';
  if (difference > 1 && difference < 7) return new Intl.DateTimeFormat(undefined, { weekday: 'long' }).format(date);
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date);
}

type Builder = { items: TranscriptItem[]; lastDay: string; turn: string; calls: Map<string, number> };
function seconds(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value < 1e11 ? Math.round(value * 1000) : undefined;
}
function addDay(builder: Builder, at: number | undefined, now: number) {
  if (at === undefined) return;
  const label = dayLabel(at, now);
  if (label !== builder.lastDay) { builder.lastDay = label; builder.items.push(Object.freeze({ kind: 'day', id: `day:${at}`, label })); }
}

function finish(builder: Builder): readonly TranscriptItem[] {
  return Object.freeze(builder.items.slice(-HISTORY_LIMITS.rows));
}

// REST /api/sessions/{stored}/messages (order=latest page reversed, or oldest).
export function decodeRestHistory(value: unknown, now: number = Date.now(), record: MediaRecorder = mediaRef): readonly TranscriptItem[] {
  encodeBoundedJson(value, RPC_LIMITS.inboundBytes);
  const response = object(value);
  if (!Array.isArray(response.messages) || response.messages.length > 5000) return invalid();
  // Durable row ids grow with time; pages arrive oldest-first, but sort anyway.
  const rows = response.messages.map(object).sort((left, right) => (typeof left.id === 'number' ? left.id : 0) - (typeof right.id === 'number' ? right.id : 0));
  const builder: Builder = { items: [], lastDay: '', turn: 'history:start', calls: new Map() };
  const seen = new Set<number>();
  for (const entry of rows) {
    const row = object(entry);
    const id = row.id;
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) return invalid();
    if (seen.has(id)) continue; // overlapping pages repeat a row
    seen.add(id);
    const kind = typeof row.display_kind === 'string' ? row.display_kind : '';
    if (kind === 'hidden' || kind === 'internal_notification') continue;
    const role = row.role, at = seconds(row.timestamp);
    const text = clip(typeof row.display_content === 'string' ? row.display_content : contentText(row.content));
    if (role === 'user') {
      if (/^\[System:/u.test(text.trim())) continue;
      const cleaned = cleanUserText(text);
      if (!cleaned.text && !cleaned.attachments.length) continue;
      builder.turn = `row:${id}`; builder.calls = new Map();
      addDay(builder, at, now);
      builder.items.push(Object.freeze({ kind: 'message', id: `row:${id}`, direction: 'out', paragraphs: Object.freeze([cleaned.text]),
        turn: builder.turn, ...(at ? { at } : {}), ...(cleaned.attachments.length ? { attachments: cleaned.attachments } : {}) }));
    } else if (role === 'assistant') {
      addDay(builder, at, now);
      const reasoning = typeof row.reasoning_content === 'string' && row.reasoning_content.trim() ? row.reasoning_content
        : typeof row.reasoning === 'string' ? row.reasoning : '';
      if (reasoning.trim()) builder.items.push(Object.freeze({ kind: 'reasoning', id: `row:${id}:reasoning`, text: clip(reasoning.trim()), turn: builder.turn }));
      const delivered = extractMedia(text, record);
      if ((delivered.text.trim() && !isSilenceMarker(delivered.text)) || delivered.media.length) {
        builder.items.push(Object.freeze({ kind: 'message', id: `row:${id}`, direction: 'in', paragraphs: Object.freeze([delivered.text]),
          turn: builder.turn, ...(at ? { at } : {}), ...(delivered.media.length ? { media: delivered.media } : {}) }));
      }
      if (Array.isArray(row.tool_calls)) {
        row.tool_calls.slice(0, 128).forEach((call, index) => {
          if (!call || typeof call !== 'object') return;
          const value = call as Record<string, unknown>;
          const fn = value.function && typeof value.function === 'object' ? value.function as Record<string, unknown> : {};
          const name = typeof fn.name === 'string' && fn.name ? fn.name.slice(0, 128) : 'tool';
          let args: unknown = fn.arguments;
          if (typeof args === 'string') { try { args = JSON.parse(args); } catch { /* keep text */ } }
          const callId = typeof value.id === 'string' ? value.id : '';
          builder.items.push(Object.freeze({ kind: 'tool', id: `row:${id}:call:${index}`, name, label: toolPhrase(name, 'past'),
            detail: toolDetail(undefined, args), state: 'recorded', turn: builder.turn,
            ...(args === undefined ? {} : { input: preview(args, 4096) }) }));
          // Pair by call id within this turn; a later call with the same id shadows.
          if (callId) builder.calls.set(callId, builder.items.length - 1);
        });
      }
    } else if (role === 'tool') {
      const callId = typeof row.tool_call_id === 'string' ? row.tool_call_id : '';
      const index = callId ? builder.calls.get(callId) : undefined;
      const output = preview(text);
      const failed = toolFailed(text);
      if (index !== undefined) {
        const existing = builder.items[index];
        if (existing?.kind === 'tool') {
          builder.items[index] = Object.freeze({ ...existing, state: failed ? 'failed' : 'done', ...(output ? { output } : {}) });
          builder.calls.delete(callId);
          continue;
        }
      }
      const name = typeof row.tool_name === 'string' && row.tool_name ? row.tool_name.slice(0, 128) : 'tool';
      builder.items.push(Object.freeze({ kind: 'tool', id: `row:${id}:result`, name, label: toolPhrase(name, 'past'), detail: '',
        state: failed ? 'failed' : 'done', turn: builder.turn, ...(output ? { output } : {}) }));
    } else if (kind === 'model_switch' && text.trim()) {
      builder.items.push(Object.freeze({ kind: 'notice', id: `row:${id}`, tone: 'info', text: text.trim().slice(0, 300), turn: builder.turn }));
    }
  }
  return finish(builder);
}

// session.history RPC: user/assistant text, assistant reasoning, tool previews
// without results. `count` counts raw stored rows, so it may exceed messages.
export function decodeRpcHistory(value: unknown, now: number = Date.now(), record: MediaRecorder = mediaRef): readonly TranscriptItem[] {
  encodeBoundedJson(value, RPC_LIMITS.inboundBytes);
  const response = object(value);
  if (!Array.isArray(response.messages) || response.messages.length > 10000) return invalid();
  if (response.count !== undefined && (!Number.isSafeInteger(response.count) || (response.count as number) < response.messages.length)) return invalid();
  const builder: Builder = { items: [], lastDay: '', turn: 'history:start', calls: new Map() };
  response.messages.forEach((entry, index) => {
    const row = object(entry);
    const role = row.role, at = seconds(row.timestamp);
    const rowId = typeof row.row_id === 'number' && Number.isSafeInteger(row.row_id) && row.row_id >= 0 ? `row:${row.row_id}` : `position:${index}`;
    const text = clip(typeof row.text === 'string' ? row.text : '');
    if (role === 'user') {
      const cleaned = cleanUserText(text);
      if (!cleaned.text && !cleaned.attachments.length) return;
      builder.turn = rowId; addDay(builder, at, now);
      builder.items.push(Object.freeze({ kind: 'message', id: rowId, direction: 'out', paragraphs: Object.freeze([cleaned.text]), turn: rowId,
        ...(at ? { at } : {}), ...(cleaned.attachments.length ? { attachments: cleaned.attachments } : {}) }));
    } else if (role === 'assistant') {
      addDay(builder, at, now);
      const reasoning = typeof row.reasoning === 'string' ? row.reasoning.trim() : '';
      if (reasoning) builder.items.push(Object.freeze({ kind: 'reasoning', id: `${rowId}:reasoning`, text: clip(reasoning), turn: builder.turn }));
      const delivered = extractMedia(text, record);
      if ((delivered.text.trim() && !isSilenceMarker(delivered.text)) || delivered.media.length) builder.items.push(Object.freeze({ kind: 'message', id: rowId, direction: 'in',
        paragraphs: Object.freeze([delivered.text]), turn: builder.turn, ...(at ? { at } : {}), ...(delivered.media.length ? { media: delivered.media } : {}) }));
    } else if (role === 'tool') {
      const name = typeof row.name === 'string' && row.name ? row.name.slice(0, 128) : 'tool';
      builder.items.push(Object.freeze({ kind: 'tool', id: `${rowId}:tool`, name, label: toolPhrase(name, 'past'),
        detail: toolDetail(row.context, row.args), state: 'recorded', turn: builder.turn,
        ...(row.args === undefined ? {} : { input: preview(row.args, 4096) }) }));
    }
  });
  return finish(builder);
}
