// Settings wire codecs. Decode Hermes replies into frozen, bounded plain data.
// Endpoint addresses, key names, pricing, host paths and secrets are dropped here,
// in main, before anything reaches the renderer.

export type ModelProvider = Readonly<{ id: string; name: string; models: readonly string[] }>;
export type ModelCurrent = Readonly<{ provider: string; model: string }>;
export type ModelChoices = Readonly<{ current: ModelCurrent | null; providers: readonly ModelProvider[] }>;
export type ModelSetReply = Readonly<{ status: 'saved'; provider: string; model: string }>
  | Readonly<{ status: 'confirm'; message: string }>;
export const APPROVAL_MODES = Object.freeze(['manual', 'smart', 'off'] as const);
export type ApprovalMode = typeof APPROVAL_MODES[number];
export type Toolset = Readonly<{
  name: string; label: string; description: string; enabled: boolean; available: boolean; tools: readonly string[];
}>;
export type Skill = Readonly<{ name: string; description: string; category: string }>;

export const SETTINGS_LIMITS = Object.freeze({
  providers: 512, modelsPerProvider: 2000, models: 5000, toolsets: 256, toolsPerSet: 256, skills: 2000,
  confirmCharacters: 4096,
});

const invalid = (): never => { throw new TypeError('Invalid settings response'); };
const HIDDEN = /[\x00-\x1f\x7f-\x9f​-‏‪-‮⁦-⁩﻿]/u;
const HIDDEN_RUN = /[\x00-\x1f\x7f-\x9f​-‏‪-‮⁦-⁩﻿]+/gu;

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
function list(value: unknown, max: number): readonly unknown[] {
  if (!Array.isArray(value) || value.length > max) return invalid();
  return value;
}
// A host name for something (provider slug, model, toolset): exact, one line, or nothing.
function name(value: unknown, max: number): string | null {
  if (typeof value !== 'string' || !value.length || value.length > max || !value.isWellFormed() || HIDDEN.test(value)
    || value.trim() !== value) return null;
  return value;
}
// Display text from the host: one line, hidden characters removed, bounded.
function line(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.isWellFormed()) return '';
  const result = value.replace(HIDDEN_RUN, ' ').replace(/\s+/gu, ' ').trim();
  return result.length > max ? `${result.slice(0, max - 1).trimEnd()}…` : result;
}

// GET /api/model/options (same payload as RPC model.options). Rows are lenient:
// a bad or duplicate row is skipped, not fatal. Signed-out providers and rows
// with no usable model are left out; only names a person can pick remain.
export function decodeModelOptions(value: unknown): ModelChoices {
  const payload = object(value);
  const seen = new Set<string>();
  const providers: ModelProvider[] = [];
  let total = 0;
  for (const entry of list(payload.providers, SETTINGS_LIMITS.providers)) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const row = entry as Record<string, unknown>;
    const id = name(row.slug, 128);
    if (!id || seen.has(id) || row.authenticated === false) continue;
    seen.add(id);
    const unavailable = new Set(Array.isArray(row.unavailable_models) ? row.unavailable_models.filter(item => typeof item === 'string') : []);
    const models = new Set<string>();
    const raw = Array.isArray(row.models) ? row.models.slice(0, SETTINGS_LIMITS.modelsPerProvider) : [];
    for (const item of raw) {
      const model = name(item, 256);
      if (!model || unavailable.has(model) || models.has(model) || total >= SETTINGS_LIMITS.models) continue;
      models.add(model); total += 1;
    }
    if (!models.size) continue;
    providers.push(Object.freeze({ id, name: line(row.name, 120) || id, models: Object.freeze([...models]) }));
  }
  const provider = name(payload.provider, 128), model = name(payload.model, 256);
  return Object.freeze({
    current: provider && model ? Object.freeze({ provider, model }) : null,
    providers: Object.freeze(providers),
  });
}

