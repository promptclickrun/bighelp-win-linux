// Agents are Hermes profiles. Bounded decoders and naming rules shared by main
// and the renderer. Shown names come from ui_meta["hermes-bots"].title, then
// display_name, then the profile ID. Host paths and unknown fields are dropped.
import { boundedString, encodeBoundedJson, jsonObject, RpcProtocolError, RPC_LIMITS } from './rpc.ts';
import type { JsonObject } from './rpc.ts';

const fail = (): never => { throw new RpcProtocolError(); };

export const AGENT_LIMITS = Object.freeze({
  rows: 256, titleCharacters: 200, roleCharacters: 4096, summaryCharacters: 4096, instructionsCharacters: 256000,
  instructionsBytes: 512 * 1024, namespaceBytes: 65536, providers: 256, models: 1000, confirmBytes: 4096,
});
// Hermes refuses these as new profile names (hermes_cli/profiles.py _RESERVED_NAMES).
export const RESERVED_AGENT_IDS: readonly string[] = Object.freeze(['hermes', 'default', 'test', 'tmp', 'root', 'sudo']);
const AGENT_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/u;
// A few calm colors people can pick. Stored as hermes-bots.color, shared with Hermes Desktop.
export const AGENT_COLORS: readonly string[] = Object.freeze(['#D27B5B', '#2BA59A', '#4A7BEA', '#E39A2D', '#9B6BD6', '#D2557A']);
export const DEFAULT_AGENT_COLOR = '#D27B5B';
const COLOR = /^(?:#[0-9a-f]{3}|#[0-9a-f]{6}|hsl\(\s*\d{1,3}(?:\.\d+)?(?:deg)?\s*,?\s*\d{1,3}(?:\.\d+)?%\s*,?\s*\d{1,3}(?:\.\d+)?%\s*\))$/iu;

export type AgentIdProblem = 'format' | 'reserved' | 'taken';
// Hermes' rule for a new profile name: lowercase, 1-64 characters, not reserved.
export function agentIdProblem(id: string, taken: readonly string[]): AgentIdProblem | null {
  if (!AGENT_ID.test(id)) return 'format';
  if (RESERVED_AGENT_IDS.includes(id)) return 'reserved';
  if (taken.some(existing => existing.toLowerCase() === id)) return 'taken';
  return null;
}

// The profile ID is derived from the name a person types, never sent as typed.
// Matches the Mac app: fold case and accents, join words with "-", 48 characters.
export function deriveAgentId(title: string, taken: readonly string[]): string {
  const words = title.normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean).join('-');
  const base = words.replace(/[^a-z0-9-]+/gu, '').replace(/-{2,}/gu, '-').replace(/^-+/u, '').slice(0, 48).replace(/-+$/u, '') || 'agent';
  let candidate = base;
  for (let suffix = 2; agentIdProblem(candidate, taken) !== null; suffix++) candidate = `${base}-${suffix}`;
  return candidate;
}

export function agentColor(value: unknown): string | null {
  return typeof value === 'string' && value.length <= 32 && COLOR.test(value) ? value : null;
}

// One display line: control and bidi characters become spaces, then bounded.
export function displayLine(value: unknown, maxCharacters: number): string {
  if (typeof value !== 'string' || !value.isWellFormed()) return '';
  const text = value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]+/gu, ' ').replace(/\s+/gu, ' ').trim();
  const characters = [...text];
  return characters.length > maxCharacters ? `${characters.slice(0, maxCharacters - 1).join('')}…` : text;
}

function textOrEmpty(value: unknown, maxCharacters: number): string {
  return typeof value === 'string' && value.length <= maxCharacters && value.isWellFormed() && !value.includes('\0') ? value : '';
}

function profileId(value: unknown): string {
  const id = boundedString(value, 512);
  if (!id || id.trim() !== id || /[\u0000-\u001f\u007f-\u009f]/u.test(id)) return fail();
  return id;
}

// A profiles.list row as main needs it. `namespace` is the whole hermes-bots
// object so a write can send it back with unknown keys intact; it never leaves main.
export type ProfileRow = Readonly<{
  id: string; isDefault: boolean; title: string; displayName: string; role: string; summary: string;
  color: string | null; provider: string; model: string;
  // hermes-bots revision for compare-and-set. null: this host or row cannot take metadata writes.
  revision: number | null;
  namespace: JsonObject | null;
}>;

