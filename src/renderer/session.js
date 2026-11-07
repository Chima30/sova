'use strict';

// A live SOVA focus session: signal check, personal baseline, Pomodoro
// timer, confidence-gated signals, smart pauses, cues and resets.
// Without a key or a connection it runs as a plain timer and says so.

const { $, esc, toast, announce } = require('./dom');
const { Measurement, now } = require('./measurement');
const { checkUsable, HIDDEN_REASON_TEXT } = require('../../shared/core/signals');
const { Baseline } = require('../../shared/core/baseline');
const { CueEngine, inQuietHours } = require('../../shared/core/cueEngine');
const { SessionEngine, formatClock } = require('../../shared/core/sessionEngine');
const { openReset, openEyeRest } = require('./reset');

const SUPPRESSION_TEXT = {
  'not-focus': 'Cues rest during breaks',
  'quiet-hours': 'Quiet hours: cues are off',
  'no-baseline': 'Cues start once your baseline is set',
  snoozed: "Flow mode: cues snoozed",
  meeting: 'Meeting: cues paused',
  away: 'Away: timer paused',
  cooldown: 'Cues are resting after the last one',
};

const RING_C = 2 * Math.PI * 130;

class LiveSession {
  constructor({ config, settings, preset, apiKey, onEnd }) {
    this.config = config;
    this.settings = settings;
    this.preset = preset;
    this.onEnd = onEnd;
    this.startedAtIso = new Date().toISOString();
    this.id = `s_${Date.now().toString(36)}`;
    this.mode = apiKey && navigator.onLine ? 'live' : 'timer';
    this.modeReason = !apiKey ? 'Add your Presage API key in Settings for live readings.' : (!navigator.onLine ? 'You are offline, so live readings are off.' : '');

    const sens = settings.sensitivity || preset.sensitivity;
    this.engine = new SessionEngine(config, preset);
    this.cue = new CueEngine(config, sens, preset);
    this.baseline = new Baseline(config.baseline);
    this.baselineResult = null;
    this.baselineStart = null;
    this.blinkOnsets = 0;
    this.lastBlink = false;

    this.usable = { breathing: null, pulse: null, hrv: null };
    this.hidden = { breathing: 'no-reading', pulse: 'no-reading', hrv: 'no-reading' };
    this.trace = [];
    this.ratio = null;
    this.events = [];
    this.pendingCue = null;
    this.inMeetingFlag = false;
    this.awayFlag = false;
    this.cameraPaused = false;
    this.validation = null;
    this.ended = false;
    this.phaseUi = this.mode === 'live' ? 'check' : 'running';

    this.measurement = this.mode === 'live' ? new Measurement({
      apiKey,
      telemetry: settings.telemetry,
      handlers: {
        stream: (s) => { const v = $('#preview'); if (v) { v.srcObject = s; v.play().catch(() => {}); } },
        validation: (v) => this.onValidation(v),
        reading: (r, elapsed) => this.onReading(r, elapsed),
        error: (e) => this.onError(e),
      },
    }) : null;
  }

  // ---- shared with the reset overlay -------------------------------------

  usableSnapshot() {
    const t = now();
    const stale = this.config.signals.staleAfterSeconds;
    const pick = (k) => (this.usable[k] && t - this.usable[k].t <= stale ? this.usable[k].value : null);
    return { breathing: pick('breathing'), pulse: pick('pulse'), hrv: pick('hrv') };
  }

  breathingUsable() { return this.usableSnapshot().breathing != null; }
  latestRatio() { return this.ratio && now() - this.ratio.t <= this.config.signals.staleAfterSeconds ? this.ratio.value : null; }

  recentTrace(seconds) {
    if (!this.breathingUsable() || !this.trace.length) return [];
    const end = this.trace[this.trace.length - 1].tsUs;
    return this.trace.filter((p) => end - p.tsUs <= seconds * 1e6);
  }

  // ---- lifecycle ----------------------------------------------------------

  async begin() {
    this.render();
    this.lastTick = now();
    this.timer = setInterval(() => this.tick(), 1000);
    this.onOffline = () => this.fallbackToTimer('You went offline, so live readings stopped. The timer keeps running.');
    window.addEventListener('offline', this.onOffline);
    if (this.measurement) {
      try {
        await this.measurement.start();
      } catch (e) {
        this.fallbackToTimer(e && e.message ? `Couldn't start the camera: ${e.message}` : "Couldn't start live readings.");
      }
    }
  }

