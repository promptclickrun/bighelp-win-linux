// One run: where it is, each stage's state, what it made, and the actions the
// host offers for it now. Every action asks first and sends the run version the
// person saw; a sign-off sends the hash of the file shown here. After any action
// the run is read again. While the run is working and on screen, it is read
// again every 10 seconds (never while the window is hidden).
import type { JSX } from 'react';
import { useEffect, useRef, useState } from 'react';
import { View, ScrollView } from 'react-native-web';
import type { RunDetail, RunOutput, RunStage } from '../../contracts/workflows.ts';
import { WORKFLOW_LIMITS } from '../../contracts/workflows.ts';
import type { OfferedAction } from '../../domain/workflows.ts';
import {
  ACTION_TEXT, duration, isWorking, offeredActions, problemText, readableOutput, relativeTime, runStateText, signoffGate, stageKindText, stageStateText,
} from '../../domain/workflows.ts';
import { useCall, useQuery } from '../host.tsx';
import type { ViewData } from '../view-model.ts';
import { Banner, Button, ConfirmDialog, Dialog, TextField } from './controls.tsx';
import type { BannerTone } from './controls.tsx';
import { IconButton, Label, PageHead } from './primitives.tsx';
import { Facts, OutputText, Section, agentName, inputName, useOutput, when } from './WorkflowParts.tsx';

const POLL_MS = 10_000;
// A success note belongs to the run version the action produced. It stays while
// the run works on; once the run stops again, it no longer describes the run.
type Notice = Readonly<{ tone: BannerTone; text: string; version?: number }>;

