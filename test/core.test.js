'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../shared/config/sova-config.json');
const { extractLatest, checkUsable } = require('../shared/core/signals');
const { Baseline } = require('../shared/core/baseline');
const { CueEngine, inQuietHours } = require('../shared/core/cueEngine');
const { SessionEngine, formatClock } = require('../shared/core/sessionEngine');
const { guideAt, breathsPerMinute, validatePattern, exhaleCoaching } = require('../shared/core/breathing');
const { toCSV, toJSON } = require('../shared/core/exporter');

const preset = config.presets.find((p) => p.id === 'studying');

test('extractLatest reads the newest sample of each signal', () => {
  const m = {
    breathing: {
      rate: [{ value: 12, confidence: 30, stable: false, timestamp: 1 }, { value: 14, confidence: 80, stable: true, timestamp: 2 }],
      upperTrace: [{ value: 0.1, timestamp: 2 }],
      inhaleExhaleRatio: [{ value: 0.8, timestamp: 2 }],
    },
    cardio: { pulseRate: [{ value: 72, confidence: 90, stable: true, timestamp: 2 }], hrv: [{ rmssd: 40, confidence: 70, stable: true, timestamp: 2 }] },
    face: { blinking: [{ detected: true, stable: true, timestamp: 2 }], talking: [{ detected: false, stable: true, timestamp: 2 }] },
  };
  const r = extractLatest(m);
  assert.equal(r.breathing.value, 14);
  assert.equal(r.pulse.value, 72);
  assert.equal(r.hrv.value, 40);
  assert.equal(r.ieRatio.value, 0.8);
  assert.equal(r.blinking.detected, true);
  assert.equal(r.breathTrace.length, 1);
  assert.deepEqual(extractLatest(null), {});
});

test('checkUsable hides values until warm-up, confidence, stability and range pass', () => {
  const s = config.signals;
  const good = { value: 72, confidence: 90, stable: true };
  assert.equal(checkUsable('pulse', good, 5, s).reason, 'warming-up');
  assert.equal(checkUsable('pulse', good, 20, s).usable, true);
  assert.equal(checkUsable('pulse', { ...good, confidence: 20 }, 20, s).reason, 'low-confidence');
  assert.equal(checkUsable('pulse', { ...good, stable: false }, 20, s).reason, 'unstable');
  assert.equal(checkUsable('pulse', { ...good, value: 130 }, 20, s).reason, 'out-of-range');
  assert.equal(checkUsable('hrv', { value: 40, confidence: 90, stable: true }, 30, s).reason, 'warming-up');
  assert.equal(checkUsable('breathing', null, 60, s).reason, 'no-reading');
});

test('baseline is unreliable with too few samples and uses the median otherwise', () => {
  const b = new Baseline(config.baseline);
  for (let i = 0; i < 5; i++) b.add('breathing', 12, i);
  assert.equal(b.freeze().reliable, false);

  const b2 = new Baseline(config.baseline);
  for (let i = 0; i < 30; i++) b2.add('breathing', i % 2 ? 12 : 14, i);
  b2.add('breathing', 99, 200); // after the window, ignored
  const f = b2.freeze();
  assert.equal(f.reliable, true);
  assert.equal(f.breathing.value, 13);
});

function engineWithBaseline() {
  const e = new CueEngine(config, 'standard', preset);
  e.setBaseline({ reliable: true, breathing: { value: 12, reliable: true }, pulse: { value: 70, reliable: true }, hrv: { value: 40, reliable: true }, blinksPerMinute: 15 });
  return e;
}

test('tension cue needs a sustained rise across the window', () => {
  const e = engineWithBaseline();
  const ctx = { inFocus: true, quietHours: false };
  for (let t = 0; t <= 100; t += 2) e.addUsable('breathing', 16, t);
  assert.equal(e.evaluate(100, ctx), null, 'not enough time yet');
  for (let t = 102; t <= 180; t += 2) e.addUsable('breathing', 16, t);
  assert.equal(e.evaluate(180, ctx), 'tension');

  const calm = engineWithBaseline();
  for (let t = 0; t <= 180; t += 2) calm.addUsable('breathing', t % 4 ? 16 : 12, t);
  assert.equal(calm.evaluate(180, ctx), null, 'only half the samples tense');
});

