// A small, bounded Markdown reader for chat replies. Pure data in, plain data
// out: no HTML, no network, no evaluation. Unknown syntax stays literal text.
// Covers what assistants commonly write: headings, emphasis, code spans and
// fences, lists (nested, ordered, tasks), quotes, tables, rules and links.

import { safeLink } from '../../apps/desktop/src/shared/links.ts';

export type Inline =
  | Readonly<{ kind: 'text'; text: string }>
  | Readonly<{ kind: 'strong' | 'em' | 'del'; children: readonly Inline[] }>
  | Readonly<{ kind: 'code'; text: string }>
  | Readonly<{ kind: 'link'; href: string; children: readonly Inline[] }>
  | Readonly<{ kind: 'break' }>;

export type Block =
  | Readonly<{ kind: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; children: readonly Inline[] }>
  | Readonly<{ kind: 'paragraph'; children: readonly Inline[] }>
  | Readonly<{ kind: 'code'; language: string; text: string }>
  | Readonly<{ kind: 'list'; ordered: boolean; start: number; items: readonly ListItem[] }>
  | Readonly<{ kind: 'quote'; children: readonly Block[] }>
  | Readonly<{ kind: 'table'; align: readonly ('left' | 'center' | 'right' | null)[]; header: readonly (readonly Inline[])[];
      rows: readonly (readonly (readonly Inline[])[])[] }>
  | Readonly<{ kind: 'rule' }>;
export type ListItem = Readonly<{ checked: boolean | null; children: readonly Block[] }>;

export const MARKDOWN_LIMITS = Object.freeze({ characters: 200_000, depth: 8, tableColumns: 32, tableRows: 500 });

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^`\s]*)[^`]*$/u;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/u;
const RULE = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/u;
const QUOTE = /^ {0,3}> ?(.*)$/u;
const ITEM = /^( *)([-*+]|\d{1,9}[.)])(?:[ \t]+(.*)|$)/u;
const DIVIDER = /^ *\|? *:?-{1,}:? *(?:\| *:?-{1,}:? *)*\|? *$/u;

function indentOf(line: string): number { return line.length - line.trimStart().length; }
function blank(line: string): boolean { return line.trim() === ''; }

function splitRow(line: string): string[] {
  let text = line.trim();
  if (text.startsWith('|')) text = text.slice(1);
  if (text.endsWith('|') && !text.endsWith('\\|')) text = text.slice(0, -1);
  const cells: string[] = []; let current = '', ticks = 0;
  for (let index = 0; index < text.length; index++) {
    const character = text[index]!;
    if (character === '\\' && text[index + 1] === '|') { current += '|'; index++; continue; }
    if (character === '`') ticks ^= 1;
    if (character === '|' && !ticks) { cells.push(current.trim()); current = ''; continue; }
    current += character;
  }
  cells.push(current.trim());
  return cells;
}

function startsBlock(line: string): boolean {
  return FENCE.test(line) || HEADING.test(line) || RULE.test(line) || QUOTE.test(line) || ITEM.test(line);
}

