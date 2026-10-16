// Hermes projects (projects.* JSON-RPC). A project groups chats around folders on
// the Hermes computer. Folder paths are host paths: POSIX, never this device's.
import { boundedString, encodeBoundedJson } from './rpc.ts';

export type Project = Readonly<{
  id: string; name: string; description: string | null; archived: boolean;
  primaryPath: string | null;
  folders: readonly Readonly<{ path: string; primary: boolean }>[];
}>;
export type ProjectList = Readonly<{ projects: readonly Project[]; activeId: string | null }>;

const invalid = (): never => { throw new TypeError('Invalid project response'); };
function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
const UNSAFE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/u;
function text(value: unknown, max: number, empty = false): string {
  const result = boundedString(value, max);
  if ((!empty && !result.trim()) || UNSAFE.test(result)) return invalid();
  return result;
}
export function projectId(value: unknown): string {
  const result = text(value, 128);
  if (!/^[A-Za-z0-9_.:-]+$/u.test(result)) return invalid();
  return result;
}
function path(value: unknown): string {
  const result = text(value, 4096);
  if (/[\n\r\t]/u.test(result)) return invalid();
  return result;
}

export function decodeProject(value: unknown): Project {
  const row = object(value);
  if (typeof row.archived !== 'boolean') return invalid();
  const folders = (row.folders === undefined || row.folders === null ? [] : Array.isArray(row.folders) && row.folders.length <= 100 ? row.folders : invalid())
    .map(entry => { const folder = object(entry); return Object.freeze({ path: path(folder.path), primary: folder.is_primary === true }); });
  if (new Set(folders.map(folder => folder.path)).size !== folders.length) return invalid();
  const description = row.description === undefined || row.description === null ? null : text(row.description, 8192, true);
  return Object.freeze({
    id: projectId(row.id), name: text(row.name, 400), description: description?.trim() ? description : null,
    archived: row.archived, primaryPath: row.primary_path === undefined || row.primary_path === null ? null : path(row.primary_path),
    folders: Object.freeze(folders),
  });
}

// projects.list and projects.archive: every project, archived included. The
// active pointer may name an archived or deleted project; it is shown as is.
export function decodeProjectList(value: unknown): ProjectList {
  encodeBoundedJson(value, 4 * 1024 * 1024);
  const payload = object(value);
  if (!Array.isArray(payload.projects) || payload.projects.length > 1000) return invalid();
  const projects = payload.projects.map(decodeProject);
  if (new Set(projects.map(project => project.id)).size !== projects.length) return invalid();
  const activeId = payload.active_id === null || payload.active_id === undefined ? null : projectId(payload.active_id);
  return Object.freeze({ projects: Object.freeze(projects), activeId });
}

// POSIX normalization like the host's os.path.abspath for an absolute path:
// collapse repeated and trailing separators, '.' and '..'. Used only to compare
// the saved folder with what was asked for.
export function hostFolder(value: string): string | null {
  if (!value.startsWith('/')) return null;
  const parts: string[] = [];
  for (const part of value.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop(); else parts.push(part);
  }
  return `/${parts.join('/')}`;
}
