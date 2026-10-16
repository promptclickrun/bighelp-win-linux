// The context column: its content follows the rail selection (mock D).
import type { JSX, ReactNode } from 'react';
import { useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native-web';
import type { Place, SettingsSection } from '../../domain/shell.ts';
import { useTheme } from '../theme.tsx';
import type { AgentView, ViewData } from '../view-model.ts';
import { agentById } from '../view-model.ts';
import { Icon, IconButton, Label, Orb, Tag, hoverFill } from './primitives.tsx';
import { SettingsSectionList } from './Settings.tsx';

export const PLACE_TITLES: Readonly<Record<Place, string>> = Object.freeze({
  chats: 'Chats', agents: 'Agents', projects: 'Projects', kanban: 'Kanban', workflows: 'Workflows',
  scheduled: 'Scheduled', usage: 'Usage', vault: 'Vault', settings: 'Settings',
});

// Rows without an action render as plain list items, so nothing looks clickable that isn't.
function Row(props: Readonly<{ label: string; active: boolean; onPress?: () => void; children: ReactNode }>): JSX.Element {
  const { palette } = useTheme();
  if (!props.onPress) {
    return (
      <View role="listitem" aria-label={props.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 8,
        borderRadius: 10, minWidth: 0 }}>
        {props.children}
      </View>
    );
  }
  return (
    <Pressable role="button" aria-label={props.label} aria-current={props.active ? 'true' : false} onPress={props.onPress}
      style={({ hovered }) => [{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 8, borderRadius: 10,
        minWidth: 0, cursor: 'pointer' }, hoverFill(palette, hovered, props.active)]}>
      {props.children}
    </Pressable>
  );
}

function Caption(props: Readonly<{ children: string; tag?: string | undefined }>): JSX.Element {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: 18, paddingBottom: 6, paddingHorizontal: 10 }}>
      <View style={{ flex: 1 }}><Label size={12} weight="700" tone="muted">{props.children}</Label></View>
      {props.tag ? <Tag>{props.tag}</Tag> : null}
    </View>
  );
}

function Search(props: Readonly<{ label: string }>): JSX.Element {
  const { palette, font } = useTheme();
  const [query, setQuery] = useState('');
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 4, paddingVertical: 6,
      paddingHorizontal: 10, borderRadius: 10, backgroundColor: palette.incoming }}>
      <Icon name="search" color={palette.muted} size={16} />
      <TextInput value={query} onChangeText={setQuery} placeholder={props.label} aria-label={props.label}
        placeholderTextColor={palette.muted} maxLength={256}
        style={{ flex: 1, minWidth: 0, fontFamily: font, fontSize: 14, color: palette.ink, outlineStyle: 'none' }} />
    </View>
  );
}

function Empty(props: Readonly<{ children: string }>): JSX.Element {
  return <View style={{ padding: 12 }}><Label tone="muted" size={13}>{props.children}</Label></View>;
}

