'use strict';

// Electron smoke test: launches SOVA with a throwaway data folder, clicks
// through every section, runs a short timer-mode session with the widget,
// and fails on any renderer error. Run: xvfb-run -a npx electron test/smoke/electron-smoke.js

const path = require('path');
const os = require('os');
const fs = require('fs');
const { app, BrowserWindow } = require('electron');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sova-smoke-'));
app.setPath('userData', tmp);
fs.writeFileSync(path.join(tmp, 'sova-settings.json'), JSON.stringify({ consentVersion: 2, showWidget: true }));
const base = Date.parse('2026-11-06T09:00:00.000Z');
const at = (s) => new Date(base + s * 1000).toISOString();
fs.writeFileSync(path.join(tmp, 'sova-sessions.json'), JSON.stringify([{
  id: 's_demo', app: 'SOVA', version: 2, presetId: 'studying', presetName: 'Studying', mode: 'live',
  startedAt: at(0), endedAt: at(3000), focusSeconds: 2700, blocksCompleted: 2, blocksPlanned: 2,
  baseline: { reliable: true, breathing: { value: 13, reliable: true }, pulse: { value: 70, reliable: true }, hrv: { value: null, reliable: false } },
  events: [
    { type: 'session-start', at: at(0) }, { type: 'block-start', at: at(0), block: 1 },
    { type: 'sample', at: at(600), tense: true }, { type: 'sample', at: at(630), tense: true }, { type: 'sample', at: at(660), tense: false },
    { type: 'cue-tension', at: at(700) },
    { type: 'reset', at: at(720), seconds: 60, before: { breathing: 17, pulse: 80, hrv: null }, after: { breathing: 13, pulse: 74, hrv: null } },
    { type: 'meeting', at: at(900) }, { type: 'meeting-end', at: at(1200) },
    { type: 'break-start', at: at(1500), minutes: 5 }, { type: 'block-start', at: at(1800), block: 2 },
    { type: 'eye-rest', at: at(2400) }, { type: 'session-end', at: at(3000) },
  ],
  reflection: { tags: ['Calm'], note: 'Smoke test note' },
}]));

const errors = [];
app.on('web-contents-created', (_e, wc) => {
  wc.on('console-message', (event) => {
    const level = event.level !== undefined ? event.level : event;
    const message = event.message || '';
    if (level === 'error' || level === 3) errors.push(`${wc.getURL().split('/').pop()}: ${message}`);
  });
  wc.on('render-process-gone', (_e, d) => errors.push(`renderer gone: ${d.reason}`));
  wc.on('preload-error', (_e, p, err) => errors.push(`preload error ${p}: ${err.message}`));
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

require('../../src/main/main.js');

app.whenReady().then(async () => {
  await wait(2500);
  const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('index.html'));
  const run = (js) => win.webContents.executeJavaScript(js);
  const report = {};
  try {
    report.title = win.getTitle();
    for (const view of ['home', 'focus', 'recovery', 'insights', 'history', 'sounds', 'settings']) {
      await run(`document.querySelector('[data-nav="${view}"]').click()`);
      await wait(500);
      report[view] = (await run(`document.querySelector('#view h1') && document.querySelector('#view h1').textContent`)) || 'NO H1';
    }
    const shots = process.env.SOVA_SMOKE_SHOTS;
    const shot = async (w, name) => { if (shots) fs.writeFileSync(path.join(shots, name), (await w.webContents.capturePage()).toPNG()); };
    await run(`document.querySelector('[data-nav="insights"]').click()`);
    await wait(500);
    await shot(win, 'insights.png');
    await run(`document.querySelector('[data-nav="settings"]').click()`);
    await wait(500);
    await run(`document.querySelector('details').open = true; document.querySelector('details').scrollIntoView()`);
    await wait(300);
    await shot(win, 'settings.png');
    report.timeline = await run(`document.querySelector('[data-nav="insights"]').click(); new Promise(r => setTimeout(() => r(!!document.querySelector('#tl [role=img]')), 400))`);
    report.patterns = await run(`(document.body.innerText.match(/\\d of 7 sessions recorded/) || ['missing'])[0]`);
    report.beforeAfter = await run(`(document.body.innerText.match(/Not enough reliable resets yet \\(1 of 3\\)/) || ['missing'])[0]`);

    // Timer-mode session (no API key here): widget should open.
    await run(`document.querySelector('[data-nav="focus"]').click()`);
    await wait(300);
    await run(`document.getElementById('f-start').click()`);
    await wait(2500);
    report.session = await run(`document.querySelector('#view h1').textContent + ' | ' + (document.querySelector('.banner') ? document.querySelector('.banner').innerText : '')`);
    report.widgetOpen = BrowserWindow.getAllWindows().some((w) => w.webContents.getURL().includes('widget.html'));
    const widgetWin = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('widget.html'));
    if (widgetWin) await shot(widgetWin, 'widget.png');
    if (widgetWin) report.widgetClock = await widgetWin.webContents.executeJavaScript(`document.getElementById('clock').textContent + ' | ' + document.getElementById('sub').textContent`);

    // Reset overlay opens and closes.
    await run(`document.getElementById('reset').click()`);
    await wait(1200);
    report.resetOverlay = await run(`!document.getElementById('overlay').hidden && document.getElementById('r-phase').textContent`);
    await run(`document.getElementById('r-end').click()`);
    await wait(300);

    // End session -> reflection -> summary with timeline.
    await run(`document.getElementById('end').click()`);
    await wait(800);
    await run(`document.querySelector('[data-tag="Productive"]').click(); document.getElementById('note').value = 'smoke'; document.getElementById('save').click()`);
    await wait(800);
    report.summary = await run(`document.querySelector('#view h1').textContent + ' | timeline: ' + !!document.querySelector('#view [role=img]')`);
    report.widgetClosed = !BrowserWindow.getAllWindows().some((w) => w.webContents.getURL().includes('widget.html'));

    // Sounds play/stop.
    await run(`document.querySelector('[data-nav="sounds"]').click()`);
    await wait(300);
    await run(`document.getElementById('play').click()`);
    await wait(500);
    report.soundPlaying = await run(`document.getElementById('now').textContent`);
    await run(`document.getElementById('play').click()`);
  } catch (e) {
    errors.push(`harness: ${e.message}`);
  }
  console.log('SMOKE REPORT', JSON.stringify(report, null, 2));
  console.log('SMOKE ERRORS', JSON.stringify(errors, null, 2));
  app.exit(errors.length ? 1 : 0);
});
