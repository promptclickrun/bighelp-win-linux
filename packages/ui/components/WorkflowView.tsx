// One workflow: what it does, its stages in order, who does each part, its
// recent runs, and a form to start a run. Starting is the only write here; it
// asks first because it starts agents and uses AI credits.
import type { JSX } from 'react';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native-web';
import type { RunSummary, WorkflowDetail, WorkflowStage } from '../../contracts/workflows.ts';
import { WORKFLOW_LIMITS } from '../../contracts/workflows.ts';
import type { InputValues, RunInputs } from '../../domain/workflows.ts';
import { NOT_SURE_STARTED, createStartIntent, prepareRunInputs, relativeTime, resendStart, runLine, stageKindText } from '../../domain/workflows.ts';
import { useCall, useQuery } from '../host.tsx';
import { useTheme } from '../theme.tsx';
import type { ViewData } from '../view-model.ts';
import { forgetStart, sendStart, usePendingStart } from '../workflow-starts.ts';
import { Banner, Button, ConfirmDialog, SelectField, TextField } from './controls.tsx';
import type { BannerTone } from './controls.tsx';
import { IconButton, Label, PageHead, hoverFill } from './primitives.tsx';
import { Facts, Section, agentName, inputName } from './WorkflowParts.tsx';

type Notice = Readonly<{ tone: BannerTone; text: string }>;

export function WorkflowView(props: Readonly<{
  workflowId: string; name?: string | undefined; data: ViewData; nerdMode: boolean; onBack?: (() => void) | undefined;
  onChanged: () => void; onOpenRun: (run: RunSummary) => void;
}>): JSX.Element {
  const { palette } = useTheme();
  const detail = useQuery('workflows.detail', { workflowId: props.workflowId });
  const runs = useQuery('workflows.runs', { filter: 'all', workflowId: props.workflowId });
  const value = detail.value?.id === props.workflowId ? detail.value : null;
  const refresh = () => { detail.reload(); runs.reload(); props.onChanged(); };
  const now = Date.now();
  const roleLabel = (key: string | null) => value?.roles.find(role => role.key === key)?.label ?? 'Agent';
  const roleAgent = (key: string | null) => agentName(props.data, value?.roles.find(role => role.key === key)?.agentId ?? null);
  const stageLine = (stage: WorkflowStage) => stage.kind === 'agent' ? `${roleLabel(stage.role)} · ${roleAgent(stage.role)}`
    : stage.kind === 'parallel' ? `At the same time: ${stage.branches.map(branch => `${branch.title} (${roleAgent(branch.role)})`).join(', ')}`
      : stageKindText(stage.kind);

  return <>
    <PageHead title={value?.name ?? props.name ?? 'Workflow'} onBack={props.onBack}>
      <IconButton icon="refresh" label="Refresh this workflow" onPress={refresh} />
    </PageHead>
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 24, gap: 24, maxWidth: 760 }}>
      {detail.status === 'failed' ? <Banner tone="error" text={detail.message} /> : !value ? <View role="status"><Label tone="muted">Loading the workflow…</Label></View> : <>
        <View style={{ gap: 6 }}>
          <Label selectable heading={3} size={20} weight="700">{value.name}</Label>
          {value.description ? <Label selectable tone="muted">{value.description}</Label> : null}
        </View>
        <StartRun detail={value} onRefresh={refresh} onStarted={run => { refresh(); props.onOpenRun(run); }} />
        <Section title="Stages">
          {value.stages.length === 0 ? <Label tone="muted">No stages yet.</Label> : <View role="list" style={{ gap: 10 }}>
            {value.stages.map((stage, index) => <View key={stage.key} role="listitem" style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ width: 24 }}><Label tone="muted">{`${index + 1}.`}</Label></View>
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <Label weight="600" selectable>{stage.title}</Label>
                <Label size={12} tone="muted" selectable>{stageLine(stage)}</Label>
              </View>
            </View>)}
          </View>}
          {value.revision === null ? <Label size={12} tone="muted">These are the draft's stages.</Label> : null}
        </Section>
        {value.roles.length ? <Section title="Who does each part">
          <Facts rows={value.roles.map(role => [role.label, agentName(props.data, role.agentId)] as const)} />
        </Section> : null}
        <Section title="Recent runs">
          {runs.status === 'failed' ? <Label tone="muted">{runs.message}</Label> : !runs.value ? <Label tone="muted">Loading runs…</Label>
            : runs.value.runs.length === 0 ? <Label tone="muted">No runs yet.</Label> : <View role="list" style={{ gap: 2 }}>
              {runs.value.runs.map(run => <Pressable key={run.id} role="button" aria-label={`Run ${run.number}. ${runLine(run)}`}
                onPress={() => props.onOpenRun(run)} style={({ hovered }) => [{ padding: 8, borderRadius: 10, gap: 2 }, hoverFill(palette, hovered)]}>
                <Label weight="600">{`Run ${run.number}`}</Label>
                <Label size={12} tone="muted">{[runLine(run), run.startedAt ? `started ${relativeTime(run.startedAt, now)}` : ''].filter(Boolean).join(' · ')}</Label>
              </Pressable>)}
            </View>}
          {runs.value?.hasMore ? <Label size={12} tone="muted">Showing the 20 newest runs.</Label> : null}
        </Section>
        {props.nerdMode ? <Section title="Details">
          <Facts rows={[['Workflow ID', value.id], ['Published version', value.revision === null ? 'Not published' : String(value.revision)],
            ['Definition format', String(value.schemaVersion)]]} />
        </Section> : null}
      </>}
    </ScrollView>
  </>;
}

