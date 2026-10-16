// Create, edit, duplicate and delete agents (Hermes profiles). One manager per
// window owns the open dialog; lists and headers open it through useAgentActions.
// Busy states are still text. Raw profile IDs and models appear only in Nerd Mode.
import type { JSX, ReactNode } from 'react';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native-web';
import { AGENT_COLORS, agentIdProblem, deriveAgentId } from '../../contracts/agents.ts';
import type { ModelOptions } from '../../contracts/agents.ts';
import type { AgentDetails, AgentModelChoice, AgentSaved, AgentUpdateInput } from '../../../apps/desktop/src/shared/calls/agents.ts';
import { useCall, useHost, useQuery } from '../host.tsx';
import type { Query } from '../host.tsx';
import { useTheme } from '../theme.tsx';
import type { AgentView } from '../view-model.ts';
import { Banner, Button, Card, ConfirmDialog, Dialog, MenuButton, RadioList, Row, SelectField, TextField, Toggle } from './controls.tsx';
import type { MenuItem } from './controls.tsx';
import { IconButton, Label, Orb } from './primitives.tsx';

export type AgentActions = Readonly<{ create(): void; edit(id: string): void; duplicate(id: string): void; remove(id: string): void }>;
const ActionsContext = createContext<AgentActions | null>(null);
// null when no computer is connected: callers hide or disable their controls.
export function useAgentActions(): AgentActions | null { return useContext(ActionsContext); }

const COLOR_NAMES: Readonly<Record<string, string>> = Object.freeze({
  '#D27B5B': 'Coral', '#2BA59A': 'Teal', '#4A7BEA': 'Blue', '#E39A2D': 'Amber', '#9B6BD6': 'Violet', '#D2557A': 'Rose',
});
const CONFIRM_VALID_MS = 5 * 60 * 1000;
const ID_PROBLEMS = Object.freeze({
  format: "Use lowercase letters, numbers, - or _, starting with a letter or number, up to 64 characters.",
  reserved: 'Hermes keeps that name for itself. Pick another.',
  taken: 'Another agent already uses this ID.',
});

type Changes = { -readonly [K in keyof Omit<AgentUpdateInput, 'profile'>]: Omit<AgentUpdateInput, 'profile'>[K] };
type Open = Readonly<{ kind: 'create' }> | Readonly<{ kind: 'edit' | 'duplicate' | 'delete'; id: string }>;
type PendingModel = Readonly<{ profile: string; name: string; choice: AgentModelChoice; message: string; asked: number }>;

export function AgentMenu(props: Readonly<{ agent: AgentView }>): JSX.Element | null {
  const actions = useAgentActions();
  if (!actions) return null;
  const items: MenuItem[] = [
    { label: 'Edit agent', onPress: () => actions.edit(props.agent.id) },
    { label: 'Duplicate', onPress: () => actions.duplicate(props.agent.id) },
  ];
  if (!props.agent.isDefault && props.agent.id !== 'default') items.push({ label: 'Delete agent', tone: 'danger', onPress: () => actions.remove(props.agent.id) });
  return <MenuButton label={`More for ${props.agent.name}`} items={items} />;
}

// Disabled with a reason until a computer is connected.
export function AddAgentButton(): JSX.Element {
  const actions = useAgentActions();
  return actions ? <IconButton icon="plus" label="Add agent" onPress={actions.create} />
    : <IconButton icon="plus" label="Add agent. Needs a connected computer" onPress={() => {}} disabled />;
}

