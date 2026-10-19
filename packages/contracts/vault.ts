// Hermes' credential vault (HERMES_API.md §9, tui_gateway methods_vault). The vault
// lives on the Hermes computer, one per agent. Replies are metadata only: labels,
// sites and usernames. Decoders copy known display fields and drop everything else,
// so a password, card number or other secret can never reach the window even if a
// host sent one. New secrets are sent once in a request and never kept.
import { encodeBoundedJson, jsonObject } from './rpc.ts';
import type { JsonObject } from './rpc.ts';

export type VaultKind = 'login' | 'payment' | 'address';
export type VaultItem = Readonly<{
  id: string; kind: VaultKind; label: string;
  // Where it may be used, as an origin like https://example.com.
  site: string | null;
  // The email, phone or username of a login. Hermes treats it as visible metadata.
  username: string | null;
  // 'local' for Hermes' own vault, otherwise the password manager it came from.
  source: string;
  // A stored authenticator key lets Hermes make the site's one-time codes itself.
  makesCodes: boolean;
  addedAt: string | null;
}>;
export type VaultSource = Readonly<{
  name: string; displayName: string; enabled: boolean; needsUnlock: boolean; unlocked: boolean; installed: boolean;
}>;
export type VaultOverview = Readonly<{ items: readonly VaultItem[]; sources: readonly VaultSource[] }>;
export type VaultLogin = Readonly<{ label?: string; site: string; username: string; password: string }>;

export const VAULT_LIMITS = Object.freeze({
  items: 500, sources: 32, replyBytes: 2 * 1024 * 1024,
  id: 256, label: 120, site: 2048, username: 512, password: 4096, sourceName: 64, displayName: 120,
});
export const VAULT_KINDS: readonly VaultKind[] = Object.freeze(['login', 'payment', 'address']);
export const LOCAL_SOURCE = 'local';

const invalid = (): never => { throw new TypeError('Invalid vault reply'); };
const refused = (): never => { throw new TypeError('Invalid vault request'); };
const CONTROL = /[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/u;
const SOURCE_NAME = /^[A-Za-z0-9_.-]{1,64}$/u;

// A display string from the host, or null when absent, too long or not plain text.
function plain(value: unknown, max: number): string | null {
  if (typeof value !== 'string' || !value.isWellFormed() || value.length > max || CONTROL.test(value)) return null;
  const text = value.trim();
  return text ? text : null;
}
function identifier(value: unknown, max: number): string | null {
  const text = plain(value, max);
  return text !== null && text === value && !/\s/u.test(text) ? text : null;
}

export function isSourceName(value: unknown): value is string {
  return typeof value === 'string' && SOURCE_NAME.test(value);
}

function item(value: unknown): VaultItem | null {
  if (!jsonObject(value)) return null;
  const id = identifier(value.id, VAULT_LIMITS.id);
  const kind = VAULT_KINDS.find(known => known === value.kind);
  const typed = plain(value.origin, VAULT_LIMITS.site);
  const site = typed ? vaultSite(typed) : null;
  const label = plain(value.label, 512) ?? (site ? siteName(site) : null);
  const source = isSourceName(value.backend) ? value.backend : null;
  if (id === null || !kind || label === null || source === null) return null;
  const added = plain(value.created_at, 64);
  return Object.freeze({
    id, kind, label, site,
    username: kind === 'login' ? plain(value.identifier, VAULT_LIMITS.username) : null,
    source, makesCodes: value.has_otp === true,
    addedAt: added && Number.isFinite(Date.parse(added)) ? added : null,
  });
}

function source(value: unknown): VaultSource | null {
  if (!jsonObject(value) || !isSourceName(value.name)) return null;
  const flag = (key: string) => value[key] === true;
  return Object.freeze({
    name: value.name, displayName: plain(value.display_name, VAULT_LIMITS.displayName) ?? value.name,
    enabled: flag('enabled'), needsUnlock: flag('needs_unlock'), unlocked: flag('unlocked'), installed: flag('installed'),
  });
}

// vault.list → {items}. Rows that are not well-formed display data are skipped.
export function decodeVaultItems(value: unknown): readonly VaultItem[] {
  encodeBoundedJson(value, VAULT_LIMITS.replyBytes);
  if (!jsonObject(value) || !Array.isArray(value.items)) return invalid();
  const seen = new Set<string>(), result: VaultItem[] = [];
  for (const row of value.items.slice(0, VAULT_LIMITS.items)) {
    const decoded = item(row);
    if (decoded && !seen.has(decoded.id)) { seen.add(decoded.id); result.push(decoded); }
  }
  // Hermes' own vault first, then by name.
  return Object.freeze(result.sort((a, b) => (a.source === LOCAL_SOURCE ? 0 : 1) - (b.source === LOCAL_SOURCE ? 0 : 1)
    || a.label.localeCompare(b.label)));
}

// vault.sources → {sources}: the Hermes vault and any password managers it knows.
export function decodeVaultSources(value: unknown): readonly VaultSource[] {
  encodeBoundedJson(value, VAULT_LIMITS.replyBytes);
  if (!jsonObject(value) || !Array.isArray(value.sources)) return invalid();
  const seen = new Set<string>(), result: VaultSource[] = [];
  for (const row of value.sources.slice(0, VAULT_LIMITS.sources)) {
    const decoded = source(row);
    if (decoded && !seen.has(decoded.name)) { seen.add(decoded.name); result.push(decoded); }
  }
  return Object.freeze(result);
}

// "example.com" or "https://example.com/login" → "https://example.com", or null
// when it is not a web address. Hermes binds a login to exactly this origin.
export function vaultSite(typed: string): string | null {
  const trimmed = typed.trim();
  if (!trimmed || trimmed.length > VAULT_LIMITS.site || /\s/u.test(trimmed) || CONTROL.test(trimmed)) return null;
  let url: URL;
  try { url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`); } catch { return null; }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) return null;
  const host = url.hostname;
  if (!host || (!host.includes('.') && host !== 'localhost') || host.startsWith('.') || host.endsWith('.')) return null;
  return `${url.protocol}//${url.host}`;
}

export function siteName(origin: string): string {
  try { return new URL(origin).host; } catch { return origin; }
}

// Hermes stores the sign-in name as metadata with its type.
export function usernameType(username: string): 'email' | 'phone' | 'username' {
  if (username.includes('@')) return 'email';
  return /^\+?\d+$/u.test(username) ? 'phone' : 'username';
}

// vault.add params for a login. The password appears only inside `secret`.
export function encodeVaultLogin(profile: string, login: VaultLogin): JsonObject {
  const site = vaultSite(login.site);
  const username = login.username.trim();
  const label = (login.label ?? '').trim();
  if (!profile || !site || !username || username.length > VAULT_LIMITS.username || CONTROL.test(username)
    || !login.password || login.password.length > VAULT_LIMITS.password || login.password.includes('\0')
    || label.length > VAULT_LIMITS.label || CONTROL.test(label)) return refused();
  return {
    profile, kind: 'login', label: label || siteName(site), origin: site,
    secret: { identifier_type: usernameType(username), identifier: username, password: login.password },
  };
}
