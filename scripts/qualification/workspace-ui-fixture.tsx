// Synthetic Electron interaction evidence only. This entry is bundled in memory
// by the opt-in CDP smoke; production entry points never import it.
import { createRoot } from 'react-dom/client';
import { ConnectedApp } from '../../packages/ui/App.tsx';
import type { DesktopApi, DesktopResult, DesktopSnapshot, DesktopWorkspace, WorkspacePage } from '../../apps/desktop/src/shared/desktop-api.ts';
import type { CallFailure } from '../../apps/desktop/src/shared/call.ts';
import type { CallInput, CallName, CallResult } from '../../apps/desktop/src/shared/calls/index.ts';
import type { ScheduledTask } from '../../packages/contracts/schedules.ts';
import type { WorkspaceDays } from '../../packages/contracts/workspace.ts';
import { DEFAULT_PREFERENCES } from '../../apps/desktop/src/shared/preferences.ts';

const hostile = '<img src=x onerror="globalThis.fixtureExecuted=true"> javascript:alert(1) https://example.invalid/';
// A file name cannot hold "/", so the file list gets its own hostile name.
const hostileFile = '<img src=x onerror="globalThis.fixtureExecuted=true">.html';
const longTitle = `Synthetic full selectable title ${'long words '.repeat(12)}END`;
const agents = [
  { id: 'alpha', name: 'Synthetic Alpha', summary: 'Synthetic qualification only', color: '#567456' },
  { id: 'beta', name: 'Synthetic Beta', summary: 'Synthetic qualification only', color: '#675487' },
];
// foreign: the files come from another agent's working folder, as the plugin may report.
type Mode = 'loaded' | 'empty' | 'unsupported' | 'failed' | 'removed' | 'foreign';
// Reads the pages under test make. Each one is held until the smoke resolves it.
const HELD = ['projects.list', 'schedules.list', 'schedules.runs', 'schedules.targets',
  'files.recent', 'files.list', 'files.preview', 'media.list', 'media.preview'] as const;
type HeldName = typeof HELD[number];
// Reads the rest of the shell makes on its own. Answered at once, the way an older
// host without them answers. Every other call name is treated as a write and refused.
const INCIDENTAL: ReadonlySet<CallName> = new Set<CallName>(['chats.capabilities', 'chats.search', 'chat.models', 'chat.commands', 'chat.media',
  'host.about', 'agents.details', 'agents.models', 'kanban.load', 'kanban.task', 'settings.models', 'settings.reactions', 'settings.approvals',
  'settings.toolsets', 'settings.skills']);
const isHeld = (name: CallName): name is HeldName => (HELD as readonly string[]).includes(name);
// The plain sentences main returns (apps/desktop/src/main/calls/*.ts).
const UNSUPPORTED: Readonly<Record<HeldName, string>> = {
  'projects.list': "This computer's Hermes doesn't support projects. A Hermes update may be needed.",
  'schedules.list': "This computer's Hermes can't manage scheduled tasks. A Hermes update may be needed.",
  'schedules.runs': "This computer's Hermes can't manage scheduled tasks. A Hermes update may be needed.",
  'schedules.targets': "This computer's Hermes doesn't list places to send results.",
  'files.recent': 'Update the bighelp plugin on your Hermes computer, then try again.',
  'files.list': 'The bighelp plugin on your Hermes computer doesn’t share workspace files yet. Update it there, then try again.',
  'files.preview': 'The bighelp plugin on your Hermes computer doesn’t share workspace files yet. Update it there, then try again.',
  'media.list': 'Update the bighelp plugin on your Hermes computer, then try again.',
  'media.preview': 'Update the bighelp plugin on your Hermes computer, then try again.',
};
const UNAVAILABLE: CallFailure = { ok: false, code: 'unavailable', message: 'Could not reach Hermes. Check the connection and try again.' };

type Owner = Readonly<{ generation: number; connection: number }>;
type WorkspaceRead = Owner & Readonly<{ kind: 'workspace'; profile: string; page: WorkspacePage; days: WorkspaceDays; snapshot: DesktopSnapshot;
  resolve: (result: DesktopResult) => void }>;
type CallRead = { [K in HeldName]: Owner & Readonly<{ kind: 'call'; name: K; input: CallInput<K>; resolve: (result: CallResult<K>) => void }> }[HeldName];
type Read = WorkspaceRead | CallRead;
type ReadSummary = Readonly<{ label: string; generation: number; connection: number; profile: string; page: WorkspacePage | null;
  days: WorkspaceDays | null; target: string | null }>;

