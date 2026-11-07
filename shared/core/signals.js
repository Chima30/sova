'use strict';

// Turns decoded SmartSpectra metrics into SOVA readings and decides whether
// each one is usable. Rule: a value is shown or acted on only when its
// analysis window has filled, its confidence passes the configured
// threshold, the SDK marks it stable, and it sits inside the documented
// valid range. Otherwise SOVA hides it. Nothing here estimates or fills gaps.

function tsToNumber(ts) {
  if (ts == null) return null;
  if (typeof ts === 'number') return ts;
  if (typeof ts === 'bigint') return Number(ts);
  if (typeof ts.toNumber === 'function') return ts.toNumber();
  const n = Number(ts);
  return Number.isFinite(n) ? n : null;
}

function last(arr) {
  return Array.isArray(arr) && arr.length > 0 ? arr[arr.length - 1] : null;
}

// Pull the newest sample of each signal SOVA uses out of one decoded
// `metrics` payload. Missing signals come back as null.
function extractLatest(metrics) {
  if (!metrics || typeof metrics !== 'object') return {};
  const b = metrics.breathing || {};
  const c = metrics.cardio || {};
  const f = metrics.face || {};

  const br = last(b.rate);
  const pr = last(c.pulseRate);
  const hrv = last(c.hrv);
  const ie = last(b.inhaleExhaleRatio);
  const blink = last(f.blinking);
  const talk = last(f.talking);

  return {
    breathing: br ? { value: br.value, confidence: br.confidence, stable: !!br.stable, tsUs: tsToNumber(br.timestamp) } : null,
    pulse: pr ? { value: pr.value, confidence: pr.confidence, stable: !!pr.stable, tsUs: tsToNumber(pr.timestamp) } : null,
    hrv: hrv ? { value: hrv.rmssd, confidence: hrv.confidence, stable: !!hrv.stable, tsUs: tsToNumber(hrv.timestamp) } : null,
    ieRatio: ie ? { value: ie.value, tsUs: tsToNumber(ie.timestamp) } : null,
    blinking: blink ? { detected: !!blink.detected, stable: !!blink.stable, tsUs: tsToNumber(blink.timestamp) } : null,
    talking: talk ? { detected: !!talk.detected, stable: !!talk.stable, tsUs: tsToNumber(talk.timestamp) } : null,
    breathTrace: Array.isArray(b.upperTrace)
      ? b.upperTrace.map((m) => ({ value: m.value, tsUs: tsToNumber(m.timestamp) }))
      : [],
  };
}

// Is this reading safe to show and act on?
// kind: 'pulse' | 'breathing' | 'hrv'
// elapsedSeconds: time since measurement started (warm-up check)
function checkUsable(kind, reading, elapsedSeconds, signalsCfg) {
  const rule = signalsCfg && signalsCfg[kind];
  if (!rule) return { usable: false, reason: 'unknown-signal' };
  if (!reading || reading.value == null || !Number.isFinite(reading.value)) {
    return { usable: false, reason: 'no-reading' };
  }
  if (elapsedSeconds < rule.warmupSeconds) return { usable: false, reason: 'warming-up' };
  if (!(reading.confidence >= rule.minConfidence)) return { usable: false, reason: 'low-confidence' };
  if (!reading.stable) return { usable: false, reason: 'unstable' };
  if (rule.validMin != null && reading.value < rule.validMin) return { usable: false, reason: 'out-of-range' };
  if (rule.validMax != null && reading.value > rule.validMax) return { usable: false, reason: 'out-of-range' };
  return { usable: true, reason: 'ok' };
}

// Human-facing explanation for a hidden value. Never shows a number.
const HIDDEN_REASON_TEXT = {
  'no-reading': 'Waiting for a reading',
  'warming-up': 'Warming up',
  'low-confidence': 'Signal too weak to show',
  'unstable': 'Hold still for a moment',
  'out-of-range': 'Outside the measurable range',
  'stale': 'No recent reading',
  'unknown-signal': 'Not available',
};

module.exports = { tsToNumber, extractLatest, checkUsable, HIDDEN_REASON_TEXT };
