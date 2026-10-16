// The agent's Files tab through the bighelp plugin: the Hermes computer's
// working folder (native/workspace-files/*) and recent media
// (native/attachments/*). Host paths stay here; the renderer sees folder-relative
// paths. The plugin does not check these features itself, so main must.
import { Buffer } from 'node:buffer';
import { AGENT_FILE_FEATURES, AGENT_FILE_LIMITS, decodeMediaChunk, decodeMediaList, decodeWorkspaceListing, decodeWorkspaceRead,
  decodeWorkspaceScope, hostPath, imageMatches, imagePreviewable, textPreview, textPreviewable, workspaceRootOf,
} from '../../../../../packages/contracts/agent-files.ts';
import type { AgentFileEntry, AgentMediaItem, FilePreview } from '../../../../../packages/contracts/agent-files.ts';
import { HttpStatusError } from '../../../../../packages/platform/transport-policy.ts';
import type { FILES_CALLS } from '../../shared/calls/files.ts';
import type { CallContext } from './context.ts';
import { CallError } from './context.ts';
import type { CallHandlers } from './index.ts';
import type { PluginContext } from './plugin.ts';
import { nativePost, pluginAgentId, readPluginContext, requirePluginFeature } from './plugin.ts';

const LISTING_BYTES = 196_608;
// The transport's largest reply; a whole file read or one media chunk fits.
const READ_BYTES = 4 * 1024 * 1024 - 256;
const HERMES_HOME = 'native-workspace-hermes-home-v1';
const updatePlugin = 'Update the bighelp plugin on your Hermes computer, then try again.';

// WorkspaceClientError.swift workspaceFilesMessage, adapted for this app.
const WORKSPACE_MESSAGES: Readonly<Record<string, readonly [CallError['code'], string]>> = Object.freeze({
  workspace_not_configured: ['unavailable', 'This agent’s chats start in a folder that isn’t its own, like Hermes’s program folder or the computer’s top folder, so bighelp won’t show it. Make a folder named “workspace” in the agent’s Hermes folder, or choose a working folder for the agent in Hermes, then try again.'],
  workspace_in_container: ['unavailable', 'This agent works inside a container, so its files aren’t on the computer bighelp can read.'],
  workspace_on_remote: ['unavailable', 'This agent works on another computer over SSH, so its files aren’t on the computer bighelp can read.'],
  workspace_windows_unsupported: ['unsupported', 'bighelp can’t show an agent’s files from a Windows Hermes computer yet.'],
  workspace_hermes_folder: ['unavailable', 'This agent works in Hermes’s own folder, which holds its settings and keys, so bighelp won’t show it. Make a folder named “workspace” in it for the agent’s files, then try again.'],
  workspace_unavailable: ['unavailable', 'This agent’s working folder is missing on its computer, or Hermes can’t open it.'],
  workspace_config_invalid: ['unavailable', 'Hermes can’t read this agent’s settings (config.yaml) on its computer. Fix them there, then try again.'],
  workspace_identity_changed: ['conflict', 'This agent’s working folder just changed. Try again.'],
  workspace_changed: ['conflict', 'This agent’s working folder just changed. Try again.'],
  workspace_identity_unavailable: ['unsupported', 'This computer’s Hermes can’t share an agent’s files yet. Update Hermes and the bighelp plugin.'],
  workspace_files_unavailable: ['unsupported', 'This computer’s Hermes can’t share an agent’s files yet. Update Hermes and the bighelp plugin.'],
  secure_traversal_unavailable: ['unsupported', 'This computer’s Hermes can’t share files safely on its system.'],
  path_outside_workspace: ['invalid', 'That file is outside the agent’s working folder.'],
  invalid_path: ['invalid', 'That file name can’t be opened here.'],
  file_not_found: ['stale', 'That file or folder is no longer there. Refresh to see the latest.'],
  unsafe_workspace_path: ['unavailable', 'Hermes can’t open that safely. It may be a link or a special file.'],
  workspace_unreadable: ['unavailable', 'Hermes can’t read that folder or file on its computer.'],
  file_changed: ['conflict', 'That file changed while it was being read. Try again.'],
  directory_too_large: ['invalid', 'This folder has more than 2,000 items, too many to show here.'],
  file_too_large: ['invalid', 'This file is empty or too large to open here.'],
  payload_too_large: ['invalid', 'That is too large to show here.'],
  attachment_unavailable: ['stale', 'That file is no longer available. Refresh to see the latest.'],
  media_unavailable: ['unsupported', `This computer can’t share recent pictures and videos yet. ${updatePlugin}`],
  attachments_unavailable: ['unsupported', `This computer can’t share pictures and videos yet. ${updatePlugin}`],
  profile_not_found: ['stale', 'That agent is no longer on your computer.'],
});
function refusal(error: unknown, plugin?: PluginContext): never {
  if (error instanceof HttpStatusError) {
    // The plugin cannot find hosted Hermes' workspace folder: older plugin, or
    // one Hermes hasn't restarted to load (DirectHermesArtifactClient.swift:131).
    if ((error.code === 'workspace_not_configured' || error.code === 'workspace_hermes_folder') && plugin && !plugin.features.includes(HERMES_HOME)) {
      throw new CallError('unsupported', 'bighelp needs the newest bighelp plugin on your Hermes computer to find this agent’s folder. Update it there. If it’s already up to date, restart Hermes to finish the update, then try again.');
    }
    const known = WORKSPACE_MESSAGES[error.code];
    if (known) throw new CallError(known[0], known[1]);
  }
  throw error;
}
function decoded<T>(decode: () => T): T {
  try { return decode(); } catch { throw new CallError('unavailable', 'The bighelp plugin on your computer sent an unexpected reply. Try again.'); }
}

