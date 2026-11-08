'use strict';

// 60-second signal check-ins: summarising the readings, building a personal
// range from your own history, and comparing with your last check-in.
// Only steady readings (see signals.checkUsable) ever reach these functions.
// Nothing here estimates a missing value or uses population "normal" ranges.

const KINDS = ['breathing', 'pulse', 'hrv'];

function median(values) {
  const v = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

// Linear-interpolated percentile, p in 0..1.
function percentile(values, p) {
  const v = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (!v.length) return null;
  const idx = (v.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return v[lo] + (v[hi] - v[lo]) * (idx - lo);
}

// One value per signal for a check-in: the median of its steady readings.
// A signal needs a few steady readings to count; otherwise it stays null.
function summarize(samples, minSamples = 3) {
  const out = {};
  for (const k of KINDS) {
    const list = (samples && samples[k]) || [];
    out[k] = list.length >= minSamples ? Math.round(median(list) * 10) / 10 : null;
  }
  return out;
}

// Your own past readings of one signal: check-in values plus reliable
// baselines from focus sessions. Each entry is { value, at }.
function history(kind, checkIns, sessions, excludeId) {
  const out = [];
  for (const c of checkIns || []) {
    if (c.id === excludeId) continue;
    const v = c.values && c.values[kind];
    if (Number.isFinite(v)) out.push({ value: v, at: c.at });
  }
  for (const s of sessions || []) {
    const b = s.baseline && s.baseline[kind];
    if (b && b.reliable && Number.isFinite(b.value)) out.push({ value: b.value, at: s.startedAt });
  }
  return out;
}

// Your usual range: the middle half (25th to 75th percentile) of your own
// readings, shown only with enough of them spread over enough days.
function personalRange(entries, { minReadings = 5, minDays = 3 } = {}) {
  const values = entries.map((e) => e.value);
  const days = new Set(entries.map((e) => String(e.at || '').slice(0, 10)).filter(Boolean)).size;
  if (values.length < minReadings || days < minDays) {
    return { ready: false, have: values.length, needReadings: minReadings, haveDays: days, needDays: minDays };
  }
  return {
    ready: true,
    low: Math.round(percentile(values, 0.25) * 10) / 10,
    high: Math.round(percentile(values, 0.75) * 10) / 10,
    median: Math.round(median(values) * 10) / 10,
    min: Math.min(...values),
    max: Math.max(...values),
    n: values.length,
    days,
  };
}

// Where today's value sits against that range. Words are factual only.
function position(value, range) {
  if (!range || !range.ready || !Number.isFinite(value)) return null;
  if (value < range.low) return 'below';
  if (value > range.high) return 'above';
  return 'within';
}

// The most recent earlier check-in that has this signal.
function compareWithLast(kind, current, checkIns) {
  const v = current.values && current.values[kind];
  if (!Number.isFinite(v)) return null;
  const prev = (checkIns || [])
    .filter((c) => c.id !== current.id && String(c.at) < String(current.at) && Number.isFinite(c.values && c.values[kind]))
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))[0];
  if (!prev) return null;
  return { previous: prev.values[kind], previousAt: prev.at, diff: Math.round((v - prev.values[kind]) * 10) / 10 };
}

module.exports = { KINDS, median, percentile, summarize, history, personalRange, position, compareWithLast };
