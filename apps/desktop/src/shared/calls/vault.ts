// The agent's credential vault on the Hermes computer (HERMES_API.md §9).
// Reads return labels only. A password or master password typed here is part of
// exactly one call input; main sends it once and keeps no copy.
import { defineCall } from '../call.ts';
import { InvalidInput, boolean, fields, identifier, optional, text } from '../validate.ts';
import { LOCAL_SOURCE, VAULT_LIMITS, isSourceName, vaultSite } from '../../../../../packages/contracts/vault.ts';
import type { VaultOverview } from '../../../../../packages/contracts/vault.ts';

const profile = (input: Record<string, unknown>) => identifier(input.profile, 256);
// A password manager by name. Hermes' own vault is always on and never locked.
const source = (value: unknown): string => {
  if (!isSourceName(value) || value === LOCAL_SOURCE) throw new InvalidInput();
  return value;
};
// Typed secrets: any characters a person can type on one line, bounded.
const secret = (value: unknown): string => text(value, { max: VAULT_LIMITS.password });

export const VAULT_CALLS = Object.freeze({
  'vault.read': defineCall<VaultOverview>()(input => {
    const value = fields(input, ['profile']);
    return Object.freeze({ profile: profile(value) });
  }),
  'vault.add': defineCall<Readonly<{ saved: true }>>()(input => {
    const value = fields(input, ['profile', 'site', 'username', 'password'], ['label']);
    const site = vaultSite(text(value.site, { max: VAULT_LIMITS.site }));
    const username = text(value.username, { max: VAULT_LIMITS.username }).trim();
    const label = optional(value.label, entry => text(entry, { max: VAULT_LIMITS.label, min: 0 }).trim());
    if (!site || !username) throw new InvalidInput();
    return Object.freeze({ profile: profile(value), site, username, password: secret(value.password), ...(label ? { label } : {}) });
  }),
  'vault.remove': defineCall<Readonly<{ removed: boolean }>>()(input => {
    const value = fields(input, ['profile', 'id']);
    return Object.freeze({ profile: profile(value), id: identifier(value.id, VAULT_LIMITS.id) });
  }),
  'vault.unlock': defineCall<Readonly<{ unlocked: true }>>()(input => {
    const value = fields(input, ['profile', 'source', 'password']);
    return Object.freeze({ profile: profile(value), source: source(value.source), password: secret(value.password) });
  }),
  'vault.lock': defineCall<Readonly<{ locked: true }>>()(input => {
    const value = fields(input, ['profile', 'source']);
    return Object.freeze({ profile: profile(value), source: source(value.source) });
  }),
  'vault.useSource': defineCall<Readonly<{ enabled: boolean }>>()(input => {
    const value = fields(input, ['profile', 'source', 'enabled']);
    return Object.freeze({ profile: profile(value), source: source(value.source), enabled: boolean(value.enabled) });
  }),
});
