// Main-only helpers for the chat catalog. session.list stays the authority for
// which chats exist; REST adds last-activity times that the RPC rows lack.
import { decodeChatActivity, HIDDEN_CHAT_SOURCES } from '../../../../packages/contracts/chat-list.ts';
import type { ChatDetail } from '../../../../packages/contracts/chat-list.ts';
import type { decodeSessionList } from '../../../../packages/contracts/session.ts';
import type { Gateway } from '../../../../packages/hermes-client/gateway.ts';
import type { ChatView, TranscriptItem } from '../../../../packages/ui/view-model.ts';

// Best effort: an older Hermes, a busy store or an odd reply leaves times
// unknown (the list still shows, ordered as Hermes listed it).
export async function recentActivity(connection: Pick<Gateway, 'requestHttp'>, profile: string): Promise<ReadonlyMap<string, number>> {
  try {
    const reply = await connection.requestHttp({ kind: 'route', method: 'GET', path: '/api/sessions', maxBytes: 3 * 1024 * 1024,
      query: { profile, limit: '100', order: 'recent', archived: 'exclude', exclude_sources: HIDDEN_CHAT_SOURCES.join(',') } });
    return new Map(decodeChatActivity(reply.body, profile).map(row => [row.id, row.updatedAt]));
  } catch { return new Map(); }
}

type SessionRow = ReturnType<typeof decodeSessionList>[number];
function times(startedAt: number | null, updatedAt: number | null | undefined): Pick<ChatView, 'startedAt' | 'updatedAt'> {
  return { ...(startedAt === null ? {} : { startedAt }), ...(updatedAt === null || updatedAt === undefined ? {} : { updatedAt }) };
}
export function catalogChat(row: SessionRow, updatedAt: number | undefined, transcript: readonly TranscriptItem[]): ChatView {
  return { id: row.id, agentId: row.profile, title: row.title, preview: row.preview, transcript, ...times(row.startedAt, updatedAt) };
}
export function searchedChat(profile: string, detail: ChatDetail): ChatView {
  return { id: detail.id, agentId: profile, title: detail.title, preview: detail.preview, transcript: [],
    ...times(detail.startedAt, detail.updatedAt) };
}
