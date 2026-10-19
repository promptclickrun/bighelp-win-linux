import { encodeBoundedJson } from './rpc.ts';

// bighelp plugin workflows (docs/contracts/PLUGIN_API.md §5, upstream WORKFLOWS.md).
// Display projections: strict about the values that route a write (workflow and
// run IDs, stage keys, file hashes, run versions), tolerant of additive display
// fields. Unknown states are kept as 'other' and never gain an action. Host
// paths (Dev Factory projects and worktrees), attempt IDs, logs and briefs never
// leave main.

export const WORKFLOW_LIMITS = Object.freeze({
  responseBytes: 196608, workflows: 200, runs: 50, stages: 40, inputs: 50, roles: 40, outputs: 200, issues: 200, notes: 40,
  textInput: 2000, longTextInput: 20000, chunkBytes: 98304, fileBytes: 512 * 1024, signoffNotes: 2000, choices: 20,
});

export const RUN_STATES = Object.freeze(['planned', 'launched', 'running', 'checking_output', 'accepted', 'waiting_for_you',
  'needs_attention', 'succeeded', 'failed', 'cancelled'] as const);
export type RunState = typeof RUN_STATES[number] | 'other';
export const STAGE_STATES = Object.freeze(['pending', 'launched', 'running', 'checking_output', 'accepted', 'waiting_for_you',
  'needs_attention', 'failed', 'cancelled'] as const);
export type StageState = typeof STAGE_STATES[number] | 'other';
export const RUN_ACTIONS = Object.freeze(['cancel', 'retry', 'pause', 'resume'] as const);
export type RunAction = typeof RUN_ACTIONS[number];
export const STAGE_KINDS = Object.freeze(['agent', 'check', 'decision', 'signoff', 'delivery', 'parallel', 'command', 'pull_request'] as const);
export type StageKind = typeof STAGE_KINDS[number] | 'other';
export const INPUT_TYPES = Object.freeze(['text', 'long_text', 'number', 'choice'] as const);
export type InputType = typeof INPUT_TYPES[number];

export type WorkflowSummary = Readonly<{
  id: string; name: string; revision: number | null; hasDraft: boolean; stageCount: number; needsSetup: boolean;
  valid: boolean; pinned: boolean; lastRunAt: number | null; schemaVersion: number;
}>;
export type RunProblem = Readonly<{ code: string; message: string }>;
export type RunSummary = Readonly<{
  id: string; number: number; workflowId: string; workflowName: string; revision: number; state: RunState;
  stageKey: string; stageTitle: string; stageState: StageState; stagesDone: number; stageCount: number; iteration: number;
  startedAt: number | null; updatedAt: number | null; endedAt: number | null; paused: boolean; version: number;
  attention?: RunProblem; failure?: RunProblem & Readonly<{ stageKey: string }>;
  waiting?: Readonly<{ kind: 'signoff' | 'other'; stageKey: string; since: number | null }>;
}>;
export type WorkflowOverview = Readonly<{
  workflows: readonly WorkflowSummary[]; waiting: readonly RunSummary[]; active: readonly RunSummary[];
}>;
export type RunPage = Readonly<{ runs: readonly RunSummary[]; hasMore: boolean; cursor: string | null }>;

export type WorkflowInput = Readonly<{
  key: string; label: string; type: InputType; required: boolean; choices: readonly string[]; sample?: string;
}>;
export type WorkflowStage = Readonly<{
  key: string; kind: StageKind; title: string; role: string | null; branches: readonly Readonly<{ key: string; title: string; role: string | null }>[];
}>;
export type WorkflowRole = Readonly<{ key: string; label: string; agentId: string | null }>;
export type WorkflowIssue = Readonly<{ code: string; message: string; severity: 'error' | 'warning'; stageKey?: string }>;
export type WorkflowDetail = Readonly<{
  id: string; name: string; description: string; schemaVersion: number; archived: boolean; pinned: boolean;
  // The revision the definition below is from; null means the draft (never published).
  revision: number | null; latestRevision: number | null;
  inputs: readonly WorkflowInput[]; stages: readonly WorkflowStage[]; roles: readonly WorkflowRole[];
  validation: Readonly<{ valid: boolean; host: boolean; issues: readonly WorkflowIssue[] }>;
}>;

