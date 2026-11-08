'use strict';

// Breathing reset overlay: lavender breath lines paced by the chosen pattern,
// your own breath in orange on top when the camera signal is steady, live
// inhale:exhale coaching, and before values for the before-and-after record.
// Without a live session it runs as a guided-only exercise and says so.

const { $, esc, announce, tip } = require('./dom');
const { BreathLines, levelFromTrace, mark } = require('./breathLines');
const { icon } = require('./icons');
const { guideAt, breathsPerMinute, exhaleCoaching, PHASE_TEXT } = require('../../shared/core/breathing');
const audio = require('./audio');
const { now } = require('./measurement');
const { startMic } = require('./micListener');
const { cameraSign, labelEvents, summarize } = require('../../shared/core/breathSound');

const WINDOW_S = 20;

function fmtLeft(s) {
  const v = Math.max(0, Math.ceil(s));
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`;
}

function openReset({ config, settings, pattern, seconds, live, onDone }) {
  const overlay = $('#overlay');
  const reduced = settings.reducedMotion || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const before = live ? live.usableSnapshot() : null;
  const bpm = Math.round(breathsPerMinute(pattern) * 10) / 10;
  const useMic = !!settings.micBreath;
  const PREP = useMic ? 3 : 0;   // seconds of quiet room measurement first

  overlay.innerHTML = `
    <div class="ov-top">
      <div class="row"><span class="brand-mark">${mark(20)}</span><span class="t-section">Breathing reset</span><span class="t-meta">${esc(pattern.name || 'Custom pattern')} · ${esc(bpm)} breaths/min</span></div>
      <div class="row">
        ${useMic ? `<span class="state-chip">${icon('mic', 14)}<span class="dot warn" id="r-mic-dot"></span><span id="r-mic">Microphone: starting</span></span>` : ''}
        <label class="switch-inline"><span class="switch"><input type="checkbox" id="r-sound" ${settings.soundGuide && !useMic ? 'checked' : ''} ${useMic ? 'disabled' : ''}><span></span></span><span>Sound guide${useMic ? ' (off while the mic listens)' : ''}</span></label>
        <button class="btn btn-quiet" id="r-end">${icon('x', 16)}<span>End early</span></button>
      </div>
    </div>
    <div class="ov-body">
      <div class="row-between" style="align-items: flex-end">
        <div class="stack-8">
          <span class="phase-word" id="r-phase" aria-live="${reduced ? 'off' : 'off'}">Breathe in</span>
          <span class="phase-secs" id="r-secs"></span>
        </div>
        <div class="stack-8" style="align-items: flex-end">
          <span class="t-figure" id="r-left" style="font-family: var(--mono)"></span>
          <span class="t-small" id="r-head">${live ? 'Follow the lavender lines' : 'Guided reset'}</span>
        </div>
      </div>
      <canvas class="reset-canvas" id="r-lines" role="img" aria-label="Breathing guide: the lines rise as you breathe in and fall as you breathe out"></canvas>
      <div class="progress" aria-hidden="true"><div id="r-bar"></div></div>
      <div class="reset-foot">
        <div class="stack-8"><span class="t-small">Breathing rate</span><span class="t-body" id="r-rate">${live ? 'Waiting for a steady signal' : 'Not measuring'}</span></div>
        <div class="stack-8"><span class="t-small">Inhale : exhale ${tip('tip-r-ie', 'How long you breathe out for each second you breathe in. A longer exhale tends to feel settling.')}</span><span class="t-body" id="r-ratio">${live ? 'Waiting for a steady signal' : 'Not measuring'}</span></div>
        <div class="stack-8">
          <div class="legend">
            <span><span class="sw" style="background: var(--lavender)"></span>Guide</span>
            ${live ? '<span><span class="sw" style="background: var(--accent)"></span>Your breath, live</span>' : ''}
          </div>
          <span class="t-meta">${live ? 'Camera estimates for self-reflection, not medical readings' : 'Start a focus session to see your own breath here'}</span>
        </div>
      </div>
    </div>`;
  overlay.hidden = false;

  const els = {
    phase: $('#r-phase'), secs: $('#r-secs'), left: $('#r-left'),
    bar: $('#r-bar'), rate: $('#r-rate'), ratio: $('#r-ratio'), head: $('#r-head'),
    sound: $('#r-sound'),
  };
  const lines = new BreathLines($('#r-lines'), { lines: 30, reduced });
  lines.start();
  $('#r-end').focus();

  const t0 = now() + PREP;      // guide time 0 starts after the room check
  let mic = null;
  let micError = null;
  if (useMic) {
    startMic(() => now() - t0).then((m) => { mic = m; if (finished) m.stop(); }).catch((e) => { micError = e; });
  }
  let lastPhase = null;
  let raf = 0;
  let finished = false;

  function frame() {
    if (finished) return;
    const elapsed = now() - t0;
    if (useMic) {
      const label = $('#r-mic');
      const dot = $('#r-mic-dot');
      if (micError) { label.textContent = 'Microphone unavailable'; dot.className = 'dot warn'; }
      else if (!mic || !mic.detector.calibrated) { label.textContent = 'Microphone: measuring room noise'; dot.className = 'dot warn'; }
      else { label.textContent = `${mic.detector.events.length} breath sound${mic.detector.events.length === 1 ? '' : 's'} heard`; dot.className = 'dot live'; }
    }
    if (elapsed < 0) {
      els.phase.textContent = 'Stay quiet';
      els.secs.textContent = `Measuring the room, ${Math.ceil(-elapsed)} s`;
      els.left.textContent = '';
      lines.setGuide(0);
      raf = requestAnimationFrame(frame);
      return;
    }
    const left = Math.max(0, seconds - elapsed);
    const g = guideAt(pattern, elapsed);
    els.phase.textContent = PHASE_TEXT[g.phase];
    els.secs.textContent = `${Math.ceil(g.secondsLeft)} s`;
    const secsLeft = Math.ceil(left);
    els.left.textContent = fmtLeft(secsLeft);
    lines.setGuide(g.scale);
    els.bar.style.width = `${Math.min(100, (elapsed / seconds) * 100)}%`;
    if (g.phase !== lastPhase) {
      lastPhase = g.phase;
      if (els.sound.checked) audio.pace(g.phase, g.secondsLeft);
      if (reduced) announce(PHASE_TEXT[g.phase]);
    }

    if (live) {
      const u = live.usableSnapshot();
      const usable = live.breathingUsable();
      lines.setLive(usable ? levelFromTrace(live.recentTrace(WINDOW_S)) : null);
      if (u.breathing != null) {
        els.rate.innerHTML = before && before.breathing != null
          ? `<span class="t-num">${Math.round(before.breathing)} → ${Math.round(u.breathing)}</span> <span class="t-2">breaths/min</span>`
          : `<span class="t-num">${Math.round(u.breathing)}</span> <span class="t-2">breaths/min</span>`;
        if (before && before.breathing != null && u.breathing < before.breathing) els.head.textContent = "You're settling";
      } else {
        els.rate.textContent = 'Waiting for a steady signal';
      }
      const coach = usable ? exhaleCoaching(live.latestRatio(), Math.max(1, pattern.exhale / pattern.inhale)) : null;
      els.ratio.innerHTML = coach ? `<span class="t-num">${esc(coach.label)}</span> <span class="t-2">${esc(coach.tip.toLowerCase())}</span>` : 'Waiting for a steady signal';
    }

    if (left <= 0) return finish(true);
    raf = requestAnimationFrame(frame);
  }

  function finish(completed) {
    if (finished) return;
    finished = true;
    cancelAnimationFrame(raf);
    lines.stop();
    const doneSeconds = Math.max(0, Math.round(now() - t0));
    const result = { completed, seconds: doneSeconds, patternId: pattern.id || 'custom', before };
    if (!useMic) {
      overlay.hidden = true;
      overlay.innerHTML = '';
      onDone && onDone(result);
      return;
    }
    // Microphone results: label each heard breath, then show what SOVA found.
    let sound = null;
    if (mic) {
      mic.stop();
      const events = mic.detector.finish().filter((e) => e.start >= 0);
      const trace = live && live.traceTimed ? live.traceTimed().map((p) => ({ t: p.t - t0, value: p.value })).filter((p) => p.t >= 0) : null;
      const phaseAt = (t) => guideAt(pattern, t).phase;
      const sign = trace && trace.length ? cameraSign(trace, phaseAt) : null;
      const labelled = labelEvents(events, { trace, sign, guidePhaseAt: phaseAt });
      sound = summarize(labelled, { pattern, seconds: Math.max(1, doneSeconds), rejectedLong: mic.detector.rejectedLong });
    }
    result.breathSound = sound;
    overlay.innerHTML = `
      <div class="ov-top"><div class="row"><span class="brand-mark">${mark(20)}</span><span class="t-section">Breathing reset</span><span class="t-meta">${doneSeconds} s</span></div></div>
      <div class="ov-body" style="max-width: 720px">
        <div class="stack-8"><span class="t-small">From your microphone</span><h1 class="t-title">What SOVA heard</h1></div>
        ${sound ? `<div class="rows">${sound.lines.map((l) => `<div class="row-item"><span class="row-title" style="font-weight: 400">${esc(l)}</span></div>`).join('')}</div>
          <p class="t-small">Breath timing from your microphone. In and out phases from ${sound.phaseSource === 'camera' ? "the camera's breathing waveform" : 'the breathing guide'}. The audio was never recorded or saved.</p>`
        : `<p class="t-body t-2">${micError ? "SOVA couldn't use the microphone, so there are no breath sound results this time." : 'The reset ended before SOVA could listen.'}</p>`}
        <div class="row"><button class="btn btn-primary btn-lg" id="r-done">${icon('check', 18)}<span>Done</span></button></div>
      </div>`;
    $('#r-done').focus();
    $('#r-done').addEventListener('click', () => {
      overlay.hidden = true;
      overlay.innerHTML = '';
      onDone && onDone(result);
    });
  }

  $('#r-end').addEventListener('click', () => finish(false));
  overlay.addEventListener('keydown', function onKey(e) {
    if (e.key === 'Escape') { overlay.removeEventListener('keydown', onKey); finish(false); }
  });
  raf = requestAnimationFrame(frame);
  return { close: () => finish(false) };
}

function openEyeRest({ config, onDone }) {
  const overlay = $('#overlay');
  const total = config.eyeRestSeconds;
  overlay.innerHTML = `
    <div class="ov-top"><div class="row"><span class="brand-mark">${mark(20)}</span><span class="t-section">Eye rest</span></div><button class="btn btn-quiet" id="e-end">${icon('skip-forward', 16)}<span>Skip</span></button></div>
    <div class="ov-body" style="max-width: 640px; align-items: flex-start">
      <span style="color: var(--lavender)">${icon('eye', 40)}</span>
      <h1 class="t-title" style="font-size: 32px; line-height: 40px">Look at something far away</h1>
      <p class="t-body t-2">Let your eyes relax on a point across the room or out a window. A soft chime plays when it's time to look back.</p>
      <span class="clock" id="e-left" style="font-size: 72px">0:${String(total).padStart(2, '0')}</span>
      <div class="progress" style="width: 100%"><div id="e-bar"></div></div>
    </div>`;
  overlay.hidden = false;
  $('#e-end').focus();
  const t0 = now();
  let done = false;
  const timer = setInterval(() => {
    const left = Math.max(0, total - (now() - t0));
    $('#e-left').textContent = fmtLeft(left);
    $('#e-bar').style.width = `${Math.min(100, ((total - left) / total) * 100)}%`;
    if (left <= 0) end(true);
  }, 250);
  function end(completed) {
    if (done) return;
    done = true;
    clearInterval(timer);
    if (completed) audio.chime();
    overlay.hidden = true;
    overlay.innerHTML = '';
    onDone && onDone({ completed });
  }
  $('#e-end').addEventListener('click', () => end(false));
}

module.exports = { openReset, openEyeRest };
