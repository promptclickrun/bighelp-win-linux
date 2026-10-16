// Scheduled tasks for one agent: the approved list/detail layout with create,
// edit, pause/resume, Run now, delete and recent runs. Every run spends AI
// credits, so the page says so before saving or running. Nothing runs by itself here.
import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import { View } from 'react-native-web';
import type { DeliveryTarget, ScheduledTask, TaskRun } from '../../contracts/schedules.ts';
import type { TaskChanges, TaskSaved } from '../../../apps/desktop/src/shared/calls/schedules.ts';
import { HOUR_CHOICES, describeSchedule, presetFor, scheduleRequest } from '../../domain/schedule.ts';
import type { SchedulePreset } from '../../domain/schedule.ts';
import type { ViewData } from '../view-model.ts';
import { useCall, useQuery } from '../host.tsx';
import { useTheme } from '../theme.tsx';
import { PLACE_TITLES } from './ContextList.tsx';
import { Banner, Button, ConfirmDialog, Dialog, SelectField, TextField, Toggle } from './controls.tsx';
import type { BannerTone } from './controls.tsx';
import { Fact, FunctionDetail, FunctionList, pageMessage, useAgentChoice } from './FunctionLayout.tsx';
import type { FunctionPageProps, ListRow } from './FunctionLayout.tsx';
import { Label } from './primitives.tsx';

export const CREDITS = "Runs use AI credits on your computer's model provider each time.";
const RUN_WAIT = 'bighelp waits for it to finish, up to 15 minutes.';

