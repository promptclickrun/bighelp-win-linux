// The Workflows place: what needs you, what is running and every workflow in
// the context column; the open workflow or run on the right (the approved
// list/detail pattern). Workflows are host-wide and run on the computer, not
// in this app. This app starts and follows runs; it does not edit workflows.
import type { JSX, ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native-web';
import type { RunSummary, WorkflowOverview } from '../../contracts/workflows.ts';
import { STATUS_TEXT, isWorking, needsPerson, relativeTime, runLine, workflowStatus } from '../../domain/workflows.ts';
import type { HostValue } from '../host.tsx';
import { HostProvider, useHost, useQuery } from '../host.tsx';
import { useTheme } from '../theme.tsx';
import type { ViewData } from '../view-model.ts';
import { ContextColumn } from './ContextList.tsx';
import { IconButton, Label, PageHead, Tag, hoverFill } from './primitives.tsx';
import { WorkflowView } from './WorkflowView.tsx';
import { WorkflowRunView } from './WorkflowRunView.tsx';

type PageProps = Readonly<{
  data: ViewData; nerdMode: boolean; narrow: boolean; panes: Readonly<{ list: boolean; detail: boolean }>;
  onOpenDetail: () => void; onBack?: (() => void) | undefined;
}>;
export type Selection = Readonly<{ kind: 'workflow'; id: string }> | Readonly<{ kind: 'run'; id: string; workflowId: string }>;

// App keys this by host connection, so a host switch drops every selection and read.
export function WorkflowsPage(props: PageProps & Readonly<{ host: HostValue | null }>): JSX.Element {
  const { host, ...rest } = props;
  return <HostProvider value={host}><Workflows {...rest} /></HostProvider>;
}

function ListRow(props: Readonly<{ title: string; subtitle: string; active: boolean; onPress: () => void }>): JSX.Element {
  const { palette } = useTheme();
  return <Pressable role="button" aria-label={`${props.title}. ${props.subtitle}`} aria-current={props.active ? 'true' : false} onPress={props.onPress}
    style={({ hovered }) => [{ padding: 8, borderRadius: 10, gap: 2 }, hoverFill(palette, hovered, props.active)]}>
    <Label weight="600" oneLine>{props.title}</Label>
    <Label size={12} tone="muted" oneLine>{props.subtitle}</Label>
  </Pressable>;
}
function Group(props: Readonly<{ title: string; children: ReactNode }>): JSX.Element {
  return <View role="list" aria-label={props.title} style={{ gap: 2 }}>
    <View style={{ paddingTop: 12, paddingBottom: 2, paddingHorizontal: 8 }}><Label size={12} weight="700" tone="muted">{props.title}</Label></View>
    {props.children}
  </View>;
}

function Workflows(props: PageProps): JSX.Element {
  const host = useHost();
  const connected = host?.snapshot.status === 'connected';
  const overview = useQuery('workflows.overview', connected ? {} : null);
  const value: WorkflowOverview | null = overview.value;
  const [selection, setSelection] = useState<Selection | null>(null);
  // A workflow that left the list (archived on the computer) is no longer open.
  useEffect(() => {
    if (selection?.kind === 'workflow' && value && overview.status === 'loaded' && !value.workflows.some(row => row.id === selection.id)) setSelection(null);
  }, [selection, value, overview.status]);
  const open = (next: Selection) => { setSelection(next); props.onOpenDetail(); };
  const now = Date.now();
  const runRow = (run: RunSummary) => <ListRow key={run.id} title={`${run.workflowName} · Run ${run.number}`}
    subtitle={`${runLine(run)}${run.updatedAt ? ` · ${relativeTime(run.updatedAt, now)}` : ''}`}
    active={selection?.kind === 'run' && selection.id === run.id} onPress={() => open({ kind: 'run', id: run.id, workflowId: run.workflowId })} />;

  let message: string | null = null;
  if (!connected) message = 'Connect to Hermes to see your workflows.';
  else if (overview.status === 'failed') message = overview.message;
  else if (!value) message = 'Loading workflows…';
  const runs = value ? [...value.waiting, ...value.active.filter(run => !value.waiting.some(waiting => waiting.id === run.id))] : [];
  const needsYou = runs.filter(run => needsPerson(run.state));
  const running = runs.filter(run => isWorking(run.state));
  const selectedName = selection?.kind === 'workflow' ? value?.workflows.find(row => row.id === selection.id)?.name : undefined;

  return <>
    {props.panes.list ? <ContextColumn title="Workflows" narrow={props.narrow} actions={
      <IconButton icon="refresh" label="Refresh workflows" disabled={!connected} onPress={overview.reload} />}>
      <View style={{ gap: 4, padding: 4 }}>
        {message ? <View role="status" style={{ padding: 8 }}><Label tone="muted">{message}</Label></View> : null}
        {!connected && props.data.sample && props.data.workflows.length ? <Group title="Sample workflows">
          <View style={{ paddingHorizontal: 8, alignItems: 'flex-start' }}><Tag>Sample data</Tag></View>
          {props.data.workflows.map(row => <View key={row.id} role="listitem" style={{ padding: 8, gap: 2 }}>
            <Label weight="600" oneLine>{row.title}</Label><Label size={12} tone="muted" oneLine>{row.status}</Label>
          </View>)}
        </Group> : null}
        {value && !message ? <>
          {needsYou.length ? <Group title="Needs you">{needsYou.map(runRow)}</Group> : null}
          {running.length ? <Group title="Running">{running.map(runRow)}</Group> : null}
          <Group title="Workflows">
            {value.workflows.length === 0 ? <View style={{ padding: 8 }}><Label tone="muted" size={13}>
              No workflows yet. Workflows made in bighelp on a Mac, or by one of your agents, show up here.</Label></View>
              : value.workflows.map(row => <ListRow key={row.id} title={row.name}
                subtitle={[STATUS_TEXT[workflowStatus(row, value)], row.pinned ? 'Pinned' : ''].filter(Boolean).join(' · ')}
                active={selection?.kind === 'workflow' && selection.id === row.id} onPress={() => open({ kind: 'workflow', id: row.id })} />)}
          </Group>
        </> : null}
      </View>
    </ContextColumn> : null}

    {props.panes.detail ? <View style={{ flex: 1, minWidth: 0 }}>
      {selection?.kind === 'workflow' ? <WorkflowView key={selection.id} workflowId={selection.id} name={selectedName} data={props.data}
        nerdMode={props.nerdMode} onBack={props.onBack} onChanged={overview.reload}
        onOpenRun={run => setSelection({ kind: 'run', id: run.id, workflowId: run.workflowId })} />
        : selection?.kind === 'run' ? <WorkflowRunView key={selection.id} runId={selection.id} data={props.data} nerdMode={props.nerdMode}
          onBack={props.onBack} onChanged={overview.reload} onOpenWorkflow={() => setSelection({ kind: 'workflow', id: selection.workflowId })} />
          : <>
            <PageHead title="Workflows" onBack={props.onBack} />
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 24, gap: 12, maxWidth: 760 }}>
              <View role="status"><Label tone="muted">{message ?? 'Pick a workflow to see its stages and start a run, or pick a run to follow it.'}</Label></View>
              {!message ? <Label tone="muted" size={13}>Workflows run on your computer, so they keep going when you close bighelp.</Label> : null}
            </ScrollView>
          </>}
    </View> : null}
  </>;
}
