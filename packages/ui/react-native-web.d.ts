// Hand-maintained declarations for the subset of react-native-web 0.21.4 this
// app uses. The community @types/react-native-web@0.19.3 failed strict checking
// against RNW 0.21 and pulled react-native's native toolchain into the graph
// (docs/qualification/TOOLCHAIN.md). Widen this file only alongside a test or a
// reviewed RNW source read; never add an index signature or `any`.
declare module 'react-native-web' {
  import type { ReactNode, JSX } from 'react';

  type Size = number | `${number}%` | 'auto';
  type Color = string;
  export type Style = Readonly<{
    // layout
    display?: 'flex' | 'none'; position?: 'relative' | 'absolute'; flex?: number; flexGrow?: number; flexShrink?: number;
    flexBasis?: Size; flexDirection?: 'row' | 'column'; flexWrap?: 'wrap' | 'nowrap';
    alignItems?: 'flex-start' | 'flex-end' | 'center' | 'stretch' | 'baseline';
    alignSelf?: 'auto' | 'flex-start' | 'flex-end' | 'center' | 'stretch';
    justifyContent?: 'flex-start' | 'flex-end' | 'center' | 'space-between' | 'space-around';
    gap?: number; rowGap?: number; columnGap?: number;
    width?: Size; height?: Size; minWidth?: Size; minHeight?: Size; maxWidth?: Size; maxHeight?: Size;
    top?: Size; right?: Size; bottom?: Size; left?: Size; zIndex?: number;
    margin?: Size; marginTop?: Size; marginRight?: Size; marginBottom?: Size; marginLeft?: Size;
    marginHorizontal?: Size; marginVertical?: Size;
    padding?: Size; paddingTop?: Size; paddingRight?: Size; paddingBottom?: Size; paddingLeft?: Size;
    paddingHorizontal?: Size; paddingVertical?: Size;
    overflow?: 'visible' | 'hidden' | 'scroll' | 'auto';
    // surface
    backgroundColor?: Color; opacity?: number; boxShadow?: string;
    borderWidth?: number; borderTopWidth?: number; borderRightWidth?: number; borderBottomWidth?: number;
    borderLeftWidth?: number; borderColor?: Color; borderTopColor?: Color; borderRightColor?: Color;
    borderBottomColor?: Color; borderStyle?: 'solid' | 'dashed';
    borderRadius?: number; borderTopLeftRadius?: number; borderTopRightRadius?: number;
    borderBottomLeftRadius?: number; borderBottomRightRadius?: number;
    // text
    color?: Color; fontFamily?: string; fontSize?: number; fontWeight?: '400' | '600' | '700' | '800';
    fontStyle?: 'normal' | 'italic'; lineHeight?: number; letterSpacing?: number;
    textAlign?: 'auto' | 'left' | 'right' | 'center'; textTransform?: 'none' | 'uppercase';
    whiteSpace?: 'normal' | 'nowrap' | 'pre-wrap';
    // web-only keys RNW passes through
    cursor?: 'auto' | 'default' | 'pointer' | 'not-allowed' | 'text'; userSelect?: 'none' | 'text' | 'auto';
    outlineStyle?: 'none' | 'solid'; outlineWidth?: number; outlineColor?: Color; outlineOffset?: number;
    resize?: 'none';
  }>;
  export type StyleProp = Style | false | null | undefined | readonly StyleProp[];

  type Role = 'main' | 'navigation' | 'region' | 'complementary' | 'list' | 'listitem' | 'heading' | 'button'
    | 'link' | 'switch' | 'radio' | 'radiogroup' | 'status' | 'separator' | 'group' | 'none' | 'presentation'
    | 'article' | 'log' | 'banner' | 'form' | 'tablist' | 'tab';
  type Common = Readonly<{
    children?: ReactNode; style?: StyleProp; role?: Role; testID?: string; nativeID?: string;
    'aria-label'?: string; 'aria-labelledby'?: string; 'aria-describedby'?: string; 'aria-hidden'?: boolean;
    'aria-current'?: 'page' | 'true' | false; 'aria-live'?: 'polite' | 'off'; 'aria-level'?: number;
    'aria-expanded'?: boolean; 'aria-checked'?: boolean; 'aria-selected'?: boolean; 'aria-disabled'?: boolean;
  }>;
  export type InteractionState = Readonly<{ hovered: boolean; focused: boolean; pressed: boolean }>;

  export function View(props: Common): JSX.Element;
  export function Text(props: Common & Readonly<{ numberOfLines?: number; selectable?: boolean }>): JSX.Element;
  export function ScrollView(props: Common & Readonly<{ contentContainerStyle?: StyleProp }>): JSX.Element;
  export function Pressable(props: Omit<Common, 'style' | 'children'> & Readonly<{
    onPress?: () => void; disabled?: boolean;
    style?: StyleProp | ((state: InteractionState) => StyleProp);
    children?: ReactNode | ((state: InteractionState) => ReactNode);
  }>): JSX.Element;
  export function TextInput(props: Omit<Common, 'children'> & Readonly<{
    value: string; onChangeText: (text: string) => void; multiline?: boolean; rows?: number; placeholder?: string;
    placeholderTextColor?: Color; editable?: boolean; maxLength?: number; spellCheck?: boolean;
    onContentSizeChange?: (event: Readonly<{ nativeEvent: Readonly<{ contentSize: Readonly<{ width: number; height: number }> }> }>) => void;
  }>): JSX.Element;
  export const StyleSheet: Readonly<{ create<T extends Readonly<Record<string, Style>>>(styles: T): T }>;
  export function useWindowDimensions(): Readonly<{ width: number; height: number; scale: number; fontScale: number }>;
  export function useColorScheme(): 'light' | 'dark' | null;
}
