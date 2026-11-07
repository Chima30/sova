'use strict';

// Wraps the SmartSpectra renderer SDK, following Presage's Electron
// quickstart: build the SDK, listen for status, validation, metrics,
// errors and the camera stream, then start/stop/destroy.

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
  kFrameRateTooLow: 'Camera is too slow. Close other apps using the camera.',
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
  7: 'Camera unavailable. Close other apps using it and try again.',
};

const now = () => performance.now() / 1000;

class Measurement {
  constructor({ apiKey, telemetry, handlers }) {
    this.handlers = handlers || {};
    this.startedAt = null;
    this.status = ProcessingStatus.kUninitialized;
    this.validation = null;
    this.sdk = new SmartSpectraSDK({
      apiKey,
      requestedMetrics: [...breathingMetrics, ...cardioMetrics, ...faceMetrics],
      enableAccumulatedOutput: false,
      enableTelemetry: !!telemetry,   // Presage diagnostics are opt-in in SOVA
    });

    const STATUS_NAME = Object.fromEntries(Object.entries(ProcessingStatus).map(([k, v]) => [v, k]));
    this.sdk.on('processingStatus', (status) => {
      this.status = status;
      console.info('[SOVA] processing status', STATUS_NAME[status] || status);
      if (status === ProcessingStatus.kRunning && this.startedAt == null) this.startedAt = now();
      this._emit('status', status);
    });

    this.sdk.on('validationStatus', (code) => {
      const name = VALIDATION_NAME[code] || 'kUnknown';
      this.validation = { code, name, ok: code === ValidationCode.kOk, tip: VALIDATION_TIP[name] || 'Adjusting signal.' };
      this._emit('validation', this.validation);
    });

    this.sdk.on('metrics', (buf) => {
      let decoded;
      try { decoded = decodeMetrics(buf); } catch { return; }
      if (!decoded || (typeof Buffer !== 'undefined' && Buffer.isBuffer && Buffer.isBuffer(decoded))) return;
      this._emit('reading', extractLatest(decoded), this.elapsed());
    });

    this.sdk.on('error', (code, message, retryable) => {
      console.error('[SOVA] SDK error', code, message, 'retryable=', retryable);
      this._emit('error', { code, message, retryable, text: ERROR_TEXT[code] || message });
    });

    this.sdk.on('streamAvailable', (stream) => this._emit('stream', stream));
  }

  _emit(name, ...args) {
    const fn = this.handlers[name];
    if (fn) { try { fn(...args); } catch (e) { console.error('[SOVA]', name, e); } }
  }

  elapsed() { return this.startedAt == null ? 0 : now() - this.startedAt; }
  get running() { return this.status === ProcessingStatus.kRunning; }

  async start() { await this.sdk.start(); }

  async stop() {
    try { await this.sdk.stop(); } catch { /* already stopped */ }
  }

  destroy() {
    try { this.sdk.destroy(); } catch { /* already destroyed */ }
  }
}

module.exports = { Measurement, ProcessingStatus, now };
