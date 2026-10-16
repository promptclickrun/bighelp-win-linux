// Desktop integration owned by main: OS notifications, the opt-in tray, opening at
// sign-in, text size, and window placement. Decisions live in the pure modules
// next to this file; this only applies them through Electron.
import { app, Menu, Notification, Tray, nativeImage, screen } from 'electron';
import type { BrowserWindow, BrowserWindowConstructorOptions } from 'electron';
import { join } from 'node:path';
import type { DesktopAlert, DesktopSnapshot } from '../shared/desktop-api.ts';
import { DEFAULT_PREFERENCES } from '../shared/preferences.ts';
import type { Preferences } from '../shared/preferences.ts';
import { TRAY_LABELS, appIdentity, closeAction, iconFile, zoomFactor } from './desktop-lifecycle.ts';
import { autostartEntry, autostartPath, launchedAtLogin, startHidden, syncLinuxAutostart, windowsLoginItem } from './autostart.ts';
import { createNotificationGate } from './notification-policy.ts';
import { WINDOW_STATE_FILE, loadWindowState, placeWindow, saveWindowState } from './window-state.ts';

// Must run before the app is ready and before anything reads userData.
export function applyAppIdentity(): void {
  const identity = appIdentity(app.isPackaged);
  app.setName(identity.name);
  if (process.platform === 'linux' && identity.desktopName) app.setDesktopName(identity.desktopName);
  // Windows shows toasts only for an app with an Application User Model ID.
  if (process.platform === 'win32') app.setAppUserModelId(identity.appUserModelId);
}

