// Everyday Settings pages. Local choices go through the preference callback
// (main stores them); host facts use finite named calls. Plain words, no IDs.
import type { JSX, ReactNode } from 'react';
import { Children, useReducer, useRef, useState } from 'react';
import { View } from 'react-native-web';
import { approvalSummary, bugReport, cleanPersonName, MODEL_FLOW_IDLE, modelKey, modelOptions, parseModelKey,
  PERSON_NAME_LIMIT, personNameChange, reduceModelFlow } from '../../domain/settings.ts';
import type { ModelPick } from '../../domain/settings.ts';
import type { Appearance } from '../../domain/shell.ts';
import type { Preferences } from '../../../apps/desktop/src/shared/preferences.ts';
import type { ShellInfo } from '../../../apps/desktop/src/shared/shell-info.ts';
import type { AgentView } from '../view-model.ts';
import { useCall, useHost, useQuery } from '../host.tsx';
import type { Query } from '../host.tsx';
import { useTheme } from '../theme.tsx';
import { Banner, Button, Card, ConfirmDialog, PageBody, RadioList, Row, SelectField, TextField, Toggle } from './controls.tsx';
import { Label } from './primitives.tsx';

export type ChangePreferences = (changes: Partial<Preferences>) => Promise<boolean>;
export const HERMES_DOCS = 'https://hermes-agent.nousresearch.com/docs/';
export const HERMES_SOURCE = 'https://github.com/NousResearch/hermes-agent';

// Rows inside a Card, with a line between each.
export function Lines(props: Readonly<{ children: ReactNode }>): JSX.Element {
  const { palette } = useTheme();
  return <>{Children.toArray(props.children).map((child, index) => (
    <View key={index} style={index ? { borderTopWidth: 1, borderTopColor: palette.line } : undefined}>{child}</View>))}</>;
}

export function Note(props: Readonly<{ children: string }>): JSX.Element {
  return <Label size={12} tone="muted">{props.children}</Label>;
}

// Where host-backed parts of a page stand right now.
export function useConnection(): Readonly<{ preview: boolean; connected: boolean; hostLabel: string }> {
  const host = useHost();
  const connected = host?.snapshot.status === 'connected';
  return { preview: !host, connected, hostLabel: (connected ? host?.snapshot.data.host?.label : undefined) || 'your computer' };
}

// One sentence for a host read that could not be shown.
export function QueryProblem(props: Readonly<{ query: Query<unknown>; what: string }>): JSX.Element | null {
  const { query } = props;
  if (query.status !== 'failed') return null;
  if (query.code === 'unsupported') return <Note>{`This version of Hermes doesn't share ${props.what}.`}</Note>;
  return <Banner tone="error" text={query.message}><Button label="Try again" compact onPress={query.reload} /></Banner>;
}

export function Offline(props: Readonly<{ preview: boolean; what: string }>): JSX.Element {
  return <Note>{props.preview ? "This preview doesn't connect to a computer." : `Connect to your computer to see ${props.what}.`}</Note>;
}

// Agent choice for per-agent host settings. Hidden when there is only one agent.
export function useAgentChoice(agents: readonly AgentView[]): readonly [string | null, (id: string) => void] {
  const [chosen, setChosen] = useState<string | null>(null);
  const fallback = agents.find(agent => agent.id === 'default')?.id ?? agents[0]?.id ?? null;
  const profile = chosen !== null && agents.some(agent => agent.id === chosen) ? chosen : fallback;
  return [profile, setChosen];
}
export function AgentField(props: Readonly<{ agents: readonly AgentView[]; value: string | null; onChange: (id: string) => void;
  disabled?: boolean }>): JSX.Element | null {
  if (props.agents.length < 2 || props.value === null) return null;
  return <SelectField label="Agent" value={props.value} disabled={props.disabled ?? false} onChange={props.onChange}
    options={props.agents.map(agent => ({ value: agent.id, label: agent.name }))} />;
}

