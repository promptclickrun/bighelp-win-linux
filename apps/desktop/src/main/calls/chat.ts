// The open chat's command catalog and per-chat model/reasoning (HERMES_API.md §4).
import { encodeBoundedJson, jsonObject } from '../../../../../packages/contracts/rpc.ts';
import type { CHAT_CALLS, ChatCommand, ChatModels } from '../../shared/calls/chat.ts';
import type { CallHandlers } from './index.ts';
import type { CallContext, OpenChat } from './context.ts';
import { CallError } from './context.ts';
import { safeDetail } from '../../../../../packages/platform/transport-policy.ts';

function requireOpen(context: CallContext, chatId: string): OpenChat {
  const open = context.openChat();
  if (!open || open.storedSessionId !== chatId) throw new CallError('stale', 'Open the chat first.');
  return open;
}
const plain = (value: unknown, max: number) => typeof value === 'string'
  ? value.replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]+/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, max) : '';

export function decodeCommands(value: unknown): readonly ChatCommand[] {
  encodeBoundedJson(value, 2 * 1024 * 1024);
  if (!jsonObject(value) || !Array.isArray(value.pairs)) throw new CallError('invalid', 'Hermes sent an unexpected command list.');
  const commands = jsonObject(value.commands) ? value.commands : {};
  const skills = jsonObject(value.skills) ? value.skills : {};
  const result: ChatCommand[] = [], seen = new Set<string>();
  for (const pair of value.pairs.slice(0, 2048)) {
    if (!Array.isArray(pair) || typeof pair[0] !== 'string' || !/^\/[A-Za-z0-9._-]{1,96}$/u.test(pair[0]) || seen.has(pair[0])) continue;
    const entry = commands[pair[0]];
    // Commands Hermes marks as terminal-only, hidden or settings are not offered.
    if (jsonObject(entry) && entry.desktop !== null && entry.desktop !== undefined) continue;
    seen.add(pair[0]);
    result.push(Object.freeze({ name: pair[0], description: plain(pair[1], 240), kind: Object.hasOwn(skills, pair[0]) ? 'skill' : 'command' }));
  }
  return Object.freeze(result.sort((a, b) => a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'skill' ? -1 : 1));
}

export function decodeModels(value: unknown): ChatModels {
  encodeBoundedJson(value, 4 * 1024 * 1024 - 256);
  if (!jsonObject(value) || !Array.isArray(value.providers)) throw new CallError('invalid', 'Hermes sent an unexpected model list.');
  const providers: ChatModels['providers'][number][] = [];
  for (const row of value.providers.slice(0, 64)) {
    if (!jsonObject(row) || typeof row.slug !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/u.test(row.slug) || !Array.isArray(row.models)) continue;
    const unavailable = new Set(Array.isArray(row.unavailable_models) ? row.unavailable_models.filter(item => typeof item === 'string') : []);
    const models = row.models.filter((model): model is string => typeof model === 'string' && model.length > 0 && model.length <= 256
      && !/[\s\u0000-\u001f]/u.test(model) && !unavailable.has(model)).slice(0, 500);
    if (!models.length) continue;
    const capabilities = jsonObject(row.capabilities) ? row.capabilities : {};
    const reasoning = models.filter(model => { const entry = capabilities[model]; return jsonObject(entry) && entry.reasoning === true; });
    providers.push(Object.freeze({ slug: row.slug, name: plain(row.name, 80) || row.slug, current: row.is_current === true,
      models: Object.freeze(models), reasoning: Object.freeze(reasoning) }));
  }
  const current = typeof value.model === 'string' && value.model && typeof value.provider === 'string'
    ? Object.freeze({ model: value.model.slice(0, 256), provider: value.provider.slice(0, 128) }) : null;
  return Object.freeze({ current, providers: Object.freeze(providers) });
}

const PREVIEW = /^data:image\/(?:png|jpeg|gif|webp|bmp);base64,[A-Za-z0-9+/]+={0,2}$/u;

export const CHAT_HANDLERS: Pick<CallHandlers, keyof typeof CHAT_CALLS> = Object.freeze({
  'chat.media': {
    mutation: false,
    async run(context, input) {
      requireOpen(context, input.chatId);
      const path = context.mediaPath(input.chatId, input.ref);
      if (!path) throw new CallError('stale', 'That file is no longer in this chat.');
      const name = path.split(/[\\/]/u).pop() ?? 'image';
      // Hermes serves only images inside its own media folders, size-capped.
      const reply = await context.http({ method: 'GET', path: '/api/media', query: { path }, maxBytes: 4 * 1024 * 1024 - 256 });
      const dataUrl = jsonObject(reply.body) && typeof reply.body.data_url === 'string' ? reply.body.data_url : '';
      if (!PREVIEW.test(dataUrl)) throw new CallError('unsupported', 'This file can’t be previewed here.');
      return Object.freeze({ name: name.slice(0, 180), dataUrl });
    },
  },
  'chat.commands': {
    mutation: false,
    async run(context, input) {
      const open = requireOpen(context, input.chatId);
      return decodeCommands(await context.rpc('commands.catalog', { session_id: open.runtimeId, profile: open.profile }, { mutation: false, timeoutMs: 30000 }));
    },
  },
  'chat.models': {
    mutation: false,
    async run(context, input) {
      const open = requireOpen(context, input.chatId);
      return decodeModels(await context.rpc('model.options', { session_id: open.runtimeId, profile: open.profile }, { mutation: false, timeoutMs: 30000 }));
    },
  },
  'chat.setModel': {
    mutation: true,
    async run(context, input) {
      const open = requireOpen(context, input.chatId);
      const reply = await context.rpc('config.set', { session_id: open.runtimeId, profile: open.profile, key: 'model',
        value: `${input.model} --provider ${input.provider} --session`, ...(input.confirmExpensive ? { confirm_expensive_model: true } : {}) });
      if (!jsonObject(reply) || reply.key !== 'model') throw new CallError('unknown', 'Not sure the model changed. Check the chat before trying again.');
      if (reply.confirm_required === true) return Object.freeze({ status: 'confirm', message: safeDetail(reply.confirm_message) || 'This model may cost more.' });
      return Object.freeze({ status: reply.deferred === true ? 'deferred' : 'applied', message: safeDetail(reply.warning) });
    },
  },
  'chat.setReasoning': {
    mutation: true,
    async run(context, input) {
      const open = requireOpen(context, input.chatId);
      const reply = await context.rpc('config.set', { session_id: open.runtimeId, profile: open.profile, key: 'reasoning', value: input.level, scope: 'session' });
      if (!jsonObject(reply) || reply.key !== 'reasoning' || typeof reply.value !== 'string') throw new CallError('unknown', 'Not sure the reasoning level changed.');
      return Object.freeze({ level: reply.value.slice(0, 32) });
    },
  },
});
