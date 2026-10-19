// Decides whether a DesktopAlert becomes an OS notification, and what it says.
// Pure: no Electron import, time and platform are inputs. Alert text comes from
// the host and is treated as inert, untrusted display text.
import type { DesktopAlert } from '../shared/desktop-api.ts';
import type { Preferences } from '../shared/preferences.ts';

export const NOTIFICATION_PREVIEW_LIMIT = 200;
export const NOTIFICATION_DEDUPE_MS = 5000;
const AGENT_NAME_LIMIT = 60;
const LEDGER_LIMIT = 128;

export type NotificationContext = Readonly<{
  preferences: Pick<Preferences, 'notifyAttention' | 'notifyReplies' | 'notificationPreview'>;
  // The bighelp window is visible, not minimised, and has focus.
  windowFocused: boolean;
  selectedChatId: string | null;
  platform: string;
  now: number;
}>;
export type NotificationContent = Readonly<{ title: string; body: string }>;
export type NotificationDecision =
  | Readonly<{ show: false; reason: 'invalid' | 'off' | 'onScreen' | 'duplicate' }>
  | Readonly<{ show: true; content: NotificationContent }>;

const KINDS = new Set(['approval', 'question', 'reply', 'failed']);

// Control, bidirectional-override and zero-width format characters could hide or
// reorder text in the OS notification. Replace them, then collapse whitespace.
export function cleanText(value: string, limit: number): string {
  const cleaned = value.toWellFormed()
    .replace(/[\p{Cc}\u200B-\u200F\u2028-\u202E\u2060-\u206F\uFEFF]/gu, ' ')
    .replace(/\s+/gu, ' ').trim();
  const points = Array.from(cleaned);
  return points.length <= limit ? cleaned : `${points.slice(0, limit - 1).join('').trimEnd()}…`;
}

// Electron passes Linux notification bodies to the notification server unescaped,
// and servers that support body markup would interpret tags. Escape them.
function escapeMarkup(value: string): string {
  return value.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;');
}

export function notificationContent(alert: DesktopAlert, preview: boolean, platform: string): NotificationContent {
  const agent = cleanText(alert.agentName, AGENT_NAME_LIMIT) || 'Your agent';
  const headline = alert.kind === 'approval' ? `${agent} needs your OK`
    : alert.kind === 'question' ? `${agent} has a question`
    : alert.kind === 'reply' ? `${agent} replied`
    : `${agent} ran into a problem`;
  if (!preview) return Object.freeze({ title: 'bighelp', body: platform === 'linux' ? escapeMarkup(headline) : headline });
  const fallback = alert.kind === 'approval' ? 'Review this request before responding.'
    : alert.kind === 'question' ? 'Open the chat to answer.'
    : alert.kind === 'reply' ? 'Open the chat to read it.'
    : 'Open the chat to see what happened.';
  const body = cleanText(alert.text, NOTIFICATION_PREVIEW_LIMIT) || fallback;
  return Object.freeze({ title: headline, body: platform === 'linux' ? escapeMarkup(body) : body });
}

function valid(alert: DesktopAlert): boolean {
  return !!alert && typeof alert === 'object' && KINDS.has(alert.kind) && typeof alert.chatId === 'string'
    && typeof alert.agentName === 'string' && typeof alert.text === 'string';
}

// One gate per process. It remembers recently shown alerts so a repeated event
// (for example after a reconnect) does not pop up twice within a few seconds.
export function createNotificationGate(dedupeMs = NOTIFICATION_DEDUPE_MS) {
  const recent = new Map<string, number>();
  return Object.freeze({
    decide(alert: DesktopAlert, context: NotificationContext): NotificationDecision {
      if (!valid(alert)) return { show: false, reason: 'invalid' };
      const attention = alert.kind === 'approval' || alert.kind === 'question';
      if (!(attention ? context.preferences.notifyAttention : context.preferences.notifyReplies)) return { show: false, reason: 'off' };
      if (context.windowFocused && context.selectedChatId !== null && context.selectedChatId === alert.chatId) {
        return { show: false, reason: 'onScreen' };
      }
      for (const [key, at] of recent) if (context.now - at >= dedupeMs || context.now < at) recent.delete(key);
      const key = JSON.stringify([alert.kind, alert.chatId, alert.agentName, alert.text]);
      if (recent.has(key)) return { show: false, reason: 'duplicate' };
      recent.set(key, context.now);
      while (recent.size > LEDGER_LIMIT) { const oldest = recent.keys().next().value; if (oldest === undefined) break; recent.delete(oldest); }
      return { show: true, content: notificationContent(alert, context.preferences.notificationPreview, context.platform) };
    },
  });
}
