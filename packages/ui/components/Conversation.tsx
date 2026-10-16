// The open agent's page (mock D): header, transcript, pinned composer, then the
// agent's own Chat/Feed/Ideas/Goals/Files bar. The composer is a sibling of the
// scroller, never inside a recycled list, so streaming can't reset the draft.
import type { JSX, KeyboardEvent, ReactNode } from 'react';
import { useLayoutEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native-web';
import { AGENT_TABS, SHELL_LIMITS } from '../../domain/shell.ts';
import type { AgentTab } from '../../domain/shell.ts';
import type { TodoItem } from '../../domain/live-turn.ts';
import type { GlyphName } from '../glyphs.ts';
import { useTheme } from '../theme.tsx';
import type { AgentView, ChatView, HostView } from '../view-model.ts';
import type { MarkdownActions } from './Markdown.tsx';
import { IconButton, Icon, Label, Notice, Orb } from './primitives.tsx';
import { Transcript } from './Transcript.tsx';
import { COMPOSER_ID } from '../ids.ts';

const TAB_INFO: Readonly<Record<AgentTab, readonly [GlyphName, string]>> = Object.freeze({
  chat: ['chat', 'Chat'], feed: ['feed', 'Feed'], ideas: ['ideas', 'Ideas'], goals: ['goals', 'Goals'], files: ['files', 'Files'],
});

export type ChatOptions = Readonly<{
  showReasoning: boolean; foldFinishedTurns: boolean; enterToSend: boolean; busyMode: 'steer' | 'queue' | 'interrupt'; nerdMode: boolean;
}>;
export const DEFAULT_CHAT_OPTIONS: ChatOptions = Object.freeze({ showReasoning: false, foldFinishedTurns: true, enterToSend: true, busyMode: 'steer', nerdMode: false });
export type TurnInfo = Readonly<{ status: string; todos: readonly TodoItem[]; context: Readonly<{ used: number; max: number }> | null }>;

const BUSY_LABELS = Object.freeze({ steer: 'Add to the reply in progress', queue: 'Send after this reply', interrupt: 'Stop the reply and send' });

export function Composer(props: Readonly<{
  agentName: string; draft: string; onDraft: (text: string) => void; hint: string; canSend?: boolean; editable?: boolean; running?: boolean;
  onSend?: (() => void) | undefined; onStop?: (() => void) | undefined; enterToSend?: boolean; busyMode?: ChatOptions['busyMode'];
  attachments?: ReactNode; onAttach?: (() => void) | undefined;
}>): JSX.Element {
  const { palette, font } = useTheme();
  const input = useRef<HTMLTextAreaElement>(null);
  const hasText = !!props.draft.trim() || !!props.attachments;
  const sendable = !!props.canSend && hasText;
  const showStop = !!props.running && !hasText;
  // Grow with the text up to a limit, then scroll inside the box.
  useLayoutEffect(() => {
    const node = input.current; if (!node) return;
    node.style.height = 'auto';
    node.style.height = `${Math.min(220, Math.max(36, node.scrollHeight))}px`;
  }, [props.draft]);
  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Never send while an input method is composing (CJK, emoji pickers).
    if (event.nativeEvent.isComposing || event.key !== 'Enter') return;
    const send = (props.enterToSend ?? true) ? !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey : event.ctrlKey || event.metaKey;
    if (!send) return;
    event.preventDefault();
    if (sendable) props.onSend?.();
  };
  const sendLabel = props.running ? BUSY_LABELS[props.busyMode ?? 'steer'] : 'Send';
  return (
    <View role="form" aria-label="Message box" style={{ width: '100%', maxWidth: 820, alignSelf: 'center', paddingTop: 8,
      paddingHorizontal: 20, paddingBottom: 10 }}>
      {props.attachments}
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 4, backgroundColor: palette.card, borderWidth: 1,
        borderColor: palette.line, borderRadius: 22, padding: 5, boxShadow: '0 4px 14px -6px rgba(60,40,30,.16)' }}>
        <IconButton icon="plus" label={props.onAttach ? 'Add files or photos' : 'Adding files needs a connected chat'}
          onPress={props.onAttach ?? (() => {})} disabled={!props.onAttach || props.editable === false} />
        <textarea id={COMPOSER_ID} ref={input} value={props.draft} rows={1} readOnly={props.editable === false}
          onChange={event => props.onDraft(event.target.value)} onKeyDown={keyDown}
          aria-label={`Message ${props.agentName}`} aria-describedby="composer-hint" placeholder={`Message ${props.agentName}`}
          maxLength={SHELL_LIMITS.draftCharacters} spellCheck={false}
          style={{ flex: 1, minWidth: 0, height: 36, maxHeight: 220, padding: '8px 6px', border: 'none', background: 'transparent',
            fontFamily: font, fontSize: 14, lineHeight: '20px', color: palette.ink, outline: 'none', resize: 'none', overflowY: 'auto' }} />
        {props.running ? (
          <Pressable role="button" aria-label="Stop the reply" disabled={!props.onStop} onPress={() => props.onStop?.()}
            style={({ hovered }) => ({ height: 34, paddingHorizontal: 12, borderRadius: 17, flexDirection: 'row', alignItems: 'center', gap: 6,
              borderWidth: 1, borderColor: palette.line, backgroundColor: hovered ? palette.hover : palette.card, cursor: 'pointer',
              ...(showStop ? {} : { display: 'none' as const }) })}>
            <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: palette.ink }} />
            <Label size={13} weight="600">Stop</Label>
          </Pressable>
        ) : null}
        {!showStop ? (
          <Pressable role="button" aria-label={`${sendLabel}. ${props.hint}`} disabled={!sendable} onPress={() => { if (sendable) props.onSend?.(); }}
            style={{ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center',
              backgroundColor: sendable ? palette.action : palette.incoming, cursor: sendable ? 'pointer' : 'not-allowed' }}>
            <Icon name="send" color={sendable ? palette.onAction : palette.muted} />
          </Pressable>
        ) : null}
      </View>
      <Label nativeID="composer-hint" size={12} tone="muted" style={{ marginTop: 6, marginHorizontal: 14 }}>
        {props.running && hasText ? `${sendLabel}. ${props.hint}` : props.hint}</Label>
    </View>
  );
}