export function AgentManager(props: Readonly<{
  agents: readonly AgentView[]; nerdMode: boolean;
  replyingAgentId: string | null; onDeleted: (id: string) => void; children: ReactNode;
}>): JSX.Element {
  const [open, setOpen] = useState<Open | null>(null);
  const [pendingModel, setPendingModel] = useState<PendingModel | null>(null);
  // The host lease. Dialogs close when it changes; their data belonged to the old one.
  const host = useHost();
  const connection = host?.snapshot.status === 'connected' ? host.snapshot.connection : null;
  useEffect(() => { setOpen(null); setPendingModel(null); }, [connection]);
  const actions = useMemo<AgentActions | null>(() => connection === null ? null : Object.freeze({
    create: () => setOpen({ kind: 'create' }), edit: (id: string) => setOpen({ kind: 'edit', id }),
    duplicate: (id: string) => setOpen({ kind: 'duplicate', id }), remove: (id: string) => setOpen({ kind: 'delete', id }),
  }), [connection]);
  const close = () => setOpen(null);
  const agent = open && open.kind !== 'create' ? props.agents.find(entry => entry.id === open.id) ?? null : null;
  const saved = (result: AgentSaved, name: string, choice: AgentModelChoice | null) => {
    if (result.modelConfirm && choice) setPendingModel({ profile: result.profile, name, choice, message: result.modelConfirm, asked: Date.now() });
  };
  let dialog: JSX.Element | null = null;
  if (actions && open?.kind === 'create') {
    dialog = <AgentEditor key="create" agent={null} agents={props.agents} nerdMode={props.nerdMode} onClose={close} onSaved={saved} />;
  } else if (actions && agent && open?.kind === 'edit') {
    dialog = <AgentEditor key={`edit:${agent.id}`} agent={agent} agents={props.agents} nerdMode={props.nerdMode} onClose={close} onSaved={saved}
      onDelete={agent.isDefault || agent.id === 'default' ? undefined : () => setOpen({ kind: 'delete', id: agent.id })} />;
  } else if (actions && agent && open?.kind === 'duplicate') {
    dialog = <DuplicateAgent key={`duplicate:${agent.id}`} agent={agent} agents={props.agents} nerdMode={props.nerdMode} onClose={close} />;
  } else if (actions && agent && open?.kind === 'delete') {
    dialog = <DeleteAgent key={`delete:${agent.id}`} agent={agent} replying={props.replyingAgentId === agent.id} onClose={close}
      onDeleted={() => { close(); props.onDeleted(agent.id); }} />;
  }
  return (
    <ActionsContext.Provider value={actions}>
      {props.children}
      {dialog}
      {actions && pendingModel ? <ModelConfirm key={pendingModel.asked} pending={pendingModel} onAsk={setPendingModel} onClose={() => setPendingModel(null)} /> : null}
    </ActionsContext.Provider>
  );
}

// The host's own warning, then one explicit choice. Cancel keeps the old model.
function ModelConfirm(props: Readonly<{ pending: PendingModel; onAsk: (next: PendingModel) => void; onClose: () => void }>): JSX.Element {
  const call = useCall();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { pending } = props;
  const confirm = async () => {
    setBusy(true); setError('');
    // An approval is good for five minutes; after that Hermes is asked again.
    const result = await call('agents.setModel', { profile: pending.profile, ...pending.choice, confirm: Date.now() - pending.asked < CONFIRM_VALID_MS });
    setBusy(false);
    if (!result.ok) { setError(result.message); return; }
    if (result.value.status === 'confirm') props.onAsk({ ...pending, message: result.value.message, asked: Date.now() });
    else props.onClose();
  };
  return <ConfirmDialog open title="Use a model that may cost more?" confirmLabel="Use this model" busy={busy} error={error}
    body={`${pending.message}\n\nUse ${pending.choice.model} for ${pending.name}? If you cancel, ${pending.name} keeps its current model.`}
    onConfirm={() => { void confirm(); }} onCancel={() => { if (!busy) props.onClose(); }} />;
}

type ModelEntry = Readonly<{ key: string; label: string; choice: AgentModelChoice | null }>;
const modelKey = (choice: AgentModelChoice) => JSON.stringify([choice.provider, choice.model]);
function modelEntries(options: ModelOptions | null, current: AgentModelChoice | null, nerdMode: boolean): readonly ModelEntry[] {
  const entries: ModelEntry[] = [];
  for (const provider of options?.providers ?? []) {
    for (const model of provider.models) entries.push({ key: modelKey({ provider: provider.id, model }), label: `${model} · ${provider.name}`, choice: { provider: provider.id, model } });
  }
  if (current && !entries.some(entry => entry.key === modelKey(current))) {
    entries.unshift({ key: modelKey(current), label: nerdMode ? `${current.model} · ${current.provider}` : current.model, choice: current });
  }
  return entries;
}