type Serving = PluginContext & Readonly<{ servingProfileId: string }>;
async function workspacePlugin(context: CallContext, profile: string, recent = false): Promise<Serving> {
  context.requireProfile(profile);
  // No fallback to stock /api/files: the Mac app does not use it for this tab either.
  const plugin = await readPluginContext(context);
  if (!plugin) throw new CallError('unsupported', 'Files need the bighelp plugin on your Hermes computer.');
  if (!plugin.features.includes(AGENT_FILE_FEATURES.files)) {
    throw new CallError('unsupported', 'The bighelp plugin on your Hermes computer doesn’t share workspace files yet. Update it there, then try again.');
  }
  if (recent && !plugin.features.includes(AGENT_FILE_FEATURES.recent)) throw new CallError('unsupported', updatePlugin);
  const serving = plugin.servingProfileId;
  if (serving === null) throw new CallError('unsupported', 'This computer’s Hermes can’t share an agent’s files yet. Update Hermes and the bighelp plugin.');
  return Object.freeze({ ...plugin, servingProfileId: serving });
}
async function workspace(context: CallContext, plugin: Serving, operation: 'scope' | 'list' | 'recent' | 'read', path: string | null,
  maxBytes: number): Promise<unknown> {
  try { return await nativePost(context, plugin, `workspace-files/${operation}`, { path }, maxBytes, false); }
  catch (error) { return refusal(error, plugin); }
}
async function scopeRoot(context: CallContext, plugin: Serving): Promise<string> {
  const body = await workspace(context, plugin, 'scope', null, LISTING_BYTES);
  return decoded(() => decodeWorkspaceScope(body, plugin.servingProfileId));
}
// The Mac re-reads the scope and lists the parent folder before every open, so
// only a file that is still listed, with its listed size and type, is read.
async function locate(context: CallContext, plugin: Serving, path: string): Promise<Readonly<{ root: string; entry: AgentFileEntry }>> {
  const root = await scopeRoot(context, plugin);
  const slash = path.lastIndexOf('/');
  const folder = slash < 0 ? '' : path.slice(0, slash);
  const body = await workspace(context, plugin, 'list', hostPath(root, folder), LISTING_BYTES);
  const listing = decoded(() => decodeWorkspaceListing(body, plugin.servingProfileId, root, folder));
  const entry = listing.entries.find(row => row.path === path);
  if (!entry) throw new CallError('stale', 'That file is no longer there. Refresh to see the latest.');
  if (entry.folder) throw new CallError('invalid', 'That is a folder, not a file.');
  return Object.freeze({ root, entry });
}
function readable(entry: AgentFileEntry): entry is AgentFileEntry & Readonly<{ size: number; mimeType: string }> {
  return entry.size !== undefined && entry.mimeType !== undefined && entry.size >= 1 && entry.size <= AGENT_FILE_LIMITS.readBytes;
}
async function readBytes(context: CallContext, plugin: Serving, root: string, entry: AgentFileEntry & Readonly<{ size: number; mimeType: string }>): Promise<string> {
  const body = await workspace(context, plugin, 'read', hostPath(root, entry.path), READ_BYTES);
  return decoded(() => decodeWorkspaceRead(body, plugin.servingProfileId, root, entry.path, entry));
}
function preview(type: string, data: string, fileName: string): FilePreview {
  const bytes = Buffer.from(data, 'base64');
  if (imagePreviewable(type)) {
    return imageMatches(type, bytes.subarray(0, 16)) ? Object.freeze({ kind: 'image', dataUrl: `data:${type};base64,${data}` })
      : Object.freeze({ kind: 'none', reason: 'not-previewable' });
  }
  return textPreviewable(fileName, type) ? textPreview(bytes) : Object.freeze({ kind: 'none', reason: 'not-previewable' });
}
const tooLarge = () => new CallError('invalid', 'Files over 3 MB can’t be opened or saved here yet.');

