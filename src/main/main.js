'use strict';

// SOVA desktop: main process.
// Follows Presage's Electron integration guide: bindSmartSpectraIpc in main,
// the SDK preload (bundled into ours), the renderer SDK, a CSP that allows
// blob: workers, and camera permission only for SOVA's own bundled page.

const path = require('path');
const fs = require('fs');
const {
  app, BrowserWindow, session, ipcMain, dialog, powerMonitor,
  globalShortcut, safeStorage, shell,
} = require('electron');

// Packaged builds load the native runtime from resources/smartspectra/,
// because a native library cannot be loaded from inside app.asar.
// Set unconditionally so the library path cannot be redirected by the environment.
if (app.isPackaged) {
  const LIB = {
    darwin: 'libsmartspectra_capi.dylib',
    win32: 'smartspectra_capi.dll',
    linux: 'libsmartspectra_capi.so',
  }[process.platform];
  if (LIB) process.env.SMARTSPECTRA_CAPI_PATH = path.join(process.resourcesPath, 'smartspectra', LIB);
}

const { bindSmartSpectraIpc } = require('@smartspectra/node-sdk/main');
const { Store, publicSettings } = require('./store');
const config = require('../../shared/config/sova-config.json');
const { toCSV, toJSON } = require('../../shared/core/exporter');

app.setName('SOVA');

let win = null;
let store = null;
const RENDERER_INDEX = path.join(__dirname, '..', 'renderer', 'index.html');

function isOwnPage(url) {
  return typeof url === 'string' && url.startsWith('file://') && url.includes('/src/renderer/index.html');
}

function createWindow() {
  win = new BrowserWindow({
    title: 'SOVA',
    width: 1280,
    height: 840,
    minWidth: 880,
    minHeight: 640,
    backgroundColor: '#0B1220',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', '..', 'dist', 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  bindSmartSpectraIpc(win);

  win.webContents.setWindowOpenHandler(({ url }) => {
    // External links (privacy policy, docs) open in the user's browser.
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event) => event.preventDefault());

  win.once('ready-to-show', () => win.show());
  win.on('page-title-updated', (e) => e.preventDefault());
  win.loadFile(RENDERER_INDEX);
}

// ---- IPC: every handler checks the call came from SOVA's own page --------

function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!isOwnPage(event.senderFrame && event.senderFrame.url)) throw new Error('Not allowed');
    return fn(...args);
  });
}

function readApiKey() {
  if (process.env.SOVA_PRESAGE_API_KEY) return process.env.SOVA_PRESAGE_API_KEY.trim();
  const enc = store.getSettings().encryptedApiKey;
  if (!enc || !safeStorage.isEncryptionAvailable()) return null;
  try {
    return safeStorage.decryptString(Buffer.from(enc, 'base64'));
  } catch {
    return null;
  }
}

function registerIpc() {
  handle('sova:config', () => config);

  handle('sova:settings:get', () => ({
    ...publicSettings(store.getSettings()),
    hasApiKey: !!readApiKey(),
    apiKeyFromEnv: !!process.env.SOVA_PRESAGE_API_KEY,
  }));

  handle('sova:settings:set', (patch) => publicSettings(store.updateSettings(patch)));

  handle('sova:apikey:get', () => readApiKey());

  handle('sova:apikey:set', (key) => {
    const k = String(key || '').trim();
    if (!k) return { ok: false, reason: 'empty' };
    if (!safeStorage.isEncryptionAvailable()) return { ok: false, reason: 'no-encryption' };
    store.setEncryptedKey(safeStorage.encryptString(k).toString('base64'));
    return { ok: true };
  });

  handle('sova:apikey:clear', () => { store.setEncryptedKey(null); return { ok: true }; });

  handle('sova:sessions:list', () => store.listSessions());
  handle('sova:sessions:save', (s) => store.saveSession(s));
  handle('sova:data:summary', () => store.summary());

  handle('sova:data:export', async (format) => {
    const sessions = store.listSessions();
    const isCsv = format === 'csv';
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: 'Export SOVA data',
      defaultPath: isCsv ? 'sova-sessions.csv' : 'sova-sessions.json',
      filters: [isCsv ? { name: 'CSV', extensions: ['csv'] } : { name: 'JSON', extensions: ['json'] }],
    });
    if (canceled || !filePath) return { ok: false };
    const body = isCsv ? toCSV(sessions) : toJSON(sessions, publicSettings(store.getSettings()));
    fs.writeFileSync(filePath, body);
    return { ok: true, filePath };
  });

  handle('sova:data:delete-all', () => { store.deleteAll(); return { ok: true }; });

  // Seconds since the last keyboard or mouse input anywhere on the system.
  // Used only to wait for a pause in typing before showing a cue.
  handle('sova:system:idle', () => powerMonitor.getSystemIdleTime());

  handle('sova:app:info', () => ({ version: app.getVersion(), platform: process.platform }));
}

app.whenReady().then(() => {
  store = new Store(app.getPath('userData'));

  // Grant only the camera (video, no microphone), and only to SOVA's own page.
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) => {
    const url = (details && details.requestingUrl) || (wc && wc.getURL()) || '';
    const mediaTypes = (details && details.mediaTypes) || [];
    const cameraOnly = mediaTypes.length === 1 && mediaTypes[0] === 'video';
    callback(permission === 'media' && cameraOnly && isOwnPage(url));
  });

  registerIpc();
  createWindow();

  // Quick reset from any app.
  globalShortcut.register(config.shortcuts.quickReset, () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    win.webContents.send('sova:shortcut:quick-reset');
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', () => globalShortcut.unregisterAll());

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
