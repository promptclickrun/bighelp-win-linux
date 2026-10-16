// The desktop shell for the approved hybrid direction (docs/DECISIONS.md D5, mock D):
// rail -> context list -> page, with the open agent's tabs under the composer.
// Renderer only. Host actions use the finite desktop API; snapshots contain no credentials.
import type { JSX } from 'react';
import { useEffect, useReducer, useRef, useState } from 'react';
import { ScrollView, View, useColorScheme, useWindowDimensions } from 'react-native-web';
import { createShellState, reduceShell, showsAgentTabs, visiblePanes } from '../domain/shell.ts';
import type { Place, SettingsSection } from '../domain/shell.ts';
import { ContextList, PLACE_TITLES } from './components/ContextList.tsx';
import { Conversation } from './components/Conversation.tsx';
import { Label, Notice, PageHead, Tag } from './components/primitives.tsx';
import { Rail } from './components/Rail.tsx';
import { SettingsOverview, SettingsPage } from './components/Settings.tsx';
import { ThemeProvider } from './theme.tsx';
import { LAYOUT, PALETTES, fontStack } from './tokens.ts';
import type { DesktopApi, DesktopSnapshot, DesktopResult } from '../../apps/desktop/src/shared/desktop-api.ts';
import { HostConnection } from './components/HostConnection.tsx';
import { InteractiveRequests } from './components/InteractiveRequests.tsx';
import { EMPTY_DATA } from './view-model.ts';
import type { ViewData } from './view-model.ts';
import { agentById, chatById, composerStatus } from './view-model.ts';

// Full sentences, so nothing reads as "Usage aren't built yet".
const UNBUILT: Readonly<Partial<Record<Place, string>>> = Object.freeze({
  projects: "Projects aren't built yet", kanban: "Kanban isn't built yet", workflows: "Workflow pages aren't built yet",
  scheduled: "Scheduled tasks aren't built yet", usage: "Usage isn't built yet", vault: "The vault isn't built yet",
});