test('cues are suppressed by snooze, meeting, away, quiet hours, cooldown and breaks', () => {
  const e = engineWithBaseline();
  for (let t = 0; t <= 180; t += 2) e.addUsable('breathing', 16, t);
  assert.equal(e.suppression(180, { inFocus: false, quietHours: false }), 'not-focus');
  assert.equal(e.suppression(180, { inFocus: true, quietHours: true }), 'quiet-hours');
  e.snoozeFlow(170);
  assert.equal(e.suppression(180, { inFocus: true, quietHours: false }), 'snoozed');

  const m = engineWithBaseline();
  for (let t = 0; t <= 20; t += 1) m.addTalking(true, t);
  assert.equal(m.inMeeting(20), true);

  const a = engineWithBaseline();
  a.faceSeen(0);
  assert.equal(a.isAway(61), true);

  const c = engineWithBaseline();
  c.markCueShown(100);
  assert.equal(c.suppression(200, { inFocus: true, quietHours: false }), 'cooldown');

  const nb = new CueEngine(config, 'standard', preset);
  assert.equal(nb.suppression(10, { inFocus: true, quietHours: false }), 'no-baseline');
});

test('eye rest falls back to a time reminder without a blink baseline', () => {
  const e = new CueEngine(config, 'standard', preset);
  e.setBaseline({ reliable: true, breathing: { value: 12, reliable: true }, blinksPerMinute: null });
  e.faceSeen(0);
  for (let t = 0; t <= preset.eyeRestEveryMinutes * 60 + 5; t += 1) { e.faceSeen(t); e.tickScreen(t, true); }
  assert.equal(e.eyeRestDue(preset.eyeRestEveryMinutes * 60 + 5), true);
  e.markEyeRestTaken();
  assert.equal(e.eyeRestDue(preset.eyeRestEveryMinutes * 60 + 6), false);
});

test('quiet hours handle ranges across midnight', () => {
  const q = { enabled: true, start: '21:00', end: '08:00' };
  assert.equal(inQuietHours(new Date(2026, 0, 1, 22, 0), q), true);
  assert.equal(inQuietHours(new Date(2026, 0, 1, 7, 59), q), true);
  assert.equal(inQuietHours(new Date(2026, 0, 1, 12, 0), q), false);
  assert.equal(inQuietHours(new Date(2026, 0, 1, 22, 0), { ...q, enabled: false }), false);
});

test('session engine runs blocks, pauses, and adapts breaks', () => {
  const s = new SessionEngine(config, preset);
  s.pause('manual');
  assert.equal(s.tick(60), null);
  assert.equal(s.remaining, preset.focusMinutes * 60);
  s.resume('manual');
  s.noteCue();
  const ev = s.tick(preset.focusMinutes * 60);
  assert.equal(ev.next, 'break');
  assert.equal(ev.breakSeconds, Math.round(preset.breakMinutes * 1.5) * 60);

  const calm = new SessionEngine(config, preset);
  const ev2 = calm.tick(preset.focusMinutes * 60);
  assert.equal(ev2.breakSeconds, Math.max(config.breaks.minBreakMinutes, Math.round(preset.breakMinutes * 0.8)) * 60);

  const all = new SessionEngine(config, { ...preset, blocks: 1 });
  assert.equal(all.tick(preset.focusMinutes * 60).next, 'done');
  assert.equal(all.done, true);
  assert.equal(formatClock(65), '01:05');
});

test('breathing guide follows the pattern', () => {
  const p = { inhale: 4, hold: 0, exhale: 6, holdAfterExhale: 0 };
  assert.equal(breathsPerMinute(p), 6);
  assert.equal(guideAt(p, 1).phase, 'inhale');
  assert.equal(guideAt(p, 5).phase, 'exhale');
  assert.equal(guideAt(p, 11).phase, 'inhale');
  assert.equal(validatePattern(p), true);
  assert.equal(validatePattern({ inhale: 1, exhale: 6 }), false);
  assert.equal(exhaleCoaching(0.8, 1.5).tip, 'Try a slightly longer exhale');
  assert.equal(exhaleCoaching(0.5, 1.5).label, '1 : 2.0');
  assert.equal(exhaleCoaching(null, 1.5), null);
});

