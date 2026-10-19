// Pure chat-list presentation rules: recency order, day captions and local
// search. No I/O and no host authority; times come only from Hermes.
import type { AgentView, ChatView } from './view-model.ts';

export type ChatGroupLabel = 'Today' | 'Yesterday' | 'Previous 7 days' | 'Older';
// label null: chats without a host time (saved offline copies, a chat created
// moments ago). They keep their order and are shown first, without a caption.
export type ChatGroup = Readonly<{ label: ChatGroupLabel | null; chats: readonly ChatView[] }>;

export function chatTime(chat: ChatView): number | null {
  return chat.updatedAt ?? chat.startedAt ?? null;
}

// Newest first. Stable, so chats without a time keep the order main gave them.
export function sortChats(chats: readonly ChatView[]): readonly ChatView[] {
  return chats.map((chat, index) => ({ chat, index, time: chatTime(chat) }))
    .sort((left, right) => left.time === null || right.time === null
      ? (left.time === null ? 0 : 1) - (right.time === null ? 0 : 1) || left.index - right.index
      : right.time - left.time || left.index - right.index)
    .map(entry => entry.chat);
}

function startOfDay(now: Date, daysBack: number): number {
  // Calendar arithmetic, so daylight-saving days still start at local midnight.
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysBack).getTime();
}

export function groupChats(chats: readonly ChatView[], now: Date = new Date()): readonly ChatGroup[] {
  const today = startOfDay(now, 0), yesterday = startOfDay(now, 1), week = startOfDay(now, 7);
  const label = (time: number | null): ChatGroupLabel | null => time === null ? null
    : time >= today ? 'Today' : time >= yesterday ? 'Yesterday' : time >= week ? 'Previous 7 days' : 'Older';
  const groups: { label: ChatGroupLabel | null; chats: ChatView[] }[] = [];
  for (const chat of sortChats(chats)) {
    const name = label(chatTime(chat));
    const last = groups.at(-1);
    if (last && last.label === name) last.chats.push(chat);
    else groups.push({ label: name, chats: [chat] });
  }
  return Object.freeze(groups.map(group => Object.freeze({ label: group.label, chats: Object.freeze(group.chats) })));
}

// Case- and accent-insensitive; every word must appear somewhere.
export function searchKey(text: string): string {
  return text.normalize('NFKD').replace(/\p{M}+/gu, '').toLocaleLowerCase();
}
export function searchWords(query: string): readonly string[] {
  return searchKey(query).split(/\s+/u).filter(Boolean).slice(0, 16);
}
export function filterChats(chats: readonly ChatView[], agents: readonly AgentView[], query: string): readonly ChatView[] {
  const words = searchWords(query);
  if (!words.length) return chats;
  const names = new Map(agents.map(agent => [agent.id, agent.name]));
  return chats.filter(chat => {
    const haystack = searchKey([chat.title, chat.preview, names.get(chat.agentId) ?? ''].join(' '));
    return words.every(word => haystack.includes(word));
  });
}

// Agents for "New chat", most recently used first; the rest keep host order.
export function agentsByRecency(agents: readonly AgentView[], chats: readonly ChatView[]): readonly AgentView[] {
  const rank = new Map<string, number>();
  sortChats(chats).forEach((chat, index) => { if (!rank.has(chat.agentId)) rank.set(chat.agentId, index); });
  return agents.map((agent, index) => ({ agent, index, rank: rank.get(agent.id) ?? Number.MAX_SAFE_INTEGER }))
    .sort((left, right) => left.rank - right.rank || left.index - right.index).map(entry => entry.agent);
}
