'use strict';

// SOVA renderer entry: splash, consent, top navigation and every section.

const { $, $$, esc, toast, announce, switchRow, tip, fmtDate, fmtMinutes } = require('./dom');
const { LiveSession } = require('./session');
const { openReset, openEyeRest } = require('./reset');
const { breathsPerMinute, validatePattern, guideAt, PHASE_TEXT } = require('../../shared/core/breathing');
const { weekly, beforeAfter, patterns } = require('../../shared/core/insights');
const { renderTimeline } = require('./timeline');
const audio = require('./audio');
const { cleanOverrides, LIMITS } = require('../../shared/core/overrides');
const { allResets, exhaleTrend } = require('../../shared/core/breathHistory');
const { BreathLines, mark } = require('./breathLines');
const { icon } = require('./icons');
const { formatClock } = require('../../shared/core/sessionEngine');
const { CheckIn, renderResults } = require('./checkin');

const PRIVACY_POLICY = 'https://api.physiology.presagetech.com/privacypolicy';
const KEY_PORTAL = 'https://physiology.presagetech.com/auth/register';

const NAV = [
  ['home', 'Home', 'house'],
  ['focus', 'Focus', 'crosshair'],
  ['recovery', 'Recovery', 'wind'],
  ['insights', 'Insights', 'chart-line'],
  ['history', 'History', 'history'],
  ['sounds', 'Sounds', 'audio-lines'],
  ['settings', 'Settings', 'settings'],
];

const SOUNDS = [
  ['rain', 'Rain', 'cloud-rain', 'Steady rainfall, a soft wash of high frequencies'],
  ['forest', 'Forest', 'trees', 'Wind in leaves with low movement'],
  ['noise', 'Soft noise', 'waves', 'Brown noise, warm and even'],
  ['ambient', 'Ambient', 'audio-lines', 'A slow, low drone with gentle movement'],
];

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