function ColorChoice(props: Readonly<{ value: string | null; onChange: (color: string) => void; disabled: boolean }>): JSX.Element {
  const { palette } = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Label size={13} weight="600" nativeID="agent-color-label">Color</Label>
      <View role="radiogroup" aria-labelledby="agent-color-label" style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        {AGENT_COLORS.map(color => (
          <Pressable key={color} role="radio" aria-checked={props.value === color} aria-label={COLOR_NAMES[color] ?? color}
            disabled={props.disabled} onPress={() => props.onChange(color)}
            style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: color, cursor: props.disabled ? 'not-allowed' : 'pointer',
              borderWidth: 3, borderColor: props.value === color ? palette.ink : 'transparent' }} />
        ))}
      </View>
    </View>
  );
}

function Heading(props: Readonly<{ name: string; color: string; detail?: string | undefined }>): JSX.Element {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <Orb color={props.color} size={40} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Label weight="700" size={16} oneLine>{props.name}</Label>
        {props.detail ? <Label size={12} tone="muted" mono selectable oneLine>{props.detail}</Label> : null}
      </View>
    </View>
  );
}

// Consent for copying another agent: its .env (provider keys) comes along.
function CopyConsent(props: Readonly<{ name: string; value: boolean; onChange: (value: boolean) => void; disabled: boolean }>): JSX.Element {
  return (
    <Card>
      <Toggle label="I understand saved keys are copied too" value={props.value} onChange={props.onChange} disabled={props.disabled}
        detail={`${props.name}'s settings can include API keys and sign-ins for AI providers. The new agent gets them as well. bighelp never shows them.`} />
    </Card>
  );
}

type Form = Readonly<{
  name: string; id: string; idEdited: boolean; role: string; summary: string; instructions: string; color: string | null;
  model: string; start: 'blank' | 'copy'; copyFrom: string; consent: boolean;
}>;
const EMPTY_FORM: Form = Object.freeze({ name: '', id: '', idEdited: false, role: '', summary: '', instructions: '', color: null,
  model: '', start: 'blank', copyFrom: '', consent: false });
function formFrom(details: AgentDetails): Form {
  return Object.freeze({ ...EMPTY_FORM, name: details.name, id: details.profile, role: details.role, summary: details.summary,
    instructions: details.instructions, color: details.color,
    model: details.provider && details.model ? modelKey({ provider: details.provider, model: details.model }) : '' });
}