// ---- You ----------------------------------------------------------------------

export function YouPage(props: Readonly<{ preferences: Preferences; onChange: ChangePreferences }>): JSX.Element {
  const saved = props.preferences.personName;
  const [typed, setTyped] = useState(saved);
  const [status, setStatus] = useState('');
  const change = personNameChange(saved, typed);
  const invalid = cleanPersonName(typed) === null;
  const save = (name: string) => {
    void props.onChange({ personName: name }).then(ok => {
      if (ok) { setTyped(name); setStatus(name ? 'Name saved.' : 'Name removed.'); }
    });
  };
  return (
    <PageBody>
      <Card padded>
        <TextField label="Your name" value={typed} maxLength={PERSON_NAME_LIMIT + 20} placeholder="You"
          onChange={value => { setTyped(value); setStatus(''); }} onSubmit={() => { if (change) save(change.personName); }}
          error={invalid ? `Use up to ${PERSON_NAME_LIMIT} characters on one line.` : undefined} />
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <Button label="Save name" tone="primary" disabled={!change} onPress={() => { if (change) save(change.personName); }} />
          {saved ? <Button label="Remove name" onPress={() => save('')} /> : null}
          {status ? <View role="status"><Label size={13} tone="muted">{status}</Label></View> : null}
        </View>
      </Card>
      <Note>Kept on this computer only. Your agents don't see your name in this version of bighelp.</Note>
    </PageBody>
  );
}

// ---- Assistants -----------------------------------------------------------------

export function AssistantsPage(props: Readonly<{ agents: readonly AgentView[] }>): JSX.Element {
  const { preview, connected, hostLabel } = useConnection();
  const call = useCall();
  const [profile, setProfile] = useAgentChoice(props.agents);
  const models = useQuery('settings.models', connected && profile ? { profile } : null);
  const [flow, dispatch] = useReducer(reduceModelFlow, MODEL_FLOW_IDLE);
  const sequence = useRef(0);
  const agentName = props.agents.find(agent => agent.id === profile)?.name ?? 'this agent';
  const busy = flow.phase === 'saving' || flow.phase === 'confirm';
  const send = (target: string, pick: ModelPick, confirmed: boolean) => {
    const request = ++sequence.current;
    void call('settings.setModel', { profile: target, provider: pick.provider, model: pick.model, confirmExpensive: confirmed })
      .then(result => {
        if (request !== sequence.current) return;
        dispatch({ type: 'reply', result, now: Date.now() });
        // Show what the computer says now. A read, never a resend.
        if (result.ok ? result.value.status === 'saved' : result.code !== 'invalid') models.reload();
      });
  };
  const choose = (value: string) => {
    const pick = parseModelKey(value), current = models.value?.current;
    if (!pick || !profile || (current && modelKey(current) === value)) return;
    const next = reduceModelFlow(flow, { type: 'pick', pick });
    if (next === flow) return;
    dispatch({ type: 'pick', pick }); send(profile, pick, false);
  };
  const confirm = () => {
    const now = Date.now();
    const next = reduceModelFlow(flow, { type: 'confirm', now });
    dispatch({ type: 'confirm', now });
    if (next.phase === 'saving' && profile) send(profile, next.pick, true);
  };
  const choices = models.value;
  const options = choices ? modelOptions(choices) : [];
  const current = choices?.current ?? null;
  const currentProvider = current ? choices?.providers.find(row => row.id === current.provider)?.name : undefined;
  return (
    <PageBody>
      <Card title="Default model" detail="The model new chats start with. Chats that are already open keep theirs." padded>
        {!connected ? <Offline preview={preview} what="its models" /> : <>
          <AgentField agents={props.agents} value={profile} disabled={busy}
            onChange={id => { ++sequence.current; dispatch({ type: 'reset' }); setProfile(id); }} />
          {models.status === 'loading' && !choices ? <Label tone="muted">Loading models…</Label> : null}
          <QueryProblem query={models} what="its models" />
          {choices ? <>
            <Row first title={current ? current.model : 'No model chosen yet'}
              detail={current ? `Used by ${agentName} for new chats${currentProvider ? ` · ${currentProvider}` : ''}` : undefined} />
            {options.length ? <SelectField label="Model for new chats" disabled={busy} onChange={choose}
              value={current ? modelKey(current) : ''}
              options={current ? options : [{ value: '', label: 'Choose a model' }, ...options]} />
              : <Note>No models are ready on this computer yet. Sign in to a model provider in Hermes first.</Note>}
          </> : null}
          {flow.phase === 'saving' ? <View role="status"><Label tone="muted">Saving…</Label></View> : null}
          {flow.phase === 'saved' ? <View role="status"><Label tone="successInk">{`Saved. New chats with ${agentName} start with ${flow.pick.model}.`}</Label></View> : null}
          {flow.phase === 'failed' ? <Banner tone={flow.unknown ? 'warn' : 'error'} text={flow.message} /> : null}
        </>}
      </Card>
      <Note>{`Each agent has its own default model. ${props.agents.length > 1 ? 'Pick the agent above, or' : 'You can also'} change it in Agents. Models run on ${hostLabel}.`}</Note>
      <ConfirmDialog open={flow.phase === 'confirm'} title="Use this model?" confirmLabel="Use this model"
        body={flow.phase === 'confirm' ? flow.message : ''} onConfirm={confirm} onCancel={() => dispatch({ type: 'cancel' })} />
    </PageBody>
  );
}