export type ReviewNote = Readonly<{ severity: 'minor' | 'major'; text: string }>;
export type RunOutput = Readonly<{
  stageKey: string; iteration: number; name: string; type: string; sha256: string; bytes: number; wordCount?: number;
  value?: string | number | readonly ReviewNote[];
}>;
export type RunStage = Readonly<{
  key: string; kind: StageKind; title: string; role: string | null; agentId: string | null; iteration: number; state: StageState;
  startedAt: number | null; endedAt: number | null; attempts: number; group: string | null;
  outcome?: Readonly<{ end: 'succeeded' | 'cancelled' | 'failed'; note: string }>;
}>;
// A file sign-off binds to `artifact.sha256`. Dev Factory sign-offs on project
// changes ('changes') cannot be shown here, so they are never approved here.
export type RunSignoff =
  | Readonly<{ kind: 'file'; stageKey: string; artifact: RunOutput; previous: RunOutput | null; reviewNotes: readonly ReviewNote[] }>
  | Readonly<{ kind: 'changes'; stageKey: string }>;
export type RunDetail = RunSummary & Readonly<{
  inputs: readonly Readonly<{ key: string; value: string }>[]; stages: readonly RunStage[]; outputs: readonly RunOutput[];
  signoff: RunSignoff | null; allowedActions: readonly RunAction[]; tokens: Readonly<{ in: number; out: number }> | null;
}>;
export type ArtifactChunk = Readonly<{ sha256: string; offset: number; total: number; data: string; done: boolean }>;

const invalid = (): never => { throw new TypeError('Invalid workflow response'); };
function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
function maybeObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function bounded(value: unknown): Record<string, unknown> {
  encodeBoundedJson(value, WORKFLOW_LIMITS.responseBytes);
  return object(value);
}
function rows(value: unknown, max: number): readonly unknown[] {
  if (!Array.isArray(value) || value.length > max) return invalid();
  return value;
}
function optionalField<K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> {
  return value === undefined ? {} : { [key]: value } as Record<K, V>;
}

const WORKFLOW_ID = /^wf_[0-9a-f]{16}$/u;
const RUN_ID = /^run_[0-9a-f]{16}$/u;
const KEY = /^[a-z][a-z0-9_]{0,31}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const PROFILE = /^[a-z0-9][a-z0-9_-]{0,63}$/u;
const CURSOR = /^[0-9]{1,18}$/u;
const CODE = /^[a-z][a-z0-9_]{0,63}$/u;
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
export function isWorkflowId(value: unknown): value is string { return typeof value === 'string' && WORKFLOW_ID.test(value); }
export function isRunId(value: unknown): value is string { return typeof value === 'string' && RUN_ID.test(value); }
export function isStageKey(value: unknown): value is string { return typeof value === 'string' && KEY.test(value); }
export function isSha256(value: unknown): value is string { return typeof value === 'string' && SHA256.test(value); }
export function isRunCursor(value: unknown): value is string { return typeof value === 'string' && CURSOR.test(value); }

// Display text: drop controls and bidirectional overrides, keep newlines when
// asked, and cut very long values instead of failing a whole list over one row.
const LINE_CONTROLS = /[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]+/gu;
const TEXT_CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f‪-‮⁦-⁩]+/gu;
function display(value: unknown, max: number, multiline = false): string | undefined {
  if (typeof value !== 'string' || !value.isWellFormed()) return undefined;
  const cleaned = multiline ? value.replace(TEXT_CONTROLS, '').replace(/\r\n?/gu, '\n') : value.replace(LINE_CONTROLS, ' ');
  const trimmed = (multiline ? cleaned : cleaned.replace(/\s+/gu, ' ')).trim();
  if (!trimmed) return undefined;
  if (trimmed.length <= max) return trimmed;
  const cut = trimmed.slice(0, max - 1);
  return `${cut.isWellFormed() ? cut : cut.slice(0, -1)}…`;
}
function count(value: unknown, max = 1_000_000): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? Math.min(value, max) : 0;
}
function positive(value: unknown, max = 2 ** 53 - 1): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > max) return invalid();
  return value;
}
function revision(value: unknown): number | null { return value === null || value === undefined ? null : positive(value, 2 ** 31); }
// UTC whole seconds ending in Z, as epoch milliseconds. Anything else is unknown.
function time(value: unknown): number | null {
  if (typeof value !== 'string' || !TIME.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}
function code(value: unknown): string { return typeof value === 'string' && CODE.test(value) ? value : 'unknown'; }
function profile(value: unknown): string | null { return typeof value === 'string' && PROFILE.test(value) ? value : null; }
function member<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && values.some(known => known === value);
}
function stageKind(value: unknown): StageKind { return member(STAGE_KINDS, value) ? value : 'other'; }

