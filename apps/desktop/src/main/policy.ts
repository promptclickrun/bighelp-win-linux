// Pure security policy for the Electron main process. No Electron import, so it
// is unit-tested under plain Node. main.ts applies it; it must not loosen it.
import { FIXTURE_PREVIEW_ARG } from '../shared/shell-info.ts';

export const APP_SCHEME = 'app';
export const APP_HOST = 'bighelp';
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;

// Packaged renderer files only. Main and preload bundles are never served.
const ASSETS: Readonly<Record<string, Readonly<{ file: string; type: string }>>> = Object.freeze({
  '/': Object.freeze({ file: 'index.html', type: 'text/html; charset=utf-8' }),
  '/index.html': Object.freeze({ file: 'index.html', type: 'text/html; charset=utf-8' }),
  '/renderer.js': Object.freeze({ file: 'renderer.js', type: 'text/javascript; charset=utf-8' }),
});

// Styles: react-native-web inserts its generated rules into a <style> element at
// runtime, which needs 'unsafe-inline' for styles only. Scripts stay 'self'.
export const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'none'",
  "media-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

export function resolveAppAsset(url: string): Readonly<{ file: string; type: string }> | null {
  // Reject what WHATWG URL parsing would silently repair before parsing.
  if (typeof url !== 'string' || !url.startsWith(`${APP_ORIGIN}/`) || /[\\%?#@\s]/u.test(url)) return null;
  let parsed: URL;
  try { parsed = new URL(url); } catch { return null; }
  if (parsed.protocol !== `${APP_SCHEME}:` || parsed.host !== APP_HOST || parsed.username || parsed.password
    || parsed.port || parsed.search || parsed.hash) return null;
  if (`${APP_ORIGIN}${parsed.pathname}` !== url) return null;
  return Object.hasOwn(ASSETS, parsed.pathname) ? ASSETS[parsed.pathname] ?? null : null;
}

export function isAppRequest(url: string): boolean {
  return typeof url === 'string' && url.startsWith(`${APP_ORIGIN}/`);
}

export type SecureWebPreferences = Readonly<{
  preload: string; contextIsolation: true; sandbox: true; nodeIntegration: false; nodeIntegrationInWorker: false;
  nodeIntegrationInSubFrames: false; webSecurity: true; allowRunningInsecureContent: false; webviewTag: false;
  navigateOnDragDrop: false; spellcheck: false; safeDialogs: true; additionalArguments: readonly string[];
}>;

export function secureWebPreferences(preloadPath: string, fixturePreview: boolean): SecureWebPreferences {
  if (typeof preloadPath !== 'string' || !(preloadPath.startsWith('/') || /^[A-Za-z]:\\/u.test(preloadPath))) {
    throw new TypeError('Preload path must be absolute');
  }
  return Object.freeze({
    preload: preloadPath,
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    nodeIntegrationInSubFrames: false,
    webSecurity: true,
    allowRunningInsecureContent: false,
    webviewTag: false,
    navigateOnDragDrop: false,
    // Chromium spellcheck dictionaries download from Google. Off until a reviewed local source exists.
    spellcheck: false,
    safeDialogs: true,
    additionalArguments: Object.freeze(fixturePreview ? [FIXTURE_PREVIEW_ARG] : []),
  });
}

// Synthetic sample data is a development aid. A packaged build never shows it.
export function launchOptions(argv: readonly string[], packaged: boolean): Readonly<{ fixturePreview: boolean }> {
  return Object.freeze({ fixturePreview: !packaged && argv.includes('--fixture-preview') });
}
