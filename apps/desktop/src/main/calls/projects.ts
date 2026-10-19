// Projects over Hermes JSON-RPC (projects.*), always scoped with an explicit
// profile. There is no idempotency key: every write is read back, a lost reply is
// "not sure", and nothing is retried. Hard delete is not exposed.
import { decodeProject, decodeProjectList, hostFolder } from '../../../../../packages/contracts/projects.ts';
import type { Project, ProjectList } from '../../../../../packages/contracts/projects.ts';
import { GatewayOperationError } from '../../../../../packages/hermes-client/gateway.ts';
import type { PROJECT_CALLS } from '../../shared/calls/projects.ts';
import type { CallContext } from './context.ts';
import { CallError } from './context.ts';
import type { CallHandlers } from './index.ts';

const GONE = 'That project is no longer on your computer. Refresh the list.';

function lost(error: unknown): boolean {
  if (error instanceof CallError || error instanceof GatewayOperationError) return false;
  return !(error instanceof Error && (error.message === 'Host changed' || error.message === 'Gateway unavailable'));
}
function refusal(error: unknown): unknown {
  if (!(error instanceof GatewayOperationError)) return error;
  if (error.code === -32601) return new CallError('unsupported', "This computer's Hermes doesn't support projects. A Hermes update may be needed.");
  if (error.code === 5062) return new CallError('stale', GONE);
  if (error.code === 5063 && error.detail.startsWith('folder already belongs to project')) {
    return new CallError('conflict', 'That folder already belongs to another project. Open that project instead.');
  }
  if (error.code === 5063) return new CallError('invalid', error.detail || 'Hermes could not accept that.');
  if (error.code === -32000 && /Profile '.*' does not exist/u.test(error.detail)) return new CallError('stale', 'That agent is no longer on your computer.');
  return new CallError('invalid', 'Hermes could not do that.');
}
function decoded<T>(decode: () => T, written: boolean): T {
  try { return decode(); } catch {
    throw written ? new CallError('unknown', 'Hermes answered in a way bighelp could not check. Look at your projects before trying again.')
      : new CallError('invalid', 'Hermes sent projects in a form bighelp does not understand.');
  }
}
async function call(context: CallContext, method: string, params: Record<string, string | boolean | readonly string[]>, mutation: boolean, unsure: string): Promise<unknown> {
  try { return await context.rpc(method, params, { mutation }); }
  catch (error) {
    if (mutation && lost(error)) throw new CallError('unknown', unsure);
    throw refusal(error);
  }
}
async function list(context: CallContext, profile: string): Promise<ProjectList> {
  const result = await call(context, 'projects.list', { profile }, false, '');
  return decoded(() => decodeProjectList(result), false);
}
// Does a saved folder match the one typed? '~' expands to the host home, which
// only Hermes knows, so those are matched on the part after it.
function sameFolder(typed: string, saved: string | null): boolean {
  if (saved === null || !saved.startsWith('/')) return false;
  if (typed.startsWith('/')) return hostFolder(typed) === saved;
  const rest = hostFolder(`/${typed.slice(1)}`)!;
  return rest === '/' || saved.endsWith(rest);
}
const view = (profile: string, value: ProjectList) => Object.freeze({ profile, projects: value.projects, activeId: value.activeId });

