// bighelp plugin workflows: POST /api/plugins/loopdy/native/workflows/<route>
// with the native context ETag and a request ID (docs/contracts/PLUGIN_API.md §5).
// Reads and writes alike go through the verified context. Writes are sent once;
// a lost or unreadable answer, a 412 (the host may have committed before the
// context changed) and any 5xx are "not sure", never success or failure.
import { createHash } from 'node:crypto';
import {
  WORKFLOW_LIMITS, decodeArtifactChunk, decodeRunDetail, decodeRunPage, decodeRunReply, decodeWorkflowDetail, decodeWorkflowOverview,
} from '../../../../../packages/contracts/workflows.ts';
import type { RunSummary } from '../../../../../packages/contracts/workflows.ts';
import { decodeWorkspaceContext } from '../../../../../packages/contracts/workspace.ts';
import { NOT_SURE_STARTED, unavailableText } from '../../../../../packages/domain/workflows.ts';
import { HttpStatusError } from '../../../../../packages/platform/transport-policy.ts';
import type { WORKFLOW_CALLS } from '../../shared/calls/workflows.ts';
import type { CallContext } from './context.ts';
import { CallError } from './context.ts';
import type { CallHandlers } from './index.ts';

export const WORKFLOWS_FEATURE = 'native-workflows-v1';
const BASE = '/api/plugins/loopdy/native/workflows/';
const NO_PLUGIN = 'Workflows need the bighelp plugin on your computer.';
const UNREADABLE = "The bighelp plugin sent workflow data this app can't read.";
const GONE = "This isn't on your computer any more. Refresh to see the latest.";
const NOT_SURE_CONTROL = 'Not sure that went through. Check the run before trying again.';
const NOT_SURE_SIGNOFF = 'Not sure your sign-off went through. Check the run before trying again.';
// The plugin refuses with these before it starts or changes anything (PLUGIN_API.md §2).
const REFUSED_FIRST = new Set(['runner_unavailable', 'workflows_unavailable', 'store_unavailable']);
const NOT_NOW = "Workflows can't run on your computer right now, so nothing changed. Try again later.";
// A reply that does not echo the context it was sent under is not this request's answer.
class EchoMismatch extends Error {}

type Session = Readonly<{
  read<T>(route: string, body: Readonly<Record<string, unknown>>, decoder: (value: unknown) => T): Promise<T>;
  write(route: string, body: Readonly<Record<string, unknown>>, notSure: string, requestId?: string): Promise<RunSummary>;
}>;

// The verified native context, or one plain sentence on why workflows are off.
async function open(context: CallContext): Promise<Session> {
  let response;
  try { response = await context.nativeContext(); } catch (error) {
    if (error instanceof HttpStatusError && [404, 405, 501].includes(error.status)) throw new CallError('unsupported', NO_PLUGIN);
    throw error;
  }
  let plugin;
  try { plugin = decodeWorkspaceContext(response.body, context.identity, response.etag, response.cacheControl); }
  catch { throw new CallError('invalid', 'The bighelp plugin on your computer sent an unexpected reply.'); }
  if (!plugin.features.includes(WORKFLOWS_FEATURE)) {
    // `unavailable` carries one fixed reason code per feature; anything else is an older plugin.
    const body = response.body as Record<string, unknown>;
    const reasons = body.unavailable && typeof body.unavailable === 'object' && !Array.isArray(body.unavailable)
      ? body.unavailable as Record<string, unknown> : {};
    const reason = reasons[WORKFLOWS_FEATURE];
    throw new CallError('unsupported', unavailableText(typeof reason === 'string' ? reason : null));
  }
  const etag = plugin.etag;
  async function send(route: string, body: Readonly<Record<string, unknown>>, requestId: string): Promise<unknown> {
    const json = JSON.stringify(body);
    if (new TextEncoder().encode(json).byteLength > WORKFLOW_LIMITS.responseBytes) throw new CallError('invalid', 'That is too long to send. Shorten it and try again.');
    const response = await context.http({ method: 'POST', path: BASE + route, body: json, maxBytes: WORKFLOW_LIMITS.responseBytes,
      native: { etag, requestId } });
    if (response.etag !== etag) throw new EchoMismatch();
    return response.body;
  }
  return Object.freeze({
    async read<T>(route: string, body: Readonly<Record<string, unknown>>, decoder: (value: unknown) => T): Promise<T> {
      let reply;
      try { reply = await send(route, body, context.requestId()); } catch (error) {
        if (error instanceof HttpStatusError) {
          if (error.status === 404) throw new CallError('stale', GONE);
          if (error.status === 412) throw new CallError('stale', 'Something changed on your computer. Refresh and try again.');
          if (error.status === 503) throw new CallError('unavailable', error.detail || "Workflows aren't available on your computer right now.");
        }
        if (error instanceof EchoMismatch) throw new CallError('unavailable', 'The bighelp plugin on your computer sent an unexpected reply. Try again.');
        throw error;
      }
      try { return decoder(reply); } catch { throw new CallError('invalid', UNREADABLE); }
    },
    async write(route: string, body: Readonly<Record<string, unknown>>, notSure: string, requestId = context.requestId()): Promise<RunSummary> {
      let reply;
      try { reply = await send(route, body, requestId); } catch (error) {
        if (error instanceof CallError) throw error;
        if (error instanceof HttpStatusError) {
          if (error.status === 503 && REFUSED_FIRST.has(error.code)) throw new CallError('unavailable', error.detail || NOT_NOW);
          // 412 can follow a committed change; it never authorizes sending it again.
          if (error.status === 412 || error.status >= 500) throw new CallError('unknown', notSure);
          if (error.status === 404) throw new CallError('invalid', GONE);
          // 401/403 (refused before the plugin), 409, 413, 422 and 429: the host said no.
          throw error;
        }
        throw new CallError('unknown', notSure);
      }
      try { return decodeRunReply(reply); } catch { throw new CallError('unknown', notSure); }
    },
  });
}