// Why a workflow cannot start from here, or null when it can.
function blocked(detail: WorkflowDetail): Readonly<{ text: string; issues: readonly string[] }> | null {
  if (detail.archived) return { text: "This workflow is archived, so it can't run.", issues: [] };
  if (detail.revision === null) return { text: "Draft only. This workflow hasn't been published, so it can't run yet. Publish it where it was made, then refresh.", issues: [] };
  if (detail.schemaVersion >= 3) return { text: "This is a coding workflow. Starting coding workflows from this app isn't available yet.", issues: [] };
  if (!detail.validation.valid || !detail.validation.host) {
    return { text: "This workflow can't run on your computer yet. Fix this where it was made, then refresh.",
      issues: detail.validation.issues.filter(issue => issue.severity === 'error').map(issue => issue.message).slice(0, 10) };
  }
  return null;
}

function StartRun(props: Readonly<{ detail: WorkflowDetail; onStarted: (run: RunSummary) => void; onRefresh: () => void }>): JSX.Element {
  const call = useCall();
  const detail = props.detail;
  const pending = usePendingStart(detail.id);
  const [values, setValues] = useState<InputValues>({});
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [confirm, setConfirm] = useState<RunInputs | null>(null);
  const [forgetting, setForgetting] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const reason = blocked(detail);
  // A start that settles after the person left this page does not move them.
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  async function send(next: Parameters<typeof sendStart>[0], uncertain: boolean): Promise<void> {
    setNotice(null);
    const settled = await sendStart(next, uncertain, request => call('workflows.start', request));
    if (!settled || !mounted.current) return;
    if (settled.outcome === 'started' && settled.run) { setValues({}); props.onStarted(settled.run); return; }
    if (settled.outcome === 'refused') setNotice({ tone: 'error', text: settled.message });
    else if (settled.message !== NOT_SURE_STARTED) setNotice({ tone: 'warn', text: settled.message });
    props.onRefresh();
  }
  function review(): void {
    const prepared = prepareRunInputs(detail.inputs, values);
    if (!prepared.ok) { setErrors(prepared.errors); return; }
    setErrors({}); setConfirm(prepared.inputs);
  }
  function start(inputs: RunInputs): void {
    setConfirm(null);
    if (detail.revision === null) return;
    void send(createStartIntent(detail.id, detail.revision, inputs, () => crypto.randomUUID()), false);
  }

  if (pending) {
    const sent = pending.intent.inputs;
    return <Section title="Start a run">
      {pending.intent.state === 'sending' ? <Banner tone="info" title="Starting…" text="Sending this run to your computer." />
        : <Banner tone="warn" title="Not sure this run started"
          text="The answer from your computer didn't arrive. Check the runs below. If the run isn't there, send the same start again: if it did start, you get that run, not a second one.">
          <Button label="Check runs" compact onPress={props.onRefresh} />
          <Button label="Send the same start again" compact tone="primary" onPress={() => { void send(resendStart(pending.intent), pending.uncertain); }} />
          <Button label="Forget this start…" compact tone="quiet" onPress={() => setForgetting(true)} />
        </Banner>}
      {notice ? <Banner tone={notice.tone} text={notice.text} /> : null}
      {Object.keys(sent).length ? <Facts rows={Object.entries(sent).map(([key, entry]) =>
        [detail.inputs.find(input => input.key === key)?.label ?? inputName(key), String(entry)] as const)} /> : null}
      <ConfirmDialog open={forgetting} title="Forget this start?" tone="danger" confirmLabel="Forget it"
        body="If it did start, starting again makes a second run that also uses AI credits. Check the runs first."
        onCancel={() => setForgetting(false)} onConfirm={() => { setForgetting(false); forgetStart(pending.intent); }} />
    </Section>;
  }

  if (reason) return <Section title="Start a run">
    {notice ? <Banner tone={notice.tone} text={notice.text} /> : null}
    <Banner tone="info" text={reason.text} />
    {reason.issues.length ? <View role="list" style={{ gap: 4 }}>{reason.issues.map(issue =>
      <View key={issue} role="listitem"><Label size={13} selectable>{`• ${issue}`}</Label></View>)}</View> : null}
  </Section>;

  return <Section title="Start a run">
    {detail.inputs.map(input => {
      const label = input.required ? input.label : `${input.label} (optional)`;
      const value = values[input.key] ?? '';
      const set = (next: string) => { setValues({ ...values, [input.key]: next }); if (errors[input.key]) setErrors({ ...errors, [input.key]: '' }); };
      if (input.type === 'choice') return <View key={input.key} style={{ maxWidth: 420 }}>
        <SelectField label={label} value={value} onChange={set}
          options={[{ value: '', label: 'Choose…' }, ...input.choices.map(choice => ({ value: choice, label: choice }))]} />
        {errors[input.key] ? <Label size={12} tone="danger">{errors[input.key]}</Label> : null}
      </View>;
      return <TextField key={input.key} label={label} value={value} onChange={set} error={errors[input.key] || undefined}
        maxLength={input.type === 'long_text' ? WORKFLOW_LIMITS.longTextInput : input.type === 'number' ? 64 : WORKFLOW_LIMITS.textInput}
        multiline={input.type === 'long_text'} rows={5} required={input.required} spellCheck={input.type !== 'number'}
        {...(input.sample ? { placeholder: `For example: ${input.sample}` } : {})} />;
    })}
    {notice ? <Banner tone={notice.tone} text={notice.text} /> : null}
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <Button label="Start run…" tone="primary" onPress={review} />
      <Label size={12} tone="muted">This starts agents on your computer and uses AI credits.</Label>
    </View>
    <ConfirmDialog open={confirm !== null} title={`Start ${detail.name}?`} confirmLabel="Start run"
      body={`This starts agents on your computer and uses AI credits. ${detail.name} has ${detail.stages.length} ${detail.stages.length === 1 ? 'stage' : 'stages'}. The run keeps going if you close bighelp, and nothing tries again by itself.`}
      onCancel={() => setConfirm(null)} onConfirm={() => { if (confirm) start(confirm); }} />
  </Section>;
}
