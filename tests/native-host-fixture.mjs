// Synthetic bighelp plugin host for main-process call tests. Requests go through
// the real transport policy, so tests see exact URLs, headers and bodies. Replies
// are shaped like plugin 3.13.0 (native_api.py, workspace_artifacts.py).
import { createTransportPolicy } from '../packages/platform/transport-policy.ts';
import { CallError, callFailure } from '../apps/desktop/src/main/calls/context.ts';
import { HANDLERS } from '../apps/desktop/src/main/calls/index.ts';
import { CALLS } from '../apps/desktop/src/shared/calls/index.ts';

export const etag = `"sha256:${'c'.repeat(64)}"`;
export const ALL_FEATURES = ['native-context-v1', 'serving-profile-v1', 'native-agent-board-v1', 'native-agent-board-feedback-v1',
  'native-agent-board-goal-categories-v1', 'native-agent-board-answers-v1', 'native-workspace-files-v1', 'native-workspace-recent-v1',
  'native-workspace-hermes-home-v1', 'native-agent-attachments-v1', 'native-agent-media-v1'];

// routes(path, body, plan) returns {status?, body, headers?} or throws to lose the reply.
export function nativeHost(routes, options = {}) {
  const state = { plans: [], features: options.features ?? ALL_FEATURES, contextTag: options.contextTag ?? etag, servingProfileId: 'default' };
  const policy = createTransportPolicy({ endpoint: 'https://hermes.example', authentication: { kind: 'dashboard', token: 'synthetic-token' } }, {
    isCurrent: () => true, now: () => 0, socket: async () => { throw new Error('No socket in this test'); },
    http: async plan => {
      state.plans.push(plan);
      const path = new URL(plan.url).pathname;
      if (path === '/api/plugins/loopdy/native/context') {
        return { status: 200, url: plan.url, redirected: false, headers: { etag: state.contextTag, 'cache-control': 'no-store' },
          body: { schemaVersion: 1, pluginVersion: '3.13.0', runtimeId: 'runtime-one', servingProfileId: state.servingProfileId,
            principal: null, features: state.features } };
      }
      const reply = await routes(path, plan.body === undefined ? undefined : JSON.parse(plan.body), plan);
      const status = reply.status ?? 200;
      return { status, url: plan.url, redirected: false, body: reply.body,
        headers: reply.headers ?? { etag, 'x-loopdy-request-id': plan.headers['X-Loopdy-Request-ID'] } };
    },
  });
  const signal = new AbortController().signal;
  const context = Object.freeze({
    identity: Object.freeze({ kind: 'dashboard' }),
    requireProfile(profile) {
      if (!(options.profiles ?? ['agent', 'default', 'Upper']).includes(profile)) throw new CallError('stale', 'That agent is no longer on your computer.');
      return profile;
    },
    nativeContext: () => policy.request({ kind: 'nativeContext' }, signal),
    http: route => policy.request({ kind: 'route', ...route }, signal),
    rpc: async () => { throw new Error('No RPC in this test'); },
    openChat: () => null, isCurrent: () => true, refreshCatalog: async () => {},
    requestId: () => crypto.randomUUID(),
    ...(options.saveCopy ? { saveCopy: options.saveCopy } : {}),
  });
  const posts = () => state.plans.filter(plan => plan.method === 'POST');
  return { state, context, posts };
}

// The renderer's input is parsed again exactly as main does for IPC.
export async function run(context, name, input) {
  const parsed = CALLS[name].parse(input);
  try { return { ok: true, value: await HANDLERS[name].run(context, parsed) }; }
  catch (error) { return callFailure(error, HANDLERS[name].mutation); }
}
export const echo = plan => ({ etag, 'x-loopdy-request-id': plan.headers['X-Loopdy-Request-ID'] });
