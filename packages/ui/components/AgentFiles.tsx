// The agent's Files tab: "Artifacts" (the Hermes computer's working folder,
// newest files first, or browsed folder by folder) and "Media" (pictures and
// videos the agent sent or made). Read-only, plus Save a copy, which main does
// with the system Save dialog. Same list/detail layout as Feed, Ideas and Goals.
import type { JSX } from 'react';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native-web';
import type { DesktopApi, DesktopSnapshot } from '../../../apps/desktop/src/shared/desktop-api.ts';
import type { CallInput, CallName, CallOutput, CallResult } from '../../../apps/desktop/src/shared/calls/index.ts';
import type { AgentFileEntry, FilePreview } from '../../contracts/agent-files.ts';
import type { ViewData } from '../view-model.ts';
import { useTheme } from '../theme.tsx';
import { Banner, Button } from './controls.tsx';
import { Label, PageHead, hoverFill } from './primitives.tsx';

type Load<T> = Readonly<{ status: 'idle' | 'loading' | 'loaded' | 'failed'; value: T | null; code: string; message: string }>;
const IDLE = Object.freeze({ status: 'idle' as const, value: null, code: '', message: '' });
const LOADING = Object.freeze({ status: 'loading' as const, value: null, code: '', message: '' });

// One read call per input; a reply for older input (or another connection) is dropped.
function useCallLoad<K extends CallName>(api: DesktopApi | undefined, connection: number | null, name: K, input: CallInput<K> | null,
  attempt: number): Load<CallOutput<K>> {
  const key = input === null || connection === null || !api ? null : JSON.stringify([connection, name, input, attempt]);
  const [state, setState] = useState<Readonly<{ key: string | null; load: Load<CallOutput<K>> }>>({ key: null, load: IDLE });
  const latest = useRef(key);
  latest.current = key;
  useEffect(() => {
    if (key === null || input === null || connection === null || !api) return;
    let active = true;
    void api.call(connection, name, input).then(
      result => result.ok ? { status: 'loaded' as const, value: result.value, code: '', message: '' }
        : { status: 'failed' as const, value: null, code: result.code, message: result.message },
      () => ({ status: 'failed' as const, value: null, code: 'unavailable', message: 'The desktop connection is unavailable.' }),
    ).then(load => { if (active && latest.current === key) setState({ key, load }); });
    return () => { active = false; };
  }, [key]);
  if (key === null) return IDLE;
  return state.key === key ? state.load : LOADING;
}

export function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined) return 'Unknown size';
  if (bytes < 1000) return `${bytes} ${bytes === 1 ? 'byte' : 'bytes'}`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1000, unit = 0;
  while (value >= 1000 && unit < units.length - 1) { value /= 1000; unit += 1; }
  return `${value >= 10 ? Math.round(value) : Math.round(value * 10) / 10} ${units[unit]}`;
}
function when(iso: string | undefined): string {
  if (!iso) return 'Unknown';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleString();
}
function folderLabel(path: string): string {
  return path === '' ? 'Working folder' : path.split('/').join(' › ');
}

type Selection = Readonly<{ scope: string; kind: 'file'; path: string } | { scope: string; kind: 'media'; id: string }>;

