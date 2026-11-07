'use strict';

// SOVA renderer entry: splash, consent, navigation and every section.

const { $, $$, esc, toast, announce, fmtDate, fmtMinutes } = require('./dom');
const { LiveSession } = require('./session');
const { openReset, openEyeRest } = require('./reset');
const { breathsPerMinute, validatePattern } = require('../../shared/core/breathing');
const { weekly, beforeAfter, patterns } = require('../../shared/core/insights');
const { renderTimeline } = require('./timeline');
const audio = require('./audio');
const { cleanOverrides, LIMITS } = require('../../shared/core/overrides');

const PRIVACY_POLICY = 'https://api.physiology.presagetech.com/privacypolicy';
const KEY_PORTAL = 'https://physiology.presagetech.com/auth/register';

const state = { config: null, settings: null, view: 'home', session: null, selectedPreset: null, resetSeconds: 60 };

// ---------------------------------------------------------------------------
// Boot

async function boot() {
  state.config = await window.sova.config();
  state.settings = await window.sova.getSettings();
  state.selectedPreset = state.settings.presetId;
  state.resetSeconds = state.config.defaultBreathingSeconds;
  applyMotion();

  const info = await window.sova.appInfo();
  const mod = info.platform === 'darwin' ? 'Cmd' : 'Ctrl';
  $('#shortcut-hint').textContent = `Quick reset: ${mod} + Shift + B`;

  $$('.nav').forEach((b) => b.addEventListener('click', () => go(b.dataset.nav)));
  window.sova.onQuickReset(() => quickReset());

  setTimeout(() => {
    $('#splash').classList.add('fade');
    $('#app').hidden = false;
    setTimeout(() => { $('#splash').hidden = true; }, 420);
    if (state.settings.consentVersion < state.config.consentVersion) showConsent();
    else go('home');
  }, 1100);
}

function applyMotion() {
  document.body.classList.toggle('reduced-motion', !!state.settings.reducedMotion);
}

async function saveSettings(patch) {
  await window.sova.setSettings(patch);
  state.settings = await window.sova.getSettings();
  applyMotion();
}

function go(view) {
  if (state.session && !state.session.ended && view !== 'focus-live') {
    // A session is running: keep it on screen; other sections open after it ends.
    if (view !== 'home' && view !== 'focus') toast({ title: 'A focus session is running', body: 'End it to open other sections. Resets and eye rests are available on the session screen.', actions: [{ label: 'OK' }] });
    return;
  }
  state.view = view;
  $$('.nav').forEach((b) => b.setAttribute('aria-current', b.dataset.nav === view ? 'page' : 'false'));
  const render = VIEWS[view] || VIEWS.home;
  render();
  $('#view').focus();
}

function setNavVisible(on) { $('.sidebar').hidden = !on; }

// ---------------------------------------------------------------------------
// Consent

function showConsent() {
  setNavVisible(false);
  $('#view').innerHTML = `
    <div style="max-width: 620px; margin: 4vh auto 0" class="stack">
      <h1>Before your first session</h1>
      <p class="lead" style="margin: 0">SOVA uses your camera to estimate breathing, pulse, HRV, blinking and talking while you focus. Here is exactly what happens.</p>
      <ul class="list card">
        <li><span class="dot" style="margin-top: 7px"></span><span>The camera is on only during a focus session or reset, with an indicator and a pause button.</span></li>
        <li><span class="dot" style="margin-top: 7px"></span><span>No video or photos are ever recorded or saved.</span></li>
        <li><span class="dot" style="margin-top: 7px"></span><span>Signals are computed on this computer by the Presage SmartSpectra SDK. It connects to Presage to start each session. <a href="${PRIVACY_POLICY}" target="_blank" rel="noreferrer">Presage privacy policy</a></span></li>
        <li><span class="dot" style="margin-top: 7px"></span><span>During a session the SDK also sends your pulse, HRV and breathing values (never video) to Presage's AI service for automatic vitals check-ins, about once a minute. SOVA cannot switch this off.</span></li>
        <li><span class="dot" style="margin-top: 7px"></span><span>Presage's anonymous SDK diagnostics are off unless you turn them on in Settings. They never include video, your readings or anything that identifies you.</span></li>
        <li><span class="dot" style="margin-top: 7px"></span><span>Optional and off until you turn them on, each with its own consent: breath sound analysis with the microphone (never recorded), and AI reflections from Presage.</span></li>
        <li><span class="dot" style="margin-top: 7px"></span><span>Only session summaries, your baseline, reflections and notes are stored, on this computer. You can export or delete them at any time.</span></li>
      </ul>
      <p class="small">SOVA is a focus and self-reflection tool. It is not a medical device and is not for diagnosis or treatment.</p>
      <label class="field" style="justify-content: flex-start"><input type="checkbox" id="consent-check"> I understand and agree to camera use during sessions.</label>
      <div class="row">
        <button class="btn primary big" id="consent-ok" disabled>Allow camera and continue</button>
        <button class="btn" id="consent-no">Not now, use timer only</button>
      </div>
    </div>`;
  $('#consent-check').addEventListener('change', (e) => { $('#consent-ok').disabled = !e.target.checked; });
  $('#consent-ok').addEventListener('click', async () => {
    await saveSettings({ consentVersion: state.config.consentVersion });
    setNavVisible(true);
    go(state.settings.hasApiKey ? 'home' : 'settings');
    if (!state.settings.hasApiKey) toast({ title: 'One more step', body: 'Add your Presage API key below to turn on live readings.', actions: [{ label: 'OK' }] });
  });
  $('#consent-no').addEventListener('click', () => { setNavVisible(true); state.timerOnly = true; go('home'); });
}

