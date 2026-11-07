'use strict';

// CSV and JSON export of locally stored SOVA data. Values that were never
// usable are exported as empty cells, never as guesses.

const SESSION_COLUMNS = [
  'id', 'preset', 'startedAt', 'endedAt', 'focusMinutes', 'blocksCompleted',
  'baselineBreathing', 'baselinePulse', 'baselineHrv', 'baselineReliable',
  'tensionCues', 'resets', 'eyeRests', 'meetingSnoozes', 'awayPauses',
  'reflection', 'note', 'aiReflection', 'feelingAtStart',
];

function csvCell(v) {
  if (v == null) return '';
  const s = Array.isArray(v) ? v.join('; ') : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function sessionRow(s) {
  const count = (type) => (s.events || []).filter((e) => e.type === type).length;
  const b = s.baseline || {};
  return {
    id: s.id,
    preset: s.presetName,
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    focusMinutes: s.focusSeconds != null ? Math.round(s.focusSeconds / 60) : null,
    blocksCompleted: s.blocksCompleted,
    baselineBreathing: b.breathing && b.breathing.reliable ? round1(b.breathing.value) : null,
    baselinePulse: b.pulse && b.pulse.reliable ? round1(b.pulse.value) : null,
    baselineHrv: b.hrv && b.hrv.reliable ? round1(b.hrv.value) : null,
    baselineReliable: !!b.reliable,
    tensionCues: count('cue-tension'),
    resets: count('reset'),
    eyeRests: count('eye-rest'),
    meetingSnoozes: count('meeting'),
    awayPauses: count('away'),
    reflection: s.reflection ? s.reflection.tags : null,
    note: s.reflection ? s.reflection.note : null,
    aiReflection: s.ai && s.ai.text ? s.ai.text : null,
    feelingAtStart: s.checkIn ? s.checkIn.feeling : null,
  };
}

function round1(v) { return v == null ? null : Math.round(v * 10) / 10; }

const RESET_COLUMNS = [
  'at', 'source', 'session', 'pattern', 'seconds', 'completed',
  'heardExhales', 'guidedBreaths', 'avgExhale', 'targetExhale', 'firstHalfExhale', 'secondHalfExhale',
  'steadiness', 'avgInhale', 'breathingBefore', 'breathingAfter', 'pulseBefore', 'pulseAfter',
];

function resetRow(r) {
  const b = r.breathSound || {};
  return {
    at: r.at, source: r.source, session: r.sessionName, pattern: r.patternId, seconds: r.seconds, completed: r.completed,
    heardExhales: b.heardExhales, guidedBreaths: b.guidedBreaths, avgExhale: b.avgExhale, targetExhale: b.targetExhale,
    firstHalfExhale: b.firstHalfExhale, secondHalfExhale: b.secondHalfExhale, steadiness: b.steadiness, avgInhale: b.avgInhale,
    breathingBefore: r.before && r.before.breathing != null ? round1(r.before.breathing) : null,
    breathingAfter: r.after && r.after.breathing != null ? round1(r.after.breathing) : null,
    pulseBefore: r.before && r.before.pulse != null ? round1(r.before.pulse) : null,
    pulseAfter: r.after && r.after.pulse != null ? round1(r.after.pulse) : null,
  };
}

// Sessions table, then (when there are any) a breathing resets table.
function toCSV(sessions, standaloneResets) {
  const { allResets } = require('./breathHistory');
  const lines = [SESSION_COLUMNS.join(',')];
  for (const s of sessions) {
    const r = sessionRow(s);
    lines.push(SESSION_COLUMNS.map((c) => csvCell(r[c])).join(','));
  }
  const resets = allResets(sessions, standaloneResets);
  if (resets.length) {
    lines.push('', '# Breathing resets', RESET_COLUMNS.join(','));
    for (const r of resets) {
      const row = resetRow(r);
      lines.push(RESET_COLUMNS.map((c) => csvCell(row[c])).join(','));
    }
  }
  return lines.join('\n') + '\n';
}

function toJSON(sessions, settings, standaloneResets) {
  return JSON.stringify({
    app: 'SOVA',
    exportedAt: new Date().toISOString(),
    note: 'All values were recorded on this device. Video and audio are never stored.',
    settings: settings || null,
    sessions,
    recoveryResets: standaloneResets || [],
  }, null, 2);
}

module.exports = { toCSV, toJSON, sessionRow, resetRow, SESSION_COLUMNS, RESET_COLUMNS };
