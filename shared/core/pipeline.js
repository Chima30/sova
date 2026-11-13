'use strict';

// "What SOVA sees": the latest values leaving the SmartSpectra pipeline, one
// row per signal, with the SDK field they come from and what SOVA did with
// them. A value appears only when it passes the same checkUsable gate the
// rest of SOVA uses; otherwise the row says why it is held back. Confidence
// and stability are shown either way, since they describe the signal, not a
// reading.

const { checkUsable, HIDDEN_REASON_TEXT } = require('./signals');

const SIGNALS = [
  { kind: 'breathing', label: 'Breathing', field: 'breathing.rate', unit: 'breaths/min' },
  { kind: 'pulse', label: 'Pulse', field: 'cardio.pulseRate', unit: 'bpm' },
  { kind: 'hrv', label: 'HRV', field: 'cardio.hrv.rmssd', unit: 'ms' },
];

const FACE = [
  { kind: 'blinking', label: 'Blinking', field: 'face.blinking', on: 'Blink', off: 'No blink' },
  { kind: 'talking', label: 'Talking', field: 'face.talking', on: 'Talking', off: 'Quiet' },
];

// reading: the object from extractLatest(); elapsed: seconds since the
// measurement started; ageSeconds: how long ago that reading arrived.
function pipelineRows(reading, elapsed, signalsCfg, ageSeconds = 0) {
  const stale = signalsCfg && Number.isFinite(signalsCfg.staleAfterSeconds) && ageSeconds > signalsCfg.staleAfterSeconds;
  const vitals = SIGNALS.map((s) => {
    const x = reading && reading[s.kind];
    if (!x || stale) {
      const reason = stale ? 'stale' : 'no-reading';
      return { ...s, state: 'waiting', value: null, confidence: null, stable: null, reason, reasonText: HIDDEN_REASON_TEXT[reason] };
    }
    const check = checkUsable(s.kind, x, elapsed, signalsCfg);
    return {
      ...s,
      state: check.usable ? 'used' : 'held',
      value: check.usable ? x.value : null,
      confidence: Number.isFinite(x.confidence) ? Math.round(x.confidence) : null,
      stable: !!x.stable,
      reason: check.reason,
      reasonText: check.usable ? 'Used' : HIDDEN_REASON_TEXT[check.reason],
    };
  });
  const face = FACE.map((f) => {
    const x = reading && reading[f.kind];
    if (!x || stale) return { ...f, state: 'waiting', text: 'Waiting' };
    if (!x.stable) return { ...f, state: 'held', text: 'Settling' };
    return { ...f, state: 'used', text: x.detected ? f.on : f.off };
  });
  return { vitals, face, stale };
}

module.exports = { pipelineRows, SIGNALS, FACE };