let snapshot: DesktopSnapshot = { generation: 1, connection: 1, revision: 1, status: 'connected',
  data: { sample: true, host: { label: 'Synthetic interaction fixture', state: 'connected' }, agents,
    chats: [{ id: 'synthetic-chat', agentId: 'alpha', title: 'Synthetic chat', preview: '', transcript: [] }], workflows: [] },
  selectedChatId: 'synthetic-chat', running: false, canSend: true, notice: 'Synthetic fixture. Nothing leaves this renderer.',
  storageAvailable: false, prompts: [], drafts: {}, workspace: null, preferences: DEFAULT_PREFERENCES, attachments: [],
  turn: { key: null, model: null, status: '', todos: [], context: null, startedAt: null } };
const listeners = new Set<(value: DesktopSnapshot) => void>();
const reads: Read[] = [];
const calls = { send: 0, newChat: 0, canonicalChat: 0, write: 0, incidental: 0, other: 0, draft: 0, openChat: 0 };
const writes: string[] = [];
const incidental = new Set<string>();
const publish = (patch: Partial<DesktopSnapshot> = {}) => {
  snapshot = { ...snapshot, ...patch, revision: snapshot.revision + 1 };
  for (const listener of listeners) listener(snapshot);
};
const forbidden = async (): Promise<DesktopResult> => { calls.other++; return { ok: false, message: 'Unavailable in synthetic qualification' }; };
// Feature calls: held reads for the pages under test, quiet answers for the rest of
// the shell, and a refusal for every write (counted; the smoke expects none).
function featureCall(connection: number, name: CallName, input: unknown): Promise<CallResult<CallName>> {
  if (isHeld(name)) {
    return new Promise(resolve => { reads.push({ kind: 'call', name, input, connection, generation: snapshot.generation, resolve } as CallRead); });
  }
  if (INCIDENTAL.has(name)) {
    calls.incidental++; incidental.add(name);
    return Promise.resolve({ ok: false, code: 'unsupported', message: 'This needs a newer version of Hermes or the bighelp plugin on your computer.' });
  }
  calls.write++; writes.push(name);
  return Promise.resolve({ ok: false, code: 'denied', message: 'Changes are refused in synthetic qualification.' });
}
const api = Object.freeze<DesktopApi>({
  snapshot: async () => ({ ok: true, snapshot }),
  subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  workspace: (generation, profile, page, days) => new Promise<DesktopResult>(resolve => {
    reads.push({ kind: 'workspace', generation, connection: snapshot.connection, profile, page, days, snapshot, resolve });
  }),
  connect: forbidden, disconnect: forbidden, refresh: forbidden, cancelNavigation: forbidden,
  probeHost: forbidden, signIn: forbidden, cancelSetup: forbidden, renameHost: forbidden, forgetHost: forbidden,
  reconnectNow: forbidden, connectSaved: forbidden,
  canonicalChat: async () => { calls.canonicalChat++; return { ok: false, message: 'No synthetic canonical navigation' }; },
  newChat: async () => { calls.newChat++; return { ok: false, message: 'No synthetic new chat' }; },
  send: async () => { calls.send++; return { ok: false, message: 'No synthetic sends' }; },
  interrupt: forbidden, answer: forbidden, preferences: forbidden, attach: forbidden, attachDropped: forbidden, detach: forbidden,
  call: featureCall as DesktopApi['call'],
  // Links and copy are outside this synthetic page qualification.
  openLink: async () => { calls.other++; return false; }, copyText: async () => { calls.other++; return false; }, onCommand: () => () => {},
  openChat: async (_generation, chatId) => { calls.openChat++; publish({ generation: snapshot.generation + 1, selectedChatId: chatId }); return { ok: true, snapshot }; },
  draft: async (_generation, chatId, text) => { calls.draft++; publish({ drafts: { ...snapshot.drafts, [chatId]: text } }); return { ok: true, snapshot }; },
});