// Create (agent null) or edit. Editing reads the host first and saves only what changed.
function AgentEditor(props: Readonly<{
  agent: AgentView | null; agents: readonly AgentView[]; nerdMode: boolean; onClose: () => void;
  onSaved: (result: AgentSaved, name: string, choice: AgentModelChoice | null) => void; onDelete?: (() => void) | undefined;
}>): JSX.Element {
  const call = useCall();
  const editing = props.agent !== null;
  const details: Query<AgentDetails> = useQuery('agents.details', props.agent ? { profile: props.agent.id } : null);
  const models = useQuery('agents.models', props.agent ? { profile: props.agent.id } : {});
  const [form, setForm] = useState<Form>(EMPTY_FORM);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Readonly<{ code: string; message: string }> | null>(null);
  const [notice, setNotice] = useState('');
  const [locked, setLocked] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const base = editing ? details.value : null;
  useEffect(() => { if (details.value) { setForm(formFrom(details.value)); setTouched(false); } }, [details.value]);
  const update = (changes: Partial<Form>) => { setForm(previous => Object.freeze({ ...previous, ...changes })); setTouched(true); };

  const taken = props.agents.map(agent => agent.id);
  const id = editing ? form.id : form.idEdited ? form.id : deriveAgentId(form.name, taken);
  const source = form.start === 'copy' ? props.agents.find(agent => agent.id === form.copyFrom) ?? null : null;
  const current = base && base.provider && base.model ? { provider: base.provider, model: base.model } : null;
  const entries = modelEntries(models.value, current, props.nerdMode);
  const choice = entries.find(entry => entry.key === form.model)?.choice ?? null;
  const loading = editing && !base;
  const nameError = touched && !form.name.trim() ? 'Enter a name.' : undefined;
  const idProblem = editing ? null : agentIdProblem(id, taken);
  const copyProblem = form.start === 'copy' && (!source || !form.consent);
  const valid = !loading && !!form.name.trim() && idProblem === null && !copyProblem;
  const color = form.color ?? props.agent?.color ?? AGENT_COLORS[0]!;
  const shownName = form.name.trim() || (editing ? props.agent?.name ?? '' : 'New agent');

  const changes = (): Changes | null => {
    if (!base) return null;
    const result: Changes = {};
    if (form.name.trim() !== base.name.trim()) result.title = form.name.trim();
    if (form.summary.trim() !== base.summary.trim()) result.summary = form.summary.trim();
    if (form.color && form.color !== base.color) result.color = form.color;
    if (form.role.trim() !== base.role.trim()) { result.role = form.role.trim(); result.roleVersion = base.roleVersion; }
    if (form.instructions !== base.instructions) { result.instructions = form.instructions; result.instructionsVersion = base.instructionsVersion; }
    if (choice && form.model !== (current ? modelKey(current) : '')) result.model = choice;
    if (result.title !== undefined || result.summary !== undefined || result.color !== undefined) result.revision = base.revision;
    return result;
  };
  const dirty = touched && (!editing || Object.keys(changes() ?? {}).length > 0);

  const save = async () => {
    setTouched(true);
    if (!valid || busy || locked) return;
    setBusy(true); setError(null); setNotice('');
    const name = form.name.trim();
    let result;
    if (!base) {
      result = await call('agents.create', {
        id, title: name, ...(form.role.trim() ? { role: form.role.trim() } : {}), ...(form.summary.trim() ? { summary: form.summary.trim() } : {}),
        ...(form.instructions.trim() ? { instructions: form.instructions } : {}), ...(form.color ? { color: form.color } : {}),
        ...(choice ? { model: choice } : {}), ...(source ? { copyFrom: source.id, copyConsent: true as const } : {}),
      });
    } else {
      const update = changes();
      if (!update || Object.keys(update).length === 0) { setBusy(false); props.onClose(); return; }
      result = await call('agents.update', { profile: base.profile, ...update });
    }
    setBusy(false);
    if (!result.ok) {
      setError({ code: result.code, message: result.message });
      // A create that may have happened is never retried from this form.
      if (!base && result.code === 'unknown') setLocked(true);
      return;
    }
    props.onSaved(result.value, name, choice);
    if (result.value.partial) {
      setNotice(result.value.partial);
      if (base) details.reload(); else setLocked(true);
      return;
    }
    props.onClose();
  };
  const cancel = () => { if (busy) return; if (dirty && !locked) setDiscarding(true); else props.onClose(); };

  const modelHint = models.status === 'failed' ? "Models couldn't be loaded. You can pick one later."
    : editing ? undefined : 'You can change this later.';
  const title = editing ? `Edit ${props.agent?.name ?? 'agent'}` : 'New agent';
  return (
    <Dialog open title={title} width={560} onClose={cancel} actions={<>
      {props.onDelete && !locked ? <View style={{ marginRight: 'auto' }}><Button label="Delete agent…" tone="quiet" disabled={busy} onPress={props.onDelete} /></View> : null}
      <Button label={locked ? 'Close' : 'Cancel'} onPress={locked ? props.onClose : cancel} disabled={busy} />
      {locked ? null : <Button label={busy ? (editing ? 'Saving…' : 'Creating…') : editing ? 'Save' : 'Create agent'} tone="primary"
        disabled={busy || !valid} onPress={() => { void save(); }} />}
    </>}>
      {loading ? (
        details.status === 'failed'
          ? <Banner tone="error" text={details.message}><Button label="Try again" compact onPress={details.reload} /></Banner>
          : <Label tone="muted">Loading this agent…</Label>
      ) : (
        <View style={{ gap: 14 }}>
          <Heading name={shownName} color={color} detail={props.nerdMode ? (editing ? `${id}${current ? ` · ${current.provider} / ${current.model}` : ''}` : id) : undefined} />
          <TextField label="Name" value={form.name} onChange={name => update({ name })} maxLength={200} required autoFocus={!editing}
            error={nameError} placeholder="Give your agent a name" disabled={busy || locked} />
          {!editing && props.nerdMode ? (
            <TextField label="Profile ID" value={id} mono maxLength={64} disabled={busy || locked}
              onChange={value => update({ id: value, idEdited: true })} error={form.name.trim() || form.idEdited ? (idProblem ? ID_PROBLEMS[idProblem] : undefined) : undefined}
              hint="The name Hermes uses for this agent's folder. It can't be changed later." />
          ) : null}
          <TextField label="What it's for" value={form.role} onChange={role => update({ role })} maxLength={4096}
            placeholder="e.g. Travel planner" disabled={busy || locked} />
          <TextField label="Short summary" value={form.summary} onChange={summary => update({ summary })} maxLength={4096}
            placeholder="One line about what it does" hint="Shown under the name. Leave blank to use what it's for." disabled={busy || locked} />
          {!editing ? (
            <RadioList label="Start from" value={form.start} disabled={busy || locked} onChange={start => update({ start })} options={[
              { value: 'blank', label: 'Blank', detail: "Hermes' standard setup and skills." },
              { value: 'copy', label: 'Copy settings from another agent', detail: 'Copies its instructions, skills, memory and saved keys. Chats are not copied.' },
            ]} />
          ) : null}
          {!editing && form.start === 'copy' ? (
            <>
              <SelectField label="Copy from" value={form.copyFrom} disabled={busy || locked} onChange={copyFrom => update({ copyFrom, consent: false })}
                options={[{ value: '', label: 'Choose an agent' }, ...props.agents.map(agent => ({ value: agent.id, label: agent.name }))]} />
              {source ? <CopyConsent name={source.name} value={form.consent} disabled={busy || locked} onChange={consent => update({ consent })} /> : null}
            </>
          ) : null}
          <TextField label="Personality and instructions" multiline rows={7} value={form.instructions} maxLength={256000}
            onChange={instructions => update({ instructions })} disabled={busy || locked} spellCheck
            placeholder={`What should ${form.name.trim() || 'your agent'} help you with? How should it talk?`}
            hint={editing ? undefined : source ? `Leave blank to keep ${source.name}'s instructions.` : "Leave blank to start with Hermes' standard instructions."} />
          <ColorChoice value={form.color} disabled={busy || locked} onChange={value => update({ color: value })} />
          <SelectField label="Default model" value={form.model} disabled={busy || locked || models.status !== 'loaded'} {...(modelHint ? { hint: modelHint } : {})}
            onChange={model => update({ model })} options={[
              ...(editing && current ? [] : [{ value: '', label: editing ? 'Not set' : "Use the computer's default model" }]),
              ...entries.map(entry => ({ value: entry.key, label: entry.label })),
            ]} />
          {notice ? <Banner tone="warn" text={notice} /> : null}
          {error ? (
            <Banner tone="error" text={error.message}>
              {error.code === 'conflict' && editing ? <Button label="Reload" compact onPress={() => { setError(null); details.reload(); }} /> : null}
            </Banner>
          ) : null}
        </View>
      )}
      <ConfirmDialog open={discarding} title="Discard agent changes?" body="Your unsaved changes will be lost." confirmLabel="Discard changes"
        tone="danger" onConfirm={() => { setDiscarding(false); props.onClose(); }} onCancel={() => setDiscarding(false)} />
    </Dialog>
  );
}

