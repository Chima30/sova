'use strict';

// Breathing reset overlay: a guide circle paced by the chosen pattern, the
// live breath line drawn against the target pace, live inhale:exhale
// coaching, and before values for the before-and-after record.
// Without a live session it runs as a guided-only exercise and says so.

const { $, esc, announce } = require('./dom');
const { guideAt, breathsPerMinute, exhaleCoaching, PHASE_TEXT } = require('../../shared/core/breathing');
const audio = require('./audio');
const { now } = require('./measurement');
const { startMic } = require('./micListener');
const { cameraSign, labelEvents, summarize } = require('../../shared/core/breathSound');

const WINDOW_S = 20;

function openReset({ config, settings, pattern, seconds, live, onDone }) {
  const overlay = $('#overlay');
  const reduced = settings.reducedMotion || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const before = live ? live.usableSnapshot() : null;
  const bpm = Math.round(breathsPerMinute(pattern) * 10) / 10;
  const useMic = !!settings.micBreath;
  const PREP = useMic ? 3 : 0;   // seconds of quiet room measurement first

  overlay.innerHTML = `
    <div class="overlay-top">
      <span class="num" style="color: var(--muted); font-size: 18px">Breathing reset</span>
      <div class="row">
        ${useMic ? '<span class="pill"><span class="dot" id="r-mic-dot"></span><span id="r-mic">Microphone: starting</span></span>' : ''}
        <label class="field" style="min-height: 44px"><input type="checkbox" id="r-sound" ${settings.soundGuide && !useMic ? 'checked' : ''} ${useMic ? 'disabled' : ''}> Sound guide${useMic ? ' (off while the mic listens)' : ''}</label>
        <button class="btn" id="r-end">End early</button>
      </div>
    </div>
    <div class="guide" role="img" aria-label="Breathing guide">
      ${reduced ? '' : '<div class="guide-target"></div><div class="guide-breath" id="r-circle"></div>'}
      <div class="guide-text">
        <span class="guide-phase" id="r-phase">Breathe in</span>
        <span class="small" id="r-secs"></span>
        <span class="num" style="font-size: 22px; color: var(--text-2); margin-top: 8px" id="r-left"></span>
      </div>
    </div>
    ${reduced ? '<div class="progress" style="max-width: 340px"><div id="r-bar"></div></div>' : ''}
    <div class="legend">
      ${live ? '<span><span class="swatch-line"></span>Your breath (live)</span>' : ''}
      <span><span class="swatch-dash"></span>Target pace, ${esc(bpm)} breaths/min</span>
    </div>
    <section class="card reset-card stack">
      <div class="row" style="justify-content: space-between">
        <h2 style="margin: 0" id="r-head">${live ? 'Follow the circle' : 'Guided reset'}</h2>
        <span id="r-rate" class="small" style="font-size: 15px"></span>
      </div>
      <canvas class="reset-trace" id="r-trace" width="1000" height="120" aria-label="Your breathing line compared with the target pace"></canvas>
      <div class="row" style="justify-content: space-between; border-top: 1px solid var(--border); padding-top: 12px">
        <span id="r-ratio" class="small" style="font-size: 15px; color: var(--text-2)"></span>
        <span class="small">${live ? 'Camera-based estimates for self-reflection, not medical readings.' : 'Start a focus session to see your live breath here.'}</span>
      </div>
    </section>`;
  overlay.hidden = false;

  const els = {
    circle: $('#r-circle'), phase: $('#r-phase'), secs: $('#r-secs'), left: $('#r-left'),
    bar: $('#r-bar'), rate: $('#r-rate'), ratio: $('#r-ratio'), head: $('#r-head'),
    canvas: $('#r-trace'), sound: $('#r-sound'),
  };
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

  function draw(elapsed) {
    const ctx = els.canvas.getContext('2d');
    const W = els.canvas.width, H = els.canvas.height;
    ctx.clearRect(0, 0, W, H);
    // Target pace: the guide's own fill level over the last 20 s.
    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = '#9AA6BC';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = 0; x <= W; x += 4) {
      const t = elapsed - WINDOW_S + (x / W) * WINDOW_S;
      const y = H - 10 - guideAt(pattern, Math.max(0, t)).scale * (H - 20);
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    if (!live) return;
    const pts = live.recentTrace(WINDOW_S);
    if (pts.length < 4) return;
    let min = Infinity, max = -Infinity;
    for (const p of pts) { min = Math.min(min, p.value); max = Math.max(max, p.value); }
    const span = max - min || 1;
    const tEnd = pts[pts.length - 1].tsUs;
    ctx.strokeStyle = '#7FA6E8';
    ctx.lineWidth = 3;
    ctx.beginPath();
    pts.forEach((p, i) => {
      const x = W - ((tEnd - p.tsUs) / 1e6 / WINDOW_S) * W;
      const y = H - 10 - ((p.value - min) / span) * (H - 20);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  function frame() {
    if (finished) return;
    const elapsed = now() - t0;
    if (useMic) {
      const label = $('#r-mic');
      const dot = $('#r-mic-dot');
      if (micError) { label.textContent = 'Microphone unavailable'; dot.className = 'dot warn'; }
      else if (!mic || !mic.detector.calibrated) { label.textContent = 'Microphone: measuring room noise'; dot.className = 'dot warn'; }
      else { label.textContent = `Microphone: ${mic.detector.events.length} breath sound${mic.detector.events.length === 1 ? '' : 's'} heard`; dot.className = 'dot'; }
    }
    if (elapsed < 0) {
      els.phase.textContent = 'Stay quiet';
      els.secs.textContent = `Measuring the room, ${Math.ceil(-elapsed)} s`;
      els.left.textContent = '';
      raf = requestAnimationFrame(frame);
      return;
    }
    const left = Math.max(0, seconds - elapsed);
    const g = guideAt(pattern, elapsed);
    els.phase.textContent = PHASE_TEXT[g.phase];
    els.secs.textContent = `${Math.ceil(g.secondsLeft)} s`;
    const secsLeft = Math.ceil(left);
    els.left.textContent = `${Math.floor(secsLeft / 60)}:${String(secsLeft % 60).padStart(2, '0')}`;
    if (els.circle) els.circle.style.transform = `scale(${0.45 + 0.55 * g.scale})`;
    if (els.bar) els.bar.style.width = `${Math.min(100, (elapsed / seconds) * 100)}%`;
    if (g.phase !== lastPhase) {
      lastPhase = g.phase;
      if (els.sound.checked) audio.pace(g.phase, g.secondsLeft);
      if (reduced) announce(PHASE_TEXT[g.phase]);
    }

    if (live) {
      const u = live.usableSnapshot();
      if (u.breathing != null) {
        els.rate.innerHTML = before && before.breathing != null
          ? `Breathing <strong style="color: var(--text)">${Math.round(before.breathing)} → ${Math.round(u.breathing)}</strong> breaths/min`
          : `Breathing <strong style="color: var(--text)">${Math.round(u.breathing)}</strong> breaths/min`;
        if (before && before.breathing != null && u.breathing < before.breathing) els.head.textContent = "You're settling";
      } else {
        els.rate.textContent = 'Breathing: waiting for a steady signal';
      }
      const coach = live.breathingUsable() ? exhaleCoaching(live.latestRatio(), config.targetExhaleRatio) : null;
      els.ratio.innerHTML = coach ? `Inhale : exhale <strong style="color: var(--text)">${esc(coach.label)}</strong>, ${esc(coach.tip.toLowerCase())}` : '';
    }

    draw(elapsed);
    if (left <= 0) return finish(true);
    raf = requestAnimationFrame(frame);
  }

  function finish(completed) {
    if (finished) return;
    finished = true;
    cancelAnimationFrame(raf);
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
      <div class="stack" style="max-width: 640px; width: 100%; margin-top: 8vh">
        <span class="small">Breathing reset · ${doneSeconds} s</span>
        <h1>What SOVA heard</h1>
        ${sound ? `<ul class="list card">${sound.lines.map((l) => `<li><span class="dot" style="margin-top: 7px"></span><span>${esc(l)}</span></li>`).join('')}</ul>
          <p class="small" style="margin: 0">Breath timing from your microphone. In and out phases from ${sound.phaseSource === 'camera' ? "the camera's breathing waveform" : 'the breathing guide'}. The audio was never recorded or saved.</p>`
        : `<p class="lead" style="margin: 0">${micError ? "SOVA couldn't use the microphone, so there are no breath sound results this time." : 'The reset ended before SOVA could listen.'}</p>`}
        <div class="row"><button class="btn primary big" id="r-done">Done</button></div>
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
    <div class="overlay-top"><span class="num" style="color: var(--muted); font-size: 18px">Eye rest</span><button class="btn" id="e-end">Skip</button></div>
    <div class="stack" style="align-items: center; text-align: center; margin-top: 8vh; max-width: 520px">
      <svg width="96" height="96" viewBox="0 0 48 48" fill="none" stroke="#7FA6E8" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 24s7-12 20-12 20 12 20 12-7 12-20 12S4 24 4 24z"></path><circle cx="24" cy="24" r="6"></circle></svg>
      <h1>Look at something far away</h1>
      <p class="lead" style="margin: 0">Let your eyes relax on a point across the room or out a window. A soft chime plays when it's time to look back.</p>
      <span class="num" style="font-size: 56px; color: var(--accent)" id="e-left">0:${total}</span>
    </div>`;
  overlay.hidden = false;
  $('#e-end').focus();
  const t0 = now();
  let done = false;
  const timer = setInterval(() => {
    const left = Math.max(0, total - (now() - t0));
    $('#e-left').textContent = `0:${String(Math.ceil(left)).padStart(2, '0')}`;
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