test('export writes empty cells for unreliable values and escapes notes', () => {
  const s = [{
    id: 'a', presetName: 'Studying', startedAt: 'x', endedAt: 'y', focusSeconds: 1500, blocksCompleted: 1,
    baseline: { reliable: false, breathing: { reliable: false, value: null }, pulse: { reliable: true, value: 71.25 } },
    events: [{ type: 'reset' }, { type: 'cue-tension' }],
    reflection: { tags: ['Calm', 'Tired'], note: 'said "hi", then left' },
  }];
  const csv = toCSV(s).split('\n');
  assert.match(csv[1], /^a,Studying,x,y,25,1,,71.3,,false,1,1,0,0,0,Calm; Tired,"said ""hi"", then left",,$/);
  s[0].checkIn = { feeling: 'Tense', at: 'x' };
  assert.match(toCSV(s).split('\n')[1], /,Tense$/);
  const json = JSON.parse(toJSON(s, { theme: 'dark' }));
  assert.equal(json.app, 'SOVA');
});

test('skipped focus blocks do not count as finished', () => {
  const s = new SessionEngine(config, preset);
  s.skipPhase();             // skip block 1
  s.skipPhase();             // skip the break
  s.tick(preset.focusMinutes * 60); // block 2 runs to the end
  assert.equal(s.finishedBlocks, 1);
});

test('baseline is reliable from pulse alone when breathing is too weak', () => {
  const b = new Baseline(config.baseline);
  for (let i = 0; i < 30; i++) b.add('pulse', 74 + (i % 3), i);
  for (let i = 0; i < 3; i++) b.add('breathing', 12, i);
  const f = b.freeze();
  assert.equal(f.reliable, true);
  assert.equal(f.breathing.reliable, false);
  assert.equal(f.pulse.reliable, true);
});

const { applyOverrides, cleanOverrides } = require('../shared/core/overrides');

test('personal overrides are clamped and applied without touching the shared config', () => {
  const { config: c, preset: p } = applyOverrides(config, preset, { breathingRisePct: 5, pulseRiseBpm: 12, windowMinutes: 2, eyeRestEveryMinutes: 45, tensionCues: false });
  assert.equal(c.cues.tension.breathingRisePct, 10, 'clamped to the minimum');
  assert.equal(c.cues.tension.pulseRiseBpm, 12);
  assert.equal(c.cues.tension.windowSeconds, 120);
  assert.equal(p.eyeRestEveryMinutes, 45);
  assert.equal(config.cues.tension.breathingRisePct, 20, 'shared config unchanged');
  assert.equal(cleanOverrides({ pulseRiseBpm: 'abc' }).pulseRiseBpm, null);

  const e = new CueEngine(c, 'standard', p);
  e.setBaseline({ reliable: true, breathing: { value: 12, reliable: true }, pulse: { value: 70, reliable: true } });
  for (let t = 0; t <= 200; t += 2) e.addUsable('breathing', 20, t);
  assert.equal(e.evaluate(200, { inFocus: true, quietHours: false }), null, 'tension cues switched off');
});

test('automatic meeting snooze can be switched off', () => {
  const { config: c } = applyOverrides(config, preset, { autoMeetingSnooze: false });
  const e = new CueEngine(c, 'standard', preset);
  for (let t = 0; t <= 20; t += 1) e.addTalking(true, t);
  assert.equal(e.inMeeting(20), false);
});

const { buildPrompt, MAX_BYTES } = require('../shared/core/aiPrompt');

