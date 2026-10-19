// Read-only facts about the connected computer for Help and System pages.
import { defineCall } from '../call.ts';
import { fields } from '../validate.ts';

export type HostAbout = Readonly<{
  version: string | null; releaseDate: string | null;
  gatewayRunning: boolean | null; activeSessions: number | null;
  plugin: Readonly<{ installed: boolean; version: string | null; features: readonly string[] }>;
}>;

export const HOST_CALLS = Object.freeze({
  'host.about': defineCall<HostAbout>()(input => { fields(input, []); return Object.freeze({}); }),
});
