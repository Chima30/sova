'use strict';

// A live SOVA focus session: signal check, personal baseline, Pomodoro
// timer, confidence-gated signals, smart pauses, cues and resets.
// Without a key or a connection it runs as a plain timer and says so.

const { $, esc, toast, announce, tip } = require('./dom');
const { createMeasurement, now } = require('./measurement');
const { checkUsable, HIDDEN_REASON_TEXT } = require('../../shared/core/signals');
const { Baseline } = require('../../shared/core/baseline');
const { CueEngine, inQuietHours } = require('../../shared/core/cueEngine');
const { SessionEngine, formatClock } = require('../../shared/core/sessionEngine');
const { openReset, openEyeRest } = require('./reset');
const { BreathLines, levelFromTrace } = require('./breathLines');
const { icon } = require('./icons');
const { renderTimeline } = require('./timeline');
const { applyOverrides } = require('../../shared/core/overrides');
const audio = require('./audio');
const { buildPrompt } = require('../../shared/core/aiPrompt');

const AI_LABEL = 'Written by Presage AI from your measured pulse, HRV and breathing. AI can be wrong. Not medical advice.';

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
  constructor({ config, settings, preset, apiKey, onEnd, checkIn = null }) {
    // Personal sensitivity settings are applied on top of the shared config.
    const eff = applyOverrides(config, preset, settings.cueOverrides);
    config = eff.config;
    preset = eff.preset;
    this.config = config;
    this.settings = settings;
    this.preset = preset;
    this.onEnd = onEnd;
    this.checkIn = checkIn;   // how you said you felt on Home, if recent
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
    this.faceVisible = true;     // validation events arrive on change only
    this.metricsCount = 0;
    this.ended = false;
    this.phaseUi = this.mode === 'live' ? 'check' : 'running';

    this.measurement = this.mode === 'live' ? createMeasurement({
      apiKey,
      telemetry: settings.telemetry,
      cameraId: settings.cameraId,
      captureMode: settings.captureMode || 'native',
      handlers: {
        stream: (s) => { const v = $('#preview'); if (v) { v.srcObject = s; v.play().catch(() => {}); } },
        validation: (v) => this.onValidation(v),
        reading: (r, elapsed) => this.onReading(r, elapsed),
        error: (e) => this.onError(e),
        insight: (ev) => this.onInsight(ev),
      },
    }) : null;
    this.pendingAI = new Map();
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

  // Breathing waveform on SOVA's clock, only while breathing is reliable.
  traceTimed() {
    if (!this.breathingUsable() || this.traceClock == null) return [];
    return this.trace.map((p) => ({ t: p.tsUs / 1e6 + this.traceClock, value: p.value }));
  }

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
    if (!this.measurement) {
      this.log('session-start', { mode: this.mode });
      this.log('block-start', { block: 1 });
      this.openWidget();
      this.startSound();
      return;
    }
    // Direct (native) capture: show a framing preview first; the SDK takes
    // the camera when the user presses Start. Window capture: start now.
    if (this.measurement.native) await this.openFramingPreview();
    else await this.startMeasurement();
  }

  async startMeasurement() {
    if (!this.measurement) return;
    try {
      await this.measurement.start();
    } catch (e) {
      if (e && e.retryable) return this.onError({ code: e.code, message: e.message, retryable: true, text: e.message });
      this.fallbackToTimer(e && e.message ? `Couldn't start live readings: ${e.message}` : "Couldn't start live readings.");
    }
  }

  async openFramingPreview() {
    try {
      this.previewStream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { width: { ideal: 640 }, height: { ideal: 480 } } });
      const v = $('#preview');
      if (v) { v.srcObject = this.previewStream; v.play().catch(() => {}); }
      const tip = $('#quality-tip');
      if (tip) tip.textContent = 'Center your face, light in front of you, chest in view. Then press Start.';
      const dot = $('#quality-dot');
      if (dot) dot.className = 'dot live';
    } catch (e) {
      const tip = $('#quality-tip');
      if (tip) tip.textContent = 'Preview unavailable. You can still start: SOVA will guide you with tips.';
    }
    const go = $('#check-start');
    if (go) go.disabled = false;
  }

  closeFramingPreview() {
    if (this.previewStream) { for (const t of this.previewStream.getTracks()) t.stop(); }
    this.previewStream = null;
  }

  async startFocus() {
    this.phaseUi = 'running';
    this.baselineStart = null;   // set by the first steady breathing reading
    this.log('session-start', { mode: this.mode });
    this.log('block-start', { block: 1 });
    this.openWidget();
    this.startSound();
    this.render();
    announce('Focus session started');
    if (this.measurement && this.measurement.native) {
      this.closeFramingPreview();
      // Give the camera driver a moment to release before the SDK opens it.
      await new Promise((r) => setTimeout(r, 400));
      await this.startMeasurement();
    }
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
    console.info('[SOVA] validation', v.name, '-', v.tip);
    this.faceVisible = v.name !== 'kNoFaceFound';
    if (this.faceVisible) this.cue.faceSeen(now());
    // Low frame rate for 8 s: switch the camera to 640x480 once.
    if (v.name === 'kFrameRateTooLow') {
      if (this.slowSince == null) this.slowSince = now();
      clearTimeout(this.slowTimer);
      this.slowTimer = setTimeout(() => {
        if (this.validation && this.validation.name === 'kFrameRateTooLow') this.switchToLightCamera();
      }, 8000);
    } else {
      this.slowSince = null;
      clearTimeout(this.slowTimer);
    }
    const tip = $('#quality-tip');
    if (tip) tip.textContent = v.tip;
    const dot = $('#quality-dot');
    if (dot) dot.className = `dot ${v.ok ? 'live' : 'warn'}`;
    const go = $('#check-start');
    if (go && v.ok) go.disabled = false;
  }

  onError(e) {
    if (e.code === 2 || e.code === 4) return this.fallbackToTimer(e.text);
    if (!e.retryable && (e.code === 5 || e.code === 7)) return this.fallbackToTimer(e.text);
    // Retryable errors (the SDK says so): restart up to 3 times, the second
    // time in the lighter camera mode, then fall back to the plain timer.
    if (e.retryable && this.measurement) {
      this.restarts = (this.restarts || 0) + 1;
      this.log('sdk-restart', { code: e.code, attempt: this.restarts });
      if (this.restarts > 3) return this.fallbackToTimer(e.code === 5 ? e.text : 'Live processing kept stopping on this computer. The timer keeps running.');
      // Network and server errors: same camera mode, longer wait. Others: lighter mode on the 2nd try.
      const net = e.code === 5 || e.code === 6;
      if (this.restarts === 1) toast({ title: 'Reconnecting live readings', body: net ? 'Presage did not respond. Trying again.' : 'Restarting the camera pipeline.', actions: [{ label: 'OK' }] });
      return setTimeout(() => this.switchToLightCamera(!net && this.restarts >= 2, true), net ? 4000 * this.restarts : 2000);
    }
    toast({ title: 'Live readings hit a problem', body: e.text, actions: [{ label: 'OK' }] });
  }

  // Restart the SDK, optionally in the 640x480 camera mode.
  async switchToLightCamera(light = true, afterError = false) {
    if (!this.measurement || this.switchingCamera || this.ended) return;
    const goLight = light && !this.measurement.lightMode;
    if (!goLight && !afterError) return;
    this.switchingCamera = true;
    if (goLight) {
      this.log('camera-light-mode', { afterError });
      toast({
        title: 'Switched to a lighter camera mode',
        body: 'Your webcam could not keep up at full resolution. More light in front of you also helps the frame rate.',
        actions: [{ label: 'OK' }],
      });
    }
    try {
      // A restart interrupts the readings: an unfinished baseline starts over.
      if (!this.baselineResult) this.resetBaselineWindow();
      await this.measurement.restart(goLight);
    } catch (err) {
      this.fallbackToTimer(`Couldn't restart live readings: ${err.message}`);
    }
    this.switchingCamera = false;
  }

  onReading(r, elapsed) {
    const t = now();
    const cfg = this.config.signals;
    this.metricsCount += 1;
    if (this.metricsCount === 1 || this.metricsCount % 60 === 0) {
      console.info('[SOVA] metrics update', this.metricsCount, {
        breathing: r.breathing, pulse: r.pulse, hrv: r.hrv, elapsed: Math.round(elapsed),
      });
    }
    for (const kind of ['breathing', 'pulse', 'hrv']) {
      const check = checkUsable(kind, r[kind], elapsed, cfg);
      if (check.usable) {
        this.usable[kind] = { value: r[kind].value, t };
        // The baseline window opens with the first steady breathing or pulse reading.
        if (this.phaseUi === 'running' && (kind === 'breathing' || kind === 'pulse') && this.baselineStart == null) {
          this.baselineStart = elapsed;
          this.log('baseline-start');
        }
        if (this.phaseUi === 'running' && this.baselineStart != null) {
          const be = elapsed - (this.baselineStart || 0);
          if (!this.baselineResult) this.baseline.add(kind, r[kind].value, be);
          else this.cue.addUsable(kind, r[kind].value, t);
        }
      } else if (r[kind]) {
        this.hidden[kind] = check.reason;
      }
    }
    if (r.ieRatio) this.ratio = { value: r.ieRatio.value, t };
    this.updateBreathLines();
    if (r.breathTrace && r.breathTrace.length) {
      this.trace.push(...r.breathTrace.filter((p) => p.tsUs != null));
      const end = this.trace[this.trace.length - 1].tsUs;
      this.traceClock = t - end / 1e6;   // maps SDK timestamps to SOVA's clock
      while (this.trace.length && end - this.trace[0].tsUs > 320e6) this.trace.shift();
    }
    if (r.talking && r.talking.stable) { this.cue.addTalking(r.talking.detected, t); this.talkingNow = r.talking.detected; }
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
    // Face presence follows the latest validation state, not event timing.
    if (!live || this.faceVisible) this.cue.faceSeen(t);

    // Baseline: freeze after its window, which starts at the first steady reading.
    if (live && !this.baselineResult && this.baselineStart != null && this.measurement.elapsed() - this.baselineStart >= this.config.baseline.durationSeconds) {
      this.baseline.addBlinkWindow(this.blinkOnsets, this.config.baseline.durationSeconds);
      this.baselineResult = this.baseline.freeze();
      this.cue.setBaseline(this.baselineResult);
      this.log('baseline', { reliable: this.baselineResult.reliable });
      if (!this.baselineResult.reliable) announce('Baseline could not be set. Check lighting and position, then recalibrate.');
    }

    // Away pause.
    const away = live && this.cue.isAway(t);
    if (away && !this.awayFlag) { this.awayFlag = true; this.engine.pause('away'); this.log('away'); }
    if (!away && this.awayFlag) { this.awayFlag = false; this.engine.resume('away'); this.log('away-end'); }

    // Meeting (talking detection or manual).
    const meeting = this.cue.inMeeting(t);
    if (meeting && !this.inMeetingFlag) this.log('meeting', { manual: this.cue.manualMeeting });
    if (!meeting && this.inMeetingFlag) this.log('meeting-end');
    this.inMeetingFlag = meeting;

    const inFocus = this.engine.phase === 'focus' && !this.engine.paused;
    this.cue.tickScreen(t, inFocus);

    // Calibration reminder: signal needs attention for a full minute.
    if (live && this.validation && !this.validation.ok && this.validation.name !== 'kNoFaceFound') {
      if (this.notOkSince == null) this.notOkSince = t;
      if (t - this.notOkSince >= 60 && (this.lastQualityToast == null || t - this.lastQualityToast >= 600)) {
        this.lastQualityToast = t;
        this.log('quality-reminder', { code: this.validation.name });
        toast({ title: 'Your signal needs attention', body: this.validation.tip, actions: [{ label: 'OK' }] });
      }
    } else {
      this.notOkSince = null;
    }

    // Every 30 s in focus: a tension sample for the timeline and patterns.
    // Only usable readings compared with a reliable baseline are recorded.
    if (live && inFocus && this.baselineResult && this.baselineResult.reliable && (this.lastSampleAt == null || t - this.lastSampleAt >= 30)) {
      const snap = this.usableSnapshot();
      const kinds = ['breathing', 'pulse', 'hrv'].filter((k) => snap[k] != null && this.cue.isTense(k, snap[k]) !== null);
      if (kinds.length) {
        this.lastSampleAt = t;
        this.log('sample', { tense: kinds.some((k) => this.cue.isTense(k, snap[k])), breathing: snap.breathing, pulse: snap.pulse, hrv: snap.hrv });
      }
    }

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
    this.updateWidget();
  }

  // ---- floating widget ------------------------------------------------------

  startSound() {
    if (!this.settings.autoSound || !this.preset.sound || this.preset.sound === 'none') return;
    audio.ambient.start(this.preset.sound, this.settings.soundVolume);
    this.soundStarted = true;
  }

  openWidget() {
    if (this.settings.showWidget === false || !window.sova.widget) return;
    window.sova.widget.show();
    this.offWidget = window.sova.widget.onAction((a) => {
      if (this.ended) return;
      if (a === 'reset' && $('#overlay').hidden) this.startReset();
      if (a === 'pause') {
        if (this.engine.pauses.has('manual')) { this.engine.resume('manual'); this.log('resume'); }
        else { this.engine.pause('manual'); this.log('pause'); }
        this.renderRunning();
        this.updateWidget();
      }
    });
    this.updateWidget();
  }

  updateWidget() {
    if (this.settings.showWidget === false || !window.sova.widget || this.phaseUi !== 'running') return;
    const e = this.engine;
    const snap = this.usableSnapshot();
    let line;
    if (e.paused) line = e.pauses.has('away') ? 'Paused: you stepped away' : 'Paused';
    else if (e.phase === 'break') line = 'Break: step away from the screen';
    else if (this.mode !== 'live') line = 'Focus · timer only';
    else if (this.cameraPaused) line = 'Focus · camera paused';
    else if (snap.breathing != null) line = `Breathing ${Math.round(snap.breathing)} /min${this.cue.inMeeting(now()) ? ' · meeting' : ''}`;
    else if (snap.pulse != null) line = `Pulse ${Math.round(snap.pulse)} bpm`;
    else line = 'Waiting for a steady signal';
    const pts = this.recentTrace(15);
    let trace = [];
    if (pts.length >= 4) {
      let min = Infinity, max = -Infinity;
      for (const p of pts) { min = Math.min(min, p.value); max = Math.max(max, p.value); }
      const span = max - min || 1;
      const step = Math.max(1, Math.floor(pts.length / 60));
      for (let i = 0; i < pts.length; i += step) trace.push((pts[i].value - min) / span);
    }
    window.sova.widget.update({
      preset: this.preset.name,
      clock: formatClock(e.remaining),
      paused: e.paused,
      live: this.mode === 'live',
      cameraPaused: this.cameraPaused,
      line,
      trace,
      theme: document.documentElement.dataset.theme || 'dark',
    });
  }

  onTransition(tr) {
    if (tr.next === 'break') {
      const mins = Math.round(tr.breakSeconds / 60);
      const why = tr.adaptive ? (tr.cues > 0 ? ' A little longer after a tense block.' : ' A little shorter after a calm block.') : '';
      toast({ title: `Break time: ${mins} min`, body: `Step away from the screen.${why}`, actions: [{ label: 'OK', primary: true }] });
      this.log('break-start', { minutes: mins, adaptive: tr.adaptive });
      if (this.soundStarted && this.settings.soundDuringBreaks === false) audio.ambient.stop();
    } else if (tr.next === 'focus') {
      this.log('block-start', { block: tr.block });
      if (this.soundStarted && !audio.ambient.current) audio.ambient.start(this.preset.sound, this.settings.soundVolume);
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

  // ---- Presage AI (opt-in) --------------------------------------------------

  aiEnabled() {
    return !!(this.settings.aiReflections && this.mode === 'live' && this.measurement && this.measurement.supportsInsights);
  }

  aiContext() {
    const count = (type) => this.events.filter((e) => e.type === type).length;
    const b = this.baselineResult;
    const pick = (k) => (b && b[k] && b[k].reliable ? b[k].value : null);
    const lastSound = [...this.events].reverse().find((e) => e.type === 'reset' && e.breathSound && e.breathSound.enough);
    return {
      presetName: this.preset.name,
      focusMinutes: this.engine.completedFocusSeconds / 60,
      baseline: b ? { breathing: pick('breathing'), pulse: pick('pulse'), hrv: pick('hrv') } : null,
      tensionCues: count('cue-tension'),
      resets: count('reset'),
      eyeRests: count('eye-rest'),
      breathSound: lastSound ? lastSound.breathSound : null,
    };
  }

  // Ask Presage AI; resolves with { text } or { error } within 25 s.
  async askAI(kind) {
    const prompt = buildPrompt(kind, this.aiContext());
    let id;
    try { id = await this.measurement.requestInsight(prompt); } catch (e) { return { error: e.message || 'Request failed' }; }
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.pendingAI.delete(id); resolve({ error: 'No reply from Presage AI yet. Try again in a minute.' }); }, 25000);
      this.pendingAI.set(id, (r) => { clearTimeout(timer); resolve(r); });
    });
  }

  onInsight(ev) {
    const done = this.pendingAI.get(ev.requestId);
    if (!done) return;   // automatic vitals insights are not shown in SOVA
    this.pendingAI.delete(ev.requestId);
    done(ev.analysis ? { text: ev.analysis.trim() } : { error: ev.error || 'Presage AI returned no text.' });
  }

  async aiCheckin() {
    const out = $('#ai-out');
    const btn = $('#ai-btn');
    if (!out || !btn) return;
    btn.disabled = true;
    out.innerHTML = '<p class="t-small">Asking Presage AI…</p>';
    const r = await this.askAI('checkin');
    this.log('ai-checkin', r.text ? { text: r.text } : { error: r.error });
    if (!$('#ai-out')) return;
    $('#ai-out').innerHTML = r.text
      ? `<p class="t-body">${esc(r.text)}</p><p class="t-meta">${esc(AI_LABEL)}</p>`
      : `<p class="t-small">${esc(r.error)}</p>`;
    if ($('#ai-btn')) $('#ai-btn').disabled = false;
  }

  // ---- user actions -------------------------------------------------------

  startReset(seconds, patternOverride) {
    const pattern = patternOverride || this.currentPattern();
    this.engine.pause('reset');
    openReset({
      config: this.config,
      settings: this.settings,
      pattern,
      seconds: seconds || this.config.defaultBreathingSeconds,
      live: this.mode === 'live' && !this.cameraPaused ? this : null,
      onDone: (res) => {
        this.engine.resume('reset');
        const ev = this.log('reset', { seconds: res.seconds, completed: res.completed, pattern: res.patternId, before: res.before, after: null, breathSound: res.breathSound || null });
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

  resetBaselineWindow() {
    this.baseline = new Baseline(this.config.baseline);
    this.baselineResult = null;
    this.blinkOnsets = 0;
    this.baselineStart = null;
    this.cue.setBaseline(null);
  }

  recalibrate() {
    if (!this.measurement) return;
    this.resetBaselineWindow();
    this.log('recalibrate');
    this.render();
  }

  async end(completed) {
    if (this.ended) return;
    this.ended = true;
    clearInterval(this.timer);
    let ai = null;
    if (this.aiEnabled() && this.measurement.running && this.engine.completedFocusSeconds >= 120) {
      ai = await this.waitForReflection();
    }
    clearTimeout(this.slowTimer);
    this.closeFramingPreview();
    this.stopLines();
    if (this.offWidget) this.offWidget();
    if (this.soundStarted) audio.ambient.stop();
    if (window.sova.widget) window.sova.widget.hide();
    window.removeEventListener('offline', this.onOffline);
    if (this.measurement) { await this.measurement.stop(); this.measurement.destroy(); }
    this.log('session-end', { completed });
    const record = {
      id: this.id,
      app: 'SOVA',
      version: 2,
      presetId: this.preset.id,
      presetName: this.preset.name,
      startedAt: this.startedAtIso,
      endedAt: new Date().toISOString(),
      mode: this.mode,
      focusSeconds: Math.round(this.engine.completedFocusSeconds),
      blocksCompleted: this.engine.finishedBlocks,
      blocksPlanned: this.preset.blocks,
      baseline: this.baselineResult,
      events: this.events,
      reflection: null,
      ai,
      checkIn: this.checkIn,
    };
    this.onEnd && this.onEnd(record);
  }

  waitForReflection() {
    this.stopLines();
    $('#view').innerHTML = `
      <div class="stack-24" style="max-width: 640px; margin: 8vh auto 0">
        <div class="stack-8"><p class="t-small">${esc(this.preset.name)} · session ended</p><h1 class="t-title">Writing your AI reflection</h1></div>
        <p class="t-body t-2">Presage AI is reading your pulse, HRV and breathing from this session. The camera stays on until the reply arrives, at most 25 seconds.</p>
        <div class="progress"><div id="ai-wait"></div></div>
        <div class="row"><button class="btn btn-quiet" id="ai-skip">Skip</button></div>
      </div>`;
    const started = now();
    const bar = setInterval(() => { const el = $('#ai-wait'); if (el) el.style.width = `${Math.min(100, ((now() - started) / 25) * 100)}%`; }, 250);
    return new Promise((resolve) => {
      let settled = false;
      const finish = (r) => { if (settled) return; settled = true; clearInterval(bar); resolve(r); };
      $('#ai-skip').addEventListener('click', () => finish(null));
      this.askAI('reflection').then((r) => finish(r.text ? { text: r.text, at: new Date().toISOString() } : { error: r.error, at: new Date().toISOString() }));
    });
  }

  // ---- rendering ------------------------------------------------------------

  render() {
    if (this.onScreen === false) return;   // another section is open; the session keeps running
    if (this.phaseUi === 'check') return this.renderCheckShell();
    this.renderRunningShell();
  }

  stopLines() {
    if (this.lines) this.lines.stop();
    this.lines = null;
  }

  renderCheckShell() {
    this.stopLines();
    const native = this.measurement && this.measurement.native;
    $('#view').innerHTML = `
      <div class="page-head"><div><p class="t-small">${esc(this.preset.name)} · before you start</p><h1 class="t-title">Signal check</h1></div></div>
      <div class="split">
        <section class="panel stack-24">
          <div class="stack-8"><h2 class="t-section">Set up for a steady reading</h2>
            <p class="t-small">Presage reads breathing from small movements of your chest and pulse from your face, so these make the biggest difference.</p></div>
          <div class="rows">
            <div class="row-item"><span class="row-title">Device on a steady surface</span><span class="row-sub">A laptop on a desk works; a laptop on your knees does not</span></div>
            <div class="row-item"><span class="row-title">Even light on your face</span><span class="row-sub">A window or lamp in front of you, never behind</span></div>
            <div class="row-item"><span class="row-title">Face and chest in view</span><span class="row-sub">About an arm's length from the camera</span></div>
            <div class="row-item"><span class="row-title">Stay still and quiet for 2 minutes</span><span class="row-sub">SOVA learns your own baseline first</span></div>
          </div>
        </section>
        <section class="panel stack" style="align-items: stretch">
          <div style="position: relative">
            <video id="preview" autoplay playsinline muted aria-label="Camera preview, shown only during the signal check" style="width: 100%; aspect-ratio: 16 / 10; object-fit: cover; transform: scaleX(-1); border-radius: var(--r-card); background: var(--bg-deep); display: block"></video>
            <svg viewBox="0 0 160 100" preserveAspectRatio="none" aria-hidden="true" style="position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none"><ellipse cx="80" cy="44" rx="20" ry="26" fill="none" style="stroke: var(--text-2)" opacity="0.6" stroke-width="0.4" stroke-dasharray="2 2"/><path d="M48 100 C 52 78, 108 78, 112 100" fill="none" style="stroke: var(--text-2)" opacity="0.45" stroke-width="0.4" stroke-dasharray="2 2"/></svg>
          </div>
          <div class="row-between">
            <span class="status"><span class="dot warn" id="quality-dot"></span><span id="quality-tip">Starting the camera</span></span>
            <span class="t-meta">${native ? 'Direct capture · 30 fps' : 'Window capture'}</span>
          </div>
          <div class="row">
            <button class="btn btn-primary btn-lg" id="check-start" disabled>${icon('play', 18)}Start ${esc(this.preset.name)}</button>
            ${native ? '' : '<button class="btn btn-quiet btn-lg" id="check-skip">Start anyway</button>'}
            <button class="btn btn-text btn-lg" id="check-cancel">Cancel</button>
          </div>
          <p class="t-small">The video stays on this computer and is never saved.</p>
        </section>
      </div>`;
    $('#check-start').addEventListener('click', () => this.startFocus());
    const skip = $('#check-skip');
    if (skip) skip.addEventListener('click', () => this.startFocus());
    $('#check-cancel').addEventListener('click', () => { this.closeFramingPreview(); this.end(false); });
    if (this.validation) this.onValidation(this.validation);
  }

  renderCheck() { /* updates arrive through onValidation */ }

  // Seconds still planned for this session (for the timeline track).
  plannedRemaining() {
    const e = this.engine;
    const p = this.preset;
    const left = Math.max(0, p.blocks - e.block);   // focus blocks after the current one
    const f = p.focusMinutes * 60;
    const br = p.breakMinutes * 60;
    if (e.phase === 'focus') return e.remaining + left * (br + f);
    return e.remaining + left * f + Math.max(0, left - 1) * br;
  }

  partialRecord() {
    return { startedAt: this.startedAtIso, endedAt: new Date().toISOString(), events: this.events, mode: this.mode };
  }

  renderRunningShell() {
    this.stopLines();
    const live = this.mode === 'live';
    const ticks = Array.from({ length: 60 }, (_, i) => {
      const a = (i / 60) * Math.PI * 2;
      const r1 = 146, r2 = i % 5 === 0 ? 138 : 142;
      return `<line x1="${150 + r1 * Math.sin(a)}" y1="${150 - r1 * Math.cos(a)}" x2="${150 + r2 * Math.sin(a)}" y2="${150 - r2 * Math.cos(a)}" style="stroke: var(--text-2)" opacity="${i % 5 === 0 ? 0.4 : 0.16}" stroke-width="1"/>`;
    }).join('');
    $('#view').innerHTML = `
      <div class="page-head">
        <div><p class="t-small" id="block-label"></p><h1 class="t-title">${esc(this.preset.name)}</h1></div>
        <div class="row">
          ${live ? `<span class="status"><span class="dot live" id="cam-dot"></span><span id="cam-text">Camera on</span></span>
          <button class="btn btn-quiet" id="cam-toggle">${icon(this.cameraPaused ? 'camera' : 'camera-off', 16)}<span>${this.cameraPaused ? 'Resume camera' : 'Pause camera'}</span></button>` : ''}
        </div>
      </div>
      ${!live ? `<div class="notice" style="margin-bottom: 24px"><span class="dot warn"></span><span class="grow">Plain timer mode. ${esc(this.modeReason)}</span></div>` : ''}
      <div class="ws">
        <section class="panel ws-timer">
          <div class="ring">
            <svg viewBox="0 0 300 300" role="img" aria-label="Time left in this phase">
              ${ticks}
              <circle cx="150" cy="150" r="128" style="stroke: var(--hair-2)" stroke-width="2" fill="none"/>
              <circle class="ring-arc" id="ring-arc" cx="150" cy="150" r="128" style="stroke: var(--accent); filter: drop-shadow(0 0 6px var(--accent-soft))" stroke-width="3" fill="none" stroke-linecap="round" stroke-dasharray="${RING_C}" stroke-dashoffset="0" transform="rotate(-90 150 150)"/>
            </svg>
            <div class="ring-center"><span class="clock" id="clock" aria-live="off">--:--</span><span class="t-small" id="clock-sub"></span></div>
          </div>
          <div class="ws-controls">
            <div class="row" style="justify-content: center">
              <button class="btn btn-lg" id="pause">${icon('pause', 18)}<span>Pause</span></button>
              <button class="btn btn-lg btn-quiet btn-danger" id="end">${icon('square', 16)}<span>End session</span></button>
            </div>
            <div class="row" style="justify-content: center; gap: 4px">
              <button class="btn btn-text" id="flow" title="Hold cues for ${this.config.cues.flowSnoozeMinutes} minutes">${icon('moon', 16)}<span>In flow</span></button>
              <button class="btn btn-text" id="meeting" aria-pressed="false">${icon('users', 16)}<span>Meeting</span></button>
              <button class="btn btn-text" id="eyes">${icon('eye', 16)}<span>Eye rest</span></button>
              <button class="btn btn-text" id="skip">${icon('skip-forward', 16)}<span>Skip phase</span></button>
            </div>
            <p class="t-small" id="cue-state" aria-live="polite"></p>
          </div>
        </section>

        <section class="panel ws-breath">
          <div class="breath-head">
            <div class="metric">
              <div class="metric-label">Breathing ${tip('tip-br', 'Breaths per minute, measured by your camera from small movements of your chest. Shown only when the signal is steady.')}</div>
              <div id="m-breathing"></div>
            </div>
            <div class="stack-8" style="align-items: flex-end">
              <span class="status" id="quality"><span class="dot ${this.validation && this.validation.ok ? 'live' : 'warn'}" id="quality-dot"></span><span id="quality-tip">${esc(this.validation ? this.validation.tip : (live ? 'Waiting for the camera' : 'Not measuring'))}</span></span>
              ${live ? '<span class="t-meta" id="breath-source"></span>' : ''}
            </div>
          </div>
          <canvas class="breath-canvas" id="breath-lines" aria-hidden="true"></canvas>
          <div id="baseline-banner"></div>
          ${live ? `
          <div class="support">
            <div class="metric small"><div class="metric-label">Pulse ${tip('tip-pulse', 'Beats per minute, from tiny colour changes in your face. Valid from 40 to 110 bpm.')}</div><div id="m-pulse"></div><div class="metric-rule"></div></div>
            <div class="metric small"><div class="metric-label">HRV ${tip('tip-hrv', 'Heart rate variability (RMSSD): how much the time between heartbeats varies, in milliseconds. It needs a full minute of steady signal.')}</div><div id="m-hrv"></div><div class="metric-rule"></div></div>
            <div class="metric small"><div class="metric-label">In : out ${tip('tip-ie', 'How long you breathe out for each second you breathe in. A longer exhale, around 1 : 1.5, tends to feel settling.')}</div><div id="m-ratio"></div><div class="metric-rule"></div></div>
          </div>
          <div class="states" id="states"></div>` : '<p class="t-small">Live readings are off. Time-based eye-rest reminders still run, and resets work as guided exercises.</p>'}
          <div class="row-between">
            <button class="btn btn-primary btn-lg" id="reset">${icon('wind', 18)}<span>Breathing reset</span></button>
            <span class="t-meta">${esc(this.currentPattern().name || 'Custom pattern')} · ${this.config.defaultBreathingSeconds} s</span>
          </div>
          ${this.aiEnabled() ? `<div class="stack-8" style="border-top: 1px solid var(--hair); padding-top: 16px"><div class="row-between"><span class="t-section">AI check-in</span><button class="btn btn-quiet" id="ai-btn">${icon('message-square-text', 16)}<span>Ask Presage AI</span></button></div><div id="ai-out" class="stack-8"><p class="t-small">A short read of your pulse, HRV and breathing so far, available after about 15 seconds of readings.</p></div></div>` : ''}
        </section>
      </div>
      <section class="panel" style="margin-top: 24px">
        <div class="panel-head"><h2 class="t-section">Session so far</h2><span class="t-meta" id="tl-meta"></span></div>
        <div id="live-tl"></div>
      </section>`;

    $('#pause').addEventListener('click', () => {
      if (this.engine.pauses.has('manual')) { this.engine.resume('manual'); this.log('resume'); }
      else { this.engine.pause('manual'); this.log('pause'); }
      this.renderRunning();
      this.updateWidget();
    });
    $('#flow').addEventListener('click', () => { this.cue.snoozeFlow(now()); this.log('flow-snooze'); this.pendingCue = null; toast({ title: `Cues held for ${this.config.cues.flowSnoozeMinutes} minutes` }); this.renderRunning(); });
    $('#meeting').addEventListener('click', () => { this.cue.setManualMeeting(!this.cue.manualMeeting); this.renderRunning(); });
    $('#reset').addEventListener('click', () => this.startReset());
    $('#eyes').addEventListener('click', () => this.startEyeRest());
    $('#skip').addEventListener('click', () => { if (this.engine.phase === 'break') this.log('break-skipped'); const tr = this.engine.skipPhase(); if (tr) this.onTransition(tr); if (this.engine.done) this.end(true); else this.renderRunning(); });
    $('#end').addEventListener('click', () => this.end(false));
    const cam = $('#cam-toggle');
    if (cam) cam.addEventListener('click', () => this.toggleCamera());
    const aiBtn = $('#ai-btn');
    if (aiBtn) aiBtn.addEventListener('click', () => this.aiCheckin());

    this.lines = new BreathLines($('#breath-lines'), { reduced: this.reducedMotion() });
    this.lines.start();
    this.lastTimelineAt = 0;
    this.renderRunning();
  }

  reducedMotion() {
    return !!this.settings.reducedMotion || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  // Feed the breath lines from the real waveform, or let them go still.
  updateBreathLines() {
    if (!this.lines) return;
    const canvas = $('#breath-lines');
    if (!canvas || !canvas.isConnected) { this.stopLines(); return; }
    const live = this.mode === 'live' && !this.cameraPaused && this.breathingUsable();
    this.lines.setLive(live ? levelFromTrace(this.recentTrace(12)) : null);
    const src = $('#breath-source');
    if (src) src.textContent = live ? 'Live from your camera' : (this.mode === 'live' ? 'No steady breathing signal yet' : 'Not measuring');
  }

  renderRunning() {
    if (this.phaseUi !== 'running' || !$('#clock')) return;
    const e = this.engine;
    const total = e.phase === 'focus' ? this.preset.focusMinutes * 60 : e.nextBreakSecondsCache || e.remaining;
    if (e.phase === 'break' && !e.nextBreakSecondsCache) e.nextBreakSecondsCache = e.remaining;
    if (e.phase === 'focus') e.nextBreakSecondsCache = null;
    $('#clock').textContent = formatClock(e.remaining);
    $('#clock-sub').textContent = e.paused ? (e.pauses.has('away') ? 'Paused while you are away' : 'Paused') : (e.phase === 'focus' ? 'left in this focus block' : 'left in this break');
    $('#block-label').textContent = `${e.phase === 'focus' ? 'Focus' : 'Break'} · block ${e.block} of ${this.preset.blocks} · ${Math.floor(e.completedFocusSeconds / 60)} min focused`;
    const frac = Math.max(0, Math.min(1, e.remaining / Math.max(1, total)));
    $('#ring-arc').setAttribute('stroke-dashoffset', String(RING_C * (1 - frac)));
    $('#ring-arc').style.stroke = e.phase === 'focus' ? 'var(--accent)' : 'var(--lavender)';
    $('#pause').innerHTML = e.pauses.has('manual') ? `${icon('play', 18)}<span>Resume</span>` : `${icon('pause', 18)}<span>Pause</span>`;
    $('#meeting').setAttribute('aria-pressed', String(this.cue.manualMeeting));
    $('#meeting').querySelector('span').textContent = this.cue.manualMeeting ? 'End meeting' : 'Meeting';

    const t = now();
    const ctx = { inFocus: e.phase === 'focus' && !e.paused, quietHours: inQuietHours(new Date(), this.settings.quietHours) };
    const sup = this.cue.suppression(t, ctx);
    $('#cue-state').textContent = this.mode === 'live' ? (sup ? SUPPRESSION_TEXT[sup] : 'Cues are on') : '';

    // Live timeline every 5 seconds.
    if (t - (this.lastTimelineAt || 0) >= 5 && $('#live-tl')) {
      this.lastTimelineAt = t;
      const elapsed = (Date.now() - Date.parse(this.startedAtIso)) / 1000;
      $('#live-tl').innerHTML = renderTimeline(this.partialRecord(), { compact: true, plannedSeconds: elapsed + this.plannedRemaining() });
      $('#tl-meta').textContent = `${this.events.filter((x) => x.type === 'reset').length} resets · ${this.events.filter((x) => x.type === 'eye-rest').length} eye rests`;
    }

    this.updateBreathLines();
    if (this.mode !== 'live') { this.renderMetric('breathing', null, null, 'breaths/min', 'not-measuring'); return; }

    const bb = $('#baseline-banner');
    if (!this.baselineResult && this.baselineStart == null) {
      bb.innerHTML = `<div class="notice"><span class="dot warn"></span><span class="grow">Waiting for a steady signal before setting your baseline. Pulse needs about 12 seconds, breathing about 30.</span></div>`;
    } else if (!this.baselineResult) {
      const p = Math.min(1, (this.measurement ? this.measurement.elapsed() - this.baselineStart : 0) / this.config.baseline.durationSeconds);
      const left = Math.max(0, Math.ceil((1 - p) * this.config.baseline.durationSeconds));
      bb.innerHTML = `<div class="stack-8"><div class="row-between"><span class="t-small">Learning your baseline. Sit naturally and avoid talking</span><span class="t-meta">${formatClock(left)}</span></div><div class="progress"><div style="width: ${Math.round(p * 100)}%"></div></div></div>`;
    } else if (!this.baselineResult.reliable) {
      bb.innerHTML = `<div class="notice attention"><span class="dot warn"></span><span class="grow">SOVA couldn't set a reliable baseline, so cues are off. Check the light and your position, then recalibrate.</span><button class="btn" id="recal">${icon('rotate-ccw', 16)}<span>Recalibrate</span></button></div>`;
      $('#recal').addEventListener('click', () => this.recalibrate());
    } else {
      bb.innerHTML = '';
    }

    const snap = this.usableSnapshot();
    const base = this.baselineResult || {};
    this.renderMetric('breathing', snap.breathing, base.breathing, 'breaths/min');
    this.renderMetric('pulse', snap.pulse, base.pulse, 'bpm');
    this.renderMetric('hrv', snap.hrv, base.hrv, 'ms');
    const ratio = this.breathingUsable() ? this.latestRatio() : null;
    const ratioEl = $('#m-ratio');
    if (ratioEl) ratioEl.innerHTML = ratio != null && ratio > 0
      ? `<div class="metric-figure"><span class="value">1 : ${(1 / ratio).toFixed(1)}</span></div>`
      : '<div class="metric-hidden">Waiting</div>';

    const states = $('#states');
    if (states) {
      const bpm = this.cue.blinksPerMinute(t);
      const face = this.cameraPaused ? null : this.faceVisible;
      states.innerHTML = [
        `<span class="state-chip"><span class="dot ${face ? 'live' : 'off'}"></span>${face == null ? 'Face: waiting' : face ? 'Face in view' : 'No face found'}</span>`,
        `<span class="state-chip"><span class="dot ${this.talkingNow ? 'warn' : 'off'}"></span>${this.talkingNow ? 'Talking' : 'Quiet'}</span>`,
        `<span class="state-chip">${icon('eye', 14)}${bpm != null ? `${Math.round(bpm)} blinks/min` : 'Blinks: learning'}</span>`,
        this.cue.inMeeting(t) ? `<span class="state-chip">${icon('users', 14)}Meeting</span>` : '',
      ].join('');
    }
    const camText = $('#cam-text');
    if (camText) camText.textContent = this.cameraPaused ? 'Camera paused' : 'Camera on';
    const camDot = $('#cam-dot');
    if (camDot) camDot.className = `dot ${this.cameraPaused ? 'warn' : 'live'}`;
  }

  renderMetric(kind, value, base, unit, forceReason) {
    const el = $(`#m-${kind}`);
    if (!el) return;
    if (value == null) {
      el.innerHTML = `<div class="metric-hidden">${esc(forceReason === 'not-measuring' ? 'Not measuring' : (HIDDEN_REASON_TEXT[this.hidden[kind]] || 'Waiting for a reading'))}</div>`;
      return;
    }
    let rel = '';
    if (base && base.reliable) {
      const tense = this.cue.isTense(kind, value);
      rel = kind === 'hrv' ? (tense ? 'Lower than your baseline' : 'Near your baseline') : (tense ? 'Higher than your baseline' : 'Near your baseline');
    }
    const relColor = !rel || rel.startsWith('Near') ? 'var(--text-2)' : 'var(--attention)';
    el.innerHTML = `<div class="metric-figure"><span class="value">${esc(Math.round(value))}</span><span class="unit">${esc(unit)}</span></div>
      ${kind === 'breathing' ? `<div class="t-small" style="color: ${relColor}">${esc(rel || 'Baseline not set yet')}${base && base.reliable ? ` · baseline ${Math.round(base.value)}` : ''}</div>` : `<div class="t-meta" style="color: ${relColor}">${base && base.reliable ? `baseline ${Math.round(base.value)}` : '&nbsp;'}</div>`}`;
  }
}

module.exports = { LiveSession };