test('AI prompts stay under 2048 bytes and keep the safety rules', () => {
  const p = buildPrompt('reflection', {
    presetName: 'Studying', focusMinutes: 48, tensionCues: 2, resets: 1, eyeRests: 3,
    baseline: { breathing: 13.2, pulse: 70.4, hrv: null },
    breathSound: { avgExhale: 5.2, targetExhale: 6 },
    feeling: 'Tense', lastReset: { before: 17.4, after: 13.1 },
  });
  assert.match(p, /I said I felt: tense/);
  assert.match(p, /17 breaths\/min before, 13 a minute after/);
  assert.match(p, /never interpret it/);
  assert.ok(Buffer.byteLength(p, 'utf8') <= MAX_BYTES);
  assert.match(p, /do not diagnose/);
  assert.match(p, /13 breaths\/min, 70 bpm/);
  assert.doesNotMatch(p, /ms HRV/, 'missing values are left out, not invented');
  assert.doesNotMatch(buildPrompt('checkin', { presetName: 'x' }), /I said I felt/, 'no check-in, no feeling line');
  const long = buildPrompt('checkin', { presetName: 'x'.repeat(3000) });
  assert.ok(Buffer.byteLength(long, 'utf8') <= MAX_BYTES);
});

const ci = require('../shared/core/checkIns');

test('check-in summary uses the median of steady readings and leaves thin signals empty', () => {
  const s = ci.summarize({ breathing: [14, 15, 30, 14.5], pulse: [70, 72], hrv: [] });
  assert.equal(s.breathing, 14.8);
  assert.equal(s.pulse, null, 'two readings are not enough');
  assert.equal(s.hrv, null);
});

test('personal range needs enough readings over enough days, then uses the middle half', () => {
  const day = (d) => `2026-11-0${d}T09:00:00.000Z`;
  const few = [{ value: 12, at: day(1) }, { value: 13, at: day(1) }, { value: 14, at: day(2) }];
  const r0 = ci.personalRange(few);
  assert.equal(r0.ready, false);
  assert.equal(r0.have, 3);
  const many = [12, 13, 14, 15, 16, 30].map((v, i) => ({ value: v, at: day((i % 4) + 1) }));
  const r = ci.personalRange(many);
  assert.equal(r.ready, true);
  assert.equal(r.low, 13.3);
  assert.equal(r.high, 15.8);
  assert.equal(ci.position(17, r), 'above');
  assert.equal(ci.position(14, r), 'within');
  assert.equal(ci.position(null, r), null, 'no value, no position');
});

test('history mixes check-ins and reliable session baselines only', () => {
  const h = ci.history('breathing',
    [{ id: 'a', at: '2026-11-01', values: { breathing: 14 } }, { id: 'b', at: '2026-11-02', values: { breathing: null } }, { id: 'now', at: '2026-11-03', values: { breathing: 20 } }],
    [{ startedAt: '2026-11-01', baseline: { breathing: { value: 13, reliable: true } } }, { startedAt: '2026-11-02', baseline: { breathing: { value: 9, reliable: false } } }],
    'now');
  assert.deepEqual(h.map((x) => x.value), [14, 13]);
});

test('comparison with the last check-in skips ones without that signal', () => {
  const list = [
    { id: '1', at: '2026-11-01T08:00', values: { breathing: 14 } },
    { id: '2', at: '2026-11-02T08:00', values: { breathing: null } },
  ];
  const cur = { id: '3', at: '2026-11-03T08:00', values: { breathing: 17, hrv: null } };
  assert.deepEqual(ci.compareWithLast('breathing', cur, list), { previous: 14, previousAt: '2026-11-01T08:00', diff: 3 });
  assert.equal(ci.compareWithLast('hrv', cur, list), null);
});

test('export includes signal check-ins, with empty cells for signals not shown', () => {
  const csv = toCSV([], [], [{ id: 'c1', at: '2026-11-08T09:00:00.000Z', seconds: 60, values: { breathing: 14.5, pulse: 71, hrv: null }, feeling: 'Calm', faceInViewPct: 98 }]);
  assert.match(csv, /# Signal check-ins/);
  assert.match(csv, /2026-11-08T09:00:00.000Z,60,14.5,71,,Calm,98/);
});
