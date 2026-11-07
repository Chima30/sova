'use strict';

// Main-process measurement. Presage's Electron guide recommends capturing
// in the main process for the best frame throughput: the SDK opens the
// camera natively and no frames cross the renderer-to-main IPC bridge.
// Only small, decoded readings are forwarded to SOVA's window.

const {
  SmartSpectraSDK,
  CameraSelection,
  ProcessingStatus,
  breathingMetrics,
  cardioMetrics,
  faceMetrics,
  decodeMetrics,
} = require('@smartspectra/node-sdk');
const { extractLatest } = require('../../shared/core/signals');

const SIZES = {
  standard: { width: 1280, height: 720, fps: 30 },
  light: { width: 640, height: 480, fps: 30 },
};

class NativeMeasurement {
  constructor(webContents) {
    this.wc = webContents;
    this.sdk = null;
    this.status = ProcessingStatus.kUninitialized;
    this.opts = null;
    this.size = 'standard';
  }

  send(event) {
    if (this.wc && !this.wc.isDestroyed()) this.wc.send('sova:native:event', event);
  }

  _build(opts) {
    this.opts = opts;
    this.sdk = new SmartSpectraSDK({
      apiKey: opts.apiKey,
      requestedMetrics: [...breathingMetrics, ...cardioMetrics, ...faceMetrics],
      enableAccumulatedOutput: false,
      enableTelemetry: !!opts.telemetry,
    });
    this.sdk.on('processingStatus', (status) => {
      this.status = status;
      this.send({ kind: 'status', status });
    });
    this.sdk.on('validationStatus', (code, ts, hint) => this.send({ kind: 'validation', code, hint: hint || '' }));
    this.sdk.on('metrics', (buf) => {
      let decoded;
      try { decoded = decodeMetrics(buf); } catch { return; }
      if (!decoded || Buffer.isBuffer(decoded)) return;
      // Plain numbers only: drop landmark arrays and protobuf Long objects.
      this.send({ kind: 'reading', reading: extractLatest(decoded) });
    });
    this.sdk.on('error', (code, message, retryable) => this.send({ kind: 'error', code, message, retryable: !!retryable }));
  }

  _useCamera() {
    const s = SIZES[this.size] || SIZES.standard;
    const cameras = SmartSpectraSDK.availableCameras();
    const pick = this.opts.cameraId && cameras.find((c) => c.id === this.opts.cameraId);
    const selection = pick ? CameraSelection.byId(pick.id) : CameraSelection.default;
    this.sdk.useCamera(selection, { width: s.width, height: s.height, fps: s.fps });
    this.send({ kind: 'camera', size: this.size, ...s, name: pick ? pick.name : (cameras[0] && cameras[0].name) || 'default' });
  }

  async start(opts) {
    if (!this.sdk) this._build(opts);
    if (opts && opts.size) this.size = opts.size;
    this._useCamera();
    this.sdk.start();
    return { ok: true };
  }

  async stop() {
    if (!this.sdk) return { ok: true };
    try { await this.sdk.stopAsync(); } catch { /* already stopped */ }
    return { ok: true };
  }

  // Stop, rebuild after an error, and start again (optionally lighter).
  async restart(size) {
    if (!this.sdk) return { ok: false };
    await this.stop();
    if (this.status === ProcessingStatus.kError) {
      try { this.sdk.reset(); } catch { /* rebuild below */ }
    }
    if (size) this.size = size;
    this._useCamera();
    this.sdk.start();
    return { ok: true };
  }

  async destroy() {
    if (!this.sdk) return { ok: true };
    const sdk = this.sdk;
    this.sdk = null;
    try { await sdk.stopAsync(); } catch { /* ignore */ }
    try { await sdk.destroy(); } catch { /* ignore */ }
    return { ok: true };
  }

  static cameras() {
    try {
      return SmartSpectraSDK.availableCameras().map((c) => ({ id: c.id, name: c.name, facing: c.facing }));
    } catch {
      return [];
    }
  }
}

module.exports = { NativeMeasurement };
