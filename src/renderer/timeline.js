'use strict';

// Focus timeline replay: focus and break bands, stretches (tense, away,
// meeting, paused) and markers (cues, resets, eye rests), plus a readable
// list for screen readers and keyboard users.

const { esc } = require('./dom');
const { buildTimeline } = require('../../shared/core/insights');

const C = {
  focus: '#5fcfc3',
  focusLive: 'rgba(95, 207, 195, 0.55)',
  break: '#232836',
  tense: '#d9b26f',
  away: '#4b5468',
  meeting: '#6d6496',
  paused: '#3a4152',
};
const STRETCH = {
  tense: { color: C.tense, label: 'Breathing or pulse above baseline' },
  away: { color: C.away, label: 'Away' },
  meeting: { color: C.meeting, label: 'Meeting' },
  paused: { color: C.paused, label: 'Paused' },
};
const MARK = {
  'cue-tension': '#d9b26f',
  'cue-eye-rest': '#a3a9b8',
  reset: '#5fcfc3',
  'eye-rest': '#b3a9e6',
  'flow-snooze': '#7a8296',
  'break-skipped': '#7a8296',
  recalibrate: '#7a8296',
  'ai-checkin': '#b3a9e6',
};

function clockAt(session, offsetSec) {
  return new Date(Date.parse(session.startedAt) + offsetSec * 1000)
    .toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
const pct = (v, total) => `${Math.max(0, Math.min(100, (v / total) * 100)).toFixed(3)}%`;

// compact: no list, no legend (the live workstation strip).
// plannedSeconds: draw the rest of a running session as an empty track.
function renderTimeline(session, { compact = false, plannedSeconds = null } = {}) {
  const tl = buildTimeline(session);
  const T = Math.max(tl.total, plannedSeconds || 0);
  const kinds = new Set(tl.stretches.map((s) => s.kind));
  const live = plannedSeconds != null;

  const bands = tl.segments.map((s) => `<div class="tl-band" title="${s.kind === 'focus' ? `Focus block ${s.block || ''}` : 'Break'}" style="left: ${pct(s.from, T)}; width: ${pct(s.to - s.from, T)}; background: ${s.kind === 'focus' ? (live ? C.focusLive : C.focus) : C.break}; border-right: 2px solid #07080d"></div>`).join('');
  const stretches = tl.stretches.map((s) => `<div class="tl-band" title="${esc(STRETCH[s.kind].label)}" style="left: ${pct(s.from, T)}; width: max(3px, ${pct(s.to - s.from, T)}); background: ${STRETCH[s.kind].color}; border-radius: 2px"></div>`).join('');
  const markers = tl.markers.map((m) => `<div class="tl-mark" title="${esc(m.label)} at ${esc(clockAt(session, m.at))}" style="left: calc(${pct(m.at, T)} - 5px); background: ${MARK[m.kind] || '#7a8296'}"></div>`).join('');
  const nowLine = live ? `<div style="position: absolute; top: 0; bottom: 0; left: ${pct(tl.total, T)}; width: 2px; background: var(--text)"></div>` : '';

  const legend = [
    `<span><span class="sw" style="background: ${C.focus}"></span>Focus</span>`,
    `<span><span class="sw" style="background: ${C.break}; border: 1px solid var(--hair-2)"></span>Break</span>`,
    ...[...kinds].map((k) => `<span><span class="sw" style="background: ${STRETCH[k].color}"></span>${esc(STRETCH[k].label)}</span>`),
  ].join('');

  const list = tl.markers.length
    ? `<div class="rows">${tl.markers.map((m) => `<div class="row-item" style="padding: 10px 4px"><span class="row" style="gap: 10px"><span class="dot" style="background: ${MARK[m.kind] || '#7a8296'}"></span>${esc(m.label)}</span><span class="t-meta row-aside">${esc(clockAt(session, m.at))}</span></div>`).join('')}</div>`
    : '<p class="t-small">No cues, resets or eye rests in this session.</p>';
  const hasSamples = (session.events || []).some((e) => e.type === 'sample');

  return `
    <div class="stack-8">
      <div class="tl-track" role="img" aria-label="Focus and break blocks">${bands}${nowLine}</div>
      ${tl.stretches.length ? `<div class="tl-row" role="img" aria-label="Tense, away, meeting and paused stretches">${stretches}</div>` : ''}
      <div class="tl-marks" aria-hidden="true">${markers}</div>
      <div class="row-between"><span class="t-meta">${esc(clockAt(session, 0))}</span><span class="t-meta">${live ? `ends about ${esc(clockAt(session, T))}` : esc(clockAt(session, T))}</span></div>
      ${compact ? '' : `<div class="legend">${legend}</div>
      ${session.mode === 'live' && !hasSamples ? '<p class="t-small">Tense stretches appear only when a reliable baseline was set during the session.</p>' : ''}
      ${list}`}
    </div>`;
}

module.exports = { renderTimeline };