  startFocus() {
    this.phaseUi = 'running';
    this.baselineStart = this.measurement ? this.measurement.elapsed() : null;
    this.log('session-start', { mode: this.mode });
    this.render();
    announce('Focus session started');
  }

  async fallbackToTimer(message) {
    if (this.mode === 'timer') return;
    this.mode = 'timer';
    this.modeReason = message;
    if (this.measurement) { await this.measurement.stop(); this.measurement.destroy(); this.measurement = null; }
    if (this.phaseUi === 'check') this.startFocus(); else this.render();
  }

  log(type, extra = {}) {
    const ev = { type, at: new Date().toISOString(), ...extra };
    this.events.push(ev);
    return ev;
  }

  // ---- SDK events -----------------------------------------------------------

  onValidation(v) {
    this.validation = v;
    if (v.name !== 'kNoFaceFound') this.cue.faceSeen(now());
    const tip = $('#quality-tip');
    if (tip) tip.textContent = v.tip;
    const dot = $('#quality-dot');
    if (dot) dot.className = `dot${v.ok ? '' : ' warn'}`;
    const go = $('#check-start');
    if (go && v.ok) go.disabled = false;
  }

  onError(e) {
    if (e.code === 5) return this.fallbackToTimer(e.text);
    if (e.code === 2 || e.code === 4 || e.code === 7) return this.fallbackToTimer(e.text);
    toast({ title: 'Live readings hit a problem', body: e.text, actions: [{ label: 'OK' }] });
  }

  onReading(r, elapsed) {
    const t = now();
    const cfg = this.config.signals;
    for (const kind of ['breathing', 'pulse', 'hrv']) {
      const check = checkUsable(kind, r[kind], elapsed, cfg);
      if (check.usable) {
        this.usable[kind] = { value: r[kind].value, t };
        if (this.phaseUi === 'running') {
          const be = elapsed - (this.baselineStart || 0);
          if (!this.baselineResult) this.baseline.add(kind, r[kind].value, be);
          else this.cue.addUsable(kind, r[kind].value, t);
        }
      } else if (r[kind]) {
        this.hidden[kind] = check.reason;
      }
    }
    if (r.ieRatio) this.ratio = { value: r.ieRatio.value, t };
    if (r.breathTrace && r.breathTrace.length) {
      this.trace.push(...r.breathTrace.filter((p) => p.tsUs != null));
      const end = this.trace[this.trace.length - 1].tsUs;
      while (this.trace.length && end - this.trace[0].tsUs > 40e6) this.trace.shift();
    }
    if (r.talking && r.talking.stable) this.cue.addTalking(r.talking.detected, t);
    if (r.blinking && r.blinking.stable) {
      this.cue.addBlink(r.blinking.detected, t);
      if (this.phaseUi === 'running' && !this.baselineResult && r.blinking.detected && !this.lastBlink) this.blinkOnsets += 1;
      this.lastBlink = r.blinking.detected;
    }
  }

  // ---- clock ----------------------------------------------------------------

