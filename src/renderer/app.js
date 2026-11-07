'use strict';

// SOVA renderer entry: splash, consent, navigation and every section.

const { $, $$, esc, toast, announce, fmtDate, fmtMinutes } = require('./dom');
const { LiveSession } = require('./session');
const { openReset, openEyeRest } = require('./reset');
const { breathsPerMinute, validatePattern } = require('../../shared/core/breathing');

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
        <li><span class="dot" style="margin-top: 7px"></span><span>Signals are computed on this computer by the Presage SmartSpectra SDK. It connects to Presage only to start each session. <a href="${PRIVACY_POLICY}" target="_blank" rel="noreferrer">Presage privacy policy</a></span></li>
        <li><span class="dot" style="margin-top: 7px"></span><span>Presage's anonymous SDK diagnostics are off unless you turn them on in Settings. They never include video, your readings or anything that identifies you.</span></li>
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
        <div class="row"><button class="btn primary big" id="r-go">Start ${state.resetSeconds < 60 ? `${state.resetSeconds}-second` : `${state.resetSeconds / 60}-minute`} session</button>
          <label class="field"><input type="checkbox" id="r-sound" ${s.soundGuide ? 'checked' : ''}> Sound guide for eyes-closed breathing</label></div>
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
    $('#r-sound').addEventListener('change', (e) => saveSettings({ soundGuide: e.target.checked }));
    $('#r-go').addEventListener('click', quickReset);
    $('#e-go').addEventListener('click', () => openEyeRest({ config: state.config }));
  },

  async insights() {
    const sessions = await window.sova.listSessions();
    const live = sessions.filter((s) => s.mode === 'live');
    const need = 7;
    $('#view').innerHTML = `
      <h1>Insights</h1>
      <p class="lead">Built only from your stored sessions.</p>
      <section class="card stack" style="max-width: 640px">
        <h2 style="margin: 0">Personal patterns</h2>
        ${live.length < need ? `<p style="margin: 0">Not enough sessions yet. SOVA needs ${need} sessions with live readings before it shows patterns.</p>
          <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="${need}" aria-valuenow="${live.length}"><div style="width: ${Math.round((live.length / need) * 100)}%"></div></div>
          <span class="small">${live.length} of ${need} sessions recorded</span>`
        : '<p style="margin: 0">Pattern discovery and the focus timeline replay arrive in the next build. Your sessions are already stored for them.</p>'}
      </section>`;
  },

  async history() {
    const sessions = await window.sova.listSessions();
    const weekAgo = Date.now() - 7 * 864e5;
    const week = sessions.filter((s) => Date.parse(s.startedAt) >= weekAgo);
    const sum = (type) => week.reduce((n, s) => n + countEvents(s, type), 0);
    $('#view').innerHTML = `
      <h1>History</h1>
      <p class="lead">Your sessions, stored only on this computer.</p>
      <section class="card stack" style="margin-bottom: 18px">
        <h2 style="margin: 0">This week</h2>
        <div class="grid">
          <div><div class="num" style="font-size: 26px">${week.length}</div><div class="small">Sessions</div></div>
          <div><div class="num" style="font-size: 26px">${sum('eye-rest')}</div><div class="small">Eye rests taken</div></div>
          <div><div class="num" style="font-size: 26px">${sum('reset')}</div><div class="small">Resets attempted</div></div>
          <div><div class="num" style="font-size: 26px">${week.reduce((n, s) => n + (s.blocksCompleted || 0), 0)}</div><div class="small">Focus blocks finished</div></div>
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
    $('#view').innerHTML = `
      <h1>Sounds</h1>
      <p class="lead">Ambient focus sounds (rain, forest, soft noise) are planned for a later build and will play offline.</p>
      <section class="card small" style="max-width: 640px">Available now: the sound guide for eyes-closed breathing (Recovery) and the eye-rest chime.</section>`;
  },

  async settings() {
    const s = state.settings;
    const sum = await window.sova.dataSummary();
    const cameras = await window.sova.native.cameras().catch(() => []);
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
        </section>

        <section class="card stack">
          <h2 style="margin: 0">Cues</h2>
          <label class="field">Cue sensitivity
            <select id="sens"><option value="">Use each preset's setting</option>
              ${Object.entries(state.config.sensitivity).map(([k, v]) => `<option value="${k}" ${s.sensitivity === k ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</select></label>
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

    $('#cam').addEventListener('change', (e) => saveSettings({ cameraId: e.target.value || null }));
    $('#capture').addEventListener('change', (e) => saveSettings({ captureMode: e.target.value }));
    $('#sens').addEventListener('change', (e) => saveSettings({ sensitivity: e.target.value || null }));
    const qh = () => saveSettings({ quietHours: { enabled: $('#qh-on').checked, start: $('#qh-start').value || '21:00', end: $('#qh-end').value || '08:00' } });
    ['#qh-on', '#qh-start', '#qh-end'].forEach((id) => $(id).addEventListener('change', qh));
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