function workspace(read: WorkspaceRead, marker: string, mode: Mode): DesktopWorkspace {
  const { profile, page, days } = read;
  if (mode === 'unsupported') return { profile, page, status: 'unsupported' };
  const empty = mode === 'empty' || mode === 'removed';
  if (page === 'projects' || page === 'scheduled') throw new Error('Projects and Scheduled use feature calls');
  if (page === 'usage') return { profile, page, status: 'loaded', data: { days, totals: { inputTokens: 0, estimatedCost: 1.25, actualCost: 0 }, daily: empty ? [] : [{ day: '2026-10-16', sessions: 0 }], models: empty ? [] : [{ name: `${marker} model`, outputTokens: 0 }] } };
  // One kind per board, as the plugin sends them. No board features: an older
  // plugin, so opening an unread item never writes a read flag.
  const kind = page === 'feed' ? 'feed' : page === 'ideas' ? 'idea' : 'goal';
  return { profile, page, status: 'loaded', data: { tab: page, items: empty ? [] : [
    { id: 'one', kind, title: `${marker} ${page}`, body: hostile, note: 'Supplied note', status: 'supplied unknown status', read: false },
    { id: 'long', kind, title: longTitle, body: hostile, read: true },
    { id: 'missing', kind, title: 'Synthetic missing metadata' },
  ] } };
}
function task(id: string, name: string, change: Partial<ScheduledTask>): ScheduledTask {
  return { id, name, prompt: hostile, schedule: { kind: 'interval', minutes: 120 }, scheduleText: 'every 120m', state: 'scheduled', enabled: true,
    running: false, nextRunAt: null, lastRunAt: null, createdAt: null, hostOffsetMinutes: null, lastStatus: null, lastError: null,
    deliver: 'local', model: null, workdir: null, hostManaged: false, repeat: null, stores: { model: true, workdir: true }, ...change };
}
// Answer one held call as main would after decoding a real reply.
function answer(read: CallRead, marker: string, mode: Mode): void {
  if (mode === 'failed') { read.resolve(UNAVAILABLE); return; }
  if (mode === 'unsupported') { read.resolve({ ok: false, code: 'unsupported', message: UNSUPPORTED[read.name] }); return; }
  const empty = mode === 'empty' || mode === 'removed';
  switch (read.name) {
    case 'projects.list': read.resolve({ ok: true, value: { profile: read.input.profile, activeId: empty ? null : 'one', projects: empty ? [] : [
      { id: 'one', name: `${marker} project`, description: hostile, archived: false, primaryPath: '/synthetic/inert/path',
        folders: [{ path: '/synthetic/inert/path', primary: true }] },
      { id: 'long', name: longTitle, description: null, archived: true, primaryPath: null, folders: [] },
    ] } }); return;
    case 'schedules.list': read.resolve({ ok: true, value: { profile: read.input.profile, tasks: empty ? [] : [
      task('one', `${marker} task`, { state: 'error', enabled: false, lastStatus: 'error', lastError: hostile,
        schedule: { kind: 'cron', expr: '*/15 * * * *' }, scheduleText: 'supplied <b>schedule</b> words' }),
      task('unknown', 'Synthetic missing result', { state: 'unknown', prompt: null, hostManaged: true }),
    ] } }); return;
    case 'schedules.runs': read.resolve({ ok: true, value: { profile: read.input.profile, id: read.input.id, runs: empty ? [] : [
      { id: `${marker}-run`, kind: 'output', startedAt: null, endedAt: null, active: false, summary: `${marker} run summary`,
        model: null, inputTokens: null, outputTokens: null, estimatedCost: null, actualCost: null },
    ] } }); return;
    case 'schedules.targets': read.resolve({ ok: true, value: { profile: read.input.profile, targets: [] } }); return;
    case 'files.recent': read.resolve({ ok: true, value: { servingProfileId: mode === 'foreign' ? 'beta' : read.input.profile, folder: '', parent: null,
      recent: true, entries: empty ? [] : [
        { name: 'notes.md', path: 'reports/notes.md', folder: false, size: 1234, mimeType: 'text/markdown' },
        { name: `${marker} summary.txt`, path: `${marker} summary.txt`, folder: false, size: 0 },
        { name: hostileFile, path: hostileFile, folder: false },
      ] } }); return;
    case 'files.list': read.resolve({ ok: true, value: { servingProfileId: read.input.profile, folder: read.input.folder,
      parent: read.input.folder === '' ? null : read.input.folder.includes('/') ? read.input.folder.slice(0, read.input.folder.lastIndexOf('/')) : '',
      recent: false, entries: empty ? [] : [{ name: 'reports', path: read.input.folder ? `${read.input.folder}/reports` : 'reports', folder: true }] } }); return;
    case 'files.preview': read.resolve({ ok: true, value: { servingProfileId: read.input.profile, name: read.input.path.slice(read.input.path.lastIndexOf('/') + 1),
      path: read.input.path, size: 1234, mimeType: 'text/markdown', preview: { kind: 'text', text: `${marker} preview: ${hostile}`, truncated: true }, saveable: true } }); return;
    case 'media.list': read.resolve({ ok: true, value: { items: empty ? [] : [
      { id: 'synthetic_media_0001', name: `${marker} clip.mp4`, mimeType: 'video/mp4', size: 2_500_000 },
    ] } }); return;
    case 'media.preview': read.resolve({ ok: true, value: { id: read.input.id, mimeType: 'image/png', size: 1, preview: { kind: 'none', reason: 'not-previewable' }, saveable: true } }); return;
  }
}
function summary(read: Read): ReadSummary {
  const { generation, connection } = read;
  if (read.kind === 'workspace') return { label: `workspace:${read.page}`, generation, connection, profile: read.profile, page: read.page, days: read.days, target: null };
  const input: Readonly<{ profile: string; id?: string; path?: string; folder?: string }> = read.input;
  return { label: read.name, generation, connection, profile: input.profile, page: null, days: null, target: input.id ?? input.path ?? input.folder ?? null };
}

