// Agent management against Hermes profiles (docs: /tmp spec agents-settings §2-3).
// JSON-RPC profiles.* for the roster, create and configure; REST for SOUL and delete.
// Never sends mirror_credentials:true; copying another agent needs explicit consent.
import { createHash } from 'node:crypto';
import {
  AGENT_LIMITS, createReceiptOutcome, decodeActiveProfile, decodeConfigureResult, decodeDeleteRoster, decodeModelOptions,
  decodeProfileRoster, decodeSoul, shownAgentName,
} from '../../../../../packages/contracts/agents.ts';
import type { ModelOptions, ProfileRow } from '../../../../../packages/contracts/agents.ts';
import { encodeBoundedJson, jsonObject, RpcProtocolError } from '../../../../../packages/contracts/rpc.ts';
import type { JsonObject, JsonValue } from '../../../../../packages/contracts/rpc.ts';
import { GatewayOperationError } from '../../../../../packages/hermes-client/gateway.ts';
import { HttpStatusError } from '../../../../../packages/platform/transport-policy.ts';
import type { AGENT_CALLS, AgentDeleteReview, AgentDetails, AgentModelChoice, AgentModelSaved, AgentSaved } from '../../shared/calls/agents.ts';
import type { CallContext } from './context.ts';
import { CallError } from './context.ts';
import type { CallHandlers } from './index.ts';

const CHANGED = 'This agent changed on your computer. Reload and try again.';
const GONE = 'That agent is no longer on your computer.';
const UNEXPECTED = 'Hermes sent a reply bighelp does not understand.';
const NOT_DELETED = "Hermes didn't confirm the deletion. Refresh the list before trying again.";
const CREATE_UNKNOWN = 'Hermes may have created this agent. Check the agents list before trying again.';
const CREATED_PARTLY = 'The agent was created, but some details may not have saved. Open it to check them.';
const SAVED_PARTLY = 'Some changes were saved, but not all. The form now shows what your computer has, so you can make the rest again.';

const digest = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
// Host replies that do not decode: a read is unavailable, never a guess.
async function decoded<T>(read: () => Promise<T>): Promise<T> {
  try { return await read(); } catch (error) {
    if (error instanceof RpcProtocolError) throw new CallError('invalid', UNEXPECTED);
    throw error;
  }
}
async function refresh(context: CallContext): Promise<void> { await context.refreshCatalog().catch(() => {}); }

async function roster(context: CallContext): Promise<readonly ProfileRow[]> {
  return decoded(async () => decodeProfileRoster(await context.rpc('profiles.list', { include_sessions: false }, { mutation: false })));
}
async function rowFor(context: CallContext, profile: string): Promise<ProfileRow> {
  const row = (await roster(context)).find(entry => entry.id === profile);
  if (!row) throw new CallError('stale', GONE);
  return row;
}

const soulPath = (profile: string) => `/api/profiles/${encodeURIComponent(profile)}/soul`;
async function readSoul(context: CallContext, profile: string): Promise<Readonly<{ content: string; exists: boolean }>> {
  try {
    return await decoded(async () => decodeSoul((await context.http({ method: 'GET', path: soulPath(profile), maxBytes: 2 * AGENT_LIMITS.instructionsBytes })).body));
  } catch (error) {
    if (error instanceof HttpStatusError && error.status === 404 && /does not exist/iu.test(error.detail)) throw new CallError('stale', GONE);
    throw error;
  }
}
// PUT is atomic on the host; a matching read-back is the only proof it landed.
async function writeSoul(context: CallContext, profile: string, content: string): Promise<boolean> {
  const body = encodeBoundedJson({ content }, 1024 * 1024);
  const reply = (await context.http({ method: 'PUT', path: soulPath(profile), body, maxBytes: 4096 })).body;
  if (!jsonObject(reply) || reply.ok !== true) return false;
  const back = await readSoul(context, profile);
  return back.exists && back.content === content;
}

