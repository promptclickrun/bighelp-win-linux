// The Chats column: newest first in day groups, local filtering as you type,
// Hermes' own search for two or more characters, and per-chat actions.
import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import { View } from 'react-native-web';
import type { ChatSearchHit, SnippetPart } from '../../contracts/chat-list.ts';
import { filterChats, groupChats } from '../chat-list.ts';
import type { HostValue } from '../host.tsx';
import { HostProvider, useQuery } from '../host.tsx';
import { useTheme } from '../theme.tsx';
import type { ChatView, ViewData } from '../view-model.ts';
import { agentById } from '../view-model.ts';
import { ChatActions, useChatCapabilities } from './ChatActions.tsx';
import { Caption, Empty, ListRow, Search } from './ListParts.tsx';
import { Label, Orb, Tag } from './primitives.tsx';

export type OpenChat = (chatId: string, agentId: string, searched: boolean) => void;

export function ChatList(props: Readonly<{
  data: ViewData; selectedChatId: string | null; host: HostValue | null; onOpenChat: OpenChat;
}>): JSX.Element {
  const body = <ChatListBody data={props.data} selectedChatId={props.selectedChatId} onOpenChat={props.onOpenChat}
    connected={props.host?.snapshot.status === 'connected'} />;
  return props.host ? <HostProvider value={props.host}>{body}</HostProvider> : body;
}

function ChatListBody(props: Readonly<{
  data: ViewData; selectedChatId: string | null; connected: boolean; onOpenChat: OpenChat;
}>): JSX.Element {
  const { data } = props;
  const [query, setQuery] = useState('');
  const [settled, setSettled] = useState('');
  // Ask the host only after typing pauses; local filtering is immediate.
  useEffect(() => {
    const timer = setTimeout(() => setSettled(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);
  const capabilities = useChatCapabilities();
  const manage = props.connected && capabilities.manage;
  const hostLabel = data.host?.label ?? 'your computer';
  const profiles = data.agents.slice(0, 16).map(agent => agent.id);
  const searching = query.trim().length >= 2;
  const remote = useQuery('chats.search', props.connected && capabilities.search && settled.length >= 2 && profiles.length
    ? { query: settled, profiles } : null);
  const local = filterChats(data.chats, data.agents, query);
  const shown = new Set(local.map(chat => chat.id));
  const extra = searching && remote.status === 'loaded' && remote.value
    ? remote.value.results.filter(hit => !shown.has(hit.id) && data.agents.some(agent => agent.id === hit.profile)) : [];
  let status = '';
  if (searching && props.connected) {
    if (!capabilities.search) status = 'Search covers chats already loaded on this device.';
    else if (remote.status === 'loading' || settled !== query.trim()) status = `Searching ${hostLabel}…`;
    else if (remote.status === 'failed') status = `Could not search ${hostLabel}. Showing chats on this device.`;
    else if (remote.value?.partial) status = 'Some agents could not be searched.';
  }
  const row = (chat: ChatView) => (
    <ChatRow key={chat.id} chat={chat} data={data} active={chat.id === props.selectedChatId}
      manage={manage} hostLabel={hostLabel} onOpen={() => props.onOpenChat(chat.id, chat.agentId, false)} />
  );
  return (
    <>
      <Search label="Search chats" value={query} onChange={setQuery} />
      {status ? <View role="status" aria-live="polite" style={{ paddingHorizontal: 12, paddingTop: 8 }}>
        <Label size={12} tone="muted">{status}</Label></View> : null}
      {data.chats.length === 0 && !searching ? <Empty>No chats yet. They appear here once a computer is connected.</Empty> : null}
      {local.length > 0 ? (
        <View role="list" aria-label="Chats">
          {data.sample ? <Caption tag="Sample data">Chats</Caption> : null}
          {groupChats(local).map(group => (
            <View key={group.label ?? 'new'} role="group" aria-label={group.label ?? 'New and saved chats'}>
              {group.label ? <Caption>{group.label}</Caption> : null}
              {group.chats.map(row)}
            </View>
          ))}
        </View>
      ) : null}
      {extra.length > 0 ? (
        <View role="list" aria-label={`More matches on ${hostLabel}`}>
          <Caption>{`More matches on ${hostLabel}`}</Caption>
          {extra.map(hit => <HitRow key={`${hit.profile}:${hit.id}`} hit={hit} data={data} active={hit.id === props.selectedChatId}
            onOpen={() => props.onOpenChat(hit.id, hit.profile, true)} />)}
        </View>
      ) : null}
      {searching && local.length === 0 && extra.length === 0 && !status ? <Empty>No chats match.</Empty> : null}
    </>
  );
}

function ChatRow(props: Readonly<{
  chat: ChatView; data: ViewData; active: boolean; manage: boolean; hostLabel: string; onOpen: () => void;
}>): JSX.Element {
  const { palette } = useTheme();
  const agent = agentById(props.data, props.chat.agentId);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2, minWidth: 0 }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <ListRow label={`${props.chat.title}, with ${agent?.name ?? 'an agent'}`} active={props.active} onPress={props.onOpen}>
          <Orb color={agent?.color ?? palette.muted} size={32} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Label weight="600" oneLine>{props.chat.title}</Label>
            <Label size={12} tone="muted" oneLine>{props.chat.preview ? `${agent?.name ?? 'Agent'} · ${props.chat.preview}` : agent?.name ?? 'Agent'}</Label>
          </View>
        </ListRow>
      </View>
      {props.manage ? <ChatActions chat={props.chat} hostLabel={props.hostLabel} /> : null}
    </View>
  );
}

function Snippet(props: Readonly<{ parts: readonly SnippetPart[]; fallback: string }>): JSX.Element {
  // Hermes' >>>match<<< markers become bold text; nothing is parsed as markup.
  if (!props.parts.length) return <Label size={12} tone="muted" oneLine>{props.fallback}</Label>;
  return (
    <Label size={12} tone="muted" oneLine>
      {props.parts.map((part, index) => part.match
        ? <Label key={index} size={12} tone="ink" weight="700">{part.text}</Label> : part.text)}
    </Label>
  );
}

function HitRow(props: Readonly<{ hit: ChatSearchHit; data: ViewData; active: boolean; onOpen: () => void }>): JSX.Element {
  const { palette } = useTheme();
  const agent = agentById(props.data, props.hit.profile);
  return (
    <ListRow label={`${props.hit.title}, with ${agent?.name ?? 'an agent'}${props.hit.archived ? ', archived' : ''}`}
      active={props.active} onPress={props.onOpen}>
      <Orb color={agent?.color ?? palette.muted} size={32} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <View style={{ flex: 1, minWidth: 0 }}><Label weight="600" oneLine>{props.hit.title}</Label></View>
          {props.hit.archived ? <Tag>Archived</Tag> : null}
        </View>
        <Snippet parts={props.hit.snippet} fallback={props.hit.preview || agent?.name || ''} />
      </View>
    </ListRow>
  );
}
