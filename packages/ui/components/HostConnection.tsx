// Settings → Hosts. Address first: main checks the address with no credentials
// and says what this Hermes needs. Passwords and tokens are write-only here: they
// cross to main once and are cleared from this form straight away.
import { useState } from 'react';
import type { JSX } from 'react';
import { View } from 'react-native-web';
import type { DesktopApi, DesktopResult, DesktopSnapshot, DesktopSavedHost, DesktopSetup, StorageIssue } from '../../../apps/desktop/src/shared/desktop-api.ts';
import { Banner, Button, Card, ConfirmDialog, Dialog, PageBody, RadioList, Row, SelectField, TextField } from './controls.tsx';
import { Label } from './primitives.tsx';

const DEFAULT_PORT = '9119';
const PLAIN_HTTP_HINT = "For plain http, use the computer's IP address (like 192.168.1.20), or use an https address.";

type Busy = 'checking' | 'signingIn' | 'connecting' | 'saving' | 'forgetting' | 'other' | null;

export function storageAdvice(issue: StorageIssue | null | undefined, platform: string): Readonly<{ title: string; text: string; hint?: string }> {
  const linux = platform === 'linux';
  if (issue === 'keyringMissing' || (linux && !issue)) return { title: 'No keyring found',
    text: "bighelp keeps sign-ins in your system keyring and won't save them anywhere else. Install GNOME Keyring or KWallet, sign out and back in, then open bighelp again.",
    hint: 'On a desktop without a keyring service, start bighelp with --password-store=gnome-libsecret, or --password-store=kwallet6 on KDE Plasma 6.' };
  if (issue === 'keyringLocked') return { title: 'Your keyring is locked',
    text: "Unlock your keyring (GNOME Keyring or KWallet), usually by signing in with your password, then open bighelp again. bighelp won't save sign-ins anywhere else." };
  if (issue === 'storageFailed') return { title: "bighelp couldn't open its saved data", text: 'Close any other bighelp window, then open bighelp again.' };
  return { title: "Secure storage isn't available",
    text: "bighelp keeps sign-ins in your system's secure storage and couldn't open it. Sign out of your computer and back in, then open bighelp again." };
}