// ---- Appearance -------------------------------------------------------------------

const LOOKS = [
  { value: 'automatic', label: 'Automatic', detail: 'Follow this computer' },
  { value: 'light', label: 'Light', detail: 'Cream page' },
  { value: 'dark', label: 'Dark', detail: 'Graphite page' },
] as const;
const TEXT_SIZES = [
  { value: 'small', label: 'Small' }, { value: 'default', label: 'Default' },
  { value: 'large', label: 'Large' }, { value: 'larger', label: 'Larger' },
] as const;

export function AppearancePage(props: Readonly<{ value: Appearance; onChange: (value: Appearance) => void;
  preferences: Preferences; onPreferences: ChangePreferences }>): JSX.Element {
  return (
    <PageBody>
      <RadioList label="Look" value={props.value} options={LOOKS} onChange={props.onChange} />
      <RadioList label="Text size" value={props.preferences.textSize} options={TEXT_SIZES}
        onChange={textSize => { void props.onPreferences({ textSize }); }} />
      <Note>Stays on this computer only. Bubble and page colors come later.</Note>
    </PageBody>
  );
}

// ---- Chat ---------------------------------------------------------------------------

const BUSY_MODES = [
  { value: 'steer', label: 'Steer', detail: 'Send context into the live turn so the agent can adjust its response.' },
  { value: 'queue', label: 'Queue', detail: 'Wait for the live turn to finish, then send this as the next message.' },
  { value: 'interrupt', label: 'Interrupt and send', detail: 'Stop the live turn and immediately continue with this message.' },
] as const;