function namespaceOf(row: JsonObject): Readonly<{ namespace: JsonObject | null; usable: boolean }> {
  const meta = row.ui_meta;
  if (meta === undefined || meta === null) return { namespace: null, usable: true };
  if (!jsonObject(meta)) return { namespace: null, usable: false };
  const bots = meta['hermes-bots'];
  if (bots === undefined || bots === null) return { namespace: null, usable: true };
  if (!jsonObject(bots)) return { namespace: null, usable: false };
  try { encodeBoundedJson(bots, AGENT_LIMITS.namespaceBytes); } catch { return { namespace: null, usable: false }; }
  return { namespace: bots, usable: true };
}

function revisionOf(row: JsonObject): number | null {
  const revisions = row.ui_meta_revisions;
  // Absent: older Hermes or a multiplexed sibling row. Metadata writes are refused.
  if (revisions === undefined || revisions === null || !jsonObject(revisions)) return null;
  const value = revisions['hermes-bots'];
  if (value === undefined) return 0;
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function decodeProfileRoster(value: unknown): readonly ProfileRow[] {
  encodeBoundedJson(value, RPC_LIMITS.inboundBytes);
  if (!jsonObject(value) || !Array.isArray(value.profiles) || value.profiles.length > AGENT_LIMITS.rows) return fail();
  const rows = value.profiles.map((entry: unknown): ProfileRow => {
    if (!jsonObject(entry)) return fail();
    const { namespace, usable } = namespaceOf(entry);
    const revision = usable ? revisionOf(entry) : null;
    return Object.freeze({
      id: profileId(entry.name), isDefault: entry.is_default === true,
      title: textOrEmpty(namespace?.title, 4096), displayName: textOrEmpty(entry.display_name, 4096),
      role: textOrEmpty(entry.description, AGENT_LIMITS.roleCharacters), summary: textOrEmpty(namespace?.description, AGENT_LIMITS.summaryCharacters),
      color: agentColor(namespace?.color), provider: textOrEmpty(entry.provider, 256), model: textOrEmpty(entry.model, 256),
      revision, namespace,
    });
  });
  if (new Set(rows.map(row => row.id)).size !== rows.length) return fail();
  return Object.freeze(rows);
}

export type CatalogAgent = Readonly<{ id: string; name: string; summary: string; color: string; isDefault: boolean; model: string }>;
export function shownAgentName(row: ProfileRow): string {
  return displayLine(row.title, 100) || displayLine(row.displayName, 100) || row.id;
}
// The safe list entry: one-line name and summary, a validated color, no paths.
export function catalogAgent(row: ProfileRow): CatalogAgent {
  return Object.freeze({ id: row.id, name: shownAgentName(row), summary: displayLine(row.summary.trim() ? row.summary : row.role, 300),
    color: row.color ?? DEFAULT_AGENT_COLOR, isDefault: row.isDefault || row.id === 'default', model: displayLine(row.model, 120) });
}

export type ModelProvider = Readonly<{ id: string; name: string; models: readonly string[] }>;
export type ModelOptions = Readonly<{ providers: readonly ModelProvider[]; current: Readonly<{ provider: string; model: string }> | null }>;

function modelName(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 && value.trim() === value && value.isWellFormed()
    && !/[\u0000-\u001f\u007f-\u009f]/u.test(value) ? value : null;
}
// model.options rows are open: skip anything malformed instead of failing the list.
export function decodeModelOptions(value: unknown): ModelOptions {
  encodeBoundedJson(value, RPC_LIMITS.inboundBytes);
  if (!jsonObject(value) || !Array.isArray(value.providers) || value.providers.length > AGENT_LIMITS.providers) return fail();
  const providers: ModelProvider[] = [];
  for (const entry of value.providers as unknown[]) {
    if (!jsonObject(entry) || entry.authenticated === false) continue;
    const id = modelName(entry.slug);
    if (!id || id.length > 128 || providers.some(provider => provider.id === id) || !Array.isArray(entry.models)) continue;
    const unavailable = new Set(Array.isArray(entry.unavailable_models) ? entry.unavailable_models.filter(item => typeof item === 'string') : []);
    const models = [...new Set(entry.models.map(modelName).filter((item): item is string => item !== null && !unavailable.has(item)))]
      .slice(0, AGENT_LIMITS.models);
    if (models.length) providers.push(Object.freeze({ id, name: displayLine(entry.name, 80) || id, models: Object.freeze(models) }));
  }
  const provider = modelName(value.provider), model = modelName(value.model);
  return Object.freeze({ providers: Object.freeze(providers), current: provider && model ? Object.freeze({ provider, model }) : null });
}

// profiles.create receipt. Anything but an exact "created, nothing mirrored"
// is not success: the profile may exist, and credentials may have been copied.
export function createReceiptOutcome(value: unknown, id: string): 'created' | 'mirrored' | 'unknown' {
  if (!jsonObject(value) || value.ok !== true || value.name !== id || !jsonObject(value.mirrored)) return 'unknown';
  const mirrored = value.mirrored;
  return ['env', 'auth', 'model_inherited', 'voice'].every(key => mirrored[key] === false) ? 'created' : 'mirrored';
}

export type ConfigureResult = Readonly<{
  applied: Readonly<{ uiMeta: boolean | null; description: boolean | null; model: boolean | null }>;
  conflict: boolean; confirmMessage: string | null;
}>;
function appliedFlag(applied: JsonObject, key: string): boolean | null {
  const value = applied[key];
  if (value === undefined) return null;
  return typeof value === 'boolean' ? value : fail();
}
export function decodeConfigureResult(value: unknown): ConfigureResult {
  encodeBoundedJson(value, 262144);
  if (!jsonObject(value) || !jsonObject(value.applied)) return fail();
  const applied = value.applied;
  let confirmMessage: string | null = null;
  if (value.confirm_required === true) {
    const message = boundedString(value.confirm_message, AGENT_LIMITS.confirmBytes)
      .replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]+/gu, ' ').replace(/ {2,}/gu, ' ').trim();
    if (!message) return fail();
    confirmMessage = message;
  }
  return Object.freeze({
    applied: Object.freeze({ uiMeta: appliedFlag(applied, 'ui_meta'), description: appliedFlag(applied, 'description'), model: appliedFlag(applied, 'model') }),
    conflict: applied.ui_meta_conflicts !== undefined, confirmMessage,
  });
}

