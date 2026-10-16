import type { JSX } from 'react';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native-web';
import type { DesktopApi, DesktopSnapshot } from '../../../apps/desktop/src/shared/desktop-api.ts';
import type { BoardUpdate } from '../../../apps/desktop/src/shared/calls/board.ts';
import type { CallInput, CallName, CallResult } from '../../../apps/desktop/src/shared/calls/index.ts';
import type { WorkspaceBoardItem, WorkspaceTab } from '../../contracts/workspace.ts';
import type { BoardActionId, GoalCategory } from '../board-actions.ts';
import { GOAL_CATEGORIES, LESS_LIKE_THIS, boardActions, boardGroups, categoryChoiceLabel, discussText, dismissWords, goalPrompt, isDone,
  letsDoItText } from '../board-actions.ts';
import type { ViewData } from '../view-model.ts';
import { useTheme } from '../theme.tsx';
import { useWorkspaceLoad } from '../workspace-load.ts';
import { Banner, Button, Dialog } from './controls.tsx';
import { Label, PageHead, hoverFill } from './primitives.tsx';

const TITLES = { feed: 'Feed', ideas: 'Ideas', goals: 'Goals' } as const;
function Fact(props: Readonly<{ label: string; value: string | undefined }>): JSX.Element {
  return <View style={{ gap: 4 }}><Label size={12} tone="muted">{props.label}</Label>
    <Label selectable>{props.value === undefined ? 'Unavailable' : props.value}</Label></View>;
}
type Message = Readonly<{ tone: 'info' | 'warn' | 'error' | 'success'; text: string }>;
type Change = Omit<BoardUpdate, 'profile' | 'itemId'>;
// Local, optimistic changes on top of one loaded board. A new load replaces them.
type Overlay = Readonly<{ source: unknown; items: Readonly<Record<string, WorkspaceBoardItem>>; hidden: readonly string[] }>;
function failure(result: Readonly<{ code: string; message: string }>): Message {
  // A lost reply is "not sure", never failed: the change may have happened.
  return result.code === 'unknown' ? { tone: 'warn', text: 'Not sure this was saved. Refresh to check before trying again.' }
    : { tone: 'error', text: result.message };
}
function withoutReason(item: WorkspaceBoardItem): WorkspaceBoardItem {
  const { reason: _reason, ...rest } = item;
  return rest;
}

