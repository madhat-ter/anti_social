/**
 * The website's design system (apps/web/app/globals.css), for the phone app (RFC §10.32).
 * 1-bit desktop × zine poster: white paper, black ink, one signal red. Light for everyone; dark
 * only when the member chose it in Settings (RFC §10.14). The phone's own dark mode is never read:
 * there is no useColorScheme() anywhere in this app, and app.json pins userInterfaceStyle to light.
 */
import { createContext, useContext } from 'react';

export type ThemeName = 'light' | 'dark';

export interface Palette {
  paper: string;
  /** window footers, inactive tabs */
  panel: string;
  ink: string;
  /** quiet text, still readable small */
  gray: string;
  /** gray text on the panel gray */
  grayStrong: string;
  /** the red dot: fills, dots, rules */
  signal: string;
  /** red for words */
  signalText: string;
  /** text on red: black passes, white does not */
  signalInk: string;
  hair: string;
  shadow: string;
  highlight: string;
}

/** `:root` in globals.css */
const light: Palette = {
  paper: '#ffffff', panel: '#ededed', ink: '#000000', gray: '#6a6a6a', grayStrong: '#555555',
  signal: '#e8412c', signalText: '#c42a16', signalInk: '#000000',
  hair: 'rgba(0,0,0,0.14)', shadow: '#000000', highlight: 'rgba(232,65,44,0.07)',
};
/** `:root[data-theme="dark"]` in globals.css */
const dark: Palette = {
  paper: '#0d0d0d', panel: '#1f1f1f', ink: '#f4f4f4', gray: '#9c9c9c', grayStrong: '#bdbdbd',
  signal: '#e8412c', signalText: '#ff7a66', signalInk: '#000000',
  hair: 'rgba(255,255,255,0.18)', shadow: '#f4f4f4', highlight: 'rgba(232,65,44,0.16)',
};
export const PALETTES: Record<ThemeName, Palette> = { light, dark };

/**
 * Fonts, loaded in the root layout. The site sets reading text in Archivo, poster headings in
 * Archivo at 62% width, black, upper case (the static ExtraCondensed Black cut, OFL, in
 * assets/fonts), and the computer chrome (tabs, buttons, window titles) in Tiny5.
 * Bangla falls back to the phone's own font: Golesta Borno's licence does not allow shipping it
 * inside another product (AGENTS.md).
 */
export const FONT = {
  text: 'Archivo_400Regular',
  textMedium: 'Archivo_500Medium',
  textBold: 'Archivo_700Bold',
  textBlack: 'Archivo_900Black',
  poster: 'ArchivoExtraCondensed-Black',
  ui: 'Tiny5_400Regular',
} as const;

export const SPACE = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;

export const ThemeContext = createContext<{ name: ThemeName; c: Palette }>({ name: 'light', c: light });
export const useTheme = () => useContext(ThemeContext);
