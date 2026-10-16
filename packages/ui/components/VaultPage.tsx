// Vault: the agent's saved logins and password managers on the Hermes computer
// (HERMES_API.md §9). Lists show labels, sites and usernames, never secrets.
// Passwords are typed into write-only fields and sent once; bighelp keeps no copy.
import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native-web';
import { LOCAL_SOURCE, siteName, vaultSite, VAULT_LIMITS } from '../../contracts/vault.ts';
import type { VaultItem, VaultSource } from '../../contracts/vault.ts';
import { useCall, useHost, useQuery } from '../host.tsx';
import { useTheme } from '../theme.tsx';
import type { ViewData } from '../view-model.ts';
import { ContextColumn } from './ContextList.tsx';
import { Banner, Button, ConfirmDialog, Dialog, PageBody, SelectField, TextField, Toggle } from './controls.tsx';
import { Fact, useAgentChoice } from './FunctionLayout.tsx';
import { Caption, Empty, ListRow } from './ListParts.tsx';
import { Icon, IconButton, Label, PageHead } from './primitives.tsx';
import { SecretField, takeSecret, useSecretRef } from './SecretField.tsx';

type Selection = Readonly<{ kind: 'item'; id: string }> | Readonly<{ kind: 'manager'; name: string }> | Readonly<{ kind: 'add' }> | null;
type Message = Readonly<{ tone: 'success' | 'error' | 'warn'; text: string }> | null;
const KIND_NAMES: Readonly<Record<VaultItem['kind'], string>> = Object.freeze({ login: 'Login', payment: 'Card', address: 'Address' });

