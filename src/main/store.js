'use strict';

// Local-first storage. Everything lives in the app's user-data folder as
// JSON files, written atomically. No accounts, no cloud, no video.

const fs = require('fs');
const path = require('path');

const DEFAULT_SETTINGS = {
  consentVersion: 0,
  telemetry: false,            // Presage SDK diagnostics: opt-in only
  presetId: 'studying',
  sensitivity: null,           // null = use the preset's sensitivity
  quietHours: { enabled: false, start: '21:00', end: '08:00' },
  reducedMotion: false,
  soundGuide: false,
  breathingPatternId: 'calm-6',
  customPattern: { inhale: 4, hold: 0, exhale: 6, holdAfterExhale: 0 },
  theme: 'dark',
  showWidget: true,
  cueOverrides: {},            // personal sensitivity settings
  autoSound: false,            // play the preset's ambient sound at session start
  soundVolume: 0.7,
  soundId: 'rain',
  captureMode: 'native',       // 'native' (main-process camera) or 'renderer'
  cameraId: null,              // null = system default camera
  encryptedApiKey: null,       // OS-encrypted via Electron safeStorage
};

// Keys the renderer is allowed to change.
const WRITABLE = new Set([
  'consentVersion', 'telemetry', 'presetId', 'sensitivity', 'quietHours',
  'reducedMotion', 'soundGuide', 'breathingPatternId', 'customPattern', 'theme',
  'captureMode', 'cameraId', 'showWidget',
  'cueOverrides', 'autoSound', 'soundVolume', 'soundId',
]);

class Store {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
    this.settingsPath = path.join(dir, 'sova-settings.json');
    this.sessionsPath = path.join(dir, 'sova-sessions.json');
  }

  _read(file, fallback) {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      return fallback;
    }
  }

  _write(file, data) {
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file);
  }

  getSettings() {
    return { ...DEFAULT_SETTINGS, ...this._read(this.settingsPath, {}) };
  }

  updateSettings(patch) {
    const next = this.getSettings();
    for (const [k, v] of Object.entries(patch || {})) {
      if (WRITABLE.has(k)) next[k] = v;
    }
    this._write(this.settingsPath, next);
    return next;
  }

  setEncryptedKey(b64) {
    const next = this.getSettings();
    next.encryptedApiKey = b64;
    this._write(this.settingsPath, next);
  }

  listSessions() {
    return this._read(this.sessionsPath, []);
  }

  saveSession(session) {
    const all = this.listSessions().filter((s) => s.id !== session.id);
    all.push(session);
    all.sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
    this._write(this.sessionsPath, all);
    return session;
  }

  deleteAll() {
    for (const f of [this.settingsPath, this.sessionsPath]) {
      try { fs.unlinkSync(f); } catch { /* already gone */ }
    }
  }

  // What the privacy dashboard shows. Never includes the key itself.
  summary() {
    const sessions = this.listSessions();
    return {
      sessions: sessions.length,
      reflections: sessions.filter((s) => s.reflection && (s.reflection.tags?.length || s.reflection.note)).length,
      notes: sessions.filter((s) => s.reflection && s.reflection.note).length,
      folder: this.dir,
    };
  }
}

function publicSettings(s) {
  const { encryptedApiKey, ...rest } = s;
  return rest;
}

module.exports = { Store, DEFAULT_SETTINGS, publicSettings };
