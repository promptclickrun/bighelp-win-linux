// Projects for one agent: the approved list/detail layout with create, rename and
// description, make current, archive and restore. Folders live on the Hermes
// computer. Nothing here calls a model.
import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import { View } from 'react-native-web';
import type { Project } from '../../contracts/projects.ts';
import type { ProjectSaved, ProjectsView } from '../../../apps/desktop/src/shared/calls/projects.ts';
import { useCall, useQuery } from '../host.tsx';
import { PLACE_TITLES } from './ContextList.tsx';
import { Banner, Button, ConfirmDialog, Dialog, TextField } from './controls.tsx';
import type { BannerTone } from './controls.tsx';
import { Fact, FunctionDetail, FunctionList, pageMessage, useAgentChoice } from './FunctionLayout.tsx';
import type { FunctionPageProps, ListRow } from './FunctionLayout.tsx';
import { Label } from './primitives.tsx';

const ABOUT = 'A project keeps related chats and folders together.';
type Notice = Readonly<{ profile: string; id: string | null; tone: BannerTone; text: string }>;
type Editing = Readonly<{ mode: 'new' }> | Readonly<{ mode: 'edit'; project: Project }>;

export function projectState(project: Project, activeId: string | null): string {
  return project.archived ? 'Archived' : project.id === activeId ? 'Current project' : 'Not current';
}
const validFolder = (value: string) => { const folder = value.trim(); return folder.startsWith('/') || folder === '~' || folder.startsWith('~/'); };

