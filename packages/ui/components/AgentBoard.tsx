import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native-web';
import type { DesktopApi, DesktopSnapshot } from '../../../apps/desktop/src/shared/desktop-api.ts';
import type { WorkspaceTab } from '../../contracts/workspace.ts';
import type { ViewData } from '../view-model.ts';
import { useTheme } from '../theme.tsx';
import { useWorkspaceLoad } from '../workspace-load.ts';
import { Label, PageHead, hoverFill } from './primitives.tsx';

const TITLES = { feed: 'Feed', ideas: 'Ideas', goals: 'Goals' } as const;
function Fact(props: Readonly<{ label: string; value: string | undefined }>): JSX.Element {
  return <View style={{ gap: 4 }}><Label size={12} tone="muted">{props.label}</Label>
    <Label selectable>{props.value === undefined ? 'Unavailable' : props.value}</Label></View>;
}

// Only the opened, still-present agent may supply the read coordinates. Board
// projections are already validated and filtered in main; no identity is inferred
// from a title, kind, or other display metadata here.
export function AgentBoard(props: Readonly<{
  profile: string; page: WorkspaceTab | null; data: ViewData; narrow: boolean;
  api?: DesktopApi | undefined; snapshot?: DesktopSnapshot | undefined;
}>): JSX.Element | null {
  const { palette, font } = useTheme();
  const profile = props.data.agents.some(agent => agent.id === props.profile) ? props.profile : null;
  const scope = JSON.stringify([props.snapshot?.generation, profile, props.page]);
  const [query, setQuery] = useState('');
  const [selection, setSelection] = useState<Readonly<{ scope: string; id: string }> | null>(null);
  const [detail, setDetail] = useState(false);
  const load = useWorkspaceLoad({ api: props.api, snapshot: props.snapshot, profile, page: props.page, days: 30 });
  const workspace = load.workspace;
  const rows = workspace && (workspace.page === 'feed' || workspace.page === 'ideas' || workspace.page === 'goals')
    && workspace.page === props.page ? workspace.data.items : [];
  const selected = selection?.scope === scope ? rows.find(row => row.id === selection.id) : undefined;
  useEffect(() => {
    if (selection && (selection.scope !== scope || (load.status === 'loaded' && !selected))) { setSelection(null); setDetail(false); }
  }, [scope, load.status, selected?.id, selection]);
  useEffect(() => { setQuery(''); setDetail(false); }, [scope]);
  if (!props.page) return null;
  const page = props.page, title = TITLES[page];
  let message: string | null = null;
  if (!profile) message = 'This agent is no longer available. Choose an agent from the list.';
  else if (load.status === 'unavailable') message = props.snapshot?.status !== 'connected' || !props.api
    ? 'This page is unavailable. Connect to Hermes, then refresh.' : 'This page is unavailable. Refresh to try again.';
  else if (load.status === 'loading') message = `Loading ${page}…`;
  else if (load.status === 'unsupported') message = 'This computer does not support this page. A host update may be needed.';
  else if (rows.length === 0) message = `No ${page} items supplied.`;
  const filtered = rows.filter(row => [row.title, row.body, row.note, row.category, row.status, row.createdAt, row.updatedAt,
    row.read === undefined ? '' : row.read ? 'Read' : 'Unread'].join(' ').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const showingDetail = props.narrow && detail;
  return <View role="region" aria-label={`${title} board`} style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
    <PageHead title={title} onBack={showingDetail ? () => setDetail(false) : undefined} backLabel={`Back to ${page} list`}>
      <Pressable role="button" aria-label={`Refresh ${page}`} disabled={!profile || !props.api || props.snapshot?.status !== 'connected'}
        onPress={load.refresh} style={{ padding: 6 }}><Label tone="action" size={13}>Refresh</Label></Pressable>
    </PageHead>
    <View style={{ flex: 1, minHeight: 0, flexDirection: 'row' }}>
      {!showingDetail ? <View style={{ flex: props.narrow ? 1 : 0.8, minWidth: 0, borderRightWidth: props.narrow ? 0 : 1, borderRightColor: palette.line }}>
        <TextInput aria-label={`Search ${page}`} placeholder={`Search ${page}`} value={query} onChangeText={setQuery} maxLength={256}
          placeholderTextColor={palette.muted} style={{ margin: 12, padding: 10, borderRadius: 10, backgroundColor: palette.incoming, color: palette.ink, fontFamily: font }} />
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 12, paddingTop: 0, gap: 6 }}>
          {message ? <View role="status"><Label selectable tone="muted">{message}</Label></View> :
            <View role="list">{filtered.length === 0 ? <Label tone="muted">No matching items.</Label> : filtered.map(row =>
              <Pressable key={row.id} role="button" aria-label={row.title} aria-current={selected?.id === row.id ? 'true' : false}
                onPress={() => { setSelection({ scope, id: row.id }); setDetail(true); }}
                style={({ hovered }) => [{ padding: 10, borderRadius: 10, gap: 4 }, hoverFill(palette, hovered, selected?.id === row.id)]}>
                <Label selectable weight="600">{row.title}</Label>
                {row.status === undefined ? null : <Label selectable size={12} tone="muted">{row.status}</Label>}
              </Pressable>)}</View>}
        </ScrollView>
      </View> : null}
      {!props.narrow || showingDetail ? <ScrollView style={{ flex: 1, minWidth: 0 }} contentContainerStyle={{ padding: 24, gap: 20 }}>
        {message ? <View role="status"><Label selectable tone="muted">{message}</Label></View> : selected ? <>
          <Label selectable heading={3} size={20} weight="700">{selected.title}</Label>
          <Fact label="Body" value={selected.body} /><Fact label="Note" value={selected.note} />
          <Fact label="Category" value={selected.category} /><Fact label="Status" value={selected.status} />
          <Fact label="Created" value={selected.createdAt} /><Fact label="Updated" value={selected.updatedAt} />
          <Fact label="Read" value={selected.read === undefined ? undefined : selected.read ? 'Read' : 'Unread'} />
        </> : <Label tone="muted">Pick an item to see its details.</Label>}
      </ScrollView> : null}
    </View>
  </View>;
}