function TodoRail(props: Readonly<{ todos: readonly TodoItem[] }>): JSX.Element | null {
  const { palette } = useTheme();
  const [open, setOpen] = useState(false);
  const active = props.todos.filter(todo => todo.status !== 'cancelled');
  if (!active.length) return null;
  const done = active.filter(todo => todo.status === 'completed').length;
  return (
    <View style={{ width: '100%', maxWidth: 820, alignSelf: 'center', paddingHorizontal: 20 }}>
      <View style={{ borderWidth: 1, borderColor: palette.line, borderRadius: 12, backgroundColor: palette.card }}>
        <Pressable role="button" aria-expanded={open} aria-label={`Tasks ${done} of ${active.length} done`} onPress={() => setOpen(!open)}
          style={({ hovered }) => ({ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, paddingHorizontal: 10, cursor: 'pointer',
            backgroundColor: hovered ? palette.hover : 'transparent', borderRadius: 12 })}>
          <Icon name="check" color={palette.muted} size={15} />
          <View style={{ flex: 1 }}><Label size={13} weight="600">{`Tasks ${done}/${active.length}`}</Label></View>
          <Icon name={open ? 'down' : 'right'} color={palette.muted} size={14} />
        </Pressable>
        {open ? <View role="list" style={{ paddingHorizontal: 12, paddingBottom: 8, gap: 4 }}>
          {active.map(todo => (
            <View key={todo.id} role="listitem" style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
              <Label size={13} tone={todo.status === 'completed' ? 'muted' : 'ink'}>{todo.status === 'completed' ? '✓' : todo.status === 'in_progress' ? '→' : '○'}</Label>
              <View style={{ flex: 1 }}><Label size={13} tone={todo.status === 'completed' ? 'muted' : 'ink'}>{todo.content}</Label></View>
            </View>
          ))}
        </View> : null}
      </View>
    </View>
  );
}