function DuplicateAgent(props: Readonly<{ agent: AgentView; agents: readonly AgentView[]; nerdMode: boolean; onClose: () => void }>): JSX.Element {
  const call = useCall();
  const [name, setName] = useState(`${props.agent.name} copy`);
  const [customId, setCustomId] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [locked, setLocked] = useState(false);
  const taken = props.agents.map(agent => agent.id);
  const id = customId ?? deriveAgentId(name, taken);
  const problem = agentIdProblem(id, taken);
  const valid = !!name.trim() && problem === null && consent;
  const duplicate = async () => {
    if (!valid || busy || locked) return;
    setBusy(true); setError('');
    const result = await call('agents.create', { id, title: name.trim(), copyFrom: props.agent.id, copyConsent: true });
    setBusy(false);
    if (!result.ok) { setError(result.message); if (result.code === 'unknown') setLocked(true); return; }
    if (result.value.partial) { setError(result.value.partial); setLocked(true); return; }
    props.onClose();
  };
  return (
    <Dialog open title={`Duplicate ${props.agent.name}`} width={520} onClose={() => { if (!busy) props.onClose(); }} actions={<>
      <Button label={locked ? 'Close' : 'Cancel'} onPress={props.onClose} disabled={busy} />
      {locked ? null : <Button label={busy ? 'Duplicating…' : 'Duplicate'} tone="primary" disabled={busy || !valid} onPress={() => { void duplicate(); }} />}
    </>}>
      <View style={{ gap: 14 }}>
        <TextField label="Name for the copy" value={name} onChange={setName} maxLength={200} required autoFocus disabled={busy || locked}
          error={name.trim() ? undefined : 'Enter a name.'} />
        {props.nerdMode ? <TextField label="Profile ID" value={id} mono maxLength={64} onChange={setCustomId} disabled={busy || locked}
          error={problem ? ID_PROBLEMS[problem] : undefined} /> : null}
        <Card title="What gets copied">
          <Row first title="Instructions and personality" detail="Copied" />
          <Row title="Skills, memory and settings" detail="Copied" />
          <Row title="Saved keys and sign-ins" detail="Copied" />
          <Row title="Chats" detail="Not copied" />
        </Card>
        <CopyConsent name={props.agent.name} value={consent} onChange={setConsent} disabled={busy || locked} />
        {error ? <Banner tone={locked ? 'warn' : 'error'} text={error} /> : null}
      </View>
    </Dialog>
  );
}

