// Electron main process for the P0 desktop shell. Applies policy.ts and adds
// nothing the renderer can call: no IPC handlers, no network, no file access.
// Host connection, secrets and storage arrive in later reviewed slices.
import { app, BrowserWindow, Menu, protocol, session } from 'electron';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  APP_ORIGIN, APP_SCHEME, CONTENT_SECURITY_POLICY, isAppRequest, launchOptions, resolveAppAsset, secureWebPreferences,
} from './policy.ts';

// Must run before the app is ready.
protocol.registerSchemesAsPrivileged([{
  scheme: APP_SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: false, corsEnabled: false, stream: false },
}]);
// Keep development data apart from any installed copy (docs/DECISIONS.md D8).
app.setName('bighelp-desktop-dev');
app.enableSandbox();

const { fixturePreview } = launchOptions(process.argv, app.isPackaged);
const bundleDirectory = __dirname;
const rendererDirectory = join(bundleDirectory, 'renderer');

function installSessionPolicy(): void {
  const current = session.defaultSession;
  current.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  current.setPermissionCheckHandler(() => false);
  current.setDevicePermissionHandler(() => false);
  current.setDisplayMediaRequestHandler((_request, callback) => callback({}));
  current.on('will-download', event => event.preventDefault());
  // This slice makes no network requests at all. Everything but app:// is refused.
  current.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !isAppRequest(details.url) }));
  current.webRequest.onHeadersReceived((details, callback) => {
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [CONTENT_SECURITY_POLICY] } });
  });
  current.protocol.handle(APP_SCHEME, async request => {
    const asset = resolveAppAsset(request.url);
    if (!asset || request.method !== 'GET') return new Response('Not found', { status: 404 });
    // Read the fixed allowlisted file directly. Not net.fetch: that would route a
    // file:// load through the session's own deny-everything request filter.
    let body: Buffer;
    try { body = await readFile(join(rendererDirectory, asset.file)); } catch { return new Response('Not found', { status: 404 }); }
    return new Response(new Uint8Array(body), {
      status: 200,
      headers: {
        'Content-Type': asset.type, 'Content-Security-Policy': CONTENT_SECURITY_POLICY,
        'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store',
      },
    });
  });
}

function createWindow(): BrowserWindow {
  const preferences = secureWebPreferences(join(bundleDirectory, 'preload.cjs'), fixturePreview);
  const window = new BrowserWindow({
    width: 1280, height: 800, minWidth: 640, minHeight: 480, show: false, title: 'bighelp',
    backgroundColor: '#FFF9F5', autoHideMenuBar: true,
    webPreferences: { ...preferences, additionalArguments: [...preferences.additionalArguments] },
  });
  const contents = window.webContents;
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', event => event.preventDefault());
  contents.on('will-redirect', event => event.preventDefault());
  contents.on('will-attach-webview', event => event.preventDefault());
  window.once('ready-to-show', () => window.show());
  void window.loadURL(`${APP_ORIGIN}/index.html`);
  return window;
}

// Links never open inside the app. External opening needs a reviewed allowlist first.
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', event => event.preventDefault());
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  installSessionPolicy();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
}).catch(() => app.exit(1));

// D3: closing the last window quits. Opt-in tray/background mode is a later slice.
app.on('window-all-closed', () => app.quit());
