// One Settings. Everyday rows never move; Hermes items appear only with Nerd Mode on.
import type { JSX } from 'react';
import { Pressable, ScrollView, View } from 'react-native-web';
import { EVERYDAY_SETTINGS, NERD_SETTINGS } from '../../domain/shell.ts';
import type { Appearance, SettingsSection } from '../../domain/shell.ts';
import type { GlyphName } from '../glyphs.ts';
import { useTheme } from '../theme.tsx';
import type { HostView } from '../view-model.ts';
import { Icon, Label, Notice, PageHead, Tag, hoverFill } from './primitives.tsx';

export const SECTION_INFO: Readonly<Record<SettingsSection, readonly [GlyphName, string, string]>> = Object.freeze({
  you: ['user', 'You', 'Your name and picture'],
  assistants: ['agents', 'Assistants', 'Default model, providers, personalities'],
  appearance: ['palette', 'Appearance', 'Light, dark, or follow the system'],
  chat: ['chat', 'Chat', 'When bighelp opens, replies, reactions'],
  voice: ['mic', 'Voice', 'Dictation and spoken replies'],
  notifications: ['bell', 'Notifications', 'Alerts while bighelp runs'],
  hosts: ['host', 'Hosts', 'Your computers'],
  permissions: ['shield', 'Permissions', 'What agents may use on this computer'],
  help: ['question', 'Help & feedback', 'Version, guides, report a problem'],
  system: ['refresh', 'System', 'Update Hermes, restart the gateway, plugin version'],
  hermesTools: ['tool', 'Hermes tools', "Search this computer's tools"],
});
const GROUPS: readonly (readonly SettingsSection[])[] = Object.freeze([
  ['you', 'assistants'], ['appearance', 'chat', 'voice', 'notifications'], ['hosts', 'permissions', 'help'],
]);

function Row(props: Readonly<{ section: SettingsSection; first: boolean; onOpen: (section: SettingsSection) => void }>): JSX.Element {
  const { palette } = useTheme();
  const [icon, title, detail] = SECTION_INFO[props.section];
  return (
    <Pressable role="button" aria-label={title} onPress={() => props.onOpen(props.section)}
      style={({ hovered }) => [{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10,
        paddingHorizontal: 14, cursor: 'pointer', borderTopWidth: props.first ? 0 : 1, borderTopColor: palette.line },
      hoverFill(palette, hovered)]}>
      <Icon name={icon} color={palette.action} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Label weight="600">{title}</Label>
        <Label size={12} tone="muted">{detail}</Label>
      </View>
      <Icon name="right" color={palette.muted} size={16} />
    </Pressable>
  );
}

function Group(props: Readonly<{ sections: readonly SettingsSection[]; onOpen: (section: SettingsSection) => void }>): JSX.Element {
  const { palette } = useTheme();
  return (
    <View role="list" style={{ backgroundColor: palette.card, borderWidth: 1, borderColor: palette.line, borderRadius: 14, overflow: 'hidden' }}>
      {props.sections.map((section, index) => <Row key={section} section={section} first={index === 0} onOpen={props.onOpen} />)}
    </View>
  );
}

export function NerdSwitch(props: Readonly<{ on: boolean; onChange: (on: boolean) => void }>): JSX.Element {
  const { palette } = useTheme();
  return (
    <Pressable role="switch" aria-checked={props.on} aria-label="Nerd Mode" onPress={() => props.onChange(!props.on)}
      style={({ hovered }) => [{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10,
        paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.card,
        cursor: 'pointer' }, hovered ? { backgroundColor: palette.hover } : null]}>
      <Icon name="nerd" color={palette.action} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Label weight="600">Nerd Mode</Label>
        <Label size={12} tone="muted">Show host tools, logs and technical detail</Label>
      </View>
      <View style={{ width: 40, height: 24, borderRadius: 12, backgroundColor: props.on ? palette.action : palette.line }}>
        <View style={{ position: 'absolute', top: 3, left: props.on ? 19 : 3, width: 18, height: 18, borderRadius: 9,
          backgroundColor: props.on ? palette.onAction : '#FFFFFF', boxShadow: '0 1px 2px rgba(0,0,0,.3)' }} />
      </View>
    </Pressable>
  );
}

