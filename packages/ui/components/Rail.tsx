// The one global navigation (mock D): it picks what the context list shows.
import type { JSX } from 'react';
import { Pressable, View } from 'react-native-web';
import type { Place } from '../../domain/shell.ts';
import type { GlyphName } from '../glyphs.ts';
import { useTheme } from '../theme.tsx';
import type { HostView } from '../view-model.ts';
import { Icon, Label, Noodle, hoverFill } from './primitives.tsx';

const MAIN: readonly (readonly [Place, GlyphName, string] | null)[] = Object.freeze([
  ['chats', 'chat', 'Chats'], ['agents', 'agents', 'Agents'], null, ['projects', 'projects', 'Projects'],
  ['kanban', 'kanban', 'Kanban'], ['workflows', 'workflows', 'Workflows'], ['scheduled', 'clock', 'Scheduled'],
  ['usage', 'usage', 'Usage'],
]);

function RailItem(props: Readonly<{ icon: GlyphName; label: string; accessibleLabel?: string; active: boolean;
  onPress: () => void; dot?: 'on' | 'off' }>): JSX.Element {
  const { palette } = useTheme();
  return (
    <Pressable role="button" aria-label={props.accessibleLabel ?? props.label} aria-current={props.active ? 'page' : false}
      onPress={props.onPress}
      style={({ hovered }) => [{ alignItems: 'center', gap: 2, paddingVertical: 7, paddingHorizontal: 2, borderRadius: 10,
        cursor: 'pointer' }, hoverFill(palette, hovered, props.active)]}>
      <View>
        <Icon name={props.icon} color={props.active ? palette.action : palette.muted} />
        {props.dot ? (
          <View style={{ position: 'absolute', top: -2, right: -4, width: 9, height: 9, borderRadius: 5, borderWidth: 2,
            borderColor: props.dot === 'on' ? palette.side : palette.muted,
            backgroundColor: props.dot === 'on' ? palette.online : palette.side }} />
        ) : null}
      </View>
      <Label size={11} tone={props.active ? 'ink' : 'muted'} weight={props.active ? '600' : '400'} oneLine>{props.label}</Label>
    </Pressable>
  );
}

export function Rail(props: Readonly<{ place: Place; host: HostView | null;
  onPlace: (place: Place) => void; onHost: () => void }>): JSX.Element {
  const { palette } = useTheme();
  const hostState = props.host?.state === 'connected' ? 'Connected' : props.host ? 'Offline' : 'Not connected';
  return (
    <View role="navigation" aria-label="Places" style={{ width: 76, flexShrink: 0, gap: 2,
      paddingVertical: 10, paddingHorizontal: 6, backgroundColor: palette.side, borderRightWidth: 1,
      borderRightColor: palette.line, overflow: 'hidden' }}>
      <View style={{ alignItems: 'center', paddingTop: 4, paddingBottom: 10 }}><Noodle size={26} /></View>
      {MAIN.map((item, index) => item === null
        ? <View key={`sep-${index}`} role="separator" style={{ height: 1, backgroundColor: palette.line, marginVertical: 6, marginHorizontal: 10 }} />
        : <RailItem key={item[0]} icon={item[1]} label={item[2]} active={props.place === item[0]} onPress={() => props.onPlace(item[0])} />)}
      <View style={{ flex: 1 }} />
      <RailItem icon="lock" label="Vault" active={props.place === 'vault'} onPress={() => props.onPlace('vault')} />
      <RailItem icon="host" label={props.host ? 'Host' : 'No host'} active={false} onPress={props.onHost}
        accessibleLabel={`Computer: ${props.host?.label ?? 'none'}, ${hostState}. Open Hosts settings`}
        dot={props.host?.state === 'connected' ? 'on' : 'off'} />
      <RailItem icon="settings" label="Settings" active={props.place === 'settings'} onPress={() => props.onPlace('settings')} />
    </View>
  );
}
