import type { JSX, ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { View } from 'react-native-web';
import type { WorkspaceDays, WorkspaceUsageMetrics } from '../../contracts/workspace.ts';
import type { LoadedWorkspace } from '../workspace-load.ts';
import { useWorkspaceLoad } from '../workspace-load.ts';
import { useTheme } from '../theme.tsx';
import { PLACE_TITLES } from './ContextList.tsx';
import { Fact, FunctionDetail, FunctionList, useAgentChoice } from './FunctionLayout.tsx';
import type { FunctionPageProps } from './FunctionLayout.tsx';
import { ProjectsPage } from './Projects.tsx';
import { ScheduledTasksPage } from './ScheduledTasks.tsx';

export type { FunctionPage } from './FunctionLayout.tsx';
type DisplayRow = Readonly<{ id: string; title: string; subtitle: string; search: string; detail: ReactNode; retainOnRefresh?: boolean }>;
const METRICS = [
  ['inputTokens', 'Input tokens'], ['outputTokens', 'Output tokens'], ['cacheReadTokens', 'Cache read tokens'],
  ['reasoningTokens', 'Reasoning tokens'], ['estimatedCost', 'Estimated cost'], ['actualCost', 'Actual cost'],
  ['sessions', 'Sessions'], ['apiCalls', 'API calls'],
] as const;
function Metrics(props: Readonly<{ value: WorkspaceUsageMetrics }>): JSX.Element {
  return <View style={{ gap: 16 }}>{METRICS.map(([key, label]) => <Fact key={key} label={label} value={props.value[key]} />)}</View>;
}

// Stays mounted when the narrow pane changes, so Back never starts another read.
// App keys this by global page; leaving retires all local selection and reads.
export function WorkspaceFunctionPage(props: FunctionPageProps): JSX.Element {
  if (props.page === 'scheduled') return <ScheduledTasksPage {...props} />;
  if (props.page === 'projects') return <ProjectsPage {...props} />;
  return <UsagePage {...props} />;
}

export function UsagePage(props: FunctionPageProps): JSX.Element {
  const { palette, font } = useTheme();
  const [profile, setProfile] = useAgentChoice(props.data.agents);
  const [days, setDays] = useState<WorkspaceDays>(30);
  const [query, setQuery] = useState('');
  const [selection, setSelection] = useState<Readonly<{ scope: string; id: string; source: LoadedWorkspace | null; retainOnRefresh: boolean }> | null>(null);
  const scope = JSON.stringify([props.snapshot?.generation, props.page, profile, days]);
  const load = useWorkspaceLoad({ api: props.api, snapshot: props.snapshot, profile, page: props.page, days });
  const rows: DisplayRow[] = [];
  const workspace = load.workspace;
  if (workspace?.page === 'usage') {
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
  const title = PLACE_TITLES[props.page];
  let message: string | null = null;
  if (load.status === 'unavailable') message = 'This page is unavailable. Connect to Hermes, then refresh.';
  else if (props.data.agents.length === 0) message = 'No agents are available on this computer.';
  else if (!profile) message = 'Choose an agent to load this page.';
  else if (load.status === 'loading') message = `Loading ${title.toLowerCase()}…`;
  else if (load.status === 'unsupported') message = 'This computer does not support this page. A host update may be needed.';
  return <>
    {props.panes.list ? <FunctionList title={title} page={props.page} narrow={props.narrow} agents={props.data.agents} profile={profile}
      onProfile={id => { setProfile(id); setQuery(''); setSelection(null); }}
      canRefresh={!!profile && props.snapshot?.status === 'connected' && !!props.api} onRefresh={load.refresh}
      filters={<label style={{ color: palette.muted, fontFamily: font, fontSize: 12 }}>Period
        <select aria-label="Usage period" value={String(days)} onChange={event => {
          const value = Number(event.target.value); if (value === 7 || value === 30 || value === 90) { setDays(value); setSelection(null); }
        }} style={{ display: 'block', width: '100%', marginTop: 4, padding: 8, borderRadius: 8, color: palette.ink, background: palette.card, borderColor: palette.line, fontFamily: font }}>
          {[7, 30, 90].map(value => <option key={value} value={String(value)}>{value} days</option>)}
        </select></label>}
      query={query} onQuery={setQuery} message={message} rows={rows} selectedId={selected?.id}
      onSelect={row => { setSelection({ scope, id: row.id, source: workspace, retainOnRefresh: rows.find(item => item.id === row.id)?.retainOnRefresh !== false }); props.onOpenDetail(); }} /> : null}
    {props.panes.detail ? <FunctionDetail pageTitle={title} selectedTitle={selected?.title} onBack={props.onBack} message={message}
      empty="Pick a usage row to see its details.">{selected?.detail}</FunctionDetail> : null}
  </>;
}