  async tick() {
    if (this.ended) return;
    const t = now();
    const dt = t - this.lastTick;
    this.lastTick = t;
    if (this.phaseUi !== 'running') return this.renderCheck();

    const live = this.mode === 'live' && this.measurement && !this.cameraPaused;
    if (!live) this.cue.faceSeen(t);

    // Baseline: freeze after its window.
    if (live && !this.baselineResult && this.measurement.elapsed() - this.baselineStart >= this.config.baseline.durationSeconds) {
      this.baseline.addBlinkWindow(this.blinkOnsets, this.config.baseline.durationSeconds);
      this.baselineResult = this.baseline.freeze();
      this.cue.setBaseline(this.baselineResult);
      this.log('baseline', { reliable: this.baselineResult.reliable });
      if (!this.baselineResult.reliable) announce('Baseline could not be set. Check lighting and position, then recalibrate.');
    }

    // Away pause.
    const away = live && this.cue.isAway(t);
    if (away && !this.awayFlag) { this.awayFlag = true; this.engine.pause('away'); this.log('away'); }
    if (!away && this.awayFlag) { this.awayFlag = false; this.engine.resume('away'); }

    // Meeting (talking detection or manual).
    const meeting = this.cue.inMeeting(t);
    if (meeting && !this.inMeetingFlag) this.log('meeting', { manual: this.cue.manualMeeting });
    this.inMeetingFlag = meeting;

    const inFocus = this.engine.phase === 'focus' && !this.engine.paused;
    this.cue.tickScreen(t, inFocus);

    const transition = this.engine.tick(dt);
    if (transition) this.onTransition(transition);
    if (this.engine.done) return this.end(true);

    // Cues.
    const ctx = { inFocus, quietHours: inQuietHours(new Date(), this.settings.quietHours) };
    // Without a reliable baseline (or in timer mode) only time-based eye
    // rests can fire; every other suppression still applies first.
    const sup = this.cue.suppression(t, ctx);
    if (!this.pendingCue) {
      let due = null;
      if (!sup) due = live ? this.cue.evaluate(t, ctx) : null;
      else if (sup === 'no-baseline' && this.cue.eyeRestDue(t)) due = 'eye-rest';
      if (due) this.pendingCue = { type: due, since: t };
    } else if (sup && sup !== 'no-baseline') {
      this.pendingCue = null;
    } else {
      const idle = await window.sova.idleSeconds().catch(() => 999);
      const waited = t - this.pendingCue.since;
      if (idle >= this.config.cues.typingPauseSeconds || waited >= this.config.cues.typingPauseMaxWaitSeconds) {
        this.showCue(this.pendingCue.type, t);
        this.pendingCue = null;
      }
    }

    this.renderRunning();
  }

  onTransition(tr) {
    if (tr.next === 'break') {
      const mins = Math.round(tr.breakSeconds / 60);
      const why = tr.adaptive ? (tr.cues > 0 ? ' A little longer after a tense block.' : ' A little shorter after a calm block.') : '';
      toast({ title: `Break time: ${mins} min`, body: `Step away from the screen.${why}`, actions: [{ label: 'OK', primary: true }] });
      this.log('break', { minutes: mins, adaptive: tr.adaptive });
    } else if (tr.next === 'focus') {
      toast({ title: `Focus block ${tr.block} of ${this.preset.blocks}`, actions: [{ label: 'OK', primary: true }] });
    }
  }

  showCue(type, t) {
    this.cue.markCueShown(t);
    if (type === 'tension') {
      this.engine.noteCue();
      this.log('cue-tension');
      toast({
        title: 'Your breathing has been faster than usual for a few minutes',
        body: 'Take a short reset whenever you are ready.',
        actions: [
          { label: `Start ${this.config.defaultBreathingSeconds}-second reset`, primary: true, onClick: () => this.startReset() },
          { label: 'Not now' },
        ],
      });
    } else {
      this.log('cue-eye-rest');
      toast({
        title: 'Time to rest your eyes',
        body: 'You have been looking at the screen for a while. Look at something far away for 20 seconds.',
        actions: [
          { label: 'Start 20-second look-away', primary: true, onClick: () => this.startEyeRest() },
          { label: 'Later' },
        ],
      });
    }
  }

  // ---- user actions -------------------------------------------------------

  startReset(seconds) {
    const pattern = this.currentPattern();
    this.engine.pause('reset');
    openReset({
      config: this.config,
      settings: this.settings,
      pattern,
      seconds: seconds || this.config.defaultBreathingSeconds,
      live: this.mode === 'live' && !this.cameraPaused ? this : null,
      onDone: (res) => {
        this.engine.resume('reset');
        const ev = this.log('reset', { seconds: res.seconds, completed: res.completed, pattern: res.patternId, before: res.before, after: null });
        if (this.mode === 'live' && res.before) {
          setTimeout(() => { if (!this.ended) ev.after = this.usableSnapshot(); }, this.config.afterResetWaitSeconds * 1000);
        }
        this.renderRunning();
      },
    });
  }

  startEyeRest() {
    openEyeRest({
      config: this.config,
      onDone: ({ completed }) => { if (completed) { this.cue.markEyeRestTaken(); this.log('eye-rest'); } },
    });
  }

  currentPattern() {
    const id = this.settings.breathingPatternId;
    if (id === 'custom') return { id: 'custom', ...this.settings.customPattern };
    return this.config.breathingPatterns.find((p) => p.id === id) || this.config.breathingPatterns[0];
  }

