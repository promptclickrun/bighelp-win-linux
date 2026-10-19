// Calls scoped to the chat open in this window: its command menu and model.
import { defineCall } from '../call.ts';
import { boolean, fields, identifier, oneOf, optional, text } from '../validate.ts';

export type ChatCommand = Readonly<{ name: string; description: string; kind: 'skill' | 'command' }>;
export type ChatModels = Readonly<{
  current: Readonly<{ model: string; provider: string }> | null;
  providers: readonly Readonly<{ slug: string; name: string; current: boolean; models: readonly string[];
    reasoning: readonly string[] }>[];
}>;
export type SetModelResult = Readonly<{ status: 'applied' | 'deferred' | 'confirm'; message: string }>;
export type ChatMedia = Readonly<{ name: string; dataUrl: string }>;
export const REASONING_LEVELS = Object.freeze(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const);

const chatId = (input: Record<string, unknown>) => identifier(input.chatId);

export const CHAT_CALLS = Object.freeze({
  'chat.commands': defineCall<readonly ChatCommand[]>()(input => { const value = fields(input, ['chatId']); return Object.freeze({ chatId: chatId(value) }); }),
  'chat.models': defineCall<ChatModels>()(input => { const value = fields(input, ['chatId']); return Object.freeze({ chatId: chatId(value) }); }),
  'chat.setModel': defineCall<SetModelResult>()(input => {
    const value = fields(input, ['chatId', 'model', 'provider'], ['confirmExpensive']);
    const model = text(value.model, { max: 256 }), provider = identifier(value.provider, 128);
    if (/\s--|^-/u.test(model) || /\s/u.test(provider)) throw new TypeError('Invalid model');
    return Object.freeze({ chatId: chatId(value), model, provider, confirmExpensive: optional(value.confirmExpensive, boolean) ?? false });
  }),
  // Preview of an agent-delivered image in the open chat, by opaque reference.
  'chat.media': defineCall<ChatMedia>()(input => {
    const value = fields(input, ['chatId', 'ref']);
    const ref = text(value.ref, { max: 64 });
    if (!/^media-[0-9a-f]{8}-[0-9a-f]{1,4}$/u.test(ref)) throw new TypeError('Invalid media');
    return Object.freeze({ chatId: chatId(value), ref });
  }),
  'chat.setReasoning': defineCall<Readonly<{ level: string }>>()(input => {
    const value = fields(input, ['chatId', 'level']);
    return Object.freeze({ chatId: chatId(value), level: oneOf(value.level, REASONING_LEVELS) });
  }),
});