function problem(value: unknown): RunProblem | undefined {
  if (value === undefined || value === null) return undefined;
  const row = object(value);
  return Object.freeze({ code: code(row.code), message: display(row.message, 1000) ?? '' });
}

export function decodeRunSummary(value: unknown): RunSummary {
  const row = object(value);
  if (!isRunId(row.id) || !isWorkflowId(row.workflowId) || !isStageKey(row.stageKey)) return invalid();
  const state: RunState = member(RUN_STATES, row.state) ? row.state : 'other';
  const failure = problem(row.failure), failedAt = maybeObject(row.failure).stageKey;
  const waitingRow = row.waiting === undefined || row.waiting === null ? null : object(row.waiting);
  return Object.freeze({
    id: row.id, number: positive(row.number), workflowId: row.workflowId,
    workflowName: display(row.workflowName, 80) ?? 'Workflow', revision: positive(row.revision, 2 ** 31), state,
    stageKey: row.stageKey, stageTitle: display(row.stageTitle, 80) ?? 'Stage',
    stageState: member(STAGE_STATES, row.stageState) ? row.stageState : 'other',
    stagesDone: count(row.stagesDone, 1000), stageCount: count(row.stageCount, 1000), iteration: count(row.iteration, 1000),
    startedAt: time(row.startedAt), updatedAt: time(row.updatedAt), endedAt: time(row.endedAt), paused: row.paused === true,
    version: positive(row.version, 2 ** 62),
    ...optionalField('attention', problem(row.attention)),
    ...optionalField('failure', failure ? Object.freeze({ ...failure, stageKey: isStageKey(failedAt) ? failedAt : row.stageKey }) : undefined),
    ...optionalField('waiting', waitingRow && isStageKey(waitingRow.stageKey) ? Object.freeze({
      kind: waitingRow.kind === 'signoff' ? 'signoff' as const : 'other' as const, stageKey: waitingRow.stageKey, since: time(waitingRow.since),
    }) : undefined),
  });
}

// One bad row does not hide the others; it is left out.
function summaries(value: unknown): readonly RunSummary[] {
  const result: RunSummary[] = [];
  for (const entry of rows(value ?? [], WORKFLOW_LIMITS.runs)) {
    try { result.push(decodeRunSummary(entry)); } catch { /* left out */ }
  }
  return Object.freeze(result);
}

export function decodeWorkflowOverview(value: unknown): WorkflowOverview {
  const payload = bounded(value);
  const workflows: WorkflowSummary[] = [];
  for (const entry of rows(payload.workflows, WORKFLOW_LIMITS.workflows)) {
    const row = object(entry);
    if (!isWorkflowId(row.id) || row.archived === true) continue;
    workflows.push(Object.freeze({
      id: row.id, name: display(row.name, 80) ?? 'Untitled workflow', revision: revision(row.revision), hasDraft: row.hasDraft === true,
      stageCount: count(row.stageCount, 1000),
      needsSetup: Array.isArray(row.needsSetupRoles) && row.needsSetupRoles.length > 0, valid: row.valid === true,
      pinned: row.pinned === true, lastRunAt: time(row.lastRunAt),
      schemaVersion: typeof row.schemaVersion === 'number' && Number.isSafeInteger(row.schemaVersion) ? row.schemaVersion : 1,
    }));
  }
  if (new Set(workflows.map(row => row.id)).size !== workflows.length) return invalid();
  // Pinned first, keeping the host's order otherwise.
  const ordered = [...workflows.filter(row => row.pinned), ...workflows.filter(row => !row.pinned)];
  return Object.freeze({ workflows: Object.freeze(ordered), waiting: summaries(payload.waiting), active: summaries(payload.active) });
}

export function decodeRunPage(value: unknown): RunPage {
  const payload = bounded(value);
  return Object.freeze({ runs: summaries(payload.runs), hasMore: payload.hasMore === true,
    cursor: isRunCursor(payload.cursor) ? payload.cursor : null });
}

// `{run}` from runs/start, runs/control and runs/signoff. A missing or unreadable
// run is not a confirmation.
export function decodeRunReply(value: unknown): RunSummary {
  return decodeRunSummary(bounded(value).run);
}

function decodeInput(value: unknown): WorkflowInput | null {
  const row = object(value);
  if (!isStageKey(row.key) || !member(INPUT_TYPES, row.type)) return null;
  const choices = row.type === 'choice' ? rows(row.choices ?? [], WORKFLOW_LIMITS.choices)
    .filter((choice): choice is string => typeof choice === 'string' && choice.length > 0 && choice.length <= 80 && choice.isWellFormed()) : [];
  const sample = typeof row.sample === 'number' && Number.isFinite(row.sample) ? String(row.sample) : display(row.sample, 200);
  return Object.freeze({ key: row.key, label: display(row.label, 80) ?? row.key, type: row.type, required: row.required === true,
    choices: Object.freeze([...new Set(choices)]), ...optionalField('sample', sample) });
}

