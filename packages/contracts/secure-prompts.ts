// Secure server requests (HERMES_API.md §3; tui_gateway/contracts/server_requests.py):
// a password, one-time code or secret value the agent's computer asks for during a
// chat. The prompt carries display context only. The answer is `{value}` with one
// string ('' declines); it is encoded once, sent, and never stored, logged or shown.
import { RpcProtocolError } from './rpc.ts';
import { contractObject, contractText } from './session.ts';
import { isSourceName } from './vault.ts';

export const SECURE_METHODS = Object.freeze(['secret', 'sudo', 'vault.code', 'vault.save_login', 'vault.unlock_prompt'] as const);
export type SecureMethod = typeof SECURE_METHODS[number];
export type SecurePrompt = Readonly<{
  kind: 'secure'; method: SecureMethod; runtimeId: string;
  // What it is for, as plain display text. Never a value.
  site?: string; hint?: string; manager?: string; envVar?: string; prompt?: string; command?: string;
}>;
export const SECURE_LIMITS = Object.freeze({ value: 10000, code: 64, identifier: 512, password: 4096 });

const fail = (): never => { throw new RpcProtocolError(); };
const CONTROL = /[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/u;
export function isSecureMethod(method: string): method is SecureMethod { return SECURE_METHODS.some(known => known === method); }

// Optional one-line label from the host; null/absent/blank are omitted.
function label(value: unknown, max: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  const text = contractText(value, max, true).trim();
  if (CONTROL.test(text)) return fail();
  return text || undefined;
}
const field = <K extends string>(key: K, value: string | undefined) => (value === undefined ? {} : { [key]: value }) as Partial<Record<K, string>>;

export function parseSecurePrompt(method: SecureMethod, row: Record<string, unknown>, runtimeId: string): SecurePrompt {
  const base = { kind: 'secure' as const, method, runtimeId };
  switch (method) {
    case 'secret': {
      const envVar = label(row.env_var, 4096);
      if (!envVar || /\s/u.test(envVar)) return fail();
      if (row.metadata !== undefined && row.metadata !== null) contractObject(row.metadata);
      return Object.freeze({ ...base, envVar, ...field('prompt', contractText(row.prompt, 65536, true).trim() || undefined) });
    }
    case 'sudo':
      return Object.freeze({ ...base, ...field('command', row.command === undefined || row.command === null ? undefined : contractText(row.command, 65536, true) || undefined) });
    case 'vault.unlock_prompt': {
      if (!isSourceName(row.backend)) return fail();
      return Object.freeze({ ...base, manager: label(row.display_name, 120) ?? row.backend });
    }
    case 'vault.save_login': {
      // The login is saved for exactly this origin; show it, not the agent's label.
      const origin = contractText(row.origin, 2048);
      let url: URL;
      try { url = new URL(origin); } catch { return fail(); }
      if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password || !url.hostname
        || CONTROL.test(origin) || /\s/u.test(origin)) return fail();
      label(row.site, 255);
      return Object.freeze({ ...base, site: `${url.protocol}//${url.host}` });
    }
    case 'vault.code':
      return Object.freeze({ ...base, ...field('site', label(row.site, 255)), ...field('hint', label(row.hint, 500)) });
  }
}

function secretText(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value || value.length > max || !value.isWellFormed() || value.includes('\0')) return fail();
  return value;
}

// '' declines. Anything else is checked against what the prompt asked for.
export function encodeSecureAnswer(prompt: SecurePrompt, value: unknown): Readonly<{ value: string }> {
  if (value === '') return Object.freeze({ value: '' });
  if (prompt.method === 'vault.code') {
    const code = typeof value === 'string' ? value.replace(/[\s-]+/gu, '') : '';
    if (!code || code.length > SECURE_LIMITS.code || !/^[A-Za-z0-9]+$/u.test(code)) return fail();
    return Object.freeze({ value: code });
  }
  if (prompt.method === 'vault.save_login') {
    const login = contractObject(value);
    if (Object.keys(login).sort().join(',') !== 'identifier,password') return fail();
    const identifier = secretText(login.identifier, SECURE_LIMITS.identifier).trim();
    if (!identifier || CONTROL.test(identifier)) return fail();
    // Hermes parses the answer as JSON {identifier, password}.
    return Object.freeze({ value: JSON.stringify({ identifier, password: secretText(login.password, SECURE_LIMITS.password) }) });
  }
  return Object.freeze({ value: secretText(value, SECURE_LIMITS.value) });
}

// Notification words. Never the value, and nothing the person has not seen on screen.
export function secureAlertText(prompt: SecurePrompt): string {
  switch (prompt.method) {
    case 'vault.code': return `${prompt.site ?? 'A site'} is asking for a one-time code.`;
    case 'vault.save_login': return 'It needs a login to continue.';
    case 'vault.unlock_prompt': return `It wants to use logins in ${prompt.manager ?? 'your password manager'}.`;
    case 'sudo': return 'It needs your computer password for a command.';
    case 'secret': return 'It needs a secret value to continue.';
  }
}
