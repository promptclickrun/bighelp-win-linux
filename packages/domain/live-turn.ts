// Pure projection of live Hermes session events into transcript rows. Saved
// history replaces these rows once a turn has ended; nothing here is authority
// for sends, approvals or outcomes. See docs/contracts/HERMES_API.md §5.
import type { TranscriptItem } from '../ui/view-model.ts';
import { isSilenceMarker, preview, toolDetail, toolFailed, toolPhrase } from './tool-phrases.ts';

export type TodoItem = Readonly<{ id: string; content: string; status: 'pending' | 'in_progress' | 'completed' | 'cancelled' }>;
export type LiveTurn = Readonly<{
  turn: string | null;          // key of the newest turn seen live
  running: boolean;
  items: readonly TranscriptItem[];
  segment: string | null;       // assistant row still receiving text
  reasoning: string | null;     // reasoning row still receiving text
  status: string;               // transient plain-word status, never history
  startedAt: number | null;
  todos: readonly TodoItem[]; todoRevision: number;
  context: Readonly<{ used: number; max: number }> | null;
  failure: string | null;       // plain sentence for the last failed turn
  model: Readonly<{ name: string; provider: string; reasoning: string }> | null;
  counter: number;
}>;

export const EMPTY_LIVE: LiveTurn = Object.freeze({
  turn: null, running: false, items: Object.freeze([]), segment: null, reasoning: null, status: '', startedAt: null,
  todos: Object.freeze([]), todoRevision: -1, context: null, failure: null, model: null, counter: 0,
});

export const LIVE_LIMITS = Object.freeze({ items: 1500, textBytes: 1024 * 1024, status: 160 });

