'use strict';

// Bundled with esbuild into dist/preload.js so it works in a sandboxed
// renderer. It loads Presage's preload bridge (window.__smartspectraBridge)
// and adds SOVA's own small, explicit API (window.sova).

require('@smartspectra/node-sdk/preload');

const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('sova', {
  config: invoke('sova:config'),
  getSettings: invoke('sova:settings:get'),
  setSettings: invoke('sova:settings:set'),
  getApiKey: invoke('sova:apikey:get'),
  setApiKey: invoke('sova:apikey:set'),
  clearApiKey: invoke('sova:apikey:clear'),
  listSessions: invoke('sova:sessions:list'),
  saveSession: invoke('sova:sessions:save'),
  listResets: invoke('sova:resets:list'),
  saveReset: invoke('sova:resets:save'),
  listCheckIns: invoke('sova:checkins:list'),
  saveCheckIn: invoke('sova:checkins:save'),
  dataSummary: invoke('sova:data:summary'),
  exportData: invoke('sova:data:export'),
  deleteAll: invoke('sova:data:delete-all'),
  idleSeconds: invoke('sova:system:idle'),
  appInfo: invoke('sova:app:info'),
  native: {
    start: invoke('sova:native:start'),
    stop: invoke('sova:native:stop'),
    restart: invoke('sova:native:restart'),
    destroy: invoke('sova:native:destroy'),
    cameras: invoke('sova:native:cameras'),
    requestInsight: invoke('sova:native:insight'),
    onEvent: (fn) => {
      const listener = (_e, ev) => fn(ev);
      ipcRenderer.on('sova:native:event', listener);
      return () => ipcRenderer.removeListener('sova:native:event', listener);
    },
  },
  widget: {
    show: invoke('sova:widget:show'),
    hide: invoke('sova:widget:hide'),
    update: (state) => ipcRenderer.send('sova:widget:update', state),
    onAction: (fn) => {
      const listener = (_e, action) => fn(action);
      ipcRenderer.on('sova:widget:action', listener);
      return () => ipcRenderer.removeListener('sova:widget:action', listener);
    },
  },
  onQuickReset: (fn) => {
    const listener = () => fn();
    ipcRenderer.on('sova:shortcut:quick-reset', listener);
    return () => ipcRenderer.removeListener('sova:shortcut:quick-reset', listener);
  },
});