export function ProjectsPage(props: FunctionPageProps): JSX.Element {
  const [profile, setProfile] = useAgentChoice(props.data.agents);
  const call = useCall();
  const nerd = props.snapshot?.preferences?.nerdMode === true;
  const list = useQuery('projects.list', profile ? { profile } : null);
  // A write returns the fresh list (archive); prefer it until the next read lands.
  const [written, setWritten] = useState<ProjectsView | null>(null);
  // An explicit Refresh hides the old list until a new answer arrives.
  const [retired, setRetired] = useState<unknown>(null);
  const current = written?.profile === profile ? written : list.value?.profile === profile && list.value !== retired ? list.value : null;
  useEffect(() => { setWritten(null); }, [list.value]);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = current?.projects.find(project => project.id === selectedId);
  useEffect(() => { if (selectedId !== null && current && !selected) setSelectedId(null); }, [selectedId, current, selected]);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [archiving, setArchiving] = useState<Project | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [archiveError, setArchiveError] = useState('');
  const [notice, setNotice] = useState<Notice | null>(null);
  const connected = props.snapshot?.status === 'connected' && !!props.api;
  const title = PLACE_TITLES.projects;
  const agentName = props.data.agents.find(agent => agent.id === profile)?.name ?? 'this agent';
  const unsupported = list.status === 'failed' && list.code === 'unsupported' && !current;
  let message = pageMessage({ connected, agents: props.data.agents.length, profile, title, status: list.status, loaded: !!current,
    code: list.code, failure: list.message });
  if (message === null && current?.projects.length === 0) message = 'No projects yet. Make one for anything you come back to: an app, a trip, your home.';
  const ordered = [...(current?.projects ?? [])].sort((a, b) => Number(a.archived) - Number(b.archived));
  const rows: ListRow[] = ordered.map(project => {
    const state = projectState(project, current?.activeId ?? null);
    return { id: project.id, title: project.name, subtitle: state, search: [project.name, project.description, state, ...project.folders.map(folder => folder.path)].join(' ') };
  });
  const shownNotice = notice && notice.profile === profile && (notice.id === null || notice.id === selected?.id) ? notice : null;

  async function makeCurrent(project: Project, owner: string): Promise<void> {
    setBusy('Making it the current project…'); setNotice(null);
    const result = await call('projects.makeCurrent', { profile: owner, id: project.id });
    setBusy(null);
    setNotice(result.ok ? { profile: owner, id: project.id, tone: 'success', text: `“${project.name}” is now the current project.` }
      : { profile: owner, id: project.id, tone: result.code === 'unknown' ? 'warn' : 'error', text: result.message });
    list.reload();
  }
  async function setArchived(project: Project, owner: string, archived: boolean): Promise<void> {
    setBusy(archived ? 'Archiving…' : 'Restoring…');
    if (archived) setArchiveError(''); else setNotice(null);
    const result = await call('projects.archive', { profile: owner, id: project.id, archived });
    setBusy(null);
    if (result.ok) {
      setWritten(result.value); setArchiving(null);
      setNotice({ profile: owner, id: project.id, tone: 'success', text: archived ? 'Archived. Its chats and folders stay on your computer.' : 'Restored.' });
    } else if (archived) setArchiveError(result.message);
    else setNotice({ profile: owner, id: project.id, tone: result.code === 'unknown' ? 'warn' : 'error', text: result.message });
    list.reload();
  }
  function saved(value: ProjectSaved, mode: Editing['mode']): void {
    setEditing(null); setSelectedId(value.project.id);
    const done = mode === 'new' ? `Created “${value.project.name}”.${value.current ? ' It is now the current project.' : ''}` : 'Saved.';
    setNotice({ profile: value.profile, id: value.project.id, tone: value.notes.length ? 'warn' : 'success', text: [done, ...value.notes].join(' ') });
    // Wait for the list that contains the saved project before showing it selected.
    if (!current?.projects.some(row => row.id === value.project.id)) { setWritten(null); setRetired(list.value); }
    list.reload();
  }

  const detail = selected && profile ? <View style={{ gap: 20 }}>
    {busy ? <Banner tone="info" text={busy} /> : shownNotice ? <Banner tone={shownNotice.tone} text={shownNotice.text} /> : null}
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {!selected.archived && selected.id !== current?.activeId ? <Button label="Make current" tone="primary" disabled={busy !== null}
        accessibleLabel={`Make ${selected.name} the current project`} onPress={() => { void makeCurrent(selected, profile); }} /> : null}
      <Button label="Edit" disabled={busy !== null} accessibleLabel={`Edit ${selected.name}`} onPress={() => setEditing({ mode: 'edit', project: selected })} />
      {selected.archived ? <Button label="Restore" disabled={busy !== null} accessibleLabel={`Restore ${selected.name}`}
        onPress={() => { void setArchived(selected, profile, false); }} />
        : <Button label="Archive" tone="quiet" disabled={busy !== null} accessibleLabel={`Archive ${selected.name}`}
          onPress={() => { setArchiveError(''); setArchiving(selected); }} />}
    </View>
    <Fact label="Status" value={projectState(selected, current?.activeId ?? null)} />
    <Fact label="What it's for" value={selected.description ?? 'No description'} />
    <View style={{ gap: 8 }}>
      <Label heading={3} weight="700">{selected.folders.length > 1 ? 'Folders' : 'Folder'}</Label>
      {selected.folders.length === 0 ? <Label tone="muted">No folder.</Label> : selected.folders.map(folder =>
        <View key={folder.path} style={{ gap: 2 }}><Label selectable mono>{folder.path}</Label>
          {selected.folders.length > 1 ? <Label tone="muted" size={12}>{folder.primary ? 'Chats work here' : 'Also part of this project'}</Label> : null}</View>)}
      <Label tone="muted" size={12}>Folders are on the computer running Hermes.</Label>
    </View>
    {nerd ? <View style={{ gap: 12 }}><Label heading={3} weight="700">Details</Label><Fact label="Project ID" value={selected.id} mono /></View> : null}
  </View> : null;
  return <>
    {props.panes.list ? <FunctionList title={title} page="projects" narrow={props.narrow} agents={props.data.agents} profile={profile}
      onProfile={id => { setProfile(id); setQuery(''); setSelectedId(null); setNotice(null); }}
      canRefresh={!!profile && connected} onRefresh={() => { setWritten(null); setRetired(list.value); list.reload(); }}
      actions={profile && connected && !unsupported ? <Button label="New project" icon="plus" tone="quiet" compact disabled={!current}
        onPress={() => setEditing({ mode: 'new' })} /> : null}
      filters={shownNotice && shownNotice.id === null ? <Banner tone={shownNotice.tone} text={shownNotice.text} /> : null}
      query={query} onQuery={setQuery} message={message} rows={rows} selectedId={selected?.id}
      onSelect={row => { setSelectedId(row.id); props.onOpenDetail(); }} /> : null}
    {props.panes.detail ? <FunctionDetail pageTitle={title} selectedTitle={selected?.name} onBack={props.onBack} message={message}
      empty={`Pick a project to see its details. ${ABOUT}`}>{detail}</FunctionDetail> : null}
    {editing && profile ? <ProjectEditor editing={editing} profile={profile} agentName={agentName}
      onClose={() => setEditing(null)} onSaved={value => saved(value, editing.mode)} onUncertain={list.reload}
      onUnchanged={project => { setEditing(null); setNotice({ profile, id: project.id, tone: 'info', text: 'Nothing changed.' }); }} /> : null}
    {archiving && profile ? <ConfirmDialog open tone="danger" busy={busy !== null} error={archiveError || undefined}
      title={`Archive “${archiving.name}”?`} body="Its chats and folders stay on your computer. You can restore it later." confirmLabel="Archive project"
      onConfirm={() => { void setArchived(archiving, profile, true); }} onCancel={() => { if (busy === null) setArchiving(null); }} /> : null}
  </>;
}

