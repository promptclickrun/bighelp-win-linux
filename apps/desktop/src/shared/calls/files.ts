// The agent's Files tab. Reads only, plus Save a copy: main shows the system
// Save dialog and writes bytes it fetched itself. The renderer names a file by
// its place in the working folder (or a media ID), never a path on this computer.
import type { AgentFilePreview, AgentFolder, AgentMediaList, AgentMediaPreview, SaveResult } from '../../../../../packages/contracts/agent-files.ts';
import { attachmentId, relativeFilePath } from '../../../../../packages/contracts/agent-files.ts';
import { defineCall } from '../call.ts';
import { InvalidInput, fields, identifier } from '../validate.ts';

function folderPath(value: unknown, allowRoot: boolean): string {
  try { return relativeFilePath(value, allowRoot); } catch { throw new InvalidInput(); }
}
function mediaId(value: unknown): string {
  try { return attachmentId(value); } catch { throw new InvalidInput(); }
}
const profileOnly = (input: unknown) => Object.freeze({ profile: identifier(fields(input, ['profile']).profile, 128) });
const file = (input: unknown) => {
  const value = fields(input, ['profile', 'path']);
  return Object.freeze({ profile: identifier(value.profile, 128), path: folderPath(value.path, false) });
};
const media = (input: unknown) => {
  const value = fields(input, ['profile', 'id']);
  return Object.freeze({ profile: identifier(value.profile, 128), id: mediaId(value.id) });
};

export const FILES_CALLS = Object.freeze({
  // One folder of the working folder; "" is the folder itself.
  'files.list': defineCall<AgentFolder>()(input => {
    const value = fields(input, ['profile', 'folder']);
    return Object.freeze({ profile: identifier(value.profile, 128), folder: folderPath(value.folder, true) });
  }),
  // Files the agent made or changed lately, newest first.
  'files.recent': defineCall<AgentFolder>()(profileOnly),
  'files.preview': defineCall<AgentFilePreview>()(file),
  'files.save': defineCall<SaveResult>()(file),
  // Pictures and videos this agent sent or made.
  'media.list': defineCall<AgentMediaList>()(profileOnly),
  'media.preview': defineCall<AgentMediaPreview>()(media),
  'media.save': defineCall<SaveResult>()(media),
});
