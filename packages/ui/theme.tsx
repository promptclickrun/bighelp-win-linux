import { createContext, useContext } from 'react';
import { fontStack, PALETTES } from './tokens.ts';
import type { Palette, Theme } from './tokens.ts';

export type ThemeValue = Readonly<{ theme: Theme; palette: Palette; font: string }>;

const ThemeContext = createContext<ThemeValue>(Object.freeze({
  theme: 'light', palette: PALETTES.light, font: fontStack('other'),
}));

export const ThemeProvider = ThemeContext.Provider;
export function useTheme(): ThemeValue {
  return useContext(ThemeContext);
}