export function ProjectEditor(props: Readonly<{
  editing: Editing; profile: string; agentName: string; onClose: () => void; onSaved: (value: ProjectSaved) => void;
  onUncertain: () => void; onUnchanged: (project: Project) => void;
}>): JSX.Element {
  const call = useCall();
  const edit = props.editing.mode === 'edit' ? props.editing.project : null;
  const [name, setName] = useState(edit?.name ?? '');
  const [about, setAbout] = useState(edit?.description ?? '');
  const [folder, setFolder] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<Readonly<{ text: string; uncertain: boolean }> | null>(null);
  const ready = !!name.trim() && (edit !== null || validFolder(folder));

  async function save(): Promise<void> {
    if (!ready) return;
    setSaving(true); setError(null);
    let result;
    if (!edit) {
      result = await call('projects.create', { profile: props.profile, name: name.trim(), folder: folder.trim(), ...(about.trim() ? { description: about.trim() } : {}) });
    } else {
      const changes = { ...(name.trim() !== edit.name ? { name: name.trim() } : {}), ...(about.trim() !== (edit.description ?? '') ? { description: about.trim() } : {}) };
      if (Object.keys(changes).length === 0) { setSaving(false); props.onUnchanged(edit); return; }
      result = await call('projects.update', { profile: props.profile, id: edit.id, ...changes });
    }
    setSaving(false);
    if (result.ok) { props.onSaved(result.value); return; }
    setError({ text: result.message, uncertain: result.code === 'unknown' });
    if (result.code === 'unknown') props.onUncertain();
  }
  const verb = edit ? 'Save' : 'Create';
  return <Dialog open title={edit ? 'Edit project' : 'New project'} onClose={() => { if (!saving) props.onClose(); }} actions={<>
    <Button label="Cancel" disabled={saving} onPress={props.onClose} />
    <Button label={saving ? 'Saving…' : error?.uncertain ? `${verb} anyway` : verb} tone="primary" disabled={saving || !ready} onPress={() => { void save(); }} />
  </>}>
    <TextField label="Name" maxLength={160} value={name} disabled={saving} spellCheck autoFocus onChange={setName} />
    <TextField label="What it's for (optional)" multiline rows={2} maxLength={2000} value={about} disabled={saving} spellCheck onChange={setAbout} />
    {edit ? null : <TextField label="Folder on the Hermes computer" maxLength={4096} mono value={folder} disabled={saving}
      placeholder="~/projects/app" error={folder.trim() && !validFolder(folder) ? 'Start with / or ~/ for a folder on the computer running Hermes.' : undefined}
      hint="This folder is on the computer running Hermes, which may not be this one. bighelp doesn't create or move it."
      onChange={setFolder} />}
    {edit ? null : <Label tone="muted" size={13}>{`It becomes the current project for ${props.agentName}. ${ABOUT}`}</Label>}
    {error ? <Banner tone={error.uncertain ? 'warn' : 'error'} text={error.text} /> : null}
  </Dialog>;
}