const container = document.createElement('div');
container.id = 'workspace-qualification';
container.style.cssText = 'position:fixed;inset:0;display:flex;z-index:2147483647';
const original = document.getElementById('root');
const previousHidden = original?.getAttribute('hidden') ?? null;
const previousInert = original?.getAttribute('inert') ?? null;
let root: ReturnType<typeof createRoot> | undefined;
let cleaned = false;
// Register teardown before touching live DOM, independently of the ready controller.
const cleanup = () => {
  if (cleaned) return;
  cleaned = true;
  try { root?.unmount(); }
  finally {
    container.remove(); listeners.clear();
    if (original) {
      if (previousHidden === null) original.removeAttribute('hidden'); else original.setAttribute('hidden', previousHidden);
      if (previousInert === null) original.removeAttribute('inert'); else original.setAttribute('inert', previousInert);
    }
    delete window.workspaceQualification;
    delete window.workspaceQualificationCleanup;
  }
};
window.workspaceQualificationCleanup = cleanup;
try {
  if (original) { original.hidden = true; original.inert = true; }
  document.body.append(container);
  root = createRoot(container);
  root.render(<ConnectedApp api={api} platform="linux" />);
  const control: Control = {
    hostile, hostileFile, longTitle,
    reads: () => reads.map(summary),
    calls: () => ({ ...calls }),
    writes: () => [...writes],
    incidental: () => [...incidental].sort(),
    resolve: (index, marker = 'Synthetic', mode = 'loaded') => {
      const read = reads[index]; if (!read) throw new Error('Missing synthetic read');
      if (read.kind === 'call') { answer(read, marker, mode); return; }
      read.resolve(mode === 'failed' ? { ok: false, message: 'Synthetic read failed' } : { ok: true,
        snapshot: { ...read.snapshot, workspace: workspace(read, marker, mode) } });
    },
    churn: () => publish(),
    generation: () => publish({ generation: snapshot.generation + 1 }),
    // A new host lease (same host reconnected): both counters move.
    reconnect: () => publish({ connection: snapshot.connection + 1, generation: snapshot.generation + 1 }),
    offline: () => publish({ status: 'disconnected', data: { ...snapshot.data, host: { label: 'Synthetic interaction fixture', state: 'offline' } } }),
    online: () => publish({ status: 'connected', data: { ...snapshot.data, host: { label: 'Synthetic interaction fixture', state: 'connected' } } }),
    catalog: mode => publish({ data: { ...snapshot.data, agents: mode === 'empty' ? [] : mode === 'beta' ? [agents[1]!] : agents } }),
    cleanup,
  };
  window.workspaceQualification = control;
} catch (error) {
  cleanup();
  throw error;
}
type Control = Readonly<{
  hostile: string; hostileFile: string; longTitle: string;
  reads: () => readonly ReadSummary[];
  calls: () => typeof calls; writes: () => readonly string[]; incidental: () => readonly string[];
  resolve: (index: number, marker?: string, mode?: Mode) => void;
  churn: () => void; generation: () => void; reconnect: () => void; offline: () => void; online: () => void;
  catalog: (mode: 'both' | 'beta' | 'empty') => void; cleanup: () => void;
}>;
declare global { interface Window { workspaceQualification?: Control; workspaceQualificationCleanup?: () => void } }
