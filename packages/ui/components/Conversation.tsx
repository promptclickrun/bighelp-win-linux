// The open agent's page (mock D): header, transcript, pinned composer, then the
// agent's own Chat/Feed/Ideas/Goals/Files bar. The composer is a sibling of the
// scroller, never inside a recycled list, so streaming can't reset the draft.
import type { JSX, ReactNode } from 'react';
import { useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native-web';
import { AGENT_TABS, SHELL_LIMITS } from '../../domain/shell.ts';
import type { AgentTab } from '../../domain/shell.ts';
import type { GlyphName } from '../glyphs.ts';
import { useTheme } from '../theme.tsx';
import type { AgentView, ChatView, HostView, TranscriptItem } from '../view-model.ts';
import { Icon, IconButton, Label, Notice, Orb } from './primitives.tsx';

const TAB_INFO: Readonly<Record<AgentTab, readonly [GlyphName, string]>> = Object.freeze({
  chat: ['chat', 'Chat'], feed: ['feed', 'Feed'], ideas: ['ideas', 'Ideas'], goals: ['goals', 'Goals'], files: ['files', 'Files'],
});

function Bubble(props: Readonly<{ item: Extract<TranscriptItem, { kind: 'message' }> }>): JSX.Element {
  const { palette } = useTheme();
  const out = props.item.direction === 'out';
  return (
    <View style={{ maxWidth: '78%', alignSelf: out ? 'flex-end' : 'flex-start', alignItems: out ? 'flex-end' : 'flex-start' }}>
      <View style={{ paddingVertical: 9, paddingHorizontal: 14, borderRadius: 18, gap: 6,
        backgroundColor: out ? palette.outgoing : palette.incoming,
        ...(out ? { borderBottomRightRadius: 6 } : { borderBottomLeftRadius: 6 }) }}>
        {props.item.paragraphs.slice(0, 1).map((text, index) => (
          <Label key={`p${index}`} tone={out ? 'onOutgoing' : 'ink'} selectable>{text}</Label>
        ))}
        {props.item.bullets ? (
          <View role="list" style={{ gap: 2, paddingLeft: 6 }}>
            {props.item.bullets.map((text, index) => (
              <View key={`b${index}`} role="listitem" style={{ flexDirection: 'row', gap: 8 }}>
                <Label tone={out ? 'onOutgoing' : 'ink'}>•</Label>
                <Label tone={out ? 'onOutgoing' : 'ink'} selectable>{text}</Label>
              </View>
            ))}
          </View>
        ) : null}
        {props.item.paragraphs.slice(1).map((text, index) => (
          <Label key={`q${index}`} tone={out ? 'onOutgoing' : 'ink'} selectable>{text}</Label>
        ))}
      </View>
      {props.item.delivery === 'unknown' ? <UnknownSend /> : null}
    </View>
  );
}

// Lost acknowledgement means "unknown", never "failed". Checking is the safe
// action. In this slice no host exists, so none of the three can act yet.
function UnknownSend(): JSX.Element {
  const { palette } = useTheme();
  const disabledNote = 'Not available in this build';
  return (
    <View role="status" style={{ flexDirection: 'row', gap: 10, marginTop: 8, padding: 10, paddingHorizontal: 12,
      borderWidth: 1, borderColor: palette.warnLine, backgroundColor: palette.warnBackground, borderRadius: 12, maxWidth: 440 }}>
      <Icon name="question" color={palette.warnInk} />
      <View style={{ flex: 1, gap: 6 }}>
        <Label tone="warnInk"><Label tone="warnInk" weight="700">Not sure this arrived. </Label>
          The connection dropped before Hermes confirmed it.</Label>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
          {([['refresh', 'Check chat history'], ['copy', 'Copy text'], [null, 'Send again…']] as const).map(([icon, text]) => (
            <Pressable key={text} role="button" aria-label={`${text}. ${disabledNote}`} disabled
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 10,
                borderRadius: 8, opacity: 0.6, cursor: 'not-allowed',
                ...(icon === 'refresh' ? { borderWidth: 1, borderColor: palette.line, backgroundColor: palette.page } : {}) }}>
              {icon ? <Icon name={icon} color={icon === 'refresh' ? palette.ink : palette.warnInk} size={16} /> : null}
              <Label size={13} weight={icon === 'refresh' ? '600' : '400'} tone={icon === 'refresh' ? 'ink' : 'warnInk'}>{text}</Label>
            </Pressable>
          ))}
        </View>
        <Label size={12} tone="warnInk">Sending again could duplicate this message. Refresh chats in Settings → Hosts to check history.</Label>
      </View>
    </View>
  );
}

function ToolRow(props: Readonly<{ item: Extract<TranscriptItem, { kind: 'tool' }> }>): JSX.Element {
  const { palette } = useTheme();
  return (
    <View style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1,
      borderColor: palette.line, backgroundColor: palette.card, borderRadius: 10, paddingVertical: 5, paddingHorizontal: 10 }}>
      <Icon name="tool" color={palette.muted} size={16} />
      <Label size={13} tone="muted">{props.item.label}</Label>
      <Label size={12} mono selectable>{props.item.detail}</Label>
    </View>
  );
}