export function AgentFiles(props: Readonly<{
  profile: string; data: ViewData; narrow: boolean; api?: DesktopApi | undefined; snapshot?: DesktopSnapshot | undefined;
}>): JSX.Element {
  const { palette } = useTheme();
  const agent = props.data.agents.find(entry => entry.id === props.profile);
  const connected = props.snapshot?.status === 'connected' && typeof props.snapshot.connection === 'number' && !!props.api;
  const connection = connected && props.snapshot ? props.snapshot.connection : null;
  const scope = JSON.stringify([props.snapshot?.connection, props.snapshot?.generation, agent?.id ?? null]);
  const [mode, setMode] = useState<'artifacts' | 'media'>('artifacts');
  // null: the newest files. A string: that folder, "" being the working folder.
  const [folder, setFolder] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [detail, setDetail] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState<string | null>(null);
  const [note, setNote] = useState<Readonly<{ scope: string; tone: 'success' | 'error' | 'warn'; text: string }> | null>(null);
  const current = useRef(scope);
  current.current = scope;
  useEffect(() => { setMode('artifacts'); setFolder(null); setSelection(null); setDetail(false); setNote(null); setSaving(null); }, [scope]);
  const profile = agent ? props.profile : null;
  const recent = useCallLoad(props.api, connection, 'files.recent',
    profile && mode === 'artifacts' && folder === null ? { profile } : null, attempt);
  // An older plugin without recent files: browse the working folder instead.
  const browsing = folder ?? (recent.status === 'failed' && recent.code === 'unsupported' ? '' : null);
  const listing = useCallLoad(props.api, connection, 'files.list',
    profile && mode === 'artifacts' && browsing !== null ? { profile, folder: browsing } : null, attempt);
  const media = useCallLoad(props.api, connection, 'media.list', profile && mode === 'media' ? { profile } : null, attempt);
  const chosen = selection?.scope === scope ? selection : null;
  const filePreview = useCallLoad(props.api, connection, 'files.preview',
    profile && mode === 'artifacts' && chosen?.kind === 'file' ? { profile, path: chosen.path } : null, attempt);
  const mediaRows = media.value?.items ?? [];
  const chosenMedia = chosen?.kind === 'media' ? mediaRows.find(item => item.id === chosen.id) : undefined;
  const mediaPreview = useCallLoad(props.api, connection, 'media.preview',
    profile && mode === 'media' && chosenMedia && chosenMedia.mimeType.startsWith('image/') ? { profile, id: chosenMedia.id } : null, attempt);
  const folderLoad = browsing === null ? recent : listing;
  const servingProfileId = folderLoad.value?.servingProfileId ?? filePreview.value?.servingProfileId;
  const servingName = props.data.agents.find(entry => entry.id === servingProfileId)?.name ?? servingProfileId;
  const hostLabel = props.data.host?.label ?? 'your Hermes computer';
  const agentName = agent?.name ?? 'This agent';
  const refresh = () => { setAttempt(value => value + 1); setNote(null); };
  const showingDetail = props.narrow && detail;
  const visibleNote = note?.scope === scope ? note : null;

  // Main shows the system Save dialog and writes the copy. Cancelling says nothing.
  async function save(key: string, request: (api: DesktopApi, connection: number) => Promise<CallResult<'files.save' | 'media.save'>>): Promise<void> {
    if (!props.api || connection === null || saving) return;
    const at = scope;
    setSaving(key); setNote(null);
    let result: CallResult<'files.save' | 'media.save'>;
    try { result = await request(props.api, connection); }
    catch { result = { ok: false, code: 'unavailable', message: 'The desktop connection is unavailable.' }; }
    if (current.current !== at) return;
    setSaving(null);
    if (!result.ok) { setNote({ scope: at, tone: 'error', text: result.message }); return; }
    if (result.value.saved) setNote({ scope: at, tone: 'success', text: `Saved “${result.value.fileName ?? 'the file'}” on this computer.` });
  }
  function open(entry: AgentFileEntry): void {
    if (entry.folder) { setFolder(entry.path); setSelection(null); setDetail(false); return; }
    setSelection({ scope, kind: 'file', path: entry.path }); setDetail(true);
  }

  let listBody: JSX.Element;
  if (!agent) listBody = <Label tone="muted">This agent is no longer available. Choose an agent from the list.</Label>;
  else if (!connected) listBody = <Label tone="muted">Files are unavailable. Connect to Hermes, then refresh.</Label>;
  else if (mode === 'artifacts') {
    if (folderLoad.status === 'loading' || folderLoad.status === 'idle') listBody = <Label tone="muted">Finding the working folder…</Label>;
    else if (folderLoad.status === 'failed') listBody = <Label selectable tone="muted">{folderLoad.message}</Label>;
    else {
      const value = folderLoad.value;
      const entries = value?.entries ?? [];
      listBody = <View style={{ gap: 6 }}>
        {browsing === null ? <View style={{ gap: 2, paddingHorizontal: 10 }}>
          <Label heading={3} size={13} weight="700">Made or changed lately</Label>
          <Label size={12} tone="muted">Files your agent wrote, edited or sent you, plus new files near the top of the working folder. Newest first.</Label>
        </View> : <View style={{ gap: 6, paddingHorizontal: 10 }}>
          <Label heading={3} size={13} weight="700">{folderLabel(browsing)}</Label>
          {value && value.parent !== null ? <Button compact tone="quiet" label="Up one folder" onPress={() => { setFolder(value.parent); setSelection(null); }} /> : null}
        </View>}
        {entries.length === 0 ? <Label tone="muted">{browsing === null ? 'No artifacts yet. Files, pages and apps your agent makes show up here.' : 'This folder is empty.'}</Label>
          : <View role="list" style={{ gap: 2 }}>{[...entries].sort((a, b) => browsing === null ? 0 : Number(b.folder) - Number(a.folder) || a.name.localeCompare(b.name)).map(entry => {
            const active = chosen?.kind === 'file' && chosen.path === entry.path;
            const where = entry.path.includes('/') ? entry.path.slice(0, entry.path.lastIndexOf('/')) : '';
            return <Pressable key={entry.path} role="button" aria-label={entry.folder ? `Folder ${entry.name}` : entry.name} aria-current={active ? 'true' : false}
              onPress={() => open(entry)} style={({ hovered }) => [{ padding: 10, borderRadius: 10, gap: 2 }, hoverFill(palette, hovered, active)]}>
              <Label weight="600">{entry.folder ? `${entry.name} /` : entry.name}</Label>
              <Label size={12} tone="muted">{entry.folder ? 'Folder' : [formatBytes(entry.size), when(entry.modifiedAt), browsing === null && where ? `in ${folderLabel(where)}` : ''].filter(Boolean).join(' · ')}</Label>
            </Pressable>;
          })}</View>}
        {browsing === null ? <Button compact tone="quiet" label="Browse all files" onPress={() => { setFolder(''); setSelection(null); }} />
          : !(recent.status === 'failed' && recent.code === 'unsupported') ? <Button compact tone="quiet" label="Show recent files" onPress={() => { setFolder(null); setSelection(null); }} /> : null}
      </View>;
    }
  } else if (media.status === 'loading' || media.status === 'idle') listBody = <Label tone="muted">Loading media…</Label>;
  else if (media.status === 'failed') listBody = <Label selectable tone="muted">{media.code === 'unsupported'
    ? `Pictures and videos ${agentName} sends you show up here once the bighelp plugin on your Hermes computer is updated.` : media.message}</Label>;
  else if (!mediaRows.length) listBody = <View style={{ gap: 4 }}><Label weight="600">No media yet</Label>
    <Label tone="muted">Pictures and videos {agentName} sends you or makes show up here.</Label></View>;
  else listBody = <View role="list" style={{ gap: 2 }}>{mediaRows.map(item => {
    const active = chosen?.kind === 'media' && chosen.id === item.id;
    return <Pressable key={item.id} role="button" aria-label={item.name} aria-current={active ? 'true' : false}
      onPress={() => { setSelection({ scope, kind: 'media', id: item.id }); setDetail(true); }}
      style={({ hovered }) => [{ padding: 10, borderRadius: 10, gap: 2 }, hoverFill(palette, hovered, active)]}>
      <Label weight="600">{item.name}</Label>
      <Label size={12} tone="muted">{[item.mimeType.startsWith('video/') ? 'Video' : 'Picture', formatBytes(item.size), when(item.createdAt)].join(' · ')}</Label>
    </Pressable>;
  })}</View>;

  function previewBody(preview: FilePreview, name: string): JSX.Element {
    if (preview.kind === 'image') return <img src={preview.dataUrl} alt={name} style={{ maxWidth: '100%', maxHeight: 520, objectFit: 'contain', alignSelf: 'flex-start' }} />;
    if (preview.kind === 'text') return <View style={{ gap: 6 }}>
      <View style={{ borderWidth: 1, borderColor: palette.line, borderRadius: 10, padding: 12, backgroundColor: palette.card }}>
        <Label selectable mono size={12}>{preview.text}</Label>
      </View>
      {preview.truncated ? <Label size={12} tone="muted">Showing the first part of this file. Save a copy to see all of it.</Label> : null}
    </View>;
    const reasons = { empty: 'This file is empty.', 'too-large': 'This file is too large to preview here.',
      'not-previewable': 'There is no preview for this kind of file.', 'not-text': 'This file isn’t plain text, so there is no preview.' } as const;
    return <Label tone="muted">{reasons[preview.reason]}</Label>;
  }
  function fact(label: string, value: string): JSX.Element {
    return <View key={label} style={{ gap: 2 }}><Label size={12} tone="muted">{label}</Label><Label selectable>{value}</Label></View>;
  }
  let detailBody: JSX.Element;
  if (chosen?.kind === 'file') {
    const value = filePreview.value;
    if (filePreview.status === 'failed') detailBody = <Label selectable tone="muted">{filePreview.message}</Label>;
    else if (!value) detailBody = <Label tone="muted">Opening file…</Label>;
    else detailBody = <>
      <Label selectable heading={3} size={20} weight="700">{value.name}</Label>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <Button compact label={saving === value.path ? 'Saving…' : 'Save a copy…'} disabled={!value.saveable || saving !== null}
          accessibleLabel={`Save a copy of ${value.name} on this computer`} onPress={() => { void save(value.path, (api, at) => api.call(at, 'files.save', { profile: props.profile, path: value.path })); }} />
      </View>
      {!value.saveable ? <Label size={12} tone="muted">Files over 3 MB can’t be opened or saved here yet.</Label> : null}
      <View style={{ gap: 10 }}>{[fact('Size', formatBytes(value.size)), fact('Changed', when(value.modifiedAt)), fact('Type', value.mimeType),
        fact('Folder', folderLabel(value.path.includes('/') ? value.path.slice(0, value.path.lastIndexOf('/')) : ''))]}</View>
      {previewBody(value.preview, value.name)}
    </>;
  } else if (chosenMedia) {
    detailBody = <>
      <Label selectable heading={3} size={20} weight="700">{chosenMedia.name}</Label>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <Button compact label={saving === chosenMedia.id ? 'Saving…' : 'Save a copy…'} disabled={saving !== null || chosenMedia.size < 1}
          accessibleLabel={`Save a copy of ${chosenMedia.name} on this computer`} onPress={() => { void save(chosenMedia.id, (api, at) => api.call(at, 'media.save', { profile: props.profile, id: chosenMedia.id })); }} />
      </View>
      <View style={{ gap: 10 }}>{[fact('Size', formatBytes(chosenMedia.size)), fact('Sent', when(chosenMedia.createdAt)), fact('Type', chosenMedia.mimeType)]}</View>
      {chosenMedia.mimeType.startsWith('image/') ? mediaPreview.status === 'failed' ? <Label selectable tone="muted">{mediaPreview.message}</Label>
        : mediaPreview.value ? previewBody(mediaPreview.value.preview, chosenMedia.name) : <Label tone="muted">Opening picture…</Label>
        : <Label tone="muted">Videos can be saved, but not played here yet.</Label>}
    </>;
  } else detailBody = <Label tone="muted">Pick a file to see its details.</Label>;

  const differs = !!servingProfileId && servingProfileId !== props.profile;
  return <View role="region" aria-label="Files" style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
    <PageHead title="Files" onBack={showingDetail ? () => setDetail(false) : undefined} backLabel="Back to the file list">
      <View role="tablist" aria-label="Kind of files" style={{ flexDirection: 'row', gap: 4 }}>
        {(['artifacts', 'media'] as const).map(entry => <Pressable key={entry} role="tab" aria-selected={mode === entry}
          aria-label={entry === 'artifacts' ? 'Artifacts' : 'Media'} onPress={() => { setMode(entry); setSelection(null); setDetail(false); }}
          style={({ hovered }) => [{ paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8 }, hoverFill(palette, hovered, mode === entry)]}>
          <Label size={13} weight={mode === entry ? '600' : '400'} tone={mode === entry ? 'action' : 'ink'}>{entry === 'artifacts' ? 'Artifacts' : 'Media'}</Label>
        </Pressable>)}
      </View>
      <Pressable role="button" aria-label="Refresh files" disabled={!connected || !agent} onPress={refresh} style={{ padding: 6 }}>
        <Label tone="action" size={13}>Refresh</Label>
      </Pressable>
    </PageHead>
    <View style={{ paddingHorizontal: 16, paddingTop: 10, gap: 8 }}>
      <Label size={12} tone="muted">{mode === 'artifacts'
        ? `These files are on ${hostLabel}${servingName ? `, in ${servingName}’s working folder` : ''}. bighelp only reads them; Save a copy puts one on this computer.`
        : `Pictures and videos from ${agentName}, stored on ${hostLabel}.`}</Label>
      {mode === 'artifacts' && differs ? <Banner tone="warn" title={`Showing ${servingName}’s files`}
        text={`The bighelp plugin shares the working folder of the agent Hermes runs as, ${servingName}. ${agentName} may keep its own files somewhere else.`} /> : null}
      {visibleNote ? <Banner tone={visibleNote.tone} text={visibleNote.text}>
        <Button compact tone="quiet" label="Close" accessibleLabel="Close this note" onPress={() => setNote(null)} />
      </Banner> : null}
    </View>
    <View style={{ flex: 1, minHeight: 0, flexDirection: 'row' }}>
      {!showingDetail ? <ScrollView style={{ flex: props.narrow ? 1 : 0.8, minWidth: 0, borderRightWidth: props.narrow ? 0 : 1, borderRightColor: palette.line }}
        contentContainerStyle={{ padding: 12, gap: 6 }}>{listBody}</ScrollView> : null}
      {!props.narrow || showingDetail ? <ScrollView style={{ flex: 1, minWidth: 0 }} contentContainerStyle={{ padding: 24, gap: 16 }}>
        {detailBody}
      </ScrollView> : null}
    </View>
  </View>;
}
