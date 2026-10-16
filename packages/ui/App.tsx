// The desktop shell for the approved hybrid direction (docs/DECISIONS.md D5, mock D):
// rail -> context list -> page, with the open agent's tabs under the composer.
// Renderer only. Host actions use the finite desktop API; snapshots contain no credentials.
import type { JSX } from 'react';
import { useEffect, useReducer, useRef, useState } from 'react';
import { ScrollView, View, useColorScheme, useWindowDimensions } from 'react-native-web';
import { createShellState, reduceShell, showsAgentTabs, visiblePanes } from '../domain/shell.ts';
import type { Place, SettingsSection } from '../domain/shell.ts';
import { ContextList, PLACE_TITLES } from './components/ContextList.tsx';
import { AddAgentButton, AgentManager, AgentMenu } from './components/AgentManager.tsx';
import { AgentBoard } from './components/AgentBoard.tsx';
import { Conversation } from './components/Conversation.tsx';
import { PendingAttachments } from './components/PendingAttachments.tsx';
import { ModelButton } from './components/ModelButton.tsx';
import { Label, Notice, PageHead, Tag } from './components/primitives.tsx';
import { Button } from './components/controls.tsx';
import { Rail } from './components/Rail.tsx';
import { SettingsOverview } from './components/Settings.tsx';
import { SettingsPage } from './components/SettingsPage.tsx';
import { ThemeProvider } from './theme.tsx';
import { LAYOUT, PALETTES, fontStack } from './tokens.ts';
import type { DesktopApi, DesktopSnapshot, DesktopResult } from '../../apps/desktop/src/shared/desktop-api.ts';
import type { ShellInfo } from '../../apps/desktop/src/shared/shell-info.ts';
import { HostConnection } from './components/HostConnection.tsx';
import { WorkspaceFunctionPage } from './components/WorkspaceFunctionPage.tsx';
import { InteractiveRequests } from './components/InteractiveRequests.tsx';
import { KanbanPage } from './components/KanbanPage.tsx';
import { EMPTY_DATA } from './view-model.ts';
import { HostProvider } from './host.tsx';
import type { ViewData } from './view-model.ts';
import { agentById, chatById, composerStatus } from './view-model.ts';
import type { AppCommand } from '../../apps/desktop/src/shared/links.ts';
import { CHAT_SEARCH_ID, COMPOSER_ID } from './ids.ts';

// Full sentences, so nothing reads as "Usage aren't built yet".
const UNBUILT: Readonly<Partial<Record<Place, string>>> = Object.freeze({
  workflows: "Workflow pages aren't built yet",
  vault: "The vault isn't built yet",
});