// Deletes only after the host's review: what goes, and whether Hermes allows it.
function DeleteAgent(props: Readonly<{ agent: AgentView; replying: boolean; onClose: () => void; onDeleted: () => void }>): JSX.Element {
  const call = useCall();
  const review = useQuery('agents.deleteReview', props.replying ? null : { profile: props.agent.id });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const name = props.agent.name;
  const close = () => { if (!busy) props.onClose(); };
  if (props.replying) {
    return <Dialog open title={`Can't delete ${name} right now`} onClose={close} actions={<Button label="Close" onPress={close} />}>
      <Label>This agent is still replying. Wait for it to finish, then delete it. Nothing was deleted.</Label>
    </Dialog>;
  }
  const value = review.value;
  if (!value) {
    return <Dialog open title={`Delete ${name}?`} onClose={close} actions={<>
      <Button label="Cancel" onPress={close} /><Button label="Delete agent" tone="danger" disabled onPress={() => {}} />
    </>}>
      {review.status === 'failed'
        ? <Banner tone="error" text={review.message}><Button label="Try again" compact onPress={review.reload} /></Banner>
        : <Label tone="muted">Checking what will be deleted…</Label>}
    </Dialog>;
  }
  if (!value.canDelete) {
    return <Dialog open title={`Can't delete ${name}`} onClose={close} actions={<Button label="Close" onPress={close} />}>
      <Label>{value.reason ?? "Hermes won't delete this agent."}</Label>
    </Dialog>;
  }
  const skills = value.skills === 1 ? '1 skill' : `${value.skills} skills`;
  const confirm = async () => {
    setBusy(true); setError('');
    const result = await call('agents.delete', { profile: value.profile, token: value.token });
    setBusy(false);
    if (result.ok) { props.onDeleted(); return; }
    setError(result.message);
    if (result.code === 'conflict') review.reload();
  };
  return <ConfirmDialog open title={`Delete ${name}?`} confirmLabel={busy ? 'Deleting…' : 'Delete agent'} tone="danger" busy={busy} error={error}
    body={`This permanently deletes ${name} from your computer, including its instructions, memory, ${skills}, settings, saved keys and chats. This can't be undone.`}
    onConfirm={() => { void confirm(); }} onCancel={close} />;
}
