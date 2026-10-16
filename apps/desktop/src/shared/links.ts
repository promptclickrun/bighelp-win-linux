// The only links bighelp hands to the system: web and mail addresses without
// embedded credentials. Everything else stays plain text.
export function safeLink(href: string): string | null {
  if (typeof href !== 'string') return null;
  const trimmed = href.trim();
  if (trimmed.length > 2048 || /[\s<>"\u0000-\u001f\u007f]/u.test(trimmed)) return null;
  let url: URL;
  try { url = new URL(trimmed); } catch { return null; }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:' && url.protocol !== 'mailto:') || url.username || url.password) return null;
  if (url.protocol !== 'mailto:' && !url.hostname) return null;
  return url.href;
}

// Commands the application menu sends to the window. Finite, no payload.
export const APP_COMMANDS = Object.freeze(['newChat', 'search', 'settings', 'focusComposer'] as const);
export type AppCommand = typeof APP_COMMANDS[number];
export function isAppCommand(value: unknown): value is AppCommand {
  return typeof value === 'string' && (APP_COMMANDS as readonly string[]).includes(value);
}