const pad = (value: number) => String(value).padStart(2, '0');
export function when(iso: string): string {
  return new Date(iso).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
const FORMAT = Object.freeze({
  clock: (hour: number, minute: number) => new Date(2000, 0, 1, hour, minute).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
  instant: when,
});
function offsetLabel(minutes: number): string {
  const size = Math.abs(minutes);
  return `UTC${minutes < 0 ? '−' : '+'}${pad(Math.floor(size / 60))}:${pad(size % 60)}`;
}
// Cron times use the Hermes computer's clock. Say so when it differs from this device.
function clockNote(hostOffset: number | null): string {
  const device = -new Date().getTimezoneOffset();
  return hostOffset === null || hostOffset === device ? 'Times use the clock on the computer running Hermes.'
    : `Times use the clock on the computer running Hermes (${offsetLabel(hostOffset)}). This device is ${offsetLabel(device)}.`;
}
const isPaused = (task: ScheduledTask) => !task.enabled || task.state === 'paused';
export function taskStatus(task: ScheduledTask): string {
  if (task.running) return 'Running now';
  if (task.state === 'completed') return 'Finished';
  if (task.state === 'error') return 'Needs a look';
  if (task.state === 'unknown') return 'Unknown state';
  if (isPaused(task)) return 'Paused';
  return task.nextRunAt ? `Next: ${when(task.nextRunAt)}` : 'Next run not set yet';
}
function lastResult(status: string | null): string | null {
  if (status === null) return null;
  return { ok: 'Finished without errors', error: 'Had a problem', delivery_failed: "Ran, but the results couldn't be delivered",
    blocked_config: 'Blocked by a setting on the Hermes computer' }[status] ?? `Hermes reports “${status}”`;
}
function deliverLabel(deliver: string, targets: readonly DeliveryTarget[] | null, agents: ViewData['agents']): string {
  const listed = targets?.find(target => target.id === deliver);
  if (listed) return listed.name;
  if (deliver === 'local') return 'Saved on the Hermes computer';
  if (deliver === 'origin') return 'Where the task was created';
  if (deliver.startsWith('bot-chat:')) {
    const agent = agents.find(row => row.id === deliver.slice(9));
    return `${agent?.name ?? 'An agent'}'s Bot Chat`;
  }
  return deliver;
}
const describe = (task: ScheduledTask) => describeSchedule(task.schedule, task.scheduleText, FORMAT);

type Notice = Readonly<{ profile: string; id: string | null; tone: BannerTone; text: string }>;
type Editing = Readonly<{ mode: 'new' }> | Readonly<{ mode: 'edit'; task: ScheduledTask }>;

export function ScheduledTasksPage(props: FunctionPageProps): JSX.Element {
  const [profile, setProfile] = useAgentChoice(props.data.agents);
  const call = useCall();
  const nerd = props.snapshot?.preferences?.nerdMode === true;
  const list = useQuery('schedules.list', profile ? { profile } : null);
  // An explicit Refresh hides the old list until a new answer arrives. Reloads
  // after a change keep it on screen.
  const [retired, setRetired] = useState<unknown>(null);
  const tasks = list.value?.profile === profile && list.value !== retired ? list.value.tasks : null;
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = tasks?.find(task => task.id === selectedId);
  useEffect(() => { if (selectedId !== null && tasks && !selected) setSelectedId(null); }, [selectedId, tasks, selected]);
  const runs = useQuery('schedules.runs', profile && selected ? { profile, id: selected.id } : null);
  const targets = useQuery('schedules.targets', profile && selected ? { profile } : null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [confirm, setConfirm] = useState<Readonly<{ kind: 'run' | 'delete'; task: ScheduledTask }> | null>(null);
  const [busy, setBusy] = useState<Readonly<{ profile: string; id: string; text: string }> | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [notice, setNotice] = useState<Notice | null>(null);
  const connected = props.snapshot?.status === 'connected' && !!props.api;
  const title = PLACE_TITLES.scheduled;
  const agentName = (id: string) => props.data.agents.find(agent => agent.id === id)?.name ?? 'this agent';
  const unsupported = list.status === 'failed' && list.code === 'unsupported' && !tasks;
  let message = pageMessage({ connected, agents: props.data.agents.length, profile, title, status: list.status, loaded: !!tasks,
    code: list.code, failure: list.message });
  if (message === null && tasks?.length === 0) message = 'Nothing scheduled yet. Use New task to have an agent check in, summarize, or remind you on a schedule.';
  const rows: ListRow[] = (tasks ?? []).map(task => ({ id: task.id, title: task.name || 'Untitled task',
    subtitle: `${taskStatus(task)} · ${describe(task)}`, search: [task.name, task.prompt, describe(task), taskStatus(task)].join(' ') }));
  const hostOffset = tasks?.find(task => task.hostOffsetMinutes !== null)?.hostOffsetMinutes ?? null;
  const supports = tasks && tasks.length > 0 ? { model: tasks.some(task => task.stores.model), workdir: tasks.some(task => task.stores.workdir) } : null;
  const shownNotice = notice && notice.profile === profile && (notice.id === null || notice.id === selected?.id) ? notice : null;

  const afterWrite = () => { list.reload(); runs.reload(); };
  async function runNow(task: ScheduledTask, owner: string): Promise<void> {
    setConfirm(null); setNotice(null);
    setBusy({ profile: owner, id: task.id, text: `Running now. ${RUN_WAIT}` });
    const result = await call('schedules.run', { profile: owner, id: task.id, resume: isPaused(task) });
    setBusy(null);
    if (result.ok) {
      const { ran, task: after } = result.value;
      const status = lastResult(after.lastStatus);
      setNotice({ profile: owner, id: task.id, tone: !ran ? 'info' : after.lastStatus === 'ok' ? 'success' : 'warn',
        text: !ran ? "Hermes answered, but didn't record a new run. Check Recent runs."
          : `The run finished.${status ? ` ${status}.` : ''}${after.lastStatus === 'error' && after.lastError && nerd ? ` ${after.lastError}` : ''}` });
    } else setNotice({ profile: owner, id: task.id, tone: result.code === 'unknown' ? 'warn' : 'error', text: result.message });
    afterWrite();
  }
  async function setPaused(task: ScheduledTask, owner: string, paused: boolean): Promise<void> {
    setNotice(null); setBusy({ profile: owner, id: task.id, text: paused ? 'Pausing…' : 'Resuming…' });
    const result = await call('schedules.setPaused', { profile: owner, id: task.id, paused });
    setBusy(null);
    setNotice(result.ok
      ? { profile: owner, id: task.id, tone: result.value.notes.length ? 'warn' : 'success',
        text: [paused ? "Paused. It won't run until you resume it." : 'Resumed.', ...result.value.notes].join(' ') }
      : { profile: owner, id: task.id, tone: result.code === 'unknown' ? 'warn' : 'error', text: result.message });
    afterWrite();
  }
  async function remove(task: ScheduledTask, owner: string): Promise<void> {
    setDeleting(true); setDeleteError('');
    const result = await call('schedules.delete', { profile: owner, id: task.id });
    setDeleting(false);
    if (result.ok) {
      setConfirm(null); setSelectedId(null);
      setNotice({ profile: owner, id: null, tone: 'success', text: `Deleted “${task.name}”.` });
    } else setDeleteError(result.message);
    list.reload();
  }
  function saved(value: TaskSaved): void {
    setEditing(null);
    if (value.profile !== profile) { setProfile(value.profile); setQuery(''); }
    const task = value.task;
    if (task) setSelectedId(task.id);
    const read = task ? `Saved. Hermes reads the schedule as “${describe(task)}”.${task.nextRunAt && !isPaused(task) ? ` Next run: ${when(task.nextRunAt)}.` : ''}` : '';
    setNotice({ profile: value.profile, id: task?.id ?? null, tone: value.notes.length ? 'warn' : 'success', text: [read, ...value.notes].filter(Boolean).join(' ') });
    // Wait for the list that contains the saved task before showing it selected.
    if (task && !tasks?.some(row => row.id === task.id)) setRetired(list.value);
    list.reload();
  }

  const writing = busy !== null;
  const detail = selected && profile ? <TaskDetail task={selected} profile={profile} agents={props.data.agents} nerd={nerd}
    busy={busy?.profile === profile && busy.id === selected.id ? busy.text : null} writing={writing} notice={shownNotice}
    runs={runs.value?.profile === profile && runs.value.id === selected.id ? runs.value.runs : null}
    runsMessage={runs.status === 'failed' ? runs.message : null}
    targets={targets.value?.profile === profile ? targets.value.targets : null}
    onRun={() => setConfirm({ kind: 'run', task: selected })} onEdit={() => setEditing({ mode: 'edit', task: selected })}
    onPause={paused => { void setPaused(selected, profile, paused); }}
    onDelete={() => { setDeleteError(''); setConfirm({ kind: 'delete', task: selected }); }} /> : null;
  return <>
    {props.panes.list ? <FunctionList title={title} page="scheduled" narrow={props.narrow} agents={props.data.agents} profile={profile}
      onProfile={id => { setProfile(id); setQuery(''); setSelectedId(null); setNotice(null); }}
      canRefresh={!!profile && connected} onRefresh={() => { setRetired(list.value); list.reload(); }}
      actions={profile && connected && !unsupported ? <Button label="New task" icon="plus" tone="quiet" compact disabled={!tasks}
        onPress={() => setEditing({ mode: 'new' })} /> : null}
      filters={shownNotice && shownNotice.id === null ? <Banner tone={shownNotice.tone} text={shownNotice.text} /> : null}
      query={query} onQuery={setQuery} message={message} rows={rows} selectedId={selected?.id}
      onSelect={row => { setSelectedId(row.id); props.onOpenDetail(); }} /> : null}
    {props.panes.detail ? <FunctionDetail pageTitle={title} selectedTitle={selected ? selected.name || 'Untitled task' : undefined} onBack={props.onBack}
      message={message} empty="Pick a task to see its details.">{detail}</FunctionDetail> : null}
    {editing && profile ? <TaskEditor editing={editing} profile={profile} agents={props.data.agents} supports={supports} hostOffset={hostOffset}
      onClose={() => setEditing(null)} onSaved={saved} onUncertain={list.reload}
      onUnchanged={task => { setEditing(null); setNotice({ profile, id: task.id, tone: 'info', text: 'Nothing changed.' }); }} /> : null}
    {confirm?.kind === 'run' && profile ? <ConfirmDialog open title={isPaused(confirm.task) ? `Run and resume “${confirm.task.name}”?` : `Run “${confirm.task.name}” now?`}
      body={isPaused(confirm.task)
        ? `Hermes turns a paused task back on when it runs now, so its scheduled runs start again too. This run uses AI credits on your computer's model provider. ${RUN_WAIT}`
        : `It runs once right away and uses AI credits on your computer's model provider. ${RUN_WAIT}`}
      confirmLabel={isPaused(confirm.task) ? 'Run and resume' : 'Run now'}
      onConfirm={() => { void runNow(confirm.task, profile); }} onCancel={() => setConfirm(null)} /> : null}
    {confirm?.kind === 'delete' && profile ? <ConfirmDialog open tone="danger" busy={deleting} error={deleteError || undefined}
      title={`Delete “${confirm.task.name}” for ${agentName(profile)}?`}
      body={`This removes “${confirm.task.name}” for ${agentName(profile)}, with its saved results. This can't be undone.`}
      confirmLabel="Delete" onConfirm={() => { void remove(confirm.task, profile); }} onCancel={() => { if (!deleting) setConfirm(null); }} /> : null}
  </>;
}

function TaskDetail(props: Readonly<{
  task: ScheduledTask; profile: string; agents: ViewData['agents']; nerd: boolean; busy: string | null; writing: boolean;
  notice: Notice | null; runs: readonly TaskRun[] | null; runsMessage: string | null; targets: readonly DeliveryTarget[] | null;
  onRun: () => void; onEdit: () => void; onPause: (paused: boolean) => void; onDelete: () => void;
}>): JSX.Element {
  const { task } = props;
  const paused = isPaused(task), finished = task.state === 'completed';
  const editable = !task.hostManaged && task.prompt !== null;
  const nextRun = finished ? 'None. This task has finished.' : paused ? 'Paused' : task.nextRunAt ? when(task.nextRunAt) : 'Not set yet';
  const schedule = task.schedule.kind === 'cron' ? task.schedule.expr : task.schedule.kind === 'interval' ? `every ${task.schedule.minutes}m` : task.schedule.at;
  return <View style={{ gap: 20 }}>
    {props.busy ? <Banner tone="info" text={props.busy} /> : props.notice ? <Banner tone={props.notice.tone} text={props.notice.text} /> : null}
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {finished || task.running ? null : <Button label={paused ? 'Run and resume' : 'Run now'} tone="primary" disabled={props.writing}
          accessibleLabel={`Run ${task.name} now`} onPress={props.onRun} />}
        {finished ? null : <Button label={paused ? 'Resume' : 'Pause'} disabled={props.writing} accessibleLabel={`${paused ? 'Resume' : 'Pause'} ${task.name}`}
          onPress={() => props.onPause(!paused)} />}
        {editable ? <Button label="Edit" disabled={props.writing} accessibleLabel={`Edit ${task.name}`} onPress={props.onEdit} /> : null}
        <Button label="Delete" tone="quiet" disabled={props.writing} accessibleLabel={`Delete ${task.name}`} onPress={props.onDelete} />
      </View>
      <Label tone="muted" size={12}>{CREDITS}</Label>
      {paused && !finished ? <Label tone="muted" size={12}>If it missed a run while paused, it may run once soon after you resume.</Label> : null}
      {finished ? <Label tone="muted" size={12}>This task has finished. Create a new task for more runs.</Label> : null}
      {!editable ? <Label tone="muted" size={12}>This task uses scripts or skills set up on the Hermes computer. Edit it there.</Label> : null}
    </View>
    <Fact label="Status" value={taskStatus(task)} />
    <View style={{ gap: 4 }}><Label tone="muted" size={12}>What it does</Label>
      <Label selectable>{task.prompt ?? 'Set up on the Hermes computer.'}</Label></View>
    <Fact label="When" value={describe(task)} />
    <Fact label="Next run" value={nextRun} />
    <Fact label="Results go to" value={deliverLabel(task.deliver, props.targets, props.agents)} />
    <Fact label="Last run" value={task.lastRunAt ? when(task.lastRunAt) : 'No runs yet'} />
    {task.lastStatus ? <Fact label="Last result" value={lastResult(task.lastStatus)} /> : null}
    {task.model ? <Fact label="Model" value={task.model} /> : null}
    {task.workdir ? <Fact label="Working folder on the Hermes computer" value={task.workdir} mono /> : null}
    <View style={{ gap: 10 }}>
      <Label heading={3} weight="700">Recent runs</Label>
      {props.runsMessage ? <Label tone="muted">{props.runsMessage}</Label>
        : props.runs === null ? <Label tone="muted">Loading recent runs…</Label>
          : props.runs.length === 0 ? <Label tone="muted">No runs yet. Each time this task runs, it shows up here.</Label>
            : props.runs.map(run => <RunRow key={run.id} run={run} nerd={props.nerd} />)}
    </View>
    {props.nerd ? <View style={{ gap: 12 }}>
      <Label heading={3} weight="700">Details</Label>
      <Fact label="Task ID" value={task.id} mono />
      <Fact label="Schedule sent to Hermes" value={schedule} mono />
      <Fact label="Hermes wording" value={task.scheduleText} mono />
      <Fact label="Results target" value={task.deliver} mono />
      <Fact label="Hermes clock" value={task.hostOffsetMinutes === null ? null : offsetLabel(task.hostOffsetMinutes)} />
      <Fact label="Created" value={task.createdAt ? when(task.createdAt) : null} />
      {task.lastError ? <Fact label="Last problem" value={task.lastError} /> : null}
    </View> : null}
  </View>;
}

function RunRow(props: Readonly<{ run: TaskRun; nerd: boolean }>): JSX.Element {
  const { palette } = useTheme();
  const { run } = props;
  const state = run.active ? 'Running' : run.endedAt ? 'Finished' : 'Stopped';
  const tokens = run.inputTokens !== null && run.outputTokens !== null
    ? `${run.inputTokens.toLocaleString()} tokens in, ${run.outputTokens.toLocaleString()} out` : null;
  return <View role="listitem" style={{ borderWidth: 1, borderColor: palette.line, borderRadius: 10, padding: 10, gap: 2 }}>
    <Label weight="600">{run.startedAt ? when(run.startedAt) : 'Time not recorded'}</Label>
    <Label tone="muted" size={12} selectable>{[state, tokens].filter(Boolean).join(' · ')}</Label>
    {run.summary ? <Label size={13} selectable>{run.summary}</Label> : null}
    {props.nerd ? <Label tone="muted" size={12} selectable mono>{[run.model, run.estimatedCost === null ? null : `estimated ${run.estimatedCost} USD`,
      run.actualCost === null ? null : `actual ${run.actualCost} USD`, run.id].filter(Boolean).join(' · ')}</Label> : null}
  </View>;
}

type WhenKind = SchedulePreset['kind'];
type Draft = Readonly<{ profile: string; name: string; prompt: string; when: WhenKind; time: string; every: number; at: string; custom: string;
  deliver: string; model: string; workdir: string; more: boolean }>;
const WHEN_OPTIONS: readonly Readonly<{ value: WhenKind; label: string }>[] = [
  { value: 'daily', label: 'Every day' }, { value: 'weekdays', label: 'Weekdays (Monday to Friday)' },
  { value: 'hours', label: 'Every few hours' }, { value: 'once', label: 'Once' }, { value: 'custom', label: 'In my own words' },
];
function localInput(iso: string): string {
  const date = new Date(iso);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function tomorrowAtNine(): string {
  const date = new Date(); date.setDate(date.getDate() + 1); date.setHours(9, 0, 0, 0);
  return localInput(date.toISOString());
}
function preset(draft: Draft): SchedulePreset {
  switch (draft.when) {
    case 'daily': case 'weekdays': return { kind: draft.when, time: draft.time };
    case 'hours': return { kind: 'hours', every: draft.every };
    case 'once': { const instant = new Date(draft.at); return { kind: 'once', at: Number.isFinite(instant.getTime()) ? instant.toISOString() : '' }; }
    case 'custom': return { kind: 'custom', text: draft.custom };
  }
}
function initialDraft(editing: Editing, profile: string): Draft {
  const base: Draft = { profile, name: '', prompt: '', when: 'daily', time: '09:00', every: 2, at: tomorrowAtNine(), custom: '',
    deliver: 'local', model: '', workdir: '', more: false };
  if (editing.mode === 'new') return base;
  const { task } = editing;
  const start = presetFor(task.schedule, Date.now());
  return { ...base, name: task.name, prompt: task.prompt ?? '', when: start.kind, deliver: task.deliver,
    model: task.model ?? '', workdir: task.workdir ?? '', more: !!(task.model || task.workdir),
    ...(start.kind === 'daily' || start.kind === 'weekdays' ? { time: start.time } : {}),
    ...(start.kind === 'hours' ? { every: start.every } : {}), ...(start.kind === 'once' ? { at: localInput(start.at) } : {}),
    ...(start.kind === 'custom' ? { custom: start.text } : {}) };
}

export function TaskEditor(props: Readonly<{
  editing: Editing; profile: string; agents: ViewData['agents']; supports: Readonly<{ model: boolean; workdir: boolean }> | null;
  hostOffset: number | null; onClose: () => void; onSaved: (value: TaskSaved) => void; onUncertain: () => void;
  onUnchanged: (task: ScheduledTask) => void;
}>): JSX.Element {
  const call = useCall();
  const [draft, setDraft] = useState<Draft>(() => initialDraft(props.editing, props.profile));
  const [startSchedule] = useState(() => { const request = scheduleRequest(preset(initialDraft(props.editing, props.profile)), Date.now()); return request.ok ? request.text : null; });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<Readonly<{ text: string; uncertain: boolean }> | null>(null);
  const targets = useQuery('schedules.targets', { profile: draft.profile });
  const edit = props.editing.mode === 'edit' ? props.editing.task : null;
  const change = (patch: Partial<Draft>) => setDraft(value => ({ ...value, ...patch }));
  const listed = targets.value?.profile === draft.profile ? targets.value.targets : null;
  const ready = (listed ?? []).filter(target => target.ready);
  const deliverOptions = [...ready.map(target => ({ value: target.id, label: target.name })),
    ...(ready.some(target => target.id === draft.deliver) ? [] : [{ value: draft.deliver, label: draft.deliver === 'local' ? 'Saved on the Hermes computer' : 'Current setting' }])];
  const supports = edit ? edit.stores : props.supports ?? (targets.status === 'loaded' ? { model: true, workdir: true } : { model: false, workdir: false });
  const advanced = supports.model || supports.workdir;

  async function save(): Promise<void> {
    const request = scheduleRequest(preset(draft), Date.now());
    if (!draft.name.trim() || !draft.prompt.trim()) { setError({ text: 'Add what it should do and a short name before saving.', uncertain: false }); return; }
    if (!request.ok) { setError({ text: request.message, uncertain: false }); return; }
    const model = advanced && draft.more ? draft.model.trim() : edit?.model ?? '';
    const workdir = advanced && draft.more ? draft.workdir.trim() : edit?.workdir ?? '';
    setSaving(true); setError(null);
    let result;
    if (!edit) {
      result = await call('schedules.create', { profile: draft.profile, name: draft.name.trim(), prompt: draft.prompt.trim(), schedule: request.text,
        deliver: draft.deliver, ...(model ? { model } : {}), ...(workdir ? { workdir } : {}) });
    } else {
      const changes: Partial<Record<keyof TaskChanges, string>> = {};
      if (draft.name.trim() !== edit.name) changes.name = draft.name.trim();
      if (draft.prompt.trim() !== (edit.prompt ?? '')) changes.prompt = draft.prompt.trim();
      if (request.text !== startSchedule) changes.schedule = request.text;
      if (draft.deliver !== edit.deliver) changes.deliver = draft.deliver;
      if (model !== (edit.model ?? '')) changes.model = model;
      if (workdir !== (edit.workdir ?? '')) changes.workdir = workdir;
      if (Object.keys(changes).length === 0) { setSaving(false); props.onUnchanged(edit); return; }
      result = await call('schedules.update', { profile: draft.profile, id: edit.id, changes });
    }
    setSaving(false);
    if (result.ok) { props.onSaved(result.value); return; }
    setError({ text: result.message, uncertain: result.code === 'unknown' });
    if (result.code === 'unknown') props.onUncertain();
  }
  const verb = edit ? 'Save' : 'Create';
  return <Dialog open title={edit ? 'Edit task' : 'New task'} width={560} onClose={() => { if (!saving) props.onClose(); }} actions={<>
    <Button label="Cancel" disabled={saving} onPress={props.onClose} />
    <Button label={saving ? 'Saving…' : error?.uncertain ? `${verb} anyway` : verb} tone="primary" disabled={saving} onPress={() => { void save(); }} />
  </>}>
    {edit ? <Label tone="muted" size={13}>{`For ${props.agents.find(agent => agent.id === draft.profile)?.name ?? 'this agent'}. Tasks stay with their agent.`}</Label>
      : <SelectField label="Which agent?" value={draft.profile} disabled={saving}
        options={props.agents.map(agent => ({ value: agent.id, label: agent.name }))} onChange={profile => change({ profile, deliver: 'local' })} />}
    <TextField label="What should it do?" multiline rows={4} maxLength={256000} value={draft.prompt} disabled={saving} spellCheck
      placeholder="For example, summarize my unread email and flag anything urgent" onChange={prompt => change({ prompt })} />
    <TextField label="Short name" maxLength={240} value={draft.name} disabled={saving} spellCheck placeholder="Give it a short name"
      onChange={name => change({ name })} />
    <SelectField label="When?" value={draft.when} options={WHEN_OPTIONS} disabled={saving} hint={clockNote(props.hostOffset)}
      onChange={value => change({ when: value })} />
    {draft.when === 'daily' || draft.when === 'weekdays' ? <TextField label="At what time?" type="time" maxLength={5} value={draft.time} disabled={saving}
      onChange={time => change({ time })} /> : null}
    {draft.when === 'hours' ? <SelectField label="How often?" value={String(draft.every)} disabled={saving}
      options={HOUR_CHOICES.map(hours => ({ value: String(hours), label: hours === 1 ? 'Every hour' : `Every ${hours} hours` }))}
      onChange={value => change({ every: Number(value) })} /> : null}
    {draft.when === 'once' ? <TextField label="Date and time" type="datetime-local" maxLength={16} value={draft.at} disabled={saving}
      onChange={at => change({ at })} /> : null}
    {draft.when === 'custom' ? <TextField label="Schedule" maxLength={2048} value={draft.custom} disabled={saving}
      placeholder="For example: every monday 9am, every 30m, or 0 9 * * 1-5"
      hint="Hermes reads plain schedules like these, or a cron line. You'll see how it read yours after saving."
      onChange={custom => change({ custom })} /> : null}
    <SelectField label="Send results to" value={draft.deliver} options={deliverOptions} disabled={saving}
      hint={targets.status === 'failed' ? "Hermes didn't list other places to send results." : 'Results also appear in Recent runs.'}
      onChange={deliver => change({ deliver })} />
    {advanced ? <Toggle label="More options" detail="Model and working folder" value={draft.more} disabled={saving} onChange={more => change({ more })} /> : null}
    {advanced && draft.more && supports.model ? <TextField label="Model (optional)" maxLength={200} value={draft.model} disabled={saving}
      hint="Leave empty to use the agent's usual model." onChange={model => change({ model })} /> : null}
    {advanced && draft.more && supports.workdir ? <TextField label="Working folder on the Hermes computer (optional)" maxLength={4096} mono value={draft.workdir}
      disabled={saving} placeholder="/home/you/project" hint="A full folder path on the computer running Hermes." onChange={workdir => change({ workdir })} /> : null}
    <Banner tone="info" text={edit ? CREDITS : `It runs on its own on this schedule. ${CREDITS}`} />
    {error ? <Banner tone={error.uncertain ? 'warn' : 'error'} text={error.text} /> : null}
  </Dialog>;
}
