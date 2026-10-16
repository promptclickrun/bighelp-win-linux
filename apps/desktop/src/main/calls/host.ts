import { encodeBoundedJson } from '../../../../../packages/contracts/rpc.ts';
import type { HOST_CALLS, HostAbout } from '../../shared/calls/host.ts';
import type { CallHandlers } from './index.ts';
import { readPluginContext } from './plugin.ts';

function shortText(value: unknown, max = 64): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= max && /^[\x20-\x7e]+$/u.test(value) ? value : null;
}

export const HOST_HANDLERS: Pick<CallHandlers, keyof typeof HOST_CALLS> = Object.freeze({
  'host.about': {
    mutation: false,
    async run(context): Promise<HostAbout> {
      const status = (await context.http({ method: 'GET', path: '/api/status', maxBytes: 262144 })).body;
      encodeBoundedJson(status, 262144);
      const row = status && typeof status === 'object' && !Array.isArray(status) ? status as Record<string, unknown> : {};
      // The plugin is optional; its absence never blocks chat or this page.
      const plugin = await readPluginContext(context).catch(() => null);
      return Object.freeze({
        version: shortText(row.version), releaseDate: shortText(row.release_date),
        gatewayRunning: typeof row.gateway_running === 'boolean' ? row.gateway_running : null,
        activeSessions: typeof row.active_sessions === 'number' && Number.isSafeInteger(row.active_sessions) && row.active_sessions >= 0 ? row.active_sessions : null,
        plugin: Object.freeze({ installed: !!plugin, version: plugin?.version ?? null, features: plugin?.features ?? Object.freeze([]) }),
      });
    },
  },
});
