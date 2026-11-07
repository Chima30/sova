'use strict';

// Focus timeline replay: focus and break bands, stretches (tense, away,
// meeting, paused) and markers (cues, resets, eye rests), plus a readable
// list for screen readers and keyboard users.

const { esc } = require('./dom');
const { buildTimeline } = require('../../shared/core/insights');

const STRETCH_STYLE = {
  tense: { color: '#E6B980', label: 'Tense stretch' },
  away: { color: '#5A6884', label: 'Away' },
  meeting: { color: '#46557A', label: 'Meeting' },
  paused: { color: '#3A4660', label: 'Paused' },
};
const MARKER_COLOR = {
  'cue-tension': '#E6B980',
  'cue-eye-rest': '#C5CEDD',
  reset: '#7FA6E8',
  'eye-rest': '#A9C4F0',
  'flow-snooze': '#9AA6BC',
  'break-skipped': '#9AA6BC',
  recalibrate: '#9AA6BC',
};

function clockAt(session, offsetSec) {
  return new Date(Date.parse(session.startedAt) + offsetSec * 1000)
    .toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function pct(v, total) { return `${Math.max(0, Math.min(100, (v / total) * 100)).toFixed(3)}%`; }

function renderTimeline(session) {
  const tl = buildTimeline(session);
  const T = tl.total;
  const kinds = new Set(tl.stretches.map((s) => s.kind));

  const bands = tl.segments.map((s) =>
    `<div title="${s.kind === 'focus' ? `Focus block ${s.block || ''}` : 'Break'}" style="position: absolute; top: 0; bottom: 0; left: ${pct(s.from, T)}; width: ${pct(s.to - s.from, T)}; background: ${s.kind === 'focus' ? '#7FA6E8' : '#2A3650'}; border-right: 2px solid #121A2B"></div>`).join('');

  const stretches = tl.stretches.map((s) =>
    `<div title="${esc(STRETCH_STYLE[s.kind].label)}" style="position: absolute; top: 0; bottom: 0; left: ${pct(s.from, T)}; width: max(3px, ${pct(s.to - s.from, T)}); background: ${STRETCH_STYLE[s.kind].color}; border-radius: 3px"></div>`).join('');

  const markers = tl.markers.map((m) =>
    `<div title="${esc(m.label)} at ${esc(clockAt(session, m.at))}" style="position: absolute; top: 2px; left: calc(${pct(m.at, T)} - 6px); width: 12px; height: 12px; border-radius: 50%; background: ${MARKER_COLOR[m.kind] || '#9AA6BC'}; border: 2px solid #121A2B"></div>`).join('');

  const list = tl.markers.length
    ? `<ul class="list" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 8px; font-size: 14px">
        ${tl.markers.map((m) => `<li><span style="width: 10px; height: 10px; border-radius: 50%; background: ${MARKER_COLOR[m.kind] || '#9AA6BC'}; margin-top: 5px; flex: none"></span><span><span class="small">${esc(clockAt(session, m.at))}</span> ${esc(m.label)}</span></li>`).join('')}
      </ul>`
    : '<p class="small" style="margin: 0">No cues, resets or eye rests in this session.</p>';

  const legend = [
    '<span><span style="display: inline-block; width: 14px; height: 10px; border-radius: 3px; background: #7FA6E8"></span> Focus</span>',
    '<span><span style="display: inline-block; width: 14px; height: 10px; border-radius: 3px; background: #2A3650; border: 1px solid #33415C"></span> Break</span>',
    ...[...kinds].map((k) => `<span><span style="display: inline-block; width: 14px; height: 10px; border-radius: 3px; background: ${STRETCH_STYLE[k].color}"></span> ${esc(STRETCH_STYLE[k].label)}</span>`),
  ].join('');

  const hasSamples = (session.events || []).some((e) => e.type === 'sample');

  return `
    <div class="stack" style="gap: 10px">
      <div style="position: relative; height: 34px; border-radius: 8px; overflow: hidden; background: #18223A" role="img" aria-label="Focus and break blocks">${bands}</div>
      ${tl.stretches.length ? `<div style="position: relative; height: 10px" role="img" aria-label="Tense, away, meeting and paused stretches">${stretches}</div>` : ''}
      <div style="position: relative; height: 16px" aria-hidden="true">${markers}</div>
      <div class="row small" style="justify-content: space-between"><span>${esc(clockAt(session, 0))}</span><span>${esc(clockAt(session, T))}</span></div>
      <div class="legend" style="justify-content: flex-start; font-size: 13px">${legend}</div>
      ${session.mode === 'live' && !hasSamples ? '<p class="small" style="margin: 0">Tense stretches appear only when a reliable baseline was set during the session.</p>' : ''}
      ${list}
    </div>`;
}

module.exports = { renderTimeline };
