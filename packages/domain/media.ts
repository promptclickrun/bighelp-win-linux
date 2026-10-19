// Agent-delivered files: whole lines `MEDIA:<absolute path>` in assistant text
// (HERMES_API.md §7; Mac DirectHermesGeneratedMediaClient grammar). The line is
// removed from the reply and shown as a tile. Paths stay in main; the window
// gets an opaque reference only.
export type MediaKind = 'image' | 'video' | 'file';
export type MediaRef = Readonly<{ ref: string; name: string; kind: MediaKind }>;

const IMAGE = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp']);
const VIDEO = new Set(['mp4', 'm4v', 'mov', 'webm']);
const FILE = new Set(['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'md', 'csv', 'tsv', 'rtf', 'odt', 'ods', 'odp', 'epub', 'zip',
  'mp3', 'm4a', 'wav', 'ogg', 'flac', 'aac', 'ico', 'svg']);
const LINE = /^MEDIA:(.+)$/u;

export function mediaPath(raw: string): Readonly<{ path: string; name: string; kind: MediaKind }> | null {
  const path = raw.trim().replace(/^[`'"]|[`'"]$/gu, '');
  if (!path || new TextEncoder().encode(path).byteLength > 4096 || /[\u0000-\u001f\u007f‪-‮⁦-⁩]/u.test(path)) return null;
  const absolute = path.startsWith('/') || /^[A-Za-z]:[\\/]/u.test(path);
  if (!absolute || path.includes('//') || /(?:^|[\\/])\.{1,2}(?:[\\/]|$)/u.test(path)) return null;
  const name = path.split(/[\\/]/u).pop() ?? '';
  const extension = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  const kind: MediaKind | null = IMAGE.has(extension) ? 'image' : VIDEO.has(extension) ? 'video' : FILE.has(extension) ? 'file' : null;
  return kind && name ? Object.freeze({ path, name, kind }) : null;
}

// FNV-1a: a stable, non-secret reference for a path within one chat view.
export function mediaRef(path: string): string {
  let hash = 0x811c9dc5;
  for (const character of path) { hash ^= character.codePointAt(0)!; hash = Math.imul(hash, 0x01000193) >>> 0; }
  return `media-${hash.toString(16).padStart(8, '0')}-${path.length.toString(16)}`;
}

export type MediaRecorder = (path: string) => string;

// Remove MEDIA lines from a reply; record each path and return display tiles.
export function extractMedia(text: string, record: MediaRecorder = mediaRef): Readonly<{ text: string; media: readonly MediaRef[] }> {
  if (!text.includes('MEDIA:')) return { text, media: [] };
  const media: MediaRef[] = [];
  const kept = text.split('\n').filter(line => {
    const match = LINE.exec(line.trim());
    if (!match) return true;
    const found = mediaPath(match[1]!);
    if (found && media.length < 16) media.push(Object.freeze({ ref: record(found.path), name: found.name.slice(0, 180), kind: found.kind }));
    return !found;
  });
  return { text: kept.join('\n').replace(/\n{3,}/gu, '\n\n').trim(), media: Object.freeze(media) };
}