export function WorkflowRunView(props: Readonly<{
  runId: string; data: ViewData; nerdMode: boolean; onBack?: (() => void) | undefined; onChanged: () => void; onOpenWorkflow: () => void;
}>): JSX.Element {
  const call = useCall();
  const run = useQuery('workflows.run', { runId: props.runId });
  const value = run.value?.id === props.runId ? run.value : null;
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [asking, setAsking] = useState<OfferedAction | null>(null);
  const [approving, setApproving] = useState(false);
  const [changes, setChanges] = useState<string | null>(null);
  const working = value !== null && isWorking(value.state);
  const reload = run.reload;
  useEffect(() => {
    if (!working) return;
    const timer = setInterval(() => { if (document.visibilityState === 'visible') reload(); }, POLL_MS);
    return () => clearInterval(timer);
  }, [working, reload]);
  // The list beside this page follows the run when its state changes.
  const lastState = useRef<string | null>(null);
  const onChanged = props.onChanged;
  useEffect(() => {
    if (!value) return;
    if (lastState.current !== null && lastState.current !== value.state) onChanged();
    lastState.current = value.state;
  }, [value?.state, onChanged]);

  const signoff = value?.signoff ?? null;
  const fileSha = value && signoff?.kind === 'file' && signoffGate(value, null) !== 'none' ? signoff.artifact.sha256 : null;
  const file = useOutput(props.runId, fileSha);
  const shownSha = file.status === 'loaded' && file.value && file.value.sha256 === fileSha ? file.value.sha256 : null;
  const gate = value ? signoffGate(value, shownSha) : 'none';
  const now = Date.now();
  const idle = busy === null;

  async function control(action: OfferedAction): Promise<void> {
    if (!value) return;
    setAsking(null); setBusy(`${ACTION_TEXT[action].label}…`); setNotice(null);
    const result = await call('workflows.control', { runId: value.id, action, expectedVersion: value.version });
    setBusy(null);
    if (result.ok) {
      const text = action === 'retry' ? 'Trying again. A new attempt starts on your computer.' : action === 'resume' ? 'The run goes on.'
        : result.value.state === 'cancelled' ? 'The run was cancelled.' : 'Stopping the run. It ends when the agent stops.';
      setNotice({ tone: 'success', text, version: result.value.version });
    } else setNotice({ tone: result.code === 'unknown' ? 'warn' : 'error', text: result.message });
    reload(); onChanged();
  }
  async function decide(decision: 'approve' | 'changes', notes: string): Promise<void> {
    if (!value || signoff?.kind !== 'file' || gate !== 'ready' || !shownSha) {
      setApproving(false); setChanges(null);
      setNotice({ tone: 'warn', text: 'Look at the file again before you decide. It is loading now.' });
      return;
    }
    setBusy(decision === 'approve' ? 'Approving…' : 'Sending back…'); setNotice(null);
    const result = await call('workflows.signoff', { runId: value.id, stageKey: signoff.stageKey, decision, artifactSha256: shownSha,
      notes: notes.trim() ? notes : '' });
    setBusy(null); setApproving(false); setChanges(null);
    if (result.ok) {
      setNotice({ tone: 'success', version: result.value.version, text: decision === 'changes' ? 'Sent back with your notes.'
        : result.value.state === 'succeeded' ? 'Approved. The run is done.' : 'Approved. The run goes on.' });
    } else {
      setNotice({ tone: result.code === 'unknown' ? 'warn' : 'error', text: result.message });
      file.reload();
    }
    reload(); onChanged();
  }

  const stageTitle = (key: string) => value?.stages.find(stage => stage.key === key)?.title ?? 'a stage';
  return <>
    <PageHead title={value ? `${value.workflowName} · Run ${value.number}` : 'Run'} onBack={props.onBack}>
      <IconButton icon="refresh" label="Refresh this run" disabled={busy !== null} onPress={reload} />
    </PageHead>
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 24, gap: 24, maxWidth: 760 }}>
      {run.status === 'failed' && !value ? <Banner tone="error" text={run.message} /> : !value ? <View role="status"><Label tone="muted">Loading the run…</Label></View> : <>
        <View style={{ gap: 6 }}>
          <Label selectable heading={3} size={20} weight="700">{runStateText(value.state)}</Label>
          {value.state !== 'succeeded' && value.state !== 'cancelled' ? <Label selectable>{`${value.stageTitle} · stage ${Math.min(value.stagesDone + 1, Math.max(value.stageCount, 1))} of ${value.stageCount}`}</Label> : null}
          <Facts rows={[
            ...(value.startedAt ? [['Started', when(value.startedAt, now)] as const] : [['Started', 'Not yet, waiting for a free slot'] as const]),
            ...(value.endedAt ? [['Ended', when(value.endedAt, now)] as const] : value.updatedAt ? [['Last change', when(value.updatedAt, now)] as const] : []),
          ]} />
          {value.paused ? <Label tone="muted" size={13}>Paused. The run holds after its current stage until it is resumed.</Label> : null}
          {working ? <Label tone="muted" size={13}>This page checks for news every 10 seconds while the run is working.</Label> : null}
          <View style={{ flexDirection: 'row' }}><Button label="Open the workflow" tone="quiet" compact onPress={props.onOpenWorkflow} /></View>
        </View>
        {run.status === 'failed' ? <Banner tone="warn" text={run.message} /> : null}
        {value.attention ? <Banner tone="warn" title="Needs attention" text={problemText(value.attention)} /> : null}
        {value.state === 'failed' && value.failure ? <Banner tone="error" title={`Stopped at ${stageTitle(value.failure.stageKey)}`} text={problemText(value.failure)} /> : null}
        {notice && (notice.version === undefined || value.version <= notice.version || working) ? <Banner tone={notice.tone} text={notice.text} /> : null}
        {busy ? <View role="status"><Label tone="muted">{busy}</Label></View> : null}
        {offeredActions(value).length ? <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          {offeredActions(value).map(action => <Button key={action} label={`${ACTION_TEXT[action].label}…`} tone={action === 'cancel' ? 'secondary' : 'primary'}
            disabled={!idle} onPress={() => setAsking(action)} />)}
        </View> : null}

        {gate === 'changes' ? <Banner tone="info" title="Waiting for your review"
          text="This run waits for you to review code changes. Reviewing code changes isn't available in this app yet." /> : null}
        {value.state === 'waiting_for_you' && gate === 'none' ? <Banner tone="info" title="Waiting for you"
          text={`This run waits for you at ${value.stageTitle}. That step can't be done in this app yet.`} /> : null}
        {signoff?.kind === 'file' && gate !== 'none' && gate !== 'changes' ? <Section title={`Your sign-off: ${stageTitle(signoff.stageKey)}`}>
          <Label size={13} tone="muted">{`The file from ${stageTitle(signoff.artifact.stageKey)}${signoff.artifact.wordCount ? `, ${signoff.artifact.wordCount.toLocaleString()} words` : ''}. Approve it, or send it back with notes.`}</Label>
          {signoff.reviewNotes.length ? <View role="list" style={{ gap: 4 }}>
            <Label size={13} weight="600">The reviewer's notes</Label>
            {signoff.reviewNotes.map((note, index) => <View key={index} role="listitem">
              <Label size={13} selectable>{`${note.severity === 'major' ? 'Must fix' : 'Note'}: ${note.text}`}</Label></View>)}
          </View> : null}
          <OutputText sha256={signoff.artifact.sha256} file={file} />
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <Button label="Approve…" tone="primary" disabled={!idle || gate !== 'ready'} onPress={() => setApproving(true)} />
            <Button label="Ask for changes…" disabled={!idle || gate !== 'ready'} onPress={() => setChanges('')} />
          </View>
        </Section> : null}

        <Section title="Stages">
          <View role="list" style={{ gap: 10 }}>{value.stages.map(stage => <StageRow key={stage.key} stage={stage} data={props.data} now={now} />)}</View>
        </Section>
        {value.outputs.length ? <Section title="Results">
          <View role="list" style={{ gap: 14 }}>{value.outputs.map(output =>
            <OutputRow key={`${output.stageKey}.${output.name}`} runId={value.id} output={output} stageTitle={stageTitle(output.stageKey)} />)}</View>
        </Section> : null}
        {value.inputs.length ? <Section title="What it was given">
          <Facts rows={value.inputs.map(entry => [inputName(entry.key), entry.value] as const)} />
        </Section> : null}
        {props.nerdMode ? <Section title="Details">
          <Facts rows={nerdRows(value)} />
        </Section> : null}
      </>}
    </ScrollView>

    {asking ? <ConfirmDialog open title={ACTION_TEXT[asking].title} body={ACTION_TEXT[asking].body} confirmLabel={ACTION_TEXT[asking].confirm}
      tone={ACTION_TEXT[asking].tone} busy={busy !== null} onCancel={() => setAsking(null)} onConfirm={() => { void control(asking); }} /> : null}
    <ConfirmDialog open={approving} title="Approve this file?" confirmLabel="Approve" busy={busy !== null}
      body="The run goes on from here. If more stages follow, they start on your computer and use AI credits. Approving doesn't publish or send the file anywhere."
      onCancel={() => setApproving(false)} onConfirm={() => { void decide('approve', ''); }} />
    <Dialog open={changes !== null} title="Ask for changes" onClose={() => setChanges(null)} actions={<>
      <Button label="Cancel" onPress={() => setChanges(null)} />
      <Button label={busy ? 'Sending back…' : 'Send back'} tone="primary" disabled={busy !== null || !changes?.trim()}
        onPress={() => { if (changes !== null) void decide('changes', changes); }} />
    </>}>
      <Label selectable>The run goes back to the stage that wrote this file, with your notes. That stage runs again and uses AI credits.</Label>
      <TextField label="What should change?" value={changes ?? ''} onChange={setChanges} maxLength={WORKFLOW_LIMITS.signoffNotes} multiline rows={4}
        autoFocus required spellCheck />
    </Dialog>
  </>;
}

