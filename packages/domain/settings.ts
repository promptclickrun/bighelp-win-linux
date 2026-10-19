// Settings logic shared by the Settings pages and their tests. Pure: no I/O,
// no timers, no host authority. Invalid transitions return the same state.

// ---- You -------------------------------------------------------------------

export const PERSON_NAME_LIMIT = 40;
const HIDDEN = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/u;

// The name to store ('' removes it), or null when it cannot be saved as typed.
export function cleanPersonName(value: unknown): string | null {
  if (typeof value !== 'string' || !value.isWellFormed() || HIDDEN.test(value)) return null;
  const name = value.trim().replace(/\s+/gu, ' ');
  return [...name].length > PERSON_NAME_LIMIT ? null : name;
}

// A preference change for the typed name, or null when there is nothing valid to save.
export function personNameChange(saved: string, typed: unknown): Readonly<{ personName: string }> | null {
  const name = cleanPersonName(typed);
  return name === null || name === saved ? null : Object.freeze({ personName: name });
}

// ---- Assistants: choosing a default model ---------------------------------

export type ModelPick = Readonly<{ provider: string; model: string }>;
// Same shape as the settings.setModel call result, without importing the desktop layer.
export type ModelSetOutcome = Readonly<{ ok: true; value: Readonly<{ status: 'saved' } | { status: 'confirm'; message: string }> }>
  | Readonly<{ ok: false; code: string; message: string }>;
export type ModelFlow =
  | Readonly<{ phase: 'idle' }>
  | Readonly<{ phase: 'saving'; pick: ModelPick; confirmed: boolean }>
  | Readonly<{ phase: 'confirm'; pick: ModelPick; message: string; expiresAt: number }>
  | Readonly<{ phase: 'saved'; pick: ModelPick }>
  | Readonly<{ phase: 'failed'; pick: ModelPick; message: string; unknown: boolean }>;
export type ModelFlowAction =
  | Readonly<{ type: 'pick'; pick: ModelPick }>
  | Readonly<{ type: 'reply'; result: ModelSetOutcome; now: number }>
  | Readonly<{ type: 'confirm'; now: number }>
  | Readonly<{ type: 'cancel' }>
  | Readonly<{ type: 'reset' }>;

// The host's expensive-model question is answered within this window or asked again.
export const CONFIRM_WINDOW_MS = 5 * 60 * 1000;
export const MODEL_FLOW_IDLE: ModelFlow = Object.freeze({ phase: 'idle' });

// Picking sends the choice; the host may ask to confirm an expensive model.
// Confirming sends the same pick once more with the confirmation. Nothing is
// ever resent on its own, and a lost reply stays "not sure", never "saved".
export function reduceModelFlow(state: ModelFlow, action: ModelFlowAction): ModelFlow {
  switch (action.type) {
    case 'pick':
      if (state.phase === 'saving' || state.phase === 'confirm') return state;
      return Object.freeze({ phase: 'saving', pick: action.pick, confirmed: false });
    case 'reply': {
      if (state.phase !== 'saving') return state;
      const { result } = action;
      if (!result.ok) {
        return Object.freeze({ phase: 'failed', pick: state.pick, message: result.message, unknown: result.code === 'unknown' });
      }
      if (result.value.status === 'saved') return Object.freeze({ phase: 'saved', pick: state.pick });
      if (state.confirmed) {
        return Object.freeze({ phase: 'failed', pick: state.pick, unknown: false,
          message: 'Hermes asked to confirm this model again. Nothing was changed.' });
      }
      return Object.freeze({ phase: 'confirm', pick: state.pick, message: result.value.message,
        expiresAt: action.now + CONFIRM_WINDOW_MS });
    }
    case 'confirm':
      if (state.phase !== 'confirm') return state;
      if (action.now > state.expiresAt) {
        return Object.freeze({ phase: 'failed', pick: state.pick, unknown: false,
          message: 'That question expired. Pick the model again.' });
      }
      return Object.freeze({ phase: 'saving', pick: state.pick, confirmed: true });
    case 'cancel':
      return state.phase === 'confirm' ? MODEL_FLOW_IDLE : state;
    case 'reset':
      return state.phase === 'saving' ? state : MODEL_FLOW_IDLE;
    default:
      return state;
  }
}