function sourceName(name: string, sources: readonly VaultSource[]): string {
  return name === LOCAL_SOURCE ? 'Hermes vault' : sources.find(source => source.name === name)?.displayName ?? name;
}
function managerState(source: VaultSource): string {
  return !source.enabled ? 'Off' : source.unlocked ? 'Unlocked' : 'Locked';
}
function itemLine(item: VaultItem, sources: readonly VaultSource[]): string {
  return [KIND_NAMES[item.kind], item.site ? siteName(item.site) : null, item.username,
    item.source === LOCAL_SOURCE ? null : `From ${sourceName(item.source, sources)}`].filter(Boolean).join(' · ');
}
function addedOn(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

export function VaultPage(props: Readonly<{
  data: ViewData; nerdMode: boolean; narrow: boolean; panes: Readonly<{ list: boolean; detail: boolean }>;
  onOpenDetail: () => void; onBack?: (() => void) | undefined;
}>): JSX.Element {
  const { palette } = useTheme();
  const host = useHost();
  const call = useCall();
  const agents = props.data.agents;
  const [profile, setChosen] = useAgentChoice(agents);
  const agentName = agents.find(agent => agent.id === profile)?.name ?? 'This agent';
  const connected = host?.snapshot.status === 'connected';
  const vault = useQuery('vault.read', connected && profile ? { profile } : null);
  const [selection, setSelection] = useState<Selection>(null);
  const [message, setMessage] = useState<Message>(null);
  const [removing, setRemoving] = useState<VaultItem | null>(null);
  const [unlocking, setUnlocking] = useState<VaultSource | null>(null);
  const [busy, setBusy] = useState('');
  const [dialogError, setDialogError] = useState('');

  const items = vault.value?.items ?? [];
  const sources = vault.value?.sources ?? [];
  const managers = sources.filter(source => source.name !== LOCAL_SOURCE && source.installed);
  const selectedItem = selection?.kind === 'item' ? items.find(item => item.id === selection.id) ?? null : null;
  const selectedManager = selection?.kind === 'manager' ? managers.find(source => source.name === selection.name) ?? null : null;
  // A row that disappeared after a reload is no longer selected.
  useEffect(() => {
    if (vault.status === 'loaded' && ((selection?.kind === 'item' && !selectedItem) || (selection?.kind === 'manager' && !selectedManager))) setSelection(null);
  }, [vault.status, selection, selectedItem, selectedManager]);

  let status: string | null = null;
  if (!connected) status = 'Connect to your computer to open the vault.';
  else if (agents.length === 0) status = 'No agents are available on this computer.';
  else if (!profile) status = 'Choose an agent to open its vault.';
  else if (vault.status === 'failed') status = vault.message;
  else if (!vault.value) status = 'Opening the vault…';
  const ready = status === null && !!profile;
  const open = (next: Selection) => { setSelection(next); setMessage(null); props.onOpenDetail(); };

  // Every write: one call, plain result words, and a fresh read after it.
  async function run<T>(label: string, perform: () => Promise<Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; code: string; message: string }>>,
    done: (value: T) => Message): Promise<string | null> {
    setBusy(label);
    try {
      const result = await perform();
      if (result.ok) { setMessage(done(result.value)); vault.reload(); return null; }
      if (result.code === 'unknown') vault.reload();
      return result.message;
    } finally { setBusy(''); }
  }

  let detail: JSX.Element;
  let title = 'Vault';
  if (status !== null) {
    detail = <View role="status"><Label tone="muted">{status}</Label></View>;
  } else if (selection?.kind === 'add' && profile) {
    title = 'Add a login';
    detail = <AddLogin agentName={agentName} hostLabel={props.data.host?.label ?? 'your computer'} busy={busy === 'add'}
      onCancel={() => setSelection(null)}
      onSave={async login => {
        const failure = await run('add', () => call('vault.add', { profile, ...login }), () => ({ tone: 'success', text: `Saved for ${agentName}.` }));
        if (failure === null) setSelection(null);
        return failure;
      }} />;
  } else if (selectedItem && profile) {
    const item = selectedItem;
    title = item.label;
    const added = addedOn(item.addedAt);
    detail = <View style={{ gap: 16 }}>
      <Fact label="Kind" value={KIND_NAMES[item.kind]} />
      <Fact label="Website" value={item.site ? siteName(item.site) : 'Not linked to a site'} />
      {item.username ? <Fact label="Email or username" value={item.username} /> : null}
      {item.makesCodes ? <Fact label="Sign-in codes" value="Hermes makes this site's one-time codes itself." /> : null}
      <Fact label="Saved in" value={sourceName(item.source, sources)} />
      {added ? <Fact label="Added" value={added} /> : null}
      {props.nerdMode ? <Fact label="Item ID" value={item.id} mono /> : null}
      <Label tone="muted" size={13}>{`${agentName} can use this in its browser on the computer where Hermes runs. It never sees the secret, and bighelp can't read it back.`}</Label>
      {item.source === LOCAL_SOURCE
        ? <View style={{ flexDirection: 'row' }}><Button label="Remove" tone="danger" disabled={!!busy} onPress={() => { setDialogError(''); setRemoving(item); }} /></View>
        : <Label tone="muted" size={13}>{`To change or remove it, use ${sourceName(item.source, sources)}.`}</Label>}
    </View>;
  } else if (selectedManager && profile) {
    const source = selectedManager;
    title = source.displayName;
    detail = <View style={{ gap: 16 }}>
      <Fact label="State" value={managerState(source)} />
      <View style={{ borderWidth: 1, borderColor: palette.line, borderRadius: 14, overflow: 'hidden' }}>
        <Toggle label={`Let ${agentName} use ${source.displayName}`} detail="Turning it off also locks it." value={source.enabled} disabled={!!busy}
          onChange={enabled => { void run('source', () => call('vault.useSource', { profile, source: source.name, enabled }),
            () => ({ tone: 'success', text: enabled ? `${source.displayName} is on.` : `${source.displayName} is off.` }))
            .then(failure => { if (failure) setMessage({ tone: 'error', text: failure }); }); }} />
      </View>
      {source.enabled && source.needsUnlock ? <View style={{ flexDirection: 'row', gap: 8 }}>
        {source.unlocked
          ? <Button label={busy === 'lock' ? 'Locking…' : 'Lock'} disabled={!!busy} onPress={() => {
            void run('lock', () => call('vault.lock', { profile, source: source.name }), () => ({ tone: 'success', text: `${source.displayName} is locked.` }))
              .then(failure => { if (failure) setMessage({ tone: 'error', text: failure }); });
          }} />
          : <Button label="Unlock" tone="primary" disabled={!!busy} onPress={() => { setDialogError(''); setUnlocking(source); }} />}
      </View> : null}
      <Label tone="muted" size={13}>{`${agentName} can use logins from an unlocked password manager. It stays unlocked on your computer until you lock it or it goes unused for 30 minutes.`}</Label>
    </View>;
  } else {
    detail = <View style={{ gap: 12 }}>
      <Label>{`Logins ${agentName} can use in its browser. They're kept in Hermes on ${props.data.host?.label ?? 'your computer'}. Your agent never sees the passwords, and bighelp doesn't keep them.`}</Label>
      <Label tone="muted">Pick an item to see its details, or add a login.</Label>
    </View>;
  }

  return <>
    {props.panes.list ? <ContextColumn title="Vault" narrow={props.narrow} actions={
      <IconButton icon="plus" label={ready ? 'Add a login' : 'Add a login. Open an agent\'s vault first'} disabled={!ready || !!busy}
        onPress={() => open({ kind: 'add' })} />}>
      <View style={{ gap: 10, padding: 4 }}>
        {agents.length > 1 || (agents.length === 1 && !profile) ? <SelectField label="Agent" value={profile ?? ''}
          options={[{ value: '', label: 'Choose an agent' }, ...agents.map(agent => ({ value: agent.id, label: agent.name }))]}
          onChange={value => { setChosen(value || null); setSelection(null); setMessage(null); }} /> : null}
        {status !== null ? <View role="status"><Label tone="muted">{status}</Label></View> : <>
          <Caption>{`Saved for ${agentName}`}</Caption>
          {items.length === 0 ? <Empty>Nothing saved yet. Use + to add a login.</Empty> : <View role="list">
            {items.map(item => <ListRow key={item.id} label={`${item.label}, ${itemLine(item, sources)}`}
              active={selectedItem?.id === item.id} onPress={() => open({ kind: 'item', id: item.id })}>
              <Icon name={item.kind === 'login' ? 'lock' : 'shield'} color={palette.muted} size={18} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Label weight="600" oneLine>{item.label}</Label>
                <Label size={12} tone="muted" oneLine>{itemLine(item, sources)}</Label>
              </View>
            </ListRow>)}
          </View>}
          {managers.length ? <>
            <Caption>Password managers</Caption>
            <View role="list">{managers.map(source => <ListRow key={source.name} label={`${source.displayName}, ${managerState(source)}`}
              active={selectedManager?.name === source.name} onPress={() => open({ kind: 'manager', name: source.name })}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Label weight="600" oneLine>{source.displayName}</Label>
                <Label size={12} tone="muted" oneLine>{managerState(source)}</Label>
              </View>
            </ListRow>)}</View>
          </> : null}
        </>}
      </View>
    </ContextColumn> : null}
    {props.panes.detail ? <View style={{ flex: 1, minWidth: 0 }}>
      <PageHead title={title} onBack={props.onBack} />
      <ScrollView style={{ flex: 1 }}>
        <PageBody>
          {message ? <Banner tone={message.tone} text={message.text} /> : null}
          {detail}
        </PageBody>
      </ScrollView>
    </View> : null}
    <ConfirmDialog open={!!removing} title={`Remove ${removing?.label ?? 'this'}?`} tone="danger" confirmLabel="Remove"
      body={`${agentName} won't be able to use it anymore. This deletes it from the vault on ${props.data.host?.label ?? 'your computer'}.`}
      busy={busy === 'remove'} error={dialogError || undefined} onCancel={() => setRemoving(null)}
      onConfirm={() => {
        const item = removing;
        if (!item || !profile) return;
        setDialogError('');
        void run('remove', () => call('vault.remove', { profile, id: item.id }),
          value => ({ tone: 'success', text: value.removed ? `Removed ${item.label}.` : `${item.label} was already gone.` }))
          .then(failure => { if (failure) setDialogError(failure); else { setRemoving(null); setSelection(null); } });
      }} />
    {unlocking && profile ? <UnlockDialog source={unlocking} agentName={agentName} busy={busy === 'unlock'} error={dialogError}
      onCancel={() => setUnlocking(null)}
      onUnlock={password => {
        const source = unlocking;
        setDialogError('');
        void run('unlock', () => call('vault.unlock', { profile, source: source.name, password }),
          () => ({ tone: 'success', text: `${source.displayName} is unlocked.` }))
          .then(failure => { if (failure) setDialogError(failure); else setUnlocking(null); });
      }} /> : null}
  </>;
}

