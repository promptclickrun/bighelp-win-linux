// The conversation log: reader-controlled scrolling, Markdown replies, folded
// tool work and plain failure rows. No animation; status is still text.
import type { JSX } from 'react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Pressable, View } from 'react-native-web';
import { useTheme } from '../theme.tsx';
import { MONO_STACK } from '../tokens.ts';
import { formatDuration, projectRows } from '../transcript.ts';
import type { Row, WorkRow } from '../transcript.ts';
import type { ChatView, TranscriptItem } from '../view-model.ts';
import { Banner } from './controls.tsx';
import { Markdown } from './Markdown.tsx';
import type { MarkdownActions } from './Markdown.tsx';
import { Icon, Label } from './primitives.tsx';

type Message = Extract<TranscriptItem, { kind: 'message' }>;
type Tool = Extract<TranscriptItem, { kind: 'tool' }>;

export type TranscriptOptions = Readonly<{
  showReasoning: boolean; foldFinishedTurns: boolean; liveTurn: string | null; running: boolean;
  status: string; agentName: string; actions: MarkdownActions; onCheckHistory?: (() => void) | undefined;
}>;

function CopyButton(props: Readonly<{ text: string; label?: string; actions: MarkdownActions }>): JSX.Element | null {
  const { palette } = useTheme();
  const [copied, setCopied] = useState(false);
  if (!props.actions.copy) return null;
  return (
    <Pressable role="button" aria-label={copied ? 'Copied' : props.label ?? 'Copy'} onPress={() => {
      void props.actions.copy?.(props.text).then(done => { if (done) { setCopied(true); setTimeout(() => setCopied(false), 1500); } });
    }} style={({ hovered }) => ({ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 6,
      cursor: 'pointer', backgroundColor: hovered ? palette.hover : 'transparent' })}>
      <Icon name={copied ? 'check' : 'copy'} color={palette.muted} size={14} />
      <Label size={12} tone="muted">{copied ? 'Copied' : props.label ?? 'Copy'}</Label>
    </Pressable>
  );
}

// Lost acknowledgement means "unknown", never "failed". Checking is the safe action.
function UnknownSend(props: Readonly<{ text: string; actions: MarkdownActions; onCheckHistory?: (() => void) | undefined }>): JSX.Element {
  const { palette } = useTheme();
  return (
    <View role="status" style={{ flexDirection: 'row', gap: 10, marginTop: 8, padding: 10, paddingHorizontal: 12, borderWidth: 1,
      borderColor: palette.warnLine, backgroundColor: palette.warnBackground, borderRadius: 12, maxWidth: 440 }}>
      <Icon name="question" color={palette.warnInk} />
      <View style={{ flex: 1, gap: 6 }}>
        <Label tone="warnInk"><Label tone="warnInk" weight="700">Not sure this arrived. </Label>
          The connection changed before Hermes confirmed it. Nothing is sent again automatically.</Label>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {props.onCheckHistory ? (
            <Pressable role="button" aria-label="Check chat history" onPress={props.onCheckHistory}
              style={({ hovered }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 5, paddingHorizontal: 10,
                borderRadius: 8, borderWidth: 1, borderColor: palette.line, backgroundColor: hovered ? palette.hover : palette.page, cursor: 'pointer' })}>
              <Icon name="refresh" color={palette.ink} size={16} />
              <Label size={13} weight="600">Check chat history</Label>
            </Pressable>
          ) : null}
          <CopyButton text={props.text} label="Copy text" actions={props.actions} />
        </View>
      </View>
    </View>
  );
}

