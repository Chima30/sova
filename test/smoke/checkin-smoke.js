'use strict';

// Check-in start path with a test key: prep screen, then Start. Without a
// real key or network the SDK refuses, and the check-in must end cleanly with
// the camera released. Run: SOVA_PRESAGE_API_KEY=x xvfb-run -a npx electron test/smoke/checkin-smoke.js

const path = require('path');
const os = require('os');
const fs = require('fs');
const { app, BrowserWindow } = require('electron');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sova-ci-'));
app.setPath('userData', tmp);
fs.writeFileSync(path.join(tmp, 'sova-settings.json'), JSON.stringify({ consentVersion: 3, onboarded: true, profileName: 'John', appearance: process.env.SOVA_SMOKE_THEME || 'light' }));
if (!process.env.SOVA_PRESAGE_API_KEY) process.env.SOVA_PRESAGE_API_KEY = 'test-key';

const errors = [];
app.on('web-contents-created', (_e, wc) => {
  wc.on('console-message', (_ev, level, message) => { if (level >= 3 && !/SDK error|start failed|SmartSpectra/.test(message)) errors.push(message); });
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
require('../../src/main/main.js');

app.whenReady().then(async () => {
  await wait(2500);
  const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('index.html'));
  win.setSize(1440, 900);
  const run = (js) => win.webContents.executeJavaScript(js);
  const shots = process.env.SOVA_SMOKE_SHOTS;
  const shot = async (name) => { if (shots) fs.writeFileSync(path.join(shots, name), (await win.webContents.capturePage()).toPNG()); };
  const report = {};
  try {
    await run(`document.getElementById('h-check').click()`);
    await wait(1500);
    report.prep = await run(`document.querySelector('#view h1').textContent + ' | topbar: ' + document.getElementById('tb-status').innerText`);
    await shot('checkin-prep.png');
    // Double click: the machine accepts the first START only.
    await run(`const b = document.getElementById('ci-start'); b.disabled = false; b.click(); const b2 = document.getElementById('ci-start'); if (b2) b2.click()`);
    await wait(1200);
    report.measuring = await run(`document.querySelector('#view h1').textContent + ' | ' + (document.getElementById('ci-signals') || {}).innerText`);
    await shot('checkin-measuring.png');
    await wait(9000);
    report.machine = await run(`window.sovaState().checkIn`);
    report.after = await run(`document.querySelector('#view h1').textContent + ' | ' + (document.querySelector('#view .t-body') || {}).textContent`);
    await shot('checkin-after.png');
    await run(`(document.getElementById('ci-back') || document.querySelector('[data-nav="home"]')).click()`);
    await wait(800);
    report.home = await run(`document.querySelector('#view h1').textContent + ' | topbar: ' + document.getElementById('tb-status').innerText`);
  } catch (e) { errors.push(`harness: ${e.message}`); }
  console.log('CHECKIN REPORT', JSON.stringify(report, null, 2));
  console.log('CHECKIN ERRORS', JSON.stringify(errors, null, 2));
  app.exit(errors.length ? 1 : 0);
});
