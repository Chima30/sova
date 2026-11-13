'use strict';

// "What SOVA sees": a live readout of the values leaving the SmartSpectra
// pipeline. Built from shared/core/pipeline.js, so a value appears only when
// it passes the same checks the rest of SOVA uses.

const { esc } = require('./dom');
const { icon } = require('./icons');
const { pipelineRows } = require('../../shared/core/pipeline');

const fmt = (v) => (Math.round(v * 10) / 10).toString();

// The empty frame; update() fills it.
function seesPanel(id = 'sees') {
  return `<section class="panel sees" aria-labelledby="${id}-title">
    <div class="panel-head">
      <div class="stack-8"><h2 class="t-section" id="${id}-title">What SOVA sees</h2>
        <span class="t-small">${icon('shield-check', 14)} Computed on this computer by the SmartSpectra SDK. No video is recorded, saved or sent.</span></div>
      <span class="t-meta" id="${id}-meta">Waiting for the SDK</span>
    </div>
    <div class="sees-flow" aria-hidden="true"><span>Camera frames</span>${icon('chevron-right', 14)}<span>SmartSpectra SDK, on this computer</span>${icon('chevron-right', 14)}<span>Signal checks</span>${icon('chevron-right', 14)}<span>SOVA</span></div>
    <div class="table-wrap"><table class="table sees-table" id="${id}-table">
      <thead><tr><th scope="col">Signal</th><th scope="col">SDK field</th><th scope="col">Value</th><th scope="col">Confidence</th><th scope="col">SOVA</th></tr></thead>
      <tbody></tbody>
    </table></div>
  </section>`;
}

// reading: last extractLatest() result; elapsed: measurement seconds when it
// arrived; ageSeconds: how long ago; count: SDK updates so far;
// validation: { ok, tip } from the SDK's validation status.
function updateSees({ id = 'sees', reading, elapsed, ageSeconds, count, validation, signalsCfg }) {
  const table = document.getElementById(`${id}-table`);
  if (!table) return;
  const { vitals, face, stale } = pipelineRows(reading, elapsed || 0, signalsCfg, ageSeconds || 0);
  const dot = (state) => `<span class="dot ${state === 'used' ? 'live' : state === 'held' ? 'warn' : 'off'}"></span>`;
  const rows = vitals.map((v) => `<tr>
      <td>${esc(v.label)}</td>
      <td><code>${esc(v.field)}</code></td>
      <td class="num">${v.value != null ? `<strong>${esc(fmt(v.value))}</strong> <span class="t-2">${esc(v.unit)}</span>` : '<span class="t-2">Not shown</span>'}</td>
      <td class="num">${v.confidence != null ? esc(v.confidence) : '<span class="t-2">–</span>'}</td>
      <td><span class="status">${dot(v.state)}${esc(v.state === 'used' ? 'Used' : `Held back: ${v.reasonText}`)}</span></td>
    </tr>`)
    .concat(face.map((f) => `<tr>
      <td>${esc(f.label)}</td>
      <td><code>${esc(f.field)}</code></td>
      <td>${f.state === 'used' ? esc(f.text) : '<span class="t-2">–</span>'}</td>
      <td><span class="t-2">–</span></td>
      <td><span class="status">${dot(f.state)}${esc(f.state === 'used' ? 'Used' : f.text)}</span></td>
    </tr>`))
    .concat(`<tr>
      <td>Signal quality</td>
      <td><code>validationStatus</code></td>
      <td colspan="2">${validation ? esc(validation.tip) : '<span class="t-2">Waiting</span>'}</td>
      <td><span class="status">${dot(validation ? (validation.ok ? 'used' : 'held') : 'waiting')}${validation ? (validation.ok ? 'Good' : 'Needs attention') : 'Waiting'}</span></td>
    </tr>`);
  table.querySelector('tbody').innerHTML = rows.join('');
  const meta = document.getElementById(`${id}-meta`);
  if (meta) {
    meta.textContent = !count ? 'Waiting for the SDK'
      : stale ? `${count} updates · no recent update`
        : `${count} update${count === 1 ? '' : 's'} · last ${ageSeconds < 1 ? 'under 1' : Math.round(ageSeconds)} s ago`;
  }
}

module.exports = { seesPanel, updateSees };
