// Privileged desktop entry point. Host transport and protected persistence stay
// here; the renderer receives only validated actions and safe snapshots.
import { app, BrowserWindow, Menu, protocol, session, ipcMain, safeStorage } from 'electron';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  APP_ORIGIN, APP_SCHEME, CONTENT_SECURITY_POLICY, isAppRequest, launchOptions, resolveAppAsset, secureWebPreferences,
} from './policy.ts';
import { createProtectedRepository } from '../../../../packages/platform/protected-repository.ts';
import { connectGateway } from '../../../../packages/hermes-client/gateway.ts';
import { connectSocket } from '../../../../packages/platform/socket-transport.ts';
import { createDesktopService } from './desktop-service.ts';
import { DESKTOP_CHANNEL, SNAPSHOT_CHANNEL } from '../shared/desktop-api.ts';

// Must run before the app is ready.
protocol.registerSchemesAsPrivileged([{
  scheme: APP_SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: false, corsEnabled: false, stream: false },
}]);
// Keep development data apart from any installed copy (docs/DECISIONS.md D8).
app.setName('bighelp-desktop-dev');
app.enableSandbox();
const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();

const { fixturePreview } = launchOptions(process.argv, app.isPackaged);
const bundleDirectory = __dirname;
const rendererDirectory = join(bundleDirectory, 'renderer');
let desktop: ReturnType<typeof createDesktopService> | undefined;
let repository: Awaited<ReturnType<typeof createProtectedRepository>> | null = null;
let quitting = false;

function installSessionPolicy(): void {
  const current = session.defaultSession;
  current.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  current.setPermissionCheckHandler(() => false);
  current.setDevicePermissionHandler(() => false);
  current.setDisplayMediaRequestHandler((_request, callback) => callback({}));
  current.on('will-download', event => event.preventDefault());
  // Renderer networking is denied. Only main owns the host connection.
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

app.whenReady().then(async () => {
  if (!primaryInstance) return;
  Menu.setApplicationMenu(null);
  installSessionPolicy();
  if (!fixturePreview) {
    try {
      repository = await createProtectedRepository({ directory: join(app.getPath('userData'), 'protected'), platform: process.platform,
        protection: { isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
          getSelectedStorageBackend: () => process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : 'os',
          encryptString: text => safeStorage.encryptString(text), decryptString: bytes => safeStorage.decryptString(Buffer.from(bytes)) } });
    } catch { /* No plaintext fallback. The UI reports unavailable secure storage. */ }
  }
  desktop = createDesktopService({ repository,
    connect: options => connectGateway({ ...options, socket: connectSocket }),
    onChange: snapshot => {
      for (const window of BrowserWindow.getAllWindows()) if (!window.webContents.isDestroyed()) window.webContents.send(SNAPSHOT_CHANNEL, snapshot);
    },
  });
  ipcMain.handle(DESKTOP_CHANNEL, async (event, action: unknown) => {
    const frame = event.senderFrame;
    if (!desktop || !frame || frame !== event.sender.mainFrame || frame.url !== `${APP_ORIGIN}/index.html`
      || !BrowserWindow.fromWebContents(event.sender) || fixturePreview) return { ok: false, message: 'Desktop operation unavailable' };
    return desktop.handle(action);
  });
  createWindow();
  void desktop.initialize();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
}).catch(() => app.exit(1));

// D3: closing the last window quits. Opt-in tray/background mode is a later slice.
app.on('window-all-closed', () => app.quit());
app.on('second-instance', () => {
  const window = BrowserWindow.getAllWindows()[0];
  if (window) { if (window.isMinimized()) window.restore(); window.focus(); }
});
app.on('before-quit', event => {
  if (quitting || !repository) return;
  event.preventDefault(); quitting = true;
  const protectedRepository = repository;
  void (async () => {
    try { await desktop?.shutdown(); }
    finally { await protectedRepository.close(); }
  })().finally(() => app.quit());
});