  async toggleCamera() {
    if (!this.measurement) return;
    this.cameraPaused = !this.cameraPaused;
    if (this.cameraPaused) { await this.measurement.stop(); this.log('camera-paused'); }
    else { await this.measurement.start().catch(() => this.fallbackToTimer("Couldn't restart the camera.")); }
    this.render();
  }

  recalibrate() {
    if (!this.measurement) return;
    this.baseline = new Baseline(this.config.baseline);
    this.baselineResult = null;
    this.blinkOnsets = 0;
    this.baselineStart = this.measurement.elapsed();
    this.cue.setBaseline(null);
    this.log('recalibrate');
    this.render();
  }

  async end(completed) {
    if (this.ended) return;
    this.ended = true;
    clearInterval(this.timer);
    window.removeEventListener('offline', this.onOffline);
    if (this.measurement) { await this.measurement.stop(); this.measurement.destroy(); }
    this.log('session-end', { completed });
    const record = {
      id: this.id,
      app: 'SOVA',
      presetId: this.preset.id,
      presetName: this.preset.name,
      startedAt: this.startedAtIso,
      endedAt: new Date().toISOString(),
      mode: this.mode,
      focusSeconds: Math.round(this.engine.completedFocusSeconds),
      blocksCompleted: this.engine.log.filter((e) => e.type === 'block-end').length,
      blocksPlanned: this.preset.blocks,
      baseline: this.baselineResult,
      events: this.events,
      reflection: null,
    };
    this.onEnd && this.onEnd(record);
  }

  // ---- rendering ------------------------------------------------------------

  render() {
    if (this.phaseUi === 'check') return this.renderCheckShell();
    this.renderRunningShell();
  }

  renderCheckShell() {
    $('#view').innerHTML = `
      <h1>Signal check</h1>
      <p class="lead">Before ${esc(this.preset.name)} starts: device on a steady surface, even light on your face, no bright window behind you, face and chest in view. Stay still and avoid talking while SOVA reads your baseline.</p>
      <div class="card stack" style="align-items: center">
        <video id="preview" class="preview" autoplay playsinline muted aria-label="Camera preview, shown only during the signal check"></video>
        <div class="row"><span class="dot warn" id="quality-dot"></span><span id="quality-tip">Starting the camera</span></div>
        <div class="row">
          <button class="btn primary big" id="check-start" disabled>Start ${esc(this.preset.name)}</button>
          <button class="btn" id="check-skip">Start anyway</button>
          <button class="btn" id="check-cancel">Cancel</button>
        </div>
        <p class="small">The video stays on this device and is never saved.</p>
      </div>`;
    $('#check-start').addEventListener('click', () => this.startFocus());
    $('#check-skip').addEventListener('click', () => this.startFocus());
    $('#check-cancel').addEventListener('click', () => this.end(false));
    if (this.validation) this.onValidation(this.validation);
  }

  renderCheck() { /* updates arrive through onValidation */ }

