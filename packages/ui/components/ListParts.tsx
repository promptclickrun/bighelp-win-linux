// Small building blocks shared by the context-column lists (Chats, Agents, ...).
import type { JSX, ReactNode } from 'react';
import { useState } from 'react';
import { Pressable, TextInput, View } from 'react-native-web';
import { useTheme } from '../theme.tsx';
import { Icon, Label, Tag, hoverFill } from './primitives.tsx';

// Rows without an action render as plain list items, so nothing looks clickable that isn't.
export function ListRow(props: Readonly<{ label: string; active: boolean; onPress?: () => void; children: ReactNode }>): JSX.Element {
  const { palette } = useTheme();
  if (!props.onPress) {
    return (
      <View role="listitem" aria-label={props.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 8,
        borderRadius: 10, minWidth: 0 }}>
        {props.children}
      </View>
    );
  }
  return (
    <Pressable role="button" aria-label={props.label} aria-current={props.active ? 'true' : false} onPress={props.onPress}
      style={({ hovered }) => [{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 8, borderRadius: 10,
        minWidth: 0, cursor: 'pointer' }, hoverFill(palette, hovered, props.active)]}>
      {props.children}
    </Pressable>
  );
}

export function Caption(props: Readonly<{ children: string; tag?: string | undefined }>): JSX.Element {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: 18, paddingBottom: 6, paddingHorizontal: 10 }}>
      <View style={{ flex: 1 }}><Label heading={3} size={12} weight="700" tone="muted">{props.children}</Label></View>
      {props.tag ? <Tag>{props.tag}</Tag> : null}
    </View>
  );
}

// Controlled when value/onChange are given; otherwise it keeps its own text.
export function Search(props: Readonly<{ label: string; value?: string; onChange?: (text: string) => void; nativeID?: string }>): JSX.Element {
  const { palette, font } = useTheme();
  const [own, setOwn] = useState('');
  const value = props.value ?? own;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 4, paddingVertical: 6,
      paddingHorizontal: 10, borderRadius: 10, backgroundColor: palette.incoming }}>
      <Icon name="search" color={palette.muted} size={16} />
      <TextInput value={value} onChangeText={props.onChange ?? setOwn} placeholder={props.label} aria-label={props.label}
        {...(props.nativeID ? { nativeID: props.nativeID } : {})}
        placeholderTextColor={palette.muted} maxLength={200}
        style={{ flex: 1, minWidth: 0, fontFamily: font, fontSize: 14, color: palette.ink, outlineStyle: 'none' }} />
    </View>
  );
}

export function Empty(props: Readonly<{ children: string }>): JSX.Element {
  return <View style={{ padding: 12 }}><Label tone="muted" size={13}>{props.children}</Label></View>;
}
