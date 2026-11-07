'use strict';

// Decides when SOVA should suggest a breathing reset or an eye rest, and
// when it must stay quiet (snooze, meeting, away, quiet hours, cooldown,
// not in a focus block, no reliable baseline).
//
// Every input is a usable reading (already confidence-checked by
// signals.checkUsable). Times are in seconds on one monotonic clock.

class CueEngine {
  constructor(config, sensitivityKey, preset) {
    this.cfg = config;
    const sens = config.sensitivity[sensitivityKey] || config.sensitivity.standard;
    this.mult = sens.multiplier;
    this.preset = preset;
    this.baseline = null;

    this.samples = [];            // { t, tense }
    this.talk = [];               // { t, detected }
    this.blinks = [];             // t of each blink onset
    this.lastBlinkDetected = false;

    this.lastCueAt = -Infinity;
    this.snoozedUntil = -Infinity;
    this.meetingUntil = -Infinity;
    this.manualMeeting = false;
    this.lastFaceAt = null;
    this.screenSeconds = 0;
    this.lastScreenTick = null;
  }

  setBaseline(baseline) { this.baseline = baseline; }

  // ---- inputs -------------------------------------------------------------

  // kind: 'breathing' | 'pulse' | 'hrv'
  addUsable(kind, value, t) {
    if (!this.baseline || !this.baseline.reliable) return;
    const tense = this.isTense(kind, value);
    if (tense === null) return;
    this.samples.push({ t, tense });
    this._trim(t);
  }

  isTense(kind, value) {
    const c = this.cfg.cues.tension;
    const b = this.baseline && this.baseline[kind];
    if (!b || !b.reliable || b.value == null) return null;
    if (kind === 'breathing') return value > b.value * (1 + (c.breathingRisePct * this.mult) / 100);
    if (kind === 'pulse') return value > b.value + c.pulseRiseBpm * this.mult;
    if (kind === 'hrv') return value < b.value * (1 - (c.hrvDropPct * this.mult) / 100);
    return null;
  }

  addTalking(detected, t) {
    this.talk.push({ t, detected });
    const w = this.cfg.smartPauses.meetingTalkingWindowSeconds;
    while (this.talk.length && this.talk[0].t < t - w) this.talk.shift();
    const covered = this.talk.length > 0 && t - this.talk[0].t >= w * 0.75;
    const frac = this.talk.filter((s) => s.detected).length / Math.max(1, this.talk.length);
    if (covered && frac >= this.cfg.smartPauses.meetingTalkingFraction) {
      this.meetingUntil = t + this.cfg.smartPauses.meetingHoldMinutes * 60;
    }
  }

  addBlink(detected, t) {
    if (detected && !this.lastBlinkDetected) this.blinks.push(t);
    this.lastBlinkDetected = detected;
    const w = this.cfg.cues.eyeRest.blinkWindowSeconds;
    while (this.blinks.length && this.blinks[0] < t - w) this.blinks.shift();
  }

  faceSeen(t) { this.lastFaceAt = t; }

  // Call regularly while in a focus block to count screen time.
  tickScreen(t, inFocus) {
    if (this.lastScreenTick != null && inFocus && !this.isAway(t)) {
      this.screenSeconds += Math.max(0, Math.min(5, t - this.lastScreenTick));
    }
    this.lastScreenTick = t;
  }

  // ---- user actions -------------------------------------------------------

  snoozeFlow(t) { this.snoozedUntil = t + this.cfg.cues.flowSnoozeMinutes * 60; }
  setManualMeeting(on) { this.manualMeeting = on; }
  markCueShown(t) { this.lastCueAt = t; this.samples = []; }
  markEyeRestTaken() { this.screenSeconds = 0; }

  // ---- state --------------------------------------------------------------

  isAway(t) {
    if (this.lastFaceAt == null) return false;
    return t - this.lastFaceAt >= this.cfg.smartPauses.awayAfterSeconds;
  }

  inMeeting(t) { return this.manualMeeting || t < this.meetingUntil; }

  blinksPerMinute(t) {
    const w = this.cfg.cues.eyeRest.blinkWindowSeconds;
    if (this.lastScreenTick == null || this.screenSeconds < w) return null;
    return (this.blinks.filter((b) => b >= t - w).length / w) * 60;
  }

  // Why cues are currently held back, or null if none.
  suppression(t, { inFocus, quietHours }) {
    if (!inFocus) return 'not-focus';
    if (quietHours) return 'quiet-hours';
    if (t < this.snoozedUntil) return 'snoozed';
    if (this.inMeeting(t)) return 'meeting';
    if (this.isAway(t)) return 'away';
    if (t - this.lastCueAt < this.cfg.cues.cooldownMinutes * 60) return 'cooldown';
    // Checked last: without a baseline only time-based eye rests may fire.
    if (!this.baseline || !this.baseline.reliable) return 'no-baseline';
    return null;
  }

  // Returns 'tension' | 'eye-rest' | null.
  evaluate(t, ctx) {
    if (this.suppression(t, ctx)) return null;
    if (this.tensionDue(t)) return 'tension';
    if (this.eyeRestDue(t)) return 'eye-rest';
    return null;
  }

  tensionDue(t) {
    const c = this.cfg.cues.tension;
    this._trim(t);
    if (this.samples.length < 10) return false;
    if (t - this.samples[0].t < c.windowSeconds * 0.9) return false;
    const frac = this.samples.filter((s) => s.tense).length / this.samples.length;
    return frac >= c.requiredFraction;
  }

  eyeRestDue(t) {
    const every = (this.preset && this.preset.eyeRestEveryMinutes) || this.cfg.cues.eyeRest.minScreenMinutes;
    const mins = this.screenSeconds / 60;
    if (mins < every) return false;
    const bpm = this.blinksPerMinute(t);
    const base = this.baseline && this.baseline.blinksPerMinute;
    // Without a reliable blink baseline, fall back to a plain time reminder.
    if (bpm == null || base == null) return true;
    if (bpm < base * (1 - this.cfg.cues.eyeRest.blinkDropPct / 100)) return true;
    return mins >= every * 2;
  }

  _trim(t) {
    const w = this.cfg.cues.tension.windowSeconds;
    while (this.samples.length && this.samples[0].t < t - w) this.samples.shift();
  }
}

// Quiet hours like { start: '21:00', end: '08:00' } (may cross midnight).
function inQuietHours(date, quiet) {
  if (!quiet || !quiet.enabled) return false;
  const toMin = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
  const now = date.getHours() * 60 + date.getMinutes();
  const a = toMin(quiet.start);
  const b = toMin(quiet.end);
  return a <= b ? now >= a && now < b : now >= a || now < b;
}

module.exports = { CueEngine, inQuietHours };
