import {
  decodeApprovalMode, decodeModelInfo, decodeModelOptions, decodeModelSet, decodeReactionsSet, decodeReactionsSetting,
  decodeSkills, decodeToolsets,
} from '../../../../../packages/contracts/settings.ts';
import type { ModelChoices } from '../../../../../packages/contracts/settings.ts';
import type { SETTINGS_CALLS } from '../../shared/calls/settings.ts';
import type { CallContext } from './context.ts';
import { CallError, callFailure } from './context.ts';
import type { CallHandlers } from './index.ts';

// Decoders throw TypeError for a malformed reply; report it in plain words.
function decode<T>(read: () => T): T {
  try { return read(); } catch { throw new CallError('invalid', 'Hermes sent an unexpected reply.'); }
}
// After a write was sent, an unreadable reply means the outcome is not known.
function decodeWrite<T>(read: () => T): T {
  try { return read(); } catch { throw new CallError('unknown', 'Hermes sent an unexpected reply. Check the setting before trying again.'); }
}

// Hermes may fetch provider catalogs on a cache miss, so this read can be large.
async function modelChoices(context: CallContext, profile: string): Promise<ModelChoices> {
  const reply = await context.http({ method: 'GET', path: '/api/model/options', maxBytes: 4 * 1024 * 1024 - 256,
    query: { profile, refresh: 'false', include_unconfigured: 'false', explicit_only: 'false' } });
  return decode(() => decodeModelOptions(reply.body));
}

export const SETTINGS_HANDLERS: Pick<CallHandlers, keyof typeof SETTINGS_CALLS> = Object.freeze({
  'settings.models': {
    mutation: false,
    async run(context, input) { return modelChoices(context, context.requireProfile(input.profile)); },
  },
  'settings.setModel': {
    mutation: true,
    async run(context, input) {
      const profile = context.requireProfile(input.profile);
      // Only a model this computer offers right now, read fresh in main.
      let choices: ModelChoices;
      // Nothing has been written yet, so a failure here is an ordinary read failure.
      try { choices = await modelChoices(context, profile); } catch (error) {
        const failure = callFailure(error, false);
        throw new CallError(failure.code, failure.message);
      }
      const provider = choices.providers.find(row => row.id === input.provider);
      if (!provider || !provider.models.includes(input.model)) {
        throw new CallError('stale', 'That model is no longer offered on your computer. Pick one again.');
      }
      // Same request as Hermes' own model picker. Keys and endpoints are never sent from here.
      const body = JSON.stringify({ scope: 'main', provider: input.provider, model: input.model, task: '', base_url: '',
        api_key: '', confirm_expensive_model: input.confirmExpensive });
      const saved = await context.http({ method: 'POST', path: '/api/model/set', query: { profile }, body, maxBytes: 65536 });
      const reply = decodeWrite(() => decodeModelSet(saved.body));
      if (reply.status === 'confirm') {
        if (input.confirmExpensive) throw new CallError('invalid', 'Hermes asked to confirm this model again. Nothing was changed.');
        return Object.freeze({ status: 'confirm', message: reply.message });
      }
      // Read back what the agent's config now says before reporting success.
      const info = await context.http({ method: 'GET', path: '/api/model/info', query: { profile }, maxBytes: 65536 });
      const current = decodeWrite(() => decodeModelInfo(info.body));
      if (!current || current.model !== reply.model || current.provider.toLowerCase() !== reply.provider.toLowerCase()) {
        throw new CallError('conflict', 'Hermes now reports a different model. Check the model before trying again.');
      }
      return Object.freeze({ status: 'saved', current });
    },
  },
  'settings.reactions': {
    mutation: false,
    async run(context) {
      // The config document can hold secrets; only one boolean leaves main.
      const reply = await context.http({ method: 'GET', path: '/api/config', maxBytes: 2 * 1024 * 1024 });
      return Object.freeze({ on: decode(() => decodeReactionsSetting(reply.body)) });
    },
  },
  'settings.setReactions': {
    mutation: true,
    async run(context, input) {
      const reply = await context.rpc('config.set', { key: 'display.message_reactions', value: input.on ? 'true' : 'false' });
      const on = decodeWrite(() => decodeReactionsSet(reply));
      if (on !== input.on) throw new CallError('conflict', 'Hermes kept a different value. Check it before trying again.');
      return Object.freeze({ on });
    },
  },
  'settings.approvals': {
    mutation: false,
    async run(context, input) {
      const profile = context.requireProfile(input.profile);
      const reply = await context.rpc('config.get', { key: 'approvals.mode', profile }, { mutation: false });
      return Object.freeze({ mode: decode(() => decodeApprovalMode(reply)) });
    },
  },
  'settings.toolsets': {
    mutation: false,
    async run(context, input) {
      const profile = context.requireProfile(input.profile);
      const reply = await context.http({ method: 'GET', path: '/api/tools/toolsets', query: { profile }, maxBytes: 1024 * 1024 });
      return Object.freeze({ toolsets: decode(() => decodeToolsets(reply.body)) });
    },
  },
  'settings.skills': {
    mutation: false,
    async run(context, input) {
      const profile = context.requireProfile(input.profile);
      const reply = await context.http({ method: 'GET', path: '/api/skills', query: { profile }, maxBytes: 2 * 1024 * 1024 });
      return Object.freeze({ skills: decode(() => decodeSkills(reply.body)) });
    },
  },
});
