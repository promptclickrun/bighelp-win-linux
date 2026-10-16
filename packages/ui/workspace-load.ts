import { useEffect, useRef, useState } from 'react';
import type { DesktopApi, DesktopSnapshot, DesktopWorkspace, WorkspacePage } from '../../apps/desktop/src/shared/desktop-api.ts';
import type { WorkspaceDays } from '../contracts/workspace.ts';

export type WorkspaceLoadInput = Readonly<{
  api: DesktopApi | undefined;
  snapshot: DesktopSnapshot | undefined;
  profile: string | null;
  page: WorkspacePage | null;
  days: WorkspaceDays;
}>;
export type LoadedWorkspace = Extract<DesktopWorkspace, { status: 'loaded' }>;
export type WorkspaceLoadState =
  | Readonly<{ status: 'idle' | 'loading' | 'unavailable' | 'unsupported'; workspace: null }>
  | Readonly<{ status: 'loaded'; workspace: LoadedWorkspace }>;
export type WorkspaceLoad = WorkspaceLoadState & Readonly<{ refresh: () => void }>;

// One invocation owns each result. Snapshot.workspace is deliberately not a
// subscription source: it has no request ID and cannot identify same-key re-entry.
// Main still owns the host/principal/session and its own workspace revision fence.
export function useWorkspaceLoad(input: WorkspaceLoadInput): WorkspaceLoad {
  const { api, snapshot, profile, page, days } = input;
  const [attempt, setAttempt] = useState(0);
  const generation = snapshot?.generation;
  const connected = snapshot?.status === 'connected';
  const key = JSON.stringify([generation, connected, profile, page, days, attempt]);
  const current = useRef({ key, api });
  if (current.current.key !== key || current.current.api !== api) current.current = { key, api };
  const lease = current.current;
  const [result, setResult] = useState<Readonly<{ lease: typeof lease; state: WorkspaceLoadState }> | null>(null);
  const refresh = () => {
    // Invalidate before the next render as well as on the changed attempt key.
    current.current = { ...current.current };
    setAttempt(value => value + 1);
  };
  useEffect(() => {
    let active = true;
    const accepts = () => active && current.current === lease;
    if (api && connected && generation !== undefined && profile && page) {
      void (async () => {
        let state: WorkspaceLoadState = { status: 'unavailable', workspace: null };
        try {
          const response = await api.workspace(generation, profile, page, days);
          if (!accepts()) return;
          if (response.ok && response.snapshot.generation === generation && response.snapshot.status === 'connected') {
            const workspace = response.snapshot.workspace;
            if (workspace?.profile === profile && workspace.page === page) {
              if (workspace.status === 'loaded' && (workspace.page !== 'usage' || workspace.data.days === days)) {
                state = { status: 'loaded', workspace };
              } else if (workspace.status === 'unsupported') state = { status: 'unsupported', workspace: null };
            }
          }
        } catch { /* Only a plain unavailable state crosses this boundary. */ }
        if (accepts()) setResult({ lease, state });
      })();
    }
    return () => { active = false; };
  }, [key, api]);
  if (!page) return { status: 'idle', workspace: null, refresh };
  if (!api || !connected) return { status: 'unavailable', workspace: null, refresh };
  if (!profile) return { status: 'idle', workspace: null, refresh };
  return { ...(result?.lease === lease ? result.state : { status: 'loading' as const, workspace: null }), refresh };
}
