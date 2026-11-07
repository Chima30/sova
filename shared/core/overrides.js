'use strict';

// Personal sensitivity settings: the user's own cue thresholds, detection
// window, reminder frequency and per-cue switches, applied on top of the
// shared config. Every value is clamped to a safe range.

const LIMITS = {
  breathingRisePct: [10, 60],
  pulseRiseBpm: [4, 25],
  hrvDropPct: [10, 50],
  windowMinutes: [1, 10],
  cooldownMinutes: [5, 60],
  eyeRestEveryMinutes: [10, 60],
};

const DEFAULT_OVERRIDES = {
  breathingRisePct: null,
  pulseRiseBpm: null,
  hrvDropPct: null,
  windowMinutes: null,
  cooldownMinutes: null,
  eyeRestEveryMinutes: null,   // null = use the preset's rhythm
  tensionCues: true,
  eyeRestCues: true,
  autoMeetingSnooze: true,
};

function clamp(key, v) {
  const n = Number(v);
  if (v == null || v === '' || !Number.isFinite(n)) return null;
  const [lo, hi] = LIMITS[key];
  return Math.min(hi, Math.max(lo, n));
}

function cleanOverrides(raw) {
  const o = { ...DEFAULT_OVERRIDES };
  for (const k of Object.keys(LIMITS)) o[k] = clamp(k, raw && raw[k]);
  for (const k of ['tensionCues', 'eyeRestCues', 'autoMeetingSnooze']) o[k] = !(raw && raw[k] === false);
  return o;
}

// Returns { config, preset } with overrides applied. Inputs are not mutated.
function applyOverrides(config, preset, raw) {
  const o = cleanOverrides(raw);
  const cfg = JSON.parse(JSON.stringify(config));
  const t = cfg.cues.tension;
  if (o.breathingRisePct != null) t.breathingRisePct = o.breathingRisePct;
  if (o.pulseRiseBpm != null) t.pulseRiseBpm = o.pulseRiseBpm;
  if (o.hrvDropPct != null) t.hrvDropPct = o.hrvDropPct;
  if (o.windowMinutes != null) t.windowSeconds = o.windowMinutes * 60;
  if (o.cooldownMinutes != null) cfg.cues.cooldownMinutes = o.cooldownMinutes;
  cfg.cues.tensionEnabled = o.tensionCues;
  cfg.cues.eyeRestEnabled = o.eyeRestCues;
  cfg.smartPauses.autoMeeting = o.autoMeetingSnooze;
  const p = { ...preset };
  if (o.eyeRestEveryMinutes != null) p.eyeRestEveryMinutes = o.eyeRestEveryMinutes;
  return { config: cfg, preset: p, overrides: o };
}

module.exports = { applyOverrides, cleanOverrides, DEFAULT_OVERRIDES, LIMITS };