// Only the opened, still-present agent may supply the read coordinates. Board
// projections are already validated and filtered in main; no identity is inferred
// from a title, kind, or other display metadata here. Actions are named calls
// that set flags the person chose; chats about an item are prefills via
// onStartChat, which opens the agent's chat and never sends.
export function AgentBoard(props: Readonly<{
  profile: string; page: WorkspaceTab | null; data: ViewData; narrow: boolean;
  api?: DesktopApi | undefined; snapshot?: DesktopSnapshot | undefined;
  onStartChat?: ((message: string) => void) | undefined;
}>): JSX.Element | null {
  const { palette, font } = useTheme();
  const profile = props.data.agents.some(agent => agent.id === props.profile) ? props.profile : null;
  const agentName = props.data.agents.find(agent => agent.id === profile)?.name ?? 'your agent';
  const scope = JSON.stringify([props.snapshot?.generation, profile, props.page]);
  const [query, setQuery] = useState('');
  const [selection, setSelection] = useState<Readonly<{ scope: string; id: string }> | null>(null);
  const [detail, setDetail] = useState(false);
  const [overlayState, setOverlayState] = useState<Overlay>({ source: null, items: {}, hidden: [] });
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const [undo, setUndo] = useState<Readonly<{ item: WorkspaceBoardItem; text: string }> | null>(null);
  const [unsure, setUnsure] = useState<Readonly<{ id: string; title: string }> | null>(null);
  const [tellFailed, setTellFailed] = useState<string | null>(null);
  const [asking, setAsking] = useState<WorkspaceBoardItem | null>(null);
  const [creating, setCreating] = useState(false);
  const load = useWorkspaceLoad({ api: props.api, snapshot: props.snapshot, profile, page: props.page, days: 30 });
  const workspace = load.workspace;
  const board = workspace && (workspace.page === 'feed' || workspace.page === 'ideas' || workspace.page === 'goals')
    && workspace.page === props.page ? workspace.data : null;
  const features = board?.features;
  const overlay: Overlay = overlayState.source === board ? overlayState : { source: board, items: {}, hidden: [] };
  const rows = (board?.items ?? []).filter(row => !overlay.hidden.includes(row.id)).map(row => overlay.items[row.id] ?? row);
  const selected = selection?.scope === scope ? rows.find(row => row.id === selection.id) : undefined;
  // Results of a call apply only to the board and page they started on.
  const current = useRef({ scope, board });
  current.current = { scope, board };
  // Items already marked read (or deliberately unread) on this load.
  const marked = useRef<Readonly<{ board: unknown; ids: Set<string> }>>({ board: null, ids: new Set() });
  if (marked.current.board !== board) marked.current = { board, ids: new Set() };
  const connection = props.snapshot?.connection;
  const canAct = !!profile && !!props.api && props.snapshot?.status === 'connected' && typeof connection === 'number';
  const chat = props.onStartChat;
  useEffect(() => {
    if (selection && (selection.scope !== scope || (load.status === 'loaded' && !selected))) { setSelection(null); setDetail(false); }
  }, [scope, load.status, selected?.id, selection]);
  useEffect(() => {
    setQuery(''); setDetail(false); setMessage(null); setUndo(null); setUnsure(null); setTellFailed(null); setAsking(null); setCreating(false);
  }, [scope]);
  useEffect(() => {
    // Opening an unread item reads it, as on the Mac. A failure is retried after the next load.
    if (!selected || selected.read !== false || !features?.feedback || !canAct || marked.current.ids.has(selected.id)) return;
    marked.current.ids.add(selected.id);
    void markRead(selected);
  }, [selected?.id, selected?.read, features?.feedback, canAct]);
  if (!props.page) return null;
  const page = props.page, title = TITLES[page];

  async function call<K extends CallName>(name: K, input: CallInput<K>): Promise<CallResult<K>> {
    if (!props.api || typeof connection !== 'number') return { ok: false, code: 'stale', message: 'Connect to Hermes first.' };
    try { return await props.api.call(connection, name, input); }
    catch { return { ok: false, code: 'unavailable', message: 'The desktop connection is unavailable.' }; }
  }
  function patch(at: unknown, change: (overlay: Overlay) => Overlay): void {
    setOverlayState(previous => {
      if (current.current.board !== at) return previous;
      return change(previous.source === at ? previous : { source: at, items: {}, hidden: [] });
    });
  }
  const setItem = (at: unknown, item: WorkspaceBoardItem) => patch(at, value => ({ ...value, items: { ...value.items, [item.id]: item } }));
  const setHidden = (at: unknown, id: string, hidden: boolean) => patch(at, value => ({ ...value,
    hidden: hidden ? [...value.hidden.filter(entry => entry !== id), id] : value.hidden.filter(entry => entry !== id) }));
  const fresh = (at: Readonly<{ scope: string; board: unknown }>) => current.current.scope === at.scope && current.current.board === at.board;

  async function markRead(item: WorkspaceBoardItem): Promise<void> {
    if (!profile) return;
    const at = current.current;
    setItem(at.board, { ...item, read: true });
    const result = await call('board.read', { profile, itemIds: [item.id], read: true });
    if (fresh(at) && !result.ok) setItem(at.board, item);
  }
  async function update(item: WorkspaceBoardItem, change: Change, optimistic: WorkspaceBoardItem): Promise<void> {
    if (!canAct || !profile) return;
    const at = current.current;
    setItem(at.board, optimistic); setBusy(item.id); setMessage(null);
    const result = await call('board.update', { profile, itemId: item.id, ...change });
    if (!fresh(at)) return;
    setBusy(null);
    if (result.ok) setItem(at.board, result.value);
    else { setItem(at.board, item); setMessage(failure(result)); }
  }
  async function hide(item: WorkspaceBoardItem): Promise<void> {
    if (!canAct || !profile) return;
    const at = current.current;
    setHidden(at.board, item.id, true); setBusy(item.id); setMessage(null);
    setUndo({ item, text: dismissWords(item.kind).undo(item.title) });
    const result = await call('board.update', { profile, itemId: item.id, dismissed: true });
    if (!fresh(at)) return;
    setBusy(null);
    if (result.ok) { setItem(at.board, result.value); return; }
    setHidden(at.board, item.id, false); setUndo(null); setMessage(failure(result));
  }
  async function restore(): Promise<void> {
    if (!undo || !canAct || !profile) return;
    const { item } = undo, at = current.current;
    setUndo(null); setHidden(at.board, item.id, false); setBusy(item.id); setMessage(null);
    const result = await call('board.update', { profile, itemId: item.id, dismissed: false });
    if (!fresh(at)) return;
    setBusy(null);
    if (result.ok) { setItem(at.board, result.value); return; }
    setHidden(at.board, item.id, true); setMessage(failure(result));
  }
  // Not idempotent: a second call makes a second goal. Never resent; a lost
  // reply is checked against the board before a retry is offered.
  async function promote(item: WorkspaceBoardItem): Promise<void> {
    if (!canAct || !profile) return;
    const at = current.current;
    setHidden(at.board, item.id, true); setBusy(item.id); setMessage(null); setUnsure(null);
    const result = await call('board.promote', { profile, itemId: item.id });
    if (!fresh(at)) return;
    setBusy(null);
    if (result.ok) { setMessage({ tone: 'success', text: `“${item.title}” is now one of your goals. Find it in Goals.` }); return; }
    setHidden(at.board, item.id, false);
    if (result.code === 'unknown') setUnsure({ id: item.id, title: item.title });
    else setMessage(failure(result));
  }
  async function checkPromote(): Promise<void> {
    if (!unsure || !canAct || !profile) return;
    const entry = unsure, at = current.current;
    setBusy(entry.id); setMessage(null);
    const result = await call('board.checkPromote', { profile, itemId: entry.id });
    if (!fresh(at)) return;
    setBusy(null);
    if (!result.ok) { setMessage({ tone: 'error', text: result.message }); return; }
    setUnsure(null);
    if (result.value.state === 'goal') {
      setHidden(at.board, entry.id, true);
      setMessage({ tone: 'success', text: `“${entry.title}” became a goal. Find it in Goals.` });
    } else if (result.value.state === 'idea') setMessage({ tone: 'info', text: `“${entry.title}” did not become a goal. You can try again.` });
    else setMessage({ tone: 'info', text: 'That idea is no longer on the board. Refresh to see the latest.' });
  }
  // Records the yes (board/accept), then opens a chat with the Mac's exact
  // words in the message box. Nothing is sent until the person presses Send.
  async function letsDoIt(item: WorkspaceBoardItem): Promise<void> {
    if (!profile) return;
    const text = letsDoItText(item.title);
    const open = () => { if (chat) chat(text); else setMessage({ tone: 'success', text: `Saved your yes. Start a chat with ${agentName} to get going.` }); };
    if (!features?.answers) { if (chat) chat(text); return; }
    if (!canAct) return;
    const at = current.current;
    setBusy(item.id); setTellFailed(null); setMessage(null);
    const result = await call('board.accept', { profile, itemId: item.id });
    if (!fresh(at)) return;
    setBusy(null);
    if (result.ok) { setItem(at.board, result.value); open(); return; }
    if (result.code === 'unsupported') { if (chat) chat(text); return; }
    setTellFailed(item.id);
    setMessage({ tone: 'error', text: `Couldn’t tell ${agentName} yet. Check the connection and try again.` });
  }
  function perform(item: WorkspaceBoardItem, action: BoardActionId): void {
    if (action === 'thumbsUp') {
      const rating = item.rating === 'up' ? 'none' : 'up';
      void update(item, { rating }, { ...withoutReason(item), rating });
    } else if (action === 'thumbsDown') {
      if (item.rating === 'down') { void update(item, { rating: 'none' }, { ...withoutReason(item), rating: 'none' }); return; }
      // Sent at once without a reason; a picked reason is sent again with it.
      void update(item, { rating: 'down' }, { ...withoutReason(item), rating: 'down' });
      setAsking(item);
    } else if (action === 'discuss') chat?.(discussText(item));
    else if (action === 'letsDoIt') void letsDoIt(item);
    else if (action === 'promote') void promote(item);
    else if (action === 'done') {
      const status = isDone(item) ? 'active' : 'done';
      void update(item, { status }, { ...item, status });
    } else if (action === 'read') {
      marked.current.ids.add(item.id);
      void update(item, { read: !item.read }, { ...item, read: !item.read });
    } else if (action === 'copy') {
      const text = item.body ? `${item.title}\n\n${item.body}` : item.title;
      void props.api?.copyText(text).then(copied => { if (fresh(current.current)) setMessage(copied ? { tone: 'info', text: 'Copied.' } : { tone: 'error', text: 'Could not copy.' }); });
    } else void hide(item);
  }

  let empty: string | null = null;
  if (!profile) empty = 'This agent is no longer available. Choose an agent from the list.';
  else if (load.status === 'unavailable') empty = props.snapshot?.status !== 'connected' || !props.api
    ? 'This page is unavailable. Connect to Hermes, then refresh.' : 'This page is unavailable. Refresh to try again.';
  else if (load.status === 'loading') empty = `Loading ${page}…`;
  else if (load.status === 'unsupported') empty = 'This computer does not support this page. A host update may be needed.';
  else if (rows.length === 0) empty = `No ${page} items supplied.`;
  const needle = query.trim().toLocaleLowerCase();
  const filtered = rows.filter(row => [row.title, row.body, row.note, row.category, row.status, row.createdAt, row.updatedAt,
    row.section, row.source, row.reason, row.read === undefined ? '' : row.read ? 'Read' : 'Unread'].join(' ').toLocaleLowerCase().includes(needle));
  const showingDetail = props.narrow && detail;
  const actions = selected ? boardActions(selected, features, !!chat, tellFailed === selected.id) : [];
  const createGoal = page === 'goals' && chat && profile ? () => {
    if (features?.goalCategories) setCreating(true); else chat(goalPrompt('other'));
  } : undefined;
  return <View role="region" aria-label={`${title} board`} style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
    <PageHead title={title} onBack={showingDetail ? () => setDetail(false) : undefined} backLabel={`Back to ${page} list`}>
      {createGoal ? <Button compact label="Create a goal" onPress={createGoal} accessibleLabel="Create a goal. Opens a chat; nothing is sent until you press Send." /> : null}
      <Pressable role="button" aria-label={`Refresh ${page}`} disabled={!profile || !props.api || props.snapshot?.status !== 'connected'}
        onPress={load.refresh} style={{ padding: 6 }}><Label tone="action" size={13}>Refresh</Label></Pressable>
    </PageHead>
    {message || undo || unsure ? <View style={{ paddingHorizontal: 12, paddingTop: 10, gap: 8 }}>
      {unsure ? <Banner tone="warn" title="Not sure this became a goal" text={`The connection dropped before Hermes confirmed “${unsure.title}”. Check before trying again, so it isn't added twice.`}>
        <Button compact label={busy === unsure.id ? 'Checking…' : 'Check Goals'} disabled={busy === unsure.id || !canAct} onPress={() => { void checkPromote(); }} />
      </Banner> : null}
      {undo ? <Banner tone="info" text={undo.text}>
        <Button compact label="Undo" disabled={busy === undo.item.id || !canAct} onPress={() => { void restore(); }} />
        <Button compact tone="quiet" label="Close" accessibleLabel="Close this note" onPress={() => setUndo(null)} />
      </Banner> : null}
      {message ? <Banner tone={message.tone} text={message.text}>
        <Button compact tone="quiet" label="Close" accessibleLabel="Close this note" onPress={() => setMessage(null)} />
      </Banner> : null}
    </View> : null}
    <View style={{ flex: 1, minHeight: 0, flexDirection: 'row' }}>
      {!showingDetail ? <View style={{ flex: props.narrow ? 1 : 0.8, minWidth: 0, borderRightWidth: props.narrow ? 0 : 1, borderRightColor: palette.line }}>
        <TextInput aria-label={`Search ${page}`} placeholder={`Search ${page}`} value={query} onChangeText={setQuery} maxLength={256}
          placeholderTextColor={palette.muted} style={{ margin: 12, padding: 10, borderRadius: 10, backgroundColor: palette.incoming, color: palette.ink, fontFamily: font }} />
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 12, paddingTop: 0, gap: 6 }}>
          {empty ? <View role="status"><Label selectable tone="muted">{empty}</Label></View> :
            <View role="list">{filtered.length === 0 ? <Label tone="muted">No matching items.</Label> : boardGroups(filtered, features).map(group =>
              <View key={group.title ?? 'all'} style={{ gap: 2 }}>
                {group.title ? <Label heading={3} size={12} weight="700" tone="muted" style={{ paddingHorizontal: 10, paddingTop: 8 }}>{group.title}</Label> : null}
                {group.items.map(row => {
                  const unread = !!features?.feedback && row.read === false;
                  const line = row.kind === 'goal' && row.status !== undefined ? (isDone(row) ? 'Done' : row.status === 'active' ? 'Active' : row.status)
                    : row.status;
                  return <Pressable key={row.id} role="button" aria-label={unread ? `${row.title} (unread)` : row.title} aria-current={selected?.id === row.id ? 'true' : false}
                    onPress={() => { setSelection({ scope, id: row.id }); setDetail(true); }}
                    style={({ hovered }) => [{ padding: 10, borderRadius: 10, gap: 4 }, hoverFill(palette, hovered, selected?.id === row.id)]}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      {unread ? <View aria-hidden={true} style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: palette.action }} /> : null}
                      <Label selectable weight={unread ? '700' : '600'}>{row.title}</Label>
                    </View>
                    {line ? <Label selectable size={12} tone="muted">{line}</Label> : null}
                  </Pressable>;
                })}
              </View>)}</View>}
        </ScrollView>
      </View> : null}
      {!props.narrow || showingDetail ? <ScrollView style={{ flex: 1, minWidth: 0 }} contentContainerStyle={{ padding: 24, gap: 20 }}>
        {empty ? <View role="status"><Label selectable tone="muted">{empty}</Label></View> : selected ? <>
          <Label selectable heading={3} size={20} weight="700">{selected.title}</Label>
          {actions.length && canAct ? <View role="group" aria-label={`Actions for ${selected.title}`} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {actions.map(action => <Button key={action.id} compact label={action.label} tone={action.tone}
              disabled={busy === selected.id || (action.id === 'promote' && unsure?.id === selected.id)}
              onPress={() => perform(selected, action.id)} />)}
          </View> : null}
          {busy === selected.id ? <View role="status"><Label size={13} tone="muted">Saving…</Label></View> : null}
          {selected.rating === 'down' && selected.reason ? <Label selectable size={13} tone="muted">You said: {selected.reason}</Label> : null}
          <Fact label="Body" value={selected.body} /><Fact label="Note" value={selected.note} />
          <Fact label="Category" value={selected.category} /><Fact label="Status" value={selected.status} />
          <Fact label="Created" value={selected.createdAt} /><Fact label="Updated" value={selected.updatedAt} />
          <Fact label="Read" value={selected.read === undefined ? undefined : selected.read ? 'Read' : 'Unread'} />
          {selected.source ? <Fact label="From" value={selected.source} /> : null}
          {selected.links?.length ? <View style={{ gap: 6 }}><Label size={12} tone="muted">Links</Label>
            {selected.links.map(link => <Button key={link.url} compact tone="quiet" label={link.title ?? link.url}
              accessibleLabel={`Open ${link.title ?? link.url} in your browser`} disabled={!props.api}
              onPress={() => { void props.api?.openLink(link.url); }} />)}
          </View> : null}
        </> : <Label tone="muted">Pick an item to see its details.</Label>}
      </ScrollView> : null}
    </View>
    {asking ? <Dialog open title="Less like this?" onClose={() => setAsking(null)}
      actions={<Button label="Skip" onPress={() => setAsking(null)} />}>
      <Label>Optional. It helps {agentName} post things you want.</Label>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {LESS_LIKE_THIS.map(reason => <Button key={reason} label={reason} onPress={() => {
          const item = asking; setAsking(null);
          void update(item, { rating: 'down', reason }, { ...item, rating: 'down', reason });
        }} />)}
      </View>
    </Dialog> : null}
    {creating && chat ? <Dialog open title="Create a goal" onClose={() => setCreating(false)}
      actions={<Button label="Cancel" onPress={() => setCreating(false)} />}>
      <Label>Pick what it's about. bighelp opens a chat with {agentName} with a first message written for you. Nothing is sent until you press Send.</Label>
      <View style={{ gap: 8 }}>
        {GOAL_CATEGORIES.map(([id]) => <Button key={id} label={categoryChoiceLabel(id as GoalCategory)} onPress={() => { setCreating(false); chat(goalPrompt(id)); }} />)}
      </View>
    </Dialog> : null}
  </View>;
}
