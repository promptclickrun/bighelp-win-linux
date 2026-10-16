// Workflow calls (bighelp plugin, native-workflows-v1). Workflows are host-wide,
// so nothing here names an agent profile. This app runs workflows; it does not
// edit them. Every write is a single attempt; see packages/domain/workflows.ts
// for how a start whose answer was lost is sent again by hand.
import type { RunDetail, RunPage, RunSummary, WorkflowDetail, WorkflowOverview } from '../../../../../packages/contracts/workflows.ts';
import { WORKFLOW_LIMITS, isRunCursor, isRunId, isSha256, isStageKey, isWorkflowId } from '../../../../../packages/contracts/workflows.ts';
import { defineCall } from '../call.ts';
import { InvalidInput, compact, fields, integer, oneOf, optional, record, text, uuid } from '../validate.ts';

export const RUN_FILTERS = Object.freeze(['all', 'active', 'for_you', 'attention'] as const);
export type RunFilter = typeof RUN_FILTERS[number];
export const CONTROL_ACTIONS = Object.freeze(['cancel', 'retry', 'resume'] as const);
// A text output, read from the run and checked against its SHA-256 in main.
export type WorkflowOutputText = Readonly<{ sha256: string; text: string; bytes: number }>;
export type StartInput = Readonly<{
  workflowId: string; revision: number; inputs: Readonly<Record<string, string | number>>; clientRunToken: string; requestId: string;
}>;

function check<T>(value: unknown, guard: (value: unknown) => value is T): T { if (!guard(value)) throw new InvalidInput(); return value; }
const workflowId = (value: unknown) => check(value, isWorkflowId);
const runId = (value: unknown) => check(value, isRunId);
// The plugin takes UUID versions 1 to 5; this app makes version 4 tokens.
function runToken(value: unknown): string {
  const token = uuid(value);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(token)) throw new InvalidInput();
  return token;
}
// Values for the workflow's input keys. Empty optional inputs are left out, so
// every value says something. The host checks them against the definition.
function runInputs(value: unknown): Readonly<Record<string, string | number>> {
  const entries = Object.entries(record(value));
  if (entries.length > WORKFLOW_LIMITS.inputs) throw new InvalidInput();
  const result: Record<string, string | number> = {};
  for (const [key, entry] of entries) {
    if (!isStageKey(key)) throw new InvalidInput();
    if (typeof entry === 'number') { if (!Number.isFinite(entry)) throw new InvalidInput(); result[key] = entry; }
    else result[key] = text(entry, { max: WORKFLOW_LIMITS.longTextInput, multiline: true });
  }
  return Object.freeze(result);
}

export const WORKFLOW_CALLS = Object.freeze({
  'workflows.overview': defineCall<WorkflowOverview>()(input => { fields(input, []); return Object.freeze({}); }),
  'workflows.detail': defineCall<WorkflowDetail>()(input => Object.freeze({ workflowId: workflowId(fields(input, ['workflowId']).workflowId) })),
  'workflows.runs': defineCall<RunPage>()((input): Readonly<{ workflowId?: string; filter: RunFilter; before?: string }> => {
    const value = fields(input, ['filter'], ['workflowId', 'before']);
    return compact({ filter: oneOf(value.filter, RUN_FILTERS), workflowId: optional(value.workflowId, workflowId),
      before: optional(value.before, entry => check(entry, isRunCursor)) });
  }),
  'workflows.run': defineCall<RunDetail>()(input => Object.freeze({ runId: runId(fields(input, ['runId']).runId) })),
  'workflows.output': defineCall<WorkflowOutputText>()(input => {
    const value = fields(input, ['runId', 'sha256']);
    return Object.freeze({ runId: runId(value.runId), sha256: check(value.sha256, isSha256) });
  }),
  // Starts agents and spends AI credits; the window asks first. Both IDs come
  // from the window so the same start can be sent again after a lost answer.
  'workflows.start': defineCall<RunSummary>()((input): StartInput => {
    const value = fields(input, ['workflowId', 'revision', 'inputs', 'clientRunToken', 'requestId']);
    const clientRunToken = runToken(value.clientRunToken), requestId = uuid(value.requestId);
    if (clientRunToken === requestId) throw new InvalidInput();
    return Object.freeze({ workflowId: workflowId(value.workflowId), revision: integer(value.revision, 1, 2 ** 31),
      inputs: runInputs(value.inputs), clientRunToken, requestId });
  }),
  // `expectedVersion` is the run version the person saw; the host refuses a run that moved on.
  'workflows.control': defineCall<RunSummary>()(input => {
    const value = fields(input, ['runId', 'action', 'expectedVersion']);
    return Object.freeze({ runId: runId(value.runId), action: oneOf(value.action, CONTROL_ACTIONS),
      expectedVersion: integer(value.expectedVersion, 1, Number.MAX_SAFE_INTEGER) });
  }),
  // `artifactSha256` is the hash of the file this app read and showed. Asking for
  // changes needs a note, so the agent knows what to do.
  'workflows.signoff': defineCall<RunSummary>()((input): Readonly<{ runId: string; stageKey: string; decision: 'approve' | 'changes'; artifactSha256: string; notes: string }> => {
    const value = fields(input, ['runId', 'stageKey', 'decision', 'artifactSha256'], ['notes']);
    const decision = oneOf(value.decision, ['approve', 'changes'] as const);
    const notes = optional(value.notes, entry => text(entry, { max: WORKFLOW_LIMITS.signoffNotes, min: 0, multiline: true })) ?? '';
    if (decision === 'changes' && !notes.trim()) throw new InvalidInput();
    return Object.freeze({ runId: runId(value.runId), stageKey: check(value.stageKey, isStageKey), decision,
      artifactSha256: check(value.artifactSha256, isSha256), notes });
  }),
});