function decodeStage(value: unknown): WorkflowStage {
  const row = object(value);
  if (!isStageKey(row.key)) return invalid();
  const branches = stageKind(row.kind) === 'parallel' ? rows(row.branches ?? [], 5).map(entry => {
    const branch = object(entry);
    if (!isStageKey(branch.key)) return invalid();
    return Object.freeze({ key: branch.key, title: display(branch.title, 80) ?? branch.key, role: isStageKey(branch.role) ? branch.role : null });
  }) : [];
  return Object.freeze({ key: row.key, kind: stageKind(row.kind), title: display(row.title, 80) ?? row.key,
    role: isStageKey(row.role) ? row.role : null, branches: Object.freeze(branches) });
}

function decodeValidation(value: unknown): WorkflowDetail['validation'] {
  const row = maybeObject(value);
  const issues = rows(row.issues ?? [], WORKFLOW_LIMITS.issues).map(entry => {
    const issue = object(entry);
    return Object.freeze({ code: code(issue.code), message: display(issue.message, 300) ?? 'This workflow has a problem.',
      severity: issue.severity === 'warning' ? 'warning' as const : 'error' as const,
      ...optionalField('stageKey', isStageKey(issue.stageKey) ? issue.stageKey : undefined) });
  });
  return Object.freeze({ valid: row.valid === true, host: row.host === true, issues: Object.freeze(issues) });
}

// `get` for one revision (or the draft). Bindings are the current role picks.
export function decodeWorkflowDetail(value: unknown): WorkflowDetail {
  const payload = bounded(value);
  const workflow = object(payload.workflow);
  if (!isWorkflowId(workflow.id)) return invalid();
  const definition = object(workflow.definition);
  const bound = new Map<string, string | null>();
  for (const entry of rows(workflow.bindings ?? [], WORKFLOW_LIMITS.roles)) {
    const row = object(entry);
    if (isStageKey(row.role)) bound.set(row.role, profile(row.agentId));
  }
  const roles = rows(definition.roles ?? [], WORKFLOW_LIMITS.roles).map(entry => {
    const row = object(entry);
    if (!isStageKey(row.key)) return invalid();
    return Object.freeze({ key: row.key, label: display(row.label, 80) ?? row.key, agentId: bound.get(row.key) ?? null });
  });
  const inputs = rows(definition.inputs ?? [], WORKFLOW_LIMITS.inputs).map(decodeInput);
  // An input this app cannot fill would make every start fail; refuse the workflow instead.
  if (inputs.some(input => input === null)) return invalid();
  const stages = rows(definition.stages ?? [], WORKFLOW_LIMITS.stages).map(decodeStage);
  const keys = [...stages.flatMap(stage => [stage.key, ...stage.branches.map(branch => branch.key)])];
  if (new Set(keys).size !== keys.length || new Set(inputs.map(input => input?.key)).size !== inputs.length) return invalid();
  return Object.freeze({
    id: workflow.id, name: display(workflow.name, 80) ?? display(definition.name, 80) ?? 'Untitled workflow',
    description: display(definition.description, 1000, true) ?? '',
    schemaVersion: typeof definition.schemaVersion === 'number' && Number.isSafeInteger(definition.schemaVersion) ? definition.schemaVersion : 1,
    archived: workflow.archived === true, pinned: workflow.pinned === true,
    revision: revision(workflow.revision), latestRevision: revision(workflow.latestRevision),
    inputs: Object.freeze(inputs as WorkflowInput[]), stages: Object.freeze(stages), roles: Object.freeze(roles),
    validation: decodeValidation(payload.validation),
  });
}

function decodeNotes(value: unknown): readonly ReviewNote[] {
  return Object.freeze(rows(value, WORKFLOW_LIMITS.notes).flatMap(entry => {
    const row = maybeObject(entry);
    const text = display(row.text, 1000, true);
    return text ? [Object.freeze({ severity: row.severity === 'major' ? 'major' as const : 'minor' as const, text })] : [];
  }));
}