// Microphone consent, shown the first time breath sound analysis is turned on.
function askMicConsent(onYes) {
  toast({
    title: 'Use the microphone for breath sounds?',
    body: 'Only during breathing resets, and only after you start one. SOVA turns the sound into a loudness number every 20 ms to time your breaths. Audio is never recorded, saved or sent anywhere. You can turn this off at any time.',
    actions: [
      { label: 'Allow microphone', primary: true, onClick: async () => { await saveSettings({ micBreath: true }); onYes && onYes(); } },
      { label: 'Not now' },
    ],
  });
}

function cameraAllowed() {
  return state.settings.consentVersion >= state.config.consentVersion && !state.timerOnly;
}

// ---------------------------------------------------------------------------
// Sessions

function presetById(id) {
  return state.config.presets.find((p) => p.id === id) || state.config.presets[0];
}

async function startSession() {
  const preset = presetById(state.selectedPreset);
  await saveSettings({ presetId: preset.id });
  const apiKey = cameraAllowed() ? await window.sova.getApiKey() : null;
  state.view = 'focus-live';
  $$('.nav').forEach((b) => b.setAttribute('aria-current', b.dataset.nav === 'focus' ? 'page' : 'false'));
  state.session = new LiveSession({
    config: state.config,
    settings: state.settings,
    preset,
    apiKey,
    onEnd: (record) => { state.session = null; showReflection(record); },
  });
  await state.session.begin();
}

function quickReset() {
  if (!$('#overlay').hidden) return;
  if (state.session && !state.session.ended && state.session.phaseUi === 'running') return state.session.startReset();
  openReset({ config: state.config, settings: state.settings, pattern: currentPattern(), seconds: state.resetSeconds, live: null, onDone: () => {} });
}

function currentPattern() {
  const id = state.settings.breathingPatternId;
  if (id === 'custom') return { id: 'custom', ...state.settings.customPattern };
  return state.config.breathingPatterns.find((p) => p.id === id) || state.config.breathingPatterns[0];
}

// ---------------------------------------------------------------------------
// End-of-session reflection and summary

const REFLECTION_TAGS = ['Calm', 'Productive', 'Distracted', 'Tired', 'Overwhelmed'];

function showReflection(record) {
  go('history-noop');
  $$('.nav').forEach((b) => b.setAttribute('aria-current', 'false'));
  const picked = new Set();
  $('#view').innerHTML = `
    <div style="max-width: 620px" class="stack">
      <span class="small">${esc(record.presetName)} · ${esc(fmtMinutes(record.focusSeconds))} focused · optional</span>
      <h1>How did that session feel?</h1>
      <div class="row" role="group" aria-label="Session feeling">
        ${REFLECTION_TAGS.map((t) => `<button class="chip" aria-pressed="false" data-tag="${esc(t)}">${esc(t)}</button>`).join('')}
      </div>
      <label class="stack" style="gap: 8px"><strong>Session note</strong>
        <textarea id="note" rows="5" placeholder="What helped or got in the way?"></textarea></label>
      <p class="small">Your answer and note stay on this computer. They're included in export and removed by delete all.</p>
      <div class="row"><button class="btn primary big" id="save">Save and see summary</button><button class="btn" id="skipr">Skip</button></div>
    </div>`;
  $$('[data-tag]').forEach((b) => b.addEventListener('click', () => {
    const tag = b.dataset.tag;
    if (picked.has(tag)) picked.delete(tag); else picked.add(tag);
    b.setAttribute('aria-pressed', String(picked.has(tag)));
  }));
  const finish = async (withReflection) => {
    const note = $('#note').value.trim();
    if (withReflection && (picked.size || note)) record.reflection = { tags: [...picked], note };
    await window.sova.saveSession(record);
    showSummary(record);
  };
  $('#save').addEventListener('click', () => finish(true));
  $('#skipr').addEventListener('click', () => finish(false));
}

function countEvents(record, type) { return (record.events || []).filter((e) => e.type === type).length; }

