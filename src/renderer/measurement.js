'use strict';

// SOVA's measurement client. By default the SmartSpectra SDK runs in the
// main process and opens the camera natively (Presage's recommendation for
// the best frame throughput); this class receives its events over IPC.
// The renderer-capture path (MediaStream) remains as a fallback.

const {
  SmartSpectraSDK,
  ProcessingStatus,
  ValidationCode,
  breathingMetrics,
  cardioMetrics,
  faceMetrics,
} = require('@smartspectra/node-sdk/renderer');
const { decodeMetrics } = require('@smartspectra/node-sdk/messages');
const { extractLatest } = require('../../shared/core/signals');

const VALIDATION_NAME = Object.fromEntries(Object.entries(ValidationCode).map(([k, v]) => [v, k]));
const STATUS_NAME = Object.fromEntries(Object.entries(ProcessingStatus).map(([k, v]) => [v, k]));

const VALIDATION_TIP = {
  kOk: 'Signal looks good',
  kNoFaceFound: 'No face found. Sit in front of the camera.',
  kMultipleFacesFound: 'Only one person should be in view.',
  kFaceNotCentered: 'Center your face in the frame.',
  kFaceSizeOutOfRange: 'Adjust your distance from the camera.',
  kTooDark: 'Add light in front of you.',
  kTooBright: 'Too bright. Avoid strong light behind you.',
  kChestNotVisible: 'Move back a little so your chest is visible.',
  kCameraTuning: 'Camera is adjusting.',
  kFrameRateTooLow: 'Camera is too slow. Add light in front of you and close other apps using the camera.',
  kExcessiveMotion: 'Hold still for a moment.',
  kFaceTooClose: 'Move a little further away.',
  kFaceTooFar: 'Move a little closer.',
  kFaceTooHigh: 'Your face is too high in the frame.',
  kFaceTooLow: 'Your face is too low in the frame.',
  kFaceNotForward: 'Face the camera.',
};

const ERROR_TEXT = {
  2: 'The Presage API key was not accepted. Check it in Settings.',
  4: 'Your Presage credits are used up. Live readings are paused.',
  5: 'No connection to Presage. SOVA will keep running as a plain timer.',
  6: 'Presage service error. Try again in a moment.',
  7: 'Camera unavailable. Close other apps using it, and check that Windows lets desktop apps use the camera.',
  8: 'SmartSpectra processing stopped.',
};

const now = () => performance.now() / 1000;

function validationInfo(code) {
  const name = VALIDATION_NAME[code] || 'kUnknown';
  return { code, name, ok: code === ValidationCode.kOk, tip: VALIDATION_TIP[name] || 'Adjusting signal.' };
}

// ---- Shared bookkeeping ------------------------------------------------------

class BaseMeasurement {
  constructor(handlers) {
    this.handlers = handlers || {};
    this.startedAt = null;
    this.status = ProcessingStatus.kUninitialized;
    this.resolution = 'standard';
  }

  _emit(name, ...args) {
    const fn = this.handlers[name];
    if (fn) { try { fn(...args); } catch (e) { console.error('[SOVA]', name, e); } }
  }

  _status(status) {
    this.status = status;
    console.info('[SOVA] processing status', STATUS_NAME[status] || status);
    if (status === ProcessingStatus.kRunning && this.startedAt == null) this.startedAt = now();
    this._emit('status', status);
  }

  _validation(code) {
    const v = validationInfo(code);
    this.validation = v;
    this._emit('validation', v);
  }

  _error(code, message, retryable) {
    console.error('[SOVA] SDK error', code, message, 'retryable=', retryable);
    this._emit('error', { code, message, retryable: !!retryable, text: ERROR_TEXT[code] || message });
  }

  elapsed() { return this.startedAt == null ? 0 : now() - this.startedAt; }
  get running() { return this.status === ProcessingStatus.kRunning; }
  get lightMode() { return this.resolution === 'light'; }
}

