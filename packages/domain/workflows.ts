// Workflow runs in plain words: list status, run inputs, the start intent and
// which run actions a person may take. Pure: no I/O, no timers.
//
// A start is named by its clientRunToken. The same token always gets the same
// run from the host, and the same request ID gets the first answer again (24 h).
// So a start whose reply was lost keeps both, and the only way to "try again" is
// to send that exact start once more, by hand. Nothing here retries by itself.
import type {
  RunAction, RunDetail, RunProblem, RunState, RunSummary, StageKind, StageState, WorkflowInput, WorkflowOverview, WorkflowSummary,
} from '../contracts/workflows.ts';
import { WORKFLOW_LIMITS } from '../contracts/workflows.ts';

export type WorkflowStatus = 'needsYou' | 'running' | 'ready' | 'needsSetup' | 'draftOnly';
export const STATUS_TEXT: Readonly<Record<WorkflowStatus, string>> = Object.freeze({
  needsYou: 'Needs you', running: 'Running', ready: 'Ready', needsSetup: 'Needs setup', draftOnly: 'Draft only',
});

// Planned runs wait for a slot; accepted means the next stage is about to start.
export function isWorking(state: RunState): boolean {
  return state === 'planned' || state === 'launched' || state === 'running' || state === 'checking_output' || state === 'accepted';
}
export function needsPerson(state: RunState): boolean { return state === 'waiting_for_you' || state === 'needs_attention'; }

export function workflowStatus(workflow: WorkflowSummary, overview: Pick<WorkflowOverview, 'waiting' | 'active'>): WorkflowStatus {
  const runs = [...overview.waiting, ...overview.active].filter(run => run.workflowId === workflow.id);
  if (runs.some(run => needsPerson(run.state))) return 'needsYou';
  if (runs.some(run => isWorking(run.state))) return 'running';
  if (workflow.revision === null) return 'draftOnly';
  return workflow.needsSetup ? 'needsSetup' : 'ready';
}

export function runStateText(state: RunState): string {
  switch (state) {
    case 'planned': return 'Waiting to start';
    case 'launched': return 'Starting';
    case 'running': case 'accepted': return 'Running';
    case 'checking_output': return 'Checking';
    case 'waiting_for_you': return 'Needs you';
    case 'needs_attention': return 'Needs attention';
    case 'succeeded': return 'Done';
    case 'failed': return 'Failed';
    case 'cancelled': return 'Cancelled';
    default: return 'Unknown state';
  }
}

export function stageStateText(state: StageState): string {
  switch (state) {
    case 'pending': return 'Not started';
    case 'launched': return 'Starting';
    case 'running': return 'Running';
    case 'checking_output': return 'Checking';
    case 'accepted': return 'Done';
    case 'waiting_for_you': return 'Waiting for you';
    case 'needs_attention': return 'Needs attention';
    case 'failed': return 'Failed';
    case 'cancelled': return 'Cancelled';
    default: return 'Unknown state';
  }
}

export function stageKindText(kind: StageKind): string {
  switch (kind) {
    case 'agent': return 'Agent';
    case 'check': return 'Automatic check';
    case 'decision': return 'Pass or send back';
    case 'signoff': return 'Waits for your sign-off';
    case 'delivery': return 'Sends the results';
    case 'parallel': return 'At the same time';
    case 'command': return 'Runs a command';
    case 'pull_request': return 'Opens a pull request';
    default: return 'Step';
  }
}

const PROBLEM_WORDS: Readonly<Record<string, string>> = Object.freeze({
  host_restarted: 'The computer restarted during this stage, so nobody knows how it ended.',
  coordinator_restarted: 'The workflow service restarted during this stage, so nobody knows how it ended.',
  revision_limit: 'The review asked for more changes than this workflow allows.',
  agent_missing: 'An agent this workflow uses is no longer on your computer.',
  timed_out: 'The stage ran out of time.',
  check_failed: "The result didn't pass this workflow's checks.",
  storage_full: 'Your computer is out of room for workflow files.',
  agent_exit: 'The agent stopped before it finished.',
  spawn_failed: "The agent couldn't start.",
});
export function problemText(problem: RunProblem): string {
  if (problem.message) return problem.message;
  if (PROBLEM_WORDS[problem.code]) return PROBLEM_WORDS[problem.code]!;
  return problem.code.startsWith('contract_') ? "The stage's result didn't match what the next stage needs." : 'Something stopped this run.';
}

