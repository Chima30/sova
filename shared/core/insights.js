'use strict';

// Insights from stored SOVA sessions only. Every function returns either
// real numbers from the data or an explicit "not enough data" result.
// Observations are worded cautiously and never invented.

const MIN_PATTERN_SESSIONS = 7;
const MIN_RESET_PAIRS = 3;
const SAMPLE_SECONDS = 30;

const ms = (iso) => Date.parse(iso);
const events = (s) => (Array.isArray(s.events) ? s.events : []);
const ofType = (s, type) => events(s).filter((e) => e.type === type);
const isLive = (s) => s.mode === 'live';
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// ---------------------------------------------------------------------------
// Focus timeline replay for one session. Offsets are seconds from the start.

function buildTimeline(session) {
  const t0 = ms(session.startedAt);
  const tEnd = ms(session.endedAt);
  const total = Math.max(1, (tEnd - t0) / 1000);
  const off = (iso) => Math.max(0, Math.min(total, (ms(iso) - t0) / 1000));
  const evs = events(session).filter((e) => e.at);

  // Focus and break segments from block-start / break-start events.
  const segments = [];
  let current = null;
  for (const e of evs) {
    if (e.type === 'block-start' || e.type === 'break-start') {
      const kind = e.type === 'block-start' ? 'focus' : 'break';
      if (current) { current.to = off(e.at); segments.push(current); }
      current = { kind, from: off(e.at), to: total, block: e.block || null };
    }
  }
  if (current) segments.push(current);
  if (!segments.length) segments.push({ kind: 'focus', from: 0, to: total, block: 1 });

  // Stretches: away, meeting, manual pause, tense (from 30 s samples).
  const stretches = [];
  const pair = (startType, endType, kind) => {
    let open = null;
    for (const e of evs) {
      if (e.type === startType && open == null) open = off(e.at);
      else if (e.type === endType && open != null) { stretches.push({ kind, from: open, to: off(e.at) }); open = null; }
    }
    if (open != null) stretches.push({ kind, from: open, to: total });
  };
  pair('away', 'away-end', 'away');
  pair('meeting', 'meeting-end', 'meeting');
  pair('pause', 'resume', 'paused');

  let tenseFrom = null;
  let lastTense = null;
  for (const e of evs.filter((x) => x.type === 'sample')) {
    const at = off(e.at);
    if (e.tense) {
      if (tenseFrom == null) tenseFrom = at;
      lastTense = at;
    } else if (tenseFrom != null) {
      stretches.push({ kind: 'tense', from: tenseFrom, to: Math.min(total, lastTense + SAMPLE_SECONDS) });
      tenseFrom = null;
    }
  }
  if (tenseFrom != null) stretches.push({ kind: 'tense', from: tenseFrom, to: Math.min(total, lastTense + SAMPLE_SECONDS) });

  const MARKERS = {
    'cue-tension': 'Tension cue',
    'cue-eye-rest': 'Eye-rest cue',
    reset: 'Breathing reset',
    'eye-rest': 'Eye rest taken',
    'flow-snooze': 'Flow snooze',
    'break-skipped': 'Break skipped',
    recalibrate: 'Recalibrated',
  };
  const markers = evs
    .filter((e) => MARKERS[e.type])
    .map((e) => ({
      kind: e.type,
      at: off(e.at),
      label: e.type === 'reset' ? `${MARKERS[e.type]}, ${e.seconds || 0} s` : MARKERS[e.type],
    }));

  return { total, segments, stretches, markers };
}

// ---------------------------------------------------------------------------
// Before-and-after across every reset that had reliable readings both times.