// The overview: grouped everyday rows, the Nerd Mode switch, then the Hermes zone.
export function SettingsOverview(props: Readonly<{ nerdMode: boolean; onOpen: (section: SettingsSection) => void;
  onNerdMode: (on: boolean) => void }>): JSX.Element {
  const { palette } = useTheme();
  return (
    <View style={{ width: '100%', maxWidth: 620, alignSelf: 'center', paddingHorizontal: 20, paddingTop: 18, paddingBottom: 32, gap: 14 }}>
      {GROUPS.map(group => <Group key={group[0]} sections={group} onOpen={props.onOpen} />)}
      <NerdSwitch on={props.nerdMode} onChange={props.onNerdMode} />
      {props.nerdMode ? (
        <View role="region" aria-label="Hermes, Nerd Mode" style={{ borderWidth: 1, borderStyle: 'dashed', borderColor: palette.muted,
          borderRadius: 16, padding: 12, gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Icon name="nerd" color={palette.ink} />
            <View style={{ flex: 1 }}><Label heading={3} size={15} weight="700">Hermes</Label></View>
            <Tag>Nerd Mode</Tag>
          </View>
          <Label size={12} tone="muted">Only here while Nerd Mode is on. Everyday settings above never move.</Label>
          <Group sections={NERD_SETTINGS} onOpen={props.onOpen} />
        </View>
      ) : null}
    </View>
  );
}

// Compact section list for the context column in a wide window.
export function SettingsSectionList(props: Readonly<{ nerdMode: boolean; active: SettingsSection | null;
  onOpen: (section: SettingsSection) => void }>): JSX.Element {
  const { palette } = useTheme();
  const item = (section: SettingsSection) => (
    <Pressable key={section} role="button" aria-label={SECTION_INFO[section][1]}
      aria-current={props.active === section ? 'page' : false} onPress={() => props.onOpen(section)}
      style={({ hovered }) => [{ paddingVertical: 8, paddingHorizontal: 10, borderRadius: 9, cursor: 'pointer' },
        hoverFill(palette, hovered, props.active === section)]}>
      <Label weight={props.active === section ? '600' : '400'}>{SECTION_INFO[section][1]}</Label>
    </Pressable>
  );
  return (
    <View style={{ gap: 0 }}>
      {EVERYDAY_SETTINGS.map(item)}
      {props.nerdMode ? (
        <View style={{ marginTop: 14, paddingTop: 8, borderTopWidth: 1, borderStyle: 'dashed', borderTopColor: palette.muted, gap: 0 }}>
          <View style={{ alignSelf: 'flex-start', marginLeft: 6, marginBottom: 4 }}><Tag>Nerd Mode</Tag></View>
          {NERD_SETTINGS.map(item)}
        </View>
      ) : null}
    </View>
  );
}

function AppearancePage(props: Readonly<{ value: Appearance; onChange: (value: Appearance) => void }>): JSX.Element {
  const { palette } = useTheme();
  const options: readonly (readonly [Appearance, string, string])[] = [
    ['automatic', 'Automatic', 'Follow this computer'], ['light', 'Light', 'Cream page'], ['dark', 'Dark', 'Graphite page'],
  ];
  return (
    <View style={{ width: '100%', maxWidth: 620, alignSelf: 'center', padding: 20, gap: 10 }}>
      <Label nativeID="appearance-label" weight="600">Look</Label>
      <View role="radiogroup" aria-labelledby="appearance-label" style={{ backgroundColor: palette.card, borderWidth: 1,
        borderColor: palette.line, borderRadius: 14, overflow: 'hidden' }}>
        {options.map(([value, title, detail], index) => (
          <Pressable key={value} role="radio" aria-checked={props.value === value} aria-label={title}
            onPress={() => props.onChange(value)}
            style={({ hovered }) => [{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10,
              paddingHorizontal: 14, cursor: 'pointer', borderTopWidth: index === 0 ? 0 : 1, borderTopColor: palette.line },
            hoverFill(palette, hovered)]}>
            <View style={{ flex: 1 }}>
              <Label weight="600">{title}</Label>
              <Label size={12} tone="muted">{detail}</Label>
            </View>
            {props.value === value ? <Icon name="check" color={palette.action} /> : null}
          </Pressable>
        ))}
      </View>
      <Label size={12} tone="muted">Stays on this computer only. Bubble and page colors come later.</Label>
    </View>
  );
}

export function SettingsPage(props: Readonly<{ section: SettingsSection; appearance: Appearance; host: HostView | null;
  onAppearance: (value: Appearance) => void; onBack: () => void }>): JSX.Element {
  const title = SECTION_INFO[props.section][1];
  let body: JSX.Element;
  if (props.section === 'appearance') body = <AppearancePage value={props.appearance} onChange={props.onAppearance} />;
  else if (props.section === 'hosts') {
    body = <Notice title={props.host ? props.host.label : 'No computer connected'}
      body={props.host ? 'This is sample data, not a real computer.' : 'Adding a computer comes with sign-in, the next build step.'} />;
  } else body = <Notice title="Not built yet" body="This Settings page comes in a later step of the desktop build." />;
  return (
    <View style={{ flex: 1, minWidth: 0 }}>
      <PageHead title={title} onBack={props.onBack} backLabel="Back to Settings" />
      <ScrollView style={{ flex: 1 }}>{body}</ScrollView>
    </View>
  );
}
