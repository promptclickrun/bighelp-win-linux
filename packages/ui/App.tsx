// The desktop shell for the approved hybrid direction (docs/DECISIONS.md D5, mock D):
// rail -> context list -> page, with the open agent's tabs under the composer.
// Renderer only. It holds view state and drafts; it cannot reach a host, a file,
// a credential or the network (CSP connect-src 'none', no IPC exposed).
import type { JSX } from 'react';
import { useEffect, useReducer } from 'react';
import { ScrollView, View, useColorScheme, useWindowDimensions } from 'react-native-web';
import { createShellState, reduceShell, showsAgentTabs, visiblePanes } from '../domain/shell.ts';
import type { Place, SettingsSection } from '../domain/shell.ts';
import { ContextList, PLACE_TITLES } from './components/ContextList.tsx';
import { Conversation } from './components/Conversation.tsx';
import { Notice, PageHead, Tag } from './components/primitives.tsx';
import { Rail } from './components/Rail.tsx';
import { SettingsOverview, SettingsPage } from './components/Settings.tsx';
import { ThemeProvider } from './theme.tsx';
import { LAYOUT, PALETTES, fontStack } from './tokens.ts';
import type { ViewData } from './view-model.ts';
import { agentById, chatById, composerStatus } from './view-model.ts';

// Full sentences, so nothing reads as "Usage aren't built yet".
const UNBUILT: Readonly<Partial<Record<Place, string>>> = Object.freeze({
  projects: "Projects aren't built yet", kanban: "Kanban isn't built yet", workflows: "Workflow pages aren't built yet",
  scheduled: "Scheduled tasks aren't built yet", usage: "Usage isn't built yet", vault: "The vault isn't built yet",
});

export function App(props: Readonly<{ data: ViewData; platform: string }>): JSX.Element {
  const [state, dispatch] = useReducer(reduceShell, undefined, createShellState);
  const { width } = useWindowDimensions();
  const system = useColorScheme();
  const narrow = width < LAYOUT.narrowBreakpoint;
  useEffect(() => { dispatch({ type: 'layout', layout: narrow ? 'narrow' : 'wide' }); }, [narrow]);

  const theme = state.appearance === 'automatic' ? (system === 'dark' ? 'dark' : 'light') : state.appearance;
  const palette = PALETTES[theme];
  const font = fontStack(props.platform);
  const { data } = props;
  const panes = visiblePanes(state);
  const hint = composerStatus(data).hint;
  const back = narrow ? () => dispatch({ type: 'back' }) : undefined;
  const openSection = (section: SettingsSection | null) => dispatch({ type: 'settingsSection', section });

  let detail: JSX.Element;
  const agentId = state.place === 'chats' ? (chatById(data, state.selectedChatId)?.agentId ?? null) : state.selectedAgentId;
  const agent = agentById(data, agentId);
  if (showsAgentTabs(state) && agent) {
    const chat = state.place === 'chats' ? chatById(data, state.selectedChatId) : null;
    const draftKey = chat?.id ?? `new:${agent.id}`;
    detail = (
      <Conversation agent={agent} chat={chat} host={data.host} tab={state.agentTab} sample={data.sample}
        draft={state.drafts[draftKey] ?? ''} hint={hint} onBack={back}
        onDraft={text => dispatch({ type: 'draft', chatId: draftKey, text })}
        onTab={tab => dispatch({ type: 'agentTab', tab })} />
    );
  } else if (state.place === 'settings' && state.settingsSection !== null) {
    detail = <SettingsPage section={state.settingsSection} appearance={state.appearance} host={data.host}
      onAppearance={value => dispatch({ type: 'appearance', value })} onBack={() => openSection(null)} />;
  } else if (state.place === 'settings') {
    detail = (
      <View style={{ flex: 1, minWidth: 0 }}>
        <PageHead title="Settings" />
        <ScrollView style={{ flex: 1 }}>
          <SettingsOverview nerdMode={state.nerdMode} onOpen={openSection}
            onNerdMode={on => dispatch({ type: 'nerdMode', on })} />
        </ScrollView>
      </View>
    );
  } else if (UNBUILT[state.place]) {
    detail = (
      <View style={{ flex: 1, minWidth: 0 }}>
        <PageHead title={PLACE_TITLES[state.place]} onBack={back}>{data.sample ? <Tag>Static placeholder</Tag> : null}</PageHead>
        <Notice title={UNBUILT[state.place] ?? ''} body="This desktop build is the app shell. Each page arrives in its own reviewed step." />
      </View>
    );
  } else if (!data.host) {
    detail = <Notice mark title="No computer connected yet"
      body="bighelp works with the Hermes agent on your computer. Adding a computer isn't built yet. Nothing here talks to one." />;
  } else {
    detail = <Notice title={state.place === 'agents' ? 'Pick an agent' : 'Pick a chat'} body="It opens here." />;
  }

  return (
    <ThemeProvider value={{ theme, palette, font }}>
      <View style={{ flex: 1, flexDirection: 'row', backgroundColor: palette.page, minHeight: 0 }}>
        <Rail place={state.place} host={data.host} onPlace={place => dispatch({ type: 'place', place })}
          onHost={() => { dispatch({ type: 'place', place: 'settings' }); openSection('hosts'); }} />
        {panes.list && !(narrow && state.place === 'settings') ? (
          <ContextList place={state.place} data={data} selectedChatId={state.selectedChatId} selectedAgentId={state.selectedAgentId}
            nerdMode={state.nerdMode} settingsSection={state.settingsSection} narrow={narrow}
            onOpenChat={(chatId, owner) => dispatch({ type: 'openChat', chatId, agentId: owner })}
            onOpenAgent={id => dispatch({ type: 'openAgent', agentId: id })} onSettingsSection={openSection} />
        ) : null}
        {panes.detail || (narrow && state.place === 'settings') ? detail : null}
      </View>
    </ThemeProvider>
  );
}