// GET /api/profiles/{p}/soul: {content, exists}; an absent file has empty content.
export function decodeSoul(value: unknown): Readonly<{ content: string; exists: boolean }> {
  if (!jsonObject(value) || typeof value.exists !== 'boolean') return fail();
  const content = boundedString(value.content, AGENT_LIMITS.instructionsBytes);
  if (!value.exists && content !== '') return fail();
  return Object.freeze({ content, exists: value.exists });
}

// GET /api/profiles (REST) row for the delete review. Strict for the target only.
export type DeleteFacts = Readonly<{ isDefault: boolean; skills: number; hasSavedKeys: boolean; gatewayRunning: boolean; fingerprint: string }>;
export function decodeDeleteRoster(value: unknown, id: string): Readonly<{ names: readonly string[]; target: DeleteFacts | null }> {
  encodeBoundedJson(value, 262144);
  if (!jsonObject(value) || !Array.isArray(value.profiles) || value.profiles.length > AGENT_LIMITS.rows) return fail();
  let target: DeleteFacts | null = null;
  const names = (value.profiles as unknown[]).map(entry => {
    if (!jsonObject(entry)) return fail();
    const name = profileId(entry.name);
    if (name !== id) return name;
    const flags = ['is_default', 'has_env', 'has_alias', 'gateway_running', 'description_auto'];
    if (flags.some(key => typeof entry[key] !== 'boolean') || typeof entry.skill_count !== 'number'
      || !Number.isSafeInteger(entry.skill_count) || entry.skill_count < 0) return fail();
    // The host path is left out: even a hash of a guessable path should not leave main.
    const fingerprint = encodeBoundedJson([name, entry.description ?? null, ...flags.map(key => entry[key]),
      entry.skill_count, entry.model ?? null, entry.provider ?? null], 65536);
    target = Object.freeze({ isDefault: entry.is_default === true, skills: entry.skill_count, hasSavedKeys: entry.has_env === true,
      gatewayRunning: entry.gateway_running === true, fingerprint });
    return name;
  });
  if (new Set(names).size !== names.length) return fail();
  return Object.freeze({ names: Object.freeze(names), target });
}

export function decodeActiveProfile(value: unknown): Readonly<{ active: string; current: string }> {
  if (!jsonObject(value)) return fail();
  return Object.freeze({ active: profileId(value.active), current: profileId(value.current) });
}