function Reactions(): JSX.Element | null {
  const { connected, hostLabel } = useConnection();
  const call = useCall();
  const reactions = useQuery('settings.reactions', connected ? {} : null);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<Readonly<{ text: string; unknown: boolean }> | null>(null);
  // Hide what this computer's Hermes cannot do.
  if (!connected || (reactions.status === 'failed' && reactions.code === 'unsupported')) return null;
  const change = (on: boolean) => {
    if (saving) return;
    setSaving(true); setProblem(null);
    void call('settings.setReactions', { on }).then(result => {
      setSaving(false);
      if (!result.ok) setProblem({ text: result.message, unknown: result.code === 'unknown' });
      reactions.reload();
    });
  };
  return (
    <Card title="Emoji reactions" detail={`Saved on ${hostLabel}, so other Hermes apps there follow it too.`}>
      {reactions.value ? <Toggle label="Agents can react with an emoji" value={reactions.value.on} disabled={saving}
        detail={saving ? 'Saving…' : "bighelp doesn't show reactions yet, so a reply that is only a reaction looks empty here."}
        onChange={change} /> : <View style={{ padding: 14 }}>
          {reactions.status === 'failed' ? <QueryProblem query={reactions} what="this setting" /> : <Label tone="muted">Loading…</Label>}
        </View>}
      {problem ? <View style={{ padding: 10 }}><Banner tone={problem.unknown ? 'warn' : 'error'} text={problem.text} /></View> : null}
    </Card>
  );
}

export function ChatPage(props: Readonly<{ preferences: Preferences; onChange: ChangePreferences }>): JSX.Element {
  const { preferences: p, onChange } = props;
  return (
    <PageBody>
      <Card title="Replies">
        <Lines>
          <Toggle label="Show reasoning" detail="Show the agent's thinking when Hermes shares it." value={p.showReasoning}
            onChange={showReasoning => { void onChange({ showReasoning }); }} />
          <Toggle label="Fold finished turns" detail="Tuck tool steps away once a reply is done." value={p.foldFinishedTurns}
            onChange={foldFinishedTurns => { void onChange({ foldFinishedTurns }); }} />
        </Lines>
      </Card>
      <RadioList label="While an agent is working" value={p.busyMode} options={BUSY_MODES}
        onChange={busyMode => { void onChange({ busyMode }); }} />
      <Card title="Sending">
        <Toggle label="Enter sends" value={p.enterToSend} onChange={enterToSend => { void onChange({ enterToSend }); }}
          detail={p.enterToSend ? 'Shift+Enter starts a new line.' : 'Enter starts a new line. Use the Send button to send.'} />
      </Card>
      <Reactions />
    </PageBody>
  );
}

// ---- Notifications ---------------------------------------------------------------------

export function NotificationsPage(props: Readonly<{ preferences: Preferences; onChange: ChangePreferences }>): JSX.Element {
  const { preferences: p, onChange } = props;
  return (
    <PageBody>
      <Card title="Alert me">
        <Lines>
          <Toggle label="When an agent needs your OK or has a question" value={p.notifyAttention}
            onChange={notifyAttention => { void onChange({ notifyAttention }); }} />
          <Toggle label="When a reply finishes" value={p.notifyReplies}
            onChange={notifyReplies => { void onChange({ notifyReplies }); }} />
          <Toggle label="Show message text in notifications" detail="When off, alerts say which agent wrote, not what it said."
            value={p.notificationPreview} onChange={notificationPreview => { void onChange({ notificationPreview }); }} />
        </Lines>
      </Card>
      <Card title="When you close the window">
        <Lines>
          <Toggle label="Keep bighelp running in the background when you close the window" value={p.keepRunningInTray}
            onChange={keepRunningInTray => { void onChange({ keepRunningInTray }); }} />
          <Toggle label="Open bighelp when you sign in to this computer" value={p.openAtLogin}
            onChange={openAtLogin => { void onChange({ openAtLogin }); }} />
        </Lines>
      </Card>
      <Note>Alerts only arrive while bighelp is running. Quitting bighelp stops them.</Note>
    </PageBody>
  );
}

// ---- Permissions -------------------------------------------------------------------------

