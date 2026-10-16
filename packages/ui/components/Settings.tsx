// One Settings. Everyday rows never move; Hermes items appear only with Nerd Mode on.
// The open page itself is SettingsPage.tsx.
import type { JSX } from 'react';
import { Pressable, View } from 'react-native-web';
import { EVERYDAY_SETTINGS, NERD_SETTINGS } from '../../domain/shell.ts';
import type { SettingsSection } from '../../domain/shell.ts';
import type { GlyphName } from '../glyphs.ts';
import { useTheme } from '../theme.tsx';
import { Icon, Label, Tag, hoverFill } from './primitives.tsx';

export const SECTION_INFO: Readonly<Record<SettingsSection, readonly [GlyphName, string, string]>> = Object.freeze({
  you: ['user', 'You', 'Your name'],
  assistants: ['agents', 'Assistants', 'The model new chats start with'],
  appearance: ['palette', 'Appearance', 'Light, dark and text size'],
  chat: ['chat', 'Chat', 'Replies, sending and reactions'],
  notifications: ['bell', 'Notifications', 'Alerts while bighelp runs'],
  hosts: ['host', 'Hosts', 'Your computers'],
  permissions: ['shield', 'Permissions', 'What bighelp and your agents can use'],
  help: ['question', 'Help & feedback', 'Versions, guides and bug reports'],
  system: ['refresh', 'System', 'Hermes version, gateway and plugin features'],
  hermesTools: ['tool', 'Hermes tools', 'Toolsets and skills on your computer'],
});
const GROUPS: readonly (readonly SettingsSection[])[] = Object.freeze([
  ['you', 'assistants'], ['appearance', 'chat', 'notifications'], ['hosts', 'permissions', 'help'],
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