// Select values for a provider/model pair. JSON keeps any characters apart.
export function modelKey(pick: ModelPick): string { return JSON.stringify([pick.provider, pick.model]); }
export function parseModelKey(key: string): ModelPick | null {
  try {
    const value: unknown = JSON.parse(key);
    if (!Array.isArray(value) || value.length !== 2 || typeof value[0] !== 'string' || typeof value[1] !== 'string') return null;
    return Object.freeze({ provider: value[0], model: value[1] });
  } catch { return null; }
}

// One flat, labelled list for a native select. The current model stays listed
// even when the host no longer offers it, so the field never shows a wrong value.
export function modelOptions(choices: Readonly<{
  current: ModelPick | null; providers: readonly Readonly<{ id: string; name: string; models: readonly string[] }>[];
}>): readonly Readonly<{ value: string; label: string }>[] {
  const many = choices.providers.length > 1;
  const options = choices.providers.flatMap(provider => provider.models.map(model => Object.freeze({
    value: modelKey({ provider: provider.id, model }), label: many ? `${model} · ${provider.name}` : model,
  })));
  const current = choices.current;
  if (current && !options.some(option => option.value === modelKey(current))) {
    options.unshift(Object.freeze({ value: modelKey(current), label: `${current.model} (current)` }));
  }
  return Object.freeze(options);
}

// ---- Permissions ------------------------------------------------------------

export function approvalSummary(mode: 'manual' | 'smart' | 'off'): Readonly<{ title: string; detail: string; asks: boolean }> {
  switch (mode) {
    case 'manual': return Object.freeze({ title: 'Always asks first', asks: true,
      detail: 'Agents ask you before they run a risky command.' });
    case 'smart': return Object.freeze({ title: 'Asks about risky commands', asks: true,
      detail: 'Agents ask you before a risky command. A helper model may approve low-risk ones by itself.' });
    case 'off': return Object.freeze({ title: "Doesn't ask", asks: false,
      detail: 'Agents run commands without asking you first.' });
  }
}

// ---- Help & feedback --------------------------------------------------------

export type BugReportInput = Readonly<{
  appVersion: string; system: string; connection: 'connected' | 'connecting' | 'disconnected';
  hermesVersion: string | null; hermesReleaseDate: string | null;
  plugin: Readonly<{ installed: boolean; version: string | null }> | null;
}>;

// Only short printable version facts. No host names, addresses, tokens or chat text.
function fact(value: string | null, fallback: string): string {
  if (value === null) return fallback;
  const clean = value.replace(/[^\x20-\x7e]+/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, 80);
  return clean || fallback;
}

export function bugReport(input: BugReportInput): string {
  const connection = { connected: 'Connected', connecting: 'Connecting', disconnected: 'Not connected' }[input.connection];
  const connected = input.connection === 'connected';
  const hermes = !connected ? 'Not connected' : input.hermesVersion === null ? 'Unknown'
    : `${fact(input.hermesVersion, 'Unknown')}${input.hermesReleaseDate ? ` (released ${fact(input.hermesReleaseDate, '')})` : ''}`;
  const plugin = !connected || input.plugin === null ? (connected ? 'Unknown' : 'Not connected')
    : input.plugin.installed ? fact(input.plugin.version, 'Installed') : 'Not installed';
  return [
    `bighelp for Windows and Linux: ${fact(input.appVersion, 'Unknown')}`,
    `System: ${fact(input.system, 'Unknown')}`,
    `Connection: ${connection}`,
    `Hermes: ${hermes}`,
    `bighelp plugin: ${plugin}`,
  ].join('\n');
}
