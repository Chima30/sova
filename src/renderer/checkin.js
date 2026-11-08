'use strict';

// The 60-second signal check-in: a quick look at breathing, pulse and HRV
// without starting a focus session. It never starts the focus timer and is
// saved as its own record. Only steady readings are kept; a signal that never
// became steady is shown as missing, never filled in.

const { $, $$, esc, toast, announce, tip } = require('./dom');
const { createMeasurement, now } = require('./measurement');
const { checkUsable, HIDDEN_REASON_TEXT } = require('../../shared/core/signals');
const ci = require('../../shared/core/checkIns');
const { BreathLines, levelFromTrace } = require('./breathLines');
const { BreathOrb } = require('./breathOrb');
const { icon } = require('./icons');
const { createMachine } = require('../../shared/core/machine');
const { CHECK_IN } = require('../../shared/core/machines');

const SECONDS = 60;            // the check-in itself
const HRV_EXTRA = 30;          // HRV needs a full minute of steady signal: wait up to 30 s more
const MIN_SAMPLES = 3;

const LABEL = { breathing: 'Breathing', pulse: 'Pulse', hrv: 'HRV' };
const UNIT = { breathing: 'breaths/min', pulse: 'bpm', hrv: 'ms' };
const TIPS = {
  breathing: 'Breaths per minute, from small movements of your chest.',
  pulse: 'Beats per minute, from tiny colour changes in your face.',
  hrv: 'Heart rate variability (RMSSD): how much the time between heartbeats varies, in milliseconds. It needs a full minute of steady signal.',
};
const FEELINGS_EXTRA = ['Not sure'];

