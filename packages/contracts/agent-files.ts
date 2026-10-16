// The agent's Files tab: files in the Hermes computer's working folder
// (bighelp plugin native/workspace-files/*) and pictures or videos the agent
// sent (native/attachments/recent + fetch). Read-only.
//
// Host paths never reach the renderer. Main turns every absolute host path into
// a path relative to the working folder and rebuilds the absolute path from a
// freshly read root for each request. No Buffer or DOM: shared by both processes.

export type AgentFileEntry = Readonly<{
  name: string; path: string; folder: boolean; size?: number; mimeType?: string; modifiedAt?: string; createdAt?: string;
}>;
// servingProfileId: whose working folder this is. The plugin always serves the
// Hermes process's own profile, whichever agent is open (workspace_artifacts.py).
export type AgentFolder = Readonly<{
  servingProfileId: string; folder: string; parent: string | null; recent: boolean; entries: readonly AgentFileEntry[];
}>;
export type FilePreview =
  | Readonly<{ kind: 'text'; text: string; truncated: boolean }>
  | Readonly<{ kind: 'image'; dataUrl: string }>
  | Readonly<{ kind: 'none'; reason: 'empty' | 'too-large' | 'not-previewable' | 'not-text' }>;
export type AgentFilePreview = Readonly<{
  servingProfileId: string; name: string; path: string; size: number; mimeType: string; modifiedAt?: string;
  preview: FilePreview; saveable: boolean;
}>;
export type AgentMediaItem = Readonly<{ id: string; name: string; mimeType: string; size: number; createdAt?: string }>;
export type AgentMediaList = Readonly<{ items: readonly AgentMediaItem[] }>;
export type AgentMediaPreview = Readonly<{ id: string; mimeType: string; size: number; preview: FilePreview; saveable: boolean }>;
export type SaveResult = Readonly<{ saved: boolean; fileName?: string }>;

export const AGENT_FILE_FEATURES = Object.freeze({
  files: 'native-workspace-files-v1', recent: 'native-workspace-recent-v1',
  attachments: 'native-agent-attachments-v1', media: 'native-agent-media-v1',
});
export const AGENT_FILE_LIMITS = Object.freeze({
  // One workspace read must fit the 4 MiB response budget as base64 plus its
  // path frame (each path ≤ 4,096 bytes). The plugin itself allows 25 MiB.
  readBytes: 3_000_000,
  // Media arrive in chunks of ≤ 3 MiB raw; saving pulls at most this many bytes.
  mediaBytes: 25 * 1024 * 1024,
  previewCharacters: 100_000,
  listingBytes: 196_608,
  relativePath: 2048,
  segments: 64,
});

const invalid = (): never => { throw new TypeError('Invalid file response'); };
function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
const UNSAFE = /[\x00-\x1f\x7f-\x9f‪-‮⁦-⁩]/u;
function name(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 255 || !value.isWellFormed() || UNSAFE.test(value)
    || value === '.' || value === '..' || /[/\\]/u.test(value)) return invalid();
  return value;
}

// A path below the working folder: "reports/summary.md", or "" for the folder
// itself. No empty, "." or ".." segment, no backslash, no control character.
export function relativeFilePath(value: unknown, allowRoot = true): string {
  if (typeof value !== 'string' || value.length > AGENT_FILE_LIMITS.relativePath || !value.isWellFormed()) return invalid();
  if (value === '') return allowRoot ? value : invalid();
  const parts = value.split('/');
  if (parts.length > AGENT_FILE_LIMITS.segments) return invalid();
  for (const part of parts) name(part);
  return value;
}
// An absolute POSIX root as the plugin reports it. Never shown to the renderer.
function hostRoot(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.length > 4096 || !value.isWellFormed() || UNSAFE.test(value)) return invalid();
  if (value !== '/' && (value.endsWith('/') || value.split('/').slice(1).some(part => !part || part === '.' || part === '..'))) return invalid();
  return value;
}
export function hostPath(root: string, relative: string): string {
  hostRoot(root); relativeFilePath(relative);
  return relative === '' ? root : root === '/' ? `/${relative}` : `${root}/${relative}`;
}
function relativeTo(root: string, absolute: unknown): string {
  if (typeof absolute !== 'string') return invalid();
  if (absolute === root) return '';
  const prefix = root === '/' ? '/' : `${root}/`;
  if (!absolute.startsWith(prefix)) return invalid();
  return relativeFilePath(absolute.slice(prefix.length), false);
}
function parentOf(relative: string): string | null {
  if (relative === '') return null;
  const index = relative.lastIndexOf('/');
  return index < 0 ? '' : relative.slice(0, index);
}
function seconds(value: unknown): string | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 253402300799) return undefined;
  return new Date(Math.floor(value * 1000)).toISOString();
}
function size(value: unknown, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > max) return invalid();
  return value;
}
export function mimeType(value: unknown): string | undefined {
  return typeof value === 'string' && value.length <= 127 && /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/u.test(value) ? value : undefined;
}

