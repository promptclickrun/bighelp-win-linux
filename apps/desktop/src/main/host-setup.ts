// Main-only "add or change a computer" flow. The renderer names a probe and a
// method; addresses, codes, cookies and tokens stay here. A sign-in can only go
// to the exact origin that was probed without credentials.
import { randomUUID } from 'node:crypto';
import { HostProblemError, discover, fetchIdentity, passwordSignIn, probe, readDashboardToken, signInMethods } from '../../../../packages/hermes-client/host-auth.ts';
import type { HostCandidate, HostCredential, HostDiscovery, ProbeTarget } from '../../../../packages/hermes-client/host-auth.ts';
import type { AuthHttp } from '../../../../packages/platform/auth-http.ts';
import type { DesktopSetup, SignInInput } from '../shared/desktop-api.ts';
import type { HostRecord } from './host-store.ts';
import { hostLabel } from './host-store.ts';

const PROBE_LIFETIME_MS = 10 * 60 * 1000;
export type SignedIn = Readonly<{ record: HostRecord; credential: HostCredential; discovery: HostDiscovery }>;

export function createHostSetup(options: Readonly<{ http: AuthHttp; now(): number }>) {
  let active: { id: string; discovery: HostDiscovery; createdAt: number; replacing: boolean } | null = null;
  let sequence = 0;
  return Object.freeze({
    view(): DesktopSetup | null {
      if (!active || options.now() - active.createdAt > PROBE_LIFETIME_MS) return null;
      const discovery = active.discovery;
      return Object.freeze({ probeId: active.id, thisComputer: discovery.loopback, plainHttp: discovery.plainHttp,
        version: discovery.version, signInRequired: discovery.authRequired, methods: signInMethods(discovery),
        providers: Object.freeze(discovery.providers.filter(provider => provider.password).map(provider => Object.freeze({ id: provider.id, name: provider.name }))),
        replacing: active.replacing });
    },
    clear(): void { active = null; ++sequence; },
    // Credential-free. A newer probe replaces an older one, even mid-flight.
    async probe(target: ProbeTarget | Readonly<{ kind: 'saved'; candidate: HostCandidate }>, replacing: boolean): Promise<void> {
      const mine = ++sequence;
      active = null;
      const discovery = target.kind === 'saved' ? await discover(options.http, target.candidate) : await probe(options.http, target);
      if (mine !== sequence) throw Error('Superseded');
      active = { id: randomUUID(), discovery, createdAt: options.now(), replacing };
    },
    async signIn(input: SignInInput): Promise<SignedIn> {
      const entry = active;
      if (!entry || entry.id !== input.probeId || options.now() - entry.createdAt > PROBE_LIFETIME_MS) throw new HostProblemError('setupExpired');
      const label = hostLabel(input.label);
      // Ask again right before any credential is sent: never send it in another mode.
      const { origin, plainHttp, loopback } = entry.discovery;
      const fresh = await discover(options.http, { origin, plainHttp, loopback });
      if (fresh.authRequired !== entry.discovery.authRequired) throw new HostProblemError('modeChanged');
      if (!signInMethods(fresh).includes(input.method)) throw new HostProblemError(input.method === 'automatic' && !fresh.authRequired ? 'notThisComputer' : 'unsupported');
      let credential: HostCredential;
      if (input.method === 'automatic') {
        credential = { kind: 'dashboard', token: await readDashboardToken(options.http, fresh.origin), automatic: true };
      } else if (input.method === 'password') {
        const providers = fresh.providers.filter(provider => provider.password);
        const provider = input.provider ? providers.find(item => item.id === input.provider)
          : providers.length === 1 ? providers[0] : undefined;
        if (!provider) throw new HostProblemError(input.provider || !providers.length ? 'unsupported' : 'chooseProvider');
        credential = await passwordSignIn(options.http, fresh.origin, { provider: provider.id, username: input.username, password: input.password }, options.now);
      } else if (!fresh.authRequired) {
        credential = { kind: 'dashboard', token: input.token, automatic: false };
        try { await fetchIdentity(options.http, fresh.origin, credential); }
        catch (error) { throw error instanceof HostProblemError && error.problem === 'expired' ? new HostProblemError('invalidToken') : error; }
      } else {
        const pasted: HostCredential = { kind: 'bearer', accessToken: input.token, refreshToken: null, expiresAt: null, provider: null, userId: null };
        let identity;
        try { identity = await fetchIdentity(options.http, fresh.origin, pasted); }
        catch (error) { throw error instanceof HostProblemError && error.problem === 'expired' ? new HostProblemError('invalidToken') : error; }
        if (!identity) throw new HostProblemError('invalidToken');
        credential = { ...pasted, expiresAt: identity.expiresAt, provider: identity.provider, userId: identity.userId };
      }
      if (active === entry) active = null;
      return Object.freeze({ record: Object.freeze({ label, origin: fresh.origin, plainHttp: fresh.plainHttp, method: input.method }),
        credential: Object.freeze(credential), discovery: fresh });
    },
  });
}