function Bubble(props: Readonly<{ item: Message; options: TranscriptOptions; muted?: boolean }>): JSX.Element {
  const { palette } = useTheme();
  const out = props.item.direction === 'out';
  const text = props.item.paragraphs.join('\n\n');
  return (
    <View style={{ maxWidth: out ? '78%' : '94%', alignSelf: out ? 'flex-end' : 'flex-start', alignItems: out ? 'flex-end' : 'flex-start', gap: 4 }}>
      {props.item.attachments?.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: out ? 'flex-end' : 'flex-start' }}>
          {props.item.attachments.map((name, index) => (
            <View key={`${name}-${index}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 5, paddingHorizontal: 10,
              borderRadius: 10, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.card }}>
              <Icon name={name === 'Photo' ? 'palette' : 'attach'} color={palette.muted} size={14} />
              <Label size={12} oneLine>{name}</Label>
            </View>
          ))}
        </View>
      ) : null}
      {text.trim() ? (
        <View style={{ paddingVertical: 9, paddingHorizontal: 14, borderRadius: 18, minWidth: 0, maxWidth: '100%',
          backgroundColor: out ? palette.outgoing : props.muted ? 'transparent' : palette.incoming,
          ...(props.muted ? { borderLeftWidth: 2, borderLeftColor: palette.line, borderRadius: 0, paddingVertical: 2 } : {}),
          ...(out ? { borderBottomRightRadius: 6 } : props.muted ? {} : { borderBottomLeftRadius: 6 }) }}>
          {out
            ? <Label tone="onOutgoing" selectable style={{ whiteSpace: 'pre-wrap' }}>{text}</Label>
            : <Markdown text={text} tone={props.muted ? 'muted' : 'ink'} actions={props.options.actions} />}
        </View>
      ) : null}
      {!out && !props.item.streaming && !props.muted && text.trim() ? <CopyButton text={text} actions={props.options.actions} /> : null}
      {props.item.delivery === 'unknown' ? <UnknownSend text={text} actions={props.options.actions} onCheckHistory={props.options.onCheckHistory} /> : null}
    </View>
  );
}

function stepMeta(tool: Tool): string {
  if (tool.state === 'failed') return 'Failed';
  if (tool.state === 'stopped') return 'Stopped';
  if (tool.state === 'running') return '';
  return tool.durationMs !== undefined ? formatDuration(tool.durationMs) : '';
}

function ToolStep(props: Readonly<{ tool: Tool; actions: MarkdownActions }>): JSX.Element {
  const { palette } = useTheme();
  const [open, setOpen] = useState(false);
  const tool = props.tool;
  const meta = stepMeta(tool);
  const expandable = !!(tool.input || tool.output);
  const icon = tool.state === 'failed' ? 'close' : tool.state === 'stopped' ? 'question' : tool.state === 'running' ? 'tool' : 'check';
  const iconColor = tool.state === 'failed' ? palette.danger : tool.state === 'running' ? palette.action : palette.muted;
  return (
    <View style={{ gap: 6 }}>
      <Pressable role="button" {...(expandable ? { 'aria-expanded': open } : {})} disabled={!expandable}
        aria-label={`${tool.label}${tool.detail ? `: ${tool.detail}` : ''}${meta ? `. ${meta}` : ''}`}
        onPress={() => setOpen(value => !value)}
        style={({ hovered }) => ({ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4, paddingHorizontal: 6, borderRadius: 8,
          cursor: expandable ? 'pointer' : 'default', backgroundColor: hovered && expandable ? palette.hover : 'transparent' })}>
        <Icon name={icon} color={iconColor} size={15} />
        <Label size={13} weight="600" tone={tool.state === 'failed' ? 'danger' : 'ink'}>{tool.label}</Label>
        {tool.detail ? <View style={{ flex: 1, minWidth: 0 }}><Label size={12} mono tone="muted" oneLine>{tool.detail}</Label></View>
          : <View style={{ flex: 1 }} />}
        {meta ? <Label size={12} tone={tool.state === 'failed' ? 'danger' : 'muted'}>{meta}</Label> : null}
        {expandable ? <Icon name={open ? 'down' : 'right'} color={palette.muted} size={14} /> : null}
      </Pressable>
      {open ? (
        <View style={{ gap: 8, paddingLeft: 28 }}>
          {[['What it used', tool.input], ['What came back', tool.output]].map(([title, value]) => value ? (
            <View key={title} style={{ gap: 4 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View style={{ flex: 1 }}><Label size={12} weight="600" tone="muted">{title}</Label></View>
                <CopyButton text={value} actions={props.actions} />
              </View>
              <pre style={{ margin: 0, padding: 8, maxHeight: 280, overflow: 'auto', borderRadius: 8, backgroundColor: palette.code,
                border: `1px solid ${palette.line}`, fontFamily: MONO_STACK, fontSize: 12, lineHeight: '17px', color: palette.ink,
                whiteSpace: 'pre-wrap', wordBreak: 'break-word', userSelect: 'text' }}>{value}</pre>
            </View>
          ) : null)}
        </View>
      ) : null}
    </View>
  );
}

function Work(props: Readonly<{ row: WorkRow; options: TranscriptOptions }>): JSX.Element {
  const { palette } = useTheme();
  const [chosen, setChosen] = useState<boolean | null>(null);
  const open = chosen ?? (props.row.live || !props.options.foldFinishedTurns);
  const tone = props.row.failed ? 'danger' : 'muted';
  return (
    <View style={{ alignSelf: 'stretch', borderWidth: 1, borderColor: palette.line, borderRadius: 12, backgroundColor: palette.card, overflow: 'hidden' }}>
      <Pressable role="button" aria-expanded={open} aria-label={`${props.row.summary}. ${open ? 'Hide' : 'Show'} steps`}
        onPress={() => setChosen(!open)}
        style={({ hovered }) => ({ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 7, paddingHorizontal: 10,
          cursor: 'pointer', backgroundColor: hovered ? palette.hover : 'transparent' })}>
        <Icon name="tool" color={props.row.failed ? palette.danger : palette.muted} size={15} />
        <View style={{ flex: 1, minWidth: 0 }}><Label size={13} weight="600" tone={tone} oneLine>{props.row.summary}</Label></View>
        <Icon name={open ? 'down' : 'right'} color={palette.muted} size={14} />
      </Pressable>
      {open ? (
        <View style={{ paddingHorizontal: 8, paddingBottom: 8, gap: 4, borderTopWidth: 1, borderTopColor: palette.line, paddingTop: 6 }}>
          {props.row.items.map(item => {
            if (item.kind === 'tool') return <ToolStep key={item.id} tool={item} actions={props.options.actions} />;
            if (item.kind === 'reasoning') return (
              <View key={item.id} style={{ paddingHorizontal: 6, paddingVertical: 4, gap: 2 }}>
                <Label size={12} weight="600" tone="muted">{item.streaming ? 'Thinking' : 'Thought process'}</Label>
                <Label size={13} tone="muted" selectable style={{ whiteSpace: 'pre-wrap', fontStyle: 'italic' }}>{item.text}</Label>
              </View>
            );
            if (item.kind === 'message') return <View key={item.id} style={{ paddingHorizontal: 6 }}><Bubble item={item} options={props.options} muted /></View>;
            return null;
          })}
        </View>
      ) : null}
    </View>
  );
}

function RowView(props: Readonly<{ row: Row; options: TranscriptOptions }>): JSX.Element {
  const row = props.row;
  if (row.kind === 'day') return <View style={{ alignSelf: 'center', marginVertical: 4 }}><Label size={12} weight="600" tone="muted">{row.label}</Label></View>;
  if (row.kind === 'work') return <Work row={row} options={props.options} />;
  if (row.kind === 'notice') return <Banner tone={row.item.tone} text={row.item.text} />;
  return <Bubble item={row.item} options={props.options} />;
}

export function Transcript(props: Readonly<{ chat: ChatView; options: TranscriptOptions }>): JSX.Element {
  const { palette } = useTheme();
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [behind, setBehind] = useState(false);
  const rows = useMemo(() => projectRows(props.chat.transcript, { liveTurn: props.options.liveTurn, showReasoning: props.options.showReasoning }),
    [props.chat.transcript, props.options.liveTurn, props.options.showReasoning]);
  // A new chat starts at its latest message.
  useLayoutEffect(() => { stick.current = true; const node = scroller.current; if (node) node.scrollTop = node.scrollHeight; }, [props.chat.id]);
  // Follow new content only while the reader is at the bottom.
  useLayoutEffect(() => {
    const node = scroller.current; if (!node) return;
    if (stick.current) node.scrollTop = node.scrollHeight; else setBehind(true);
  }, [rows, props.options.status]);
  useEffect(() => { if (stick.current) setBehind(false); }, [rows]);
  const lastText = [...props.chat.transcript].reverse().find(item => item.kind === 'message' && item.direction === 'in');
  return (
    <View style={{ flex: 1, minHeight: 0 }}>
      <div ref={scroller} role="log" aria-label="Conversation" aria-live="off" tabIndex={0}
        onScroll={event => {
          const node = event.currentTarget;
          stick.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
          if (stick.current) setBehind(false);
        }}
        style={{ flex: 1, minHeight: 0, overflowY: 'auto', outline: 'none' }}>
        <View style={{ width: '100%', maxWidth: 820, alignSelf: 'center', gap: 10, paddingHorizontal: 24, paddingTop: 20, paddingBottom: 12 }}>
          {rows.length === 0 && !props.options.running
            ? <View style={{ paddingVertical: 40, alignItems: 'center' }}><Label tone="muted">{`Say hello to ${props.options.agentName}.`}</Label></View> : null}
          {rows.map(row => <RowView key={row.id} row={row} options={props.options} />)}
          {props.options.running ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 }}>
              <View aria-hidden={true} style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: palette.action }} />
              <Label size={13} tone="muted">{`${props.options.agentName} is working${props.options.status && props.options.status !== 'Working' ? ` · ${props.options.status}` : ''}`}</Label>
            </View>
          ) : null}
        </View>
      </div>
      {/* Screen readers hear status changes, not every streamed word. */}
      <div className="visually-hidden" aria-live="polite">{props.options.running ? `${props.options.agentName} is working` : lastText ? 'Reply finished' : ''}</div>
      {behind ? (
        <View style={{ position: 'absolute', bottom: 10, alignSelf: 'center' }}>
          <Pressable role="button" aria-label="Jump to the latest message" onPress={() => {
            const node = scroller.current; if (node) { node.scrollTop = node.scrollHeight; stick.current = true; setBehind(false); }
          }} style={({ hovered }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16,
            borderWidth: 1, borderColor: palette.line, backgroundColor: hovered ? palette.hover : palette.card, cursor: 'pointer',
            boxShadow: '0 4px 14px -6px rgba(0,0,0,.25)' })}>
            <Icon name="down" color={palette.ink} size={16} />
            <Label size={13} weight="600">Latest</Label>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