export function App(props: Readonly<{ data: ViewData; platform: string; api?: DesktopApi; snapshot?: DesktopSnapshot; error?: string; act?: (operation: Promise<DesktopResult>) => Promise<boolean> }>): JSX.Element {
  const [state, dispatch] = useReducer(reduceShell, undefined, createShellState);
  const sending = useRef(false);
  const pendingNavigation = useRef<Readonly<{generation: number; requestId: string}> | null>(null);
  const suppressNavigation = useRef(false);
  const leaveChat = () => {
    suppressNavigation.current = true;
    const pending = pendingNavigation.current; pendingNavigation.current = null;
    if (pending && props.api && props.act) void props.act(props.api.cancelNavigation(pending.generation, pending.requestId));
  };
  const [sendPending, setSendPending] = useState(false);
  const dirty = useRef(new Map<string, string>());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const generation = props.snapshot?.generation;
  const currentGeneration = useRef(generation);
  if (currentGeneration.current !== generation) {
    currentGeneration.current = generation; dirty.current.clear();
    for (const timer of timers.current.values()) clearTimeout(timer); timers.current.clear();
  }
  useEffect(() => () => {
    for (const timer of timers.current.values()) clearTimeout(timer);
    const pending = pendingNavigation.current;
    if (pending && props.api) void props.api.cancelNavigation(pending.generation, pending.requestId).catch(() => {});
  }, [props.api]);
  useEffect(() => {
    const id = props.snapshot?.selectedChatId;
    const chat = id ? chatById(props.data, id) : null;
    if (chat && !suppressNavigation.current) dispatch({ type: 'openChat', chatId: chat.id, agentId: chat.agentId });
  }, [props.snapshot?.selectedChatId, generation]);
  const { width } = useWindowDimensions();
  const system = useColorScheme();
  const narrow = width < LAYOUT.narrowBreakpoint;
  useEffect(() => { dispatch({ type: 'layout', layout: narrow ? 'narrow' : 'wide' }); }, [narrow]);

  const theme = state.appearance === 'automatic' ? (system === 'dark' ? 'dark' : 'light') : state.appearance;
  const palette = PALETTES[theme];
  const font = fontStack(props.platform);
  const { data } = props;
  const panes = visiblePanes(state);
  const hint = props.snapshot ? (props.error || props.snapshot.notice || (props.snapshot.canSend ? 'Ready to send.' : 'Waiting for a connected chat.')) : composerStatus(data).hint;
  const back = narrow ? () => { leaveChat(); dispatch({ type: 'back' }); } : undefined;
  const openSection = (section: SettingsSection | null) => dispatch({ type: 'settingsSection', section });

  const api = props.api;
  const snapshot = props.snapshot;
  const act = props.act;
  const persistDraft = (chatId: string, text: string) => {
    if (!api || !snapshot || !act) return;
    return act(api.draft(snapshot.generation, chatId, text));
  };
  let detail: JSX.Element;
  const agentId = state.place === 'chats' ? (chatById(data, state.selectedChatId)?.agentId ?? null) : state.selectedAgentId;
  const agent = agentById(data, agentId);
  if (showsAgentTabs(state) && agent) {
    const chat = state.place === 'chats' ? chatById(data, state.selectedChatId) : null;
    const draftKey = chat?.id ?? `new:${agent.id}`;
    detail = (
      <Conversation agent={agent} chat={chat} host={data.host} tab={state.agentTab} sample={data.sample}
        draft={snapshot ? (dirty.current.get(draftKey) ?? snapshot.drafts[draftKey] ?? '') : state.drafts[draftKey] ?? ''} hint={hint} onBack={back}
        onDraft={text => {
          dispatch({ type: 'draft', chatId: draftKey, text });
          if (snapshot && chat) {
            dirty.current.set(draftKey, text);
            clearTimeout(timers.current.get(draftKey));
            timers.current.set(draftKey, setTimeout(() => { void persistDraft(draftKey, text); }, 300));
          }
        }}
        canSend={!sendPending && !!snapshot?.canSend && snapshot.selectedChatId === chat?.id}
        running={!!snapshot?.running && snapshot.selectedChatId === chat?.id}
        onNewChat={api && snapshot?.status === 'connected' && act ? () => { pendingNavigation.current = null; suppressNavigation.current = false; void act(api.newChat(snapshot.generation, agent.id)); } : undefined}
        onSend={api && snapshot && chat && act ? () => {
          if (sending.current) return;
          const text = dirty.current.get(chat.id) ?? snapshot.drafts[chat.id] ?? '';
          const chatId = chat.id; const expectedGeneration = snapshot.generation;
          clearTimeout(timers.current.get(chatId));
          sending.current = true; setSendPending(true);
          void (async () => {
            try {
            if (!snapshot.canSend || snapshot.selectedChatId !== chatId || !text.trim()) return;
            if (!await persistDraft(chatId, text) || currentGeneration.current !== expectedGeneration) return;
            if (await act(api.send(expectedGeneration, chatId, text)) && currentGeneration.current === expectedGeneration) {
              if (dirty.current.get(chatId) === text) dirty.current.set(chatId, '');
              else { const newer = dirty.current.get(chatId); if (newer !== undefined) void act(api.draft(expectedGeneration, chatId, newer)); }
              dispatch({ type: 'draft', chatId, text: dirty.current.get(chatId) ?? '' });
            }
            } finally { sending.current = false; setSendPending(false); }
          })();
        } : undefined}
        onStop={api && snapshot && chat && act ? () => { void act(api.interrupt(snapshot.generation, chat.id)); } : undefined}
        requests={api && snapshot && act ? <InteractiveRequests key={snapshot.generation} prompts={snapshot.prompts} disabled={snapshot.status !== 'connected'} onAnswer={(id, answer) => { void act(api.answer(snapshot.generation, id, answer)); }} /> : null}
        onTab={tab => dispatch({ type: 'agentTab', tab })} />
    );
  } else if (state.place === 'settings' && state.settingsSection !== null) {
    detail = <SettingsPage section={state.settingsSection} appearance={state.appearance} host={data.host}
      hostContent={api && snapshot && act ? <HostConnection snapshot={snapshot} error={props.error ?? ''} onConnect={host => { void act(api.connect(host)); }} onDisconnect={() => { void act(api.disconnect()); }} onRefresh={() => { void act(api.refresh()); }} /> : undefined}
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
      body={api ? "Open Settings → Hosts to connect to Hermes." : "bighelp works with the Hermes agent on your computer. This preview does not connect."} />;
  } else {
    detail = <Notice title={state.place === 'agents' ? 'Pick an agent' : 'Pick a chat'} body="It opens here." />;
  }

  return (
    <ThemeProvider value={{ theme, palette, font }}>
      <View style={{ flex: 1, flexDirection: 'row', backgroundColor: palette.page, minHeight: 0 }}>
        <Rail place={state.place} host={data.host} onPlace={place => { leaveChat(); dispatch({ type: 'place', place }); }}
          onHost={() => { leaveChat(); dispatch({ type: 'place', place: 'settings' }); openSection('hosts'); }} />
        {panes.list && !(narrow && state.place === 'settings') ? (
          <ContextList place={state.place} data={data} selectedChatId={state.selectedChatId} selectedAgentId={state.selectedAgentId}
            nerdMode={state.nerdMode} settingsSection={state.settingsSection} narrow={narrow}
            onOpenChat={(chatId, owner) => { pendingNavigation.current = null; suppressNavigation.current = false; if (api && snapshot && act) { void act(api.openChat(snapshot.generation, chatId)); } else dispatch({ type: 'openChat', chatId, agentId: owner }); }}
            onOpenAgent={id => {
              suppressNavigation.current = false;
              dispatch({ type: 'openAgent', agentId: id });
              if (api && snapshot?.status === 'connected' && act) {
                const pending = {generation: snapshot.generation, requestId: crypto.randomUUID()}; pendingNavigation.current = pending;
                void act(api.canonicalChat(pending.generation, id, pending.requestId)).finally(() => {
                  if (pendingNavigation.current === pending) pendingNavigation.current = null;
                });
              }
            }} onSettingsSection={openSection} />
        ) : null}
        {panes.detail || (narrow && state.place === 'settings') ? detail : null}
        {props.error ? <View role="status" style={{ position: 'absolute', bottom: 4, left: 80, right: 8, backgroundColor: palette.card, padding: 8 }}><Label>{props.error}</Label></View> : null}
      </View>
    </ThemeProvider>
  );
}