function beforeAfter(sessions) {
  const out = {};
  for (const kind of ['breathing', 'pulse', 'hrv']) {
    const pairs = [];
    for (const s of sessions) {
      for (const r of ofType(s, 'reset')) {
        const b = r.before && r.before[kind];
        const a = r.after && r.after[kind];
        if (b != null && a != null) pairs.push({ before: b, after: a });
      }
    }
    out[kind] = pairs.length >= MIN_RESET_PAIRS
      ? {
        enough: true,
        n: pairs.length,
        before: mean(pairs.map((p) => p.before)),
        after: mean(pairs.map((p) => p.after)),
        lowerAfter: pairs.filter((p) => p.after < p.before).length,
      }
      : { enough: false, n: pairs.length, need: MIN_RESET_PAIRS };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Weekly reflection and consistency (no streaks).

function weekly(sessions, nowMs = Date.now()) {
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(nowMs);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    days.push({ start: d.getTime(), label: d.toLocaleDateString(undefined, { weekday: 'short' }), focusMinutes: 0, sessions: 0 });
  }
  const weekStart = days[0].start;
  const week = sessions.filter((s) => ms(s.startedAt) >= weekStart && ms(s.startedAt) <= nowMs);
  for (const s of week) {
    const t = ms(s.startedAt);
    const day = [...days].reverse().find((d) => t >= d.start);
    if (day) { day.focusMinutes += Math.round((s.focusSeconds || 0) / 60); day.sessions += 1; }
  }
  const count = (type) => week.reduce((n, s) => n + ofType(s, type).length, 0);
  const breaksStarted = count('break-start');
  const breaksSkipped = count('break-skipped');
  return {
    days,
    sessions: week.length,
    focusMinutes: days.reduce((n, d) => n + d.focusMinutes, 0),
    eyeRests: count('eye-rest'),
    resets: count('reset'),
    breaksTaken: Math.max(0, breaksStarted - breaksSkipped),
    breaksStarted,
    blocksFinished: week.reduce((n, s) => n + (s.blocksCompleted || 0), 0),
  };
}

// ---------------------------------------------------------------------------
// Personal patterns. Needs MIN_PATTERN_SESSIONS live sessions, and each
// observation has its own minimum. Fewer = no observation.

function partOfDay(hour) {
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

function patterns(sessions) {
  const live = sessions.filter(isLive);
  if (live.length < MIN_PATTERN_SESSIONS) {
    return { enough: false, have: live.length, need: MIN_PATTERN_SESSIONS, observations: [] };
  }
  const obs = [];

  // 1. When tension cues tend to happen.
  const cueTimes = live.flatMap((s) => ofType(s, 'cue-tension').map((e) => new Date(e.at).getHours()));
  if (cueTimes.length >= 5) {
    const buckets = {};
    for (const h of cueTimes) buckets[partOfDay(h)] = (buckets[partOfDay(h)] || 0) + 1;
    const [top, n] = Object.entries(buckets).sort((a, b) => b[1] - a[1])[0];
    if (n / cueTimes.length >= 0.5) {
      obs.push({ id: 'cue-time', text: `Most of your tension cues (${n} of ${cueTimes.length}) came in the ${top}.` });
    }
  }

  // 2. How long focus usually lasts before the first cue in a block.
  const firstCueMinutes = [];
  for (const s of live) {
    let blockAt = null;
    let cued = false;
    for (const e of events(s)) {
      if (e.type === 'block-start') { blockAt = ms(e.at); cued = false; }
      else if (e.type === 'cue-tension' && blockAt != null && !cued) {
        firstCueMinutes.push((ms(e.at) - blockAt) / 60000);
        cued = true;
      }
    }
  }
  if (firstCueMinutes.length >= 5) {
    obs.push({ id: 'first-cue', text: `In blocks with a tension cue, the first one usually came after about ${Math.round(median(firstCueMinutes))} minutes of focus.` });
  }

  // 3. What resets did to breathing.
  const ba = beforeAfter(live).breathing;
  if (ba.enough && ba.n >= 5) {
    obs.push({ id: 'reset-effect', text: `After ${ba.n} resets, your breathing was slower 60 seconds later in ${ba.lowerAfter} of them.` });
  }

  // 4. Cues per focus hour by preset (each preset needs 3 sessions and 1 focus hour).
  const byPreset = {};
  for (const s of live) {
    const p = byPreset[s.presetName] || (byPreset[s.presetName] = { sessions: 0, cues: 0, hours: 0 });
    p.sessions += 1;
    p.cues += ofType(s, 'cue-tension').length;
    p.hours += (s.focusSeconds || 0) / 3600;
  }
  const rated = Object.entries(byPreset)
    .filter(([, p]) => p.sessions >= 3 && p.hours >= 1)
    .map(([name, p]) => ({ name, rate: p.cues / p.hours }))
    .sort((a, b) => a.rate - b.rate);
  if (rated.length >= 2 && rated[rated.length - 1].rate - rated[0].rate >= 0.5) {
    obs.push({ id: 'preset', text: `Your ${rated[0].name} sessions had fewer tension cues per focus hour than your ${rated[rated.length - 1].name} sessions.` });
  }

  // 5. Typical start time (focus rhythm).
  const startHours = live.map((s) => new Date(s.startedAt).getHours() + new Date(s.startedAt).getMinutes() / 60);
  const mh = median(startHours);
  const spread = startHours.filter((h) => Math.abs(h - mh) <= 1.5).length;
  if (spread / startHours.length >= 0.6) {
    const h = Math.floor(mh);
    const m = Math.round((mh - h) * 60 / 15) * 15;
    const label = new Date(2026, 0, 1, h, m % 60).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    obs.push({ id: 'start-time', text: `You usually start focus sessions around ${label}.` });
  }

  // 6. Change in working habits: focus per session, older half vs recent half.
  if (live.length >= 10) {
    const sorted = [...live].sort((a, b) => ms(a.startedAt) - ms(b.startedAt));
    const half = Math.floor(sorted.length / 2);
    const older = mean(sorted.slice(0, half).map((s) => (s.focusSeconds || 0) / 60));
    const recent = mean(sorted.slice(half).map((s) => (s.focusSeconds || 0) / 60));
    if (older > 0 && Math.abs(recent - older) / older >= 0.2) {
      obs.push({
        id: 'trend',
        text: `Your recent sessions average ${Math.round(recent)} focused minutes, ${recent > older ? 'up' : 'down'} from ${Math.round(older)} in your earlier sessions.`,
      });
    }
  }

  return { enough: true, have: live.length, need: MIN_PATTERN_SESSIONS, observations: obs };
}

module.exports = { buildTimeline, beforeAfter, weekly, patterns, MIN_PATTERN_SESSIONS, MIN_RESET_PAIRS };
