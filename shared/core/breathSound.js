'use strict';

// Breath sound analysis for breathing resets (optional, microphone).
// The microphone tells SOVA WHEN a breath was audible and for how long; the
// camera's breathing waveform (or, without it, the guide the user follows)
// tells it whether that breath was IN or OUT. Audio is analysed live as a
// loudness number per frame and never recorded.

function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const DEFAULTS = {
  calibrateSeconds: 3,   // quiet room measurement before the reset starts
  onDb: 7,               // a breath starts this far above the noise floor
  offDb: 4,              // and ends when it falls back below this
  minEvent: 0.35,        // shorter sounds are clicks, not breaths
  maxEvent: 14,          // longer sounds are background noise
  mergeGap: 0.2,         // tiny dips inside one breath don't split it
};

class BreathSoundDetector {
  constructor(opts = {}) {
    this.o = { ...DEFAULTS, ...opts };
    this.cal = [];
    this.calStart = null;
    this.floor = null;
    this.events = [];
    this.rejectedLong = 0;
    this.open = null;      // { start, lastLoud, peak }
  }

  get calibrated() { return this.floor != null; }

  // t: seconds (monotonic), db: band loudness in dBFS for this frame.
  push(t, db) {
    if (!Number.isFinite(db)) return;
    if (this.floor == null) {
      if (this.calStart == null) this.calStart = t;
      this.cal.push(db);
      if (t - this.calStart >= this.o.calibrateSeconds && this.cal.length >= 10) this.floor = median(this.cal);
      return;
    }
    const on = this.floor + this.o.onDb;
    const off = this.floor + this.o.offDb;
    if (!this.open) {
      if (db >= on) this.open = { start: t, lastLoud: t, peak: db };
      else if (db < this.floor + 1) this.floor = this.floor * 0.995 + db * 0.005; // follow a slowly changing room
      return;
    }
    if (db >= off) {
      this.open.lastLoud = t;
      this.open.peak = Math.max(this.open.peak, db);
    } else if (t - this.open.lastLoud >= this.o.mergeGap) {
      this._close();
    }
  }

  _close() {
    const e = this.open;
    this.open = null;
    const duration = e.lastLoud - e.start;
    if (duration < this.o.minEvent) return;
    if (duration > this.o.maxEvent) { this.rejectedLong += 1; return; }
    this.events.push({ start: e.start, end: e.lastLoud, duration, peakDb: e.peak });
  }

  finish() { if (this.open) this._close(); return this.events; }
}

// ---- Phase labelling ------------------------------------------------------

// Does the camera breathing waveform go UP or DOWN on inhale? The sign
// depends on the SDK's trace convention, so SOVA learns it from the reset
// itself: the user follows the guide, so guide phases and waveform slope
// should line up. Returns +1, -1, or null when the match is too weak.
function cameraSign(trace, guidePhaseAt) {
  let agree = 0, total = 0;
  for (let i = 1; i < trace.length; i++) {
    const slope = trace[i].value - trace[i - 1].value;
    const g = guidePhaseAt((trace[i].t + trace[i - 1].t) / 2);
    const want = g === 'inhale' ? 1 : g === 'exhale' ? -1 : 0;
    if (!want || slope === 0) continue;
    agree += Math.sign(slope) === want ? 1 : -1;
    total += 1;
  }
  if (total < 20) return null;
  const r = agree / total;
  if (Math.abs(r) < 0.2) return null;
  return r > 0 ? 1 : -1;
}

function valueNear(trace, t) {
  let best = null;
  for (const p of trace) if (best == null || Math.abs(p.t - t) < Math.abs(best.t - t)) best = p;
  return best && Math.abs(best.t - t) <= 0.6 ? best.value : null;
}

// Label each sound event 'inhale' | 'exhale' | 'unknown'.
function labelEvents(events, { trace, sign, guidePhaseAt }) {
  return events.map((e) => {
    let phase = null;
    let by = 'guide';
    if (trace && trace.length && sign) {
      const a = valueNear(trace, e.start);
      const b = valueNear(trace, e.end);
      if (a != null && b != null && a !== b) { phase = sign * (b - a) > 0 ? 'inhale' : 'exhale'; by = 'camera'; }
    }
    if (!phase) {
      const g = guidePhaseAt((e.start + e.end) / 2);
      phase = g === 'inhale' || g === 'exhale' ? g : 'unknown';
      by = 'guide';
    }
    return { ...e, phase, by };
  });
}

// ---- Results ----------------------------------------------------------------

function summarize(labelled, { pattern, seconds, rejectedLong = 0 }) {
  const cycle = pattern.inhale + (pattern.hold || 0) + pattern.exhale + (pattern.holdAfterExhale || 0);
  const guided = Math.max(1, Math.floor(seconds / cycle));
  const ex = labelled.filter((e) => e.phase === 'exhale');
  const inh = labelled.filter((e) => e.phase === 'inhale');
  const byCamera = labelled.filter((e) => e.by === 'camera').length;
  const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const r1 = (v) => Math.round(v * 10) / 10;

  const out = {
    guidedBreaths: guided,
    heardExhales: ex.length,
    heardInhales: inh.length,
    targetExhale: pattern.exhale,
    phaseSource: byCamera >= labelled.length / 2 && labelled.length ? 'camera' : 'guide',
    noisyRoom: rejectedLong >= 2,
    enough: ex.length >= 3,
    lines: [],
  };

  if (!out.enough) {
    out.lines.push(`SOVA heard ${ex.length} of about ${guided} exhales, too few to measure.`);
    out.lines.push(out.noisyRoom
      ? 'The room seemed noisy. Try somewhere quieter, or move closer to the microphone.'
      : 'Try breathing out gently through your mouth, or move closer to the microphone.');
    return out;
  }

  const durations = ex.map((e) => e.duration);
  out.avgExhale = r1(avg(durations));
  out.lines.push(`Your exhales averaged ${out.avgExhale} s against a ${pattern.exhale} s target (${ex.length} of about ${guided} heard).`);

  if (ex.length >= 4) {
    const half = Math.floor(ex.length / 2);
    out.firstHalfExhale = r1(avg(durations.slice(0, half)));
    out.secondHalfExhale = r1(avg(durations.slice(half)));
    const diff = out.secondHalfExhale - out.firstHalfExhale;
    if (Math.abs(diff) >= 0.4) {
      out.lines.push(diff > 0
        ? `They got longer as the reset went on: ${out.firstHalfExhale} s early, ${out.secondHalfExhale} s later.`
        : `They got shorter towards the end: ${out.firstHalfExhale} s early, ${out.secondHalfExhale} s later.`);
    }
    const mean = avg(durations);
    const sd = Math.sqrt(avg(durations.map((d) => (d - mean) ** 2)));
    out.steadiness = r1(sd);
    out.lines.push(sd / mean < 0.2 ? 'Your exhales were steady from breath to breath.' : 'Your exhale length varied from breath to breath.');
  }

  if (inh.length >= 3) {
    out.avgInhale = r1(avg(inh.map((e) => e.duration)));
    out.lines.push(`Audible inhales averaged ${out.avgInhale} s (target ${pattern.inhale} s).`);
  } else {
    out.lines.push('Inhales were mostly silent, which is normal when breathing in through the nose.');
  }
  return out;
}

module.exports = { BreathSoundDetector, cameraSign, labelEvents, summarize, median };
