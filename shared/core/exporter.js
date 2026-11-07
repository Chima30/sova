'use strict';

// CSV and JSON export of locally stored SOVA data. Values that were never
// usable are exported as empty cells, never as guesses.

const SESSION_COLUMNS = [
  'id', 'preset', 'startedAt', 'endedAt', 'focusMinutes', 'blocksCompleted',
  'baselineBreathing', 'baselinePulse', 'baselineHrv', 'baselineReliable',
  'tensionCues', 'resets', 'eyeRests', 'meetingSnoozes', 'awayPauses',
  'reflection', 'note', 'aiReflection',
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
  };
}

function round1(v) { return v == null ? null : Math.round(v * 10) / 10; }

function toCSV(sessions) {
  const lines = [SESSION_COLUMNS.join(',')];
  for (const s of sessions) {
    const r = sessionRow(s);
    lines.push(SESSION_COLUMNS.map((c) => csvCell(r[c])).join(','));
  }
  return lines.join('\n') + '\n';
}

function toJSON(sessions, settings) {
  return JSON.stringify({
    app: 'SOVA',
    exportedAt: new Date().toISOString(),
    note: 'All values were recorded on this device. Video is never stored.',
    settings: settings || null,
    sessions,
  }, null, 2);
}

module.exports = { toCSV, toJSON, sessionRow, SESSION_COLUMNS };
