'use strict';

// Preload for the floating widget: receive state, send one of four actions.

const { contextBridge, ipcRenderer } = require('electron');

const ACTIONS = new Set(['reset', 'pause', 'open', 'hide']);

contextBridge.exposeInMainWorld('sovaWidget', {
  onState: (fn) => ipcRenderer.on('sova:widget:state', (_e, s) => fn(s)),
  action: (name) => { if (ACTIONS.has(name)) ipcRenderer.send('sova:widget:action', name); },
});
