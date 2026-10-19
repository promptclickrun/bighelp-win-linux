// Small pieces shared by the workflow and run pages.
import type { JSX, ReactNode } from 'react';
import { ScrollView, View } from 'react-native-web';
import { relativeTime } from '../../domain/workflows.ts';
import { useHost, useQuery } from '../host.tsx';
import { useTheme } from '../theme.tsx';
import type { ViewData } from '../view-model.ts';
import { Markdown } from './Markdown.tsx';
import { Label } from './primitives.tsx';

export function Section(props: Readonly<{ title: string; children: ReactNode }>): JSX.Element {
  return <View style={{ gap: 8 }}><Label heading={3} size={15} weight="700">{props.title}</Label>{props.children}</View>;
}

// "5 min ago (4 Oct 2026, 09:41)": relative, with the exact local time.
export function when(at: number, now: number): string {
  return `${relativeTime(at, now)} (${new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })})`;
}

// Agents are Hermes profiles; show the name this app knows them by.
export function agentName(data: ViewData, id: string | null): string {
  if (!id) return 'No agent yet';
  return data.agents.find(agent => agent.id === id)?.name ?? id;
}

// Input keys are short snake_case names: "who_for" reads "Who for".
export function inputName(key: string): string {
  const words = key.replace(/_+/gu, ' ').trim();
  return words ? words[0]!.toUpperCase() + words.slice(1) : key;
}

export function Facts(props: Readonly<{ rows: readonly (readonly [string, string])[] }>): JSX.Element {
  return <View style={{ gap: 6 }}>{props.rows.map(([label, value]) => <View key={label} style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
    <View style={{ width: 140 }}><Label size={13} tone="muted">{label}</Label></View>
    <View style={{ flex: 1, minWidth: 160 }}><Label size={13} selectable>{value}</Label></View>
  </View>)}</View>;
}

// A text or Markdown output, read from the run and checked against its hash in main.
export function OutputText(props: Readonly<{ sha256: string; file: ReturnType<typeof useOutput> }>): JSX.Element {
  const { palette } = useTheme();
  const host = useHost();
  const file = props.file;
  if (file.status === 'failed') return <Label tone="muted">{file.message}</Label>;
  if (!file.value || file.value.sha256 !== props.sha256) return <View role="status"><Label tone="muted">Loading the file…</Label></View>;
  return <View style={{ borderWidth: 1, borderColor: palette.line, borderRadius: 12, backgroundColor: palette.card }}>
    <ScrollView style={{ maxHeight: 520 }} contentContainerStyle={{ padding: 14 }}>
      {file.value.text.trim() ? <Markdown text={file.value.text} actions={{ openLink: href => { void host?.api.openLink(href); } }} />
        : <Label tone="muted">This file is empty.</Label>}
    </ScrollView>
  </View>;
}
export function useOutput(runId: string, sha256: string | null) {
  return useQuery('workflows.output', sha256 ? { runId, sha256 } : null);
}