// Light, dark, or follow Windows. Applied before anything is drawn.
function applyTheme() {
  const a = (state.settings && state.settings.appearance) || 'system';
  const t = a === 'system' ? (darkQuery.matches ? 'dark' : 'light') : a;
  document.documentElement.dataset.theme = t;
  const btn = $('#theme-btn');
  if (btn) {
    btn.innerHTML = icon(t === 'dark' ? 'sun' : 'moon', 16);
    btn.setAttribute('aria-label', t === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
    btn.title = btn.getAttribute('aria-label');
  }
  const s = liveSession();
  if (s) s.updateWidget();
}

const state = {
  config: null, settings: null, view: 'home', session: null, selectedPreset: null,
  resetSeconds: 60, cleanup: null, mod: 'Ctrl',
};

// ---------------------------------------------------------------------------
// Boot

async function boot() {
  applyTheme();
  darkQuery.addEventListener('change', applyTheme);
  state.config = await window.sova.config();
  state.settings = await window.sova.getSettings();
  applyTheme();
  state.selectedPreset = state.settings.presetId;
  state.resetSeconds = state.config.defaultBreathingSeconds;
  applyMotion();

  const info = await window.sova.appInfo();
  state.mod = info.platform === 'darwin' ? 'Cmd' : 'Ctrl';

  $('#brand').innerHTML = `<span class="brand-mark">${mark(24)}</span><span class="brand-word">SOVA</span>`;
  $('#nav').innerHTML = NAV.map(([id, label, ic]) => `<button class="nav-item" data-nav="${id}" aria-current="false">${icon(ic, 16)}<span class="label">${label}</span></button>`).join('');
  $$('[data-nav]').forEach((b) => b.addEventListener('click', () => go(b.dataset.nav)));
  window.sova.onQuickReset(() => quickReset());
  window.addEventListener('online', updateTopbar);
  window.addEventListener('offline', updateTopbar);
  setInterval(updateTopbar, 1000);

  const splash = splashLines();
  setTimeout(() => {
    $('#splash').classList.add('fade');
    $('#app').hidden = false;
    setTimeout(() => { $('#splash').hidden = true; splash.stop(); }, 420);
    if (needsOnboarding()) startOnboarding();
    else go('home');
  }, 1400);
}

// The splash ribbon breathes once while SOVA loads.
function splashLines() {
  const lines = new BreathLines($('#splash-lines'), { lines: 22, reduced: reducedMotion() });
  const t0 = performance.now();
  lines.setGuide(0.2);
  lines.start();
  const timer = setInterval(() => {
    const t = (performance.now() - t0) / 1000;
    lines.setGuide(reducedMotion() ? 0.6 : 0.2 + 0.7 * Math.sin(Math.min(1, t / 1.3) * Math.PI / 2));
  }, 50);
  return { stop: () => { clearInterval(timer); lines.stop(); } };
}

function reducedMotion() {
  return !!(state.settings && state.settings.reducedMotion) || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function applyMotion() {
  document.body.classList.toggle('reduced-motion', !!state.settings.reducedMotion);
}

async function saveSettings(patch) {
  await window.sova.setSettings(patch);
  state.settings = await window.sova.getSettings();
  applyMotion();
  applyTheme();
  if (state.session && !state.session.ended) state.session.settings = { ...state.session.settings, ...patch };
}

function liveSession() {
  return state.session && !state.session.ended ? state.session : null;
}

function setCurrent(view) {
  $$('[data-nav]').forEach((b) => b.setAttribute('aria-current', b.dataset.nav === view ? 'page' : 'false'));
}

function enterView() {
  const v = $('#view');
  v.classList.remove('enter');
  void v.offsetWidth;   // restart the entrance animation
  v.classList.add('enter');
  window.scrollTo(0, 0);
}

function cleanupView() {
  if (state.cleanup) { state.cleanup(); state.cleanup = null; }
}

function go(view) {
  const s = liveSession();
  if (s && s.phaseUi === 'check' && view !== 'home' && view !== 'focus') {
    toast({ title: 'Finish the signal check first', body: 'Start the session or cancel the check, then the other sections open.', actions: [{ label: 'OK' }] });
    return;
  }
  cleanupView();
  state.view = view;
  setCurrent(view);
  enterView();
  if (s) {
    s.onScreen = view === 'home' || view === 'focus';
    if (s.onScreen) { setCurrent('focus'); s.render(); }
    else { s.stopLines(); (VIEWS[view] || VIEWS.home)(); }
  } else {
    (VIEWS[view] || VIEWS.home)();
  }
  updateTopbar();
  $('#view').focus({ preventScroll: true });
}

function setNavVisible(on) {
  $('#nav').hidden = !on;
  $('#topbar-right').hidden = !on;
}

// Right side of the top bar: the running session (or camera state and the
// quick-reset shortcut), then the light/dark switch.
function updateTopbar() {
  const el = $('#topbar-right');
  if (!el || el.hidden) return;
  if (!$('#tb-status')) {
    el.innerHTML = '<div class="row" id="tb-status"></div><button class="btn btn-quiet btn-icon" id="theme-btn"></button>';
    $('#theme-btn').addEventListener('click', async () => {
      const now = document.documentElement.dataset.theme;
      await saveSettings({ appearance: now === 'dark' ? 'light' : 'dark' });
      if (state.view === 'settings') VIEWS.settings();
    });
    applyTheme();
  }
  const box = $('#tb-status');
  const s = liveSession();
  if (s && s.phaseUi === 'running') {
    const e = s.engine;
    const live = s.mode === 'live' && !s.cameraPaused;
    const text = `${e.phase === 'focus' ? 'Focus' : 'Break'} ${formatClock(e.remaining)}`;
    const pill = $('#pill');
    if (pill) {
      pill.querySelector('.dot').className = `dot ${live ? 'live' : 'off'}`;
      pill.querySelector('.mono').textContent = text;
      return;
    }
    delete box.dataset.html;
    box.innerHTML = `<button class="session-pill" id="pill" aria-label="Back to the running session"><span class="dot ${live ? 'live' : 'off'}"></span><span>${esc(s.preset.name)}</span><span class="mono">${text}</span></button>`;
    $('#pill').addEventListener('click', () => go('focus'));
    return;
  }
  const off = !navigator.onLine;
  if (state.view === 'checkin') {
    const h = '<span class="status t-small"><span class="dot live"></span>Camera on · check-in</span>';
    if (box.dataset.html !== h) { box.innerHTML = h; box.dataset.html = h; }
    return;
  }
  const html = `
    <span class="status t-small">${off ? '<span class="dot warn"></span>Offline' : `<span class="dot off"></span>${cameraAllowed() ? 'Camera off' : 'Timer only'}`}</span>
    <span class="row" style="gap: 4px" title="Quick breathing reset from anywhere"><span class="keycap">${state.mod}</span><span class="keycap">Shift</span><span class="keycap">B</span></span>`;
  if (box.dataset.html !== html) { box.innerHTML = html; box.dataset.html = html; }
}

// ---------------------------------------------------------------------------
// Small building blocks

function pageHead(title, sub, right = '') {
  return `<div class="page-head"><div><h1 class="t-title">${esc(title)}</h1>${sub ? `<p class="t-small">${esc(sub)}</p>` : ''}</div>${right}</div>`;
}

function stat(label, value, note = '') {
  return `<div class="stat"><span class="stat-label">${esc(label)}</span><span class="t-figure">${value}</span>${note ? `<span class="stat-note">${note}</span>` : ''}</div>`;
}

function empty(text, actionHtml = '') {
  return `<div class="empty"><span>${text}</span>${actionHtml}</div>`;
}

// A preset's plan as a bar of focus blocks and breaks.
function planBar(p) {
  const parts = [];
  for (let i = 0; i < p.blocks; i++) {
    parts.push(`<span class="plan-f" style="flex: ${p.focusMinutes}"></span>`);
    if (i < p.blocks - 1) parts.push(`<span class="plan-b" style="flex: ${p.breakMinutes}"></span>`);
  }
  return `<div class="plan" role="img" aria-label="${p.blocks} focus blocks of ${p.focusMinutes} minutes with ${p.breakMinutes}-minute breaks">${parts.join('')}</div>`;
}

function presetMeta(p) {
  return `${p.focusMinutes} min focus · ${p.breakMinutes} min break · ${p.blocks} blocks`;
}

function soundName(id) {
  return (SOUNDS.find((x) => x[0] === id) || [0, id])[1];
}

function patternMeta(p) {
  const bits = [`${p.inhale} in`];
  if (p.hold) bits.push(`${p.hold} hold`);
  bits.push(`${p.exhale} out`);
  if (p.holdAfterExhale) bits.push(`${p.holdAfterExhale} hold`);
  return `${bits.join(' · ')} · ${Math.round(breathsPerMinute(p) * 10) / 10} per minute`;
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// ---------------------------------------------------------------------------
// First launch: your name, what brings you here, then camera consent

function needsOnboarding() {
  return !state.settings.onboarded || state.settings.consentVersion < state.config.consentVersion;
}

function startOnboarding({ profileOnly = false } = {}) {
  const steps = [];
  if (profileOnly || !state.settings.onboarded) steps.push('name', 'goals');
  if (!profileOnly && state.settings.consentVersion < state.config.consentVersion && !state.timerOnly) steps.push('consent');
  if (!steps.length) { setNavVisible(true); go('home'); return; }
  state.ob = { steps, i: 0, profileOnly };
  showStep();
}

function reviewConsent() {
  state.timerOnly = false;
  state.ob = { steps: ['consent'], i: 0 };
  showStep();
}

function showStep() {
  cleanupView();
  setNavVisible(false);
  state.view = 'onboarding';
  setCurrent(null);
  enterView();
  const step = state.ob.steps[state.ob.i];
  if (step === 'name') nameStep();
  else if (step === 'goals') goalsStep();
  else showConsent();
  const back = $('#ob-back');
  if (back) back.addEventListener('click', () => { state.ob.i -= 1; showStep(); });
}

function nextStep() {
  state.ob.i += 1;
  if (state.ob.i < state.ob.steps.length) return showStep();
  finishOnboarding();
}

function finishOnboarding() {
  const wasProfileOnly = state.ob && state.ob.profileOnly;
  state.ob = null;
  setNavVisible(true);
  if (wasProfileOnly) return go('settings');
  if (cameraAllowed() && !state.settings.hasApiKey) {
    go('settings');
    toast({ title: 'One more step', body: 'Add your Presage API key below to turn on live readings.', actions: [{ label: 'OK' }] });
    return;
  }
  go('home');
}

function obHead() {
  const { steps, i } = state.ob;
  return `<div class="ob-head">
      <button class="btn btn-quiet btn-icon" id="ob-back" aria-label="Back" ${i === 0 ? 'hidden' : ''}><span style="display: inline-flex; transform: scaleX(-1)">${icon('chevron-right', 18)}</span></button>
      ${steps.length > 1 ? `<div class="ob-progress" role="progressbar" aria-label="Setup progress" aria-valuemin="1" aria-valuemax="${steps.length}" aria-valuenow="${i + 1}">${steps.map((_, k) => `<span class="${k <= i ? 'on' : ''}"></span>`).join('')}</div>` : ''}
    </div>`;
}

function nameStep() {
  $('#view').innerHTML = `
    <div class="onboard stack-24">
      ${obHead()}
      <div class="stack-8"><span class="brand-mark">${mark(36)}</span>
        <h1 class="t-title">What should SOVA call you?</h1>
        <p class="t-body t-2">Your name stays on this computer and is only used to greet you. No account, no password.</p></div>
      <input type="text" id="ob-name" maxlength="40" autocomplete="given-name" placeholder="Your first name" aria-label="Your name" value="${esc(state.settings.profileName || '')}" style="height: 52px; font-size: 18px">
      <div class="row"><button class="btn btn-primary btn-lg" id="ob-next">Continue</button><button class="btn btn-quiet btn-lg" id="ob-skip">Skip</button></div>
    </div>`;
  const next = async () => { await saveSettings({ profileName: $('#ob-name').value }); nextStep(); };
  $('#ob-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') next(); });
  $('#ob-next').addEventListener('click', next);
  $('#ob-skip').addEventListener('click', nextStep);
  $('#ob-name').focus();
}

function goalsStep() {
  const goals = state.config.goals;
  const picked = new Set(state.settings.goals || []);
  $('#view').innerHTML = `
    <div class="onboard stack-24">
      ${obHead()}
      <div class="stack-8"><h1 class="t-title">${state.settings.profileName ? `${esc(state.settings.profileName)}, what` : 'What'} brings you here?</h1>
        <p class="t-body t-2">Pick as many as you like. SOVA sets your starting preset and breathing pattern from this, and you can change both at any time.</p></div>
      <div class="stack-8" role="group" aria-label="Your goals">
        ${goals.map((g) => `<button class="choice goal" role="checkbox" aria-checked="${picked.has(g.id)}" data-goal="${esc(g.id)}">
          <span class="choice-name"><span class="goal-icon">${icon(g.icon, 18)}</span>${esc(g.name)}</span>
          <span class="choice-meta" style="padding-left: 44px">${esc(g.meta)}</span>
          <span class="choice-aside"><span class="check">${icon('check', 14)}</span></span></button>`).join('')}
      </div>
      <div class="row"><button class="btn btn-primary btn-lg" id="ob-next">Continue</button></div>
    </div>`;
  $$('[data-goal]').forEach((b) => b.addEventListener('click', () => {
    const id = b.dataset.goal;
    if (picked.has(id)) picked.delete(id); else picked.add(id);
    b.setAttribute('aria-checked', String(picked.has(id)));
  }));
  $('#ob-next').addEventListener('click', async () => {
    const chosen = goals.filter((g) => picked.has(g.id));
    const patch = { goals: chosen.map((g) => g.id), onboarded: true };
    const withPreset = chosen.find((g) => g.presetId);
    const withPattern = chosen.find((g) => g.patternId);
    if (withPreset) { patch.presetId = withPreset.presetId; state.selectedPreset = withPreset.presetId; }
    if (withPattern) patch.breathingPatternId = withPattern.patternId;
    await saveSettings(patch);
    nextStep();
  });
}

function showConsent() {
  const item = (ic, text) => `<div class="obs">${icon(ic, 18)}<span class="t-body">${text}</span></div>`;
  $('#view').innerHTML = `
    <div class="onboard stack-24">
      ${state.ob ? obHead() : ''}
      <div class="stack-8"><h1 class="t-title">Before your first session</h1>
        <p class="t-body t-2">SOVA uses your camera to estimate breathing, pulse, HRV, blinking and talking while you focus. Here is exactly what happens.</p></div>
      <section class="panel">
        ${item('camera', 'The camera is on only during a focus session or reset, with an indicator and a pause button.')}
        ${item('shield-check', 'No video or photos are ever recorded or saved.')}
        ${item('activity', `Signals are computed on this computer by the Presage SmartSpectra SDK. It connects to Presage to start each session. <a href="${PRIVACY_POLICY}" target="_blank" rel="noreferrer">Presage privacy policy</a>`)}
        ${item('message-square-text', "During a session the SDK also sends your pulse, HRV and breathing values (never video) to Presage's AI service for automatic vitals check-ins, about once a minute. SOVA cannot switch this off.")}
        ${item('sliders-horizontal', "Presage's anonymous SDK diagnostics are off unless you turn them on in Settings. They never include video, your readings or anything that identifies you.")}
        ${item('mic', 'Optional and off until you turn them on, each with its own consent: breath sound analysis with the microphone (never recorded), and AI reflections from Presage.')}
        ${item('download', 'Only session summaries, signal check-in results, your baseline, reflections, notes, your name and feelings are stored, on this computer. You can export or delete them at any time.')}
      </section>
      <p class="t-small">SOVA is a focus and self-reflection tool. It is not a medical device and is not for diagnosis or treatment.</p>
      <label class="row" style="min-height: 44px; cursor: pointer"><input type="checkbox" id="consent-check"><span class="t-body">I understand and agree to camera use during sessions</span></label>
      <div class="row">
        <button class="btn btn-primary btn-lg" id="consent-ok" disabled>${icon('camera', 18)}Allow camera and continue</button>
        <button class="btn btn-quiet btn-lg" id="consent-no">Not now, use timer only</button>
      </div>
    </div>`;
  $('#consent-check').addEventListener('change', (e) => { $('#consent-ok').disabled = !e.target.checked; });
  $('#consent-ok').addEventListener('click', async () => {
    await saveSettings({ consentVersion: state.config.consentVersion });
    state.timerOnly = false;
    nextStep();
  });
  $('#consent-no').addEventListener('click', () => { state.timerOnly = true; nextStep(); });
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
  cleanupView();
  state.view = 'focus';
  setCurrent('focus');
  enterView();
  state.session = new LiveSession({
    config: state.config,
    settings: state.settings,
    preset,
    apiKey,
    checkIn: recentCheckIn(),
    onEnd: (record) => { state.session = null; showReflection(record); },
  });
  state.session.onScreen = true;
  await state.session.begin();
  updateTopbar();
}

// ---------------------------------------------------------------------------
// 60-second signal check-in (never starts the focus timer)

function checkSummary(c) {
  const v = c.values || {};
  const bits = [];
  if (v.breathing != null) bits.push(`${Math.round(v.breathing)} breaths/min`);
  if (v.pulse != null) bits.push(`${Math.round(v.pulse)} bpm`);
  if (v.hrv != null) bits.push(`${Math.round(v.hrv)} ms HRV`);
  return bits.length ? bits.join(' · ') : 'no steady readings';
}

async function startCheckIn() {
  if (liveSession()) {
    toast({ title: 'A focus session is using the camera', body: 'End the session first, or look at its live readings on the Focus screen.', actions: [{ label: 'OK' }] });
    return;
  }
  if (!cameraAllowed()) {
    toast({ title: 'Check-ins use the camera', body: 'Give camera consent first. It is the same consent as for focus sessions.', actions: [{ label: 'Review consent', primary: true, onClick: reviewConsent }, { label: 'Not now' }] });
    return;
  }
  if (!state.settings.hasApiKey) {
    toast({ title: 'Add your Presage API key first', body: 'Check-ins need live readings from the SmartSpectra SDK.', actions: [{ label: 'Open Settings', primary: true, onClick: () => go('settings') }, { label: 'Not now' }] });
    return;
  }
  cleanupView();
  state.view = 'checkin';
  setCurrent('home');
  enterView();
  const apiKey = await window.sova.getApiKey();
  const c = new CheckIn({ config: state.config, settings: state.settings, apiKey, reducedMotion: reducedMotion(), onFinish: onCheckInFinish });
  state.cleanup = () => c.cancel(true);
  updateTopbar();
  await c.begin();
}

async function onCheckInFinish({ action, record }) {
  state.cleanup = null;
  if (action === 'results') {
    await window.sova.saveCheckIn(record);
    return showCheckInResults(record, false);
  }
  go('home');
}

async function showCheckInResults(record, fromHistory) {
  const [checkIns, sessions] = await Promise.all([window.sova.listCheckIns(), window.sova.listSessions()]);
  cleanupView();
  state.view = 'checkin-results';
  setCurrent(fromHistory ? 'history' : 'home');
  enterView();
  renderResults({
    record, checkIns, sessions, feelings: state.config.feelings, fromHistory,
    onFeeling: (r) => window.sova.saveCheckIn(r),
    onNext: (action) => {
      if (action === 'reset') quickReset();
      else if (action === 'focus') go('focus');
      else if (action === 'history') { state.historyTab = 'checkins'; go('history'); }
      else go('home');
    },
  });
}

function patternById(id) {
  if (id === 'custom') return { id: 'custom', name: 'Custom pattern', ...state.settings.customPattern };
  return state.config.breathingPatterns.find((p) => p.id === id) || state.config.breathingPatterns[0];
}

// opts: { seconds, patternId } for the "what's going on?" resets.
function quickReset(opts = {}) {
  if (!$('#overlay').hidden) return;
  const pattern = opts.patternId ? patternById(opts.patternId) : currentPattern();
  const seconds = opts.seconds || state.resetSeconds;
  const s = liveSession();
  if (s && s.phaseUi === 'running') return s.startReset(seconds, pattern);
  const startedAt = new Date().toISOString();
  openReset({
    config: state.config, settings: state.settings, pattern, seconds, live: null,
    onDone: async (res) => {
      if (res.seconds < 10) return;   // ended almost immediately: nothing worth keeping
      await window.sova.saveReset({
        id: `r_${Date.now().toString(36)}`,
        at: startedAt,
        seconds: res.seconds,
        completed: res.completed,
        patternId: pattern.id || 'custom',
        pattern: { inhale: pattern.inhale, hold: pattern.hold || 0, exhale: pattern.exhale, holdAfterExhale: pattern.holdAfterExhale || 0 },
        breathSound: res.breathSound || null,
      });
      if (state.view === 'history' || state.view === 'home') VIEWS[state.view]();
    },
  });
}

function eyeRest() {
  if (!$('#overlay').hidden) return;
  openEyeRest({ config: state.config });
}

function currentPattern() {
  return patternById(state.settings.breathingPatternId);
}

function startSituation(id) {
  const sit = state.config.situations.find((x) => x.id === id);
  if (!sit) return;
  if (sit.eyeRest) return eyeRest();
  quickReset({ seconds: sit.seconds, patternId: sit.patternId });
}

// The Home check-in counts for a session started within 6 hours of it.
function recentCheckIn() {
  const c = state.settings.lastCheckIn;
  if (!c || !c.at) return null;
  return Date.now() - Date.parse(c.at) <= 6 * 3600 * 1000 ? c : null;
}

function todaysCheckIn() {
  const c = state.settings.lastCheckIn;
  return c && c.at && Date.parse(c.at) >= startOfToday() ? c : null;
}

const FEELING_REPLY = {
  Calm: { text: 'A good place to start from. Pick up where you left off.' },
  Focused: { text: 'Make the most of it. A longer block may suit you today.' },
  Tense: { text: 'A 90-second reset before you start can help you settle.', situation: 'overwhelmed', action: 'Start a 90-second reset' },
  Tired: { text: 'Shorter blocks and an eye rest now and then may suit you today.', situation: 'tired-eyes', action: 'Rest your eyes' },
  Scattered: { text: 'Two minutes of slow breathing can help you land before you start.', situation: 'between-meetings', action: 'Start a 2-minute reset' },
};

function situationRows(compact = false) {
  return state.config.situations.map((x) => `<button class="choice" data-sit="${esc(x.id)}">
      <span class="choice-name">${icon(x.eyeRest ? 'eye' : 'wind', 16)} ${esc(x.name)}</span>
      <span class="choice-meta">${esc(x.meta)}${x.eyeRest ? '' : ` · ${x.seconds < 60 ? `${x.seconds} s` : `${Math.round(x.seconds / 6) / 10} min`}${compact ? '' : ` · ${esc(patternById(x.patternId).name)}`}`}</span>
      <span class="choice-aside">${icon('chevron-right', 16)}</span></button>`).join('');
}

function bindSituations() {
  $$('[data-sit]').forEach((b) => b.addEventListener('click', () => startSituation(b.dataset.sit)));
}

// ---------------------------------------------------------------------------
// End-of-session reflection and summary

const REFLECTION_TAGS = ['Calm', 'Productive', 'Distracted', 'Tired', 'Overwhelmed'];

function showReflection(record) {
  cleanupView();
  state.view = 'reflection';
  setCurrent(null);
  enterView();
  updateTopbar();
  const picked = new Set();
  $('#view').innerHTML = `
    <div class="stack-24" style="max-width: 640px; margin: 4vh auto 0">
      <div class="stack-8"><p class="t-small">${esc(record.presetName)} · ${esc(fmtMinutes(record.focusSeconds))} focused · optional</p>
        <h1 class="t-title">How did that session feel?</h1></div>
      <div class="row" role="group" aria-label="Session feeling">
        ${REFLECTION_TAGS.map((t) => `<button class="chip" aria-pressed="false" data-tag="${esc(t)}">${esc(t)}</button>`).join('')}
      </div>
      <label class="stack-8"><span class="t-section">Session note</span>
        <textarea id="note" rows="5" placeholder="What helped or got in the way?"></textarea></label>
      <p class="t-small">Your answer and note stay on this computer. They're included in export and removed by delete all.</p>
      <div class="row"><button class="btn btn-primary btn-lg" id="save">Save and see summary</button><button class="btn btn-quiet btn-lg" id="skipr">Skip</button></div>
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
  cleanupView();
  state.view = 'summary';
  setCurrent(null);
  enterView();
  const resets = (record.events || []).filter((e) => e.type === 'reset');
  const ba = resets.filter((r) => r.before && r.after);
  $('#view').innerHTML = `
    ${pageHead(record.presetName, `Session complete · ${fmtDate(record.startedAt)}${record.checkIn ? ` · you started feeling ${record.checkIn.feeling.toLowerCase()}` : ''}`, `<div class="row"><button class="btn btn-primary" id="again">${icon('play', 16)}Start another session</button><button class="btn btn-quiet" id="hist">${icon('history', 16)}Go to History</button></div>`)}
    <div class="stack-24">
      <div class="grid-4">
        ${stat('Focus time', esc(fmtMinutes(record.focusSeconds)))}
        ${stat('Blocks done', `${record.blocksCompleted} <span class="t-2" style="font-size: 15px">of ${record.blocksPlanned}</span>`)}
        ${stat('Resets taken', resets.length)}
        ${stat('Eye rests taken', countEvents(record, 'eye-rest'))}
      </div>
      <section class="panel"><div class="panel-head"><h2 class="t-section">Timeline</h2></div>${renderTimeline(record)}</section>
      <div class="grid-2">
        <section class="panel">
          <div class="panel-head"><h2 class="t-section">Before and after resets</h2><span class="t-meta">60 s after</span></div>
          ${record.mode !== 'live' ? empty('This session ran as a plain timer, so there are no signal readings.')
            : ba.length ? `<table class="table"><thead><tr><th>Reset</th><th>Breathing</th><th>Pulse</th><th>HRV</th></tr></thead>
              <tbody>${ba.map((r, i) => `<tr><td>${i + 1}</td><td>${pair(r.before.breathing, r.after.breathing)}</td><td>${pair(r.before.pulse, r.after.pulse)}</td><td>${pair(r.before.hrv, r.after.hrv)}</td></tr>`).join('')}</tbody></table>
              <p class="t-small" style="margin-top: 12px">"Not shown" means the signal was not reliable enough at that moment.</p>`
            : empty('No reset had reliable readings both before and 60 seconds after, so there is nothing to compare.')}
        </section>
        <section class="panel">
          <div class="panel-head"><h2 class="t-section">AI reflection</h2>${record.ai && record.ai.text ? '<span class="t-meta">Presage AI</span>' : ''}</div>
          ${record.ai && record.ai.text ? `<p class="t-body">${esc(record.ai.text)}</p><p class="t-small" style="margin-top: 12px">Written by Presage AI from your measured pulse, HRV and breathing. AI can be wrong. Not medical advice.</p>`
            : empty(record.ai && record.ai.error ? esc(record.ai.error) : 'No AI reflection for this session. You can turn AI reflections on in Settings.')}
        </section>
      </div>
      ${resets.some((r) => r.breathSound) ? `<section class="panel"><div class="panel-head"><h2 class="t-section">Breath sounds</h2><span class="t-meta">Microphone · never recorded</span></div>
        <div class="rows">${resets.filter((r) => r.breathSound).map((r, i) => `<div class="row-item"><span class="row-title">Reset ${i + 1}</span><span class="row-sub">${r.breathSound.lines.map(esc).join(' ')}</span></div>`).join('')}</div></section>` : ''}
    </div>`;
  $('#again').addEventListener('click', () => go('focus'));
  $('#hist').addEventListener('click', () => go('history'));
}

// Sessions grouped by the feeling you reported before starting. Counts only.
function feelingRows(sessions) {
  const withCheck = sessions.filter((x) => x.checkIn && x.checkIn.feeling);
  if (!withCheck.length) return empty('Answer "How are you feeling?" on Home before a session. SOVA then shows here how sessions went for each starting feeling.');
  const rows = state.config.feelings.map((f) => {
    const list = withCheck.filter((x) => x.checkIn.feeling === f);
    if (!list.length) return '';
    const mins = Math.round(list.reduce((n, x) => n + (x.focusSeconds || 0), 0) / list.length / 60);
    const withReset = list.filter((x) => countEvents(x, 'reset') > 0).length;
    return `<div class="row-item"><span class="row-title">${esc(f)}</span>
      <span class="row-sub">${list.length} session${list.length === 1 ? '' : 's'} · ${mins} min focus on average · a reset in ${withReset} of ${list.length}</span></div>`;
  }).join('');
  return `<div class="rows">${rows}</div><p class="t-small" style="margin-top: 12px">Your own answers, counted. Not a measurement or a diagnosis.</p>`;
}

function pair(a, b) {
  const f = (v) => (v == null ? '<span class="t-meta">Not shown</span>' : `<span class="num">${esc(Math.round(v))}</span>`);
  return `${f(a)} <span class="t-2">→</span> ${f(b)}`;
}

// ---------------------------------------------------------------------------
// Sections

const VIEWS = {
  async home() {
    const [sessions, standalone, checkIns] = await Promise.all([window.sova.listSessions(), window.sova.listResets(), window.sova.listCheckIns()]);
    if (state.view !== 'home') return;
    const preset = presetById(state.selectedPreset);
    const lastCheck = checkIns[0];
    const s = state.settings;
    const t0 = startOfToday();
    const today = sessions.filter((x) => Date.parse(x.startedAt) >= t0);
    const focusToday = today.reduce((n, x) => n + (x.focusSeconds || 0), 0);
    const resetsToday = today.reduce((n, x) => n + countEvents(x, 'reset'), 0) + standalone.filter((r) => Date.parse(r.at) >= t0 && r.seconds >= 10).length;
    const eyesToday = today.reduce((n, x) => n + countEvents(x, 'eye-rest'), 0);
    const checksToday = checkIns.filter((c) => Date.parse(c.at) >= t0).length;
    const last = sessions[0];
    const hour = new Date().getHours();
    const greeting = hour < 5 ? 'Good evening' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    const name = (s.profileName || '').trim();
    const check = todaysCheckIn();
    $('#view').innerHTML = `
      <div class="page-head greet">
        <div class="stack-8">
          <span class="t-small">${esc(new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }))}</span>
          <h1 class="t-display greet-title">${esc(greeting)}${name ? `, <span class="greet-name">${esc(name)}</span>` : ''}</h1>
          <p class="t-body t-2">How are you feeling right now?</p>
        </div>
      </div>
      <section class="feel stack" aria-label="How are you feeling?">
        <div class="row" role="radiogroup" aria-label="How are you feeling?">
          ${state.config.feelings.map((f) => `<button class="chip" role="radio" aria-checked="${!!(check && check.feeling === f)}" data-feel="${esc(f)}">${esc(f)}</button>`).join('')}
        </div>
        <div id="feel-reply" aria-live="polite"></div>
      </section>
      <div class="stack-24" style="margin-top: 24px">
        ${!cameraAllowed() ? `<div class="notice"><span class="dot off"></span><span class="grow">Camera consent not given, so sessions run as plain timers.</span><button class="btn" id="give-consent">Review consent</button></div>` : ''}
        ${cameraAllowed() && !s.hasApiKey ? `<div class="notice attention"><span class="dot warn"></span><span class="grow">Add your Presage API key to turn on live readings.</span><button class="btn" id="to-settings">Open Settings</button></div>` : ''}
        ${!navigator.onLine ? '<div class="notice"><span class="dot warn"></span><span class="grow">Offline: timers, recovery and history still work. Live readings return when you reconnect.</span></div>' : ''}
        <div class="entry">
          <section class="panel hero hero-check">
            <canvas class="hero-lines" id="check-lines" aria-hidden="true"></canvas>
            <div class="hero-body stack-24">
              <div class="stack-8"><span class="t-small">About 60 seconds · no session</span><h2 class="t-display">Check your signals</h2>
                <span class="t-body t-2">A quick look at your breathing, pulse and HRV, next to your own history.</span></div>
              <span class="t-small" id="last-check">${lastCheck ? `Last check-in ${esc(fmtDate(lastCheck.at))}: ${esc(checkSummary(lastCheck))}` : 'No check-ins yet'}</span>
              <div class="row"><button class="btn btn-accent btn-lg" id="h-check">${icon('activity', 18)}Start 60-second check-in</button></div>
            </div>
          </section>
          <section class="panel hero">
            <canvas class="hero-lines" id="home-lines" aria-hidden="true"></canvas>
            <div class="hero-body stack-24">
              <div class="stack-8"><span class="t-small">Next session · ${esc(presetMeta(preset))}</span><h2 class="t-display">${esc(preset.name)}</h2>
                <span class="t-body t-2">${cameraAllowed() && s.hasApiKey ? 'A short signal check runs first, then SOVA learns your baseline for 2 minutes.' : 'Runs as a plain timer with time-based eye-rest reminders.'}</span></div>
              <div style="max-width: 420px">${planBar(preset)}</div>
              <div class="row">
                <button class="btn btn-primary btn-lg" id="h-start">${icon('play', 18)}Start ${esc(preset.name)}</button>
                <button class="btn btn-quiet btn-lg" id="h-change">Change preset</button>
              </div>
            </div>
          </section>
        </div>
        <div class="split-r">
          <section class="panel stack">
            <div class="panel-head" style="margin-bottom: 0"><h2 class="t-section">What's going on?</h2><button class="btn btn-text" id="h-more">More in Recovery</button></div>
            <div class="sit-grid">${situationRows(true)}</div>
          </section>
          <section class="panel">
            <div class="panel-head"><h2 class="t-section">Today</h2><span class="t-meta">${today.length} session${today.length === 1 ? '' : 's'}</span></div>
            <div class="rows">
              <div class="row-item"><span class="row-title" style="font-weight: 400">Focus time</span><span class="row-aside t-figure" style="font-size: 22px">${esc(fmtMinutes(focusToday))}</span></div>
              <div class="row-item"><span class="row-title" style="font-weight: 400">Breathing resets</span><span class="row-aside t-figure" style="font-size: 22px">${resetsToday}</span></div>
              <div class="row-item"><span class="row-title" style="font-weight: 400">Eye rests</span><span class="row-aside t-figure" style="font-size: 22px">${eyesToday}</span></div>
              <div class="row-item"><span class="row-title" style="font-weight: 400">Check-ins</span><span class="row-aside t-figure" style="font-size: 22px">${checksToday}</span></div>
            </div>
          </section>
        </div>
        <section class="panel">
          <div class="panel-head"><h2 class="t-section">Last session</h2>${last ? `<span class="t-meta">${esc(fmtDate(last.startedAt))} · ${esc(last.presetName)} · ${esc(fmtMinutes(last.focusSeconds))}</span>` : ''}</div>
          ${last ? renderTimeline(last, { compact: true }) : empty('No sessions yet. Your first session timeline will appear here.')}
        </section>
      </div>`;
    const lines = new BreathLines($('#home-lines'), { lines: 30, reduced: true });
    const lines2 = new BreathLines($('#check-lines'), { lines: 30, reduced: true });
    const redraw = () => { lines.draw(); lines2.draw(); };
    redraw();
    window.addEventListener('resize', redraw);
    state.cleanup = () => window.removeEventListener('resize', redraw);
    $('#h-start').addEventListener('click', startSession);
    $('#h-check').addEventListener('click', startCheckIn);
    $('#h-change').addEventListener('click', () => go('focus'));
    $('#h-more').addEventListener('click', () => go('recovery'));
    bindSituations();
    const reply = (feeling) => {
      const r = FEELING_REPLY[feeling];
      const box = $('#feel-reply');
      if (!box) return;
      if (!r) { box.innerHTML = ''; return; }
      box.innerHTML = `<div class="notice"><span class="dot live"></span><span class="grow">${esc(r.text)}</span>${r.situation ? `<button class="btn" id="feel-go">${esc(r.action)}</button>` : ''}</div>`;
      const g = $('#feel-go'); if (g) g.addEventListener('click', () => startSituation(r.situation));
    };
    if (check) reply(check.feeling);
    $$('[data-feel]').forEach((b) => b.addEventListener('click', async () => {
      const feeling = b.dataset.feel;
      $$('[data-feel]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
      await saveSettings({ lastCheckIn: { feeling, at: new Date().toISOString() } });
      reply(feeling);
      announce(`Noted: ${feeling}`);
    }));
    const gc = $('#give-consent'); if (gc) gc.addEventListener('click', reviewConsent);
    const ts = $('#to-settings'); if (ts) ts.addEventListener('click', () => go('settings'));
  },

  focus() {
    const presets = state.config.presets;
    const sel = presetById(state.selectedPreset);
    const sens = state.config.sensitivity[state.settings.sensitivity || sel.sensitivity];
    const ready = cameraAllowed() && state.settings.hasApiKey;
    $('#view').innerHTML = `
      ${pageHead('Focus', 'Pick a preset. Each one sets its own timer, cue sensitivity and eye-rest rhythm.')}
      <div class="split">
        <section class="panel stack" aria-label="Session presets">
          ${presets.map((p) => `<button class="choice" data-preset="${esc(p.id)}" aria-pressed="${p.id === sel.id}">
            <span class="choice-name">${esc(p.name)}</span><span class="choice-meta">${esc(presetMeta(p))}</span>
            <span class="choice-aside">${p.blocks * p.focusMinutes} min</span></button>`).join('')}
        </section>
        <section class="panel stack-24">
          <div class="stack-8"><span class="t-small">Selected preset</span><h2 class="t-title">${esc(sel.name)}</h2></div>
          <div class="row" style="align-items: baseline; gap: 8px"><span class="t-display">${sel.blocks * sel.focusMinutes}</span><span class="t-body t-2">minutes of focus</span></div>
          ${planBar(sel)}
          <div class="legend"><span><span class="sw" style="background: var(--accent)"></span>Focus</span><span><span class="sw" style="background: var(--lavender)"></span>Break</span></div>
          <div class="rows">
            <div class="row-item"><span class="row-title" style="font-weight: 400">Focus blocks</span><span class="row-aside t-meta">${sel.blocks} × ${sel.focusMinutes} min</span></div>
            <div class="row-item"><span class="row-title" style="font-weight: 400">Breaks ${tip('tip-adapt', 'A little longer after a tense block, a little shorter after a calm one.')}</span><span class="row-aside t-meta">${sel.breakMinutes} min, adaptive</span></div>
            <div class="row-item"><span class="row-title" style="font-weight: 400">Cue sensitivity</span><span class="row-aside t-meta">${esc(sens ? sens.label : sel.sensitivity)}${state.settings.sensitivity ? ' (Settings)' : ''}</span></div>
            <div class="row-item"><span class="row-title" style="font-weight: 400">Eye-rest reminder</span><span class="row-aside t-meta">every ${sel.eyeRestEveryMinutes} min</span></div>
            <div class="row-item"><span class="row-title" style="font-weight: 400">Sound</span><span class="row-aside t-meta">${sel.sound && sel.sound !== 'none' ? `${esc(soundName(sel.sound))}${state.settings.autoSound ? '' : ' (auto-play off)'}` : 'Silent'}</span></div>
          </div>
          <div class="row">
            <button class="btn btn-primary btn-lg" id="f-start">${icon('play', 18)}Start ${esc(sel.name)} session</button>
            <span class="status t-small"><span class="dot ${ready ? 'live' : 'off'}"></span>${ready ? 'Signal check runs first' : 'Runs as a plain timer'}</span>
          </div>
        </section>
      </div>`;
    $$('[data-preset]').forEach((b) => b.addEventListener('click', () => {
      state.selectedPreset = b.dataset.preset;
      const y = window.scrollY;
      VIEWS.focus();
      window.scrollTo(0, y);
      const again = $(`[data-preset="${b.dataset.preset}"]`);
      if (again) again.focus();
    }));
    $('#f-start').addEventListener('click', startSession);
  },

  recovery() {
    const cfg = state.config;
    const s = state.settings;
    const cp = s.customPattern;
    const pattern = currentPattern();
    const dur = (d) => `${Math.floor(d / 60)}:${String(d % 60).padStart(2, '0')}`;
    const L = cfg.resetLengthSeconds;
    $('#view').innerHTML = `
      ${pageHead('Recovery', 'Guided breathing and eye rests. During a focus session, resets also show your own breath in teal.')}
      <div class="split-r" style="align-items: start">
        <div class="stack-24">
        <section class="panel stack-24">
          <div class="row-between" style="align-items: flex-end">
            <div class="stack-8"><span class="t-small">Preview</span><span class="t-title" id="rec-phase">Breathe in</span></div>
            <span class="t-meta" id="rec-pat">${esc(patternMeta(pattern))}</span>
          </div>
          <canvas class="reset-canvas" id="rec-lines" style="height: 260px" aria-hidden="true"></canvas>
          <div class="row-between">
            <div class="stepper" role="group" aria-label="Reset length">
              <span class="t-small">Duration</span>
              <span class="clock" id="dur-val" style="font-size: 32px; min-width: 96px; text-align: center" aria-live="polite">${dur(state.resetSeconds)}</span>
              <button class="btn btn-icon btn-lg round" id="dur-minus" aria-label="Shorter by 30 seconds">${icon('minus', 18)}</button>
              <button class="btn btn-icon btn-lg round" id="dur-plus" aria-label="Longer by 30 seconds">${icon('plus', 18)}</button>
            </div>
            <button class="btn btn-primary btn-lg" id="rec-go">${icon('play', 18)}Start reset</button>
          </div>
        </section>
        <section class="panel stack">
          <h2 class="t-section">What's going on?</h2>
          <div class="grid-2" style="gap: 8px">${situationRows()}</div>
        </section>
        </div>
        <div class="stack-24">
          <section class="panel stack">
            <h2 class="t-section">Pattern</h2>
            <div class="stack-8" role="radiogroup" aria-label="Breathing pattern">
              ${cfg.breathingPatterns.map((p) => `<button class="choice" role="radio" aria-checked="${s.breathingPatternId === p.id}" data-pat="${esc(p.id)}"><span class="choice-name">${esc(p.name)}</span><span class="choice-meta">${p.note ? `${esc(p.note)} · ` : ''}${esc(patternMeta(p))}</span></button>`).join('')}
              <button class="choice" role="radio" aria-checked="${s.breathingPatternId === 'custom'}" data-pat="custom"><span class="choice-name">Custom</span><span class="choice-meta">Your own timings</span></button>
            </div>
            <div class="stack-8" id="custom-row" ${s.breathingPatternId === 'custom' ? '' : 'hidden'}>
              <div class="grid-4" style="gap: 8px">
                ${['inhale', 'hold', 'exhale', 'holdAfterExhale'].map((k) => `<label class="stack-8"><span class="t-small">${{ inhale: 'Inhale', hold: 'Hold', exhale: 'Exhale', holdAfterExhale: 'Hold after' }[k]}</span>
                  <input type="number" min="0" max="12" step="1" value="${cp[k] || 0}" data-cp="${k}" style="width: 100%"></label>`).join('')}
              </div>
              <span class="t-meta" id="cp-rate">${esc((Math.round(breathsPerMinute(cp) * 10) / 10).toString())} breaths/min</span>
            </div>
          </section>
          <section class="panel">
            ${switchRow({ id: 'rec-sound', label: 'Sound guide', help: 'Rising and falling tones so you can breathe with your eyes closed', checked: s.soundGuide })}
            ${switchRow({ id: 'rec-mic', label: 'Breath sound analysis', help: 'Times each audible breath with the microphone and reports your exhale length. Never recorded.', checked: s.micBreath })}
          </section>
          <section class="panel row-between">
            <div class="stack-8"><h2 class="t-section">Eye rest</h2><span class="t-small">20-second look-away with a soft chime at the end</span></div>
            <button class="btn" id="e-go">${icon('eye', 16)}Start eye rest</button>
          </section>
        </div>
      </div>`;

    // Lavender preview of the chosen pattern; still in reduced motion.
    const lines = new BreathLines($('#rec-lines'), { lines: 28, reduced: reducedMotion() });
    lines.start();
    const t0 = performance.now();
    let lastPhase = null;
    const tick = () => {
      const p = currentPattern();
      if (reducedMotion()) { lines.setGuide(0.6); $('#rec-phase').textContent = 'Preview'; return; }
      const g = guideAt(p, (performance.now() - t0) / 1000);
      lines.setGuide(g.scale);
      if (g.phase !== lastPhase) { lastPhase = g.phase; $('#rec-phase').textContent = PHASE_TEXT[g.phase]; }
    };
    tick();
    const timer = setInterval(tick, 50);
    state.cleanup = () => { clearInterval(timer); lines.stop(); };

    const setDur = (v) => {
      state.resetSeconds = Math.max(L.min, Math.min(L.max, v));
      $('#dur-val').textContent = dur(state.resetSeconds);
      $('#dur-minus').disabled = state.resetSeconds <= L.min;
      $('#dur-plus').disabled = state.resetSeconds >= L.max;
    };
    setDur(state.resetSeconds);
    $('#dur-minus').addEventListener('click', () => setDur(state.resetSeconds - L.step));
    $('#dur-plus').addEventListener('click', () => setDur(state.resetSeconds + L.step));
    bindSituations();
    $$('[data-pat]').forEach((b) => b.addEventListener('click', async () => {
      await saveSettings({ breathingPatternId: b.dataset.pat });
      $$('[data-pat]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
      $('#custom-row').hidden = b.dataset.pat !== 'custom';
      $('#rec-pat').textContent = patternMeta(currentPattern());
    }));
    $$('[data-cp]').forEach((inp) => inp.addEventListener('change', async () => {
      const next = { ...state.settings.customPattern, [inp.dataset.cp]: Number(inp.value) };
      if (!validatePattern(next)) { toast({ title: 'That pattern is outside the safe range', body: 'Inhale 2 to 10 s, exhale 2 to 12 s, holds up to 10 s.', actions: [{ label: 'OK' }] }); inp.value = state.settings.customPattern[inp.dataset.cp] || 0; return; }
      await saveSettings({ customPattern: next });
      $('#cp-rate').textContent = `${Math.round(breathsPerMinute(next) * 10) / 10} breaths/min`;
      $('#rec-pat').textContent = patternMeta(currentPattern());
    }));
    $('#rec-sound').addEventListener('change', (e) => saveSettings({ soundGuide: e.target.checked }));
    $('#rec-mic').addEventListener('change', (e) => {
      if (e.target.checked) { e.target.checked = false; askMicConsent(() => { const m = $('#rec-mic'); if (m) m.checked = true; }); }
      else saveSettings({ micBreath: false });
    });
    $('#rec-go').addEventListener('click', () => quickReset());
    $('#e-go').addEventListener('click', eyeRest);
  },

  async insights() {
    const [sessions, standalone] = await Promise.all([window.sova.listSessions(), window.sova.listResets()]);
    if (state.view !== 'insights') return;
    const w = weekly(sessions);
    const ba = beforeAfter(sessions);
    const pat = patterns(sessions);
    const trend = exhaleTrend(allResets(sessions, standalone).filter((r) => r.seconds >= 10));
    const maxDay = Math.max(1, ...w.days.map((d) => d.focusMinutes));
    const pick = (state.insightSession && sessions.find((s) => s.id === state.insightSession)) || sessions[0];
    const SIG = { breathing: ['Breathing', 'breaths/min'], pulse: ['Pulse', 'bpm'], hrv: ['HRV', 'ms'] };
    const lastTrend = trend[trend.length - 1];
    $('#view').innerHTML = `
      ${pageHead('Insights', 'Built only from sessions stored on this computer. Nothing here is estimated.')}
      <div class="stack-24">
        <div class="grid-4">
          ${stat('Focus this week', esc(fmtMinutes(w.focusMinutes * 60)), `${w.blocksFinished} blocks finished`)}
          ${stat('Sessions', w.sessions, 'last 7 days')}
          ${stat('Breaks taken', `${w.breaksTaken}${w.breaksStarted ? ` <span class="t-2" style="font-size: 15px">of ${w.breaksStarted}</span>` : ''}`, 'not skipped')}
          ${stat('Recovery', `${w.resets} <span class="t-2" style="font-size: 15px">resets</span>`, `${w.eyeRests} eye rests`)}
        </div>
        <div class="split-r">
          <section class="panel">
            <div class="panel-head"><h2 class="t-section">Focus minutes, last 7 days</h2><span class="t-meta">No streaks. Rest days count too</span></div>
            <div class="bars" style="grid-template-columns: repeat(7, minmax(0, 1fr))" role="img" aria-label="Focus minutes per day this week: ${w.days.map((d) => `${d.label} ${d.focusMinutes}`).join(', ')}">
              ${w.days.map((d) => `<div class="bar-col"><span class="axis">${d.focusMinutes || ''}</span><div class="bar${d.focusMinutes ? ' on' : ''}" style="height: ${Math.round((d.focusMinutes / maxDay) * 130)}px"></div><span class="axis">${esc(d.label)}</span></div>`).join('')}
            </div>
          </section>
          <section class="panel">
            <div class="panel-head"><h2 class="t-section">Before and after resets</h2>${tip('tip-ba', 'Average of resets where the signal was reliable just before the reset and 60 seconds after it.')}</div>
            <div class="rows">
              ${Object.entries(ba).map(([k, r]) => `<div class="row-item"><span class="row-title" style="font-weight: 400">${SIG[k][0]}</span>
                ${r.enough
                  ? `<span class="row-sub"><span class="num t-num">${r.before.toFixed(1)} → ${r.after.toFixed(1)}</span> ${SIG[k][1]} · lower in ${r.lowerAfter} of ${r.n}</span>`
                  : `<span class="row-sub">Not enough reliable resets yet (${r.n} of ${r.need})</span>`}</div>`).join('')}
            </div>
          </section>
        </div>
        <section class="panel">
          <div class="panel-head"><h2 class="t-section">Timeline replay</h2>
            ${sessions.length ? `<label class="row t-small">Session <select id="tl-pick">${sessions.slice(0, 30).map((s) => `<option value="${esc(s.id)}" ${pick && s.id === pick.id ? 'selected' : ''}>${esc(fmtDate(s.startedAt))} · ${esc(s.presetName)} · ${esc(fmtMinutes(s.focusSeconds))}</option>`).join('')}</select></label>` : ''}</div>
          ${sessions.length ? `<div id="tl">${renderTimeline(pick)}</div>` : empty('No sessions yet. Your first session will appear here.')}
        </section>
        <div class="grid-2">
          <section class="panel">
            <div class="panel-head"><h2 class="t-section">Exhale length</h2><span class="t-meta">from breath sounds</span></div>
            ${trend.length ? `<div class="row" style="align-items: baseline; gap: 8px"><span class="t-display">${lastTrend.avgExhale}</span><span class="t-body t-2">s average exhale, last reset · target ${lastTrend.target} s</span></div>
              <p class="t-small" style="margin-top: 12px">${trend.length} reset${trend.length === 1 ? '' : 's'} with enough heard exhales. The full chart is in History, Breathing.</p>`
              : empty('Turn on breath sound analysis in Recovery. After a reset where the microphone hears at least 3 exhales, your exhale length shows here.')}
          </section>
          <section class="panel">
            <div class="panel-head"><h2 class="t-section">Personal patterns</h2></div>
            ${!pat.enough ? `<div class="stack"><p class="t-body t-2">SOVA needs ${pat.need} sessions with live readings before it looks for patterns.</p>
                <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="${pat.need}" aria-valuenow="${pat.have}"><div style="width: ${Math.round((pat.have / pat.need) * 100)}%"></div></div>
                <span class="t-meta">${pat.have} of ${pat.need} sessions recorded</span></div>`
              : pat.observations.length ? `<div>${pat.observations.map((o) => `<div class="obs">${icon('circle-dot', 16)}<span class="t-body">${esc(o.text)}</span></div>`).join('')}</div>
                <p class="t-small" style="margin-top: 12px">Observations from your own sessions, not advice or a diagnosis.</p>`
              : empty('No clear patterns yet. SOVA only reports one when your sessions show it consistently.')}
          </section>
        </div>
        <section class="panel">
          <div class="panel-head"><h2 class="t-section">How you started</h2><span class="t-meta">from your Home check-ins</span></div>
          ${feelingRows(sessions)}
        </section>
      </div>`;
    const tp = $('#tl-pick');
    if (tp) tp.addEventListener('change', () => {
      state.insightSession = tp.value;
      $('#tl').innerHTML = renderTimeline(sessions.find((s) => s.id === tp.value));
    });
  },

  async history() {
    const [sessions, standalone] = await Promise.all([window.sova.listSessions(), window.sova.listResets()]);
    if (state.view !== 'history') return;
    const tab = state.historyTab || 'sessions';
    const w = weekly(sessions);
    const tabs = `<div class="seg" role="tablist" aria-label="History">
        <button role="tab" aria-selected="${tab === 'sessions'}" data-htab="sessions">Sessions</button>
        <button role="tab" aria-selected="${tab === 'breathing'}" data-htab="breathing">Breathing</button>
        <button role="tab" aria-selected="${tab === 'checkins'}" data-htab="checkins">Check-ins</button>
      </div>`;
    if (tab === 'checkins') {
      const checkIns = await window.sova.listCheckIns();
      if (state.view !== 'history') return;
      $('#view').innerHTML = `
        ${pageHead('History', 'Your 60-second signal check-ins, stored only on this computer.', tabs)}
        <section class="panel">
          <div class="panel-head"><h2 class="t-section">All check-ins</h2><span class="t-meta">${checkIns.length}</span></div>
          ${checkIns.length ? `<div class="rows">${checkIns.map((c) => `
            <button class="row-item" data-cid="${esc(c.id)}">
              <span class="row-title">${esc(checkSummary(c))}</span>
              <span class="row-sub">${esc(fmtDate(c.at))}${c.feeling ? ` · felt ${esc(c.feeling.toLowerCase())}` : ''}${c.faceInViewPct != null ? ` · face in view ${c.faceInViewPct}%` : ''}</span>
              <span class="row-aside">${icon('chevron-right', 16)}</span>
            </button>`).join('')}</div>` : empty('No check-ins yet. Start one from Home: it takes about a minute.', '<div><button class="btn" id="to-home">Open Home</button></div>')}
        </section>`;
      $$('[data-cid]').forEach((b) => b.addEventListener('click', () => {
        const c = checkIns.find((x) => x.id === b.dataset.cid);
        if (c) showCheckInResults(c, true);
      }));
      const th = $('#to-home'); if (th) th.addEventListener('click', () => go('home'));
    } else if (tab === 'breathing') {
      const resets = allResets(sessions, standalone).filter((r) => r.seconds >= 10);
      const trend = exhaleTrend(resets);
      const maxV = Math.max(1, ...trend.map((t) => Math.max(t.avgExhale, t.target)));
      const H = 140;
      const patternName = (id) => (state.config.breathingPatterns.find((p) => p.id === id) || { name: id === 'custom' ? 'Custom' : (id || 'Breathing reset') }).name;
      $('#view').innerHTML = `
        ${pageHead('History', 'Every breathing reset, from Recovery and from focus sessions, stored only on this computer.', tabs)}
        <div class="stack-24">
          <section class="panel">
            <div class="panel-head"><h2 class="t-section">Exhale length over time</h2>
              <div class="legend"><span><span class="sw" style="background: var(--accent)"></span>Average exhale (s)</span><span><span class="sw" style="background: var(--lavender); height: 2px"></span>Target</span></div></div>
            ${trend.length >= 2 ? `
            <div class="bars" style="grid-template-columns: repeat(${trend.length}, minmax(0, 56px)); height: ${H + 48}px" role="img" aria-label="Average exhale length per reset compared with the target: ${trend.map((t) => `${t.avgExhale} of ${t.target} seconds`).join(', ')}">
              ${trend.map((t) => `<div class="bar-col" style="position: relative">
                <span class="axis">${t.avgExhale}</span>
                <div class="bar on" style="height: ${Math.round((t.avgExhale / maxV) * H)}px"></div>
                <div class="target-line" style="bottom: ${Math.round((t.target / maxV) * H) + 24}px"></div>
                <span class="axis">${esc(new Date(t.at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }))}</span></div>`).join('')}
            </div>`
            : empty(`The chart appears after 2 resets where the microphone heard at least 3 exhales. You have ${trend.length}.`)}
          </section>
          <section class="panel">
            <div class="panel-head"><h2 class="t-section">All resets</h2><span class="t-meta">${resets.length}</span></div>
            ${resets.length ? `<ul class="rows list">${resets.map((r) => `
              <li class="row-item">
                <span class="row-title">${esc(patternName(r.patternId))} · ${r.seconds < 60 ? `${r.seconds} s` : `${Math.round(r.seconds / 6) / 10} min`}${r.completed ? '' : ' · ended early'}</span>
                <span class="row-sub">${r.breathSound ? r.breathSound.lines.map(esc).join(' ') : 'Microphone analysis was off for this reset.'}${r.before && r.after && r.before.breathing != null && r.after.breathing != null ? ` Breathing from the camera: ${Math.round(r.before.breathing)} → ${Math.round(r.after.breathing)} breaths/min, 60 seconds after.` : ''}</span>
                <span class="row-aside stack-8" style="align-items: flex-end; gap: 2px"><span class="t-meta">${esc(fmtDate(r.at))}</span><span class="t-meta">${r.source === 'recovery' ? 'Recovery' : `During ${esc(r.sessionName)}`}</span></span>
              </li>`).join('')}</ul>` : empty('No breathing resets yet. Start one from Recovery.', '<div><button class="btn" id="to-rec">Open Recovery</button></div>')}
          </section>
        </div>`;
      const tr = $('#to-rec'); if (tr) tr.addEventListener('click', () => go('recovery'));
    } else {
      $('#view').innerHTML = `
        ${pageHead('History', 'Your sessions, stored only on this computer.', tabs)}
        <div class="stack-24">
          <div class="grid-4">
            ${stat('Sessions this week', w.sessions)}
            ${stat('Focus blocks finished', w.blocksFinished)}
            ${stat('Breaks taken', `${w.breaksTaken}${w.breaksStarted ? ` <span class="t-2" style="font-size: 15px">of ${w.breaksStarted}</span>` : ''}`)}
            ${stat('Eye rests', w.eyeRests, `${w.resets} resets in sessions`)}
          </div>
          <section class="panel">
            <div class="panel-head"><h2 class="t-section">All sessions</h2><span class="t-meta">${sessions.length}</span></div>
            ${sessions.length ? `<div class="rows">${sessions.map((s) => `
              <button class="row-item" data-sid="${esc(s.id)}">
                <span class="row-title">${esc(s.presetName)}${s.mode === 'timer' ? ' <span class="t-meta">timer only</span>' : ''}</span>
                <span class="row-sub">${esc(fmtDate(s.startedAt))}${s.checkIn ? ` · started ${esc(s.checkIn.feeling.toLowerCase())}` : ''}${s.reflection && s.reflection.tags && s.reflection.tags.length ? ` · ${esc(s.reflection.tags.join(', '))}` : ''}${s.reflection && s.reflection.note ? ` · ${esc(s.reflection.note)}` : ''}</span>
                <span class="row-aside"><span class="t-num">${esc(fmtMinutes(s.focusSeconds))}</span> ${icon('chevron-right', 16)}</span>
              </button>`).join('')}</div>` : empty('No sessions yet. Start one from Focus.', '<div><button class="btn" id="to-focus">Open Focus</button></div>')}
          </section>
        </div>`;
      $$('[data-sid]').forEach((b) => b.addEventListener('click', () => {
        const x = sessions.find((y) => y.id === b.dataset.sid);
        if (x) showSummary(x);
      }));
      const tf = $('#to-focus'); if (tf) tf.addEventListener('click', () => go('focus'));
    }
    $$('[data-htab]').forEach((b) => b.addEventListener('click', () => { state.historyTab = b.dataset.htab; VIEWS.history(); }));
  },

  sounds() {
    const s = state.settings;
    const playing = audio.ambient.current;
    const presetSounds = state.config.presets.filter((p) => p.sound && p.sound !== 'none')
      .map((p) => `${p.name}: ${soundName(p.sound)}`).join(' · ');
    $('#view').innerHTML = `
      ${pageHead('Sounds', 'Ambient sound for focus, generated on this computer, so it works offline.')}
      <div class="split-r">
        <section class="panel stack-24">
          <div class="stack-8" role="radiogroup" aria-label="Ambient sound">
            ${SOUNDS.map(([id, name, ic, desc]) => `<button class="choice" role="radio" aria-checked="${s.soundId === id}" data-snd="${id}">
              <span class="choice-name">${icon(ic, 16)} ${name}</span><span class="choice-meta">${desc}</span>
              <span class="choice-aside">${playing === id ? '<span class="status"><span class="dot live"></span>Playing</span>' : ''}</span></button>`).join('')}
          </div>
          <label class="stack-8"><span class="row-between"><span class="t-small">Volume</span><span class="t-meta" id="vol-n">${Math.round(s.soundVolume * 100)}</span></span>
            <input type="range" id="vol" min="0" max="1" step="0.05" value="${s.soundVolume}"></label>
          <div class="row">
            <button class="btn btn-primary btn-lg" id="play">${playing ? `${icon('square', 16)}Stop` : `${icon('play', 18)}Play`}</button>
            <span class="t-small" id="now">${playing ? `Playing ${esc(soundName(playing))}` : ''}</span>
          </div>
        </section>
        <section class="panel">
          ${switchRow({ id: 'auto', label: "Play each preset's sound when a session starts", help: `${presetSounds}. Other presets stay silent.`, checked: s.autoSound })}
          ${switchRow({ id: 'breaks', label: 'Keep playing during breaks', help: 'Off: the sound stops when a break starts and returns with the next focus block.', checked: s.soundDuringBreaks !== false })}
        </section>
      </div>`;
    $$('[data-snd]').forEach((b) => b.addEventListener('click', async () => {
      await saveSettings({ soundId: b.dataset.snd });
      if (audio.ambient.current) audio.ambient.start(b.dataset.snd, state.settings.soundVolume);
      VIEWS.sounds();
    }));
    $('#vol').addEventListener('input', (e) => { audio.ambient.setVolume(Number(e.target.value)); $('#vol-n').textContent = Math.round(Number(e.target.value) * 100); });
    $('#vol').addEventListener('change', (e) => saveSettings({ soundVolume: Number(e.target.value) }));
    $('#play').addEventListener('click', () => {
      if (audio.ambient.current) audio.ambient.stop();
      else audio.ambient.start(state.settings.soundId, state.settings.soundVolume);
      VIEWS.sounds();
    });
    $('#auto').addEventListener('change', (e) => saveSettings({ autoSound: e.target.checked }));
    $('#breaks').addEventListener('change', (e) => saveSettings({ soundDuringBreaks: e.target.checked }));
  },

  async settings() {
    const s = state.settings;
    const [sum, cameras] = await Promise.all([window.sova.dataSummary(), window.sova.native.cameras().catch(() => [])]);
    if (state.view !== 'settings') return;
    const config = state.config;
    const ov = cleanOverrides(s.cueOverrides);
    const SECTIONS = [['set-profile', 'Profile'], ['set-look', 'Appearance'], ['set-key', 'API key'], ['set-camera', 'Camera'], ['set-cues', 'Cues'], ['set-presets', 'Focus presets'], ['set-access', 'Accessibility'], ['set-privacy', 'Privacy'], ['set-data', 'Your data']];
    const field = (label, control, help = '') => `<div class="setting"><div class="setting-text"><span class="setting-label">${label}</span>${help ? `<span class="setting-help">${help}</span>` : ''}</div>${control}</div>`;
    const prow = (label, value, good) => `<div class="row-item"><span class="row-title" style="font-weight: 400">${label}</span><span class="row-aside t-small" style="color: ${good ? 'var(--accent)' : 'var(--text-2)'}">${value}</span></div>`;
    $('#view').innerHTML = `
      ${pageHead('Settings', 'Everything here is stored on this computer.')}
      <div class="settings">
        <nav class="settings-nav" aria-label="Settings sections">${SECTIONS.map(([id, l]) => `<a href="#${id}" data-jump="${id}">${l}</a>`).join('')}</nav>
        <div class="stack-24">
          <section class="panel" id="set-profile">
            <div class="panel-head"><h2 class="t-section">Profile</h2><span class="t-meta">on this computer only</span></div>
            ${field('Your name', `<input type="text" id="pf-name" maxlength="40" value="${esc(s.profileName || '')}" placeholder="Your first name" aria-label="Your name" style="width: 220px">`, 'Used only to greet you on Home')}
            ${field('Your goals', `<button class="btn btn-quiet" id="pf-goals">Change goals</button>`, (s.goals || []).length ? esc(config.goals.filter((g) => s.goals.includes(g.id)).map((g) => g.name).join(', ')) : 'None chosen')}
          </section>

          <section class="panel" id="set-look">
            <div class="panel-head"><h2 class="t-section">Appearance</h2></div>
            ${field('Mode', `<div class="seg" role="radiogroup" aria-label="Appearance">${[['system', 'Follow Windows'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) => `<button role="radio" aria-checked="${(s.appearance || 'system') === v}" data-appear="${v}">${l}</button>`).join('')}</div>`, 'Follow Windows switches with your system setting')}
          </section>

          <section class="panel" id="set-key">
            <div class="panel-head"><h2 class="t-section">Presage API key</h2><span class="status t-small"><span class="dot ${s.hasApiKey ? 'live' : 'off'}"></span>${s.hasApiKey ? 'Saved' : 'Not set'}</span></div>
            ${s.apiKeyFromEnv ? '<p class="t-small">Using the key from the SOVA_PRESAGE_API_KEY environment variable.</p>' : `
            <p class="t-small" style="margin-bottom: 16px">Get a free key from the <a href="${KEY_PORTAL}" target="_blank" rel="noreferrer">Presage developer portal</a>. It is encrypted with your operating system's secure storage and never leaves this computer except to sign in to Presage.</p>
            <div class="row"><input type="password" id="key" placeholder="${s.hasApiKey ? 'Key saved. Paste a new one to replace it' : 'Paste your API key'}" style="flex: 1; min-width: 240px" aria-label="Presage API key">
              <button class="btn btn-primary" id="key-save">Save key</button>${s.hasApiKey ? '<button class="btn btn-quiet" id="key-clear">Remove key</button>' : ''}</div>`}
          </section>

          <section class="panel" id="set-camera">
            <div class="panel-head"><h2 class="t-section">Camera</h2></div>
            ${field('Camera', `<select id="cam" aria-label="Camera"><option value="">System default</option>${cameras.map((c) => `<option value="${esc(c.id)}" ${s.cameraId === c.id ? 'selected' : ''}>${esc(c.name || c.id)}</option>`).join('')}</select>`)}
            ${field('Capture mode', `<select id="capture" aria-label="Capture mode">
                <option value="native" ${s.captureMode !== 'renderer' ? 'selected' : ''}>Direct (recommended)</option>
                <option value="renderer" ${s.captureMode === 'renderer' ? 'selected' : ''}>Through the window</option></select>`, 'Direct gives a steadier frame rate. If the signal check says the camera is too slow, add light in front of you and keep Direct.')}
            ${switchRow({ id: 'widget', label: 'Floating focus widget', help: 'A small always-on-top timer with pause and reset during sessions', checked: s.showWidget !== false })}
          </section>

          <section class="panel" id="set-cues">
            <div class="panel-head"><h2 class="t-section">Cues</h2></div>
            ${field('Cue sensitivity', `<select id="sens" aria-label="Cue sensitivity"><option value="">Use each preset's setting</option>${Object.entries(config.sensitivity).map(([k, v]) => `<option value="${k}" ${s.sensitivity === k ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</select>`, 'How large and lasting a change from your baseline must be before SOVA suggests a reset')}
            ${switchRow({ id: 'qh-on', label: 'Quiet hours', help: 'No cues during these hours. Timers still run.', checked: s.quietHours.enabled })}
            <div class="row" style="padding: 0 0 12px"><label class="row t-small">From <input type="time" id="qh-start" value="${esc(s.quietHours.start)}"></label>
              <label class="row t-small">To <input type="time" id="qh-end" value="${esc(s.quietHours.end)}"></label></div>
            <details ${Object.values(s.cueOverrides || {}).some((v) => v !== null && v !== true) ? 'open' : ''}>
              <summary class="t-body">Fine-tune cues</summary>
              <div style="padding-top: 8px">
              ${[
                ['breathingRisePct', 'Breathing rise before a cue', '%', config.cues.tension.breathingRisePct],
                ['pulseRiseBpm', 'Pulse rise before a cue', 'bpm', config.cues.tension.pulseRiseBpm],
                ['hrvDropPct', 'HRV drop before a cue', '%', config.cues.tension.hrvDropPct],
                ['windowMinutes', 'How long the change must last', 'min', config.cues.tension.windowSeconds / 60],
                ['cooldownMinutes', 'Minimum time between cues', 'min', config.cues.cooldownMinutes],
                ['eyeRestEveryMinutes', 'Eye-rest reminder every', 'min', null],
              ].map(([k, label, unit, def]) => field(label, `<span class="row" style="gap: 8px"><input type="number" data-ov="${k}" min="${LIMITS[k][0]}" max="${LIMITS[k][1]}" value="${ov[k] ?? ''}" placeholder="${def ?? 'auto'}" aria-label="${label}"><span class="t-meta" style="width: 28px">${unit}</span></span>`)).join('')}
              ${[['tensionCues', 'Tension cues', 'Suggest a reset when breathing or pulse stays above your baseline'], ['eyeRestCues', 'Eye-rest reminders', 'From your blink rate, or by time when there is no blink baseline'], ['autoMeetingSnooze', 'Automatic meeting snooze', 'Hold cues while SOVA detects you talking']]
                .map(([k, l, h]) => `<div class="setting"><div class="setting-text"><label class="setting-label" for="ovb-${k}">${l}</label><span class="setting-help">${h}</span></div><span class="switch"><input type="checkbox" role="switch" id="ovb-${k}" data-ovb="${k}" ${ov[k] ? 'checked' : ''}><span></span></span></div>`).join('')}
              <div class="row" style="padding-top: 12px"><button class="btn" id="ov-reset">${icon('rotate-ccw', 16)}Reset to defaults</button><span class="t-small">Empty fields use SOVA's defaults. Values outside the safe range are adjusted.</span></div>
              </div>
            </details>
          </section>

          <section class="panel" id="set-presets">
            <div class="panel-head"><h2 class="t-section">Focus presets</h2></div>
            ${field('Default preset', `<select id="def-preset" aria-label="Default preset">${config.presets.map((p) => `<option value="${esc(p.id)}" ${s.presetId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>`, 'Shown first on Home and Focus')}
            <div class="rows">${config.presets.map((p) => `<div class="row-item"><span class="row-title">${esc(p.name)}</span><span class="row-sub">${esc(presetMeta(p))} · cues ${esc(config.sensitivity[p.sensitivity].label.toLowerCase())} · eye rest every ${p.eyeRestEveryMinutes} min</span><span class="row-aside" style="width: 160px">${planBar(p)}</span></div>`).join('')}</div>
            <div class="row" style="padding-top: 12px"><span class="t-small grow">Breathing patterns, including your custom pattern, are set in Recovery.</span><button class="btn btn-quiet" id="to-recovery">Open Recovery</button></div>
          </section>

          <section class="panel" id="set-access">
            <div class="panel-head"><h2 class="t-section">Accessibility</h2></div>
            ${switchRow({ id: 'rm', label: 'Reduced motion', help: 'Breath lines and the guide stay still or change in calm steps. Phase changes are announced to screen readers.', checked: s.reducedMotion })}
            ${switchRow({ id: 'sg', label: 'Sound guide for breathing resets', help: 'Tones for each phase, for eyes-closed breathing', checked: s.soundGuide })}
            ${field('Keyboard', `<span class="row" style="gap: 4px"><span class="keycap">${state.mod}</span><span class="keycap">Shift</span><span class="keycap">B</span></span>`, 'Starts a quick breathing reset from anywhere, even when SOVA is in the background. Escape ends a reset.')}
          </section>

          <section class="panel" id="set-privacy">
            <div class="panel-head"><h2 class="t-section">Privacy</h2><a class="t-small" href="${PRIVACY_POLICY}" target="_blank" rel="noreferrer">Presage privacy policy ${icon('external-link', 14)}</a></div>
            <div class="rows" style="margin-bottom: 8px">
              ${prow('Camera video and photos', 'Never recorded or saved', true)}
              ${prow('Your name, goals and feeling check-ins', 'Stored only here, no account', true)}
              ${prow('Signal check-in results', 'Summary values only, stored here', true)}
              ${prow('Microphone audio', s.micBreath ? 'Loudness only, never recorded' : 'Off', true)}
              ${prow('Camera consent', cameraAllowed() ? `Given · version ${s.consentVersion}` : 'Not given, timer only', cameraAllowed())}
              ${prow('Sent to Presage during sessions', `Sign-in and vitals for automatic AI check-ins${s.telemetry ? ', anonymous diagnostics' : ''}`, false)}
              ${prow('AI reflections', s.aiReflections ? 'On, when you ask and at session end' : 'Off', false)}
            </div>
            ${switchRow({ id: 'mic', label: 'Breath sound analysis with the microphone', help: 'Resets only. SOVA keeps a loudness number every 20 ms to time your breaths.', checked: s.micBreath })}
            ${switchRow({ id: 'ai', label: 'AI reflections from Presage', help: 'Check-ins on request and an end-of-session reflection, written by a large language model from your session summary and vitals', checked: s.aiReflections })}
            ${switchRow({ id: 'telemetry', label: 'Anonymous SDK diagnostics', help: 'One summary per session: SDK version, device model, frame-rate and quality counts. Never video, readings or identifiers.', checked: s.telemetry })}
            <div class="row" style="padding-top: 12px"><button class="btn btn-quiet" id="consent">Review camera consent</button></div>
          </section>

          <section class="panel" id="set-data">
            <div class="panel-head"><h2 class="t-section">Your data</h2><span class="t-meta">on this computer</span></div>
            <div class="grid-4" style="margin-bottom: 16px">
              ${stat('Sessions', sum.sessions)}
              ${stat('Recovery resets', sum.resets)}
              ${stat('Reflections', sum.reflections)}
              ${stat('Check-ins', sum.checkIns || 0)}
            </div>
            <div class="row"><button class="btn" id="exp-csv">${icon('download', 16)}Export CSV</button><button class="btn" id="exp-json">${icon('download', 16)}Export JSON</button><span class="grow"></span><button class="btn btn-quiet btn-danger" id="del">${icon('trash-2', 16)}Delete all data</button></div>
          </section>
        </div>
      </div>`;

    $$('[data-jump]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); const el = $(`#${a.dataset.jump}`); if (el) el.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' }); }));
    const keySave = $('#key-save');
    if (keySave) keySave.addEventListener('click', async () => {
      const r = await window.sova.setApiKey($('#key').value);
      if (r.ok) { toast({ title: 'API key saved' }); state.settings = await window.sova.getSettings(); VIEWS.settings(); }
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
    $('#def-preset').addEventListener('change', async (e) => { await saveSettings({ presetId: e.target.value }); state.selectedPreset = e.target.value; });
    $('#to-recovery').addEventListener('click', () => go('recovery'));
    $('#pf-name').addEventListener('change', (e) => saveSettings({ profileName: e.target.value }));
    $('#pf-goals').addEventListener('click', () => startOnboarding({ profileOnly: true }));
    $$('[data-appear]').forEach((b) => b.addEventListener('click', async () => {
      await saveSettings({ appearance: b.dataset.appear });
      $$('[data-appear]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
    }));
    const qh = () => saveSettings({ quietHours: { enabled: $('#qh-on').checked, start: $('#qh-start').value || '21:00', end: $('#qh-end').value || '08:00' } });
    ['#qh-on', '#qh-start', '#qh-end'].forEach((id) => $(id).addEventListener('change', qh));
    $('#mic').addEventListener('change', (e) => {
      if (e.target.checked) { e.target.checked = false; askMicConsent(() => VIEWS.settings()); }
      else saveSettings({ micBreath: false }).then(() => VIEWS.settings());
    });
    $('#ai').addEventListener('change', (e) => {
      if (!e.target.checked) { saveSettings({ aiReflections: false }).then(() => VIEWS.settings()); return; }
      e.target.checked = false;
      toast({
        title: 'Turn on AI reflections?',
        body: "When you press AI check-in, and at the end of a session, SOVA sends a short prompt with your session summary (preset, focus minutes, counts of cues, resets and eye rests, your baseline, breathing around your last reset, breath-sound results and the feeling you chose on Home) to Presage, together with the pulse, HRV and breathing values the SDK has buffered. Presage forwards it to a large language model. Never video. The reply is saved with the session on this computer. AI can be wrong and is not medical advice.",
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
      body: 'This removes every session, signal check-in, breathing reset, reflection, note, AI reflection, setting and your saved API key from this computer. It cannot be undone.',
      actions: [
        { label: 'Delete everything', primary: true, onClick: async () => { await window.sova.deleteAll(); state.settings = await window.sova.getSettings(); announce('All data deleted'); state.timerOnly = false; state.selectedPreset = state.settings.presetId; startOnboarding(); } },
        { label: 'Cancel' },
      ],
    }));
    $('#consent').addEventListener('click', reviewConsent);
  },
};

boot().catch((e) => {
  console.error('[SOVA] boot failed', e);
  document.body.innerHTML = `<p style="padding: 40px; color: #f0eee9">SOVA could not start: ${esc(e.message)}</p>`;
});