export const PROJECT_HANDLERS: Pick<CallHandlers, keyof typeof PROJECT_CALLS> = Object.freeze({
  'projects.list': {
    mutation: false,
    async run(context, input) {
      context.requireProfile(input.profile);
      return view(input.profile, await list(context, input.profile));
    },
  },
  'projects.create': {
    mutation: true,
    async run(context, input) {
      context.requireProfile(input.profile);
      const before = await list(context, input.profile);
      const taken = before.projects.find(project => sameFolder(input.folder, project.primaryPath) && input.folder.startsWith('/'));
      if (taken) throw new CallError('conflict', `That folder already belongs to “${taken.name}”. Open that project instead.`);
      const known = new Set(before.projects.map(project => project.id));
      let project: Project | null = null;
      const notes: string[] = [];
      try {
        const result = await context.rpc('projects.create', { profile: input.profile, name: input.name, folders: [input.folder],
          primary_path: input.folder, ...(input.description ? { description: input.description } : {}), use: true }, { mutation: true });
        const row = result !== null && typeof result === 'object' ? (result as Record<string, unknown>).project : undefined;
        project = row === null || row === undefined ? null : decoded(() => decodeProject(row), true);
      } catch (error) {
        if (!lost(error)) throw refusal(error);
        // The reply was lost. A new project with this name and folder is the one this request made.
        const after = await list(context, input.profile).catch(() => null);
        project = after?.projects.find(row => !known.has(row.id) && row.name === input.name && sameFolder(input.folder, row.primaryPath)) ?? null;
        if (!project) throw new CallError('unknown', 'Not sure the project was created. Check the list before creating it again.');
        notes.push('The reply was lost, but the project is saved.');
      }
      if (!project || known.has(project.id) || project.archived) throw new CallError('unknown', 'Hermes did not confirm the new project. Check the list before creating it again.');
      if (project.name !== input.name) notes.push(`Hermes saved the name as “${project.name}”.`);
      if (!sameFolder(input.folder, project.primaryPath)) notes.push('Hermes saved a different folder. Check it below.');
      if ((project.description ?? '') !== (input.description ?? '')) notes.push('Hermes saved the description differently.');
      const after = await list(context, input.profile).catch(() => null);
      const current = after?.activeId === project.id;
      if (!current) notes.push("Hermes didn't confirm it as the current project.");
      return Object.freeze({ profile: input.profile, project, current, notes: Object.freeze(notes) });
    },
  },
  'projects.update': {
    mutation: true,
    async run(context, input) {
      context.requireProfile(input.profile);
      const result = await call(context, 'projects.update', { profile: input.profile, id: input.id,
        ...(input.name === undefined ? {} : { name: input.name }), ...(input.description === undefined ? {} : { description: input.description }) },
      true, 'Not sure the change was saved. Check the project before changing it again.');
      const row = result !== null && typeof result === 'object' ? (result as Record<string, unknown>).project : undefined;
      const project = decoded(() => decodeProject(row), true);
      if (project.id !== input.id) throw new CallError('unknown', 'Hermes answered about a different project. Check your projects before trying again.');
      const notes: string[] = [];
      if (input.name !== undefined && project.name !== input.name) notes.push(`Hermes saved the name as “${project.name}”.`);
      if (input.description !== undefined && (project.description ?? '') !== input.description) notes.push('Hermes saved the description differently.');
      const after = await list(context, input.profile).catch(() => null);
      return Object.freeze({ profile: input.profile, project, current: after?.activeId === project.id, notes: Object.freeze(notes) });
    },
  },
  'projects.makeCurrent': {
    mutation: true,
    async run(context, input) {
      context.requireProfile(input.profile);
      const project = (await list(context, input.profile)).projects.find(row => row.id === input.id);
      if (!project) throw new CallError('stale', GONE);
      if (project.archived) throw new CallError('invalid', 'Restore this project before making it current.');
      const unsure = "Not sure this became the current project. Check the list before trying again.";
      const result = await call(context, 'projects.set_active', { profile: input.profile, id: input.id }, true, unsure);
      const echoed = result !== null && typeof result === 'object' ? (result as Record<string, unknown>).active_id : undefined;
      const after = await list(context, input.profile).catch(() => null);
      if (echoed !== input.id || after?.activeId !== input.id) throw new CallError('unknown', unsure);
      return Object.freeze({ profile: input.profile, activeId: input.id });
    },
  },
  'projects.archive': {
    mutation: true,
    async run(context, input) {
      context.requireProfile(input.profile);
      const unsure = `Not sure the project was ${input.archived ? 'archived' : 'restored'}. Check the list before trying again.`;
      const result = await call(context, 'projects.archive', { profile: input.profile, id: input.id, restore: !input.archived }, true, unsure);
      const saved = decoded(() => decodeProjectList(result), true);
      if (saved.projects.find(row => row.id === input.id)?.archived !== input.archived) throw new CallError('unknown', unsure);
      return view(input.profile, saved);
    },
  },
});