// Before anything is sent, a failure to read the context means nothing changed.
async function openForWrite(context: CallContext): Promise<Session> {
  try { return await open(context); } catch (error) {
    if (error instanceof CallError) throw error;
    throw new CallError('unavailable', 'Could not reach Hermes, so nothing was sent. Try again.');
  }
}

const MAX_CHUNKS = Math.ceil(WORKFLOW_LIMITS.fileBytes / WORKFLOW_LIMITS.chunkBytes) + 1;

export const WORKFLOW_HANDLERS: Pick<CallHandlers, keyof typeof WORKFLOW_CALLS> = Object.freeze({
  'workflows.overview': {
    mutation: false,
    async run(context) { return (await open(context)).read('list', { includeArchived: false }, decodeWorkflowOverview); },
  },
  'workflows.detail': {
    mutation: false,
    // The published revision is what runs; the draft is shown only until one exists.
    async run(context, input) {
      const session = await open(context);
      const draft = await session.read('get', { workflowId: input.workflowId, revision: 'draft' }, decodeWorkflowDetail);
      if (draft.latestRevision === null) return draft;
      return session.read('get', { workflowId: input.workflowId, revision: draft.latestRevision }, decodeWorkflowDetail);
    },
  },
  'workflows.runs': {
    mutation: false,
    async run(context, input) {
      return (await open(context)).read('runs/list', { ...input, limit: 20 }, decodeRunPage);
    },
  },
  'workflows.run': {
    mutation: false,
    async run(context, input) { return (await open(context)).read('runs/get', { runId: input.runId }, decodeRunDetail); },
  },
  'workflows.output': {
    mutation: false,
    // Reads the whole file in bounded chunks and proves it is the file the run
    // names: a sign-off sends this same hash back, so it approves what was shown.
    async run(context, input) {
      const session = await open(context);
      const parts: Uint8Array[] = [];
      let offset = 0, total: number | null = null, done = false;
      for (let index = 0; index < MAX_CHUNKS && !done; index++) {
        const chunk = await session.read('artifacts/read', { runId: input.runId, sha256: input.sha256, offset, length: WORKFLOW_LIMITS.chunkBytes }, decodeArtifactChunk);
        if (chunk.sha256 !== input.sha256 || chunk.offset !== offset) throw new CallError('invalid', UNREADABLE);
        if (total === null) {
          total = chunk.total;
          if (total > WORKFLOW_LIMITS.fileBytes) throw new CallError('invalid', 'This file is too large to show here.');
        } else if (chunk.total !== total) throw new CallError('stale', 'The file changed while it was loading. Try again.');
        const bytes = Buffer.from(chunk.data, 'base64');
        if (bytes.byteLength > WORKFLOW_LIMITS.chunkBytes || offset + bytes.byteLength > total || (bytes.byteLength === 0 && !chunk.done)) {
          throw new CallError('invalid', UNREADABLE);
        }
        parts.push(bytes); offset += bytes.byteLength; done = chunk.done;
      }
      if (!done || offset !== total) throw new CallError('invalid', UNREADABLE);
      const data = Buffer.concat(parts);
      if (createHash('sha256').update(data).digest('hex') !== input.sha256) {
        throw new CallError('stale', "The file on your computer doesn't match this run any more. Refresh and try again.");
      }
      let text: string;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(data); }
      catch { throw new CallError('invalid', "This file isn't text, so it can't be shown here."); }
      return Object.freeze({ sha256: input.sha256, text, bytes: data.byteLength });
    },
  },
  'workflows.start': {
    mutation: true,
    // The exact runs/start body. `sample` is always false (the plugin has no samples yet).
    async run(context, input) {
      const session = await openForWrite(context);
      return session.write('runs/start', { workflowId: input.workflowId, revision: input.revision, inputs: input.inputs,
        clientRunToken: input.clientRunToken, sample: false }, NOT_SURE_STARTED, input.requestId);
    },
  },
  'workflows.control': {
    mutation: true,
    async run(context, input) {
      const session = await openForWrite(context);
      return session.write('runs/control', { runId: input.runId, action: input.action, expectedVersion: input.expectedVersion }, NOT_SURE_CONTROL);
    },
  },
  'workflows.signoff': {
    mutation: true,
    async run(context, input) {
      const session = await openForWrite(context);
      return session.write('runs/signoff', { runId: input.runId, stageKey: input.stageKey, decision: input.decision,
        artifactSha256: input.artifactSha256, notes: input.notes }, NOT_SURE_SIGNOFF);
    },
  },
});
