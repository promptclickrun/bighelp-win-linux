// Files chosen for one message. Limits follow the shipping Mac app (HERMES_API.md
// §7): at most 10 files, 8 MiB each, 24 MiB together. Bytes stay in main.
export const ATTACHMENT_LIMITS = Object.freeze({ count: 10, fileBytes: 8 * 1024 * 1024, totalBytes: 24 * 1024 * 1024, nameCharacters: 180 });
// Images Hermes accepts by extension on image.attach_bytes; others go as files.
const IMAGE_TYPES: Readonly<Record<string, string>> = Object.freeze({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' });
const FILE_TYPES: Readonly<Record<string, string>> = Object.freeze({
  pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', tsv: 'text/tab-separated-values', json: 'application/json',
  html: 'text/html', xml: 'application/xml', yaml: 'application/yaml', yml: 'application/yaml', log: 'text/plain', zip: 'application/zip',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
});

export type StagedFile = Readonly<{ id: string; name: string; bytes: Uint8Array; kind: 'image' | 'file'; mime: string }>;

// A safe display/upload name: no separators or control characters, 1–180 chars.
export function attachmentName(raw: string): string {
  const base = raw.split(/[\\/]/u).pop() ?? '';
  const cleaned = base.replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩<>:"|?*]+/gu, '_').replace(/^\.+/u, '').trim();
  const name = cleaned.length > ATTACHMENT_LIMITS.nameCharacters ? cleaned.slice(cleaned.length - ATTACHMENT_LIMITS.nameCharacters) : cleaned;
  return name && !/^[_.\s]*$/u.test(name) ? name : 'attachment';
}

export function classify(name: string): Readonly<{ kind: 'image' | 'file'; mime: string }> {
  const extension = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  if (IMAGE_TYPES[extension]) return { kind: 'image', mime: IMAGE_TYPES[extension]! };
  return { kind: 'file', mime: FILE_TYPES[extension] ?? (/^(?:ts|tsx|js|mjs|py|rs|go|java|c|h|cpp|cs|rb|php|sh|ps1|sql|toml|ini|css|swift|kt)$/u.test(extension) ? 'text/plain' : 'application/octet-stream') };
}

// Admit new files to an existing selection, or explain the first problem.
export function admit(existing: readonly StagedFile[], incoming: readonly Readonly<{ name: string; bytes: Uint8Array }>[], nextId: () => string):
  Readonly<{ files: readonly StagedFile[]; problem: string }> {
  const files = [...existing];
  let total = files.reduce((sum, file) => sum + file.bytes.byteLength, 0);
  for (const input of incoming) {
    const name = attachmentName(input.name);
    if (files.length >= ATTACHMENT_LIMITS.count) return { files, problem: 'You can add up to 10 files to one message.' };
    if (input.bytes.byteLength === 0) return { files, problem: `${name} is empty.` };
    if (input.bytes.byteLength > ATTACHMENT_LIMITS.fileBytes || total + input.bytes.byteLength > ATTACHMENT_LIMITS.totalBytes) {
      return { files, problem: 'Each attachment can be up to 8 MB, with up to 24 MB in one message.' };
    }
    total += input.bytes.byteLength;
    files.push(Object.freeze({ id: nextId(), name, bytes: input.bytes, ...classify(name) }));
  }
  return { files, problem: '' };
}

// The @file: reference Hermes returned, checked before it is added to the prompt.
export function referenceText(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (row.attached !== true || typeof row.ref_text !== 'string' || !row.ref_text.startsWith('@file:') || row.ref_text.length > 4096
    || /[\r\n\u0000]/u.test(row.ref_text)) return null;
  return row.ref_text;
}
