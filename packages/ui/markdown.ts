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

const RULE = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/u;
const QUOTE = /^ {0,3}> ?(.*)$/u;
const ITEM = /^( *)([-*+]|\d{1,9}[.)])(?:[ \t]+(.*)|$)/u;

// Line classifiers are written as plain scans: no backtracking on long lines.
function fenceOf(line: string): Readonly<{ marker: string; language: string }> | null {
  const indent = indentOf(line);
  if (indent > 3) return null;
  const rest = line.slice(indent), char = rest[0];
  if (char !== '`' && char !== '~') return null;
  let length = 0;
  while (rest[length] === char) length++;
  if (length < 3) return null;
  const info = rest.slice(length).trim();
  if (char === '`' && info.includes('`')) return null;
  return { marker: char.repeat(length), language: (info.split(/\s/u, 1)[0] ?? '').slice(0, 32) };
}
function headingOf(line: string): Readonly<{ level: number; text: string }> | null {
  const indent = indentOf(line);
  if (indent > 3) return null;
  let level = 0;
  while (line[indent + level] === '#') level++;
  if (level < 1 || level > 6) return null;
  const after = line.slice(indent + level);
  if (after && after[0] !== ' ' && after[0] !== '\t') return null;
  let text = after.trim();
  // An optional closing run of # after a space is not part of the title.
  let end = text.length;
  while (end > 0 && text[end - 1] === '#') end--;
  if (end < text.length && (end === 0 || text[end - 1] === ' ' || text[end - 1] === '\t')) text = text.slice(0, end).trimEnd();
  return { level, text };
}
function isDivider(line: string): boolean {
  if (!line.includes('-')) return false;
  let text = line.trim();
  if (text.startsWith('|')) text = text.slice(1);
  if (text.endsWith('|')) text = text.slice(0, -1);
  return text.length > 0 && text.split('|').every(cell => /^:?-+:?$/u.test(cell.trim()));
}
// Index of the first non-blank line at or after each position (-1: none).
function nextFilled(lines: readonly string[]): Int32Array {
  const result = new Int32Array(lines.length + 1).fill(-1);
  for (let index = lines.length - 1; index >= 0; index--) result[index] = blank(lines[index]!) ? result[index + 1]! : index;
  return result;
}
function runLength(text: string, index: number, char: string): number {
  let length = 0;
  while (text[index + length] === char) length++;
  return length;
}

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
  return fenceOf(line) !== null || headingOf(line) !== null || RULE.test(line) || QUOTE.test(line) || ITEM.test(line);
}

function parseBlocks(lines: readonly string[], depth: number): Block[] {
  const blocks: Block[] = [];
  const filled = nextFilled(lines);
  const following = (from: number): string | undefined => { const at = from < lines.length ? filled[from]! : -1; return at < 0 ? undefined : lines[at]; };
  let index = 0;
  while (index < lines.length) {
    const line = lines[index]!;
    if (blank(line)) { index++; continue; }
    const fence = fenceOf(line);
    if (fence) {
      const marker = fence.marker, language = fence.language, body: string[] = [];
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
    const heading = headingOf(line);
    if (heading) {
      blocks.push({ kind: 'heading', level: heading.level as 1, children: parseInline(heading.text) });
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
            const after = following(index + 1);
            if (after !== undefined && indentOf(after) >= contentIndent) { body.push(''); index++; continue; }
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
          const after = following(index);
          const match = after === undefined ? null : ITEM.exec(after);
          if (match && match[1]!.length === base) index++; else break;
        }
      }
      blocks.push({ kind: 'list', ordered, start, items });
      continue;
    }
    const next = lines[index + 1];
    if (line.includes('|') && next !== undefined && isDivider(next)) {
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
      const nextLine = lines[index + 1];
      if (body.length && current.includes('|') && nextLine !== undefined && isDivider(nextLine)) break;
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

// Per-call memory of searches that already failed. A search that found no closer
// from position p finds none from any later position, so each kind of marker
// scans the text at most once: parsing stays linear on unmatched delimiters.
type Misses = { closers: Map<string, number>; code: Map<number, number>; brackets: Map<number, number> | null };

function codeClose(text: string, from: number, length: number, misses: Misses): number {
  const missed = misses.code.get(length);
  if (missed !== undefined && from >= missed) return -1;
  const end = text.indexOf('`'.repeat(length), from);
  if (end < 0) misses.code.set(length, Math.min(missed ?? Number.MAX_SAFE_INTEGER, from));
  return end;
}

function closingRun(text: string, from: number, marker: string, misses: Misses): number {
  const missed = misses.closers.get(marker);
  if (missed !== undefined && from >= missed) return -1;
  for (let index = from; index < text.length; index++) {
    if (text[index] === '\\') { index++; continue; }
    if (text[index] === '`') {
      const length = runLength(text, index, '`');
      const end = codeClose(text, index + length, length, misses);
      if (end >= 0) { index = end + length - 1; continue; }
      index += length - 1; continue;
    }
    if (text.startsWith(marker, index) && index > from && !/\s/u.test(text[index - 1]!)) {
      if (marker[0] === '_' && WORD.test(text[index + marker.length] ?? '')) continue;
      return index;
    }
  }
  misses.closers.set(marker, Math.min(missed ?? Number.MAX_SAFE_INTEGER, from));
  return -1;
}

// Matching ] for every [ in one pass (escapes skipped).
function matchBrackets(text: string): Map<number, number> {
  const matches = new Map<number, number>(), open: number[] = [];
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === '\\') { index++; continue; }
    if (character === '[') open.push(index);
    else if (character === ']') { const start = open.pop(); if (start !== undefined) matches.set(start, index); }
  }
  return matches;
}

