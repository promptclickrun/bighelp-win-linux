// The approved list/detail layout shared by Projects, Scheduled and Usage: an
// agent picker, search and rows on the left; the chosen row's detail on the right.
import type { JSX, ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native-web';
import type { DesktopApi, DesktopSnapshot } from '../../../apps/desktop/src/shared/desktop-api.ts';
import type { ViewData } from '../view-model.ts';
import { useTheme } from '../theme.tsx';
import { ContextColumn } from './ContextList.tsx';
import { Label, PageHead, hoverFill } from './primitives.tsx';

export type FunctionPage = 'projects' | 'scheduled' | 'usage';
export type FunctionPageProps = Readonly<{
  page: FunctionPage; data: ViewData; api?: DesktopApi | undefined; snapshot?: DesktopSnapshot | undefined;
  narrow: boolean; panes: Readonly<{ list: boolean; detail: boolean }>;
  onOpenDetail: () => void; onBack?: (() => void) | undefined;
}>;
export type ListRow = Readonly<{ id: string; title: string; subtitle: string; search: string }>;

// One agent at a time. A removed profile must not silently become a different
// agent, or reappear selected when a later catalog contains the old ID again.
export function useAgentChoice(agents: ViewData['agents']): readonly [string | null, (id: string | null) => void] {
  const [chosen, setChosen] = useState<string | null>(agents.length === 1 ? agents[0]!.id : null);
  const profile = agents.some(agent => agent.id === chosen) ? chosen : null;
  useEffect(() => { if (chosen !== null && profile === null) setChosen(null); }, [chosen, profile]);
  return [profile, setChosen];
}

export function Fact(props: Readonly<{ label: string; value: string | number | undefined | null; mono?: boolean }>): JSX.Element {
  return <View style={{ gap: 4 }}><Label tone="muted" size={12}>{props.label}</Label>
    <Label selectable mono={props.mono ?? false}>{props.value === undefined || props.value === null ? 'Unavailable' : props.value}</Label></View>;
}

export function FunctionList(props: Readonly<{
  title: string; page: FunctionPage; narrow: boolean; agents: ViewData['agents']; profile: string | null;
  onProfile: (id: string | null) => void; canRefresh: boolean; onRefresh: () => void; actions?: ReactNode; filters?: ReactNode;
  query: string; onQuery: (text: string) => void; message: string | null; rows: readonly ListRow[]; selectedId: string | undefined;
  onSelect: (row: ListRow) => void;
}>): JSX.Element {
  const { palette, font } = useTheme();
  const needle = props.query.trim().toLocaleLowerCase();
  const filtered = props.rows.filter(row => row.search.toLocaleLowerCase().includes(needle));
  return <ContextColumn title={props.title} narrow={props.narrow} actions={<>
    {props.actions}
    <Pressable role="button" aria-label={`Refresh ${props.page}`} disabled={!props.canRefresh}
      onPress={props.onRefresh} style={{ padding: 6 }}><Label tone="action" size={13}>Refresh</Label></Pressable></>}>
    <View style={{ gap: 10, padding: 4 }}>
      <label style={{ color: palette.muted, fontFamily: font, fontSize: 12 }}>Agent
        <select aria-label="Agent" value={props.profile ?? ''} onChange={event => props.onProfile(event.target.value || null)}
          style={{ display: 'block', width: '100%', marginTop: 4, color: palette.ink, background: palette.card, borderColor: palette.line, borderRadius: 8, padding: 8, fontFamily: font }}>
          <option value="">Choose an agent</option>{props.agents.map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
        </select>
      </label>
      {props.filters}
      <TextInput aria-label={`Search ${props.page}`} placeholder={`Search ${props.page}`} value={props.query} onChangeText={props.onQuery} maxLength={256}
        placeholderTextColor={palette.muted} style={{ backgroundColor: palette.incoming, borderRadius: 10, padding: 10, color: palette.ink, fontFamily: font }} />
      {props.message ? <View role="status"><Label tone="muted">{props.message}</Label></View> : <View role="list">
        {filtered.length === 0 ? <Label tone="muted">No matching rows.</Label> : filtered.map(row => <Pressable key={row.id} role="button" aria-label={row.title}
          aria-current={props.selectedId === row.id ? 'true' : false} onPress={() => props.onSelect(row)}
          style={({ hovered }) => [{ padding: 10, borderRadius: 10, gap: 4 }, hoverFill(palette, hovered, props.selectedId === row.id)]}>
          <Label selectable weight="600">{row.title}</Label><Label selectable tone="muted" size={12}>{row.subtitle}</Label>
        </Pressable>)}
      </View>}
    </View>
  </ContextColumn>;
}

export function FunctionDetail(props: Readonly<{
  pageTitle: string; selectedTitle: string | undefined; onBack?: (() => void) | undefined; message: string | null; empty: string; children?: ReactNode;
}>): JSX.Element {
  return <View style={{ flex: 1, minWidth: 0 }}>
    <PageHead title={props.selectedTitle ?? props.pageTitle} onBack={props.onBack} />
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 24, gap: 20 }}>
      {props.message ? <View role="status"><Label selectable tone="muted">{props.message}</Label></View> : props.selectedTitle !== undefined ? <>
        <Label selectable heading={3} size={20} weight="700">{props.selectedTitle}</Label>
        {props.children}
      </> : <Label tone="muted">{props.empty}</Label>}
    </ScrollView>
  </View>;
}

// Shared page states, in the same words on every function page.
export function pageMessage(input: Readonly<{ connected: boolean; agents: number; profile: string | null; title: string;
  status: 'idle' | 'loading' | 'loaded' | 'failed'; loaded: boolean; code: string; failure: string }>): string | null {
  if (!input.connected) return 'This page is unavailable. Connect to Hermes, then refresh.';
  if (input.agents === 0) return 'No agents are available on this computer.';
  if (!input.profile) return 'Choose an agent to load this page.';
  if (input.loaded) return null;
  if (input.status === 'failed') return input.code === 'unsupported' ? input.failure : `${input.failure} Refresh to try again.`;
  return `Loading ${input.title.toLowerCase()}…`;
}
