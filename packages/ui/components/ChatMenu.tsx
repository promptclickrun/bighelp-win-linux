// The open chat's header menu. It reads the host's capabilities itself, so an
// unsupported host gets no menu at all. Needs the app's HostProvider.
import type { JSX } from 'react';
import type { ChatView } from '../view-model.ts';
import { ChatActions, useChatCapabilities } from './ChatActions.tsx';

export function ChatMenu(props: Readonly<{ chat: ChatView; hostLabel: string }>): JSX.Element | null {
  const { manage } = useChatCapabilities();
  return manage ? <ChatActions chat={props.chat} hostLabel={props.hostLabel} label="More for this chat" /> : null;
}