function Transcript(props: Readonly<{ chat: ChatView }>): JSX.Element {
  return (
    <ScrollView role="log" aria-label="Conversation" style={{ flex: 1 }}
      contentContainerStyle={{ width: '100%', maxWidth: 760, alignSelf: 'center', gap: 10, paddingHorizontal: 24,
        paddingTop: 20, paddingBottom: 12 }}>
      {props.chat.transcript.map(item => {
        if (item.kind === 'day') {
          return <View key={item.id} style={{ alignSelf: 'center', marginBottom: 4 }}><Label size={12} weight="600" tone="muted">{item.label}</Label></View>;
        }
        if (item.kind === 'tool') return <ToolRow key={item.id} item={item} />;
        return <Bubble key={item.id} item={item} />;
      })}
    </ScrollView>
  );
}

export function Composer(props: Readonly<{ agentName: string; draft: string; onDraft: (text: string) => void; hint: string; canSend?: boolean; editable?: boolean; running?: boolean; onSend?: (() => void) | undefined; onStop?: (() => void) | undefined }>): JSX.Element {
  const { palette, font } = useTheme();
  const [height, setHeight] = useState(34);
  const disabledNote = 'Not available in this build';
  return (
    <View role="form" aria-label="Message box" style={{ width: '100%', maxWidth: 760, alignSelf: 'center', paddingTop: 8,
      paddingHorizontal: 20, paddingBottom: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 4, backgroundColor: palette.card, borderWidth: 1,
        borderColor: palette.line, borderRadius: 22, padding: 5, boxShadow: '0 4px 14px -6px rgba(60,40,30,.16)' }}>
        <IconButton icon="plus" label={`Add photos or files. ${disabledNote}`} onPress={() => {}} disabled />
        <TextInput multiline editable={props.editable ?? true} value={props.draft} onChangeText={props.onDraft} aria-label={`Message ${props.agentName}`}
          aria-describedby="composer-hint" placeholder={`Message ${props.agentName}`} placeholderTextColor={palette.muted}
          maxLength={SHELL_LIMITS.draftCharacters} spellCheck={false}
          onContentSizeChange={event => setHeight(Math.min(200, Math.max(34, Math.ceil(event.nativeEvent.contentSize.height))))}
          style={{ flex: 1, minWidth: 0, height, paddingVertical: 7, paddingHorizontal: 6, fontFamily: font, fontSize: 14,
            lineHeight: 20, color: palette.ink, outlineStyle: 'none', resize: 'none' }} />
        <IconButton icon="mic" label={`Voice. ${disabledNote}`} onPress={() => {}} disabled />
        <Pressable role="button" aria-label={props.running ? "Stop reply" : `Send. ${props.hint}`} disabled={props.running ? !props.onStop : !props.canSend || !props.draft.trim()} onPress={() => { if (props.running) props.onStop?.(); else props.onSend?.(); }}
          style={{ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center',
            backgroundColor: palette.incoming, opacity: props.canSend || props.running ? 1 : 0.6, cursor: 'pointer' }}>
          <Icon name={props.running ? 'close' : 'send'} color={palette.muted} />
        </Pressable>
      </View>
      <Label nativeID="composer-hint" size={12} tone="muted" style={{ marginTop: 6, marginHorizontal: 14 }}>{props.hint}</Label>
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
  sample: boolean; canSend?: boolean; editable?: boolean; running?: boolean; requests?: ReactNode; onSend?: (() => void) | undefined; onStop?: (() => void) | undefined; onNewChat?: (() => void) | undefined; onDraft: (text: string) => void; onTab: (tab: AgentTab) => void; onBack?: (() => void) | undefined;
}>): JSX.Element {
  const { palette } = useTheme();
  const subline = props.sample ? `Sample data · ${props.host?.label ?? ''}` : props.host?.label ?? 'Not connected';
  let body: JSX.Element;
  if (props.tab !== 'chat') {
    body = <Notice title="Not built yet" body={`${props.agent.name}'s ${TAB_INFO[props.tab][1]} comes in a later step.`} />;
  } else if (props.chat) {
    body = <Transcript chat={props.chat} />;
  } else {
    body = <Notice title={`New chat with ${props.agent.name}`} body="Nothing has been sent. Use New chat to start a conversation." />;
  }
  return (
    <View role="main" style={{ flex: 1, minWidth: 0, backgroundColor: palette.page }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 16,
        borderBottomWidth: 1, borderBottomColor: palette.line, minHeight: 56 }}>
        {props.onBack ? <IconButton icon="left" label="Back to the list" onPress={props.onBack} /> : null}
        <Orb color={props.agent.color} size={32} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Label heading={2} size={15} weight="700" oneLine>{props.agent.name}</Label>
          <Label size={12} tone="muted" oneLine>{subline}</Label>
        </View>
        <IconButton icon="compose" label={`New chat with ${props.agent.name}`} onPress={props.onNewChat ?? (() => {})} disabled={!props.onNewChat} />
      </View>
      {body}
      {props.requests}
      {props.tab === 'chat' ? <Composer agentName={props.agent.name} draft={props.draft} onDraft={props.onDraft} hint={props.hint} editable={props.editable ?? true} canSend={props.canSend ?? false} running={props.running ?? false} onSend={props.onSend} onStop={props.onStop} /> : null}
      <AgentTabs agentName={props.agent.name} active={props.tab} onTab={props.onTab} />
    </View>
  );
}
