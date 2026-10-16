// The bighelp host plugin's verified context: features, version and the ETag
// every native write must echo. Read fresh for each call; never cached across hosts.
import { decodeWorkspaceContext } from '../../../../../packages/contracts/workspace.ts';
import { HttpStatusError } from '../../../../../packages/platform/transport-policy.ts';
import type { CallContext } from './context.ts';
import { CallError } from './context.ts';

export type PluginContext = Readonly<{ etag: string; version: string; features: readonly string[] }>;

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
    return Object.freeze({ etag: decoded.etag, version: decoded.pluginVersion, features: decoded.features });
  } catch { throw new CallError('invalid', 'The bighelp plugin on your computer sent an unexpected reply.'); }
}

export async function requirePluginFeature(context: CallContext, feature: string): Promise<PluginContext> {
  const plugin = await readPluginContext(context);
  if (!plugin || !plugin.features.includes(feature)) {
    throw new CallError('unsupported', 'This needs a newer version of the bighelp plugin on your computer.');
  }
  return plugin;
}
