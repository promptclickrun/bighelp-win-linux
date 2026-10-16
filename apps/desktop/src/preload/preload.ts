import { contextBridge, ipcRenderer } from 'electron';
import { createShellInfo } from '../shared/shell-info.ts';
import { DESKTOP_CHANNEL, SNAPSHOT_CHANNEL } from '../shared/desktop-api.ts';
import type { DesktopAction, DesktopApi, DesktopResult, DesktopSnapshot } from '../shared/desktop-api.ts';
contextBridge.exposeInMainWorld('bighelpShell', createShellInfo(process.argv, process.platform));

const invoke = (action: DesktopAction): Promise<DesktopResult> => ipcRenderer.invoke(DESKTOP_CHANNEL, action);
const api: DesktopApi = Object.freeze({
  snapshot: () => invoke({ kind: 'snapshot' }),
  connect: host => invoke({ kind: 'connect', host }),
  disconnect: () => invoke({ kind: 'disconnect' }),
  refresh: () => invoke({ kind: 'refresh' }),
  canonicalChat: (generation, profile, requestId) => invoke({ kind: 'canonicalChat', generation, profile, requestId }),
  cancelNavigation: (generation, requestId) => invoke({ kind: 'cancelNavigation', generation, requestId }),
  newChat: (generation, profile) => invoke({ kind: 'newChat', generation, profile }),
  openChat: (generation, chatId) => invoke({ kind: 'openChat', generation, chatId }),
  send: (generation, chatId, text) => invoke({ kind: 'send', generation, chatId, text }),
  interrupt: (generation, chatId) => invoke({ kind: 'interrupt', generation, chatId }),
  answer: (generation, promptId, answer) => invoke({ kind: 'answer', generation, promptId, answer }),
  draft: (generation, chatId, text) => invoke({ kind: 'draft', generation, chatId, text }),
  workspace: (generation, profile, page, days) => invoke({ kind: 'workspace', generation, profile, page, days }),
  subscribe: listener => {
    if (typeof listener !== 'function') throw new TypeError('Invalid listener');
    const receive = (_event: Electron.IpcRendererEvent, snapshot: DesktopSnapshot) => listener(snapshot);
    ipcRenderer.on(SNAPSHOT_CHANNEL, receive);
    return () => { ipcRenderer.removeListener(SNAPSHOT_CHANNEL, receive); };
  },
});
contextBridge.exposeInMainWorld('bighelpDesktop', api);
