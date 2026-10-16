// Renderer access to the finite desktop API. Components read the current safe
// snapshot and request named calls; they never see credentials or host URLs.
import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { DesktopApi, DesktopResult, DesktopSnapshot } from '../../apps/desktop/src/shared/desktop-api.ts';
import type { CallInput, CallName, CallOutput, CallResult } from '../../apps/desktop/src/shared/calls/index.ts';

export type HostValue = Readonly<{
  api: DesktopApi; snapshot: DesktopSnapshot;
  act: (operation: Promise<DesktopResult>) => Promise<boolean>;
}>;
const HostContext = createContext<HostValue | null>(null);

export function HostProvider(props: Readonly<{ value: HostValue | null; children: ReactNode }>) {
  return <HostContext.Provider value={props.value}>{props.children}</HostContext.Provider>;
}
export function useHost(): HostValue | null { return useContext(HostContext); }

const offline = Object.freeze({ ok: false as const, code: 'stale' as const, message: 'Connect to your computer first.' });

// Run one call against the connection that was current when the component rendered.
export function useCall() {
  const host = useHost();
  const connected = host?.snapshot.status === 'connected';
  const connection = host?.snapshot.connection ?? -1;
  const api = host?.api;
  return useCallback(async <K extends CallName>(name: K, input: CallInput<K>): Promise<CallResult<K>> => {
    if (!api || !connected) return offline;
    try { return await api.call(connection, name, input); }
    catch { return Object.freeze({ ok: false as const, code: 'unavailable' as const, message: 'The desktop connection is unavailable.' }); }
  }, [api, connected, connection]);
}

export type Query<T> = Readonly<{
  status: 'idle' | 'loading' | 'loaded' | 'failed'; value: T | null; message: string; code: string;
  reload: () => void;
}>;

// Load a read call when inputs change or on reload. Stale replies are dropped.
export function useQuery<K extends CallName>(name: K, input: CallInput<K> | null): Query<CallOutput<K>> {
  const call = useCall();
  const key = input === null ? null : JSON.stringify(input);
  const [tick, setTick] = useState(0);
  const [state, setState] = useState<Omit<Query<CallOutput<K>>, 'reload'>>({ status: 'idle', value: null, message: '', code: '' });
  const sequence = useRef(0);
  useEffect(() => {
    if (key === null || input === null) { setState({ status: 'idle', value: null, message: '', code: '' }); return; }
    const request = ++sequence.current;
    setState(previous => ({ ...previous, status: 'loading', message: '' }));
    void call(name, input).then(result => {
      if (request !== sequence.current) return;
      setState(result.ok ? { status: 'loaded', value: result.value, message: '', code: '' }
        : { status: 'failed', value: null, message: result.message, code: result.code });
    });
    return () => { ++sequence.current; };
  }, [call, name, key, tick]);
  const reload = useCallback(() => setTick(value => value + 1), []);
  return { ...state, reload };
}
