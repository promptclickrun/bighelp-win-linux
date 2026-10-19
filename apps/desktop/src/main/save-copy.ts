// Save a copy: the one place bighelp writes a host file to this computer. The
// person picks the place in the system Save dialog; main then fetches the bytes
// itself and writes them. The renderer supplies neither a path nor bytes.
// Electron is injected (main.ts) so this stays testable under plain Node.
import { randomUUID } from 'node:crypto';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { CallError } from './calls/context.ts';

export type SaveDialog = (options: Readonly<{ title: string; defaultPath: string; buttonLabel: string }>) =>
  Promise<Readonly<{ canceled: boolean; filePath?: string | undefined }>>;
export type SaveFiles = Readonly<{
  writeFile(path: string, bytes: Uint8Array, options: Readonly<{ flag: 'wx' }>): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  rm(path: string, options: Readonly<{ force: true }>): Promise<void>;
}>;

const RESERVED = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\..*)?$/iu;
// A host-supplied file name made safe as a suggestion on Windows, macOS and Linux.
export function safeFileName(value: unknown): string {
  let name = typeof value === 'string' && value.isWellFormed() ? value : '';
  name = name.replace(/[\x00-\x1f\x7f-\x9f‪-‮⁦-⁩]/gu, '').replace(/[/\\:*?"<>|]/gu, '_')
    .replace(/^[\s.]+|[\s.]+$/gu, '');
  if (name.length > 120) {
    const dot = name.lastIndexOf('.');
    const extension = dot > 0 && name.length - dot <= 16 ? name.slice(dot) : '';
    name = name.slice(0, 120 - extension.length).replace(/[\s.]+$/u, '') + extension;
  }
  if (!name) return 'file';
  return RESERVED.test(name) ? `_${name}` : name;
}

export function createSaveCopy(adapters: Readonly<{ showSaveDialog: SaveDialog; downloads: () => string; files: SaveFiles }>) {
  // Resolves the saved file's name, or null when the person cancels. Nothing is
  // fetched before they choose, and a failed fetch leaves no file behind.
  return async function saveCopy(suggestedName: string, read: () => Promise<Uint8Array>): Promise<string | null> {
    const choice = await adapters.showSaveDialog({ title: 'Save a copy', buttonLabel: 'Save',
      defaultPath: join(adapters.downloads(), safeFileName(suggestedName)) });
    if (choice.canceled || !choice.filePath) return null;
    const target = choice.filePath;
    if (!isAbsolute(target)) throw new CallError('invalid', 'Choose a folder on this computer and try again.');
    const bytes = await read();
    const partial = join(dirname(target), `.${basename(target)}.${randomUUID()}.part`);
    try {
      await adapters.files.writeFile(partial, bytes, { flag: 'wx' });
      await adapters.files.rename(partial, target);
    } catch {
      await adapters.files.rm(partial, { force: true }).catch(() => {});
      throw new CallError('unavailable', 'Could not save the file there. Choose another folder and try again.');
    }
    return basename(target);
  };
}
