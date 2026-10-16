// Privileged desktop entry point. Host transport and protected persistence stay
// here; the renderer receives only validated actions and safe snapshots.
import { app, BrowserWindow, Menu, clipboard, dialog, protocol, session, shell, ipcMain, safeStorage } from 'electron';
import type { MenuItemConstructorOptions } from 'electron';
import { open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createSaveCopy } from './save-copy.ts';
import { join } from 'node:path';
import {
  APP_ORIGIN, APP_SCHEME, CONTENT_SECURITY_POLICY, isAppRequest, launchOptions, resolveAppAsset, secureWebPreferences,
} from './policy.ts';
import { createProtectedRepository } from '../../../../packages/platform/protected-repository.ts';
import { connectGateway } from '../../../../packages/hermes-client/gateway.ts';
import { connectSocket } from '../../../../packages/platform/socket-transport.ts';
import { createDesktopService } from './desktop-service.ts';
import { applyAppIdentity, createDesktopShell } from './desktop-shell.ts';
import { CALL_CHANNEL, COMMAND_CHANNEL, DESKTOP_CHANNEL, SHELL_CHANNEL, SNAPSHOT_CHANNEL, parseShellAction } from '../shared/desktop-api.ts';
import { safeLink } from '../shared/links.ts';
import type { AppCommand } from '../shared/links.ts';

// Must run before the app is ready.
protocol.registerSchemesAsPrivileged([{
  scheme: APP_SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: false, corsEnabled: false, stream: false },
}]);
// Packaged builds are "bighelp"; development keeps its own name and data (D8).
applyAppIdentity();
app.enableSandbox();
const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();

const { fixturePreview } = launchOptions(process.argv, app.isPackaged);
const bundleDirectory = __dirname;
const rendererDirectory = join(bundleDirectory, 'renderer');
let desktop: ReturnType<typeof createDesktopService> | undefined;
let repository: Awaited<ReturnType<typeof createProtectedRepository>> | null = null;
let quitting = false;
const desktopShell = createDesktopShell({ bundleDirectory, openWindow: () => { createWindow(); } });

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
    ...desktopShell.windowOptions(), minWidth: 640, minHeight: 480, show: false, title: 'bighelp',
    backgroundColor: '#FFF9F5', autoHideMenuBar: true,
    webPreferences: { ...preferences, additionalArguments: [...preferences.additionalArguments] },
  });
  const contents = window.webContents;
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', event => event.preventDefault());
  contents.on('will-redirect', event => event.preventDefault());
  contents.on('will-attach-webview', event => event.preventDefault());
  // Placement, close-to-tray, text size and first show (or a hidden sign-in start).
  desktopShell.attachWindow(window);
  void window.loadURL(`${APP_ORIGIN}/index.html`);
  return window;
}

// Links never open inside the app. Only safeLink() addresses reach the system
// browser, and only from an explicit click or the right-click menu.
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', event => event.preventDefault());
  // Electron has no default right-click menu. Offer the native edit roles.
  contents.on('context-menu', (_menuEvent, params) => {
    const flags = params.editFlags;
    const template: MenuItemConstructorOptions[] = [];
    if (params.isEditable) {
      template.push({ role: 'undo', enabled: flags.canUndo }, { role: 'redo', enabled: flags.canRedo }, { type: 'separator' },
        { role: 'cut', enabled: flags.canCut }, { role: 'copy', enabled: flags.canCopy }, { role: 'paste', enabled: flags.canPaste },
        { type: 'separator' }, { role: 'selectAll', enabled: flags.canSelectAll });
    } else if (params.selectionText.trim()) template.push({ role: 'copy' });
    const link = params.linkURL ? safeLink(params.linkURL) : null;
    if (link) {
      if (template.length) template.push({ type: 'separator' });
      template.push({ label: 'Open link', click: () => { void shell.openExternal(link); } },
        { label: 'Copy link address', click: () => clipboard.writeText(link) });
    }
    if (!params.isEditable && !link) template.push(...(template.length ? [{ type: 'separator' as const }] : []), { role: 'selectAll' });
    const window = BrowserWindow.fromWebContents(contents);
    if (template.length && window) Menu.buildFromTemplate(template).popup({ window });
  });
});

// The system file picker. Only files the person chose are read, each bounded
// before allocation; paths never leave main.
async function pickFiles(): Promise<readonly Readonly<{ name: string; bytes: Uint8Array }>[] | null> {
  const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  const options = { title: 'Add files', properties: ['openFile', 'multiSelections'] as ('openFile' | 'multiSelections')[] };
  const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
  if (result.canceled || !result.filePaths.length) return null;
  const files: { name: string; bytes: Uint8Array }[] = [];
  for (const path of result.filePaths.slice(0, 10)) {
    const handle = await open(path, 'r');
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) continue;
      // Oversized files are reported as such by the caller's limit check.
      const size = Math.min(stat.size, 8 * 1024 * 1024 + 1);
      const bytes = new Uint8Array(size);
      const { bytesRead } = await handle.read(bytes, 0, size, 0);
      files.push({ name: path.split(/[\\/]/u).pop() ?? 'attachment', bytes: bytes.subarray(0, bytesRead) });
    } finally { await handle.close(); }
  }
  return files;
}

