'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildTimeline, beforeAfter, weekly, patterns } = require('../shared/core/insights');

const iso = (base, sec) => new Date(Date.parse(base) + sec * 1000).toISOString();

function session(base, opts = {}) {
  const ev = (type, sec, extra = {}) => ({ type, at: iso(base, sec), ...extra });
  return {
    id: `s-${base}`,
    mode: opts.mode || 'live',
    presetName: opts.preset || 'Studying',
    startedAt: base,
    endedAt: iso(base, 3600),
    focusSeconds: opts.focusSeconds ?? 3000,
    blocksCompleted: 2,
    events: [
      ev('session-start', 0), ev('block-start', 0, { block: 1 }),
      ev('sample', 300, { tense: true }), ev('sample', 330, { tense: true }), ev('sample', 360, { tense: false }),
      ev('cue-tension', opts.cueAt ?? 600),
      ev('reset', 660, { seconds: 60, before: { breathing: 17, pulse: 80, hrv: null }, after: { breathing: 13, pulse: 74, hrv: null } }),
      ev('away', 900), ev('away-end', 960),
      ev('break-start', 1500, { minutes: 5 }), ev('block-start', 1800, { block: 2 }),
      ev('eye-rest', 2400), ev('session-end', 3600),
      ...(opts.extra || []).map(([t, s, x]) => ev(t, s, x)),
    ],
  };
}

test('timeline builds focus and break segments, stretches and markers', () => {
  const tl = buildTimeline(session('2026-11-02T09:00:00.000Z'));
  assert.equal(tl.total, 3600);
  assert.deepEqual(tl.segments.map((s) => [s.kind, s.from, s.to]), [['focus', 0, 1500], ['break', 1500, 1800], ['focus', 1800, 3600]]);
  const tense = tl.stretches.find((s) => s.kind === 'tense');
  assert.deepEqual([tense.from, tense.to], [300, 360]);
  assert.ok(tl.stretches.find((s) => s.kind === 'away' && s.from === 900 && s.to === 960));
  assert.deepEqual(tl.markers.map((m) => m.kind), ['cue-tension', 'reset', 'eye-rest']);
});

test('timeline of an old session without block events still shows one focus band', () => {
  const tl = buildTimeline({ startedAt: '2026-11-02T09:00:00.000Z', endedAt: '2026-11-02T09:10:00.000Z', events: [] });
  assert.equal(tl.segments.length, 1);
  assert.equal(tl.segments[0].kind, 'focus');
});

test('before-and-after needs at least 3 reliable pairs', () => {
  const two = [session('2026-11-02T09:00:00.000Z'), session('2026-11-03T09:00:00.000Z')];
  assert.equal(beforeAfter(two).breathing.enough, false);
  const three = [...two, session('2026-11-04T09:00:00.000Z')];
  const r = beforeAfter(three);
  assert.equal(r.breathing.enough, true);
  assert.equal(r.breathing.before, 17);
  assert.equal(r.breathing.after, 13);
  assert.equal(r.breathing.lowerAfter, 3);
  assert.equal(r.hrv.enough, false, 'hidden values never count');
});

test('weekly totals cover the last 7 days and count breaks taken', () => {
  const now = Date.parse('2026-11-07T18:00:00.000Z');
  const s = [session('2026-11-07T09:00:00.000Z'), session('2026-11-05T09:00:00.000Z', { extra: [['break-skipped', 1600]] }), session('2026-10-20T09:00:00.000Z')];
  const w = weekly(s, now);
  assert.equal(w.sessions, 2);
  assert.equal(w.focusMinutes, 100);
  assert.equal(w.breaksStarted, 2);
  assert.equal(w.breaksTaken, 1);
  assert.equal(w.days.length, 7);
});

test('patterns stay silent below 7 live sessions', () => {
  const few = Array.from({ length: 6 }, (_, i) => session(`2026-11-0${i + 1}T14:00:00.000Z`));
  const p = patterns(few);
  assert.equal(p.enough, false);
  assert.equal(p.have, 6);
  assert.equal(p.observations.length, 0);
  const timerOnly = Array.from({ length: 9 }, (_, i) => session(`2026-11-0${i + 1}T14:00:00.000Z`, { mode: 'timer' }));
  assert.equal(patterns(timerOnly).enough, false);
});

test('patterns report only what the data supports', () => {
  const many = Array.from({ length: 8 }, (_, i) => session(`2026-11-0${i + 1}T14:00:00`, { cueAt: 1200 }));
  const p = patterns(many);
  assert.equal(p.enough, true);
  const ids = p.observations.map((o) => o.id);
  assert.ok(ids.includes('cue-time'));
  assert.ok(ids.includes('first-cue'));
  assert.match(p.observations.find((o) => o.id === 'first-cue').text, /about 20 minutes/);
  assert.ok(ids.includes('reset-effect'));
  assert.ok(!ids.includes('trend'), 'needs 10 sessions');
});