function AgentTabs(props: Readonly<{ agentName: string; active: AgentTab; onTab: (tab: AgentTab) => void }>): JSX.Element {
  const { palette } = useTheme();
  return (
    <View role="tablist" aria-label={props.agentName} style={{ flexDirection: 'row', justifyContent: 'center', gap: 4,
      paddingTop: 6, paddingHorizontal: 12, paddingBottom: 10, borderTopWidth: 1, borderTopColor: palette.line }}>
      {AGENT_TABS.map(tab => {
        const [icon, label] = TAB_INFO[tab];
        const active = tab === props.active;
        return (
          <Pressable key={tab} role="tab" aria-selected={active} aria-label={label} onPress={() => props.onTab(tab)}
            style={({ hovered }) => [{ alignItems: 'center', gap: 2, width: 84, paddingVertical: 6, borderRadius: 10,
              cursor: 'pointer' }, hovered ? { backgroundColor: palette.hover } : null]}>
            <Icon name={icon} color={active ? palette.action : palette.muted} size={18} />
            <Label size={12} tone={active ? 'action' : 'muted'} weight={active ? '600' : '400'}>{label}</Label>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Conversation(props: Readonly<{
  agent: AgentView; chat: ChatView | null; host: HostView | null; tab: AgentTab; draft: string; hint: string;
  sample: boolean; canSend?: boolean; editable?: boolean; running?: boolean; board?: ReactNode; files?: ReactNode; requests?: ReactNode;
  headerActions?: ReactNode; attachments?: ReactNode; onAttach?: (() => void) | undefined;
  onSend?: (() => void) | undefined; onStop?: (() => void) | undefined; onNewChat?: (() => void) | undefined; onDraft: (text: string) => void;
  onTab: (tab: AgentTab) => void; onBack?: (() => void) | undefined; onCheckHistory?: (() => void) | undefined;
  options?: ChatOptions | undefined; turn?: TurnInfo | undefined; liveTurn?: string | null; actions?: MarkdownActions;
}>): JSX.Element {
  const { palette } = useTheme();
  const options = props.options ?? DEFAULT_CHAT_OPTIONS;
  const context = options.nerdMode && props.turn?.context ? ` · context ${Math.round(props.turn.context.used / props.turn.context.max * 100)}% used` : '';
  const subline = props.sample ? `Sample data · ${props.host?.label ?? ''}` : `${props.host?.label ?? 'Not connected'}${props.chat && props.chat.title !== 'New chat' ? ` · ${props.chat.title}` : ''}${context}`;
  let body: JSX.Element;
  if (props.tab !== 'chat') {
    body = props.tab === 'files' ? <>{props.files ?? <Notice title="Files" body="Files on your computer appear here when the bighelp plugin offers them." />}</> : <>{props.board}</>;
  } else if (props.chat) {
    body = <Transcript chat={props.chat} options={{ showReasoning: options.showReasoning, foldFinishedTurns: options.foldFinishedTurns,
      liveTurn: props.running ? props.liveTurn ?? null : null, running: !!props.running, status: props.turn?.status ?? '', agentName: props.agent.name,
      actions: props.actions ?? {}, onCheckHistory: props.onCheckHistory }} />;
  } else {
    body = <Notice title={`New chat with ${props.agent.name}`} body="Nothing has been sent. Use New chat to start a conversation." />;
  }
  return (
    <View role="main" style={{ flex: 1, minWidth: 0, minHeight: 0, backgroundColor: palette.page }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 16,
        borderBottomWidth: 1, borderBottomColor: palette.line, minHeight: 56 }}>
        {props.onBack ? <IconButton icon="left" label="Back to the list" onPress={props.onBack} /> : null}
        <Orb color={props.agent.color} size={32} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Label heading={2} size={15} weight="700" oneLine>{props.agent.name}</Label>
          <Label size={12} tone="muted" oneLine>{subline}</Label>
        </View>
        {props.headerActions}
        <IconButton icon="compose" label={`New chat with ${props.agent.name}`} onPress={props.onNewChat ?? (() => {})} disabled={!props.onNewChat} />
      </View>
      {body}
      {/* Keep the native editor node and its undo/IME state across agent tabs. */}
      <div hidden={props.tab !== 'chat'} inert={props.tab !== 'chat'} aria-hidden={props.tab !== 'chat'} style={{ display: props.tab === 'chat' ? 'contents' : 'none' }}>
        {props.requests}
        {props.turn?.todos.length ? <TodoRail todos={props.turn.todos} /> : null}
        <Composer agentName={props.agent.name} draft={props.draft} onDraft={props.onDraft} hint={props.hint} editable={props.editable ?? true}
          canSend={props.canSend ?? false} running={props.running ?? false} onSend={props.onSend} onStop={props.onStop}
          enterToSend={options.enterToSend} busyMode={options.busyMode} attachments={props.attachments} onAttach={props.onAttach} />
      </div>
      <AgentTabs agentName={props.agent.name} active={props.tab} onTab={props.onTab} />
    </View>
  );
}