type MetaChanges = Readonly<{ title?: string; summary?: string; color?: string; role?: string }>;
// Name, summary and color live in ui_meta["hermes-bots"]; the whole object is sent
// back so keys other apps own survive. The revision makes the write compare-and-set.
async function writeMeta(context: CallContext, row: ProfileRow, changes: MetaChanges): Promise<boolean> {
  const params: Record<string, JsonValue> = { name: row.id };
  const meta = changes.title !== undefined || changes.summary !== undefined || changes.color !== undefined;
  if (meta) {
    if (row.revision === null) throw new CallError('unsupported', "This version of Hermes can't save agent names. Update Hermes on your computer.");
    const next: Record<string, JsonValue> = { ...(row.namespace ?? {}) };
    if (changes.title !== undefined) next.title = changes.title.trim();
    if (changes.summary !== undefined) {
      // Blank means "follow what it's for", as on the Mac.
      if (changes.summary.trim()) next.description = changes.summary.trim(); else delete next.description;
    }
    if (changes.color !== undefined) next.color = changes.color;
    params.ui_meta = { 'hermes-bots': next };
    params.ui_meta_expected_revisions = { 'hermes-bots': row.revision };
  }
  if (changes.role !== undefined) params.description = changes.role.trim();
  const result = await decoded(async () => decodeConfigureResult(await context.rpc('profiles.configure', params)));
  if (result.conflict) throw new CallError('conflict', CHANGED);
  return (!meta || result.applied.uiMeta === true) && (changes.role === undefined || result.applied.description === true);
}

// profiles.configure runs Hermes' expensive-model check unless confirmed. A
// guarded pick writes nothing and returns the host's warning for the person.
async function applyModel(context: CallContext, profile: string, choice: AgentModelChoice, confirm: boolean): Promise<AgentModelSaved> {
  const options = await decoded(async () => decodeModelOptions(await context.rpc('model.options', { profile }, { mutation: false })));
  if (!options.providers.some(provider => provider.id === choice.provider && provider.models.includes(choice.model))) {
    throw new CallError('invalid', "That model isn't offered on your computer anymore. Pick another.");
  }
  const params: JsonObject = { name: profile, provider: choice.provider, model: choice.model, ...(confirm ? { confirm_expensive_model: true } : {}) };
  let result: ReturnType<typeof decodeConfigureResult>;
  try { result = decodeConfigureResult(await context.rpc('profiles.configure', params)); }
  catch (error) { if (error instanceof RpcProtocolError) throw new CallError('unknown', 'Not sure the model changed. Check this agent before trying again.'); throw error; }
  if (result.confirmMessage !== null) return Object.freeze({ status: 'confirm', message: result.confirmMessage });
  if (result.applied.model !== true) throw new CallError('invalid', "Hermes didn't accept that model. Pick another.");
  const described = await context.rpc('profiles.describe', { name: profile }, { mutation: false }).catch(() => null);
  const model = jsonObject(described) && jsonObject(described.model) ? described.model.default : undefined;
  if (model !== choice.model) throw new CallError('unknown', 'Not sure the model changed. Check this agent before trying again.');
  return Object.freeze({ status: 'saved' });
}

type Review = Readonly<{ reason: string | null; skills: number; hasSavedKeys: boolean; token: string }>;
async function reviewDelete(context: CallContext, profile: string): Promise<Review> {
  return decoded(async () => {
    const listing = decodeDeleteRoster((await context.http({ method: 'GET', path: '/api/profiles', maxBytes: 262144 })).body, profile);
    const active = decodeActiveProfile((await context.http({ method: 'GET', path: '/api/profiles/active', maxBytes: 4096 })).body);
    const target = listing.target;
    if (!target) throw new CallError('stale', GONE);
    const reason = profile === 'default' || target.isDefault ? "This is your computer's main agent, so it can't be deleted."
      : active.current === profile ? "Hermes is running as this agent on this connection, so it can't be deleted from here."
      : active.active === profile ? "This agent is set as Hermes' default on your computer. Choose another default in Hermes first."
      : null;
    return Object.freeze({ reason, skills: target.skills, hasSavedKeys: target.hasSavedKeys,
      token: digest(JSON.stringify([target.fingerprint, active.active, active.current])) });
  });
}
// true / false when the host answered; null when it could not be checked.
async function stillListed(context: CallContext, profile: string): Promise<boolean | null> {
  try {
    const body = (await context.http({ method: 'GET', path: '/api/profiles', maxBytes: 262144 })).body;
    return decodeDeleteRoster(body, '').names.includes(profile);
  } catch { return null; }
}