function parseBlocks(lines: readonly string[], depth: number): Block[] {
  const blocks: Block[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index]!;
    if (blank(line)) { index++; continue; }
    const fence = FENCE.exec(line);
    if (fence) {
      const marker = fence[1]!, language = (fence[2] ?? '').slice(0, 32), body: string[] = [];
      const indent = indentOf(line);
      index++;
      while (index < lines.length) {
        const current = lines[index]!;
        const trimmed = current.trim();
        if (trimmed.startsWith(marker[0]!.repeat(marker.length)) && /^[`~]+$/u.test(trimmed) && trimmed[0] === marker[0]) { index++; break; }
        body.push(indent ? current.replace(new RegExp(`^ {0,${indent}}`, 'u'), '') : current);
        index++;
      }
      blocks.push({ kind: 'code', language, text: body.join('\n') });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1]!.length as 1, children: parseInline(heading[2] ?? '') });
      index++; continue;
    }
    if (RULE.test(line)) { blocks.push({ kind: 'rule' }); index++; continue; }
    if (QUOTE.test(line)) {
      const body: string[] = [];
      while (index < lines.length && !blank(lines[index]!)) {
        const match = QUOTE.exec(lines[index]!);
        // Lazy continuation: a plain line continues the quoted paragraph.
        if (!match && startsBlock(lines[index]!)) break;
        body.push(match ? match[1]! : lines[index]!);
        index++;
      }
      blocks.push(depth >= MARKDOWN_LIMITS.depth ? { kind: 'paragraph', children: parseInline(body.join('\n')) }
        : { kind: 'quote', children: parseBlocks(body, depth + 1) });
      continue;
    }
    const item = ITEM.exec(line);
    if (item) {
      const base = item[1]!.length, ordered = /\d/u.test(item[2]!);
      const start = ordered ? Math.min(Number.parseInt(item[2]!, 10), 1_000_000_000) : 1;
      const items: ListItem[] = [];
      while (index < lines.length) {
        const current = ITEM.exec(lines[index]!);
        if (!current || current[1]!.length !== base || /\d/u.test(current[2]!) !== ordered) break;
        const contentIndent = current[1]!.length + current[2]!.length + 1;
        const body = [current[3] ?? ''];
        index++;
        while (index < lines.length) {
          const next = lines[index]!;
          if (blank(next)) {
            // A blank line continues the item only if indented content follows.
            const following = lines.slice(index + 1).find(entry => !blank(entry));
            if (following !== undefined && indentOf(following) >= contentIndent) { body.push(''); index++; continue; }
            break;
          }
          if (indentOf(next) >= Math.max(contentIndent, base + 2)) { body.push(next.slice(Math.min(indentOf(next), contentIndent))); index++; continue; }
          if (ITEM.test(next) || startsBlock(next)) break;
          body.push(next.trimStart()); index++; // lazy paragraph continuation
        }
        let checked: boolean | null = null;
        const task = /^\[([ xX])\][ \t]+/u.exec(body[0]!);
        if (task) { checked = task[1] !== ' '; body[0] = body[0]!.slice(task[0].length); }
        items.push({ checked, children: depth >= MARKDOWN_LIMITS.depth
          ? [{ kind: 'paragraph', children: parseInline(body.join('\n')) }] : parseBlocks(body, depth + 1) });
        while (index < lines.length && blank(lines[index]!)) {
          const following = lines.slice(index).find(entry => !blank(entry));
          const match = following === undefined ? null : ITEM.exec(following);
          if (match && match[1]!.length === base) index++; else break;
        }
      }
      blocks.push({ kind: 'list', ordered, start, items });
      continue;
    }
    const next = lines[index + 1];
    if (line.includes('|') && next !== undefined && DIVIDER.test(next) && next.includes('-')) {
      const header = splitRow(line).slice(0, MARKDOWN_LIMITS.tableColumns);
      const align = splitRow(next).slice(0, header.length).map(cell => {
        const left = cell.startsWith(':'), right = cell.endsWith(':');
        return left && right ? 'center' as const : right ? 'right' as const : left ? 'left' as const : null;
      });
      while (align.length < header.length) align.push(null);
      index += 2;
      const rows: (readonly Inline[])[][] = [];
      while (index < lines.length && !blank(lines[index]!) && lines[index]!.includes('|') && rows.length < MARKDOWN_LIMITS.tableRows) {
        const cells = splitRow(lines[index]!).slice(0, header.length);
        while (cells.length < header.length) cells.push('');
        rows.push(cells.map(cell => parseInline(cell)));
        index++;
      }
      blocks.push({ kind: 'table', align, header: header.map(cell => parseInline(cell)), rows });
      continue;
    }
    // Paragraph, with setext headings.
    const body: string[] = [];
    while (index < lines.length && !blank(lines[index]!)) {
      const current = lines[index]!;
      if (body.length && (startsBlock(current) && !RULE.test(current))) break;
      if (body.length && /^ {0,3}=+ *$/u.test(current)) { index++; blocks.push({ kind: 'heading', level: 1, children: parseInline(body.join('\n')) }); body.length = 0; break; }
      if (body.length && /^ {0,3}-+ *$/u.test(current)) { index++; blocks.push({ kind: 'heading', level: 2, children: parseInline(body.join('\n')) }); body.length = 0; break; }
      if (!body.length && RULE.test(current)) break;
      const following = lines[index + 1];
      if (body.length && current.includes('|') && following !== undefined && DIVIDER.test(following) && following.includes('-')) break;
      body.push(current); index++;
    }
    if (body.length) blocks.push({ kind: 'paragraph', children: parseInline(body.join('\n')) });
  }
  return blocks;
}

const PUNCTUATION = /[!-/:-@[-`{-~]/u;
const WORD = /[\p{L}\p{N}]/u;

// Only web and mail links become clickable; everything else stays text.
export { safeLink };

function closingRun(text: string, from: number, marker: string): number {
  for (let index = from; index < text.length; index++) {
    if (text[index] === '\\') { index++; continue; }
    if (text[index] === '`') {
      const run = /^`+/u.exec(text.slice(index))![0];
      const end = text.indexOf(run, index + run.length);
      if (end >= 0) { index = end + run.length - 1; continue; }
    }
    if (text.startsWith(marker, index) && index > from && !/\s/u.test(text[index - 1]!)) {
      if (marker[0] === '_' && WORD.test(text[index + marker.length] ?? '')) continue;
      return index;
    }
  }
  return -1;
}

export function parseInline(source: string, depth = 0): readonly Inline[] {
  const result: Inline[] = [];
  let buffer = '';
  const flush = () => { if (buffer) { result.push({ kind: 'text', text: buffer }); buffer = ''; } };
  let index = 0;
  while (index < source.length) {
    const character = source[index]!;
    if (character === '\\' && index + 1 < source.length) {
      const next = source[index + 1]!;
      if (next === '\n') { flush(); result.push({ kind: 'break' }); index += 2; continue; }
      if (PUNCTUATION.test(next)) { buffer += next; index += 2; continue; }
    }
    if (character === '\n') {
      flush(); result.push({ kind: 'break' });
      buffer = buffer.replace(/ +$/u, ''); index++; continue;
    }
    if (character === '`') {
      const run = /^`+/u.exec(source.slice(index))![0];
      const end = source.indexOf(run, index + run.length);
      if (end >= 0) {
        flush();
        let code = source.slice(index + run.length, end).replace(/\n/gu, ' ');
        if (code.length > 2 && code.startsWith(' ') && code.endsWith(' ') && code.trim()) code = code.slice(1, -1);
        result.push({ kind: 'code', text: code }); index = end + run.length; continue;
      }
      buffer += run; index += run.length; continue;
    }
    if (depth < MARKDOWN_LIMITS.depth && (character === '[' || (character === '!' && source[index + 1] === '['))) {
      const image = character === '!';
      const open = index + (image ? 1 : 0);
      let level = 0, close = -1;
      for (let cursor = open; cursor < source.length; cursor++) {
        if (source[cursor] === '\\') { cursor++; continue; }
        if (source[cursor] === '[') level++;
        if (source[cursor] === ']' && --level === 0) { close = cursor; break; }
      }
      if (close > 0 && source[close + 1] === '(') {
        const match = /^\(\s*(<[^>\n]*>|[^\s()]*(?:\([^\s()]*\)[^\s()]*)*)(?:\s+(?:"[^"\n]*"|'[^'\n]*'))?\s*\)/u.exec(source.slice(close + 1));
        if (match) {
          const raw = match[1]!.startsWith('<') ? match[1]!.slice(1, -1) : match[1]!;
          const href = safeLink(raw);
          const label = source.slice(open + 1, close);
          flush();
          const children = image ? [{ kind: 'text' as const, text: `Image: ${label || raw}` }] : parseInline(label, depth + 1);
          result.push(href ? { kind: 'link', href, children } : { kind: 'text', text: image ? `Image: ${label || raw}` : label });
          index = close + 1 + match[0].length; continue;
        }
      }
    }
    if (character === '<') {
      const match = /^<((?:https?:\/\/|mailto:)[^\s<>]+)>/u.exec(source.slice(index));
      const href = match ? safeLink(match[1]!) : null;
      if (match && href) { flush(); result.push({ kind: 'link', href, children: [{ kind: 'text', text: match[1]! }] }); index += match[0].length; continue; }
    }
    if ((character === 'h' || character === 'w') && !WORD.test(source[index - 1] ?? '')) {
      const match = /^(?:https?:\/\/|www\.)[^\s<]+/u.exec(source.slice(index));
      if (match) {
        let text = match[0];
        // Trailing punctuation belongs to the sentence, not the address.
        while (/[.,:;!?'"*_~]$/u.test(text) || (text.endsWith(')') && (text.match(/\(/gu)?.length ?? 0) < (text.match(/\)/gu)?.length ?? 0))) text = text.slice(0, -1);
        const href = safeLink(text.startsWith('www.') ? `https://${text}` : text);
        if (href) { flush(); result.push({ kind: 'link', href, children: [{ kind: 'text', text }] }); index += text.length; continue; }
      }
    }
    if (depth < MARKDOWN_LIMITS.depth && (character === '*' || character === '_' || character === '~')) {
      const double = source[index + 1] === character;
      const marker = character === '~' ? (double ? '~~' : '') : double ? character + character : character;
      const opensWord = !/\s/u.test(source[index + marker.length] ?? ' ');
      const leftOk = character !== '_' || !WORD.test(source[index - 1] ?? '');
      if (marker && opensWord && leftOk) {
        const end = closingRun(source, index + marker.length, marker);
        if (end > index + marker.length) {
          flush();
          const children = parseInline(source.slice(index + marker.length, end), depth + 1);
          result.push({ kind: marker === '~~' ? 'del' : marker.length === 2 ? 'strong' : 'em', children });
          index = end + marker.length; continue;
        }
      }
    }
    buffer += character; index++;
  }
  flush();
  return result;
}

export type MarkdownDocument = Readonly<{ blocks: readonly Block[]; truncated: boolean }>;

// Very long replies render as plain text: the full text stays selectable and
// copyable, and the reader never blocks the window.
export function parseMarkdown(source: string): MarkdownDocument {
  if (source.length > MARKDOWN_LIMITS.characters) {
    return { blocks: [{ kind: 'code', language: '', text: source }], truncated: true };
  }
  return { blocks: parseBlocks(source.replace(/\r\n?/gu, '\n').split('\n'), 0), truncated: false };
}

// Plain text of inline content, for accessible names and copy.
export function inlineText(nodes: readonly Inline[]): string {
  return nodes.map(node => node.kind === 'text' || node.kind === 'code' ? node.text : node.kind === 'break' ? '\n'
    : inlineText(node.children)).join('');
}

// One calm line for chat-list previews and notifications: Markdown syntax removed.
export function plainPreview(source: string, max = 160): string {
  const text = source.slice(0, 4000)
    .replace(/```[^\n]*\n?/gu, ' ').replace(/`([^`]*)`/gu, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/gu, '$1')
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+(?:\[[ xX]\]\s+)?|\d{1,9}[.)]\s+)/gmu, '')
    .replace(/^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?\s*$/gmu, ' ')
    .replace(/\|/gu, ' ').replace(/(\*\*|~~|\*)(?=\S)([^*~]*?\S)\1/gu, '$2')
    .replace(/(?<![\p{L}\p{N}])(__|_)(?=\S)([^_]*?\S)\1(?![\p{L}\p{N}])/gu, '$2')
    .replace(/\s+/gu, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