export function PermissionsPage(props: Readonly<{ agents: readonly AgentView[] }>): JSX.Element {
  const { preview, connected, hostLabel } = useConnection();
  const [profile, setProfile] = useAgentChoice(props.agents);
  const approvals = useQuery('settings.approvals', connected && profile ? { profile } : null);
  const summary = approvals.value ? approvalSummary(approvals.value.mode) : null;
  return (
    <PageBody>
      <Card title="This computer">
        <Lines>
          <Row title="Camera, microphone and location" detail="bighelp doesn't use them." />
          <Row title="Files" detail="bighelp opens a file only when you choose one." />
        </Lines>
      </Card>
      <Card title="Where agents work" detail={`Agents run on ${hostLabel}, not inside this app.`} padded>
        {!connected ? <Offline preview={preview} what="how agents ask before risky actions" /> : <>
          <AgentField agents={props.agents} value={profile} onChange={setProfile} />
          {approvals.status === 'loading' && !summary ? <Label tone="muted">Loading…</Label> : null}
          <QueryProblem query={approvals} what="how agents ask before risky actions" />
          {summary ? <View style={{ gap: 2 }}>
            <Label weight="600">{summary.title}</Label>
            <Label size={13} tone={summary.asks ? 'muted' : 'warnInk'}>{summary.detail}</Label>
          </View> : null}
        </>}
      </Card>
      <Note>To change how agents ask, use Hermes on that computer.</Note>
    </PageBody>
  );
}

// ---- Help & feedback -------------------------------------------------------------------------

export function HelpPage(props: Readonly<{ shell?: ShellInfo | undefined }>): JSX.Element {
  const host = useHost();
  const { connected, hostLabel } = useConnection();
  const about = useQuery('host.about', connected ? {} : null);
  const [copied, setCopied] = useState('');
  const appVersion = props.shell?.appVersion || 'Unknown';
  const info = about.value;
  const hermes = !connected ? 'Not connected' : info?.version
    ? `${info.version}${info.releaseDate ? ` · released ${info.releaseDate}` : ''}` : about.status === 'failed' ? 'Unknown' : 'Loading…';
  const plugin = !connected ? 'Not connected' : !info ? (about.status === 'failed' ? 'Unknown' : 'Loading…')
    : info.plugin.installed ? (info.plugin.version ?? 'Installed') : 'Not installed';
  const copy = () => {
    if (!host) return;
    const text = bugReport({ appVersion, system: props.shell?.system || 'Unknown', connection: host.snapshot.status,
      hermesVersion: info?.version ?? null, hermesReleaseDate: info?.releaseDate ?? null,
      plugin: info ? { installed: info.plugin.installed, version: info.plugin.version } : null });
    void host.api.copyText(text).then(ok => setCopied(ok ? 'Copied. Paste the details into your report.' : 'Could not copy. Try again.'));
  };
  const open = (url: string) => { void host?.api.openLink(url); };
  return (
    <PageBody>
      <Card title="Versions">
        <Lines>
          <Row title="bighelp" detail={appVersion} selectable />
          <Row title={`Hermes on ${hostLabel}`} detail={hermes} selectable />
          <Row title="bighelp plugin" detail={plugin} selectable />
        </Lines>
      </Card>
      <Card title="Report a problem" detail="Copies versions, this computer's system and whether bighelp is connected. No messages, addresses or sign-in details." padded>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <Button label="Copy details for a bug report" icon="copy" disabled={!host} onPress={copy} />
          {copied ? <View role="status"><Label size={13} tone="muted">{copied}</Label></View> : null}
        </View>
      </Card>
      <Card title="Guides">
        <Lines>
          <Row title="Hermes documentation" detail="Setup, models, tools and more">
            <Button label="Open" compact tone="quiet" accessibleLabel="Open Hermes documentation" disabled={!host} onPress={() => open(HERMES_DOCS)} />
          </Row>
          <Row title="Hermes on GitHub" detail="Source code and known issues">
            <Button label="Open" compact tone="quiet" accessibleLabel="Open Hermes on GitHub" disabled={!host} onPress={() => open(HERMES_SOURCE)} />
          </Row>
        </Lines>
      </Card>
      <Note>Links open in your web browser.</Note>
    </PageBody>
  );
}