export function App(props: Readonly<{ data: ViewData; platform: string; api?: DesktopApi; snapshot?: DesktopSnapshot; error?: string; act?: (operation: Promise<DesktopResult>) => Promise<boolean>; shell?: ShellInfo | undefined }>): JSX.Element {
  const [state, dispatch] = useReducer(reduceShell, undefined, createShellState);
  const sending = useRef(false);
  const pendingNavigation = useRef<Readonly<{generation: number; requestId: string}> | null>(null);
  const suppressNavigation = useRef(false);
  const navigationSequence = useRef(0);
  const mounted = useRef(true);
  const leaveChat = () => {
    suppressNavigation.current = true;
    ++navigationSequence.current;
    void flushDrafts();
    const pending = pendingNavigation.current; pendingNavigation.current = null;
    if (pending && props.api && props.act) void props.act(props.api.cancelNavigation(pending.generation, pending.requestId));
  };
  const [sendPending, setSendPending] = useState(false);
  const dirty = useRef(new Map<string, string>());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const flushing = useRef<Readonly<{ generation: number; promise: Promise<boolean> }> | null>(null);
  const generation = props.snapshot?.generation;
  const currentGeneration = useRef(generation);
  if (currentGeneration.current !== generation) {
    currentGeneration.current = generation; dirty.current.clear();
    for (const timer of timers.current.values()) clearTimeout(timer); timers.current.clear();
  }
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false; ++navigationSequence.current;
      for (const timer of timers.current.values()) clearTimeout(timer);
      const pending = pendingNavigation.current;
      if (pending && props.api) void props.api.cancelNavigation(pending.generation, pending.requestId).catch(() => {});
    };
  }, [props.api]);
  useEffect(() => {
    const id = props.snapshot?.selectedChatId;
    const chat = id ? chatById(props.data, id) : null;
    if (chat && !suppressNavigation.current) dispatch({ type: 'openChat', chatId: chat.id, agentId: chat.agentId });
  }, [props.snapshot?.selectedChatId, generation]);
  // Application menu shortcuts (Ctrl+N, Ctrl+K, Ctrl+, and Ctrl+L).
  const commandTarget = useRef<(command: AppCommand) => void>(() => {});
  useEffect(() => typeof props.api?.onCommand === 'function' ? props.api.onCommand(command => commandTarget.current(command)) : undefined, [props.api]);
  const { width } = useWindowDimensions();
  const system = useColorScheme();
  const narrow = width < LAYOUT.narrowBreakpoint;
  useEffect(() => { dispatch({ type: 'layout', layout: narrow ? 'narrow' : 'wide' }); }, [narrow]);

  // Connected builds keep these choices in main; the sample preview keeps them in memory.
  const appearance = props.snapshot?.preferences?.appearance ?? state.appearance;
  const nerdMode = props.snapshot?.preferences?.nerdMode ?? state.nerdMode;
  const theme = appearance === 'automatic' ? (system === 'dark' ? 'dark' : 'light') : appearance;
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
    if (!api || !snapshot || !act || snapshot.status !== 'connected' || snapshot.selectedChatId !== chatId) return;
    let acknowledgedGeneration = false;
    return act(api.draft(snapshot.generation, chatId, text).then(result => {
      acknowledgedGeneration = result.ok && result.snapshot.generation === snapshot.generation;
      return result;
    })).then(saved => saved && acknowledgedGeneration);
  };
  // Only the original generation may save this buffer. Main captures the full
  // host/principal/profile/session scope before its protected write is queued.
  const flushDrafts = (): Promise<boolean> => {
    if (!snapshot || !api || !act || dirty.current.size === 0) return Promise.resolve(true);
    const expected = snapshot.generation;
    if (flushing.current?.generation === expected) return flushing.current.promise;
    const current = () => mounted.current && currentGeneration.current === expected;
    const promise = (async () => {
      try {
        while (current() && dirty.current.size) {
          const [chatId, text] = dirty.current.entries().next().value!;
          clearTimeout(timers.current.get(chatId)); timers.current.delete(chatId);
          if (!await persistDraft(chatId, text) || !current()) return false;
          // Typing during a held write stays dirty and is saved before leaving.
          if (dirty.current.get(chatId) === text) dirty.current.delete(chatId);
        }
        return current();
      } catch { return false; }
    })();
    const pending = { generation: expected, promise }; flushing.current = pending;
    void promise.finally(() => { if (flushing.current === pending) flushing.current = null; });
    return promise;
  };
  const navigate = (perform: () => void) => {
    const request = ++navigationSequence.current, expected = generation;
    void flushDrafts().then(saved => {
      if (saved && mounted.current && navigationSequence.current === request && currentGeneration.current === expected) perform();
    });
  };
  let detail: JSX.Element;
  const agentId = state.place === 'chats' ? (chatById(data, state.selectedChatId)?.agentId ?? null) : state.selectedAgentId;
  const agent = agentById(data, agentId);
  commandTarget.current = command => {
    if (command === 'focusComposer') { document.getElementById(COMPOSER_ID)?.focus(); return; }
    if (command === 'settings') { leaveChat(); dispatch({ type: 'place', place: 'settings' }); return; }
    if (command === 'search') {
      leaveChat(); dispatch({ type: 'place', place: 'chats' });
      setTimeout(() => document.getElementById(CHAT_SEARCH_ID)?.focus(), 0); return;
    }
    const target = agent ?? data.agents[0];
    if (target && api && snapshot?.status === 'connected' && act) {
      navigate(() => { pendingNavigation.current = null; suppressNavigation.current = false; void act(api.newChat(snapshot.generation, target.id)); });
    }
  };
  if (showsAgentTabs(state) && agent) {
    const chat = state.place === 'chats' ? chatById(data, state.selectedChatId) : null;
    const draftKey = chat?.id ?? `new:${agent.id}`;
    detail = (
      <Conversation agent={agent} chat={chat} host={data.host} tab={state.agentTab} sample={data.sample}
        options={snapshot?.preferences ? { showReasoning: snapshot.preferences.showReasoning, foldFinishedTurns: snapshot.preferences.foldFinishedTurns,
          enterToSend: snapshot.preferences.enterToSend, busyMode: snapshot.preferences.busyMode, nerdMode } : undefined}
        turn={snapshot?.turn && snapshot.selectedChatId === chat?.id ? snapshot.turn : undefined} liveTurn={snapshot?.turn?.key ?? null}
        actions={api ? { openLink: url => { void api.openLink(url); }, copy: text => api.copyText(text) } : {}}
        onCheckHistory={api && snapshot && chat && act ? () => { void act(api.openChat(snapshot.generation, chat.id)); } : undefined}
        headerActions={api && snapshot && chat && snapshot.status === 'connected' && snapshot.selectedChatId === chat.id
          ? <ModelButton chatId={chat.id} running={snapshot.running} current={snapshot.turn?.model ?? null} /> : null}
        onAttach={api && snapshot && chat && act && snapshot.status === 'connected' && snapshot.selectedChatId === chat.id
          ? () => { void act(api.attach(snapshot.generation, chat.id)); } : undefined}
        onDropFiles={api && snapshot && chat && act && snapshot.status === 'connected' && snapshot.selectedChatId === chat.id
          ? files => { void act(api.attachDropped(snapshot.generation, chat.id, files)); } : undefined}
        attachments={snapshot?.attachments?.length && chat && snapshot.selectedChatId === chat.id ? <PendingAttachments files={snapshot.attachments}
          onRemove={api && act ? id => { void act(api.detach(snapshot.generation, chat.id, id)); } : undefined} /> : null}
        board={state.agentTab === 'feed' || state.agentTab === 'ideas' || state.agentTab === 'goals' ?
          <AgentBoard key={`${generation}:${agent.id}:${state.agentTab}`} profile={agent.id} page={state.agentTab} data={data} api={api} snapshot={snapshot} narrow={narrow} /> : null}
        draft={snapshot ? (dirty.current.get(draftKey) ?? snapshot.drafts[draftKey] ?? '') : state.drafts[draftKey] ?? ''} hint={hint} onBack={back}
        onDraft={text => {
          if (snapshot && (snapshot.status !== 'connected' || snapshot.selectedChatId !== chat?.id)) return;
          dispatch({ type: 'draft', chatId: draftKey, text });
          if (snapshot && chat) {
            dirty.current.set(draftKey, text);
            clearTimeout(timers.current.get(draftKey));
            timers.current.set(draftKey, setTimeout(() => { void flushDrafts(); }, 300));
          }
        }}
        editable={!snapshot || (snapshot.status === 'connected' && snapshot.selectedChatId === chat?.id)}
        canSend={!sendPending && !!snapshot?.canSend && snapshot.selectedChatId === chat?.id}
        running={!!snapshot?.running && snapshot.selectedChatId === chat?.id}
        onNewChat={api && snapshot?.status === 'connected' && act ? () => navigate(() => { pendingNavigation.current = null; suppressNavigation.current = false; void act(api.newChat(snapshot.generation, agent.id)); }) : undefined}
        onSend={api && snapshot && chat && act ? () => {
          if (sending.current) return;
          const text = dirty.current.get(chat.id) ?? snapshot.drafts[chat.id] ?? '';
          const chatId = chat.id; const expectedGeneration = snapshot.generation;
          clearTimeout(timers.current.get(chatId));
          sending.current = true; setSendPending(true);
          void (async () => {
            try {
            if (!snapshot.canSend || snapshot.selectedChatId !== chatId || (!text.trim() && !snapshot.attachments?.length)) return;
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
        requests={api && snapshot && act ? <InteractiveRequests key={snapshot.generation} prompts={snapshot.prompts} agentName={agent.name} disabled={snapshot.status !== 'connected'} onAnswer={(id, answer) => { void act(api.answer(snapshot.generation, id, answer)); }} /> : null}
        agentMenu={<AgentMenu agent={agent} />}
        onTab={tab => {
          if (tab !== 'chat') leaveChat();
          else suppressNavigation.current = false;
          dispatch({ type: 'agentTab', tab });
        }} />
    );
  } else if (state.place === 'settings' && state.settingsSection !== null) {
    detail = <SettingsPage section={state.settingsSection} appearance={appearance} host={data.host} shell={props.shell}
      desktop={api && snapshot && act ? { api, snapshot, act } : undefined}
      hostContent={api && snapshot && act ? <HostConnection snapshot={snapshot} error={props.error ?? ''} onConnect={host => navigate(() => { void act(api.connect(host)); })} onDisconnect={() => navigate(() => { void act(api.disconnect()); })} onRefresh={() => { void act(api.refresh()); }} /> : undefined}
      onAppearance={value => { dispatch({ type: 'appearance', value }); if (api && act) void act(api.preferences({ appearance: value })); }} onBack={() => openSection(null)} />;
  } else if (state.place === 'settings') {
    detail = (
      <View style={{ flex: 1, minWidth: 0 }}>
        <PageHead title="Settings" />
        <ScrollView style={{ flex: 1 }}>
          <SettingsOverview nerdMode={nerdMode} onOpen={openSection}
            onNerdMode={on => { dispatch({ type: 'nerdMode', on }); if (api && act) void act(api.preferences({ nerdMode: on })); }} />
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
    detail = <Notice mark title={snapshot?.status === 'connecting' ? 'Connecting…' : 'Welcome to bighelp'}
      body={api ? 'bighelp is a window onto the Hermes agent running on your computer or another computer you use. Connect to start chatting.'
        : 'bighelp works with the Hermes agent on your computer. This preview does not connect.'}
      action={api && snapshot?.status !== 'connecting' ? <Button label="Connect to Hermes" tone="primary" onPress={() => {
        leaveChat(); dispatch({ type: 'place', place: 'settings' }); openSection('hosts');
      }} /> : undefined} />;
  } else {
    const first = data.agents[0];
    detail = <Notice title={state.place === 'agents' ? 'Pick an agent' : 'Pick a chat'}
      body={state.place === 'agents' ? 'Its chat opens here.' : data.chats.length ? 'It opens here, or start a new one.' : 'Start your first chat.'}
      action={state.place === 'chats' && first && api && snapshot?.status === 'connected' && act ? <Button label={`New chat with ${first.name}`} tone="primary"
        onPress={() => navigate(() => { pendingNavigation.current = null; suppressNavigation.current = false; void act(api.newChat(snapshot.generation, first.id)); })} /> : undefined} />;
  }

  const functionPage = state.place === 'projects' || state.place === 'scheduled' || state.place === 'usage' ? state.place : null;
  const ownPage = functionPage !== null || state.place === 'kanban';
  // Delete refuses while this agent is replying in the open chat.
  const replyingAgentId = snapshot?.running && snapshot.selectedChatId ? chatById(data, snapshot.selectedChatId)?.agentId ?? null : null;
  return (
    <ThemeProvider value={{ theme, palette, font }}>
      <AgentManager agents={data.agents}
        nerdMode={nerdMode} replyingAgentId={replyingAgentId}
        onDeleted={id => { if (narrow && state.selectedAgentId === id) dispatch({ type: 'back' }); }}>
      <View style={{ flex: 1, flexDirection: 'row', backgroundColor: palette.page, minHeight: 0 }}>
        <Rail place={state.place} host={data.host} onPlace={place => { leaveChat(); dispatch({ type: 'place', place }); }}
          onHost={() => { leaveChat(); dispatch({ type: 'place', place: 'settings' }); openSection('hosts'); }} />
        {functionPage ? <WorkspaceFunctionPage key={functionPage} page={functionPage} data={data} api={api} snapshot={snapshot}
          narrow={narrow} panes={panes} onOpenDetail={() => dispatch({ type: 'functionDetail' })} onBack={back} /> : null}
        {state.place === 'kanban' ? <KanbanPage key={`kanban:${snapshot?.connection ?? 'none'}`} host={api && snapshot && act ? { api, snapshot, act } : null}
          data={data} narrow={narrow} panes={panes} onOpenDetail={() => dispatch({ type: 'functionDetail' })} onBack={back} /> : null}
        {!ownPage && panes.list && !(narrow && state.place === 'settings') ? (
          <ContextList place={state.place} data={data} selectedChatId={state.selectedChatId} selectedAgentId={state.selectedAgentId}
            nerdMode={nerdMode} settingsSection={state.settingsSection} narrow={narrow}
            addAgent={<AddAgentButton />} agentMenu={agent => <AgentMenu agent={agent} />}
            onOpenChat={(chatId, owner) => navigate(() => { pendingNavigation.current = null; suppressNavigation.current = false; if (api && snapshot && act) { void act(api.openChat(snapshot.generation, chatId)); } else dispatch({ type: 'openChat', chatId, agentId: owner }); })}
            onOpenAgent={id => navigate(() => {
              suppressNavigation.current = false;
              dispatch({ type: 'openAgent', agentId: id });
              if (api && snapshot?.status === 'connected' && act) {
                const pending = {generation: snapshot.generation, requestId: crypto.randomUUID()}; pendingNavigation.current = pending;
                void act(api.canonicalChat(pending.generation, id, pending.requestId)).finally(() => {
                  if (pendingNavigation.current === pending) pendingNavigation.current = null;
                });
              }
            })} onSettingsSection={openSection} />
        ) : null}
        {!ownPage && (panes.detail || (narrow && state.place === 'settings')) ? detail : null}
        {props.error ? <View role="status" style={{ position: 'absolute', bottom: 4, left: 80, right: 8, backgroundColor: palette.card, padding: 8 }}><Label>{props.error}</Label></View> : null}
      </View>
      </AgentManager>
    </ThemeProvider>
  );
}

// Only safe display snapshots cross this boundary. Credentials never return here.
export function ConnectedApp(props: Readonly<{ api: DesktopApi; platform: string; shell?: ShellInfo | undefined }>): JSX.Element {
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
  return <HostProvider value={{ api: props.api, snapshot, act }}>
    <App data={snapshot.data ?? EMPTY_DATA} platform={props.platform} api={props.api} snapshot={snapshot} error={error} act={act} shell={props.shell} />
  </HostProvider>;
}