const fmtClock = (s) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.ceil(Math.max(0, s)) % 60).padStart(2, '0')}`;
const fmtVal = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1)).replace(/\.0$/, '');

class CheckIn {
  constructor({ config, settings, apiKey, reducedMotion, onFinish }) {
    this.config = config;
    this.settings = settings;
    this.reduced = reducedMotion;
    this.onFinish = onFinish;
    this.samples = { breathing: [], pulse: [], hrv: [] };
    this.latest = { breathing: null, pulse: null, hrv: null };
    this.hidden = { breathing: 'no-reading', pulse: 'no-reading', hrv: 'no-reading' };
    this.trace = [];
    this.faceTicks = 0;
    this.faceSeen = 0;
    this.faceVisible = null;
    this.validation = null;
    // prep -> starting -> measuring -> (extending) -> finishing -> results,
    // or failed / cancelled. See shared/core/machines.js.
    this.machine = createMachine(CHECK_IN);
    this.measurement = createMeasurement({
      apiKey,
      telemetry: settings.telemetry,
      cameraId: settings.cameraId,
      captureMode: settings.captureMode || 'native',
      handlers: {
        stream: (s) => { const v = $('#preview'); if (v) { v.srcObject = s; v.play().catch(() => {}); } },
        validation: (v) => this.onValidation(v),
        reading: (r, elapsed) => this.onReading(r, elapsed),
        error: (e) => this.onError(e),
      },
    });
  }

  // ---- lifecycle -------------------------------------------------------------

  async begin() {
    this.renderPrep();
    if (!this.measurement.native) return this.start();
    try {
      this.preview = await navigator.mediaDevices.getUserMedia({ audio: false, video: { width: { ideal: 640 }, height: { ideal: 480 } } });
      const v = $('#preview');
      if (v) { v.srcObject = this.preview; v.play().catch(() => {}); }
    } catch {
      const t = $('#ci-tip');
      if (t) t.textContent = 'Preview unavailable. You can still start: SOVA will guide you with tips.';
    }
    const go = $('#ci-start');
    if (go) go.disabled = false;
  }

  closePreview() {
    if (this.preview) for (const t of this.preview.getTracks()) t.stop();
    this.preview = null;
  }

  get state() { return this.machine.state; }

  async start() {
    if (!this.machine.send('START')) return;   // a second click does nothing
    this.closePreview();
    this.renderMeasuring();
    announce('Check-in started. Breathe normally and stay still.');
    await new Promise((r) => setTimeout(r, 400));   // let the camera driver release
    if (!this.machine.is('starting')) return;       // cancelled meanwhile
    try {
      await this.measurement.start();
    } catch (e) {
      if (e && e.retryable) return this.onError({ code: e.code, retryable: true, text: e.message });
      this.fail(e && e.message ? e.message : "Couldn't start the camera.");
      return;
    }
    this.beginTicking();
  }

  // starting -> measuring, once the SDK has the camera (first try or a retry).
  beginTicking() {
    if (!this.machine.is('starting') || !this.machine.send('RUNNING')) return;
    this.timer = setInterval(() => this.tick(), 250);
  }

  async shutdown() {
    clearInterval(this.timer);
    this.closePreview();
    if (this.lines) this.lines.stop();
    if (this.orb) this.orb.stop();
    this.lines = null;
    this.orb = null;
    if (this.measurement) {
      const m = this.measurement;
      this.measurement = null;
      try { await m.stop(); } catch { /* already stopped */ }
      m.destroy();
    }
  }

  // Leaving the screen ends the check-in and turns the camera off.
  async cancel(silent = false) {
    if (!this.machine.send('CANCEL')) return;
    await this.shutdown();
    if (!silent) this.onFinish({ action: 'cancel' });
  }

  async fail(text) {
    if (!this.machine.send('FAIL')) return;
    await this.shutdown();
    $('#view').innerHTML = `
      <div class="stack-24" style="max-width: 640px; margin: 6vh auto 0">
        <div class="stack-8"><span class="t-small">Signal check-in</span><h1 class="t-title">The check-in couldn't finish</h1></div>
        <p class="t-body t-2">${esc(text)}</p>
        <div class="row"><button class="btn btn-primary btn-lg" id="ci-back">Back to Home</button></div>
      </div>`;
    $('#ci-back').addEventListener('click', () => this.onFinish({ action: 'done' }));
  }

  // ---- SDK events --------------------------------------------------------------

  onValidation(v) {
    this.validation = v;
    this.faceVisible = v.name !== 'kNoFaceFound';
    const t = $('#ci-tip');
    if (t) t.textContent = v.tip;
    const d = $('#ci-dot');
    if (d) d.className = `dot ${v.ok ? 'live' : 'warn'}`;
    const go = $('#ci-start');
    if (go && v.ok) go.disabled = false;
  }

  onReading(r, elapsed) {
    if (!this.machine.is('measuring', 'extending')) return;
    const t = now();
    for (const kind of ci.KINDS) {
      const check = checkUsable(kind, r[kind], elapsed, this.config.signals);
      if (check.usable) {
        this.samples[kind].push(r[kind].value);
        this.latest[kind] = { value: r[kind].value, t };
      } else if (r[kind]) {
        this.hidden[kind] = check.reason;
      }
    }
    if (r.breathTrace && r.breathTrace.length) {
      this.trace.push(...r.breathTrace.filter((p) => p.tsUs != null));
      const end = this.trace[this.trace.length - 1].tsUs;
      while (this.trace.length && end - this.trace[0].tsUs > 30e6) this.trace.shift();
    }
  }

  onError(e) {
    if (e.retryable && this.measurement && !this.retried) {
      this.retried = true;
      toast({ title: 'Reconnecting live readings', body: 'Presage did not respond straight away. Trying again.' });
      setTimeout(() => {
        if (!this.measurement || this.machine.final) return;
        this.measurement.restart(false).then(() => this.beginTicking()).catch((err) => this.fail(err.message));
      }, 3000);
      return;
    }
    this.fail(e.text || e.message || 'Live readings stopped.');
  }

  // ---- clock ---------------------------------------------------------------------

  fresh(kind) {
    const l = this.latest[kind];
    return l && now() - l.t <= this.config.signals.staleAfterSeconds ? l.value : null;
  }

  tick() {
    if (!this.machine.is('measuring', 'extending') || !this.measurement) return;
    const elapsed = this.measurement.elapsed();
    if (elapsed > 0) {
      this.faceTicks += 1;
      if (this.faceVisible !== false) this.faceSeen += 1;
    }
    const enough = (k) => this.samples[k].length >= MIN_SAMPLES;
    // At 60 s: finish, unless HRV is the only thing still collecting and the
    // face is in view, in which case wait up to 30 s more for it.
    if (elapsed >= SECONDS) {
      const waitHrv = !enough('hrv') && (enough('breathing') || enough('pulse')) && this.faceVisible !== false && elapsed < SECONDS + HRV_EXTRA;
      if (!waitHrv || this.skipExtra) return this.finish(elapsed);
      if (this.machine.is('measuring')) this.machine.send('EXTEND');
    }
    this.renderLive(elapsed);
  }

  async finish(elapsed) {
    if (!this.machine.send('FINISH')) return;
    const values = ci.summarize(this.samples, MIN_SAMPLES);
    const quality = {};
    for (const k of ci.KINDS) quality[k] = this.samples[k].length >= MIN_SAMPLES ? 'ok' : (this.hidden[k] || 'no-reading');
    const record = {
      id: `c_${Date.now().toString(36)}`,
      at: new Date().toISOString(),
      seconds: Math.round(elapsed),
      values,
      readings: { breathing: this.samples.breathing.length, pulse: this.samples.pulse.length, hrv: this.samples.hrv.length },
      quality,
      faceInViewPct: this.faceTicks ? Math.round((this.faceSeen / this.faceTicks) * 100) : null,
      feeling: null,
    };
    await this.shutdown();
    this.machine.send('DONE');
    announce('Check-in complete');
    this.onFinish({ action: 'results', record });
  }

  // ---- rendering -------------------------------------------------------------------

  renderPrep() {
    const native = this.measurement.native;
    $('#view').innerHTML = `
      <div class="page-head"><div><p class="t-small">Signal check-in · 60 seconds</p><h1 class="t-title">Check your signals</h1></div></div>
      <div class="split">
        <section class="panel stack-24">
          <div class="stack-8"><h2 class="t-section">A quick look, no session</h2>
            <p class="t-small">SOVA measures for about a minute, then shows your breathing, pulse and HRV next to your own history. The focus timer does not start.</p></div>
          <div class="rows">
            <div class="row-item"><span class="row-title">Sit still, breathe normally</span><span class="row-sub">Don't try to breathe slowly. This is a check, not an exercise</span></div>
            <div class="row-item"><span class="row-title">Even light on your face</span><span class="row-sub">A window or lamp in front of you, never behind</span></div>
            <div class="row-item"><span class="row-title">Face and chest in view</span><span class="row-sub">About an arm's length from the camera, device on a steady surface</span></div>
          </div>
        </section>
        <section class="panel stack">
          <video id="preview" autoplay playsinline muted aria-label="Camera preview, shown only before the check-in" style="width: 100%; aspect-ratio: 16 / 10; object-fit: cover; transform: scaleX(-1); border-radius: var(--r-card); background: var(--bg-deep); display: block"></video>
          <div class="row-between"><span class="status"><span class="dot warn" id="ci-dot"></span><span id="ci-tip">Starting the camera</span></span><span class="t-meta">${native ? 'Direct capture' : 'Window capture'}</span></div>
          <div class="row">
            <button class="btn btn-primary btn-lg" id="ci-start" ${native ? 'disabled' : ''}>${icon('activity', 18)}Start check-in</button>
            <button class="btn btn-text btn-lg" id="ci-cancel">Cancel</button>
          </div>
          <p class="t-small">The video stays on this computer and is never saved.</p>
        </section>
      </div>`;
    $('#ci-start').addEventListener('click', () => this.start());
    $('#ci-cancel').addEventListener('click', () => this.cancel());
  }

  renderMeasuring() {
    $('#view').innerHTML = `
      <div class="page-head"><div><p class="t-small">Signal check-in</p><h1 class="t-title">Breathe normally and stay still</h1></div>
        <button class="btn btn-quiet" id="ci-stop">${icon('x', 16)}<span>Cancel</span></button></div>
      <div class="split-r">
        <section class="panel stack-24">
          <div class="row-between" style="align-items: flex-end">
            <div class="stack-8"><span class="t-small" id="ci-phase">Starting the camera</span><span class="clock" id="ci-clock" style="font-size: 56px">1:00</span></div>
            <span class="status"><span class="dot warn" id="ci-dot"></span><span id="ci-tip">${esc(this.validation ? this.validation.tip : 'Waiting for the camera')}</span></span>
          </div>
          <div class="ci-stage" aria-hidden="true"><canvas class="reset-canvas" id="ci-lines"></canvas><canvas class="orb" id="ci-orb"></canvas></div>
          <div class="progress" aria-hidden="true"><div id="ci-bar"></div></div>
          <div class="row" id="ci-extra" hidden><span class="t-small grow">HRV needs a full minute of steady signal, so SOVA is waiting up to 30 seconds more for it.</span><button class="btn btn-quiet" id="ci-skip">Show results now</button></div>
        </section>
        <section class="panel">
          <div class="panel-head"><h2 class="t-section">Signal quality</h2></div>
          <div class="rows" id="ci-signals" aria-live="polite"></div>
        </section>
      </div>`;
    $('#ci-stop').addEventListener('click', () => this.cancel());
    $('#ci-skip').addEventListener('click', () => { this.skipExtra = true; });
    this.lines = new BreathLines($('#ci-lines'), { lines: 28, reduced: this.reduced });
    this.lines.start();
    this.orb = new BreathOrb($('#ci-orb'), { reduced: this.reduced, size: 0.38 });
    this.orb.start();
    this.renderLive(0);
  }

  renderLive(elapsed) {
    const clock = $('#ci-clock');
    if (!clock) return;
    const running = elapsed > 0;
    const left = this.machine.is('extending') ? SECONDS + HRV_EXTRA - elapsed : SECONDS - elapsed;
    clock.textContent = fmtClock(running ? left : SECONDS);
    $('#ci-phase').textContent = !running ? 'Starting the camera' : this.machine.is('extending') ? 'Waiting for HRV' : 'Measuring';
    $('#ci-bar').style.width = `${Math.min(100, (elapsed / SECONDS) * 100)}%`;
    $('#ci-extra').hidden = !this.machine.is('extending');
    const breathing = this.fresh('breathing') != null;
    const level = breathing ? levelFromTrace(this.trace) : null;
    this.lines.setLive(level);
    if (this.orb) {
      this.orb.setLive(level);
      this.orb.setPulse(level != null ? this.fresh('pulse') : null);
    }

    const row = (kind) => {
      const v = this.fresh(kind);
      const n = this.samples[kind].length;
      const warm = this.config.signals[kind].warmupSeconds;
      let state; let text;
      if (v != null) { state = 'live'; text = `${fmtVal(Math.round(v))} ${UNIT[kind]}`; }
      else if (n >= MIN_SAMPLES) { state = 'live'; text = 'Captured'; }
      else if (!running || elapsed < warm) { state = 'off'; text = running ? `Collecting · about ${Math.ceil(warm - elapsed)} s` : 'Waiting'; }
      else { state = 'warn'; text = HIDDEN_REASON_TEXT[this.hidden[kind]] || 'Waiting for a reading'; }
      return `<div class="row-item"><span class="row-title"><span class="dot ${state}"></span> ${LABEL[kind]}</span><span class="row-aside t-small">${esc(text)}</span></div>`;
    };
    const face = this.faceVisible == null ? ['off', 'Waiting'] : this.faceVisible ? ['live', 'In view'] : ['warn', 'Not found'];
    $('#ci-signals').innerHTML = ci.KINDS.map(row).join('')
      + `<div class="row-item"><span class="row-title"><span class="dot ${face[0]}"></span> Face</span><span class="row-aside t-small">${face[1]}</span></div>`;
  }
}

// ---- results (also opened from History) ------------------------------------------

function rangeBar(value, range) {
  const lo = Math.min(range.min, value, range.low);
  const hi = Math.max(range.max, value, range.high);
  const pad = Math.max(1, (hi - lo) * 0.15);
  const a = lo - pad;
  const span = hi + pad - a;
  const pct = (x) => `${((x - a) / span) * 100}%`;
  return `<div class="range" role="img" aria-label="Today ${fmtVal(value)}, your usual range ${fmtVal(range.low)} to ${fmtVal(range.high)}">
      <span class="range-band" style="left: ${pct(range.low)}; width: calc(${pct(range.high)} - ${pct(range.low)})"></span>
      <span class="range-mark" style="left: ${pct(value)}"></span>
    </div>
    <div class="row-between t-meta"><span>${fmtVal(Math.round(a))}</span><span>Your usual ${fmtVal(range.low)}–${fmtVal(range.high)}</span><span>${fmtVal(Math.round(hi + pad))}</span></div>`;
}

const POSITION_TEXT = {
  below: 'Below your usual range',
  within: 'Within your usual range',
  above: 'Above your usual range',
};

function renderResults({ record, checkIns, sessions, feelings, fromHistory, onFeeling, onNext }) {
  const cards = ci.KINDS.map((kind) => {
    const v = record.values[kind];
    if (v == null) {
      return `<section class="panel stack">
        <div class="metric-label">${LABEL[kind]} ${tip(`tip-ci-${kind}`, TIPS[kind])}</div>
        <div class="metric-hidden">Not shown</div>
        <p class="t-small">${esc(kind === 'hrv' && record.quality.hrv !== 'low-confidence' ? 'HRV needs a full minute of steady signal, and it was not ready this time.' : `${HIDDEN_REASON_TEXT[record.quality[kind]] || 'No steady reading'} during this check-in.`)}</p>
      </section>`;
    }
    const range = ci.personalRange(ci.history(kind, checkIns, sessions, record.id));
    const pos = ci.position(v, range);
    const cmp = ci.compareWithLast(kind, record, checkIns);
    const diffText = cmp ? `${cmp.diff > 0 ? '+' : ''}${fmtVal(cmp.diff)} since your last check-in (${fmtVal(cmp.previous)}, ${new Date(cmp.previousAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })})` : 'Your first check-in with this reading';
    return `<section class="panel stack">
      <div class="metric-label">${LABEL[kind]} ${tip(`tip-ci-${kind}`, TIPS[kind])}</div>
      <div class="metric-figure"><span class="value">${esc(fmtVal(v))}</span><span class="unit">${UNIT[kind]}</span></div>
      <span class="t-small">${esc(diffText)}</span>
      ${range.ready
        ? `<div class="stack-8" style="margin-top: 8px">${rangeBar(v, range)}<span class="t-small" style="color: ${pos === 'within' ? 'var(--text-2)' : 'var(--attention)'}">${POSITION_TEXT[pos]}</span></div>`
        : `<p class="t-small" style="margin-top: 8px">Your usual range appears after ${range.needReadings} readings over ${range.needDays} days. You have ${range.have} over ${range.haveDays} day${range.haveDays === 1 ? '' : 's'}.</p>`}
    </section>`;
  }).join('');

  const q = (kind) => {
    const ok = record.quality[kind] === 'ok';
    return `<div class="row-item"><span class="row-title" style="font-weight: 400"><span class="dot ${ok ? 'live' : 'warn'}"></span> ${LABEL[kind]}</span><span class="row-aside t-small">${ok ? `Reliable · ${record.readings[kind]} steady readings` : esc(kind === 'hrv' ? 'Still collecting when the check-in ended' : (HIDDEN_REASON_TEXT[record.quality[kind]] || 'No steady reading'))}</span></div>`;
  };

  $('#view').innerHTML = `
    <div class="page-head"><div><p class="t-small">Signal check-in · ${esc(new Date(record.at).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }))} · ${record.seconds} s</p><h1 class="t-title">Your signals</h1></div>
      ${fromHistory ? `<button class="btn btn-quiet" id="ci-back">${icon('history', 16)}Back to History</button>` : ''}</div>
    <div class="stack-24">
      <div class="grid-3">${cards}</div>
      <div class="split">
        <section class="panel">
          <div class="panel-head"><h2 class="t-section">Signal quality</h2></div>
          <div class="rows">${ci.KINDS.map(q).join('')}
            <div class="row-item"><span class="row-title" style="font-weight: 400"><span class="dot ${record.faceInViewPct >= 80 ? 'live' : 'warn'}"></span> Face in view</span><span class="row-aside t-small">${record.faceInViewPct == null ? 'Not recorded' : `${record.faceInViewPct}% of the time`}</span></div>
          </div>
        </section>
        <section class="panel stack">
          <h2 class="t-section">How are you feeling right now?</h2>
          <p class="t-small">Optional. Saved with this check-in so you can set what you felt next to what SOVA measured.</p>
          <div class="row" role="radiogroup" aria-label="How are you feeling right now?">
            ${[...feelings, ...FEELINGS_EXTRA].map((f) => `<button class="chip" role="radio" aria-checked="${record.feeling === f}" data-cifeel="${esc(f)}">${esc(f)}</button>`).join('')}
          </div>
          ${fromHistory ? '' : `<div class="stack-8" style="border-top: 1px solid var(--hair); padding-top: 16px; margin-top: 8px">
            <h2 class="t-section">What next?</h2>
            <div class="row">
              <button class="btn" id="ci-reset">${icon('wind', 16)}Breathing reset</button>
              <button class="btn" id="ci-focus">${icon('crosshair', 16)}Start a focus session</button>
              <button class="btn btn-primary" id="ci-done">Done</button>
            </div></div>`}
        </section>
      </div>
      <p class="t-small">SOVA is a personal focus and self-reflection tool, not a medical device. These readings are not intended for diagnosis.</p>
    </div>`;

  $$('[data-cifeel]').forEach((b) => b.addEventListener('click', () => {
    const f = b.dataset.cifeel;
    record.feeling = record.feeling === f ? null : f;
    $$('[data-cifeel]').forEach((x) => x.setAttribute('aria-checked', String(x.dataset.cifeel === record.feeling)));
    onFeeling(record);
  }));
  for (const [id, action] of [['ci-reset', 'reset'], ['ci-focus', 'focus'], ['ci-done', 'done'], ['ci-back', 'history']]) {
    const b = $(`#${id}`);
    if (b) b.addEventListener('click', () => onNext(action));
  }
}

module.exports = { CheckIn, renderResults, SECONDS };