function showSummary(record) {
  const resets = (record.events || []).filter((e) => e.type === 'reset');
  const ba = resets.filter((r) => r.before && r.after);
  $('#view').innerHTML = `
    <div class="stack" style="max-width: 820px">
      <span class="small">Session complete · ${esc(fmtDate(record.startedAt))}</span>
      <h1>${esc(record.presetName)}</h1>
      <div class="grid">
        <div class="card"><div class="num" style="font-size: 26px">${esc(fmtMinutes(record.focusSeconds))}</div><div class="small">Focus time</div></div>
        <div class="card"><div class="num" style="font-size: 26px">${record.blocksCompleted} of ${record.blocksPlanned}</div><div class="small">Blocks done</div></div>
        <div class="card"><div class="num" style="font-size: 26px">${resets.length}</div><div class="small">Resets taken</div></div>
        <div class="card"><div class="num" style="font-size: 26px">${countEvents(record, 'eye-rest')}</div><div class="small">Eye rests taken</div></div>
      </div>
      ${record.mode === 'live' ? `
      <section class="card stack">
        <h2 style="margin: 0">Before and after resets</h2>
        ${ba.length ? `<table style="width: 100%; border-collapse: collapse; font-size: 14px">
          <thead><tr style="color: var(--muted); text-align: left"><th>Reset</th><th>Breathing</th><th>Pulse</th><th>HRV</th></tr></thead>
          <tbody>${ba.map((r, i) => `<tr><td>${i + 1}</td><td>${pair(r.before.breathing, r.after.breathing)}</td><td>${pair(r.before.pulse, r.after.pulse)}</td><td>${pair(r.before.hrv, r.after.hrv)}</td></tr>`).join('')}</tbody></table>
          <p class="small">"Not shown" means the signal was not reliable enough at that moment.</p>`
        : '<p class="small">No reset had reliable readings both before and 60 seconds after, so there is nothing to compare.</p>'}
      </section>` : '<p class="small">This session ran as a plain timer, so there are no signal readings.</p>'}
      ${resets.some((r) => r.breathSound) ? `<section class="card stack"><h2 style="margin: 0">Breath sounds</h2>
        ${resets.filter((r) => r.breathSound).map((r, i) => `<div class="stack" style="gap: 6px"><span class="small">Reset ${i + 1}</span>${r.breathSound.lines.map((l) => `<span>${esc(l)}</span>`).join('')}</div>`).join('')}
        <p class="small" style="margin: 0">From the microphone during resets. Audio was never recorded.</p></section>` : ''}
      ${record.ai && record.ai.text ? `<section class="card stack"><h2 style="margin: 0">AI reflection</h2><p style="margin: 0; line-height: 1.6">${esc(record.ai.text)}</p>
        <p class="small" style="margin: 0">Written by Presage AI from your measured pulse, HRV and breathing. AI can be wrong. Not medical advice.</p></section>` : ''}
      <section class="card stack"><h2 style="margin: 0">Timeline</h2>${renderTimeline(record)}</section>
      <div class="row"><button class="btn primary" id="again">Start another session</button><button class="btn" id="hist">Go to History</button></div>
    </div>`;
  $('#again').addEventListener('click', () => go('focus'));
  $('#hist').addEventListener('click', () => go('history'));
}

function pair(a, b) {
  const f = (v) => (v == null ? '<span style="color: var(--muted)">Not shown</span>' : esc(Math.round(v)));
  return `${f(a)} → ${f(b)}`;
}

// ---------------------------------------------------------------------------
// Sections