// The workspace frame shared by scope/list/recent/read (workspace_artifacts.py
// _workspace). The Mac requires source "terminal.cwd" and the serving profile echo.
function workspaceFrame(payload: Record<string, unknown>, servingProfileId: string): string {
  const workspace = object(payload.workspace);
  if (workspace.source !== 'terminal.cwd' || workspace.profileId !== servingProfileId) return invalid();
  const root = hostRoot(workspace.root);
  if (payload.root !== undefined && payload.root !== root) return invalid();
  return root;
}
// The working folder a list/recent reply names, before its entries are checked.
export function workspaceRootOf(value: unknown, servingProfileId: string): string {
  return workspaceFrame(object(value), servingProfileId);
}
export function decodeWorkspaceScope(value: unknown, servingProfileId: string): string {
  const payload = object(value);
  const root = workspaceFrame(payload, servingProfileId);
  if (payload.path !== root) return invalid();
  return root;
}

// list: one folder's direct entries. recent: newest files anywhere below the root.
// root is the scope main read for this request; a different reply is refused.
export function decodeWorkspaceListing(value: unknown, servingProfileId: string, root: string, folder: string | null): AgentFolder {
  const payload = object(value);
  if (workspaceFrame(payload, servingProfileId) !== root) return invalid();
  const recent = folder === null;
  const here = recent ? '' : relativeFilePath(folder);
  if (payload.path !== hostPath(root, here)) return invalid();
  if (!Array.isArray(payload.entries) || payload.entries.length > 2000) return invalid();
  const seen = new Set<string>();
  const entries = payload.entries.map(value => {
    const row = object(value);
    const entryName = name(row.name);
    const path = relativeTo(root, row.path);
    // A listed entry sits directly in the folder asked for; a recent one anywhere
    // below the root. Either way the path ends with the entry's own name.
    const expected = recent ? null : here === '' ? entryName : `${here}/${entryName}`;
    if ((expected !== null && path !== expected) || path.slice(path.lastIndexOf('/') + 1) !== entryName || seen.has(path)) return invalid();
    seen.add(path);
    if (typeof row.is_directory !== 'boolean' || (recent && row.is_directory)) return invalid();
    const folder = row.is_directory;
    const bytes = folder || row.size === null || row.size === undefined ? undefined : size(row.size);
    const type = folder ? undefined : mimeType(row.mime_type);
    const modifiedAt = seconds(row.mtime), createdAt = seconds(row.created);
    return Object.freeze({ name: entryName, path, folder, ...(bytes === undefined ? {} : { size: bytes }),
      ...(type === undefined ? {} : { mimeType: type }), ...(modifiedAt === undefined ? {} : { modifiedAt }),
      ...(createdAt === undefined ? {} : { createdAt }) });
  });
  return Object.freeze({ servingProfileId, folder: here, parent: recent ? null : parentOf(here), recent, entries: Object.freeze(entries) });
}

const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
export function base64Bytes(data: string): number {
  if (!BASE64.test(data)) return invalid();
  return data.length / 4 * 3 - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0);
}
// read: the whole file as a data URL. Path, size and type must match the listed
// entry, and the base64 must decode to exactly that many bytes.
export function decodeWorkspaceRead(value: unknown, servingProfileId: string, root: string, path: string,
  expected: Readonly<{ size: number; mimeType: string }>): string {
  const payload = object(value);
  if (workspaceFrame(payload, servingProfileId) !== root || payload.path !== hostPath(root, relativeFilePath(path, false))) return invalid();
  if (payload.size !== expected.size || payload.mime_type !== expected.mimeType || expected.size < 1
    || expected.size > AGENT_FILE_LIMITS.readBytes) return invalid();
  const prefix = `data:${expected.mimeType};base64,`;
  if (typeof payload.data_url !== 'string' || !payload.data_url.startsWith(prefix)) return invalid();
  const data = payload.data_url.slice(prefix.length);
  if (base64Bytes(data) !== expected.size) return invalid();
  return data;
}

