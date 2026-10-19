// The Kanban place: lanes in the context column, the open task on the right
// (the approved list/detail pattern). Boards are host-wide. Nothing here starts
// an agent without the person confirming a note that says it uses AI credits.
import type { JSX, ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native-web';
import type { KanbanCard, KanbanStatus } from '../../contracts/kanban.ts';
import { isKanbanAssignee } from '../../contracts/kanban.ts';
import type { KanbanGate, KanbanLane, KanbanMove, PendingMove } from '../../domain/kanban.ts';
import {
  KANBAN_LANES, LANE_TEXT, assignAllowed, assignSpends, cardNote, deleteAllowed, deleteBody, eventLabel, finishMove, laneCounts,
  laneOf, moveGate, moveLabel, moveStatus, moveTargets, primaryMove, runLabel, startMove,
} from '../../domain/kanban.ts';
import type { KanbanBoardLoad } from '../../../apps/desktop/src/shared/calls/kanban.ts';
import type { HostValue } from '../host.tsx';
import { HostProvider, useCall, useHost, useQuery } from '../host.tsx';
import { useTheme } from '../theme.tsx';
import type { ViewData } from '../view-model.ts';
import { ContextColumn } from './ContextList.tsx';
import { Banner, Button, ConfirmDialog, Dialog, MenuButton, SelectField, TextField } from './controls.tsx';
import type { BannerTone, MenuItem, Option } from './controls.tsx';
import { Markdown } from './Markdown.tsx';
import { IconButton, Label, PageHead, hoverFill } from './primitives.tsx';

const ANYONE = '';
type Notice = Readonly<{ tone: BannerTone; text: string }>;
type Draft = Readonly<{ key: string; title: string; body: string; assignee: string; error: string }>;
type Gate = Readonly<{ card: KanbanCard; move: KanbanMove; gate: KanbanGate; note: string; error: string }>;

function when(seconds: number | undefined): string {
  return seconds === undefined ? '' : new Date(seconds * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
function Section(props: Readonly<{ title: string; children: ReactNode }>): JSX.Element {
  return <View style={{ gap: 8 }}><Label heading={3} size={14} weight="700">{props.title}</Label>{props.children}</View>;
}

type PageProps = Readonly<{
  data: ViewData; narrow: boolean; panes: Readonly<{ list: boolean; detail: boolean }>;
  onOpenDetail: () => void; onBack?: (() => void) | undefined;
}>;

// App keys this by host connection, so a host switch drops every selection and read.
export function KanbanPage(props: PageProps & Readonly<{ host: HostValue | null }>): JSX.Element {
  const { host, ...rest } = props;
  return <HostProvider value={host}><KanbanBoard {...rest} /></HostProvider>;
}

function KanbanBoard(props: PageProps): JSX.Element {
  const { palette, font } = useTheme();
  const host = useHost();
  const call = useCall();
  const connected = host?.snapshot.status === 'connected';
  const [board, setBoard] = useState<string | null>(null);
  const load = useQuery('kanban.load', connected ? (board ? { board } : {}) : null);
  const value: KanbanBoardLoad | null = load.value;
  // Cards shown while a move is in flight; replaced by the next read.
  const [shown, setShown] = useState<Readonly<{ source: KanbanBoardLoad; cards: readonly KanbanCard[] }> | null>(null);
  const cards = value ? (shown?.source === value ? shown.cards : value.cards) : [];
  // `seen` is the read that was current when the person picked the task. Only a
  // later read without it ends the selection (a new task appears one read later).
  const [selection, setSelection] = useState<Readonly<{ id: string; seen: KanbanBoardLoad | null }> | null>(null);
  const selectedId = selection?.id ?? null;
  const setSelectedId = (id: string | null) => setSelection(id === null ? null : { id, seen: value });
  const selected = cards.find(card => card.id === selectedId) ?? null;
  const detail = useQuery('kanban.task', value && selected ? { board: value.board, id: selected.id } : null);
  const [pending, setPending] = useState<PendingMove | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [gate, setGate] = useState<Gate | null>(null);
  const [removing, setRemoving] = useState<Readonly<{ card: KanbanCard; error: string }> | null>(null);
  const [giving, setGiving] = useState<Readonly<{ card: KanbanCard; assignee: string; error: string }> | null>(null);
  const [comment, setComment] = useState('');
  // A task that left the board after a read is no longer selected.
  useEffect(() => {
    if (selection && value && value !== selection.seen && load.status === 'loaded' && !value.cards.some(card => card.id === selection.id)) setSelection(null);
  }, [selection, value, load.status]);
  useEffect(() => { setComment(''); }, [selectedId]);

  const agentName = (id: string) => props.data.agents.find(agent => agent.id === id)?.name ?? id;
  const assigneeIds = [...new Set([...props.data.agents.map(agent => agent.id), ...(value?.assignees ?? [])])].filter(isKanbanAssignee);
  const agentOptions: readonly Option<string>[] = [{ value: ANYONE, label: 'Anyone' }, ...assigneeIds.map(id => ({ value: id, label: agentName(id) }))];
  const idle = connected && !!value && busy === null && pending === null;
  const refresh = () => { load.reload(); if (selected) detail.reload(); };

  async function write<T>(label: string, operation: () => Promise<T>): Promise<T> {
    setBusy(label);
    try { return await operation(); } finally { setBusy(null); refresh(); }
  }
  // Optimistic: the card shows in its new lane at once and snaps back if Hermes refuses.
  async function move(card: KanbanCard, target: KanbanMove, note?: string): Promise<boolean> {
    if (!value || card.status === 'other') return false;
    const started = startMove(cards, card.id, target);
    if (!started) return false;
    setShown({ source: value, cards: started.cards }); setPending(started.pending); setNotice(null);
    const result = await write('Moving…', () => call('kanban.move', { board: value.board, id: card.id, from: card.status as KanbanStatus,
      move: target, ...(note === undefined ? {} : { note }) }));
    setShown({ source: value, cards: finishMove(started.cards, started.pending, result.ok ? result.value : null) }); setPending(null);
    if (!result.ok) { setNotice({ tone: result.code === 'unknown' ? 'warn' : 'error', text: `“${card.title}” didn't move. ${result.message}` }); return false; }
    const landed = laneOf(result.value.status);
    if (landed !== laneOf(moveStatus(target))) setNotice({ tone: 'info', text: `Hermes put “${card.title}” in ${LANE_TEXT[landed].title}.` });
    return true;
  }
  function askMove(card: KanbanCard, target: KanbanMove): void {
    const next = moveGate(card, target);
    if (next.kind === 'none') void move(card, target);
    else setGate({ card, move: target, gate: next, note: '', error: '' });
  }
  function actions(card: KanbanCard): readonly MenuItem[] {
    return [...moveTargets(card.status).map(target => ({ label: moveLabel(target, card.status), disabled: !idle, onPress: () => askMove(card, target) })),
      { label: 'Delete…', tone: 'danger' as const, disabled: !idle || !deleteAllowed(card), onPress: () => setRemoving({ card, error: '' }) }];
  }
  async function create(): Promise<void> {
    if (!draft || !value || !draft.title.trim()) return;
    const current = draft;
    // The same key on a second press after an unknown outcome returns the same task.
    const result = await write('Adding…', () => call('kanban.create', { board: value.board, title: current.title, idempotencyKey: current.key,
      ...(current.body.trim() ? { body: current.body } : {}), ...(current.assignee ? { assignee: current.assignee } : {}) }));
    if (!result.ok) { setDraft({ ...current, error: result.message }); return; }
    setDraft(null); setSelectedId(result.value.id); setNotice({ tone: 'success', text: `Added “${result.value.title}” to Later.` });
  }
  // Resolves to a plain-words failure, or null once Hermes confirms the change.
  async function give(card: KanbanCard, assignee: string): Promise<string | null> {
    if (!value) return 'Connect to Hermes first.';
    const result = await write('Saving…', () => call('kanban.assign', { board: value.board, id: card.id, assignee: assignee || null }));
    return result.ok ? null : result.message;
  }
  async function remove(card: KanbanCard): Promise<void> {
    if (!value) return;
    const result = await write('Deleting…', () => call('kanban.delete', { board: value.board, id: card.id }));
    if (!result.ok) { setRemoving({ card, error: result.message }); return; }
    setRemoving(null); if (selectedId === card.id) setSelectedId(null);
    setNotice({ tone: 'success', text: `Deleted “${card.title}”.` });
  }
  async function addComment(card: KanbanCard): Promise<void> {
    if (!value || !comment.trim()) return;
    const text = comment;
    const result = await write('Saving…', () => call('kanban.comment', { board: value.board, id: card.id, body: text }));
    if (!result.ok) { setNotice({ tone: result.code === 'unknown' ? 'warn' : 'error', text: result.message }); return; }
    setComment(current => current === text ? '' : current);
  }

  let message: string | null = null;
  if (!connected) message = 'Connect to Hermes to see your Kanban board.';
  else if (load.status === 'failed') message = load.message;
  else if (!value) message = 'Loading the board…';
  const lanes: readonly KanbanLane[] = [...KANBAN_LANES, ...(cards.some(card => laneOf(card.status) === 'other') ? ['other' as const] : [])];
  const counts = laneCounts(cards);
  const search = query.trim().toLocaleLowerCase();
  const matches = (card: KanbanCard) => !search || [card.title, card.summary ?? '', card.assignee ? agentName(card.assignee) : 'Anyone', cardNote(card)]
    .join(' ').toLocaleLowerCase().includes(search);
  const boardOptions = (value?.boards ?? []).map(entry => ({ value: entry.slug, label: `${entry.name} · ${entry.open} open` }));
  const primary = selected ? primaryMove(selected.status) : null;
  const full = detail.value && selected && detail.value.card.id === selected.id ? detail.value : null;
  const history = full ? [
    ...full.events.flatMap(event => { const label = eventLabel(event, agentName); return label ? [{ key: `e${event.id}`, at: event.createdAt ?? 0, text: label }] : []; }),
    ...full.runs.map(run => ({ key: `r${run.id}`, at: run.endedAt ?? run.startedAt ?? 0,
      // A run with no agent is Hermes recording a person's own Done note.
      text: `${run.agent ? `${agentName(run.agent)}: ` : ''}${runLabel(run.outcome, run.failed)}${run.summary ? `. ${run.summary}` : ''}` })),
  ].sort((a, b) => a.at - b.at).slice(-40) : [];

  return <>
    {props.panes.list ? <ContextColumn title="Kanban" narrow={props.narrow} actions={<View style={{ flexDirection: 'row' }}>
      <IconButton icon="plus" label="New task" disabled={!idle}
        onPress={() => setDraft({ key: crypto.randomUUID(), title: '', body: '', assignee: ANYONE, error: '' })} />
      <IconButton icon="refresh" label="Refresh board" disabled={!connected || busy !== null || pending !== null} onPress={refresh} />
    </View>}>
      <View style={{ gap: 10, padding: 4 }}>
        {boardOptions.length > 1 && value ? <SelectField label="Board" value={value.board} options={boardOptions} disabled={!idle}
          onChange={slug => { setBoard(slug); setSelectedId(null); setNotice(null); }} /> : null}
        <TextInput aria-label="Find a task" placeholder="Find a task" value={query} onChangeText={setQuery} maxLength={256}
          placeholderTextColor={palette.muted} style={{ backgroundColor: palette.incoming, borderRadius: 10, padding: 10, color: palette.ink, fontFamily: font }} />
        {busy ? <View role="status"><Label size={12} tone="muted">{busy}</Label></View> : null}
        {notice && !props.panes.detail ? <Banner tone={notice.tone} text={notice.text} /> : null}
        {message ? <View role="status"><Label tone="muted">{message}</Label></View> : lanes.map(lane => {
          const laneCards = cards.filter(card => laneOf(card.status) === lane && matches(card));
          return <View key={lane} role="list" aria-label={`${LANE_TEXT[lane].title}, ${counts[lane]} ${counts[lane] === 1 ? 'task' : 'tasks'}`} style={{ gap: 2 }}>
            <View style={{ paddingTop: 10, paddingHorizontal: 6 }}>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
                <Label weight="700" size={13}>{LANE_TEXT[lane].title}</Label><Label tone="muted" size={12}>{String(counts[lane])}</Label>
              </View>
              <Label tone="muted" size={12}>{LANE_TEXT[lane].subtitle}</Label>
            </View>
            {laneCards.length === 0 ? <View style={{ paddingHorizontal: 6, paddingVertical: 4 }}>
              <Label tone="muted" size={12}>{search && counts[lane] > 0 ? 'No matching tasks.' : LANE_TEXT[lane].empty}</Label></View>
              : laneCards.map(card => {
                const moving = pending?.id === card.id;
                const who = card.assignee ? agentName(card.assignee) : 'Anyone';
                return <View key={card.id} role="listitem" style={{ flexDirection: 'row', alignItems: 'center', opacity: moving ? 0.6 : 1 }}>
                  <Pressable role="button" aria-label={`${card.title}. ${who}. ${moving ? 'Moving' : cardNote(card)}`} aria-current={selectedId === card.id ? 'true' : false}
                    onPress={() => { if (selectedId !== card.id) setNotice(null); setSelectedId(card.id); props.onOpenDetail(); }}
                    style={({ hovered }) => [{ flex: 1, minWidth: 0, padding: 8, borderRadius: 10, gap: 2 }, hoverFill(palette, hovered, selectedId === card.id)]}>
                    <Label weight="600" oneLine>{card.title}</Label>
                    <Label size={12} tone="muted" oneLine>{`${who} · ${moving ? 'Moving…' : cardNote(card)}`}</Label>
                  </Pressable>
                  <MenuButton label={`Actions for ${card.title}`} items={actions(card)} />
                </View>;
              })}
          </View>;
        })}
      </View>
    </ContextColumn> : null}

    {props.panes.detail ? <View style={{ flex: 1, minWidth: 0 }}>
      <PageHead title={selected?.title ?? 'Kanban'} onBack={props.onBack}>
        {selected ? <MenuButton label={`Actions for ${selected.title}`} items={actions(selected)} /> : null}
      </PageHead>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 24, gap: 20, maxWidth: 760 }}>
        {notice ? <Banner tone={notice.tone} text={notice.text} /> : null}
        {message ? <View role="status"><Label selectable tone="muted">{message}</Label></View> : !selected ? <>
          <Label tone="muted">Pick a task to see its details, or add one with New task.</Label>
          {value?.autoPlan ? <Banner tone="warn" text="Auto plan is on for this computer, so Hermes may use AI to split tasks that are still being planned." /> : null}
        </> : <>
          <View style={{ gap: 4 }}>
            <Label selectable heading={3} size={20} weight="700">{selected.title}</Label>
            <Label tone="muted">{`${LANE_TEXT[laneOf(selected.status)].title} · ${pending?.id === selected.id ? 'Moving…' : cardNote(selected)}`}</Label>
          </View>
          {selected.status === 'running' ? <Banner tone="info" text="An agent is working on this now. Hermes moves it when the work ends." /> : null}
          {moveTargets(selected.status).length > 0 ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {primary ? <Button label={primary.label} tone="primary" disabled={!idle} onPress={() => askMove(selected, primary.move)} /> : null}
            {moveTargets(selected.status).filter(target => target !== primary?.move).map(target =>
              <Button key={target} label={moveLabel(target, selected.status)} disabled={!idle} onPress={() => askMove(selected, target)} />)}
          </View> : null}
          <View style={{ maxWidth: 360 }}>
            <SelectField label="Who does it" value={selected.assignee ?? ANYONE} options={agentOptions}
              disabled={!idle || !assignAllowed(selected)}
              {...(assignAllowed(selected) ? {} : { hint: 'You can change this when the agent finishes.' })}
              onChange={next => {
                if (next === (selected.assignee ?? ANYONE)) return;
                if (assignSpends(selected, next || null)) setGiving({ card: selected, assignee: next, error: '' });
                else void give(selected, next).then(error => { if (error) setNotice({ tone: 'error', text: error }); });
              }} />
          </View>
          {selected.summary ? <Section title="Latest update"><Label selectable>{selected.summary}</Label></Section> : null}
          {full?.result ? <Section title="Result"><Label selectable>{full.result}</Label></Section> : null}
          <Section title="Details">{detail.status === 'failed' ? <Label tone="muted">{detail.message}</Label>
            : !full ? <Label tone="muted">Loading…</Label>
              : full.body ? <Markdown text={full.body} actions={{ openLink: href => { void host?.api.openLink(href); } }} />
                : <Label tone="muted">No details.</Label>}</Section>
          <Section title="Comments">
            {full ? full.comments.length === 0 ? <Label tone="muted">No comments yet.</Label> : <View role="list" style={{ gap: 10 }}>
              {full.comments.map(entry => <View key={entry.id} role="listitem" style={{ gap: 2 }}>
                <Label size={12} tone="muted">{`${entry.author === 'bighelp' ? 'You' : entry.author}${entry.createdAt ? ` · ${when(entry.createdAt)}` : ''}`}</Label>
                <Label selectable>{entry.body}</Label>
              </View>)}
            </View> : null}
            <TextField label="Add a comment" value={comment} onChange={setComment} maxLength={10000} multiline rows={3}
              hint="Comments don't start the agent." disabled={!idle} />
            <View style={{ flexDirection: 'row' }}>
              <Button label={busy === 'Saving…' ? 'Saving…' : 'Add comment'} disabled={!idle || !comment.trim()} onPress={() => { void addComment(selected); }} />
            </View>
          </Section>
          {history.length > 0 ? <Section title="History"><View role="list" style={{ gap: 6 }}>
            {history.map(entry => <View key={entry.key} role="listitem" style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
              <Label size={12} tone="muted">{when(entry.at || undefined)}</Label><Label size={13} selectable>{entry.text}</Label>
            </View>)}
          </View></Section> : null}
          <View style={{ flexDirection: 'row' }}>
            <Button label="Delete task" tone="danger" disabled={!idle || !deleteAllowed(selected)} onPress={() => setRemoving({ card: selected, error: '' })} />
          </View>
          {deleteAllowed(selected) ? null : <Label size={12} tone="muted">You can delete this task when the agent finishes.</Label>}
        </>}
      </ScrollView>
    </View> : null}

    <Dialog open={draft !== null} title="New task" onClose={() => setDraft(null)} actions={<>
      <Button label="Cancel" onPress={() => setDraft(null)} />
      <Button label={busy === 'Adding…' ? 'Adding…' : 'Add to Later'} tone="primary" disabled={busy !== null || !draft?.title.trim()} onPress={() => { void create(); }} />
    </>}>
      {draft ? <>
        <TextField label="What needs doing?" value={draft.title} maxLength={500} autoFocus required
          onChange={title => setDraft({ ...draft, title, error: '' })} onSubmit={() => { void create(); }} />
        <TextField label="Details for the agent (optional)" value={draft.body} maxLength={65536} multiline rows={4}
          onChange={body => setDraft({ ...draft, body, error: '' })} />
        <SelectField label="Who does it" value={draft.assignee} options={agentOptions} onChange={assignee => setDraft({ ...draft, assignee, error: '' })} />
        <Label size={13} tone="muted">Goes to Later. Nothing runs until you move it to Ready.</Label>
        {value?.autoPlan ? <Banner tone="warn" text="Auto plan is on for this computer. Hermes may use AI to split a new task before it settles in Later." /> : null}
        {draft.error ? <Banner tone="error" text={draft.error} /> : null}
      </> : null}
    </Dialog>

    {gate?.gate.kind === 'spend' ? <ConfirmDialog open title={gate.gate.title} body={gate.gate.body} confirmLabel={gate.gate.confirm}
      onCancel={() => setGate(null)} onConfirm={() => { const current = gate; setGate(null); void move(current.card, current.move); }} /> : null}
    {gate?.gate.kind === 'note' ? <Dialog open title={gate.gate.title} onClose={() => setGate(null)} actions={<>
      <Button label="Cancel" onPress={() => setGate(null)} />
      <Button label={gate.gate.confirm} tone="primary" disabled={!gate.note.trim()}
        onPress={() => { const current = gate; setGate(null); void move(current.card, current.move, current.note); }} />
    </>}>
      <Label selectable>{gate.gate.body}</Label>
      <TextField label="Result" value={gate.note} maxLength={2000} multiline rows={3} autoFocus required
        onChange={note => setGate({ ...gate, note })} hint="Saved with the task." />
    </Dialog> : null}

    {removing ? <ConfirmDialog open title="Delete this task?" body={deleteBody(removing.card)} confirmLabel="Delete" tone="danger"
      busy={busy !== null} error={removing.error || undefined} onCancel={() => setRemoving(null)} onConfirm={() => { void remove(removing.card); }} /> : null}
    {giving ? <ConfirmDialog open title={`Give it to ${agentName(giving.assignee)}?`}
      body={`${agentName(giving.assignee)} may start this task soon, without another step from you. This uses AI credits.`}
      confirmLabel="Give it" busy={busy !== null} error={giving.error || undefined} onCancel={() => setGiving(null)}
      onConfirm={() => { const current = giving; void give(current.card, current.assignee).then(error => setGiving(error ? { ...current, error } : null)); }} /> : null}
  </>;
}
