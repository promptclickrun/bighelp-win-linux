// The open chat's header menu. Outside ChatList, so it brings its own host
// provider and capability read; unsupported hosts get no menu at all.
import type { JSX } from 'react';
import type { HostValue } from '../host.tsx';
import { HostProvider } from '../host.tsx';
import type { ChatView } from '../view-model.ts';
import { ChatActions, useChatCapabilities } from './ChatActions.tsx';

export function ChatMenu(props: Readonly<{ host: HostValue; chat: ChatView; hostLabel: string }>): JSX.Element {
  return <HostProvider value={props.host}><HeaderActions chat={props.chat} hostLabel={props.hostLabel} /></HostProvider>;
}
function HeaderActions(props: Readonly<{ chat: ChatView; hostLabel: string }>): JSX.Element | null {
  const { manage } = useChatCapabilities();
  return manage ? <ChatActions chat={props.chat} hostLabel={props.hostLabel} label="More for this chat" /> : null;
}
