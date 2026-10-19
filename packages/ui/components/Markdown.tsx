// Renders the bounded Markdown model with native, selectable text. Links open
// in the system browser through the desktop API; nothing loads remote content.
import type { JSX } from 'react';
import { memo, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native-web';
import { parseMarkdown } from '../markdown.ts';
import type { Block, Inline } from '../markdown.ts';
import { useTheme } from '../theme.tsx';
import { MONO_STACK } from '../tokens.ts';
import { Icon, Label } from './primitives.tsx';
import type { Tone } from './primitives.tsx';

export type MarkdownActions = Readonly<{ openLink?: (href: string) => void; copy?: (text: string) => Promise<boolean> }>;

function Inlines(props: Readonly<{ nodes: readonly Inline[]; tone: Tone; actions: MarkdownActions }>): JSX.Element {
  const { palette } = useTheme();
  return <>{props.nodes.map((node, index) => {
    switch (node.kind) {
      case 'text': return <Text key={index}>{node.text}</Text>;
      case 'break': return <Text key={index}>{'\n'}</Text>;
      case 'strong': return <Text key={index} style={{ fontWeight: '700' }}><Inlines nodes={node.children} tone={props.tone} actions={props.actions} /></Text>;
      case 'em': return <Text key={index} style={{ fontStyle: 'italic' }}><Inlines nodes={node.children} tone={props.tone} actions={props.actions} /></Text>;
      case 'del': return <span key={index} style={{ textDecoration: 'line-through' }}><Inlines nodes={node.children} tone={props.tone} actions={props.actions} /></span>;
      case 'code': return <Text key={index} style={{ fontFamily: MONO_STACK, fontSize: 13, backgroundColor: palette.code, borderRadius: 4,
        paddingHorizontal: 4 }}>{node.text}</Text>;
      case 'link': return (
        <a key={index} href={node.href} title={node.href} rel="noreferrer"
          onClick={event => { event.preventDefault(); props.actions.openLink?.(node.href); }}
          style={{ color: props.tone === 'onOutgoing' ? palette.onOutgoing : palette.action, textDecoration: 'underline', cursor: 'pointer' }}>
          <Inlines nodes={node.children} tone={props.tone} actions={props.actions} />
        </a>
      );
    }
  })}</>;
}

function CodeBlock(props: Readonly<{ language: string; text: string; actions: MarkdownActions }>): JSX.Element {
  const { palette } = useTheme();
  const [copied, setCopied] = useState(false);
  return (
    <View style={{ borderWidth: 1, borderColor: palette.line, borderRadius: 10, backgroundColor: palette.code, overflow: 'hidden' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingLeft: 10, paddingRight: 4, minHeight: 30,
        borderBottomWidth: 1, borderBottomColor: palette.line }}>
        <View style={{ flex: 1 }}><Label size={12} tone="muted">{props.language || 'Text'}</Label></View>
        {props.actions.copy ? (
          <Pressable role="button" aria-label={copied ? 'Copied' : 'Copy code'} onPress={() => {
            void props.actions.copy?.(props.text).then(done => { if (done) { setCopied(true); setTimeout(() => setCopied(false), 1500); } });
          }} style={({ hovered }) => ({ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4,
            borderRadius: 6, cursor: 'pointer', backgroundColor: hovered ? palette.hover : 'transparent' })}>
            <Icon name={copied ? 'check' : 'copy'} color={palette.muted} size={14} />
            <Label size={12} tone="muted">{copied ? 'Copied' : 'Copy'}</Label>
          </Pressable>
        ) : null}
      </View>
      <ScrollView style={{ maxHeight: 480 }}>
        <pre style={{ margin: 0, padding: 10, overflowX: 'auto', fontFamily: MONO_STACK, fontSize: 13, lineHeight: '19px',
          color: palette.ink, whiteSpace: 'pre', userSelect: 'text', tabSize: 4 }}>{props.text}</pre>
      </ScrollView>
    </View>
  );
}

function Blocks(props: Readonly<{ blocks: readonly Block[]; tone: Tone; actions: MarkdownActions }>): JSX.Element {
  const { palette } = useTheme();
  return <>{props.blocks.map((block, index) => {
    switch (block.kind) {
      case 'heading': {
        const size = [20, 18, 16, 15, 14, 14][block.level - 1] ?? 14;
        return <Label key={index} heading={Math.min(6, block.level + 2)} size={size} weight="700" tone={props.tone} selectable>
          <Inlines nodes={block.children} tone={props.tone} actions={props.actions} /></Label>;
      }
      case 'paragraph':
        return <Label key={index} tone={props.tone} selectable><Inlines nodes={block.children} tone={props.tone} actions={props.actions} /></Label>;
      case 'code': return <CodeBlock key={index} language={block.language} text={block.text} actions={props.actions} />;
      case 'rule': return <View key={index} role="separator" style={{ height: 1, backgroundColor: palette.line, marginVertical: 4 }} />;
      case 'quote':
        return <View key={index} style={{ borderLeftWidth: 3, borderLeftColor: palette.line, paddingLeft: 10, gap: 8 }}>
          <Blocks blocks={block.children} tone={props.tone === 'ink' ? 'muted' : props.tone} actions={props.actions} /></View>;
      case 'list':
        return <View key={index} role="list" style={{ gap: 4 }}>{block.items.map((item, position) => (
          <View key={position} role="listitem" style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
            <View style={{ minWidth: block.ordered ? 22 : 12, alignItems: 'flex-end' }}>
              {item.checked !== null
                ? <View aria-hidden={true} style={{ width: 14, height: 14, marginTop: 3, borderRadius: 4, borderWidth: 1.5,
                    borderColor: palette.muted, alignItems: 'center', justifyContent: 'center',
                    backgroundColor: item.checked ? palette.action : 'transparent' }}>
                    {item.checked ? <Icon name="check" color={palette.onAction} size={10} /> : null}
                  </View>
                : <Label tone={props.tone}>{block.ordered ? `${block.start + position}.` : '•'}</Label>}
            </View>
            <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
              {item.checked !== null ? <span className="visually-hidden">{item.checked ? 'Done: ' : 'Not done: '}</span> : null}
              <Blocks blocks={item.children} tone={props.tone} actions={props.actions} />
            </View>
          </View>
        ))}</View>;
      case 'table':
        return (
          <div key={index} style={{ overflowX: 'auto', maxWidth: '100%' }}>
            <table style={{ borderCollapse: 'collapse', fontSize: 13, color: palette.ink, userSelect: 'text' }}>
              <thead><tr>{block.header.map((cell, column) => (
                <th key={column} style={{ textAlign: block.align[column] ?? 'left', padding: '6px 10px', borderBottom: `2px solid ${palette.line}`,
                  fontWeight: 700, whiteSpace: 'nowrap' }}><Inlines nodes={cell} tone={props.tone} actions={props.actions} /></th>
              ))}</tr></thead>
              <tbody>{block.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, column) => (
                <td key={column} style={{ textAlign: block.align[column] ?? 'left', padding: '6px 10px', borderBottom: `1px solid ${palette.line}`,
                  verticalAlign: 'top' }}><Inlines nodes={cell} tone={props.tone} actions={props.actions} /></td>
              ))}</tr>)}</tbody>
            </table>
          </div>
        );
    }
  })}</>;
}

// Memoized by text: a streaming reply re-parses only when its text changes.
export const Markdown = memo(function Markdown(props: Readonly<{ text: string; tone?: Tone; actions: MarkdownActions }>): JSX.Element {
  const document = useMemo(() => parseMarkdown(props.text), [props.text]);
  const tone = props.tone ?? 'ink';
  return (
    <View style={{ gap: 8, minWidth: 0 }}>
      {document.truncated ? <Label size={12} tone="muted">This reply is very long, so it is shown as plain text.</Label> : null}
      <Blocks blocks={document.blocks} tone={tone} actions={props.actions} />
    </View>
  );
});