function decodeOutput(value: unknown): RunOutput {
  const row = object(value);
  if (!isStageKey(row.stageKey) || !isStageKey(row.name) || !isSha256(row.sha256)) return invalid();
  const type = code(row.type);
  let shown: RunOutput['value'];
  if (type === 'number' && typeof row.value === 'number' && Number.isFinite(row.value)) shown = row.value;
  else if (type === 'notes' && Array.isArray(row.value)) shown = decodeNotes(row.value);
  else if ((type === 'text' || type === 'decision') && typeof row.value === 'string') shown = display(row.value, 8192, true);
  return Object.freeze({ stageKey: row.stageKey, iteration: count(row.iteration, 1000), name: row.name, type, sha256: row.sha256,
    bytes: count(row.bytes, 2 ** 40), ...optionalField('wordCount', typeof row.wordCount === 'number' ? count(row.wordCount) : undefined),
    ...optionalField('value', shown) });
}

function decodeRunStage(value: unknown): RunStage {
  const row = object(value);
  if (!isStageKey(row.key)) return invalid();
  const outcome = maybeObject(row.outcome);
  const end = outcome.end === 'succeeded' || outcome.end === 'cancelled' || outcome.end === 'failed' ? outcome.end : undefined;
  return Object.freeze({
    key: row.key, kind: stageKind(row.kind), title: display(row.title, 80) ?? row.key, role: isStageKey(row.role) ? row.role : null,
    agentId: profile(row.agentId), iteration: count(row.iteration, 1000), state: member(STAGE_STATES, row.state) ? row.state : 'other',
    startedAt: time(row.startedAt), endedAt: time(row.endedAt), attempts: Array.isArray(row.attempts) ? Math.min(row.attempts.length, 1000) : 0,
    group: isStageKey(row.group) ? row.group : null,
    ...optionalField('outcome', end ? Object.freeze({ end, note: display(outcome.note, 200) ?? '' }) : undefined),
  });
}

function decodeSignoff(value: unknown): RunSignoff | null {
  if (value === undefined || value === null) return null;
  const row = object(value);
  if (!isStageKey(row.stageKey)) return invalid();
  // Dev Factory: approval of a project's changes. Not shown or approved here.
  if (row.artifact === undefined && (row.changes !== undefined || row.sha256 !== undefined)) return Object.freeze({ kind: 'changes', stageKey: row.stageKey });
  const artifact = decodeOutput(row.artifact);
  return Object.freeze({ kind: 'file', stageKey: row.stageKey, artifact,
    previous: row.previous === undefined || row.previous === null ? null : decodeOutput(row.previous),
    reviewNotes: Array.isArray(row.reviewNotes) ? decodeNotes(row.reviewNotes) : Object.freeze([]) });
}

export function decodeRunDetail(value: unknown): RunDetail {
  const run = object(bounded(value).run);
  const summary = decodeRunSummary(run);
  const inputs = Object.entries(maybeObject(run.inputs)).slice(0, WORKFLOW_LIMITS.inputs).flatMap(([key, entry]) => {
    if (!isStageKey(key)) return [];
    const text = typeof entry === 'number' && Number.isFinite(entry) ? String(entry) : display(entry, WORKFLOW_LIMITS.longTextInput, true);
    return text === undefined ? [] : [Object.freeze({ key, value: text })];
  });
  const allowed = rows(run.allowedActions ?? [], 8).filter((action): action is RunAction => member(RUN_ACTIONS, action));
  const tokens = maybeObject(run.tokens);
  return Object.freeze({
    ...summary, inputs: Object.freeze(inputs),
    stages: Object.freeze(rows(run.stages ?? [], WORKFLOW_LIMITS.stages * 2).map(decodeRunStage)),
    outputs: Object.freeze(rows(run.outputs ?? [], WORKFLOW_LIMITS.outputs).map(decodeOutput)),
    signoff: decodeSignoff(run.signoff), allowedActions: Object.freeze([...new Set(allowed)]),
    tokens: Number.isSafeInteger(tokens.in) && Number.isSafeInteger(tokens.out)
      ? Object.freeze({ in: count(tokens.in, 2 ** 52), out: count(tokens.out, 2 ** 52) }) : null,
  });
}

export function decodeArtifactChunk(value: unknown): ArtifactChunk {
  const payload = bounded(value);
  if (!isSha256(payload.sha256) || typeof payload.data !== 'string' || !BASE64.test(payload.data) || typeof payload.done !== 'boolean') return invalid();
  const offset = payload.offset, total = payload.total;
  if (typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0 || typeof total !== 'number'
    || !Number.isSafeInteger(total) || total < 0) return invalid();
  return Object.freeze({ sha256: payload.sha256, offset, total, data: payload.data, done: payload.done });
}