// Media: this agent's own pictures and videos, by opaque attachment ID.
async function mediaPlugin(context: CallContext, profile: string): Promise<Readonly<{ plugin: PluginContext; agentId: string }>> {
  const agentId = pluginAgentId(context, profile);
  const plugin = await requirePluginFeature(context, AGENT_FILE_FEATURES.attachments);
  if (!plugin.features.includes(AGENT_FILE_FEATURES.media)) throw new CallError('unsupported', updatePlugin);
  return Object.freeze({ plugin, agentId });
}
async function attachments(context: CallContext, plugin: PluginContext, operation: 'recent' | 'fetch', body: Readonly<Record<string, unknown>>): Promise<unknown> {
  try { return await nativePost(context, plugin, `attachments/${operation}`, body, operation === 'fetch' ? READ_BYTES : LISTING_BYTES, false); }
  catch (error) { return refusal(error); }
}
async function mediaList(context: CallContext, plugin: PluginContext, agentId: string) {
  const body = await attachments(context, plugin, 'recent', { agentId, limit: 36 });
  return decoded(() => decodeMediaList(body));
}
async function mediaItem(context: CallContext, profile: string, id: string): Promise<Readonly<{ plugin: PluginContext; agentId: string; item: AgentMediaItem }>> {
  const { plugin, agentId } = await mediaPlugin(context, profile);
  const item = (await mediaList(context, plugin, agentId)).items.find(row => row.id === id);
  if (!item) throw new CallError('stale', 'That file is no longer in Media. Refresh to see the latest.');
  return Object.freeze({ plugin, agentId, item });
}
// Every chunk in order, each continuing where the last ended, within the listed size.
async function mediaBytes(context: CallContext, plugin: PluginContext, agentId: string, item: AgentMediaItem): Promise<Uint8Array> {
  const parts: Buffer[] = [];
  let offset: number | null = 0, total = 0;
  for (let index = 0; offset !== null; index++) {
    if (index >= 16) throw new CallError('unavailable', 'The bighelp plugin on your computer sent an unexpected reply. Try again.');
    const at: number = offset;
    const body = await attachments(context, plugin, 'fetch', { agentId, attachmentId: item.id, offset: at });
    const chunk = decoded(() => decodeMediaChunk(body, item.id, at));
    if (chunk.byteCount !== item.size || chunk.mimeType !== item.mimeType) throw new CallError('conflict', 'That file changed. Refresh and try again.');
    parts.push(Buffer.from(chunk.data, 'base64')); total += chunk.bytes; offset = chunk.nextOffset;
  }
  const bytes = Buffer.concat(parts, total);
  if (bytes.byteLength !== item.size) throw new CallError('unavailable', 'The bighelp plugin on your computer sent an unexpected reply. Try again.');
  return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}
function saver(context: CallContext): NonNullable<CallContext['saveCopy']> {
  if (!context.saveCopy) throw new CallError('unsupported', 'Saving files isn’t available in this window.');
  return context.saveCopy;
}

