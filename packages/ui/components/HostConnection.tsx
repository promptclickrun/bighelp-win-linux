import { useState } from 'react';
import type { JSX } from 'react';
import { View } from 'react-native-web';
import type { HostInput, DesktopSnapshot } from '../../../apps/desktop/src/shared/desktop-api.ts';
import { Label } from './primitives.tsx';
import { useTheme } from '../theme.tsx';

export function HostConnection(props: Readonly<{ snapshot: DesktopSnapshot; error: string; onConnect: (host: HostInput) => void; onDisconnect: () => void; onRefresh: () => void }>): JSX.Element {
  const { palette, font } = useTheme();
  const [token, setToken] = useState('');
  const [label, setLabel] = useState('My computer');
  const [endpoint, setEndpoint] = useState('');
  const [authentication, setAuthentication] = useState<HostInput['authentication']>('dashboard');
  const [allowPrivateHttp, setAllowPrivateHttp] = useState(false);
  const busy = props.snapshot.status === 'connecting';
  return <View style={{ padding: 20, gap: 12, maxWidth: 620, width: '100%', alignSelf: 'center' }}>
    <Label weight="600">{props.snapshot.status}</Label>
    <Label>{props.error || props.snapshot.notice}</Label>
    {!props.snapshot.storageAvailable ? <Label>Protected storage is unavailable. Connection and saved drafts require protected storage.</Label> : null}
    <form autoComplete="off" style={{ display: 'grid', gap: 12, color: palette.ink, fontFamily: font }} onSubmit={event => {
      event.preventDefault();
      const host = { label, endpoint, authentication, token, allowPrivateHttp };
      setToken('');
      props.onConnect(host);
    }}>
      <label>Computer name <input required maxLength={100} value={label} onChange={event => setLabel(event.target.value)} /></label>
      <label>Hermes address <input required type="url" value={endpoint} onChange={event => setEndpoint(event.target.value)} placeholder="https://your-computer" /></label>
      <label>Authentication <select value={authentication} onChange={event => setAuthentication(event.target.value === 'provider' ? 'provider' : 'dashboard')}><option value="dashboard">Dashboard token</option><option value="provider">Provider token</option></select></label>
      <label>Token <input required type="password" autoComplete="off" maxLength={8192} value={token} onChange={event => setToken(event.target.value)} /></label>
      <label><input type="checkbox" checked={allowPrivateHttp} onChange={event => setAllowPrivateHttp(event.target.checked)} /> Allow HTTP on a private network</label>
      <button disabled={busy || !props.snapshot.storageAvailable} type="submit">Connect</button>
    </form>
    <button onClick={props.onDisconnect} disabled={props.snapshot.status === 'disconnected'}>Disconnect</button>
    <button onClick={props.onRefresh} disabled={props.snapshot.status !== 'connected'}>Refresh chats</button>
  </View>;
}
