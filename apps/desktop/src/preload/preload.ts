import { contextBridge, ipcRenderer } from 'electron';
import { createShellInfo } from '../shared/shell-info.ts';
import { CALL_CHANNEL, COMMAND_CHANNEL, DESKTOP_CHANNEL, SHELL_CHANNEL, SNAPSHOT_CHANNEL } from '../shared/desktop-api.ts';
import { isAppCommand } from '../shared/links.ts';
import type { DesktopAction, DesktopApi, DesktopResult, DesktopSnapshot } from '../shared/desktop-api.ts';
// Set by scripts/desktop/build.mjs from package.json at build time.
declare const __BIGHELP_VERSION__: string;
contextBridge.exposeInMainWorld('bighelpShell', createShellInfo(process.argv, process.platform,
  { appVersion: __BIGHELP_VERSION__, systemVersion: process.getSystemVersion(), arch: process.arch }));

const invoke = (action: DesktopAction): Promise<DesktopResult> => ipcRenderer.invoke(DESKTOP_CHANNEL, action);
const api: DesktopApi = Object.freeze({
  snapshot: () => invoke({ kind: 'snapshot' }),
  connect: host => invoke({ kind: 'connect', host }),
  disconnect: () => invoke({ kind: 'disconnect' }),
  refresh: () => invoke({ kind: 'refresh' }),
  preferences: changes => invoke({ kind: 'preferences', changes }),
  canonicalChat: (generation, profile, requestId) => invoke({ kind: 'canonicalChat', generation, profile, requestId }),
  cancelNavigation: (generation, requestId) => invoke({ kind: 'cancelNavigation', generation, requestId }),
  newChat: (generation, profile) => invoke({ kind: 'newChat', generation, profile }),
  openChat: (generation, chatId) => invoke({ kind: 'openChat', generation, chatId }),
  send: (generation, chatId, text) => invoke({ kind: 'send', generation, chatId, text }),
  interrupt: (generation, chatId) => invoke({ kind: 'interrupt', generation, chatId }),
  answer: (generation, promptId, answer) => invoke({ kind: 'answer', generation, promptId, answer }),
  draft: (generation, chatId, text) => invoke({ kind: 'draft', generation, chatId, text }),
  attach: (generation, chatId) => invoke({ kind: 'attach', generation, chatId }),
  attachDropped: (generation, chatId, files) => invoke({ kind: 'attachDropped', generation, chatId, files }),
  detach: (generation, chatId, attachmentId) => invoke({ kind: 'detach', generation, chatId, attachmentId }),
  workspace: (generation, profile, page, days) => invoke({ kind: 'workspace', generation, profile, page, days }),
  call: (connection, name, input) => ipcRenderer.invoke(CALL_CHANNEL, { kind: 'call', connection, name, input }),
  openLink: url => ipcRenderer.invoke(SHELL_CHANNEL, { kind: 'openLink', url }).then(result => result === true, () => false),
  copyText: text => ipcRenderer.invoke(SHELL_CHANNEL, { kind: 'copyText', text }).then(result => result === true, () => false),
  onCommand: listener => {
    if (typeof listener !== 'function') throw new TypeError('Invalid listener');
    const receive = (_event: Electron.IpcRendererEvent, command: unknown) => { if (isAppCommand(command)) listener(command); };
    ipcRenderer.on(COMMAND_CHANNEL, receive);
    return () => { ipcRenderer.removeListener(COMMAND_CHANNEL, receive); };
  },
  subscribe: listener => {
    if (typeof listener !== 'function') throw new TypeError('Invalid listener');
    const receive = (_event: Electron.IpcRendererEvent, snapshot: DesktopSnapshot) => listener(snapshot);
    ipcRenderer.on(SNAPSHOT_CHANNEL, receive);
    return () => { ipcRenderer.removeListener(SNAPSHOT_CHANNEL, receive); };
  },
});
contextBridge.exposeInMainWorld('bighelpDesktop', api);
