// The agent's credential vault over the host socket (HERMES_API.md §9).
// Secrets travel only inside the one request that needs them. Calls that carry a
// secret never pass host error text through, so nothing typed can echo back.
import { jsonObject } from '../../../../../packages/contracts/rpc.ts';
import type { JsonObject } from '../../../../../packages/contracts/rpc.ts';
import { decodeVaultItems, decodeVaultSources, encodeVaultLogin } from '../../../../../packages/contracts/vault.ts';
import { GatewayOperationError } from '../../../../../packages/hermes-client/gateway.ts';
import type { CallOptions } from '../../../../../packages/hermes-client/gateway.ts';
import type { VAULT_CALLS } from '../../shared/calls/vault.ts';
import type { CallHandlers } from './index.ts';
import type { CallContext } from './context.ts';
import { CallError } from './context.ts';

export const VAULT_UNSUPPORTED = "Your Hermes doesn't have a vault yet. Update Hermes on your computer to use it.";
const READ: CallOptions = Object.freeze({ mutation: false, timeoutMs: 30000 });
// A password manager's command line can take a while to unlock.
const UNLOCK: CallOptions = Object.freeze({ mutation: true, timeoutMs: 90000 });

// `failure` replaces any host refusal with fixed words; used for secret-bearing calls.
async function vault(context: CallContext, method: string, params: JsonObject, options?: CallOptions, failure?: string): Promise<unknown> {
  try {
    return await context.rpc(method, params, options);
  } catch (error) {
    if (error instanceof GatewayOperationError) {
      if (error.code === -32601) throw new CallError('unsupported', VAULT_UNSUPPORTED);
      if (failure) throw new CallError('invalid', failure);
    }
    throw error;
  }
}
const unsure = (what: string) => new CallError('unknown', `Not sure ${what}. Check the vault before trying again.`);

export const VAULT_HANDLERS: Pick<CallHandlers, keyof typeof VAULT_CALLS> = Object.freeze({
  'vault.read': {
    mutation: false,
    async run(context, input) {
      const profile = context.requireProfile(input.profile);
      const [items, sources] = await Promise.all([
        vault(context, 'vault.list', { profile }, READ), vault(context, 'vault.sources', { profile }, READ)]);
      try {
        return Object.freeze({ items: decodeVaultItems(items), sources: decodeVaultSources(sources) });
      } catch { throw new CallError('invalid', 'Hermes sent an unexpected vault list.'); }
    },
  },
  'vault.add': {
    mutation: true,
    async run(context, input) {
      const params = encodeVaultLogin(context.requireProfile(input.profile), input);
      const reply = await vault(context, 'vault.add', params, undefined, "Hermes couldn't save that login. Check the details and try again.");
      if (!jsonObject(reply) || typeof reply.id !== 'string' || !reply.id) throw unsure('the login was saved');
      return Object.freeze({ saved: true as const });
    },
  },
  'vault.remove': {
    mutation: true,
    async run(context, input) {
      const reply = await vault(context, 'vault.remove', { profile: context.requireProfile(input.profile), id: input.id });
      if (!jsonObject(reply) || typeof reply.removed !== 'boolean') throw unsure('it was removed');
      return Object.freeze({ removed: reply.removed });
    },
  },
  'vault.unlock': {
    mutation: true,
    async run(context, input) {
      const reply = await vault(context, 'vault.unlock', { profile: context.requireProfile(input.profile), name: input.source, password: input.password },
        UNLOCK, "That didn't unlock it. Check the master password and try again.");
      if (!jsonObject(reply) || reply.unlocked !== true) throw unsure('it unlocked');
      return Object.freeze({ unlocked: true as const });
    },
  },
  'vault.lock': {
    mutation: true,
    async run(context, input) {
      const reply = await vault(context, 'vault.lock', { profile: context.requireProfile(input.profile), name: input.source });
      if (!jsonObject(reply) || reply.locked !== true) throw unsure('it locked');
      return Object.freeze({ locked: true as const });
    },
  },
  'vault.useSource': {
    mutation: true,
    async run(context, input) {
      const reply = await vault(context, 'vault.source.set', { profile: context.requireProfile(input.profile), name: input.source, enabled: input.enabled });
      if (!jsonObject(reply) || reply.name !== input.source || reply.enabled !== input.enabled) throw unsure('that changed');
      return Object.freeze({ enabled: input.enabled });
    },
  },
});
