// Agent management: create, edit, duplicate and delete Hermes profiles.
// Inputs are plain words a person typed plus exact profile IDs; main checks them again.
import { defineCall } from '../call.ts';
import { InvalidInput, boolean, compact, fields, identifier, integer, oneOf, optional, segment, text } from '../validate.ts';
import { AGENT_COLORS, AGENT_LIMITS, agentIdProblem } from '../../../../../packages/contracts/agents.ts';
import type { ModelOptions } from '../../../../../packages/contracts/agents.ts';

export type AgentDetails = Readonly<{
  profile: string; name: string; role: string; summary: string; color: string | null; isDefault: boolean;
  instructions: string; provider: string; model: string;
  // Compare-and-set tokens: the hermes-bots revision (null: names can't be saved
  // on this host) and digests of the role and instructions as they were read.
  revision: number | null; roleVersion: string; instructionsVersion: string;
}>;
export type AgentModelChoice = Readonly<{ provider: string; model: string }>;
// partial: a plain sentence when the agent exists but some details did not save.
// modelConfirm: the host's warning when the chosen model needs approval first.
export type AgentSaved = Readonly<{ profile: string; partial: string | null; modelConfirm: string | null }>;
export type AgentModelSaved = Readonly<{ status: 'saved' }> | Readonly<{ status: 'confirm'; message: string }>;
export type AgentDeleteReview = Readonly<{
  profile: string; canDelete: boolean; reason: string | null; skills: number; hasSavedKeys: boolean; token: string;
}>;

const invalid = (): never => { throw new InvalidInput(); };

// An existing profile as the host listed it.
export function profileInput(value: unknown): string { return segment(value, 64); }
// A new profile name by Hermes' rule: lowercase, 1-64 characters, not reserved.
export function newAgentId(value: unknown): string {
  const id = segment(value, 64);
  return agentIdProblem(id, []) === null ? id : invalid();
}
function title(value: unknown): string {
  const result = text(value, { max: AGENT_LIMITS.titleCharacters });
  return result.trim() ? result : invalid();
}
const role = (value: unknown) => text(value, { max: AGENT_LIMITS.roleCharacters, min: 0 });
const summary = (value: unknown) => text(value, { max: AGENT_LIMITS.summaryCharacters, min: 0 });
const instructions = (value: unknown) => text(value, { max: AGENT_LIMITS.instructionsCharacters, min: 0, multiline: true });
const color = (value: unknown) => oneOf(value, AGENT_COLORS);
function version(value: unknown): string {
  const result = text(value, { max: 64 });
  return /^[0-9a-f]{64}$/u.test(result) ? result : invalid();
}
function modelChoice(value: unknown): AgentModelChoice {
  const input = fields(value, ['provider', 'model']);
  return Object.freeze({ provider: identifier(input.provider, 128), model: identifier(input.model, 256) });
}
function revision(value: unknown): number | null { return value === null ? null : integer(value, 0, Number.MAX_SAFE_INTEGER); }

export const AGENT_CALLS = Object.freeze({
  'agents.details': defineCall<AgentDetails>()(input => Object.freeze({ profile: profileInput(fields(input, ['profile']).profile) })),
  // Without a profile, the models of the computer's main agent (for a new agent).
  'agents.models': defineCall<ModelOptions>()(input => compact({ profile: optional(fields(input, [], ['profile']).profile, profileInput) })),
  'agents.create': defineCall<AgentSaved>()(input => {
    const value = fields(input, ['id', 'title'], ['role', 'summary', 'instructions', 'color', 'model', 'copyFrom', 'copyConsent']);
    const copyFrom = optional(value.copyFrom, profileInput);
    // Copying another agent also copies its saved keys (.env): only with consent.
    if ((copyFrom === undefined) !== (value.copyConsent === undefined) || (value.copyConsent !== undefined && value.copyConsent !== true)) invalid();
    return compact({ id: newAgentId(value.id), title: title(value.title), role: optional(value.role, role), summary: optional(value.summary, summary),
      instructions: optional(value.instructions, instructions), color: optional(value.color, color), model: optional(value.model, modelChoice),
      copyFrom, copyConsent: copyFrom === undefined ? undefined : true as const });
  }),
  'agents.update': defineCall<AgentSaved>()(input => {
    const value = fields(input, ['profile'], ['revision', 'title', 'summary', 'color', 'role', 'roleVersion', 'instructions', 'instructionsVersion', 'model']);
    const parsed = compact({ profile: profileInput(value.profile), revision: optional(value.revision, revision),
      title: optional(value.title, title), summary: optional(value.summary, summary), color: optional(value.color, color),
      role: optional(value.role, role), roleVersion: optional(value.roleVersion, version),
      instructions: optional(value.instructions, instructions), instructionsVersion: optional(value.instructionsVersion, version),
      model: optional(value.model, modelChoice) });
    const meta = parsed.title !== undefined || parsed.summary !== undefined || parsed.color !== undefined;
    if (meta !== (parsed.revision !== undefined) || (parsed.role === undefined) !== (parsed.roleVersion === undefined)
      || (parsed.instructions === undefined) !== (parsed.instructionsVersion === undefined)
      || (!meta && parsed.role === undefined && parsed.instructions === undefined && parsed.model === undefined)) invalid();
    return parsed;
  }),
  'agents.setModel': defineCall<AgentModelSaved>()(input => {
    const value = fields(input, ['profile', 'provider', 'model', 'confirm']);
    return Object.freeze({ profile: profileInput(value.profile), ...modelChoice({ provider: value.provider, model: value.model }), confirm: boolean(value.confirm) });
  }),
  'agents.deleteReview': defineCall<AgentDeleteReview>()(input => Object.freeze({ profile: profileInput(fields(input, ['profile']).profile) })),
  'agents.delete': defineCall<Readonly<{ deleted: true }>>()(input => {
    const value = fields(input, ['profile', 'token']);
    return Object.freeze({ profile: profileInput(value.profile), token: version(value.token) });
  }),
});
