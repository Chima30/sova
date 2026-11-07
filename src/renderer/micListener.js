'use strict';

// Microphone listener for breath sounds. The audio is turned into one
// loudness number (dB, 250 to 3000 Hz band) every 20 ms and handed to the
// detector. No audio is recorded, stored or sent anywhere.

const { BreathSoundDetector } = require('../../shared/core/breathSound');

async function startMic(clock) {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: false,
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
  });
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state !== 'running') { try { await ctx.resume(); } catch { /* ignore */ } }
  const src = ctx.createMediaStreamSource(stream);
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 250;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3000;
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  src.connect(hp).connect(lp).connect(analyser);   // never connected to the speakers

  const detector = new BreathSoundDetector();
  const buf = new Float32Array(analyser.fftSize);
  const state = { level: -100, detector, stopped: false };
  const timer = setInterval(() => {
    analyser.getFloatTimeDomainData(buf);
    let s = 0;
    for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
    const db = 20 * Math.log10(Math.sqrt(s / buf.length) + 1e-9);
    state.level = db;
    detector.push(clock(), db);
  }, 20);

  state.stop = () => {
    if (state.stopped) return;
    state.stopped = true;
    clearInterval(timer);
    for (const t of stream.getTracks()) t.stop();
    try { ctx.close(); } catch { /* ignore */ }
  };
  return state;
}

module.exports = { startMic };