type Payload = Readonly<Record<string, unknown>>;
const str = (value: unknown): string => typeof value === 'string' ? value : '';
function line(value: string, max: number = LIVE_LIMITS.status): string {
  const text = value.replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]+/gu, ' ').replace(/\s+/gu, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function withItems(state: LiveTurn, items: TranscriptItem[], changes: Partial<LiveTurn> = {}): LiveTurn {
  return Object.freeze({ ...state, ...changes, items: Object.freeze(items.slice(-LIVE_LIMITS.items)) });
}
function replace(items: readonly TranscriptItem[], id: string, update: (item: TranscriptItem) => TranscriptItem): TranscriptItem[] {
  return items.map(item => item.id === id ? update(item) : item);
}
function setText(item: TranscriptItem, text: string, streaming: boolean): TranscriptItem {
  return item.kind === 'message' ? Object.freeze({ ...item, paragraphs: Object.freeze([text]), streaming }) : item;
}
function textOf(item: TranscriptItem | undefined): string {
  return item?.kind === 'message' ? item.paragraphs.join('\n\n') : '';
}
function bounded(text: string): string {
  return new TextEncoder().encode(text).byteLength > LIVE_LIMITS.textBytes ? text.slice(0, LIVE_LIMITS.textBytes / 4) : text;
}

// The current turn key, opening one if an event arrives without message.start.
function ensureTurn(state: LiveTurn, now: number): LiveTurn {
  if (state.turn && state.running) return state;
  const counter = state.counter + 1;
  return Object.freeze({ ...state, counter, turn: `live:${counter}`, running: true, startedAt: now, failure: null, segment: null,
    reasoning: null, items: Object.freeze(state.items.map(item => item.kind === 'message' && item.direction === 'out' && !item.turn
      ? Object.freeze({ ...item, turn: `live:${counter}` }) : item)) });
}

function sealReasoning(state: LiveTurn): LiveTurn {
  if (!state.reasoning) return state;
  return withItems(state, replace(state.items, state.reasoning, item => item.kind === 'reasoning' ? Object.freeze({ ...item, streaming: false }) : item), { reasoning: null });
}

function appendText(state: LiveTurn, text: string, now: number): LiveTurn {
  let current = sealReasoning(ensureTurn(state, now));
  if (!text) return current;
  if (current.segment) {
    const existing = current.items.find(item => item.id === current.segment);
    return withItems(current, replace(current.items, current.segment, item => setText(item, bounded(textOf(existing) + text), true)));
  }
  const counter = current.counter + 1, id = `${current.turn}:text:${counter}`;
  current = Object.freeze({ ...current, counter, segment: id });
  return withItems(current, [...current.items, Object.freeze({ kind: 'message', id, direction: 'in', paragraphs: Object.freeze([bounded(text)]),
    streaming: true, turn: current.turn ?? undefined } as TranscriptItem)]);
}

function addNotice(state: LiveTurn, tone: 'info' | 'warn' | 'error', text: string): LiveTurn {
  const counter = state.counter + 1;
  return withItems({ ...state, counter }, [...state.items, Object.freeze({ kind: 'notice', id: `${state.turn ?? 'live'}:notice:${counter}`, tone,
    text: line(text, 600), ...(state.turn ? { turn: state.turn } : {}) })]);
}

function upsertTool(state: LiveTurn, payload: Payload, phase: 'start' | 'complete', now: number): LiveTurn {
  const current = sealReasoning(ensureTurn(state, now));
  const toolId = str(payload.tool_id), name = str(payload.name) || 'tool';
  if (!toolId || toolId.length > 512) return current;
  const id = `${current.turn}:tool:${toolId}`;
  const existing = current.items.find(item => item.id === id);
  const detail = toolDetail(payload.context, payload.args) || (existing?.kind === 'tool' ? existing.detail : '');
  const input = payload.args === undefined ? (existing?.kind === 'tool' ? existing.input : undefined) : preview(payload.args, 4096);
  if (phase === 'start') {
    const item: TranscriptItem = Object.freeze({ kind: 'tool', id, name, label: toolPhrase(name, 'live'), detail, state: 'running',
      ...(input ? { input } : {}), ...(current.turn ? { turn: current.turn } : {}) });
    // A new tool closes the open text segment: later text starts a new bubble.
    const items = existing ? replace(current.items, id, () => item) : current.items.length >= LIVE_LIMITS.items ? [...current.items] : [...current.items, item];
    return withItems(current, items, { segment: null, status: `${toolPhrase(name, 'live')}…` });
  }
  const failed = toolFailed(payload.result);
  const duration = typeof payload.duration_s === 'number' && Number.isFinite(payload.duration_s) && payload.duration_s >= 0
    ? Math.round(payload.duration_s * 1000) : undefined;
  const summary = line(str(payload.summary), 200);
  const output = preview(payload.result) || summary;
  const item: TranscriptItem = Object.freeze({ kind: 'tool', id, name, label: toolPhrase(name, 'past'), detail, state: failed ? 'failed' : 'done',
    ...(duration === undefined ? {} : { durationMs: duration }), ...(input ? { input } : {}), ...(output ? { output } : {}),
    ...(current.turn ? { turn: current.turn } : {}) });
  const items = existing ? replace(current.items, id, () => item) : [...current.items, item];
  return withItems(current, items, { segment: null, status: 'Working' });
}

function todos(value: unknown): readonly TodoItem[] | null {
  if (!Array.isArray(value) || value.length > 200) return null;
  const result: TodoItem[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') return null;
    const row = entry as Record<string, unknown>;
    const status = row.status;
    if (typeof row.id !== 'string' || typeof row.content !== 'string'
      || (status !== 'pending' && status !== 'in_progress' && status !== 'completed' && status !== 'cancelled')) return null;
    result.push(Object.freeze({ id: row.id.slice(0, 128), content: line(row.content, 300), status }));
  }
  return Object.freeze(result);
}

function failureSentence(payload: Payload): string {
  const surface = payload.error_surface && typeof payload.error_surface === 'object' ? payload.error_surface as Record<string, unknown> : {};
  const code = str(surface.code);
  if (payload.billing || code === 'billing' || code === 'insufficient_credit') return "You've reached your limit for now. Check the provider account, then try again.";
  if (code === 'rate_limited' || code === 'overloaded') return 'The model provider is busy right now. Try again in a moment.';
  if (code === 'context_length' || code === 'context_overflow') return 'This chat is too long for the model. Start a new chat to continue.';
  if (code === 'auth' || code === 'unauthorized') return 'The model provider did not accept its sign-in. Check the provider in Hermes.';
  const text = line(str(payload.text), 600);
  return text || 'The reply did not finish. Try again.';
}

// Apply one event of the selected session. Unknown types change nothing.
export function reduceLive(state: LiveTurn, type: string, payload: Payload, now: number): LiveTurn {
  switch (type) {
    case 'message.start': {
      const counter = state.counter + 1, turn = `live:${counter}`;
      const items = state.items.map(item => item.kind === 'message' && item.direction === 'out' && !item.turn ? Object.freeze({ ...item, turn }) : item);
      return withItems({ ...state, counter, turn, running: true, startedAt: now, segment: null, reasoning: null, failure: null, status: 'Working' }, items);
    }
    case 'message.delta': return appendText(state, str(payload.text), now);
    case 'message.interim': {
      const text = str(payload.text);
      let current = sealReasoning(ensureTurn(state, now));
      if (current.segment) {
        if (text.trim()) current = withItems(current, replace(current.items, current.segment, item => setText(item, bounded(text), false)));
        else current = withItems(current, replace(current.items, current.segment, item => item.kind === 'message' ? Object.freeze({ ...item, streaming: false }) : item));
        return Object.freeze({ ...current, segment: null });
      }
      if (payload.already_streamed !== true && text.trim()) return Object.freeze({ ...appendText(current, text, now), segment: null });
      return current;
    }
    case 'message.complete': {
      let current = sealReasoning(ensureTurn(state, now));
      const text = str(payload.text), status = str(payload.status);
      if (status === 'error' && payload.partial !== true) {
        if (current.segment) current = withItems(current, replace(current.items, current.segment, item => item.kind === 'message' ? Object.freeze({ ...item, streaming: false }) : item));
        const failure = failureSentence(payload);
        return Object.freeze({ ...addNotice(current, 'error', failure), segment: null, failure, status: '' });
      }
      const previewed = payload.response_previewed === true || payload.response_reused === true;
      if (payload.response_transformed === true && text) {
        current = current.segment ? withItems(current, replace(current.items, current.segment, item => setText(item, bounded(text), false)))
          : Object.freeze({ ...appendText(current, text, now) });
      } else if (text && !isSilenceMarker(text) && !previewed) {
        current = current.segment ? withItems(current, replace(current.items, current.segment, item => setText(item, bounded(text), false)))
          : appendText(current, text, now);
      }
      if (current.segment) current = withItems(current, replace(current.items, current.segment, item => {
        if (item.kind !== 'message') return item;
        // A streamed silence marker is not a reply.
        return isSilenceMarker(textOf(item)) ? Object.freeze({ ...item, paragraphs: Object.freeze(['']), streaming: false }) : Object.freeze({ ...item, streaming: false });
      }));
      current = withItems(current, current.items.filter(item => !(item.kind === 'message' && item.direction === 'in' && !textOf(item).trim())), { segment: null });
      const reasoning = str(payload.reasoning).trim();
      if (reasoning && !current.items.some(item => item.kind === 'reasoning' && item.turn === current.turn)) {
        const counter = current.counter + 1;
        current = withItems({ ...current, counter }, [...current.items, Object.freeze({ kind: 'reasoning', id: `${current.turn}:reasoning:${counter}`,
          text: bounded(reasoning), ...(current.turn ? { turn: current.turn } : {}) })]);
      }
      if (status === 'error') current = addNotice(current, 'error', str(payload.error) ? `The reply stopped early: ${line(str(payload.error), 300)}` : 'The reply stopped early.');
      if (status === 'interrupted') current = addNotice(current, 'info', 'Stopped.');
      if (str(payload.warning)) current = addNotice(current, 'warn', str(payload.warning));
      return Object.freeze({ ...current, status: current.running ? 'Finishing' : '' });
    }
    case 'reasoning.delta': {
      const text = str(payload.text);
      if (!text) return state;
      const current = ensureTurn(state, now);
      if (current.reasoning) {
        return withItems(current, replace(current.items, current.reasoning, item => item.kind === 'reasoning' ? Object.freeze({ ...item, text: bounded(item.text + text) }) : item));
      }
      const counter = current.counter + 1, id = `${current.turn}:reasoning:${counter}`;
      return withItems({ ...current, counter, reasoning: id, status: 'Thinking' }, [...current.items, Object.freeze({ kind: 'reasoning', id, text: bounded(text),
        streaming: true, ...(current.turn ? { turn: current.turn } : {}) })]);
    }
    case 'thinking.delta': case 'status.update': {
      const text = line(str(payload.text));
      // thinking.delta carries decorative wait text; show calm words instead.
      if (!text) return state;
      return Object.freeze({ ...state, status: type === 'thinking.delta' ? (state.status || 'Thinking') : text });
    }
    case 'tool.generating': {
      const name = str(payload.name);
      return name ? Object.freeze({ ...state, status: `Preparing: ${toolPhrase(name, 'live').toLowerCase()}` }) : state;
    }
    case 'tool.start': return upsertTool(state, payload, 'start', now);
    case 'tool.complete': {
      const next = upsertTool(state, payload, 'complete', now);
      const list = todos(payload.todos);
      const revision = typeof payload.revision === 'number' && Number.isSafeInteger(payload.revision) ? payload.revision : -1;
      return list && revision >= next.todoRevision ? Object.freeze({ ...next, todos: list, todoRevision: revision }) : next;
    }
    case 'todo.updated': {
      const list = todos(payload.todos);
      const revision = typeof payload.revision === 'number' && Number.isSafeInteger(payload.revision) ? payload.revision : -1;
      return list && revision >= state.todoRevision ? Object.freeze({ ...state, todos: list, todoRevision: revision }) : state;
    }
    case 'session.usage': case 'session.info': {
      let current = state;
      const usage = payload.usage && typeof payload.usage === 'object' ? payload.usage as Record<string, unknown> : null;
      if (usage && Number.isSafeInteger(usage.context_used) && Number.isSafeInteger(usage.context_max) && (usage.context_max as number) > 0) {
        current = Object.freeze({ ...current, context: Object.freeze({ used: usage.context_used as number, max: usage.context_max as number }) });
      }
      if (type === 'session.info' && typeof payload.model === 'string' && payload.model && payload.model.length <= 256) {
        current = Object.freeze({ ...current, model: Object.freeze({ name: payload.model, provider: str(payload.provider).slice(0, 128),
          reasoning: str(payload.reasoning_effort).slice(0, 32) }) });
      }
      if (type === 'session.info' && payload.running === false && current.running) {
        // The settled bookend: anything still running has no confirmed outcome.
        current = withItems(current, current.items.map(item => {
          if (item.kind === 'tool' && item.state === 'running') return Object.freeze({ ...item, state: 'stopped' as const, label: toolPhrase(item.name ?? 'tool', 'past') });
          if ((item.kind === 'message' || item.kind === 'reasoning') && item.streaming) return Object.freeze({ ...item, streaming: false });
          return item;
        }), { running: false, segment: null, reasoning: null, status: '' });
      } else if (type === 'session.info' && payload.running === true && !current.running) current = ensureTurn(current, now);
      return current;
    }
    case 'error': return addNotice(Object.freeze({ ...state, status: '' }), 'error', 'Hermes reported a problem with this chat.');
    default: return state;
  }
}

// The person's own message, shown at once and replaced by saved history later.
export function addOutgoing(state: LiveTurn, id: string, text: string, delivery: 'pending' | 'unknown', attachments: readonly string[] = []): LiveTurn {
  return withItems(state, [...state.items.filter(item => item.id !== id), Object.freeze({ kind: 'message', id, direction: 'out',
    paragraphs: Object.freeze([text]), delivery, ...(attachments.length ? { attachments: Object.freeze([...attachments]) } : {}) })]);
}

// Saved history now covers every finished turn: keep only rows of a turn still running.
export function afterHistory(state: LiveTurn): LiveTurn {
  const keep = state.running ? state.turn : null;
  return withItems(state, state.items.filter(item => keep !== null && 'turn' in item && item.turn === keep), { failure: state.running ? state.failure : null });
}