export function ContextList(props: Readonly<{
  place: Place; data: ViewData; selectedChatId: string | null; selectedAgentId: string | null; nerdMode: boolean;
  settingsSection: SettingsSection | null; onOpenChat: (chatId: string, agentId: string) => void;
  onOpenAgent: (agentId: string) => void; onSettingsSection: (section: SettingsSection) => void; narrow: boolean;
  // Agent management controls, supplied only while a computer is connected.
  addAgent?: JSX.Element; agentMenu?: ((agent: AgentView) => ReactNode) | undefined;
}>): JSX.Element {
  const { palette } = useTheme();
  const { data } = props;
  const title = PLACE_TITLES[props.place];
  const offline = data.host?.state === 'offline';
  let body: JSX.Element;
  let actions: JSX.Element | null = null;
  const unavailable = 'Needs a connected computer';
  switch (props.place) {
    case 'chats':
      actions = (
        <View style={{ flexDirection: 'row' }}>
          <IconButton icon="group" label={`New group chat. ${unavailable}`} onPress={() => {}} disabled />
          <IconButton icon="compose" label={`New chat. ${unavailable}`} onPress={() => {}} disabled />
        </View>
      );
      body = (
        <>
          <Search label="Search chats" />
          {data.chats.length === 0 ? <Empty>No chats yet. They appear here once a computer is connected.</Empty> : (
            <View role="list">
              <Caption tag={data.sample ? 'Sample data' : undefined}>Today</Caption>
              {data.chats.map(chat => {
                const agent = agentById(data, chat.agentId);
                return (
                  <Row key={chat.id} label={`${chat.title}, with ${agent?.name ?? 'an agent'}`}
                    active={chat.id === props.selectedChatId} onPress={() => props.onOpenChat(chat.id, chat.agentId)}>
                    <Orb color={agent?.color ?? palette.muted} size={32} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Label weight="600" oneLine>{chat.title}</Label>
                      <Label size={12} tone="muted" oneLine>{`${agent?.name ?? 'Agent'} · ${chat.preview}`}</Label>
                    </View>
                  </Row>
                );
              })}
            </View>
          )}
        </>
      );
      break;
    case 'agents':
      actions = props.addAgent ?? <IconButton icon="plus" label={`Add agent. ${unavailable}`} onPress={() => {}} disabled />;
      body = (
        <>
          <Search label="Search agents" />
          {data.agents.length === 0 ? <Empty>Agents on your computer show up here.</Empty> : (
            <View role="list">
              <Caption tag={data.sample ? 'Sample data' : undefined}>{`On ${data.host?.label ?? 'this computer'}`}</Caption>
              {data.agents.map(agent => (
                // The menu sits beside the row button, never inside it.
                <View key={agent.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Row label={agent.name} active={agent.id === props.selectedAgentId} onPress={() => props.onOpenAgent(agent.id)}>
                      <Orb color={agent.color} size={36} />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Label weight="600" oneLine>{agent.name}</Label>
                        {agent.summary ? <Label size={12} tone="muted" oneLine>{agent.summary}</Label> : null}
                        {props.nerdMode ? <Label size={11} tone="muted" mono oneLine>{agent.model ? `${agent.id} · ${agent.model}` : agent.id}</Label> : null}
                      </View>
                    </Row>
                  </View>
                  {props.agentMenu?.(agent)}
                </View>
              ))}
            </View>
          )}
        </>
      );
      break;
    case 'workflows':
      body = data.workflows.length === 0 ? <Empty>Workflows on your computer show up here.</Empty> : (
        <View role="list">
          <Caption tag="Sample data">Yours</Caption>
          {data.workflows.map(workflow => (
            <Row key={workflow.id} label={workflow.title} active={false}>
              <View style={{ width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
                backgroundColor: palette.actionSoft }}>
                <Icon name="workflows" color={palette.action} size={18} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Label weight="600" oneLine>{workflow.title}</Label>
                <Label size={12} tone="muted" oneLine>{workflow.status}</Label>
              </View>
            </Row>
          ))}
        </View>
      );
      break;
    case 'settings':
      body = props.narrow ? <View /> : <SettingsSectionList nerdMode={props.nerdMode} active={props.settingsSection}
        onOpen={props.onSettingsSection} />;
      break;
    default:
      body = <Empty>{`${title} comes in a later step of the desktop build.`}</Empty>;
  }
  return <ContextColumn title={title} narrow={props.narrow} actions={actions}>
    {offline && (props.place === 'chats' || props.place === 'agents') ? (
      <View role="status" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 4, marginBottom: 8,
        paddingVertical: 6, paddingHorizontal: 10, borderRadius: 10, backgroundColor: palette.warnBackground,
        borderWidth: 1, borderColor: palette.warnLine }}>
        <Icon name="offline" color={palette.warnInk} size={16} />
        <Label size={12} tone="warnInk">Offline · showing copies saved on this device</Label>
      </View>
    ) : null}
    {body}
  </ContextColumn>;
}

// Shared shell column; function pages supply their own actual controls and rows.
export function ContextColumn(props: Readonly<{
  title: string; narrow: boolean; actions?: ReactNode; children: ReactNode;
}>): JSX.Element {
  const { palette } = useTheme();
  return (
    // Wide: fixed 300 px. Never flex: 0, which collapses its flex basis.
    <View role="region" aria-label={props.title} style={[{ borderRightWidth: props.narrow ? 0 : 1,
      borderRightColor: palette.line, backgroundColor: palette.page, minHeight: 0 },
      props.narrow ? { flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0 } : { flexGrow: 0, flexShrink: 0, width: 300 }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: 12, paddingBottom: 8, paddingHorizontal: 16, minHeight: 56 }}>
        <View style={{ flex: 1 }}><Label heading={2} size={18} weight="700">{props.title}</Label></View>
        {props.actions}
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 8, paddingBottom: 12 }}>
        {props.children}
      </ScrollView>
    </View>
  );
}