export const FILES_HANDLERS: Pick<CallHandlers, keyof typeof FILES_CALLS> = Object.freeze({
  'files.list': {
    mutation: false,
    async run(context, input) {
      const plugin = await workspacePlugin(context, input.profile);
      if (input.folder === '') {
        // The root listing names its own root; no separate scope read needed.
        const body = await workspace(context, plugin, 'list', null, LISTING_BYTES);
        return decoded(() => decodeWorkspaceListing(body, plugin.servingProfileId, workspaceRootOf(body, plugin.servingProfileId), ''));
      }
      const root = await scopeRoot(context, plugin);
      const body = await workspace(context, plugin, 'list', hostPath(root, input.folder), LISTING_BYTES);
      return decoded(() => decodeWorkspaceListing(body, plugin.servingProfileId, root, input.folder));
    },
  },
  'files.recent': {
    mutation: false,
    async run(context, input) {
      const plugin = await workspacePlugin(context, input.profile, true);
      const body = await workspace(context, plugin, 'recent', null, LISTING_BYTES);
      return decoded(() => decodeWorkspaceListing(body, plugin.servingProfileId, workspaceRootOf(body, plugin.servingProfileId), null));
    },
  },
  'files.preview': {
    mutation: false,
    async run(context, input) {
      const plugin = await workspacePlugin(context, input.profile);
      const { root, entry } = await locate(context, plugin, input.path);
      const mimeType = entry.mimeType ?? 'application/octet-stream';
      const base = { servingProfileId: plugin.servingProfileId, name: entry.name, path: entry.path, size: entry.size ?? 0, mimeType,
        ...(entry.modifiedAt === undefined ? {} : { modifiedAt: entry.modifiedAt }), saveable: readable(entry) };
      const none = (reason: 'empty' | 'too-large' | 'not-previewable') => Object.freeze({ ...base, preview: Object.freeze({ kind: 'none' as const, reason }) });
      if (entry.size === 0) return none('empty');
      if (!imagePreviewable(mimeType) && !textPreviewable(entry.name, mimeType)) return none('not-previewable');
      if (!readable(entry)) return none('too-large');
      const data = await readBytes(context, plugin, root, entry);
      return Object.freeze({ ...base, preview: preview(mimeType, data, entry.name) });
    },
  },
  'files.save': {
    mutation: false,
    async run(context, input) {
      const plugin = await workspacePlugin(context, input.profile);
      const { entry } = await locate(context, plugin, input.path);
      if (!readable(entry)) throw tooLarge();
      const fileName = await saver(context)(entry.name, async () => {
        // The dialog can stay open a while: read the context and listing again.
        const fresh = await workspacePlugin(context, input.profile);
        const current = await locate(context, fresh, input.path);
        if (!readable(current.entry)) throw tooLarge();
        return Buffer.from(await readBytes(context, fresh, current.root, current.entry), 'base64');
      });
      return fileName === null ? Object.freeze({ saved: false }) : Object.freeze({ saved: true, fileName });
    },
  },
  'media.list': {
    mutation: false,
    async run(context, input) {
      const { plugin, agentId } = await mediaPlugin(context, input.profile);
      return mediaList(context, plugin, agentId);
    },
  },
  'media.preview': {
    mutation: false,
    async run(context, input) {
      const { plugin, agentId, item } = await mediaItem(context, input.profile, input.id);
      const base = { id: item.id, mimeType: item.mimeType, size: item.size, saveable: item.size >= 1 };
      if (!imagePreviewable(item.mimeType)) return Object.freeze({ ...base, preview: Object.freeze({ kind: 'none' as const, reason: 'not-previewable' as const }) });
      if (item.size < 1 || item.size > AGENT_FILE_LIMITS.readBytes) return Object.freeze({ ...base, preview: Object.freeze({ kind: 'none' as const, reason: 'too-large' as const }) });
      const bytes = await mediaBytes(context, plugin, agentId, item);
      return Object.freeze({ ...base, preview: preview(item.mimeType, Buffer.from(bytes).toString('base64'), item.name) });
    },
  },
  'media.save': {
    mutation: false,
    async run(context, input) {
      const { item } = await mediaItem(context, input.profile, input.id);
      if (item.size < 1) throw new CallError('invalid', 'This file is empty.');
      const fileName = await saver(context)(item.name, async () => {
        const fresh = await mediaItem(context, input.profile, input.id);
        return mediaBytes(context, fresh.plugin, fresh.agentId, fresh.item);
      });
      return fileName === null ? Object.freeze({ saved: false }) : Object.freeze({ saved: true, fileName });
    },
  },
});