export function parseInline(source: string, depth = 0): readonly Inline[] {
  const misses: Misses = { closers: new Map(), code: new Map(), brackets: null };
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
      const length = runLength(source, index, '`');
      const end = codeClose(source, index + length, length, misses);
      if (end >= 0) {
        flush();
        let code = source.slice(index + length, end).replace(/\n/gu, ' ');
        if (code.length > 2 && code.startsWith(' ') && code.endsWith(' ') && code.trim()) code = code.slice(1, -1);
        result.push({ kind: 'code', text: code }); index = end + length; continue;
      }
      buffer += '`'.repeat(length); index += length; continue;
    }
    if (depth < MARKDOWN_LIMITS.depth && (character === '[' || (character === '!' && source[index + 1] === '['))) {
      const image = character === '!';
      const open = index + (image ? 1 : 0);
      misses.brackets ??= matchBrackets(source);
      const close = misses.brackets.get(open) ?? -1;
      if (close > 0 && source[close + 1] === '(') {
        // Look ahead only as far as a link target can reach.
        const match = /^\(\s*(<[^>\n]*>|[^\s()]*(?:\([^\s()]*\)[^\s()]*)*)(?:\s+(?:"[^"\n]*"|'[^'\n]*'))?\s*\)/u.exec(source.slice(close + 1, close + 2600));
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
      const match = /^<((?:https?:\/\/|mailto:)[^\s<>]+)>/u.exec(source.slice(index, index + 2100));
      const href = match ? safeLink(match[1]!) : null;
      if (match && href) { flush(); result.push({ kind: 'link', href, children: [{ kind: 'text', text: match[1]! }] }); index += match[0].length; continue; }
    }
    if ((character === 'h' || character === 'w') && !WORD.test(source[index - 1] ?? '')) {
      const match = /^(?:https?:\/\/|www\.)[^\s<]+/u.exec(source.slice(index, index + 2100));
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
        const end = closingRun(source, index + marker.length, marker, misses);
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
    .replace(/^[ \t]{0,3}(?:#{1,6}[ \t]+|>[ \t]?|[-*+][ \t]+(?:\[[ xX]\][ \t]+)?|\d{1,9}[.)][ \t]+)/gmu, '')
    .replace(/^[ \t]*\|?[ \t]*:?-{2,}:?[ \t]*(?:\|[ \t]*:?-{2,}:?[ \t]*)*\|?[ \t]*$/gmu, ' ')
    .replace(/\|/gu, ' ').replace(/(\*\*|~~|\*)(?=\S)([^*~]*?\S)\1/gu, '$2')
    .replace(/(?<![\p{L}\p{N}])(__|_)(?=\S)([^_]*?\S)\1(?![\p{L}\p{N}])/gu, '$2')
    .replace(/\s+/gu, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
