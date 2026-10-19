// Tells the bighelp plugin who is speaking before a send, so agents know the
// person's name (plugin native-people-v1). A label, never identity or authority.
// Bounded: the send waits at most 1.2 s and goes ahead whatever happens here.
import { randomUUID } from 'node:crypto';
import { decodeWorkspaceContext } from '../../../../packages/contracts/workspace.ts';
import type { WorkspaceIdentity } from '../../../../packages/contracts/workspace.ts';
import type { HttpOperation, HttpResult } from '../../../../packages/platform/transport-policy.ts';
import { HttpStatusError } from '../../../../packages/platform/transport-policy.ts';

export const SPEAKER_NOTE_WAIT_MS = 1200;
type Http = (operation: HttpOperation) => Promise<HttpResult>;
export type SpeakerNote = Readonly<{ profile: string; storedSessionId: string; personId: string; name: string }>;

export function speakerNoteAllowed(note: SpeakerNote): boolean {
  return /^[a-z0-9][a-z0-9_-]{0,63}$/u.test(note.profile) && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u.test(note.storedSessionId)
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(note.personId) && !!note.name.trim() && note.name.length <= 400;
}

async function post(http: Http, identity: WorkspaceIdentity, note: SpeakerNote): Promise<boolean> {
  const context = await http({ kind: 'nativeContext' });
  const decoded = decodeWorkspaceContext(context.body, identity, context.etag, context.cacheControl);
  if (!decoded.features.includes('native-people-v1')) return false;
  await http({ kind: 'route', method: 'POST', path: '/api/plugins/loopdy/native/people/speaking', maxBytes: 16384,
    native: { etag: decoded.etag, requestId: randomUUID() },
    body: JSON.stringify({ agentId: note.profile, sessionId: note.storedSessionId, personId: note.personId, name: note.name.trim() }) });
  return true;
}

// Resolves within the wait limit; errors are swallowed (one retry on a stale ETag).
export function sendSpeakerNote(http: Http, identity: WorkspaceIdentity, note: SpeakerNote): Promise<void> {
  if (!speakerNoteAllowed(note)) return Promise.resolve();
  const attempt = (async () => {
    try { await post(http, identity, note); }
    catch (error) { if (error instanceof HttpStatusError && error.status === 412) await post(http, identity, note).catch(() => false); }
  })().catch(() => undefined);
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([attempt, new Promise<void>(resolve => { timer = setTimeout(resolve, SPEAKER_NOTE_WAIT_MS); })]).finally(() => clearTimeout(timer));
}
