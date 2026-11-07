'use strict';

// Personal baseline for one session. Collects only usable readings during
// the first `durationSeconds` of measurement, then freezes the median of
// each signal. If too few usable samples arrive, the baseline is marked
// unreliable and SOVA asks the user to recalibrate instead of guessing.

function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

class Baseline {
  constructor(cfg) {
    this.durationSeconds = cfg.durationSeconds;
    this.minUsableSamples = cfg.minUsableSamples;
    this.samples = { breathing: [], pulse: [], hrv: [] };
    this.blinkEvents = 0;
    this.blinkSeconds = 0;
    this.frozen = null;
  }

  // elapsedSeconds: seconds since measurement started
  add(kind, value, elapsedSeconds) {
    if (this.frozen) return;
    if (elapsedSeconds > this.durationSeconds) return;
    if (this.samples[kind] && Number.isFinite(value)) this.samples[kind].push(value);
  }

  addBlinkWindow(blinks, seconds) {
    if (this.frozen) return;
    this.blinkEvents += blinks;
    this.blinkSeconds += seconds;
  }

  progress(elapsedSeconds) {
    return Math.max(0, Math.min(1, elapsedSeconds / this.durationSeconds));
  }

  // Call once elapsed >= durationSeconds. Returns the frozen result.
  freeze() {
    if (this.frozen) return this.frozen;
    const out = {};
    for (const kind of Object.keys(this.samples)) {
      const vals = this.samples[kind];
      out[kind] = vals.length >= this.minUsableSamples
        ? { value: median(vals), samples: vals.length, reliable: true }
        : { value: null, samples: vals.length, reliable: false };
    }
    out.blinksPerMinute = this.blinkSeconds >= 60
      ? (this.blinkEvents / this.blinkSeconds) * 60
      : null;
    // The session baseline is reliable when breathing is reliable: it is the
    // signal every tension cue needs. Pulse and HRV add to it when present.
    out.reliable = out.breathing.reliable;
    this.frozen = out;
    return out;
  }
}

module.exports = { Baseline, median };
