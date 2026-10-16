import { boardFeatures, decodeWorkspaceBoard, decodeWorkspaceContext, decodeWorkspaceProjects, decodeWorkspaceScheduled, decodeWorkspaceUsage,
  parseWorkspaceIdentity, parseWorkspaceOwner, sameWorkspaceOwner, workspaceDays, workspaceRequestId, workspaceTab } from '../contracts/workspace.ts';
import type { WorkspaceBoard, WorkspaceDays, WorkspaceIdentity, WorkspaceOwner, WorkspaceProjects, WorkspaceResult,
  WorkspaceScheduled, WorkspaceTab, WorkspaceUsage } from '../contracts/workspace.ts';
import { HttpStatusError } from '../platform/transport-policy.ts';
import type { HttpOperation, HttpResult } from '../platform/transport-policy.ts';

export type WorkspaceFailure = 'invalid-response' | 'owner-changed' | 'unavailable';
export class WorkspaceClientError extends Error {
  readonly kind: WorkspaceFailure;
  constructor(kind: WorkspaceFailure) { super(kind); this.name = 'WorkspaceClientError'; this.kind = kind; }
}
export type WorkspaceAdapters = Readonly<{
  owner: WorkspaceOwner;
  currentOwner(): WorkspaceOwner | null;
  identity: WorkspaceIdentity;
  http(operation: HttpOperation): Promise<HttpResult>;
  // The shipping client uses projects.list RPC {profile}; no invented REST route.
  projects?: (profile: string) => Promise<unknown>;
  nextRequestId(): string;
  capabilities?: Readonly<{ projects?: boolean; usage?: boolean; scheduled?: boolean }>;
}>;
const unsupported = (reason: 'host-update' | 'plugin-update') => Object.freeze({ status: 'unsupported' as const, reason });
const loaded = <T>(data: T): WorkspaceResult<T> => Object.freeze({ status: 'loaded', data });
const absentRoute = (error: unknown) => error instanceof HttpStatusError && [404, 405, 501].includes(error.status);

// One captured authenticated host/profile generation. Main-process only: these
// adapters are finite privileged capabilities, never renderer-supplied callbacks.
// The client has no send/run/update path, retry loop, polling, or background AI.
export function createWorkspaceClient(adapters: WorkspaceAdapters) {
  const owner = parseWorkspaceOwner(adapters.owner), identity = parseWorkspaceIdentity(adapters.identity);
  const capabilities = Object.freeze({ ...adapters.capabilities });
  function current(): void {
    if (!sameWorkspaceOwner(owner, adapters.currentOwner())) throw new WorkspaceClientError('owner-changed');
  }
  async function call<T>(operation: () => Promise<T>): Promise<T> {
    current();
    try { const result = await operation(); current(); return result; }
    catch (error) {
      current();
      if (error instanceof WorkspaceClientError || error instanceof HttpStatusError) throw error;
      throw new WorkspaceClientError('unavailable');
    }
  }
  function decode<T>(operation: () => T): T {
    try { return operation(); } catch { throw new WorkspaceClientError('invalid-response'); }
  }
  function unavailable(error: unknown): never {
    if (error instanceof WorkspaceClientError) throw error;
    throw new WorkspaceClientError('unavailable');
  }
  return Object.freeze({
    async projects(): Promise<WorkspaceResult<WorkspaceProjects>> {
      current();
      const projects = adapters.projects;
      if (capabilities.projects === false || projects === undefined) return unsupported('host-update');
      try {
        const value = await call(() => projects(owner.profileId));
        return loaded(decode(() => decodeWorkspaceProjects(value, owner.profileId)));
      } catch (error) { return unavailable(error); }
    },
    async usage(days: WorkspaceDays = 30): Promise<WorkspaceResult<WorkspaceUsage>> {
      current(); const range = decode(() => workspaceDays(days));
      if (capabilities.usage === false) return unsupported('host-update');
      try {
        const response = await call(() => adapters.http({ kind: 'workspaceUsage', profile: owner.profileId, days: range }));
        return loaded(decode(() => decodeWorkspaceUsage(response.body, owner.profileId, range)));
      } catch (error) { if (absentRoute(error)) return unsupported('host-update'); return unavailable(error); }
    },
    async scheduled(): Promise<WorkspaceResult<WorkspaceScheduled>> {
      current();
      if (capabilities.scheduled === false) return unsupported('host-update');
      try {
        const response = await call(() => adapters.http({ kind: 'workspaceScheduled', profile: owner.profileId }));
        return loaded(decode(() => decodeWorkspaceScheduled(response.body, owner.profileId)));
      } catch (error) { if (absentRoute(error)) return unsupported('host-update'); return unavailable(error); }
    },
    async board(tab: WorkspaceTab): Promise<WorkspaceResult<WorkspaceBoard>> {
      current(); const selected = decode(() => workspaceTab(tab));
      let response: HttpResult;
      try { response = await call(() => adapters.http({ kind: 'nativeContext' })); }
      catch (error) { if (absentRoute(error)) return unsupported('plugin-update'); return unavailable(error); }
      const context = decode(() => decodeWorkspaceContext(response.body, identity, response.etag, response.cacheControl));
      if (!context.board) return unsupported('plugin-update');
      const requestId = decode(() => workspaceRequestId(adapters.nextRequestId()));
      try {
        const result = await call(() => adapters.http({ kind: 'workspaceBoard', agentId: owner.profileId, etag: context.etag, requestId }));
        if (result.etag !== context.etag || result.requestId !== requestId) throw new WorkspaceClientError('invalid-response');
        const board = decode(() => decodeWorkspaceBoard(result.body, owner.profileId, selected));
        // Actions are offered exactly as the plugin advertises them, like the Mac app.
        return loaded(Object.freeze({ ...board, features: boardFeatures(context.features) }));
      } catch (error) { return unavailable(error); }
    },
  });
}
