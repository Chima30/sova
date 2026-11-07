'use strict';

// Pomodoro session state machine with adaptive breaks.
// phases: 'focus' -> 'break' -> 'focus' ... -> 'done'
// Pause reasons (manual, away, reset) stop the clock; the timer never runs
// on wall-clock jumps, only on ticks the caller supplies.

class SessionEngine {
  constructor(config, preset) {
    this.cfg = config;
    this.preset = preset;
    this.block = 1;
    this.phase = 'focus';
    this.remaining = preset.focusMinutes * 60;
    this.pauses = new Set();
    this.blockCues = 0;
    this.blockTenseSeconds = 0;
    this.log = [];             // events for the session record
    this.completedFocusSeconds = 0;
  }

  get paused() { return this.pauses.size > 0; }
  get done() { return this.phase === 'done'; }

  pause(reason) { this.pauses.add(reason); }
  resume(reason) { this.pauses.delete(reason); }

  noteCue() { this.blockCues += 1; }
  noteTense(seconds) { this.blockTenseSeconds += seconds; }

  // Advance by dt seconds. Returns a transition event or null.
  tick(dt) {
    if (this.done || this.paused || dt <= 0) return null;
    this.remaining -= dt;
    if (this.phase === 'focus') this.completedFocusSeconds += dt;
    if (this.remaining > 0) return null;
    return this._advance();
  }

  // Break length adapts to how the block went.
  nextBreakSeconds() {
    const b = this.cfg.breaks;
    const base = this.preset.breakMinutes;
    let mins = base;
    if (this.blockCues > 0) mins = base * (1 + b.tenseExtraPct / 100);
    else mins = base * (1 - b.calmReducePct / 100);
    mins = Math.max(b.minBreakMinutes, Math.round(mins));
    return mins * 60;
  }

  skipPhase() { return this._advance(); }

  _advance() {
    if (this.phase === 'focus') {
      const ev = { type: 'block-end', block: this.block, cues: this.blockCues };
      this.log.push(ev);
      if (this.block >= this.preset.blocks) {
        this.phase = 'done';
        this.remaining = 0;
        return { ...ev, next: 'done' };
      }
      this.phase = 'break';
      this.remaining = this.nextBreakSeconds();
      const adaptive = this.remaining !== this.preset.breakMinutes * 60;
      return { ...ev, next: 'break', breakSeconds: this.remaining, adaptive };
    }
    if (this.phase === 'break') {
      this.block += 1;
      this.phase = 'focus';
      this.remaining = this.preset.focusMinutes * 60;
      this.blockCues = 0;
      this.blockTenseSeconds = 0;
      return { type: 'break-end', next: 'focus', block: this.block };
    }
    return null;
  }
}

function formatClock(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

module.exports = { SessionEngine, formatClock };