// attachments/recent: {items:[{id, fileName, mimeType, byteCount, storedId, createdAt}]}.
// The chat (storedId) is not needed here and is dropped.
export function attachmentId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/u.test(value)) return invalid();
  return value;
}
export function decodeMediaList(value: unknown): AgentMediaList {
  const payload = object(value);
  if (!Array.isArray(payload.items) || payload.items.length > 36) return invalid();
  const seen = new Set<string>();
  const items = payload.items.map(value => {
    const row = object(value);
    const id = attachmentId(row.id);
    const type = mimeType(row.mimeType);
    if (seen.has(id) || type === undefined || !/^(?:image|video)\//u.test(type)) return invalid();
    seen.add(id);
    const createdAt = seconds(row.createdAt);
    return Object.freeze({ id, name: name(row.fileName), mimeType: type, size: size(row.byteCount, AGENT_FILE_LIMITS.mediaBytes),
      ...(createdAt === undefined ? {} : { createdAt }) });
  });
  return Object.freeze({ items: Object.freeze(items) });
}
// attachments/fetch: one chunk. Offsets must continue exactly where asked.
export type MediaChunk = Readonly<{ data: string; bytes: number; byteCount: number; mimeType: string; nextOffset: number | null }>;
export function decodeMediaChunk(value: unknown, id: string, offset: number): MediaChunk {
  const payload = object(value);
  if (payload.attachmentId !== id || payload.offset !== offset) return invalid();
  const byteCount = size(payload.byteCount, AGENT_FILE_LIMITS.mediaBytes);
  const type = mimeType(payload.mimeType);
  if (typeof payload.data !== 'string' || type === undefined) return invalid();
  const bytes = base64Bytes(payload.data);
  const end = offset + bytes;
  if (bytes < 1 || end > byteCount) return invalid();
  const nextOffset = payload.nextOffset === null ? null : size(payload.nextOffset);
  if (nextOffset === null ? end !== byteCount : nextOffset !== end || end >= byteCount) return invalid();
  return Object.freeze({ data: payload.data, bytes, byteCount, mimeType: type, nextOffset });
}

// Text the preview shows as plain text (never rendered as markup).
const TEXT_TYPES = new Set(['application/json', 'application/xml', 'application/yaml', 'application/x-yaml', 'application/toml',
  'application/x-sh', 'application/javascript', 'application/x-javascript', 'application/sql', 'application/x-python-code']);
const TEXT_NAMES = /\.(?:md|markdown|txt|text|json|jsonl|ya?ml|toml|ini|cfg|conf|csv|tsv|log|py|ts|tsx|js|jsx|mjs|cjs|sh|bash|zsh|rb|go|rs|java|kt|swift|c|h|cc|cpp|hpp|cs|css|scss|html?|xml|sql|r|lua|pl|php|tex|rst|org|diff|patch)$/iu;
export function textPreviewable(fileName: string, type: string): boolean {
  return type.startsWith('text/') || TEXT_TYPES.has(type) || TEXT_NAMES.test(fileName);
}
// Only raster formats an <img> shows without scripts. SVG is never an image here.
const IMAGE_SIGNATURES: Readonly<Record<string, (bytes: Uint8Array) => boolean>> = Object.freeze({
  'image/png': bytes => [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => bytes[index] === byte),
  'image/jpeg': bytes => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  'image/gif': bytes => String.fromCharCode(...bytes.slice(0, 6)) === 'GIF87a' || String.fromCharCode(...bytes.slice(0, 6)) === 'GIF89a',
  'image/webp': bytes => String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP',
});
export function imagePreviewable(type: string): boolean { return Object.hasOwn(IMAGE_SIGNATURES, type); }
// The image's own first bytes must say what the host claims.
export function imageMatches(type: string, head: Uint8Array): boolean {
  const check = IMAGE_SIGNATURES[type];
  return check !== undefined && head.length >= 12 && check(head);
}
// Strict UTF-8 text, bounded for display.
export function textPreview(bytes: Uint8Array): FilePreview {
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return Object.freeze({ kind: 'none', reason: 'not-text' }); }
  if (/[\x00-\x08\x0e-\x1f]/u.test(text.slice(0, 8192))) return Object.freeze({ kind: 'none', reason: 'not-text' });
  const limit = AGENT_FILE_LIMITS.previewCharacters;
  let shown = text.length > limit ? text.slice(0, limit) : text;
  if (shown.length && !shown.isWellFormed()) shown = shown.slice(0, -1);
  return Object.freeze({ kind: 'text', text: shown, truncated: text.length > limit });
}