// POST /api/model/set. Either a saved assignment or the host's expensive-model
// question, which must be confirmed before the same pick is sent again.
export function decodeModelSet(value: unknown): ModelSetReply {
  const reply = object(value);
  if (reply.confirm_required === true) {
    if (reply.ok === true || typeof reply.confirm_message !== 'string') return invalid();
    const message = reply.confirm_message.isWellFormed() ? reply.confirm_message
      .replace(/[\x00-\x09\x0b-\x1f\x7f-\x9f​-‏‪-‮⁦-⁩﻿]+/gu, ' ').replace(/\n{3,}/gu, '\n\n').trim() : '';
    if (!message || message.length > SETTINGS_LIMITS.confirmCharacters) return invalid();
    return Object.freeze({ status: 'confirm', message });
  }
  if (reply.ok !== true || (reply.scope !== undefined && reply.scope !== 'main')) return invalid();
  const provider = name(reply.provider, 128), model = name(reply.model, 256);
  if (!provider || !model) return invalid();
  return Object.freeze({ status: 'saved', provider, model });
}

// GET /api/model/info: what the agent's config says now. Empty when unset.
export function decodeModelInfo(value: unknown): ModelCurrent | null {
  const info = object(value);
  if (info.model === '' || info.model === null || info.model === undefined) return null;
  const provider = name(info.provider, 128), model = name(info.model, 256);
  if (!provider || !model) return invalid();
  return Object.freeze({ provider, model });
}

// config.get {key: "approvals.mode"}. Hermes already normalises the stored value.
export function decodeApprovalMode(value: unknown): ApprovalMode {
  const reply = object(value);
  const mode = reply.value;
  if (typeof mode !== 'string' || !(APPROVAL_MODES as readonly string[]).includes(mode)) return invalid();
  return mode as ApprovalMode;
}

// GET /api/config: only display.message_reactions is read. Hermes treats the
// stored value with Python truthiness and an absent key as off; so do we.
export function decodeReactionsSetting(value: unknown): boolean {
  const config = object(value);
  const display = config.display;
  if (display === undefined || display === null) return false;
  const setting = object(display).message_reactions;
  if (setting === undefined || setting === null || setting === false) return false;
  if (setting === true) return true;
  if (typeof setting === 'number') return setting !== 0;
  if (typeof setting === 'string') return setting.length > 0;
  return invalid();
}

// config.set {key: "display.message_reactions"} echoes the key and the stored boolean.
export function decodeReactionsSet(value: unknown): boolean {
  const reply = object(value);
  if (reply.key !== 'display.message_reactions' || typeof reply.value !== 'boolean') return invalid();
  return reply.value;
}

// GET /api/tools/toolsets?profile=. Read-only display list.
export function decodeToolsets(value: unknown): readonly Toolset[] {
  const seen = new Set<string>();
  const result: Toolset[] = [];
  for (const entry of list(value, SETTINGS_LIMITS.toolsets)) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const row = entry as Record<string, unknown>;
    const id = name(row.name, 128);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const tools = Array.isArray(row.tools) ? row.tools.slice(0, SETTINGS_LIMITS.toolsPerSet)
      .map(tool => name(tool, 128)).filter((tool): tool is string => tool !== null) : [];
    result.push(Object.freeze({ name: id, label: line(row.label, 120) || id, description: line(row.description, 400),
      enabled: row.enabled === true, available: row.available === true, tools: Object.freeze([...new Set(tools)]) }));
  }
  return Object.freeze(result);
}

// GET /api/skills?profile=. Hermes lists enabled skills only.
export function decodeSkills(value: unknown): readonly Skill[] {
  const seen = new Set<string>();
  const result: Skill[] = [];
  for (const entry of list(value, SETTINGS_LIMITS.skills)) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const row = entry as Record<string, unknown>;
    const id = name(row.name, 128);
    if (!id || seen.has(id) || row.enabled === false) continue;
    seen.add(id);
    result.push(Object.freeze({ name: id, description: line(row.description, 400), category: line(row.category, 80) }));
  }
  return Object.freeze(result);
}