// ---- Main-process capture (default) -----------------------------------------

class NativeMeasurement extends BaseMeasurement {
  constructor({ telemetry, cameraId, handlers }) {
    super(handlers);
    this.native = true;
    this.telemetry = !!telemetry;
    this.cameraId = cameraId || null;
    this.off = window.sova.native.onEvent((ev) => this._onEvent(ev));
  }

  _onEvent(ev) {
    if (ev.kind === 'status') this._status(ev.status);
    else if (ev.kind === 'validation') this._validation(ev.code);
    else if (ev.kind === 'reading') this._emit('reading', ev.reading, this.elapsed());
    else if (ev.kind === 'error') this._error(ev.code, ev.message, ev.retryable);
    else if (ev.kind === 'camera') console.info('[SOVA] camera (native)', JSON.stringify(ev));
  }

  async _call(promise) {
    const r = await promise;
    if (r && r.ok === false) {
      const err = new Error(r.message || 'SmartSpectra call failed');
      err.code = r.code;
      err.retryable = r.retryable;
      throw err;
    }
    return r;
  }

  async start() {
    await this._call(window.sova.native.start({ telemetry: this.telemetry, size: this.resolution, cameraId: this.cameraId }));
  }

  async stop() { await window.sova.native.stop(); }

  async restart(light) {
    if (light) this.resolution = 'light';
    this.startedAt = null;   // warm-up windows start again after a restart
    await this._call(window.sova.native.restart(this.resolution));
  }

  destroy() {
    if (this.off) this.off();
    window.sova.native.destroy();
  }
}

// ---- Renderer capture (fallback) ---------------------------------------------

class RendererMeasurement extends BaseMeasurement {
  constructor({ apiKey, telemetry, handlers }) {
    super(handlers);
    this.native = false;
    this.sdk = new SmartSpectraSDK({
      apiKey,
      requestedMetrics: [...breathingMetrics, ...cardioMetrics, ...faceMetrics],
      enableAccumulatedOutput: false,
      enableTelemetry: !!telemetry,
    });
    this.sdk.on('processingStatus', (s) => this._status(s));
    this.sdk.on('validationStatus', (code) => this._validation(code));
    this.sdk.on('metrics', (buf) => {
      let decoded;
      try { decoded = decodeMetrics(buf); } catch { return; }
      if (!decoded || typeof decoded !== 'object') return;
      this._emit('reading', extractLatest(decoded), this.elapsed());
    });
    this.sdk.on('error', (code, message, retryable) => this._error(code, message, retryable));
  }

  async _acquire() {
    const size = this.resolution === 'light' ? { width: 640, height: 480 } : { width: 1280, height: 720 };
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { width: { ideal: size.width }, height: { ideal: size.height }, frameRate: { ideal: 30 } },
    });
    this.sdk.useMediaStream(this.stream);
    this._emit('stream', this.stream);
  }

  _release() {
    if (this.stream) { for (const t of this.stream.getTracks()) t.stop(); }
    this.stream = null;
  }

  async start() { await this._acquire(); await this.sdk.start(); }

  async stop() {
    try { await this.sdk.stop(); } catch { /* already stopped */ }
    this._release();
  }

  async restart(light) {
    this.startedAt = null;
    await this.stop();
    if (this.status === ProcessingStatus.kError) { try { await this.sdk.reset(); } catch { /* ignore */ } }
    if (light) this.resolution = 'light';
    await this.start();
  }

  destroy() {
    this._release();
    try { this.sdk.destroy(); } catch { /* already destroyed */ }
  }
}

function createMeasurement({ apiKey, telemetry, cameraId, captureMode, handlers }) {
  if (captureMode === 'renderer') return new RendererMeasurement({ apiKey, telemetry, handlers });
  return new NativeMeasurement({ telemetry, cameraId, handlers });
}

module.exports = { createMeasurement, ProcessingStatus, now };
