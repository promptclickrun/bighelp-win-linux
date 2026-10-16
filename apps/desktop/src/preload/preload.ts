import { contextBridge } from 'electron';
import { createShellInfo } from '../shared/shell-info.ts';
contextBridge.exposeInMainWorld('bighelpShell', createShellInfo(process.argv, process.platform));
