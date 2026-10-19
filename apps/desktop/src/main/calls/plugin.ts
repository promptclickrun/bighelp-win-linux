// The bighelp host plugin's verified context: features, version and the ETag
// every native write must echo. Read fresh for each call; never cached across hosts.
import { decodeWorkspaceContext } from '../../../../../packages/contracts/workspace.ts';
import { HttpStatusError } from '../../../../../packages/platform/transport-policy.ts';
import type { CallContext } from './context.ts';
import { CallError } from './context.ts';

export type PluginContext = Readonly<{ etag: string; version: string; features: readonly string[]; servingProfileId: string | null }>;

export async function readPluginContext(context: CallContext): Promise<PluginContext | null> {
  let response;
  try {
    response = await context.nativeContext();
  } catch (error) {
    if (error instanceof HttpStatusError && [404, 405, 501].includes(error.status)) return null;
    throw error;
  }
  try {
    const decoded = decodeWorkspaceContext(response.body, context.identity, response.etag, response.cacheControl);
    return Object.freeze({ etag: decoded.etag, version: decoded.pluginVersion, features: decoded.features,
      servingProfileId: decoded.servingProfileId });
  } catch { throw new CallError('invalid', 'The bighelp plugin on your computer sent an unexpected reply.'); }
}

export async function requirePluginFeature(context: CallContext, feature: string): Promise<PluginContext> {
  const plugin = await readPluginContext(context);
  if (!plugin || !plugin.features.includes(feature)) {
    throw new CallError('unsupported', 'This needs a newer version of the bighelp plugin on your computer.');
  }
  return plugin;
}

// Profile names the plugin accepts as agentId (native_api.py _Body).
export const PLUGIN_AGENT_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/u;
export function pluginAgentId(context: CallContext, profile: string): string {
  const agent = context.requireProfile(profile);
  if (!PLUGIN_AGENT_ID.test(agent)) throw new CallError('unsupported', 'The bighelp plugin cannot use this agent’s name.');
  return agent;
}

// One POST /api/plugins/loopdy/native/<route> under the context just read, with
// If-Match and a fresh request ID. The transport checks the echoed ID; this checks
// the echoed context. A write whose reply does not match is "not sure", never done.
export async function nativePost(context: CallContext, plugin: PluginContext, route: string, body: Readonly<Record<string, unknown>>,
  maxBytes: number, mutation: boolean): Promise<unknown> {
  if (!/^[a-z-]+\/[a-z-]+$/u.test(route)) throw new TypeError('Invalid native route');
  const response = await context.http({ method: 'POST', path: `/api/plugins/loopdy/native/${route}`, body: JSON.stringify(body),
    maxBytes, native: { etag: plugin.etag, requestId: context.requestId() } });
  if (response.etag !== plugin.etag) {
    if (mutation) throw new Error('outcome-unknown');
    throw new CallError('unavailable', 'The bighelp plugin on your computer sent an unexpected reply. Try again.');
  }
  return response.body;
}
