// Small shared building blocks. Every control here does something real or is
// visibly disabled with a reason; nothing is decorative-but-clickable.
import type { JSX, ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native-web';
import type { StyleProp } from 'react-native-web';
import { GLYPHS, NOODLE_PATH } from '../glyphs.ts';
import type { GlyphName, GlyphPart } from '../glyphs.ts';
import { useTheme } from '../theme.tsx';
import type { Palette } from '../tokens.ts';

export function Icon(props: Readonly<{ name: GlyphName; color: string; size?: number }>): JSX.Element {
  const size = props.size ?? 20;
  const parts: readonly GlyphPart[] = GLYPHS[props.name];
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none"
      stroke={props.color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
      style={{ flex: 'none', display: 'block' }}>
      {parts.map((part, index) => {
        if (part.shape === 'path') return <path key={index} d={part.d} />;
        if (part.shape === 'circle') return <circle key={index} cx={part.cx} cy={part.cy} r={part.r} />;
        return <rect key={index} x={part.x} y={part.y} width={part.width} height={part.height} rx={part.rx} />;
      })}
    </svg>
  );
}

// Stand-in for the Noodle mark; the real asset needs the licensed brand kit.
export function Noodle(props: Readonly<{ size?: number }>): JSX.Element {
  const size = props.size ?? 22;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none"
      stroke="#FF8A7A" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
      <path d={NOODLE_PATH} />
    </svg>
  );
}

type Tone = 'ink' | 'muted' | 'action' | 'onAction' | 'onOutgoing' | 'warnInk';
export function Label(props: Readonly<{
  children: ReactNode; tone?: Tone; size?: number; weight?: '400' | '600' | '700' | '800'; oneLine?: boolean;
  selectable?: boolean; heading?: number; mono?: boolean; style?: StyleProp; nativeID?: string;
}>): JSX.Element {
  const { palette, font } = useTheme();
  const size = props.size ?? 14;
  const heading = props.heading === undefined ? {} : { role: 'heading' as const, 'aria-level': props.heading };
  const id = props.nativeID === undefined ? {} : { nativeID: props.nativeID };
  return (
    <Text {...heading} {...id} numberOfLines={props.oneLine ? 1 : 0} selectable={props.selectable ?? false}
      style={[{
        fontFamily: props.mono ? '"Cascadia Mono", "Noto Sans Mono", "DejaVu Sans Mono", ui-monospace, monospace' : font,
        color: palette[props.tone ?? 'ink'], fontSize: size, lineHeight: Math.round(size * 1.45),
        fontWeight: props.weight ?? '400',
      }, props.style]}>
      {props.children}
    </Text>
  );
}

export function Orb(props: Readonly<{ color: string; size?: number }>): JSX.Element {
  const size = props.size ?? 32;
  const eye = { position: 'absolute', top: '42%', width: '12%', height: '16%', backgroundColor: '#FFFFFF', borderRadius: 99 } as const;
  return (
    <View aria-hidden={true} style={{
      width: size, height: size, borderRadius: size / 2, backgroundColor: props.color, flexShrink: 0,
      boxShadow: 'inset 0 -3px 0 rgba(0,0,0,.12)',
    }}>
      <View style={[eye, { left: '32%' }]} />
      <View style={[eye, { right: '32%' }]} />
    </View>
  );
}

export function hoverFill(palette: Palette, hovered: boolean, active = false): StyleProp {
  if (active) return { backgroundColor: palette.actionSoft };
  return hovered ? { backgroundColor: palette.hover } : null;
}

export function IconButton(props: Readonly<{
  icon: GlyphName; label: string; onPress: () => void; disabled?: boolean;
}>): JSX.Element {
  const { palette } = useTheme();
  return (
    <Pressable role="button" aria-label={props.label} onPress={props.onPress} disabled={props.disabled ?? false}
      style={({ hovered }) => [{
        width: 34, height: 34, borderRadius: 8, alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        cursor: props.disabled ? 'not-allowed' : 'pointer', opacity: props.disabled ? 0.45 : 1,
      }, hoverFill(palette, hovered && !props.disabled)]}>
      <Icon name={props.icon} color={palette.ink} />
    </Pressable>
  );
}

export function Tag(props: Readonly<{ children: string }>): JSX.Element {
  const { palette } = useTheme();
  return (
    <View style={{ borderWidth: 1, borderStyle: 'dashed', borderColor: palette.muted, borderRadius: 6, paddingHorizontal: 6 }}>
      <Label tone="muted" size={11} weight="700" oneLine>{props.children}</Label>
    </View>
  );
}

export function PageHead(props: Readonly<{ title: string; onBack?: (() => void) | undefined; backLabel?: string;
  children?: ReactNode }>): JSX.Element {
  const { palette } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 10,
      borderBottomWidth: 1, borderBottomColor: palette.line, minHeight: 56 }}>
      {props.onBack ? <IconButton icon="left" label={props.backLabel ?? 'Back'} onPress={props.onBack} /> : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Label heading={2} size={18} weight="700" oneLine>{props.title}</Label>
      </View>
      {props.children}
    </View>
  );
}

// Plain-words empty or unbuilt state. No spinner, no invented progress.
export function Notice(props: Readonly<{ title: string; body: string; mark?: boolean }>): JSX.Element {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 8 }}>
      {props.mark ? <Noodle size={40} /> : null}
      <Label heading={2} size={17} weight="700" style={{ textAlign: 'center' }}>{props.title}</Label>
      <Label tone="muted" style={{ textAlign: 'center', maxWidth: 420 }}>{props.body}</Label>
    </View>
  );
}