// The master password is read from the field once, sent, and the field emptied.
function UnlockDialog(props: Readonly<{ source: VaultSource; agentName: string; busy: boolean; error: string;
  onCancel: () => void; onUnlock: (password: string) => void }>): JSX.Element {
  const secret = useSecretRef();
  const [filled, setFilled] = useState(false);
  const submit = () => {
    if (props.busy || !filled) return;
    const password = takeSecret(secret); setFilled(false);
    if (password) props.onUnlock(password);
  };
  return <Dialog open title={`Unlock ${props.source.displayName}`} onClose={props.onCancel} actions={<>
    <Button label="Cancel" onPress={props.onCancel} />
    <Button label={props.busy ? 'Unlocking…' : 'Unlock'} tone="primary" disabled={props.busy || !filled} onPress={submit} />
  </>}>
    <Label>{`Unlocks ${props.source.displayName} on your computer so ${props.agentName} can use its logins. bighelp doesn't keep your master password.`}</Label>
    <SecretField label="Master password" secretRef={secret} maxLength={VAULT_LIMITS.password} onFilled={setFilled} autoFocus
      disabled={props.busy} onSubmit={submit} />
    {props.error ? <Banner tone="error" text={props.error} /> : null}
  </Dialog>;
}

// A new login. Website and username are ordinary fields; the password is write-only.
export function AddLogin(props: Readonly<{ agentName: string; hostLabel: string; busy: boolean; onCancel: () => void;
  onSave: (login: Readonly<{ site: string; username: string; password: string; label?: string }>) => Promise<string | null> }>): JSX.Element {
  const secret = useSecretRef();
  const [site, setSite] = useState('');
  const [username, setUsername] = useState('');
  const [label, setLabel] = useState('');
  const [filled, setFilled] = useState(false);
  const [error, setError] = useState<Readonly<{ field: 'site' | 'username' | 'password' | 'form'; text: string }> | null>(null);
  const save = async () => {
    if (props.busy) return;
    if (!vaultSite(site)) { setError({ field: 'site', text: "Enter the site's address, like example.com." }); return; }
    if (!username.trim()) { setError({ field: 'username', text: 'Enter the email or username you sign in with.' }); return; }
    if (!filled) { setError({ field: 'password', text: 'Enter the password.' }); return; }
    setError(null);
    const password = takeSecret(secret); setFilled(false);
    const failure = await props.onSave({ site, username: username.trim(), password, ...(label.trim() ? { label: label.trim() } : {}) });
    if (failure) setError({ field: 'form', text: `${failure} Type the password again to retry.` });
  };
  const fieldError = (field: 'site' | 'username' | 'password') => error?.field === field ? error.text : undefined;
  return <form autoComplete="off" style={{ display: 'grid', gap: 14 }} onSubmit={event => { event.preventDefault(); void save(); }}>
    <Label>{`The login goes straight to ${props.agentName}'s vault on ${props.hostLabel}. Your agent can use it in its browser but never sees the password. bighelp keeps no copy.`}</Label>
    <TextField label="Website" value={site} onChange={setSite} maxLength={VAULT_LIMITS.site} type="url" placeholder="example.com"
      hint="Only this site can use the login." error={fieldError('site')} disabled={props.busy} required autoFocus />
    <TextField label="Email or username" value={username} onChange={setUsername} maxLength={VAULT_LIMITS.username}
      error={fieldError('username')} disabled={props.busy} required />
    <SecretField label="Password" secretRef={secret} maxLength={VAULT_LIMITS.password} onFilled={setFilled}
      hint="Sent once to the vault on your computer, then cleared here." error={fieldError('password')} disabled={props.busy} onSubmit={() => { void save(); }} />
    <TextField label="Name (optional)" value={label} onChange={setLabel} maxLength={VAULT_LIMITS.label} placeholder="Like Work email"
      hint="What you and your agent call it. Leave empty to use the site." disabled={props.busy} />
    {error?.field === 'form' ? <Banner tone="error" text={error.text} /> : null}
    <div style={{ display: 'flex', gap: 8 }}>
      <Button label={props.busy ? 'Saving…' : 'Save login'} tone="primary" disabled={props.busy} onPress={() => { void save(); }} />
      <Button label="Cancel" disabled={props.busy} onPress={props.onCancel} />
    </div>
  </form>;
}
