// Settings pages that read or change something on the connected computer.
// Everything else in Settings is a local preference (shared/preferences.ts).
import type { ApprovalMode, ModelChoices, ModelCurrent, Skill, Toolset } from '../../../../../packages/contracts/settings.ts';
import { defineCall } from '../call.ts';
import { boolean, fields, identifier, segment } from '../validate.ts';

export type ModelSetResult = Readonly<{ status: 'saved'; current: ModelCurrent }>
  | Readonly<{ status: 'confirm'; message: string }>;

const profileOnly = (input: unknown) => {
  const value = fields(input, ['profile']);
  return Object.freeze({ profile: segment(value.profile, 128) });
};

export const SETTINGS_CALLS = Object.freeze({
  // The models an agent's new chats can start with, and the current one.
  'settings.models': defineCall<ModelChoices>()(profileOnly),
  // Sets the agent's default model. The host may first ask to confirm an
  // expensive model; the same pick is then sent again with confirmExpensive.
  'settings.setModel': defineCall<ModelSetResult>()(input => {
    const value = fields(input, ['profile', 'provider', 'model', 'confirmExpensive']);
    return Object.freeze({ profile: segment(value.profile, 128), provider: identifier(value.provider, 128),
      model: identifier(value.model, 256), confirmExpensive: boolean(value.confirmExpensive) });
  }),
  // display.message_reactions on the computer's main Hermes profile.
  'settings.reactions': defineCall<Readonly<{ on: boolean }>>()(input => { fields(input, []); return Object.freeze({}); }),
  'settings.setReactions': defineCall<Readonly<{ on: boolean }>>()(input => {
    const value = fields(input, ['on']);
    return Object.freeze({ on: boolean(value.on) });
  }),
  // Read-only: whether the agent asks before risky commands on its computer.
  'settings.approvals': defineCall<Readonly<{ mode: ApprovalMode }>>()(profileOnly),
  // Read-only Nerd Mode lists.
  'settings.toolsets': defineCall<Readonly<{ toolsets: readonly Toolset[] }>>()(profileOnly),
  'settings.skills': defineCall<Readonly<{ skills: readonly Skill[] }>>()(profileOnly),
});