export function createDesktopShell(options: Readonly<{ bundleDirectory: string; openWindow: () => void }>) {
  const packaged = app.isPackaged, platform = process.platform;
  const icon = (purpose: Parameters<typeof iconFile>[1]) => join(options.bundleDirectory, iconFile(platform, purpose));
  const stateFile = () => join(app.getPath('userData'), WINDOW_STATE_FILE);
  const loginLaunch = launchedAtLogin(process.argv, packaged);
  const gate = createNotificationGate();
  const live = new Set<Notification>();
  let preferences: Preferences = DEFAULT_PREFERENCES;
  let selectedChatId: string | null = null;
  let exiting = false;
  let tray: Tray | null = null;
  let window: BrowserWindow | null = null;
  let windowReady = false, pendingMaximize = false;
  // A sign-in launch waits for the saved preferences before deciding to show.
  let hiddenStart: boolean | null = loginLaunch ? null : false;
  let appliedLogin: boolean | null = null;
  let autostartWrites = Promise.resolve();

  const current = () => (window && !window.isDestroyed() ? window : null);
  function reveal(): void {
    hiddenStart = false;
    const target = current();
    if (!target) { options.openWindow(); return; } // The new window shows itself when ready.
    if (!windowReady) return;
    if (pendingMaximize) { pendingMaximize = false; target.maximize(); }
    if (target.isMinimized()) target.restore();
    target.show(); target.focus();
  }
  function saveState(target: BrowserWindow): void {
    if (target.isDestroyed()) return;
    saveWindowState(stateFile(), { ...target.getNormalBounds(), maximized: target.isMaximized() });
  }
  function applyZoom(target: BrowserWindow): void {
    if (!target.isDestroyed() && !target.webContents.isDestroyed()) target.webContents.setZoomFactor(zoomFactor(preferences.textSize));
  }

  function syncTray(): void {
    if (preferences.keepRunningInTray && !tray && !exiting) {
      try {
        const created = new Tray(nativeImage.createFromPath(icon('tray')));
        created.setToolTip(TRAY_LABELS.tooltip);
        created.setContextMenu(Menu.buildFromTemplate([
          { label: TRAY_LABELS.open, click: () => reveal() }, { type: 'separator' },
          { label: TRAY_LABELS.quit, click: () => app.quit() },
        ]));
        created.on('click', () => reveal());
        tray = created;
      } catch { tray = null; } // Without a tray, closing the window quits as usual.
    } else if (!preferences.keepRunningInTray && tray) {
      tray.destroy(); tray = null;
      if (current() && !current()?.isVisible()) reveal();
    }
  }

  // Only packaged builds register themselves; development runs never do.
  function syncLoginItem(): void {
    const wanted = preferences.openAtLogin;
    if (!packaged || appliedLogin === wanted) return;
    appliedLogin = wanted;
    if (platform === 'win32') {
      try { app.setLoginItemSettings(windowsLoginItem(wanted, process.execPath)); } catch { appliedLogin = null; }
    } else if (platform === 'linux') {
      autostartWrites = autostartWrites.then(async () => {
        await syncLinuxAutostart({ enabled: wanted, path: autostartPath(process.env, app.getPath('home')),
          content: autostartEntry(process.execPath, icon('window')) });
      }).catch(() => { appliedLogin = null; });
    }
  }

  return Object.freeze({
    windowOptions(): Pick<BrowserWindowConstructorOptions, 'x' | 'y' | 'width' | 'height' | 'icon'> {
      const placement = placeWindow(loadWindowState(stateFile()), screen.getAllDisplays().map(display => display.workArea),
        screen.getPrimaryDisplay().workArea);
      pendingMaximize = placement.maximized;
      return { x: placement.x, y: placement.y, width: placement.width, height: placement.height, icon: icon('window') };
    },
    attachWindow(target: BrowserWindow): void {
      window = target; windowReady = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const later = () => { clearTimeout(timer); timer = setTimeout(() => saveState(target), 500); };
      target.on('resize', later); target.on('move', later); target.on('maximize', later); target.on('unmaximize', later);
      target.on('session-end', () => { exiting = true; });
      target.on('close', event => {
        clearTimeout(timer); saveState(target);
        if (closeAction({ exiting, keepRunningInTray: preferences.keepRunningInTray, trayReady: !!tray }) === 'hide') {
          event.preventDefault(); target.hide();
        }
      });
      target.on('closed', () => { clearTimeout(timer); if (window === target) { window = null; windowReady = false; } });
      target.webContents.on('did-finish-load', () => applyZoom(target));
      target.once('ready-to-show', () => { windowReady = true; if (hiddenStart === false) reveal(); });
    },
    reveal,
    resetZoom(): void { const target = current(); if (target) applyZoom(target); },
    preferencesChanged(next: Preferences): void {
      preferences = next;
      syncTray(); syncLoginItem();
      const target = current(); if (target) applyZoom(target);
      if (hiddenStart === null) {
        if (startHidden(loginLaunch, preferences.keepRunningInTray, !!tray)) hiddenStart = true; else reveal();
      }
    },
    // Secure storage unavailable: no saved preferences will arrive.
    initialized(): void { if (hiddenStart === null) reveal(); },
    snapshotChanged(snapshot: DesktopSnapshot): void { selectedChatId = snapshot.selectedChatId; },
    secondInstance(argv: readonly string[]): void { if (!launchedAtLogin(argv, packaged)) reveal(); },
    beginExit(): void { exiting = true; },
    notify(alert: DesktopAlert): void {
      if (exiting || !Notification.isSupported()) return;
      const target = current();
      const focused = !!target && target.isVisible() && !target.isMinimized() && target.isFocused();
      const decision = gate.decide(alert, { preferences, windowFocused: focused, selectedChatId, platform, now: Date.now() });
      if (!decision.show) return;
      try {
        const notification = new Notification({ title: decision.content.title, body: decision.content.body, icon: icon('notification') });
        const release = () => { live.delete(notification); };
        notification.on('click', () => { release(); reveal(); });
        notification.on('close', release);
        notification.on('failed', release);
        // Keep a reference so the click handler survives garbage collection.
        live.add(notification);
        if (live.size > 16) { const oldest = live.values().next().value; if (oldest) live.delete(oldest); }
        notification.show();
      } catch { /* No notification service: the alert stays in the app. */ }
    },
  });
}