// One short line for a run row: "Running · Write the draft", "Failed · Write the draft".
export function runLine(run: RunSummary): string {
  if (run.state === 'succeeded' || run.state === 'cancelled' || run.state === 'other') return runStateText(run.state);
  if (run.state === 'planned') return run.paused ? 'Paused' : 'Waiting to start';
  const state = run.paused && isWorking(run.state) ? 'Pausing after this stage' : runStateText(run.state);
  return `${state} · ${run.stageTitle}`;
}

// Why a computer cannot run workflows, from /native/context `unavailable`.
export function unavailableText(code: string | null): string {
  switch (code) {
    case 'not_posix': return 'Workflows need Hermes on a Mac or Linux computer. The computer you are connected to cannot run them.';
    case 'profile_helpers_missing': return "Hermes on your computer is missing a part that workflows need. Update Hermes there, then refresh.";
    case 'chat_runner_missing': return "Hermes on your computer can't run workflow stages yet. Update Hermes there, then refresh.";
    case 'store_unavailable': return "Your computer can't open its workflow files right now. Check that Hermes' folder has free space, then refresh.";
    default: return 'Workflows need a newer bighelp plugin on your computer.';
  }
}

// Relative times in plain words; the exact local time goes in a tooltip or label.
export function relativeTime(at: number, now: number): string {
  const seconds = Math.round((now - at) / 1000);
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
export function duration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

// Run inputs, checked the way the plugin checks them (workflow_model.parse_inputs),
// so a person sees the problem next to the field instead of a refused start.
export type InputValues = Readonly<Record<string, string>>;
export type RunInputs = Readonly<Record<string, string | number>>;
export type PreparedInputs = Readonly<{ ok: true; inputs: RunInputs }> | Readonly<{ ok: false; errors: Readonly<Record<string, string>> }>;
const NUMBER = /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?$/u;
export function prepareRunInputs(definitions: readonly WorkflowInput[], values: InputValues): PreparedInputs {
  const inputs: Record<string, string | number> = {}, errors: Record<string, string> = {};
  for (const input of definitions) {
    const raw = Object.hasOwn(values, input.key) ? values[input.key] ?? '' : '';
    const given = raw.trim();
    if (!given) { if (input.required) errors[input.key] = `Fill in ${input.label}.`; continue; }
    if (input.type === 'number') {
      const value = Number(given);
      if (!NUMBER.test(given) || !Number.isFinite(value)) errors[input.key] = `${input.label} must be a number.`;
      else inputs[input.key] = value;
    } else if (input.type === 'choice') {
      if (!input.choices.includes(raw)) errors[input.key] = `Choose one of the choices for ${input.label}.`;
      else inputs[input.key] = raw;
    } else {
      const limit = input.type === 'long_text' ? WORKFLOW_LIMITS.longTextInput : WORKFLOW_LIMITS.textInput;
      if (raw.length > limit || !raw.isWellFormed() || raw.includes('\u0000')) errors[input.key] = `${input.label} can be at most ${limit.toLocaleString('en-US')} characters.`;
      else inputs[input.key] = raw;
    }
  }
  return Object.keys(errors).length ? Object.freeze({ ok: false, errors: Object.freeze(errors) })
    : Object.freeze({ ok: true, inputs: Object.freeze(inputs) });
}

export type StartIntent = Readonly<{
  workflowId: string; revision: number; inputs: RunInputs; clientRunToken: string; requestId: string;
  // 'unknown': a start went out and its answer did not come back.
  state: 'sending' | 'unknown';
}>;
export type StartRequest = Readonly<{ workflowId: string; revision: number; inputs: RunInputs; clientRunToken: string; requestId: string }>;
export type StartReply = Readonly<{ ok: true; value: RunSummary }> | Readonly<{ ok: false; code: string; message: string }>;
export type StartSettled = Readonly<{ intent: StartIntent | null; outcome: 'started' | 'refused' | 'unknown'; message: string; run: RunSummary | null }>;

export const NOT_SURE_STARTED = "Not sure this run started. Check the runs below before you start it again.";

// Recorded before the start is sent. Both IDs come from crypto.randomUUID().
export function createStartIntent(workflowId: string, revision: number, inputs: RunInputs, newId: () => string): StartIntent {
  return Object.freeze({ workflowId, revision, inputs, clientRunToken: newId(), requestId: newId(), state: 'sending' });
}
// Sending the same start again: same token, same request ID, same body.
export function resendStart(intent: StartIntent): StartIntent { return Object.freeze({ ...intent, state: 'sending' }); }
export function startRequest(intent: StartIntent): StartRequest {
  return Object.freeze({ workflowId: intent.workflowId, revision: intent.revision, inputs: intent.inputs,
    clientRunToken: intent.clientRunToken, requestId: intent.requestId });
}

// `uncertain`: an earlier send of this intent already had a lost answer.
export function settleStart(intent: StartIntent, reply: StartReply, uncertain: boolean): StartSettled {
  if (reply.ok) return Object.freeze({ intent: null, outcome: 'started', message: '', run: reply.value });
  if (reply.code === 'unknown') return Object.freeze({ intent: Object.freeze({ ...intent, state: 'unknown' }), outcome: 'unknown', message: NOT_SURE_STARTED, run: null });
  // The host answered this exact token: had it made a run, it would have returned it.
  if (reply.code === 'invalid' || reply.code === 'conflict') return Object.freeze({ intent: null, outcome: 'refused', message: reply.message, run: null });
  // Not sent, or refused before the host looked. An earlier lost answer stays unknown.
  if (uncertain) return Object.freeze({ intent: Object.freeze({ ...intent, state: 'unknown' }), outcome: 'unknown',
    message: `${reply.message} ${NOT_SURE_STARTED}`, run: null });
  return Object.freeze({ intent: null, outcome: 'refused', message: reply.message, run: null });
}

// Only advertised actions, and only the ones this app offers. Pause has no
// button (as in bighelp for Mac); resume shows only for a paused run.
export type OfferedAction = 'retry' | 'cancel' | 'resume';
export function offeredActions(run: Pick<RunDetail, 'allowedActions' | 'paused'>): readonly OfferedAction[] {
  const allowed = new Set<RunAction>(run.allowedActions);
  return Object.freeze((['retry', 'resume', 'cancel'] as const).filter(action => allowed.has(action) && (action !== 'resume' || run.paused)));
}
export const ACTION_TEXT: Readonly<Record<OfferedAction, Readonly<{ label: string; title: string; body: string; confirm: string; tone: 'primary' | 'danger' }>>> = Object.freeze({
  retry: { label: 'Try again', title: 'Try this part again?', confirm: 'Try again', tone: 'primary',
    body: 'This starts the stopped part again on your computer and uses AI credits. The earlier attempt stays on the record.' },
  resume: { label: 'Resume', title: 'Resume this run?', confirm: 'Resume', tone: 'primary',
    body: 'The run goes on with its next stage on your computer. This uses AI credits.' },
  cancel: { label: 'Cancel run', title: 'Cancel this run?', confirm: 'Cancel run', tone: 'danger',
    body: "Any agent working on it stops now. A cancelled run can't go on; you can start a new one." },
});

// A file sign-off is offered only for the exact file on screen: the hash this
// app read and checked must be the one the run is waiting on now.
export type SignoffGate = 'none' | 'changes' | 'load' | 'ready';
export function signoffGate(run: Pick<RunDetail, 'state' | 'waiting' | 'signoff'>, shownSha256: string | null): SignoffGate {
  const signoff = run.signoff;
  if (run.state !== 'waiting_for_you' || !signoff || run.waiting?.stageKey !== signoff.stageKey) return 'none';
  if (signoff.kind === 'changes') return 'changes';
  return shownSha256 === signoff.artifact.sha256 ? 'ready' : 'load';
}

// Text outputs shown inline or read from the run on request.
export function readableOutput(type: string): boolean { return type === 'markdown_file' || type === 'text'; }