  renderRunningShell() {
    const live = this.mode === 'live';
    $('#view').innerHTML = `
      <div class="row" style="justify-content: space-between; margin-bottom: 20px">
        <h1 style="margin: 0">${esc(this.preset.name)}</h1>
        <div class="row">
          ${live ? `<span class="pill"><span class="dot" id="cam-dot"></span><span id="cam-text">Camera on during this session</span></span>
          <button class="btn" id="cam-toggle">${this.cameraPaused ? 'Resume camera' : 'Pause camera'}</button>` : ''}
        </div>
      </div>
      ${!live ? `<div class="banner info" style="margin-bottom: 18px"><span class="dot warn"></span><span>Plain timer mode. ${esc(this.modeReason)}</span></div>` : ''}
      <div id="baseline-banner"></div>
      <div class="session">
        <section class="card session-main">
          <div class="row small" style="align-self: stretch; justify-content: space-between"><span id="block-label"></span><span id="status-label"></span></div>
          <div class="ring">
            <svg width="300" height="300" viewBox="0 0 300 300" role="img" aria-label="Focus timer">
              <circle cx="150" cy="150" r="130" stroke="#25314A" stroke-width="14" fill="none"></circle>
              <circle id="ring-arc" cx="150" cy="150" r="130" stroke="#7FA6E8" stroke-width="14" fill="none" stroke-linecap="round" stroke-dasharray="${RING_C}" stroke-dashoffset="0"></circle>
            </svg>
            <div class="ring-center"><span class="clock" id="clock">--:--</span><span class="small" id="clock-sub"></span></div>
          </div>
          <div class="row" style="justify-content: center">
            <button class="btn primary" id="pause">Pause session</button>
            <button class="btn" id="flow">I'm in flow, snooze cues</button>
            <button class="btn" id="meeting" aria-pressed="false">Meeting pause</button>
          </div>
          <div class="row" style="justify-content: center">
            <button class="btn" id="reset">Breathing reset</button>
            <button class="btn" id="eyes">Eye rest</button>
            <button class="btn" id="skip">Skip to next phase</button>
            <button class="btn warn" id="end">End session</button>
          </div>
        </section>
        <aside class="session-side">
          <h2 style="margin: 0">${live ? 'Live signals vs your baseline' : 'Session'}</h2>
          ${live ? `
          <div class="card signal"><div class="signal-head"><span>Breathing</span><span id="s-breathing-note"></span></div><div id="s-breathing"></div>
            <canvas class="trace" id="s-trace" width="600" height="56" aria-label="Live breathing line"></canvas></div>
          <div class="card signal"><div class="signal-head"><span>Pulse</span><span id="s-pulse-note"></span></div><div id="s-pulse"></div></div>
          <div class="card signal"><div class="signal-head"><span>HRV (RMSSD)</span><span id="s-hrv-note"></span></div><div id="s-hrv"></div></div>
          <div class="pill" style="align-self: flex-start"><span class="dot" id="quality-dot"></span><span id="quality-tip">${esc(this.validation ? this.validation.tip : 'Waiting for signal')}</span></div>
          <p class="small">Camera-based estimates for self-reflection, not medical readings. Values are hidden whenever the signal is not reliable.</p>` : `
          <div class="card small">Time-based eye-rest reminders still run. Breathing resets work as guided exercises without live feedback.</div>`}
          <p class="small" id="cue-state"></p>
        </aside>
      </div>`;

    $('#pause').addEventListener('click', () => {
      if (this.engine.pauses.has('manual')) { this.engine.resume('manual'); this.log('resume'); }
      else { this.engine.pause('manual'); this.log('pause'); }
      this.renderRunning();
    });
    $('#flow').addEventListener('click', () => { this.cue.snoozeFlow(now()); this.log('flow-snooze'); this.pendingCue = null; toast({ title: `Cues snoozed for ${this.config.cues.flowSnoozeMinutes} minutes`, actions: [{ label: 'OK' }] }); });
    $('#meeting').addEventListener('click', () => { this.cue.setManualMeeting(!this.cue.manualMeeting); this.renderRunning(); });
    $('#reset').addEventListener('click', () => this.startReset());
    $('#eyes').addEventListener('click', () => this.startEyeRest());
    $('#skip').addEventListener('click', () => { const tr = this.engine.skipPhase(); if (tr) this.onTransition(tr); if (this.engine.done) this.end(true); else this.renderRunning(); });
    $('#end').addEventListener('click', () => this.end(false));
    const cam = $('#cam-toggle');
    if (cam) cam.addEventListener('click', () => this.toggleCamera());
    this.renderRunning();
  }

