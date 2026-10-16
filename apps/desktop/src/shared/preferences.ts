// Local display and behavior choices for this computer. Not secrets, not host
// settings; stored in the protected repository when it is available.
import { boolean, fields, oneOf, text } from './validate.ts';

export const APPEARANCE_CHOICES = Object.freeze(['automatic', 'light', 'dark'] as const);
export const TEXT_SIZES = Object.freeze(['small', 'default', 'large', 'larger'] as const);
export const BUSY_MODES = Object.freeze(['steer', 'queue', 'interrupt'] as const);

export type Preferences = Readonly<{
  appearance: typeof APPEARANCE_CHOICES[number];
  textSize: typeof TEXT_SIZES[number];
  nerdMode: boolean;
  // Chat
  showReasoning: boolean;
  foldFinishedTurns: boolean;
  busyMode: typeof BUSY_MODES[number];
  enterToSend: boolean;
  // Notifications while bighelp runs
  notifyAttention: boolean;
  notifyReplies: boolean;
  notificationPreview: boolean;
  // Window lifecycle (opt-in, docs/DECISIONS.md D3)
  keepRunningInTray: boolean;
  openAtLogin: boolean;
  // You
  personName: string;
}>;

export const DEFAULT_PREFERENCES: Preferences = Object.freeze({
  appearance: 'automatic', textSize: 'default', nerdMode: false,
  showReasoning: false, foldFinishedTurns: true, busyMode: 'steer', enterToSend: true,
  notifyAttention: true, notifyReplies: false, notificationPreview: false,
  keepRunningInTray: false, openAtLogin: false, personName: '',
});

const KEYS = Object.keys(DEFAULT_PREFERENCES) as (keyof Preferences)[];

function value<K extends keyof Preferences>(key: K, input: unknown): Preferences[K] {
  switch (key) {
    case 'appearance': return oneOf(input, APPEARANCE_CHOICES) as Preferences[K];
    case 'textSize': return oneOf(input, TEXT_SIZES) as Preferences[K];
    case 'busyMode': return oneOf(input, BUSY_MODES) as Preferences[K];
    case 'personName': return (input === '' ? '' : text(input, { max: 80 }).trim()) as Preferences[K];
    default: return boolean(input) as Preferences[K];
  }
}

// A partial update from the renderer. Unknown keys are refused, not ignored.
export function parsePreferenceChanges(input: unknown): Partial<Preferences> {
  const changes = fields(input, [], KEYS);
  if (!Object.keys(changes).length) throw new TypeError('No changes');
  const result: Record<string, unknown> = {};
  for (const key of KEYS) if (Object.hasOwn(changes, key)) result[key] = value(key, changes[key]);
  return Object.freeze(result) as Partial<Preferences>;
}

// Stored records may be older or partially invalid: keep what validates.
export function restorePreferences(input: unknown): Preferences {
  const result: Record<string, unknown> = { ...DEFAULT_PREFERENCES };
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    for (const key of KEYS) {
      const stored = (input as Record<string, unknown>)[key];
      if (stored === undefined) continue;
      try { result[key] = value(key, stored); } catch { /* keep default */ }
    }
  }
  return Object.freeze(result) as Preferences;
}