export const AGENT_HANDLERS: Pick<CallHandlers, keyof typeof AGENT_CALLS> = Object.freeze({
  'agents.details': {
    mutation: false,
    async run(context, input): Promise<AgentDetails> {
      const profile = context.requireProfile(input.profile);
      const row = await rowFor(context, profile);
      const soul = await readSoul(context, profile);
      const described = await context.rpc('profiles.describe', { name: profile }, { mutation: false });
      const model = jsonObject(described) && described.name === profile && jsonObject(described.model) ? described.model : null;
      const text = (value: unknown) => typeof value === 'string' && value.length <= 256 ? value : '';
      return Object.freeze({
        profile, name: row.title.trim() ? row.title.trim() : shownAgentName(row), role: row.role, summary: row.summary, color: row.color,
        isDefault: row.isDefault || profile === 'default', instructions: soul.content,
        provider: text(model?.provider), model: text(model?.default),
        revision: row.revision, roleVersion: digest(row.role), instructionsVersion: digest(soul.content),
      });
    },
  },
  'agents.models': {
    mutation: false,
    async run(context, input): Promise<ModelOptions> {
      const params: JsonObject = input.profile === undefined ? {} : { profile: context.requireProfile(input.profile) };
      return decoded(async () => decodeModelOptions(await context.rpc('model.options', params, { mutation: false })));
    },
  },
  'agents.create': {
    mutation: true,
    async run(context, input): Promise<AgentSaved> {
      const existing = await roster(context);
      if (existing.some(row => row.id === input.id)) throw new CallError('conflict', 'Another agent already uses that name. Pick another.');
      const source = input.copyFrom === undefined ? null : existing.find(row => row.id === input.copyFrom) ?? null;
      if (input.copyFrom !== undefined && (!source || input.copyConsent !== true)) throw new CallError('stale', 'The agent to copy is no longer on your computer.');
      const role = input.role ?? source?.role ?? '';
      // mirror_credentials defaults to true on the host: always send false. A copy
      // (clone_from) copies the source's .env; the parser required consent for that.
      const params: JsonObject = { name: input.id, description: role.trim(), no_alias: true, mirror_credentials: false, no_skills: false,
        ...(source ? { clone_from: source.id, clone_all: false } : {}) };
      let receipt: unknown;
      try { receipt = await context.rpc('profiles.create', params, { timeoutMs: 120000 }); }
      catch (error) {
        if (error instanceof GatewayOperationError && error.code === 4062) {
          throw /already exists/iu.test(error.detail) ? new CallError('conflict', 'Another agent already uses that name. Pick another.')
            : new CallError('invalid', "Hermes couldn't create this agent. Check the name and try again.");
        }
        if (!(error instanceof GatewayOperationError)) { await refresh(context); throw new CallError('unknown', CREATE_UNKNOWN); }
        throw error;
      }
      const outcome = createReceiptOutcome(receipt, input.id);
      if (outcome !== 'created') {
        await refresh(context);
        throw new CallError('unknown', outcome === 'mirrored'
          ? "The agent was created, but Hermes may have copied saved keys into it. Check it on your computer before using it." : CREATE_UNKNOWN);
      }
      // The agent exists now. Every later step reports a partial result, never failure.
      let complete = true, modelConfirm: string | null = null;
      try {
        const row = (await roster(context)).find(entry => entry.id === input.id);
        const summary = input.summary ?? source?.summary;
        const color = input.color ?? source?.color ?? undefined;
        complete = !!row && row.revision !== null && await writeMeta(context, row, { title: input.title, ...(summary ? { summary } : {}), ...(color ? { color } : {}) });
      } catch { complete = false; }
      if (input.instructions?.trim()) {
        try { if (!await writeSoul(context, input.id, input.instructions)) complete = false; } catch { complete = false; }
      }
      await refresh(context);
      if (input.model) {
        try {
          const result = await applyModel(context, input.id, input.model, false);
          if (result.status === 'confirm') modelConfirm = result.message;
        } catch { complete = false; }
      }
      return Object.freeze({ profile: input.id, partial: complete ? null : CREATED_PARTLY, modelConfirm });
    },
  },
  'agents.update': {
    mutation: true,
    async run(context, input): Promise<AgentSaved> {
      const profile = context.requireProfile(input.profile);
      const row = await rowFor(context, profile);
      // Check every base before writing anything: one stale field stops the save.
      const meta = input.title !== undefined || input.summary !== undefined || input.color !== undefined;
      if (meta && row.revision !== null && input.revision !== row.revision) throw new CallError('conflict', CHANGED);
      if (input.roleVersion !== undefined && digest(row.role) !== input.roleVersion) throw new CallError('conflict', CHANGED);
      if (input.instructionsVersion !== undefined && digest((await readSoul(context, profile)).content) !== input.instructionsVersion) {
        throw new CallError('conflict', CHANGED);
      }
      let wrote = false, complete = true, modelConfirm: string | null = null;
      const step = async (write: () => Promise<boolean>) => {
        try { const ok = await write(); wrote = true; if (!ok) complete = false; }
        catch (error) { if (!wrote) throw error; complete = false; }
      };
      try {
        if (meta || input.role !== undefined) {
          await step(() => writeMeta(context, row, { ...(input.title === undefined ? {} : { title: input.title }),
            ...(input.summary === undefined ? {} : { summary: input.summary }), ...(input.color === undefined ? {} : { color: input.color }),
            ...(input.role === undefined ? {} : { role: input.role }) }));
        }
        if (input.instructions !== undefined) { const content = input.instructions; await step(() => writeSoul(context, profile, content)); }
        if (input.model) {
          const choice = input.model;
          await step(async () => { const result = await applyModel(context, profile, choice, false); if (result.status === 'confirm') modelConfirm = result.message; return true; });
        }
      } finally { if (wrote) await refresh(context); }
      if (!complete && !wrote) throw new CallError('invalid', "Hermes didn't save these changes. Try again.");
      return Object.freeze({ profile, partial: complete ? null : SAVED_PARTLY, modelConfirm });
    },
  },
  'agents.setModel': {
    mutation: true,
    async run(context, input): Promise<AgentModelSaved> {
      const profile = context.requireProfile(input.profile);
      const result = await applyModel(context, profile, { provider: input.provider, model: input.model }, input.confirm);
      if (result.status === 'saved') await refresh(context);
      return result;
    },
  },
  'agents.deleteReview': {
    mutation: false,
    async run(context, input): Promise<AgentDeleteReview> {
      const profile = context.requireProfile(input.profile);
      const review = await reviewDelete(context, profile);
      return Object.freeze({ profile, canDelete: review.reason === null, ...review });
    },
  },
  'agents.delete': {
    mutation: true,
    async run(context, input): Promise<Readonly<{ deleted: true }>> {
      const profile = context.requireProfile(input.profile);
      const review = await reviewDelete(context, profile);
      if (review.reason !== null) throw new CallError('denied', review.reason);
      if (review.token !== input.token) throw new CallError('conflict', 'This agent changed while you were reviewing it. Check it again before deleting.');
      // The host has no confirmation flag: the dialog the person answered is the confirmation.
      try {
        await context.http({ method: 'DELETE', path: `/api/profiles/${encodeURIComponent(profile)}`, maxBytes: 16384 });
      } catch (error) {
        if (error instanceof HttpStatusError && error.status === 400) throw new CallError('denied', "Hermes won't delete this agent.");
        if (error instanceof HttpStatusError && (error.status === 401 || error.status === 403)) throw error;
      }
      // A lost or odd reply is checked against the host before answering.
      if (await stillListed(context, profile) !== false) {
        await refresh(context);
        throw new CallError('unknown', NOT_DELETED);
      }
      await refresh(context);
      return Object.freeze({ deleted: true });
    },
  },
});
