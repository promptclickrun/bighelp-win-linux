// Chat list management: host search, rename, archive and delete.
// Writes use Hermes' fenced session mutation (snapshot -> request_id + expected_revision).
import { defineCall } from '../call.ts';
import type { ChatSearchHit } from '../../../../../packages/contracts/chat-list.ts';
import { InvalidInput, compact, fields, list, segment, text } from '../validate.ts';

export type ChatCapabilities = Readonly<{ search: boolean; manage: boolean }>;
export type ChatSearch = Readonly<{ results: readonly ChatSearchHit[]; partial: boolean }>;

// Hermes refuses titles over 100 characters after it trims and collapses spaces.
export const CHAT_TITLE_MAX = 100;
export function chatTitle(value: unknown): string {
  const raw = text(value, { max: CHAT_TITLE_MAX * 4 });
  const cleaned = raw.replace(/\s+/gu, ' ').trim();
  return text(cleaned, { max: CHAT_TITLE_MAX });
}
const chat = (input: unknown) => {
  const value = fields(input, ['profile', 'chatId']);
  return compact({ profile: segment(value.profile, 128), chatId: segment(value.chatId) });
};

export const CHAT_LIST_CALLS = Object.freeze({
  'chats.capabilities': defineCall<ChatCapabilities>()(input => { fields(input, []); return Object.freeze({}); }),
  'chats.search': defineCall<ChatSearch>()(input => {
    const value = fields(input, ['query', 'profiles']);
    const query = text(value.query, { max: 200, min: 2 });
    if (query.trim().length < 2) throw new InvalidInput();
    const profiles = list(value.profiles, 16, entry => segment(entry, 128));
    if (!profiles.length || new Set(profiles).size !== profiles.length) throw new InvalidInput();
    return compact({ query: query.trim(), profiles });
  }),
  'chats.rename': defineCall<Readonly<{ title: string }>>()(input => {
    const value = fields(input, ['profile', 'chatId', 'title']);
    return compact({ ...chat({ profile: value.profile, chatId: value.chatId }), title: chatTitle(value.title) });
  }),
  'chats.archive': defineCall<Readonly<{ archived: true }>>()(chat),
  'chats.delete': defineCall<Readonly<{ deleted: true }>>()(chat),
});
