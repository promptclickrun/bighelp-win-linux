// Projects on the connected computer. Each agent (profile) has its own list.
// Nothing here calls a model. Hard delete is deliberately not offered.
import type { Project, ProjectList } from '../../../../../packages/contracts/projects.ts';
import { defineCall } from '../call.ts';
import { InvalidInput, boolean, fields, identifier, optional, text } from '../validate.ts';
import { profileName } from './schedules.ts';

export type ProjectsView = Readonly<{ profile: string } & ProjectList>;
export type ProjectSaved = Readonly<{ profile: string; project: Project; current: boolean; notes: readonly string[] }>;

const projectRef = (value: unknown) => {
  const result = identifier(value, 128);
  if (!/^[A-Za-z0-9_.:-]+$/u.test(result)) throw new InvalidInput();
  return result;
};
const projectName = (value: unknown) => {
  const result = text(value, { max: 160 }).trim();
  if (!result) throw new InvalidInput();
  return result;
};
const description = (value: unknown) => text(value, { max: 2000, min: 0, multiline: true }).trim();
// A folder on the Hermes computer: an absolute POSIX path or one under the host
// home (~). Hermes on Linux and macOS uses '/', even when this device is Windows.
export function hostFolderInput(value: unknown): string {
  const result = text(value, { max: 4096 }).trim();
  if (!(result.startsWith('/') || result === '~' || result.startsWith('~/')) || result.includes('\\')) throw new InvalidInput();
  return result;
}

export const PROJECT_CALLS = Object.freeze({
  'projects.list': defineCall<ProjectsView>()(input => {
    const value = fields(input, ['profile']);
    return Object.freeze({ profile: profileName(value.profile) });
  }),
  'projects.create': defineCall<ProjectSaved>()(input => {
    const value = fields(input, ['profile', 'name', 'folder'], ['description']);
    const about = optional(value.description, description);
    return Object.freeze({ profile: profileName(value.profile), name: projectName(value.name), folder: hostFolderInput(value.folder),
      ...(about ? { description: about } : {}) });
  }),
  'projects.update': defineCall<ProjectSaved>()(input => {
    const value = fields(input, ['profile', 'id'], ['name', 'description']);
    if (value.name === undefined && value.description === undefined) throw new InvalidInput();
    const name = optional(value.name, projectName), about = optional(value.description, description);
    return Object.freeze({ profile: profileName(value.profile), id: projectRef(value.id),
      ...(name === undefined ? {} : { name }), ...(about === undefined ? {} : { description: about }) });
  }),
  'projects.makeCurrent': defineCall<Readonly<{ profile: string; activeId: string }>>()(input => {
    const value = fields(input, ['profile', 'id']);
    return Object.freeze({ profile: profileName(value.profile), id: projectRef(value.id) });
  }),
  'projects.archive': defineCall<ProjectsView>()(input => {
    const value = fields(input, ['profile', 'id', 'archived']);
    return Object.freeze({ profile: profileName(value.profile), id: projectRef(value.id), archived: boolean(value.archived) });
  }),
});