  renderRunning() {
    if (this.phaseUi !== 'running' || !$('#clock')) return;
    const e = this.engine;
    const total = e.phase === 'focus' ? this.preset.focusMinutes * 60 : e.nextBreakSecondsCache || e.remaining;
    if (e.phase === 'break' && !e.nextBreakSecondsCache) e.nextBreakSecondsCache = e.remaining;
    if (e.phase === 'focus') e.nextBreakSecondsCache = null;
    $('#clock').textContent = formatClock(e.remaining);
    $('#clock-sub').textContent = e.paused ? `Paused${e.pauses.has('away') ? ': you stepped away' : ''}` : (e.phase === 'focus' ? 'left in this focus block' : 'left in this break');
    $('#block-label').textContent = `${e.phase === 'focus' ? 'Focus' : 'Break'} · block ${e.block} of ${this.preset.blocks}`;
    $('#status-label').textContent = `Focused ${Math.floor(e.completedFocusSeconds / 60)} min`;
    const frac = Math.max(0, Math.min(1, e.remaining / Math.max(1, total)));
    $('#ring-arc').setAttribute('stroke-dashoffset', String(RING_C * (1 - frac)));
    $('#pause').textContent = e.pauses.has('manual') ? 'Resume session' : 'Pause session';
    $('#meeting').setAttribute('aria-pressed', String(this.cue.manualMeeting));
    $('#meeting').textContent = this.cue.manualMeeting ? 'End meeting pause' : 'Meeting pause';

    const t = now();
    const ctx = { inFocus: e.phase === 'focus' && !e.paused, quietHours: inQuietHours(new Date(), this.settings.quietHours) };
    const sup = this.cue.suppression(t, ctx);
    $('#cue-state').textContent = this.mode === 'live' ? (sup ? SUPPRESSION_TEXT[sup] : 'Cues are on') : '';

    if (this.mode !== 'live') return;
    const bb = $('#baseline-banner');
    if (!this.baselineResult) {
      const p = this.baselineStart == null ? 0 : Math.min(1, (this.measurement ? this.measurement.elapsed() - this.baselineStart : 0) / this.config.baseline.durationSeconds);
      bb.innerHTML = `<div class="banner info" style="margin-bottom: 18px"><span>Setting your baseline. Sit naturally and avoid talking.</span><div class="progress" style="flex: 1; min-width: 160px"><div style="width: ${Math.round(p * 100)}%"></div></div></div>`;
    } else if (!this.baselineResult.reliable) {
      bb.innerHTML = `<div class="banner" style="margin-bottom: 18px"><span>SOVA couldn't set a reliable baseline, so tension cues are off. Check lighting and position, then recalibrate.</span><button class="btn" id="recal">Recalibrate</button></div>`;
      $('#recal').addEventListener('click', () => this.recalibrate());
    } else {
      bb.innerHTML = '';
    }

    const snap = this.usableSnapshot();
    const base = this.baselineResult || {};
    this.renderSignal('breathing', snap.breathing, base.breathing, 'breaths/min', 0);
    this.renderSignal('pulse', snap.pulse, base.pulse, 'bpm', 0);
    this.renderSignal('hrv', snap.hrv, base.hrv, 'ms', 0);
    this.drawTrace();
    const camText = $('#cam-text');
    if (camText) camText.textContent = this.cameraPaused ? 'Camera paused' : 'Camera on during this session';
    const camDot = $('#cam-dot');
    if (camDot) camDot.className = `dot${this.cameraPaused ? ' warn' : ''}`;
  }

  renderSignal(kind, value, base, unit, digits) {
    const el = $(`#s-${kind}`);
    const note = $(`#s-${kind}-note`);
    if (!el) return;
    if (value == null) {
      el.innerHTML = `<div class="signal-hidden">${esc(HIDDEN_REASON_TEXT[this.hidden[kind]] || 'Waiting for a reading')}</div>`;
      note.textContent = '';
      return;
    }
    const baseText = base && base.reliable ? ` · baseline ${base.value.toFixed(digits)}` : '';
    el.innerHTML = `<div class="signal-value"><span class="num">${esc(value.toFixed(digits))}</span><span class="small">${esc(unit)}${esc(baseText)}</span></div>`;
    let rel = '';
    if (base && base.reliable) {
      const tense = this.cue.isTense(kind, value);
      if (kind === 'hrv') rel = tense ? 'Lower than your baseline' : 'Near your baseline';
      else rel = tense ? 'Higher than your baseline' : 'Near your baseline';
    }
    note.textContent = rel;
    note.style.color = rel.startsWith('Near') || !rel ? 'var(--muted)' : 'var(--attention)';
  }

  drawTrace() {
    const c = $('#s-trace');
    if (!c) return;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    const pts = this.recentTrace(15);
    if (pts.length < 4) return;
    let min = Infinity, max = -Infinity;
    for (const p of pts) { min = Math.min(min, p.value); max = Math.max(max, p.value); }
    const span = max - min || 1;
    const end = pts[pts.length - 1].tsUs;
    ctx.strokeStyle = '#7FA6E8';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    pts.forEach((p, i) => {
      const x = c.width - ((end - p.tsUs) / 1e6 / 15) * c.width;
      const y = c.height - 6 - ((p.value - min) / span) * (c.height - 12);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }
}

module.exports = { LiveSession };
