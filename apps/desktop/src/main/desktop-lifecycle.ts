// App identity, window close behaviour and text size. Pure; main.ts applies it.
import type { Preferences } from '../shared/preferences.ts';

// Packaged builds use "bighelp" for the app name and userData folder. Development
// runs keep a separate name so they never share data with an installed copy (D8).
export function appIdentity(packaged: boolean) {
  return Object.freeze(packaged
    ? { name: 'bighelp', appUserModelId: 'bighelp', desktopName: 'bighelp.desktop' }
    : { name: 'bighelp-desktop-dev', appUserModelId: 'bighelp-desktop-dev', desktopName: null });
}

const ZOOM: Readonly<Record<Preferences['textSize'], number>> = Object.freeze({ small: 0.9, default: 1, large: 1.12, larger: 1.25 });
export function zoomFactor(textSize: Preferences['textSize']): number {
  return Object.hasOwn(ZOOM, textSize) ? ZOOM[textSize] : 1;
}

// Closing the window hides it only when tray mode is on and the tray icon exists,
// so there is always a way back. Quitting always closes (D3).
export function closeAction(state: Readonly<{ exiting: boolean; keepRunningInTray: boolean; trayReady: boolean }>): 'hide' | 'close' {
  return !state.exiting && state.keepRunningInTray && state.trayReady ? 'hide' : 'close';
}

// Bundle-relative icon files (copied into the package by build.mjs).
// Windows prefers a multi-size ICO for windows and the tray; toasts take a PNG.
export function iconFile(platform: string, purpose: 'window' | 'tray' | 'notification'): string {
  if (purpose === 'notification') return 'icons/bighelp-64.png';
  if (platform === 'win32') return 'icons/bighelp.ico';
  return purpose === 'tray' ? 'icons/bighelp-32.png' : 'icons/bighelp-256.png';
}

export const TRAY_LABELS = Object.freeze({ tooltip: 'bighelp', open: 'Open bighelp', quit: 'Quit bighelp' });
