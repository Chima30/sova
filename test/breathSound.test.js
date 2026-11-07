'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { BreathSoundDetector, cameraSign, labelEvents, summarize } = require('../shared/core/breathSound');
const { guideAt } = require('../shared/core/breathing');

const pattern = { inhale: 4, hold: 0, exhale: 6, holdAfterExhale: 0 };
const phaseAt = (t) => guideAt(pattern, t).phase;
const FR = 0.02; // 50 frames per second

// Simulated loudness: quiet room at -60 dB, exhales at -45 dB lasting `ex` s.
function simulate({ seconds, exhaleFor = () => 5.5, inhaleLoud = false, start = 3 }) {
  const d = new BreathSoundDetector();
  for (let t = 0; t < start; t += FR) d.push(t, -60 + (Math.random() - 0.5));
  for (let t = start; t < start + seconds; t += FR) {
    const rt = t - start;
    const cyc = Math.floor(rt / 10);
    const inCycle = rt % 10;
    let db = -60 + (Math.random() - 0.5);
    if (inCycle >= 4 && inCycle < 4 + exhaleFor(cyc)) db = -45;
    if (inhaleLoud && inCycle >= 0.3 && inCycle < 3.3) db = -50;
    d.push(t, db);
  }
  d.finish();
  return d;
}

test('calibrates the room and finds each exhale with its length', () => {
  const d = simulate({ seconds: 60 });
  assert.ok(d.calibrated);
  assert.ok(Math.abs(d.floor + 60) < 1);
  assert.equal(d.events.length, 6);
  for (const e of d.events) assert.ok(Math.abs(e.duration - 5.5) < 0.1, `duration ${e.duration}`);
});

test('labels by the guide and summarises exhale length, trend and steadiness', () => {
  const d = simulate({ seconds: 60, exhaleFor: (c) => 4 + c * 0.4 });
  const labelled = labelEvents(d.events.map((e) => ({ ...e, start: e.start - 3, end: e.end - 3 })), { guidePhaseAt: phaseAt });
  assert.ok(labelled.every((e) => e.phase === 'exhale' && e.by === 'guide'));
  const r = summarize(labelled, { pattern, seconds: 60 });
  assert.equal(r.enough, true);
  assert.equal(r.heardExhales, 6);
  assert.equal(r.guidedBreaths, 6);
  assert.ok(r.secondHalfExhale > r.firstHalfExhale);
  assert.match(r.lines.join(' '), /got longer/);
  assert.match(r.lines.join(' '), /mostly silent/);
});

test('too few breaths gives an honest message instead of numbers', () => {
  const r = summarize([{ start: 4, end: 9, duration: 5, phase: 'exhale', by: 'guide' }], { pattern, seconds: 60 });
  assert.equal(r.enough, false);
  assert.equal(r.avgExhale, undefined);
  assert.match(r.lines[0], /too few to measure/);
});

test('very long sounds count as room noise, not breaths', () => {
  const d = new BreathSoundDetector();
  for (let t = 0; t < 3; t += FR) d.push(t, -60);
  for (let t = 3; t < 23; t += FR) d.push(t, -40);
  for (let t = 23; t < 24; t += FR) d.push(t, -60);
  d.finish();
  assert.equal(d.events.length, 0);
  assert.equal(d.rejectedLong, 1);
});

test('camera waveform sign is learned from the guide, then used for labels', () => {
  // A waveform that goes DOWN while breathing in (inverted convention).
  const trace = [];
  for (let t = 0; t < 40; t += 0.1) trace.push({ t, value: -Math.sin((2 * Math.PI * (t - 1)) / 10 + 0.0) * (phaseAt(t) === 'inhale' ? 1 : 1) });
  const inverted = [];
  for (let t = 0; t < 40; t += 0.1) inverted.push({ t, value: -guideAt(pattern, t).scale });
  assert.equal(cameraSign(inverted, phaseAt), -1);
  const normal = inverted.map((p) => ({ t: p.t, value: -p.value }));
  assert.equal(cameraSign(normal, phaseAt), 1);
  const flat = normal.map((p) => ({ t: p.t, value: Math.random() }));
  const s = cameraSign(flat, phaseAt);
  assert.ok(s === null || s === 1 || s === -1);

  const labelled = labelEvents([{ start: 4.2, end: 9.5, duration: 5.3 }], { trace: normal, sign: 1, guidePhaseAt: () => 'inhale' });
  assert.equal(labelled[0].phase, 'exhale', 'camera overrides the guide');
  assert.equal(labelled[0].by, 'camera');
  assert.ok(trace.length > 0);
});