function StageRow(props: Readonly<{ stage: RunStage; data: ViewData; now: number }>): JSX.Element {
  const { stage, now } = props;
  const live = stage.state === 'running' || stage.state === 'launched' || stage.state === 'checking_output';
  const timing = live && stage.startedAt ? `started ${relativeTime(stage.startedAt, now)}`
    : stage.startedAt && stage.endedAt ? `took ${duration(stage.endedAt - stage.startedAt)}` : '';
  const who = stage.kind === 'agent' ? agentName(props.data, stage.agentId) : stageKindText(stage.kind);
  const line = [stageStateText(stage.state), who, timing, stage.attempts > 1 ? `tried ${stage.attempts} times` : ''].filter(Boolean).join(' · ');
  return <View role="listitem" style={{ gap: 2, marginLeft: stage.group ? 20 : 0 }}>
    <Label weight="600" selectable>{stage.title}</Label>
    <Label size={12} tone={stage.state === 'failed' || stage.state === 'needs_attention' ? 'danger' : 'muted'}>{line}</Label>
    {stage.outcome ? <Label size={12} tone="muted" selectable>{`Ended the run (${stage.outcome.end})${stage.outcome.note ? `: ${stage.outcome.note}` : ''}`}</Label> : null}
  </View>;
}

function OutputRow(props: Readonly<{ runId: string; output: RunOutput; stageTitle: string }>): JSX.Element {
  const { output } = props;
  const [open, setOpen] = useState(false);
  const title = `${props.stageTitle} · ${inputName(output.name)}${output.wordCount ? ` · ${output.wordCount.toLocaleString()} words` : ''}`;
  let body: JSX.Element;
  if (typeof output.value === 'number') body = <Label selectable>{output.value.toLocaleString()}</Label>;
  else if (typeof output.value === 'string') {
    body = <Label selectable>{output.type === 'decision' ? output.value === 'pass' ? 'Pass' : output.value === 'changes' ? 'Changes asked for' : output.value : output.value}</Label>;
  } else if (Array.isArray(output.value)) {
    body = output.value.length === 0 ? <Label tone="muted">No notes.</Label> : <View role="list" style={{ gap: 4 }}>{output.value.map((note, index) =>
      <View key={index} role="listitem"><Label size={13} selectable>{`${note.severity === 'major' ? 'Must fix' : 'Note'}: ${note.text}`}</Label></View>)}</View>;
  } else if (readableOutput(output.type)) {
    body = <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row' }}><Button label={open ? 'Hide' : 'Show'} compact onPress={() => setOpen(!open)} /></View>
      {open ? <LazyOutput runId={props.runId} sha256={output.sha256} /> : null}
    </View>;
  } else body = <Label tone="muted">A file kept on your computer. It can't be shown here yet.</Label>;
  return <View role="listitem" style={{ gap: 6 }}><Label size={13} weight="600">{title}</Label>{body}</View>;
}

function LazyOutput(props: Readonly<{ runId: string; sha256: string }>): JSX.Element {
  return <OutputText sha256={props.sha256} file={useOutput(props.runId, props.sha256)} />;
}

function nerdRows(run: RunDetail): readonly (readonly [string, string])[] {
  return [
    ['Run ID', run.id], ['Workflow ID', run.workflowId], ['Workflow version', String(run.revision)], ['Run version', String(run.version)],
    ['Round', String(run.iteration)],
    ['Tokens', run.tokens ? `${run.tokens.in.toLocaleString()} in · ${run.tokens.out.toLocaleString()} out` : 'Unknown'],
    ...(run.signoff?.kind === 'file' ? [['Sign-off file SHA-256', run.signoff.artifact.sha256] as const] : []),
  ];
}
