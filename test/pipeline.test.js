'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../shared/config/sova-config.json');
const { pipelineRows } = require('../shared/core/pipeline');

const cfg = config.signals;
const good = { value: 14.2, confidence: 80, stable: true };

test('a usable reading shows its value and the SDK field', () => {
  const { vitals } = pipelineRows({ breathing: good }, 120, cfg);
  const b = vitals.find((v) => v.kind === 'breathing');
  assert.equal(b.state, 'used');
  assert.equal(b.value, 14.2);
  assert.equal(b.field, 'breathing.rate');
  assert.equal(b.confidence, 80);
});

test('a weak reading is held back: no value, a reason, confidence still shown', () => {
  const { vitals } = pipelineRows({ pulse: { value: 88, confidence: 20, stable: true } }, 120, cfg);
  const p = vitals.find((v) => v.kind === 'pulse');
  assert.equal(p.state, 'held');
  assert.equal(p.value, null);
  assert.equal(p.reason, 'low-confidence');
  assert.equal(p.confidence, 20);
});

test('warm-up and instability hold values back', () => {
  const warm = pipelineRows({ hrv: { value: 40, confidence: 90, stable: true } }, 10, cfg).vitals.find((v) => v.kind === 'hrv');
  assert.equal(warm.reason, 'warming-up');
  assert.equal(warm.value, null);
  const shaky = pipelineRows({ breathing: { ...good, stable: false } }, 120, cfg).vitals.find((v) => v.kind === 'breathing');
  assert.equal(shaky.reason, 'unstable');
  assert.equal(shaky.value, null);
});

test('a stale reading shows nothing', () => {
  const { vitals, stale } = pipelineRows({ breathing: good }, 120, cfg, cfg.staleAfterSeconds + 1);
  assert.equal(stale, true);
  assert.ok(vitals.every((v) => v.value == null && v.state === 'waiting'));
});

test('face signals report only when stable', () => {
  const { face } = pipelineRows({ blinking: { detected: true, stable: true }, talking: { detected: true, stable: false } }, 120, cfg);
  assert.equal(face.find((f) => f.kind === 'blinking').text, 'Blink');
  assert.equal(face.find((f) => f.kind === 'talking').text, 'Settling');
});

const { trend } = require('../shared/core/checkIns');

test('check-in trend: one median per day, empty days left out, old ones dropped', () => {
  const now = new Date(2026, 10, 13, 18, 0);
  const at = (d, h) => new Date(2026, 10, d, h, 0).toISOString();
  const checkIns = [
    { at: at(13, 9), values: { breathing: 14 } },
    { at: at(13, 12), values: { breathing: 16 } },
    { at: at(13, 15), values: { breathing: 18 } },
    { at: at(10, 9), values: { breathing: 12, pulse: 70 } },
    { at: at(1, 9), values: { breathing: 30 } },          // older than 14 days
    { at: at(11, 9), values: { breathing: null } },       // no steady reading
  ];
  const t = trend('breathing', checkIns, { days: 7, now });
  assert.deepEqual(t.map((p) => [p.day, p.value, p.count]), [['2026-11-10', 12, 1], ['2026-11-13', 16, 3]]);
  assert.deepEqual(trend('hrv', checkIns, { now }), []);
});