function connectionLine(snapshot: DesktopSnapshot, saved: DesktopSavedHost): string {
  const retry = snapshot.hosts?.reconnect;
  if (snapshot.status === 'connected') return `Connected to ${saved.label}`;
  if (retry?.state === 'signIn') return 'Sign in again to reconnect';
  if (retry?.state === 'waiting') return `Offline — trying again in ${retry.delaySeconds} s`;
  if (retry?.state === 'trying') return 'Reconnecting…';
  if (snapshot.status === 'connecting') return 'Connecting…';
  return `Not connected to ${saved.label}`;
}
function signInText(saved: DesktopSavedHost): string {
  if (saved.signIn === 'automatic') return 'No sign-in needed';
  if (saved.signIn === 'sessionToken') return 'Session token';
  if (saved.signIn === null) return 'Sign in again';
  return saved.account ? `Signed in as ${saved.account}` : 'Signed in';
}
function facts(saved: DesktopSavedHost): string {
  return [saved.thisComputer ? 'This computer' : null, saved.version ? `Hermes ${saved.version}` : null, signInText(saved)]
    .filter(Boolean).join(' · ');
}
// The name a person most likely means: "This computer", or the host they typed.
function defaultName(where: 'thisComputer' | 'other', address: string): string {
  if (where === 'thisComputer') return 'This computer';
  const host = address.trim().replace(/^[a-z]+:\/\//iu, '').replace(/[/:].*$/u, '').replace(/^\[.*$/u, '');
  return host && host.length <= 100 ? host : 'My computer';
}

export function HostConnection(props: Readonly<{
  api: DesktopApi; snapshot: DesktopSnapshot; platform: string;
  // Flushes unsaved drafts before the connection changes.
  beforeChange?: (perform: () => void) => void;
}>): JSX.Element {
  const { api, snapshot } = props;
  const hosts = snapshot.hosts;
  const saved = hosts?.saved ?? null, setup = hosts?.setup ?? null;
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [where, setWhere] = useState<'thisComputer' | 'other'>('thisComputer');
  const [port, setPort] = useState(DEFAULT_PORT);
  const [address, setAddress] = useState('');
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState('');
  const [provider, setProvider] = useState('');
  const [useToken, setUseToken] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [forgetting, setForgetting] = useState(false);
  const change = props.beforeChange ?? ((perform: () => void) => perform());

  async function run(state: Exclude<Busy, null>, operation: () => Promise<DesktopResult>): Promise<DesktopResult | null> {
    setBusy(state); setError('');
    try {
      const result = await operation();
      if (!result.ok) setError(result.message);
      return result;
    } catch { setError('The desktop connection is unavailable.'); return null; }
    finally { setBusy(null); }
  }
  const clearSecrets = () => { setPassword(''); setToken(''); };
  async function check(): Promise<void> {
    const target = where === 'thisComputer'
      ? { kind: 'thisComputer' as const, port: Number(port) }
      : { kind: 'address' as const, address: address.trim() };
    if (target.kind === 'thisComputer' && (!/^\d{1,5}$/u.test(port) || target.port < 1 || target.port > 65535)) { setError('Enter a port from 1 to 65535.'); return; }
    if (target.kind === 'address' && !target.address) { setError('Enter the address of the computer running Hermes.'); return; }
    const label = name.trim() || defaultName(where, address);
    setName(label); setUseToken(false); setProvider('');
    const result = await run('checking', () => api.probeHost(target));
    const found = result?.ok ? result.snapshot.hosts?.setup : null;
    // A computer that needs no sign-in connects straight away.
    if (found?.methods.includes('automatic')) await signIn(found, { method: 'automatic' }, label);
  }
  async function signIn(found: DesktopSetup, method: Readonly<{ method: 'automatic' }> | Readonly<{ method: 'password'; provider: string; username: string; password: string }>
    | Readonly<{ method: 'token'; token: string }>, label = name.trim()): Promise<void> {
    const input = { probeId: found.probeId, label: label || (found.thisComputer ? 'This computer' : 'My computer'), ...method };
    clearSecrets();
    change(() => { void run(method.method === 'automatic' ? 'connecting' : 'signingIn', () => api.signIn(input)).then(result => {
      if (result?.ok) { setAdding(false); setUsername(''); }
    }); });
  }

  const storage = !snapshot.storageAvailable ? storageAdvice(hosts?.storageIssue, props.platform) : null;
  const storageBanner = storage ? <Banner tone="error" title={storage.title} text={storage.text}>
    {storage.hint ? <Label size={12} tone="danger" selectable>{storage.hint}</Label> : null}
  </Banner> : null;
  const errorBanner = error ? <Banner tone="error" text={error} /> : null;
  const disabled = busy !== null || !snapshot.storageAvailable;

  if (setup) {
    const methods = setup.methods;
    const tokenOnly = !methods.includes('automatic') && !methods.includes('password');
    const showToken = tokenOnly || useToken;
    const providers = setup.providers;
    const chosen = provider || providers[0]?.id || '';
    return (
      <PageBody>
        {storageBanner}{errorBanner}
        <Card title={setup.thisComputer ? 'Hermes on this computer' : 'Hermes found'} {...(setup.version ? { detail: `Hermes ${setup.version}` } : {})} padded>
          {setup.plainHttp && !setup.thisComputer ? <Banner tone="warn" text="Not encrypted. Use plain http only on a network you trust." /> : null}
          <TextField label="Name" value={name} maxLength={100} onChange={setName} hint="Shown in bighelp only." disabled={disabled} />
          {methods.includes('automatic') && !useToken ? <>
            <Label tone="muted">This computer doesn't need a sign-in.</Label>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              <Button tone="primary" label={busy === 'connecting' ? 'Connecting…' : 'Connect'} disabled={disabled}
                onPress={() => { void signIn(setup, { method: 'automatic' }); }} />
            </View>
          </> : null}
          {methods.includes('password') && !useToken ? <>
            {providers.length > 1 ? <SelectField label="Sign in with" value={chosen} disabled={disabled}
              options={providers.map(item => ({ value: item.id, label: item.name }))} onChange={setProvider} /> : null}
            <TextField label="Username" value={username} maxLength={1024} onChange={setUsername} disabled={disabled} />
            <TextField label="Password" type="password" value={password} maxLength={16384} onChange={setPassword} disabled={disabled}
              onSubmit={() => { if (username && password) void signIn(setup, { method: 'password', provider: chosen, username, password }); }} />
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              <Button tone="primary" label={busy === 'signingIn' ? 'Signing in…' : 'Sign in'} disabled={disabled || !username || !password}
                onPress={() => { void signIn(setup, { method: 'password', provider: chosen, username, password }); }} />
            </View>
            <Label size={12} tone="muted">Use your Hermes username and password. bighelp doesn't keep your password.</Label>
          </> : null}
          {tokenOnly && setup.signInRequired ? <Label tone="muted">This Hermes signs in through a browser, which bighelp can't do yet. Paste an access token instead.</Label> : null}
          {showToken ? <>
            <TextField label={setup.signInRequired ? 'Access token' : 'Session token'} type="password" value={token} maxLength={8192} onChange={setToken}
              disabled={disabled} hint={setup.signInRequired ? 'Paste an access token from your sign-in provider.' : "Paste the dashboard's session token (HERMES_DASHBOARD_SESSION_TOKEN)."}
              onSubmit={() => { if (token.trim()) void signIn(setup, { method: 'token', token: token.trim() }); }} />
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              <Button tone="primary" label={busy === 'signingIn' ? 'Connecting…' : 'Connect'} disabled={disabled || !token.trim()}
                onPress={() => { void signIn(setup, { method: 'token', token: token.trim() }); }} />
            </View>
          </> : null}
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            {!tokenOnly ? <Button tone="quiet" label={useToken ? 'Back to the usual sign-in' : 'Use a token instead'} disabled={busy !== null}
              onPress={() => { clearSecrets(); setUseToken(!useToken); }} /> : null}
            <Button label="Back" disabled={busy !== null} onPress={() => { clearSecrets(); setUsername(''); setError(''); void api.cancelSetup(); }} />
          </View>
        </Card>
      </PageBody>
    );
  }

  if (saved && !adding) {
    const retry = hosts?.reconnect;
    const live = snapshot.status === 'connected' || snapshot.status === 'connecting' || retry?.state === 'waiting' || retry?.state === 'trying';
    return (
      <PageBody>
        {storageBanner}{errorBanner}
        <Card padded>
          <View style={{ gap: 2 }}>
            <Label heading={3} size={15} weight="700">{connectionLine(snapshot, saved)}</Label>
            <Label size={13} tone="muted">{facts(saved)}</Label>
            {saved.plainHttp && !saved.thisComputer ? <Label size={12} tone="muted">Not encrypted (plain http).</Label> : null}
          </View>
          {retry?.state === 'signIn' || saved.signIn === null
            ? <Banner tone="warn" text="This computer no longer accepts the saved sign-in. Sign in again to reconnect. Nothing was resent." /> : null}
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            {retry?.state === 'waiting' ? <Button tone="primary" label="Try now" disabled={busy !== null} onPress={() => { void run('other', () => api.reconnectNow()); }} /> : null}
            {retry?.state === 'signIn' || saved.signIn === null
              ? <Button tone="primary" label={busy === 'checking' ? 'Checking…' : 'Sign in again'} disabled={disabled}
                  onPress={() => { setName(saved.label); void run('checking', () => api.probeHost({ kind: 'saved' })); }} />
              : !live ? <Button tone="primary" label="Connect" disabled={disabled} onPress={() => change(() => { void run('connecting', () => api.connectSaved()); })} /> : null}
            {snapshot.status === 'connected' ? <Button label="Refresh chats" disabled={busy !== null} onPress={() => { void run('other', () => api.refresh()); }} /> : null}
            {live ? <Button label="Disconnect" disabled={busy !== null} onPress={() => change(() => { void run('other', () => api.disconnect()); })} /> : null}
          </View>
        </Card>
        <Card title="Manage">
          <Row first title="Name" detail={saved.label}>
            <Button compact label="Rename" disabled={disabled} onPress={() => setRenaming(saved.label)} />
          </Row>
          <Row title="Sign-in" detail={signInText(saved)}>
            <Button compact label={busy === 'checking' ? 'Checking…' : 'Change'} disabled={disabled}
              onPress={() => { setName(saved.label); void run('checking', () => api.probeHost({ kind: 'saved' })); }} />
          </Row>
          <Row title="Use another computer" detail="Replaces this one after you sign in.">
            <Button compact label="Choose" disabled={disabled} onPress={() => { setName(''); setError(''); setAdding(true); }} />
          </Row>
          <Row title="Forget this computer" detail="Removes its sign-in and saved chat list from this device.">
            <Button compact tone="danger" label="Forget" disabled={disabled} onPress={() => setForgetting(true)} />
          </Row>
        </Card>
        <Dialog open={renaming !== null} title="Rename computer" onClose={() => setRenaming(null)} actions={<>
          <Button label="Cancel" onPress={() => setRenaming(null)} />
          <Button tone="primary" label={busy === 'saving' ? 'Saving…' : 'Save'} disabled={busy !== null || !renaming?.trim()}
            onPress={() => { const label = renaming?.trim() ?? ''; void run('saving', () => api.renameHost(label)).then(result => { if (result?.ok) setRenaming(null); }); }} />
        </>}>
          <TextField label="Name" value={renaming ?? ''} maxLength={100} onChange={setRenaming} autoFocus />
        </Dialog>
        <ConfirmDialog open={forgetting} title={`Forget ${saved.label}?`} tone="danger" confirmLabel="Forget" busy={busy === 'forgetting'}
          body="bighelp disconnects, then removes this computer's sign-in and its saved chat list from this device. Your chats stay on the computer. To use it again, add it and sign in again."
          error={forgetting ? error || undefined : undefined}
          onCancel={() => setForgetting(false)}
          onConfirm={() => change(() => { void run('forgetting', () => api.forgetHost()).then(result => { if (result?.ok) setForgetting(false); }); })} />
      </PageBody>
    );
  }

  return (
    <PageBody>
      {storageBanner}{errorBanner}
      <Card padded>
        <RadioList label="Where is Hermes running?" value={where} disabled={disabled} onChange={value => { setWhere(value); setError(''); }} options={[
          { value: 'thisComputer', label: 'On this computer', detail: 'bighelp finds Hermes here. No sign-in needed.' },
          { value: 'other', label: 'On another computer', detail: 'Use its address on your network, VPN or Tailscale, or an https address.' },
        ]} />
        {where === 'thisComputer'
          ? <TextField label="Port" value={port} maxLength={5} onChange={value => setPort(value.replace(/\D/gu, ''))} disabled={disabled}
              hint="Hermes uses 9119 unless you changed it." onSubmit={() => { void check(); }} />
          : <TextField label="Address" type="url" value={address} maxLength={2048} onChange={setAddress} disabled={disabled}
              placeholder="192.168.1.20:9119 or hermes.example.com" hint={PLAIN_HTTP_HINT} onSubmit={() => { void check(); }} />}
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          <Button tone="primary" label={busy === 'checking' ? 'Checking…' : busy === 'connecting' ? 'Connecting…' : where === 'thisComputer' ? 'Connect' : 'Continue'}
            disabled={disabled} onPress={() => { void check(); }} />
          {saved ? <Button label="Cancel" disabled={busy !== null} onPress={() => { setError(''); setAdding(false); }} /> : null}
        </View>
      </Card>
    </PageBody>
  );
}