function sendCommand(command: AppCommand): void {
  const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  if (window && !window.webContents.isDestroyed()) { window.show(); window.webContents.send(COMMAND_CHANNEL, command); }
}
// Hidden on Windows/Linux until Alt is pressed; it carries the keyboard shortcuts.
function applicationMenu(): Menu {
  return Menu.buildFromTemplate([
    { label: '&File', submenu: [
      { label: 'New chat', accelerator: 'CmdOrCtrl+N', click: () => sendCommand('newChat') },
      { label: 'Search chats', accelerator: 'CmdOrCtrl+K', click: () => sendCommand('search') },
      { label: 'Settings', accelerator: 'CmdOrCtrl+,', click: () => sendCommand('settings') },
      { type: 'separator' }, { role: 'quit', accelerator: 'CmdOrCtrl+Q' },
    ] },
    { label: '&Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' },
      { role: 'paste' }, { role: 'selectAll' }, { type: 'separator' },
      { label: 'Write a message', accelerator: 'CmdOrCtrl+L', click: () => sendCommand('focusComposer') }] },
    // Actual size returns to the text size chosen in Settings.
    { label: '&View', submenu: [{ label: 'Actual size', accelerator: 'CmdOrCtrl+0', click: () => desktopShell.resetZoom() },
      { role: 'zoomIn' }, { role: 'zoomIn', accelerator: 'CmdOrCtrl+=', visible: false },
      { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { label: '&Window', submenu: [{ role: 'minimize' }, { role: 'close' }] },
  ]);
}

app.whenReady().then(async () => {
  if (!primaryInstance) return;
  Menu.setApplicationMenu(applicationMenu());
  installSessionPolicy();
  if (!fixturePreview) {
    try {
      repository = await createProtectedRepository({ directory: join(app.getPath('userData'), 'protected'), trustedRoot: app.getPath('appData'), platform: process.platform,
        protection: { isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
          getSelectedStorageBackend: () => process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : 'os',
          encryptString: text => safeStorage.encryptString(text), decryptString: bytes => safeStorage.decryptString(Buffer.from(bytes)) } });
    } catch { /* No plaintext fallback. The UI reports unavailable secure storage. */ }
  }
  desktop = createDesktopService({ repository, pickFiles,
    connect: options => connectGateway({ ...options, socket: connectSocket }),
    // The renderer names a host file; main asks where to save and writes it.
    saveCopy: createSaveCopy({
      downloads: () => app.getPath('downloads'),
      files: { writeFile, rename, rm },
      showSaveDialog: options => {
        const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
        const settings = { ...options, properties: ['createDirectory', 'showOverwriteConfirmation'] as ('createDirectory' | 'showOverwriteConfirmation')[] };
        return window ? dialog.showSaveDialog(window, settings) : dialog.showSaveDialog(settings);
      },
    }),
    onChange: snapshot => {
      desktopShell.snapshotChanged(snapshot);
      for (const window of BrowserWindow.getAllWindows()) if (!window.webContents.isDestroyed()) window.webContents.send(SNAPSHOT_CHANNEL, snapshot);
    },
    onPreferences: preferences => desktopShell.preferencesChanged(preferences),
    notify: alert => desktopShell.notify(alert),
  });
  const trusted = (event: Electron.IpcMainInvokeEvent) => {
    const frame = event.senderFrame;
    return !!desktop && !!frame && frame === event.sender.mainFrame && frame.url === `${APP_ORIGIN}/index.html`
      && !!BrowserWindow.fromWebContents(event.sender) && !fixturePreview;
  };
  ipcMain.handle(DESKTOP_CHANNEL, async (event, action: unknown) => {
    if (!trusted(event) || !desktop) return { ok: false, message: 'Desktop operation unavailable' };
    return desktop.handle(action);
  });
  ipcMain.handle(SHELL_CHANNEL, async (event, action: unknown) => {
    const frame = event.senderFrame;
    if (!frame || frame !== event.sender.mainFrame || frame.url !== `${APP_ORIGIN}/index.html` || !BrowserWindow.fromWebContents(event.sender)) return false;
    try {
      const parsed = parseShellAction(action);
      if (parsed.kind === 'openLink') await shell.openExternal(parsed.url);
      else clipboard.writeText(parsed.text);
      return true;
    } catch { return false; }
  });
  ipcMain.handle(CALL_CHANNEL, async (event, action: unknown) => {
    if (!trusted(event) || !desktop) return { ok: false, code: 'unavailable', message: 'Desktop operation unavailable' };
    return desktop.call(action);
  });
  createWindow();
  void desktop.initialize().catch(() => undefined).then(() => desktopShell.initialized());
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
}).catch(() => app.exit(1));

// D3: closing the window quits, unless opt-in tray mode hid it instead.
app.on('window-all-closed', () => app.quit());
app.on('second-instance', (_event, argv) => desktopShell.secondInstance(argv));
app.on('before-quit', event => {
  // Quitting (menu, tray, OS shutdown) always closes the window and ends alerts.
  desktopShell.beginExit();
  if (quitting || !repository) return;
  event.preventDefault(); quitting = true;
  const protectedRepository = repository;
  void (async () => {
    try { await desktop?.shutdown(); }
    finally { await protectedRepository.close(); }
  })().finally(() => app.quit());
});
