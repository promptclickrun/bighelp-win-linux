// Synthetic Electron interaction evidence only. This entry is bundled in memory
// by the opt-in CDP smoke; production entry points never import it.
import { createRoot } from 'react-dom/client';
import { ConnectedApp } from '../../packages/ui/App.tsx';
import type { DesktopApi, DesktopResult, DesktopSnapshot, DesktopWorkspace, WorkspacePage } from '../../apps/desktop/src/shared/desktop-api.ts';
import type { WorkspaceDays } from '../../packages/contracts/workspace.ts';

const hostile = '<img src=x onerror="globalThis.fixtureExecuted=true"> javascript:alert(1) https://example.invalid/';
const longTitle = `Synthetic full selectable title ${'long words '.repeat(12)}END`;
const agents = [
  { id: 'alpha', name: 'Synthetic Alpha', summary: 'Synthetic qualification only', color: '#567456' },
  { id: 'beta', name: 'Synthetic Beta', summary: 'Synthetic qualification only', color: '#675487' },
];
type Mode = 'loaded' | 'empty' | 'unsupported' | 'failed' | 'removed';
type Read = Readonly<{ generation: number; profile: string; page: WorkspacePage; days: WorkspaceDays; snapshot: DesktopSnapshot; resolve: (result: DesktopResult) => void }>;
let snapshot: DesktopSnapshot = { generation: 1, revision: 1, status: 'connected',
  data: { sample: true, host: { label: 'Synthetic interaction fixture', state: 'connected' }, agents,
    chats: [{ id: 'synthetic-chat', agentId: 'alpha', title: 'Synthetic chat', preview: '', transcript: [] }], workflows: [] },
  selectedChatId: 'synthetic-chat', running: false, canSend: true, notice: 'Synthetic fixture. Nothing leaves this renderer.',
  storageAvailable: false, prompts: [], drafts: {}, workspace: null };
const listeners = new Set<(value: DesktopSnapshot) => void>();
const reads: Read[] = [];
const calls = { send: 0, newChat: 0, canonicalChat: 0, boardMutation: 0, other: 0, draft: 0, openChat: 0 };
const publish = (patch: Partial<DesktopSnapshot> = {}) => {
  snapshot = { ...snapshot, ...patch, revision: snapshot.revision + 1 };
  for (const listener of listeners) listener(snapshot);
};
const forbidden = async (): Promise<DesktopResult> => { calls.other++; return { ok: false, message: 'Unavailable in synthetic qualification' }; };
const api = Object.freeze<DesktopApi>({
  snapshot: async () => ({ ok: true, snapshot }),
  subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  workspace: (generation, profile, page, days) => new Promise<DesktopResult>(resolve => { reads.push({ generation, profile, page, days, snapshot, resolve }); }),
  connect: forbidden, disconnect: forbidden, refresh: forbidden, cancelNavigation: forbidden,
  canonicalChat: async () => { calls.canonicalChat++; return { ok: false, message: 'No synthetic canonical navigation' }; },
  newChat: async () => { calls.newChat++; return { ok: false, message: 'No synthetic new chat' }; },
  send: async () => { calls.send++; return { ok: false, message: 'No synthetic sends' }; },
  interrupt: forbidden, answer: forbidden,
  openChat: async (_generation, chatId) => { calls.openChat++; publish({ generation: snapshot.generation + 1, selectedChatId: chatId }); return { ok: true, snapshot }; },
  draft: async (_generation, chatId, text) => { calls.draft++; publish({ drafts: { ...snapshot.drafts, [chatId]: text } }); return { ok: true, snapshot }; },
});
function workspace(read: Read, marker: string, mode: Mode): DesktopWorkspace {
  const { profile, page, days } = read;
  if (mode === 'unsupported') return { profile, page, status: 'unsupported' };
  const empty = mode === 'empty' || mode === 'removed';
  if (page === 'projects') return { profile, page, status: 'loaded', data: { activeId: empty ? null : 'one', projects: empty ? [] : [
    { id: 'one', name: `${marker} project`, description: hostile, archived: false, folders: [{ path: '/synthetic/inert/path', primary: true }] },
    { id: 'long', name: longTitle, description: hostile, archived: true, folders: [] },
  ] } };
  if (page === 'scheduled') return { profile, page, status: 'loaded', data: { tasks: empty ? [] : [
    { id: 'one', name: `${marker} task`, schedule: 'supplied schedule', state: 'error', enabled: false, lastResult: hostile },
    { id: 'unknown', name: 'Synthetic missing result', schedule: 'supplied schedule', state: 'scheduled', enabled: true },
  ] } };
  if (page === 'usage') return { profile, page, status: 'loaded', data: { days, totals: { inputTokens: 0, estimatedCost: 1.25, actualCost: 0 }, daily: empty ? [] : [{ day: '2026-10-16', sessions: 0 }], models: empty ? [] : [{ name: `${marker} model`, outputTokens: 0 }] } };
  return { profile, page, status: 'loaded', data: { tab: page, items: empty ? [] : [
    { id: 'one', kind: page === 'feed' ? 'feed' : page === 'ideas' ? 'idea' : 'goal', title: `${marker} ${page}`, body: hostile, note: 'Supplied note', status: 'supplied unknown status', read: false },
    { id: 'long', kind: 'feed', title: longTitle, body: hostile, read: true },
    { id: 'missing', kind: 'goal', title: 'Synthetic missing metadata' },
  ] } };
}
const container = document.createElement('div');
container.id = 'workspace-qualification';
container.style.cssText = 'position:fixed;inset:0;display:flex;z-index:2147483647';
const original = document.getElementById('root');
const previousHidden = original?.hidden;
const previousInert = original?.inert;
if (original) { original.hidden = true; original.inert = true; }
document.body.append(container);
const root = createRoot(container);
root.render(<ConnectedApp api={api} platform="linux" />);
const control = {
  hostile, longTitle,
  reads: () => reads.map(({ generation, profile, page, days }) => ({ generation, profile, page, days })),
  calls: () => ({ ...calls }),
  resolve: (index: number, marker = 'Synthetic', mode: Mode = 'loaded') => {
    const read = reads[index]; if (!read) throw new Error('Missing synthetic read');
    read.resolve(mode === 'failed' ? { ok: false, message: 'Synthetic read failed' } : { ok: true,
      snapshot: { ...read.snapshot, workspace: workspace(read, marker, mode) } });
  },
  churn: () => publish(),
  generation: () => publish({ generation: snapshot.generation + 1 }),
  offline: () => publish({ status: 'disconnected', data: { ...snapshot.data, host: { label: 'Synthetic interaction fixture', state: 'offline' } } }),
  online: () => publish({ status: 'connected', data: { ...snapshot.data, host: { label: 'Synthetic interaction fixture', state: 'connected' } } }),
  catalog: (mode: 'both' | 'beta' | 'empty') => publish({ data: { ...snapshot.data, agents: mode === 'empty' ? [] : mode === 'beta' ? [agents[1]!] : agents } }),
  cleanup: () => { root.unmount(); container.remove(); listeners.clear(); if (original) { original.hidden = previousHidden ?? false; original.inert = previousInert ?? false; } delete window.workspaceQualification; },
};
declare global { interface Window { workspaceQualification?: typeof control } }
window.workspaceQualification = control;
