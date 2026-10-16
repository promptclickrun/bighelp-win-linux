import type { JSX, ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native-web';
import type { DesktopApi, DesktopSnapshot } from '../../../apps/desktop/src/shared/desktop-api.ts';
import type { WorkspaceDays, WorkspaceUsageMetrics } from '../../contracts/workspace.ts';
import type { LoadedWorkspace } from '../workspace-load.ts';
import { useWorkspaceLoad } from '../workspace-load.ts';
import type { ViewData } from '../view-model.ts';
import { useTheme } from '../theme.tsx';
import { ContextColumn, PLACE_TITLES } from './ContextList.tsx';
import { Label, PageHead, hoverFill } from './primitives.tsx';

export type FunctionPage = 'projects' | 'scheduled' | 'usage';
type DisplayRow = Readonly<{ id: string; title: string; subtitle: string; search: string; detail: ReactNode; retainOnRefresh?: boolean }>;
const METRICS = [
  ['inputTokens', 'Input tokens'], ['outputTokens', 'Output tokens'], ['cacheReadTokens', 'Cache read tokens'],
  ['reasoningTokens', 'Reasoning tokens'], ['estimatedCost', 'Estimated cost'], ['actualCost', 'Actual cost'],
  ['sessions', 'Sessions'], ['apiCalls', 'API calls'],
] as const;
function Fact(props: Readonly<{ label: string; value: string | number | undefined }>): JSX.Element {
  return <View style={{ gap: 4 }}><Label tone="muted" size={12}>{props.label}</Label>
    <Label selectable>{props.value === undefined ? 'Unavailable' : props.value}</Label></View>;
}
function Metrics(props: Readonly<{ value: WorkspaceUsageMetrics }>): JSX.Element {
  return <View style={{ gap: 16 }}>{METRICS.map(([key, label]) => <Fact key={key} label={label} value={props.value[key]} />)}</View>;
}

// Stays mounted when the narrow pane changes, so Back never starts another read.
// App keys this by global page; leaving retires all local selection and reads.
export function WorkspaceFunctionPage(props: Readonly<{
  page: FunctionPage; data: ViewData; api?: DesktopApi | undefined; snapshot?: DesktopSnapshot | undefined;
  narrow: boolean; panes: Readonly<{ list: boolean; detail: boolean }>;
  onOpenDetail: () => void; onBack?: (() => void) | undefined;
}>): JSX.Element {
  const { palette, font } = useTheme();
  const [chosenProfile, setProfile] = useState<string | null>(props.data.agents.length === 1 ? props.data.agents[0]!.id : null);
  const profile = props.data.agents.some(agent => agent.id === chosenProfile) ? chosenProfile : null;
  // A removed profile must not silently become a different available agent, or
  // reappear selected when a later catalog happens to contain the old ID again.
  useEffect(() => { if (chosenProfile !== null && profile === null) setProfile(null); }, [chosenProfile, profile]);
  const [days, setDays] = useState<WorkspaceDays>(30);
  const [query, setQuery] = useState('');
  const [selection, setSelection] = useState<Readonly<{ scope: string; id: string; source: LoadedWorkspace | null; retainOnRefresh: boolean }> | null>(null);
  const scope = JSON.stringify([props.snapshot?.generation, props.page, profile, days]);
  const load = useWorkspaceLoad({ api: props.api, snapshot: props.snapshot, profile, page: props.page, days });
  const rows: DisplayRow[] = [];
  const workspace = load.workspace;
  if (workspace?.page === 'projects') {
    for (const project of workspace.data.projects) {
      const state = project.archived ? 'Archived' : project.id === workspace.data.activeId ? 'Active' : 'Not active';
      rows.push({ id: project.id, title: project.name, subtitle: state,
        search: [project.name, project.description, state, ...project.folders.flatMap(folder => [folder.path, folder.label])].join(' '),
        detail: <View style={{ gap: 20 }}><Fact label="State" value={state} /><Fact label="Description" value={project.description} />
          <Label heading={3} weight="700">Folders</Label>
          {project.folders.length === 0 ? <Label tone="muted">No folders supplied.</Label> : project.folders.map(folder =>
            <View key={folder.path} style={{ gap: 4 }}>{folder.label === undefined ? null : <Label selectable>{folder.label}</Label>}
              <Label selectable mono>{folder.path}</Label><Label tone="muted" size={12}>{folder.primary ? 'Primary folder' : 'Folder'}</Label></View>)}
        </View> });
    }
  } else if (workspace?.page === 'scheduled') {
    for (const task of workspace.data.tasks) rows.push({ id: task.id, title: task.name, subtitle: `${task.state} · ${task.schedule}`,
      search: [task.name, task.schedule, task.state, task.lastResult].join(' '), detail: <View style={{ gap: 20 }}>
        <Fact label="Schedule" value={task.schedule} /><Fact label="State" value={task.state} />
        <Fact label="Enabled" value={task.enabled ? 'Enabled' : 'Disabled'} /><Fact label="Next run" value={task.nextRunAt} />
        <Fact label="Last result" value={task.lastResult} />
        <Label tone="muted">Hermes tasks run on the connected computer. Device calendars and reminders are unavailable.</Label>
      </View> });
  } else if (workspace?.page === 'usage') {
    rows.push({ id: 'summary', title: 'Summary', subtitle: `${days} days`, search: 'summary totals', detail: <Metrics value={workspace.data.totals} /> });
    for (const row of workspace.data.daily) rows.push({ id: `day:${row.day}`, title: row.day, subtitle: 'Daily usage', search: `${row.day} daily`, detail: <Metrics value={row} /> });
    // The DTO supplies names, not model IDs. Keep unique names stable through
    // reordering; distinguish repeated supplied names by their occurrence.
    const counts = new Map<string, number>();
    for (const row of workspace.data.models) counts.set(row.name, (counts.get(row.name) ?? 0) + 1);
    const occurrences = new Map<string, number>();
    workspace.data.models.forEach(row => {
      const occurrence = occurrences.get(row.name) ?? 0;
      occurrences.set(row.name, occurrence + 1);
      rows.push({ id: `model:${JSON.stringify([row.name, occurrence])}`, title: row.name,
        subtitle: 'Model usage', search: `${row.name} model`, retainOnRefresh: counts.get(row.name) === 1, detail: <Metrics value={row} /> });
    });
  }
  const candidate = selection?.scope === scope ? rows.find(row => row.id === selection.id) : undefined;
  // Repeated names have no stable server ID. After a new read, require a new
  // explicit choice instead of claiming one duplicate is still the old row.
  const selected = candidate && (selection?.source === workspace || (selection?.retainOnRefresh && candidate.retainOnRefresh !== false)) ? candidate : undefined;
  useEffect(() => {
    if (selection && (selection.scope !== scope || (load.status === 'loaded' && !selected))) setSelection(null);
  }, [scope, load.status, selected?.id, selection]);
  const filtered = rows.filter(row => row.search.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const title = PLACE_TITLES[props.page];
  let message: string | null = null;
  if (load.status === 'unavailable') message = 'This page is unavailable. Connect to Hermes, then refresh.';
  else if (props.data.agents.length === 0) message = 'No agents are available on this computer.';
  else if (!profile) message = 'Choose an agent to load this page.';
  else if (load.status === 'loading') message = `Loading ${title.toLowerCase()}…`;
  else if (load.status === 'unsupported') message = 'This computer does not support this page. A host update may be needed.';
  else if (rows.length === 0) message = props.page === 'projects' ? 'No projects supplied.' : 'No scheduled tasks supplied.';
  const rowKind = props.page === 'projects' ? 'project' : props.page === 'scheduled' ? 'task' : 'usage row';
  return <>
    {props.panes.list ? <ContextColumn title={title} narrow={props.narrow} actions={
      <Pressable role="button" aria-label={`Refresh ${props.page}`} disabled={!profile || props.snapshot?.status !== 'connected' || !props.api}
        onPress={load.refresh} style={{ padding: 6 }}><Label tone="action" size={13}>Refresh</Label></Pressable>}>
      <View style={{ gap: 10, padding: 4 }}>
        <label style={{ color: palette.muted, fontFamily: font, fontSize: 12 }}>Agent
          <select aria-label="Agent" value={profile ?? ''} onChange={event => { setProfile(event.target.value || null); setQuery(''); setSelection(null); }}
            style={{ display: 'block', width: '100%', marginTop: 4, color: palette.ink, background: palette.card, borderColor: palette.line, borderRadius: 8, padding: 8, fontFamily: font }}>
            <option value="">Choose an agent</option>{props.data.agents.map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
          </select>
        </label>
        {props.page === 'usage' ? <label style={{ color: palette.muted, fontFamily: font, fontSize: 12 }}>Period
          <select aria-label="Usage period" value={String(days)} onChange={event => {
            const value = Number(event.target.value); if (value === 7 || value === 30 || value === 90) { setDays(value); setSelection(null); }
          }} style={{ display: 'block', width: '100%', marginTop: 4, padding: 8, borderRadius: 8, color: palette.ink, background: palette.card, borderColor: palette.line, fontFamily: font }}>
            {[7, 30, 90].map(value => <option key={value} value={String(value)}>{value} days</option>)}
          </select></label> : null}
        <TextInput aria-label={`Search ${props.page}`} placeholder={`Search ${props.page}`} value={query} onChangeText={setQuery} maxLength={256}
          placeholderTextColor={palette.muted} style={{ backgroundColor: palette.incoming, borderRadius: 10, padding: 10, color: palette.ink, fontFamily: font }} />
        {message ? <View role="status"><Label tone="muted">{message}</Label></View> : <View role="list">
          {filtered.length === 0 ? <Label tone="muted">No matching rows.</Label> : filtered.map(row => <Pressable key={row.id} role="button" aria-label={row.title}
            aria-current={selected?.id === row.id ? 'true' : false} onPress={() => { setSelection({ scope, id: row.id, source: workspace, retainOnRefresh: row.retainOnRefresh !== false }); props.onOpenDetail(); }}
            style={({ hovered }) => [{ padding: 10, borderRadius: 10, gap: 4 }, hoverFill(palette, hovered, selected?.id === row.id)]}>
            <Label selectable weight="600">{row.title}</Label><Label selectable tone="muted" size={12}>{row.subtitle}</Label>
          </Pressable>)}
        </View>}
      </View>
    </ContextColumn> : null}
    {props.panes.detail ? <View style={{ flex: 1, minWidth: 0 }}>
      <PageHead title={selected?.title ?? title} onBack={props.onBack} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 24, gap: 20 }}>
        {message ? <View role="status"><Label selectable tone="muted">{message}</Label></View> : selected ? selected.detail :
          <Label tone="muted">{`Pick a ${rowKind} to see its details.`}</Label>}
      </ScrollView>
    </View> : null}
  </>;
}
