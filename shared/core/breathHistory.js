'use strict';

// One list of every breathing reset: those taken inside focus sessions
// (stored in each session's events) and those started from Recovery
// (stored separately). Newest first. Nothing is estimated.

function allResets(sessions, standalone) {
  const out = [];
  for (const s of sessions || []) {
    for (const e of s.events || []) {
      if (e.type !== 'reset') continue;
      out.push({
        id: `${s.id}:${e.at}`,
        at: e.at,
        source: 'session',
        sessionName: s.presetName,
        sessionId: s.id,
        seconds: e.seconds || 0,
        completed: !!e.completed,
        patternId: e.pattern || null,
        breathSound: e.breathSound || null,
        before: e.before || null,
        after: e.after || null,
      });
    }
  }
  for (const r of standalone || []) {
    out.push({
      id: r.id,
      at: r.at,
      source: 'recovery',
      sessionName: null,
      sessionId: null,
      seconds: r.seconds || 0,
      completed: !!r.completed,
      patternId: r.patternId || null,
      breathSound: r.breathSound || null,
      before: null,
      after: null,
    });
  }
  return out.sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

// Exhale trend from resets where enough breaths were heard (oldest first).
function exhaleTrend(resets, limit = 14) {
  return resets
    .filter((r) => r.breathSound && r.breathSound.enough && r.breathSound.avgExhale != null)
    .slice(0, limit)
    .reverse()
    .map((r) => ({ at: r.at, avgExhale: r.breathSound.avgExhale, target: r.breathSound.targetExhale }));
}

module.exports = { allResets, exhaleTrend };
