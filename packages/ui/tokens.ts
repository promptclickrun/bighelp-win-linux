// Design tokens for the approved hybrid direction. Values come from the pinned
// BighelpTheme description (docs/upstream/bighelp/DESIGN.md, bighelp@d62a545)
// and the mock D sheet; they are not measured from shipping-app screenshots.
// Plain data, no renderer import, so tests run under plain Node.

export type Theme = 'light' | 'dark';
export type Palette = Readonly<{
  page: string; card: string; raised: string; incoming: string; ink: string; muted: string; line: string;
  action: string; onAction: string; actionSoft: string; outgoing: string; onOutgoing: string; side: string;
  hover: string; warnBackground: string; warnInk: string; warnLine: string; ember: string; online: string;
  danger: string; onDanger: string; dangerSoft: string; successInk: string; successSoft: string; code: string;
}>;
type PaletteKey = keyof Palette;

export const PALETTES: Readonly<Record<Theme, Palette>> = Object.freeze({
  light: Object.freeze({
    page: '#FFF9F5', card: '#FFFFFF', raised: '#FFFFFF', incoming: '#F3ECE6', ink: '#1C1A19', muted: '#675E58',
    line: '#E9DFD7', action: '#7B52E0', onAction: '#FFFFFF', actionSoft: '#EFE8FC', outgoing: '#7B52E0',
    onOutgoing: '#FFFFFF', side: '#F8F0EA', hover: '#F1E8E1', warnBackground: '#FFF1DC', warnInk: '#6B4300',
    warnLine: '#F0D3A4', ember: '#FF8A7A', online: '#2E9E5B',
    danger: '#B3261E', onDanger: '#FFFFFF', dangerSoft: '#FCEAE8', successInk: '#1E6B3F', successSoft: '#E5F4EA', code: '#F6F0EB',
  }),
  dark: Object.freeze({
    page: '#121110', card: '#1E1C1B', raised: '#292624', incoming: '#292624', ink: '#FFF3EA', muted: '#B9ADA4',
    line: '#34302D', action: '#C9B6FF', onAction: '#1C1430', actionSoft: '#2D2640', outgoing: '#7B52E0',
    onOutgoing: '#FFFFFF', side: '#1A1817', hover: '#2B2826', warnBackground: '#3A2A12', warnInk: '#FFD9A0',
    warnLine: '#5A4220', ember: '#FF8A7A', online: '#2E9E5B',
    danger: '#FFB4AB', onDanger: '#2B0B08', dangerSoft: '#3B1D1A', successInk: '#9BE0B4', successSoft: '#17301F', code: '#1A1817',
  }),
});

// Every foreground/background pair the shell renders as text. Tested at >= 4.5:1.
export const TEXT_PAIRS: readonly (readonly [PaletteKey, PaletteKey])[] = Object.freeze([
  ['ink', 'page'], ['ink', 'card'], ['ink', 'incoming'], ['ink', 'side'], ['ink', 'actionSoft'], ['ink', 'hover'],
  ['muted', 'page'], ['muted', 'card'], ['muted', 'side'], ['muted', 'incoming'], ['action', 'page'],
  ['action', 'card'], ['onAction', 'action'], ['onOutgoing', 'outgoing'], ['warnInk', 'warnBackground'],
  ['danger', 'page'], ['danger', 'card'], ['danger', 'dangerSoft'], ['onDanger', 'danger'], ['successInk', 'successSoft'],
  ['ink', 'code'], ['muted', 'code'],
]);

export const LAYOUT = Object.freeze({
  railWidth: 76, listWidth: 300, narrowBreakpoint: 900, transcriptMaxWidth: 760,
  radius: Object.freeze({ small: 8, row: 10, card: 14, bubble: 18, composer: 22 }),
});

export function fontStack(platform: string): string {
  if (platform === 'windows') return '"Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif';
  if (platform === 'linux') return '"Noto Sans", "Cantarell", "DejaVu Sans", system-ui, sans-serif';
  return 'system-ui, sans-serif';
}
export const MONO_STACK = '"Cascadia Mono", "Noto Sans Mono", "DejaVu Sans Mono", ui-monospace, monospace';

function channel(hex: string, start: number): number {
  const value = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}
function luminance(hex: string): number {
  if (!/^#[0-9A-Fa-f]{6}$/u.test(hex)) throw new TypeError('Expected #RRGGBB');
  return 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
}
export function contrastRatio(foreground: string, background: string): number {
  const [high, low] = [luminance(foreground), luminance(background)].sort((a, b) => b - a) as [number, number];
  return (high + 0.05) / (low + 0.05);
}
