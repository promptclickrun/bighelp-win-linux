// Plain-word labels for tool calls. Hermes sends raw tool names and a short
// argument preview; the client owns the wording. Unknown tools stay generic.

type Phrase = readonly [live: string, past: string];
const PHRASES: Readonly<Record<string, Phrase>> = Object.freeze({
  terminal: ['Running a command', 'Ran a command'],
  process: ['Checking a process', 'Checked a process'],
  read_file: ['Reading a file', 'Read a file'],
  write_file: ['Writing a file', 'Wrote a file'],
  patch: ['Editing a file', 'Edited a file'],
  edit_file: ['Editing a file', 'Edited a file'],
  search_files: ['Searching files', 'Searched files'],
  web_search: ['Searching the web', 'Searched the web'],
  web_extract: ['Reading a web page', 'Read a web page'],
  browser_navigate: ['Opening a web page', 'Opened a web page'],
  vision_analyze: ['Looking at an image', 'Looked at an image'],
  image_generate: ['Making an image', 'Made an image'],
  todo: ['Updating the to-do list', 'Updated the to-do list'],
  memory: ['Remembering', 'Remembered'],
  clarify: ['Asking you a question', 'Asked you a question'],
  delegate_task: ['Asking another agent', 'Asked another agent'],
  execute_code: ['Running code', 'Ran code'],
  skill_view: ['Reading a skill', 'Read a skill'],
  skills_list: ['Looking at skills', 'Looked at skills'],
  session_search: ['Searching past chats', 'Searched past chats'],
  send_message: ['Sending a message', 'Sent a message'],
  cronjob: ['Updating a scheduled task', 'Updated a scheduled task'],
});

function humanName(name: string): string {
  const cleaned = name.replace(/^(?:mcp_|loopdy_|bighelp_)/u, '').replace(/[_-]+/gu, ' ').trim();
  return cleaned ? cleaned.slice(0, 48) : 'a tool';
}

export function toolPhrase(name: string, state: 'live' | 'past'): string {
  const known = PHRASES[name] ?? (name.startsWith('browser_') ? ['Using the browser', 'Used the browser'] as const : null);
  if (known) return state === 'live' ? known[0] : known[1];
  return state === 'live' ? `Using ${humanName(name)}` : `Used ${humanName(name)}`;
}

// A short single-line preview of what the tool acted on. Never more than 80 characters.
export function toolDetail(context: unknown, args: unknown): string {
  let text = typeof context === 'string' ? context : '';
  if (!text && args && typeof args === 'object' && !Array.isArray(args)) {
    for (const key of ['path', 'file_path', 'command', 'query', 'url', 'pattern', 'goal', 'name']) {
      const value = (args as Record<string, unknown>)[key];
      if (typeof value === 'string' && value.trim()) { text = value; break; }
    }
  }
  const line = text.replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]+/gu, ' ').replace(/\s+/gu, ' ').trim();
  return line.length > 80 ? `${line.slice(0, 79)}…` : line;
}

// Hermes's own failure rule (tui_gateway/tool_progress.py _tool_result_needs_user).
export function toolFailed(result: unknown): boolean {
  let value = result;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed.startsWith('{')) return false;
    try { value = JSON.parse(trimmed); } catch { return false; }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return row.success === false || row.ok === false || (typeof row.error === 'string' && row.error.trim() !== '')
    || (typeof row.exit_code === 'number' && Number.isInteger(row.exit_code) && row.exit_code !== 0);
}

// Bounded readable preview of a tool's input or output for the expanded step.
export function preview(value: unknown, max = 8192): string {
  let text: string;
  if (typeof value === 'string') text = value;
  else if (value === undefined || value === null) return '';
  else { try { text = JSON.stringify(value, null, 2) ?? ''; } catch { return ''; } }
  if (!text.isWellFormed()) text = text.toWellFormed();
  return text.length > max ? `${text.slice(0, max)}\n… (${(text.length - max).toLocaleString('en-US')} more characters on your computer)` : text;
}

const SILENCE = new Set(['[SILENT]', 'SILENT', 'NO_REPLY', 'NO REPLY', '[静默]', '静默', '[沉默]', '沉默']);
export function isSilenceMarker(text: string): boolean { return SILENCE.has(text.trim()); }