// Only safe display snapshots cross this boundary. Credentials never return here.
export function ConnectedApp(props: Readonly<{ api: DesktopApi; platform: string }>): JSX.Element {
  const [snapshot, setSnapshot] = useState<DesktopSnapshot>();
  const [error, setError] = useState('');
  const latest = useRef(-1);
  const accept = (next: DesktopSnapshot) => { if (next.revision > latest.current) { latest.current = next.revision; setSnapshot(next); } };
  const act = async (operation: Promise<DesktopResult>): Promise<boolean> => {
    try { const result = await operation; if (result.ok) { accept(result.snapshot); setError(''); return true; } setError(result.message); }
    catch { setError('The desktop connection is unavailable.'); }
    return false;
  };
  useEffect(() => {
    let mounted = true;
    const off = props.api.subscribe(next => { if (mounted) accept(next); });
    void props.api.snapshot().then(result => { if (mounted) { if (result.ok) accept(result.snapshot); else setError(result.message); } }).catch(() => { if (mounted) setError('The desktop connection is unavailable.'); });
    return () => { mounted = false; off(); };
  }, [props.api]);
  if (!snapshot) return <div role="status">{error || 'Opening bighelp…'}</div>;
  return <App data={snapshot.data ?? EMPTY_DATA} platform={props.platform} api={props.api} snapshot={snapshot} error={error} act={act} />;
}
