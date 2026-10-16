// Main-process owner of one saved computer's sign-in. Tokens never leave this
// module except as request headers built by the transport policy.
// Rules (docs/contracts/STATE_AND_SECURITY.md §§3,5; HERMES_API.md §2):
// - Renewal is single flight. A rotating refresh token is retired in storage
//   BEFORE it is sent, so a crash or lost reply can never replay it later.
// - A lost refresh reply may be resent with the same token only within 25 s
//   (Hermes coalesces identical refreshes for 30 s). After that: sign in again.
// - A renewed or re-read token is persisted before it is used.
// - The account must stay the same; a different one is refused.
import { HostProblemError, fetchIdentity, readDashboardToken, requestRefresh } from './host-auth.ts';
import type { BearerCredential, HostCredential, HostIdentity, HostProblem } from './host-auth.ts';
import type { AuthHttp } from '../platform/auth-http.ts';
import type { CredentialSource } from '../platform/transport-policy.ts';

export const RENEW_BEFORE_MS = 30_000;
export const REFRESH_RESEND_WINDOW_MS = 25_000;
export type PersistCredential = (previous: HostCredential, next: HostCredential) => Promise<void>;
export type CredentialSession = ReturnType<typeof createCredentialSession>;

const same = (a: HostCredential, b: HostCredential) => JSON.stringify(a) === JSON.stringify(b);
const fail = (problem: HostProblem): never => { throw new HostProblemError(problem); };

export function createCredentialSession(options: Readonly<{
  origin: string; initial: HostCredential;
  // Null: no sign-in requests are possible here (tests, or a pasted token).
  http: AuthHttp | null;
  // Wall-clock milliseconds; Hermes expiry times are epoch seconds.
  now(): number;
}>) {
  let credential: HostCredential = options.initial;
  // Until attached, changes stay in memory: the sign-in is not saved yet.
  let persist: PersistCredential | null = null;
  let refreshing: Promise<void> | null = null, scraping: Promise<void> | null = null;
  let uncertain = false, unanswered: { previous: BearerCredential; sentAt: number } | null = null;
  let problem: HostProblem | null = null;
  const token = () => credential.kind === 'bearer' ? credential.accessToken : credential.token;

  async function store(previous: HostCredential, next: HostCredential): Promise<void> {
    if (persist && !same(previous, next)) await persist(previous, next);
    credential = next;
  }
  async function performRefresh(): Promise<void> {
    const http = options.http;
    if (!http) return fail('expired');
    const current = credential;
    let old: BearerCredential, refreshToken: string, sentAt: number;
    if (!uncertain && current.kind === 'bearer' && current.refreshToken) {
      old = current; refreshToken = current.refreshToken; sentAt = options.now();
    } else if (unanswered?.previous.refreshToken && options.now() - unanswered.sentAt < REFRESH_RESEND_WINDOW_MS) {
      // Still inside Hermes' window: the same token gets the same answer.
      old = unanswered.previous; refreshToken = unanswered.previous.refreshToken; sentAt = unanswered.sentAt;
    } else { unanswered = null; problem = 'expired'; return fail('expired'); }
    const consumed: BearerCredential = Object.freeze({ ...old, refreshToken: null });
    // Retire the rotating token durably first. If that fails nothing was sent.
    await store(current, consumed);
    uncertain = true; unanswered = { previous: old, sentAt };
    const outcome = await requestRefresh(http, options.origin, refreshToken, old.provider ?? '', options.now);
    if (outcome.kind === 'expired') { unanswered = null; problem = 'expired'; return fail('expired'); }
    if (outcome.kind === 'unchanged') {
      // Hermes renewed nothing (provider down, or the request never left): keep the old token.
      await store(credential, old); uncertain = false; unanswered = null;
      return fail('serverUnavailable');
    }
    if (outcome.kind === 'uncertain') return fail('unreachable');
    const next = outcome.credential;
    if (old.provider !== null && (next.provider !== old.provider || next.userId !== old.userId)) {
      unanswered = null; problem = 'identityChanged'; return fail('identityChanged');
    }
    await store(credential, next);
    uncertain = false; unanswered = null; problem = null;
  }
  function refresh(): Promise<void> {
    refreshing ??= performRefresh().finally(() => { refreshing = null; });
    return refreshing;
  }
  // "This computer": Hermes makes a new token each time it starts. Re-read it.
  function rescrape(): Promise<void> {
    scraping ??= (async () => {
      const previous = credential, http = options.http;
      if (previous.kind !== 'dashboard' || !previous.automatic || !http) return;
      const fresh = await readDashboardToken(http, options.origin);
      if (fresh !== previous.token) await store(previous, Object.freeze({ kind: 'dashboard', token: fresh, automatic: true }));
    })().finally(() => { scraping = null; });
    return scraping;
  }
  const canRefresh = () => credential.kind === 'bearer' && (!!credential.refreshToken || uncertain);
  async function current(): Promise<string> {
    if (problem) return fail(problem);
    if (refreshing) await refreshing;
    if (credential.kind === 'bearer' && credential.expiresAt !== null && credential.expiresAt * 1000 <= options.now() + RENEW_BEFORE_MS) {
      if (canRefresh()) await refresh();
      else if (credential.expiresAt * 1000 <= options.now()) { problem = 'expired'; return fail('expired'); }
    }
    return token();
  }
  // Hermes turned `rejected` away. Returns the token to resend with, or null.
  async function renew(rejected: string): Promise<string | null> {
    if (token() !== rejected) return token();
    if (credential.kind === 'bearer') {
      if (!canRefresh()) { problem = 'expired'; return null; }
      try { await refresh(); } catch { return null; }
    } else {
      if (!credential.automatic || !options.http) { problem = 'expired'; return null; }
      try { await rescrape(); } catch { return null; }
    }
    return token() === rejected ? null : token();
  }
  return Object.freeze({
    get credential(): HostCredential { return credential; },
    // Why this sign-in cannot be used any more, or null.
    get problem(): HostProblem | null { return problem; },
    token, current, renew, rescrape,
    attach(next: PersistCredential): void { persist = next; },
    // Check a verified identity: a pasted token learns its account once;
    // after that the account must stay exactly the same.
    async adopt(identity: HostIdentity): Promise<void> {
      const previous = credential;
      if (previous.kind !== 'bearer') return;
      if (previous.provider !== null || previous.userId !== null) {
        if (previous.provider !== identity.provider || previous.userId !== identity.userId) { problem = 'identityChanged'; fail('identityChanged'); }
        return;
      }
      await store(previous, Object.freeze({ ...previous, provider: identity.provider, userId: identity.userId,
        expiresAt: previous.expiresAt ?? identity.expiresAt }));
    },
    // GET /api/auth/me before any socket opens; one renewal when turned away.
    async verify(): Promise<HostIdentity | null> {
      const http = options.http;
      if (!http) return null;
      const used = await current();
      try { return await fetchIdentity(http, options.origin, credential); } catch (error) {
        if (!(error instanceof HostProblemError) || error.problem !== 'expired') throw error;
        if (await renew(used) === null) { problem ??= 'expired'; return fail(problem); }
        return fetchIdentity(http, options.origin, credential);
      }
    },
    // Bound to one host lease: a retired lease neither receives nor renews tokens.
    source(isCurrent: () => boolean): CredentialSource {
      return Object.freeze({
        current: async () => { const value = await current(); if (!isCurrent()) throw Error('Host changed'); return value; },
        renew: async (rejected: string) => isCurrent() ? renew(rejected) : null,
      });
    },
  });
}