const VIEWS = {
  home() {
    const preset = presetById(state.selectedPreset);
    const s = state.settings;
    $('#view').innerHTML = `
      <h1>Home</h1>
      <p class="lead">Stay in focus. Stay in tune.</p>
      ${!cameraAllowed() ? '<div class="banner info" style="margin-bottom: 16px"><span>Camera consent not given, so sessions run as plain timers.</span><button class="btn" id="give-consent">Review consent</button></div>' : ''}
      ${cameraAllowed() && !s.hasApiKey ? '<div class="banner" style="margin-bottom: 16px"><span>Add your Presage API key to turn on live readings.</span><button class="btn" id="to-settings">Open Settings</button></div>' : ''}
      ${!navigator.onLine ? '<div class="banner info" style="margin-bottom: 16px"><span class="dot warn"></span><span>Offline: timers, recovery and history still work. Live readings return when you reconnect.</span></div>' : ''}
      <div class="grid">
        <button class="preset" id="h-start" aria-pressed="false"><strong>Start ${esc(preset.name)}</strong><span>${preset.focusMinutes} min focus · ${preset.breakMinutes} min break · ${preset.blocks} blocks</span><span>Change it in Focus</span></button>
        <button class="preset" id="h-reset"><strong>Quick breathing reset</strong><span>${state.config.defaultBreathingSeconds} seconds, guided</span></button>
        <button class="preset" id="h-eyes"><strong>Eye rest</strong><span>20-second look-away</span></button>
      </div>`;
    $('#h-start').addEventListener('click', startSession);
    $('#h-reset').addEventListener('click', quickReset);
    $('#h-eyes').addEventListener('click', () => openEyeRest({ config: state.config }));
    const gc = $('#give-consent'); if (gc) gc.addEventListener('click', () => { state.timerOnly = false; showConsent(); });
    const ts = $('#to-settings'); if (ts) ts.addEventListener('click', () => go('settings'));
  },

  focus() {
    const presets = state.config.presets;
    const sel = presetById(state.selectedPreset);
    $('#view').innerHTML = `
      <h1>Start a focus session</h1>
      <p class="lead">Pick a preset. Each one sets its own timer, cue sensitivity and eye-rest rhythm.</p>
      <section class="grid" aria-label="Session presets">
        ${presets.map((p) => `<button class="preset" data-preset="${esc(p.id)}" aria-pressed="${p.id === sel.id}">
          <strong>${esc(p.name)}</strong><span>${p.focusMinutes} min focus · ${p.breakMinutes} min break</span>
          <span>${p.blocks} blocks · cues: ${esc(state.config.sensitivity[p.sensitivity].label.toLowerCase())}</span></button>`).join('')}
      </section>
      <div class="spacer"></div>
      <div class="row">
        <button class="btn primary big" id="f-start">Start ${esc(sel.name)} session</button>
        <span class="pill"><span class="dot"></span>${cameraAllowed() && state.settings.hasApiKey ? 'Signal check runs first' : 'Runs as a plain timer'}</span>
      </div>
      <p class="small" style="margin-top: 16px">Breaks adapt: a little longer after a tense block, a little shorter after a calm one.</p>`;
    $$('[data-preset]').forEach((b) => b.addEventListener('click', () => { state.selectedPreset = b.dataset.preset; VIEWS.focus(); }));
    $('#f-start').addEventListener('click', startSession);
  },

  recovery() {
    const cfg = state.config;
    const s = state.settings;
    const cp = s.customPattern;
    $('#view').innerHTML = `
      <h1>Recovery</h1>
      <p class="lead">Guided breathing and eye rests. During a focus session, resets also show your live breath.</p>
      <section class="card stack">
        <h2 style="margin: 0">Breathing session</h2>
        <div class="row" role="radiogroup" aria-label="Session length">
          ${cfg.breathingDurationsSeconds.map((d) => `<button class="chip" role="radio" aria-checked="${d === state.resetSeconds}" data-dur="${d}">${d < 60 ? `${d} s` : `${d / 60} min`}</button>`).join('')}
        </div>
        <div class="row" role="radiogroup" aria-label="Breathing pattern">
          ${cfg.breathingPatterns.map((p) => `<button class="chip" role="radio" aria-checked="${s.breathingPatternId === p.id}" data-pat="${esc(p.id)}">${esc(p.name)}</button>`).join('')}
          <button class="chip" role="radio" aria-checked="${s.breathingPatternId === 'custom'}" data-pat="custom">Custom</button>
        </div>
        <div class="row" id="custom-row" ${s.breathingPatternId === 'custom' ? '' : 'hidden'}>
          ${['inhale', 'hold', 'exhale', 'holdAfterExhale'].map((k) => `<label class="field" style="gap: 8px">${{ inhale: 'Inhale', hold: 'Hold', exhale: 'Exhale', holdAfterExhale: 'Hold after' }[k]}
            <input type="number" min="0" max="12" step="1" value="${cp[k] || 0}" data-cp="${k}" style="width: 72px; background: var(--ground); border: 1px solid var(--border-strong); border-radius: 10px; min-height: 40px; padding: 0 8px"> s</label>`).join('')}
          <span class="small" id="cp-rate">${esc((Math.round(breathsPerMinute(cp) * 10) / 10).toString())} breaths/min</span>
        </div>
        <div class="row"><button class="btn primary big" id="rec-go">Start ${state.resetSeconds < 60 ? `${state.resetSeconds}-second` : `${state.resetSeconds / 60}-minute`} session</button>
          <label class="field"><input type="checkbox" id="rec-sound" ${s.soundGuide ? 'checked' : ''}> Sound guide for eyes-closed breathing</label></div>
        <label class="field" style="justify-content: flex-start; gap: 10px"><input type="checkbox" id="rec-mic" ${s.micBreath ? 'checked' : ''}> Breath sound analysis with the microphone: times each audible breath and reports your exhale length</label>
      </section>
      <div class="spacer"></div>
      <section class="card row" style="justify-content: space-between">
        <div><h2 style="margin: 0 0 4px">Eye rest</h2><span class="small">20-second look-away with a soft chime at the end</span></div>
        <button class="btn" id="e-go">Start eye rest</button>
      </section>`;
    $$('[data-dur]').forEach((b) => b.addEventListener('click', () => { state.resetSeconds = Number(b.dataset.dur); VIEWS.recovery(); }));
    $$('[data-pat]').forEach((b) => b.addEventListener('click', async () => { await saveSettings({ breathingPatternId: b.dataset.pat }); VIEWS.recovery(); }));
    $$('[data-cp]').forEach((inp) => inp.addEventListener('change', async () => {
      const next = { ...state.settings.customPattern, [inp.dataset.cp]: Number(inp.value) };
      if (!validatePattern(next)) { toast({ title: 'That pattern is outside the safe range', body: 'Inhale 2 to 10 s, exhale 2 to 12 s, holds up to 10 s.', actions: [{ label: 'OK' }] }); inp.value = state.settings.customPattern[inp.dataset.cp] || 0; return; }
      await saveSettings({ customPattern: next });
      $('#cp-rate').textContent = `${Math.round(breathsPerMinute(next) * 10) / 10} breaths/min`;
    }));
    $('#rec-sound').addEventListener('change', (e) => saveSettings({ soundGuide: e.target.checked }));
    $('#rec-mic').addEventListener('change', (e) => {
      if (e.target.checked) { e.target.checked = false; askMicConsent(() => VIEWS.recovery()); }
      else saveSettings({ micBreath: false });
    });
    $('#rec-go').addEventListener('click', quickReset);
    $('#e-go').addEventListener('click', () => openEyeRest({ config: state.config }));
  },

  async insights() {
    const sessions = await window.sova.listSessions();
    const w = weekly(sessions);
    const ba = beforeAfter(sessions);
    const pat = patterns(sessions);
    const maxDay = Math.max(1, ...w.days.map((d) => d.focusMinutes));
    const pick = state.insightSession && sessions.find((s) => s.id === state.insightSession) || sessions[0];
    const SIG = { breathing: ['Breathing', 'breaths/min'], pulse: ['Pulse', 'bpm'], hrv: ['HRV (RMSSD)', 'ms'] };
    $('#view').innerHTML = `
      <h1>Insights</h1>
      <p class="lead">Built only from sessions stored on this computer. Nothing here is estimated.</p>
      <div class="stack">
        <section class="card stack">
          <h2 style="margin: 0">Focus timeline replay</h2>
          ${sessions.length ? `
          <label class="field" style="justify-content: flex-start; gap: 12px">Session
            <select id="tl-pick">${sessions.slice(0, 30).map((s) => `<option value="${esc(s.id)}" ${pick && s.id === pick.id ? 'selected' : ''}>${esc(fmtDate(s.startedAt))} · ${esc(s.presetName)} · ${esc(fmtMinutes(s.focusSeconds))}</option>`).join('')}</select></label>
          <div id="tl">${renderTimeline(pick)}</div>` : '<p class="small" style="margin: 0">No sessions yet. Your first session will appear here.</p>'}
        </section>

        <section class="card stack">
          <h2 style="margin: 0">This week</h2>
          <div style="display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 8px; align-items: end; height: 120px" role="img" aria-label="Focus minutes per day this week">
            ${w.days.map((d) => `<div style="display: flex; flex-direction: column; align-items: center; gap: 6px; height: 100%; justify-content: flex-end">
              <span class="small">${d.focusMinutes || ''}</span>
              <div style="width: 100%; max-width: 44px; height: ${Math.round((d.focusMinutes / maxDay) * 70)}px; min-height: 3px; border-radius: 6px 6px 2px 2px; background: ${d.focusMinutes ? '#7FA6E8' : '#25314A'}"></div>
              <span class="small">${esc(d.label)}</span></div>`).join('')}
          </div>
          <div class="grid">
            <div><div class="num" style="font-size: 24px">${esc(fmtMinutes(w.focusMinutes * 60))}</div><div class="small">Focus time</div></div>
            <div><div class="num" style="font-size: 24px">${w.sessions}</div><div class="small">Sessions</div></div>
            <div><div class="num" style="font-size: 24px">${w.breaksTaken}${w.breaksStarted ? ` of ${w.breaksStarted}` : ''}</div><div class="small">Breaks taken</div></div>
            <div><div class="num" style="font-size: 24px">${w.eyeRests}</div><div class="small">Eye rests taken</div></div>
            <div><div class="num" style="font-size: 24px">${w.resets}</div><div class="small">Resets attempted</div></div>
          </div>
          <span class="small">No streaks. Rest days are part of the rhythm.</span>
        </section>

        <section class="card stack">
          <h2 style="margin: 0">Before and after resets</h2>
          <p class="small" style="margin: 0">Average of resets where the signal was reliable just before and 60 seconds after.</p>
          ${Object.entries(ba).map(([k, r]) => `<div class="row" style="justify-content: space-between; border-top: 1px solid var(--border); padding-top: 10px">
            <span>${SIG[k][0]}</span>
            ${r.enough
              ? `<span><strong>${r.before.toFixed(1)} → ${r.after.toFixed(1)}</strong> <span class="small">${SIG[k][1]} · lower in ${r.lowerAfter} of ${r.n}</span></span>`
              : `<span class="small">Not enough reliable resets yet (${r.n} of ${r.need})</span>`}
          </div>`).join('')}
        </section>

        <section class="card stack">
          <h2 style="margin: 0">Personal patterns</h2>
          ${!pat.enough ? `<p style="margin: 0">Not enough sessions yet. SOVA needs ${pat.need} sessions with live readings before it looks for patterns.</p>
            <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="${pat.need}" aria-valuenow="${pat.have}"><div style="width: ${Math.round((pat.have / pat.need) * 100)}%"></div></div>
            <span class="small">${pat.have} of ${pat.need} sessions recorded</span>`
          : pat.observations.length ? `<ul class="list">${pat.observations.map((o) => `<li><span class="dot" style="margin-top: 7px"></span><span>${esc(o.text)}</span></li>`).join('')}</ul>
            <p class="small" style="margin: 0">Observations from your own sessions, not advice or a diagnosis.</p>`
          : '<p style="margin: 0">No clear patterns yet. SOVA only reports one when your sessions show it consistently.</p>'}
        </section>
      </div>`;
    const tp = $('#tl-pick');
    if (tp) tp.addEventListener('change', () => {
      state.insightSession = tp.value;
      $('#tl').innerHTML = renderTimeline(sessions.find((s) => s.id === tp.value));
    });
  },

  async history() {
    const sessions = await window.sova.listSessions();
    const w = weekly(sessions);
    $('#view').innerHTML = `
      <h1>History</h1>
      <p class="lead">Your sessions, stored only on this computer.</p>
      <section class="card stack" style="margin-bottom: 18px">
        <h2 style="margin: 0">Consistency this week</h2>
        <div class="grid">
          <div><div class="num" style="font-size: 26px">${w.sessions}</div><div class="small">Sessions</div></div>
          <div><div class="num" style="font-size: 26px">${w.eyeRests}</div><div class="small">Eye rests taken</div></div>
          <div><div class="num" style="font-size: 26px">${w.breaksTaken}${w.breaksStarted ? ` of ${w.breaksStarted}` : ''}</div><div class="small">Breaks taken</div></div>
          <div><div class="num" style="font-size: 26px">${w.resets}</div><div class="small">Resets attempted</div></div>
          <div><div class="num" style="font-size: 26px">${w.blocksFinished}</div><div class="small">Focus blocks finished</div></div>
        </div>
        <span class="small">No streaks. Rest days are part of the rhythm.</span>
      </section>
      ${sessions.length ? `<ul class="list">${sessions.map((s) => `
        <li><button class="preset" style="width: 100%; min-height: 64px" data-sid="${esc(s.id)}">
          <strong>${esc(s.presetName)}</strong>
          <span>${esc(fmtDate(s.startedAt))} · ${esc(fmtMinutes(s.focusSeconds))}${s.reflection && s.reflection.tags && s.reflection.tags.length ? ` · ${esc(s.reflection.tags.join(', '))}` : ''}${s.mode === 'timer' ? ' · timer only' : ''}</span>
          ${s.reflection && s.reflection.note ? `<span style="color: var(--text-2)">${esc(s.reflection.note)}</span>` : ''}
        </button></li>`).join('')}</ul>` : '<p class="small">No sessions yet. Start one from Focus.</p>'}`;
    $$('[data-sid]').forEach((b) => b.addEventListener('click', () => {
      const s = sessions.find((x) => x.id === b.dataset.sid);
      if (s) showSummary(s);
    }));
  },

  sounds() {
    const s = state.settings;
    const SOUNDS = [['rain', 'Rain'], ['forest', 'Forest'], ['noise', 'Soft noise'], ['ambient', 'Ambient']];
    const playing = audio.ambient.current;
    const presetSounds = state.config.presets.filter((p) => p.sound && p.sound !== 'none')
      .map((p) => `${p.name}: ${(SOUNDS.find((x) => x[0] === p.sound) || [0, p.sound])[1]}`).join(' · ');
    $('#view').innerHTML = `
      <h1>Sounds</h1>
      <p class="lead">Ambient sounds for focus. Generated on this computer, so they work offline.</p>
      <section class="card stack" style="max-width: 720px">
        <div class="row" role="radiogroup" aria-label="Ambient sound">
          ${SOUNDS.map(([id, name]) => `<button class="chip" role="radio" aria-checked="${s.soundId === id}" data-snd="${id}">${name}</button>`).join('')}
        </div>
        <label class="stack" style="gap: 6px; font-size: 14px">Volume
          <input type="range" id="vol" min="0" max="1" step="0.05" value="${s.soundVolume}" style="accent-color: var(--accent)"></label>
        <div class="row">
          <button class="btn primary" id="play">${playing ? 'Stop' : 'Play'}</button>
          <span class="small" id="now">${playing ? `Playing ${esc((SOUNDS.find((x) => x[0] === playing) || [0, playing])[1])}` : ''}</span>
        </div>
      </section>
      <div class="spacer"></div>
      <section class="card stack" style="max-width: 720px">
        <label class="field">Play each preset's sound when a session starts <input type="checkbox" id="auto" ${s.autoSound ? 'checked' : ''}></label>
        <p class="small" style="margin: 0">${esc(presetSounds)}. Other presets stay silent.</p>
      </section>`;
    $$('[data-snd]').forEach((b) => b.addEventListener('click', async () => {
      await saveSettings({ soundId: b.dataset.snd });
      if (audio.ambient.current) audio.ambient.start(b.dataset.snd, state.settings.soundVolume);
      VIEWS.sounds();
    }));
    $('#vol').addEventListener('input', (e) => audio.ambient.setVolume(Number(e.target.value)));
    $('#vol').addEventListener('change', (e) => saveSettings({ soundVolume: Number(e.target.value) }));
    $('#play').addEventListener('click', () => {
      if (audio.ambient.current) audio.ambient.stop();
      else audio.ambient.start(state.settings.soundId, state.settings.soundVolume);
      VIEWS.sounds();
    });
    $('#auto').addEventListener('change', (e) => saveSettings({ autoSound: e.target.checked }));
  },

  async settings() {
    const s = state.settings;
    const sum = await window.sova.dataSummary();
    const cameras = await window.sova.native.cameras().catch(() => []);
    const config = state.config;
    const ov = cleanOverrides(s.cueOverrides);
    $('#view').innerHTML = `
      <h1>Settings</h1>
      <div class="stack" style="max-width: 720px">
        <section class="card stack">
          <h2 style="margin: 0">Presage API key</h2>
          ${s.apiKeyFromEnv ? '<p class="small">Using the key from the SOVA_PRESAGE_API_KEY environment variable.</p>' : `
          <p class="small">Get a free key from the <a href="${KEY_PORTAL}" target="_blank" rel="noreferrer">Presage developer portal</a>. It is encrypted with your operating system's secure storage and never leaves this computer except to sign in to Presage.</p>
          <div class="row"><input type="password" id="key" placeholder="${s.hasApiKey ? 'Key saved. Paste a new one to replace it.' : 'Paste your API key'}" style="flex: 1; min-width: 240px" aria-label="Presage API key">
            <button class="btn primary" id="key-save">Save key</button>${s.hasApiKey ? '<button class="btn" id="key-clear">Remove key</button>' : ''}</div>`}
        </section>

        <section class="card stack">
          <h2 style="margin: 0">Camera</h2>
          <label class="field">Camera
            <select id="cam"><option value="">System default</option>
              ${cameras.map((c) => `<option value="${esc(c.id)}" ${s.cameraId === c.id ? 'selected' : ''}>${esc(c.name || c.id)}</option>`).join('')}</select></label>
          <label class="field">Capture mode
            <select id="capture">
              <option value="native" ${s.captureMode !== 'renderer' ? 'selected' : ''}>Direct (recommended, steadier frame rate)</option>
              <option value="renderer" ${s.captureMode === 'renderer' ? 'selected' : ''}>Through the window (shows a preview)</option>
            </select></label>
          <p class="small" style="margin: 0">If the signal check keeps saying the camera is too slow, add light in front of you and keep Direct mode.</p>
          <label class="field">Show the floating focus widget during sessions <input type="checkbox" id="widget" ${s.showWidget !== false ? 'checked' : ''}></label>
        </section>

        <section class="card stack">
          <h2 style="margin: 0">Cues</h2>
          <label class="field">Cue sensitivity
            <select id="sens"><option value="">Use each preset's setting</option>
              ${Object.entries(state.config.sensitivity).map(([k, v]) => `<option value="${k}" ${s.sensitivity === k ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</select></label>
          <details class="stack" style="gap: 10px" ${Object.values(s.cueOverrides || {}).some((v) => v !== null && v !== true) ? 'open' : ''}>
            <summary style="cursor: pointer; min-height: 32px">Fine-tune cues</summary>
            ${[
              ['breathingRisePct', 'Breathing rise before a cue', '%', config.cues.tension.breathingRisePct],
              ['pulseRiseBpm', 'Pulse rise before a cue', 'bpm', config.cues.tension.pulseRiseBpm],
              ['hrvDropPct', 'HRV drop before a cue', '%', config.cues.tension.hrvDropPct],
              ['windowMinutes', 'How long the change must last', 'min', config.cues.tension.windowSeconds / 60],
              ['cooldownMinutes', 'Minimum time between cues', 'min', config.cues.cooldownMinutes],
              ['eyeRestEveryMinutes', 'Eye-rest reminder every', 'min', null],
            ].map(([k, label, unit, def]) => `<label class="field">${label}
              <span class="row" style="gap: 8px"><input type="number" data-ov="${k}" min="${LIMITS[k][0]}" max="${LIMITS[k][1]}" value="${ov[k] ?? ''}" placeholder="${def ?? 'preset'}" style="width: 90px; background: var(--ground); border: 1px solid var(--border-strong); border-radius: 10px; min-height: 40px; padding: 0 8px"><span class="small" style="width: 30px">${unit}</span></span></label>`).join('')}
            <label class="field">Tension cues <input type="checkbox" data-ovb="tensionCues" ${ov.tensionCues ? 'checked' : ''}></label>
            <label class="field">Eye-rest reminders <input type="checkbox" data-ovb="eyeRestCues" ${ov.eyeRestCues ? 'checked' : ''}></label>
            <label class="field">Automatic meeting snooze (talking detection) <input type="checkbox" data-ovb="autoMeetingSnooze" ${ov.autoMeetingSnooze ? 'checked' : ''}></label>
            <div class="row"><button class="btn" id="ov-reset">Reset to defaults</button><span class="small">Empty fields use SOVA's defaults. Values outside the safe range are adjusted.</span></div>
          </details>
          <label class="field">Quiet hours <input type="checkbox" id="qh-on" ${s.quietHours.enabled ? 'checked' : ''}></label>
          <div class="row"><label class="field" style="gap: 8px">From <input type="time" id="qh-start" value="${esc(s.quietHours.start)}"></label>
            <label class="field" style="gap: 8px">To <input type="time" id="qh-end" value="${esc(s.quietHours.end)}"></label></div>
        </section>

        <section class="card stack">
          <h2 style="margin: 0">Privacy and data</h2>
          <div class="row" style="justify-content: space-between"><span class="small">Sessions stored</span><span>${sum.sessions}</span></div>
          <div class="row" style="justify-content: space-between"><span class="small">Reflections and notes</span><span>${sum.reflections} / ${sum.notes}</span></div>
          <div class="row" style="justify-content: space-between"><span class="small">Video or photos</span><span style="color: var(--accent)">None, ever</span></div>
          <div class="row" style="justify-content: space-between"><span class="small">Sent to Presage</span><span>Session sign-in${s.telemetry ? ' and anonymous diagnostics' : ' only'}</span></div>
          <label class="field">Breath sound analysis with the microphone (resets only, never recorded) <input type="checkbox" id="mic" ${s.micBreath ? 'checked' : ''}></label>
          <label class="field">AI reflections from Presage (check-ins and end-of-session reflection) <input type="checkbox" id="ai" ${s.aiReflections ? 'checked' : ''}></label>
          <label class="field">Share anonymous SDK diagnostics with Presage <input type="checkbox" id="telemetry" ${s.telemetry ? 'checked' : ''}></label>
          <p class="small" style="margin: 0">Diagnostics are one summary per session: SDK version, device model, frame-rate and quality counts. Never video, readings or identifiers. <a href="${PRIVACY_POLICY}" target="_blank" rel="noreferrer">Presage privacy policy</a></p>
          <div class="row"><button class="btn" id="exp-csv">Export CSV</button><button class="btn" id="exp-json">Export JSON</button><button class="btn warn" id="del">Delete all data</button></div>
        </section>

        <section class="card stack">
          <h2 style="margin: 0">Accessibility</h2>
          <label class="field">Reduced-motion breathing guide <input type="checkbox" id="rm" ${s.reducedMotion ? 'checked' : ''}></label>
          <label class="field">Sound guide for breathing resets <input type="checkbox" id="sg" ${s.soundGuide ? 'checked' : ''}></label>
        </section>

        <section class="card stack">
          <h2 style="margin: 0">Camera consent</h2>
          <p class="small" style="margin: 0">${cameraAllowed() ? 'Given.' : 'Not given: sessions run as plain timers.'}</p>
          <div class="row"><button class="btn" id="consent">Review consent</button></div>
        </section>
      </div>`;

    const keySave = $('#key-save');
    if (keySave) keySave.addEventListener('click', async () => {
      const r = await window.sova.setApiKey($('#key').value);
      if (r.ok) { toast({ title: 'API key saved', actions: [{ label: 'OK' }] }); state.settings = await window.sova.getSettings(); VIEWS.settings(); }
      else toast({ title: "Couldn't save the key", body: r.reason === 'no-encryption' ? 'Secure storage is not available on this system. Set SOVA_PRESAGE_API_KEY instead.' : 'Paste a key first.', actions: [{ label: 'OK' }] });
    });
    const keyClear = $('#key-clear');
    if (keyClear) keyClear.addEventListener('click', async () => { await window.sova.clearApiKey(); state.settings = await window.sova.getSettings(); VIEWS.settings(); });

    const saveOv = async () => {
      const next = {};
      $$('[data-ov]').forEach((i) => { next[i.dataset.ov] = i.value === '' ? null : Number(i.value); });
      $$('[data-ovb]').forEach((i) => { next[i.dataset.ovb] = i.checked; });
      const clean = cleanOverrides(next);
      await saveSettings({ cueOverrides: clean });
      $$('[data-ov]').forEach((i) => { i.value = clean[i.dataset.ov] ?? ''; });
    };
    $$('[data-ov], [data-ovb]').forEach((i) => i.addEventListener('change', saveOv));
    $('#ov-reset').addEventListener('click', async () => { await saveSettings({ cueOverrides: {} }); VIEWS.settings(); });
    $('#widget').addEventListener('change', (e) => saveSettings({ showWidget: e.target.checked }));
    $('#cam').addEventListener('change', (e) => saveSettings({ cameraId: e.target.value || null }));
    $('#capture').addEventListener('change', (e) => saveSettings({ captureMode: e.target.value }));
    $('#sens').addEventListener('change', (e) => saveSettings({ sensitivity: e.target.value || null }));
    const qh = () => saveSettings({ quietHours: { enabled: $('#qh-on').checked, start: $('#qh-start').value || '21:00', end: $('#qh-end').value || '08:00' } });
    ['#qh-on', '#qh-start', '#qh-end'].forEach((id) => $(id).addEventListener('change', qh));
    $('#mic').addEventListener('change', (e) => {
      if (e.target.checked) { e.target.checked = false; askMicConsent(() => VIEWS.settings()); }
      else saveSettings({ micBreath: false });
    });
    $('#ai').addEventListener('change', (e) => {
      if (!e.target.checked) { saveSettings({ aiReflections: false }); return; }
      e.target.checked = false;
      toast({
        title: 'Turn on AI reflections?',
        body: "When you press AI check-in, and at the end of a session, SOVA sends a short prompt with your session summary (preset, focus minutes, counts of cues, resets and eye rests, your baseline and breath-sound results) to Presage, together with the pulse, HRV and breathing values the SDK has buffered. Presage forwards it to a large language model. Never video. The reply is saved with the session on this computer. AI can be wrong and is not medical advice.",
        actions: [
          { label: 'Turn on', primary: true, onClick: async () => { await saveSettings({ aiReflections: true }); VIEWS.settings(); } },
          { label: 'Cancel' },
        ],
      });
    });
    $('#telemetry').addEventListener('change', async (e) => { await saveSettings({ telemetry: e.target.checked }); VIEWS.settings(); });
    $('#rm').addEventListener('change', (e) => saveSettings({ reducedMotion: e.target.checked }));
    $('#sg').addEventListener('change', (e) => saveSettings({ soundGuide: e.target.checked }));
    $('#exp-csv').addEventListener('click', () => window.sova.exportData('csv'));
    $('#exp-json').addEventListener('click', () => window.sova.exportData('json'));
    $('#del').addEventListener('click', () => toast({
      title: 'Delete all SOVA data?',
      body: 'This removes every session, reflection, note, setting and your saved API key from this computer. It cannot be undone.',
      actions: [
        { label: 'Delete everything', primary: true, onClick: async () => { await window.sova.deleteAll(); state.settings = await window.sova.getSettings(); announce('All data deleted'); showConsent(); } },
        { label: 'Cancel' },
      ],
    }));
    $('#consent').addEventListener('click', () => { state.timerOnly = false; showConsent(); });
  },
};

VIEWS['history-noop'] = () => {};

boot().catch((e) => {
  console.error('[SOVA] boot failed', e);
  document.body.innerHTML = `<p style="padding: 40px; color: #E6ECF5">SOVA could not start: ${esc(e.message)}</p>`;
});
