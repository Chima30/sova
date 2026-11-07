'use strict';

// Gentle generated sounds: breathing pacing tones (eyes-closed resets) and
// a soft chime for eye rests. No audio files, works offline.

let ctx = null;
function ac() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  return ctx;
}

function tone(freqFrom, freqTo, seconds, volume = 0.05) {
  try {
    const a = ac();
    const osc = a.createOscillator();
    const gain = a.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freqFrom, a.currentTime);
    osc.frequency.linearRampToValueAtTime(freqTo, a.currentTime + seconds);
    gain.gain.setValueAtTime(0, a.currentTime);
    gain.gain.linearRampToValueAtTime(volume, a.currentTime + 0.4);
    gain.gain.linearRampToValueAtTime(0, a.currentTime + seconds);
    osc.connect(gain).connect(a.destination);
    osc.start();
    osc.stop(a.currentTime + seconds + 0.05);
  } catch { /* audio unavailable: guidance stays visual */ }
}

// Rising tone while breathing in, falling while breathing out.
function pace(phase, seconds) {
  if (phase === 'inhale') tone(220, 330, seconds);
  else if (phase === 'exhale') tone(330, 200, seconds);
}

function chime() {
  tone(660, 660, 0.6, 0.06);
  setTimeout(() => tone(880, 880, 0.8, 0.05), 250);
}

// ---- Ambient focus sounds (generated, offline) -------------------------------

function noiseBuffer(a, kind) {
  const len = a.sampleRate * 3;
  const buf = a.createBuffer(1, len, a.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0, b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    if (kind === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
    else if (kind === 'pink') { b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0527; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.11; }
    else d[i] = w * 0.5;
  }
  return buf;
}

// Gains below were set by measuring each sound's output level (RMS) in
// Chromium's audio engine: about -18 dBFS at full volume for every sound.
const LEVEL = { rain: 0.97, forest: 0.63, noise: 0.63, ambient: 0.085 };

// Build one ambient sound into `dest` on context `a`. Returns nodes to stop
// and a function that schedules extra events (forest birds).
function buildAmbient(a, dest, kind, keep) {
  const loop = (type) => { const src = keep(a.createBufferSource()); src.buffer = noiseBuffer(a, type); src.loop = true; src.start(); return src; };
  const lfo = (param, rate, depth, base) => {
    param.value = base;
    const o = keep(a.createOscillator()); const g = keep(a.createGain());
    o.frequency.value = rate; g.gain.value = depth;
    o.connect(g).connect(param); o.start();
  };
  const out = keep(a.createGain());
  out.gain.value = LEVEL[kind] || 1;
  out.connect(dest);

  if (kind === 'rain') {
    const src = loop('pink');
    const hp = keep(a.createBiquadFilter()); hp.type = 'highpass'; hp.frequency.value = 400;
    const lp = keep(a.createBiquadFilter()); lp.type = 'lowpass'; lp.frequency.value = 7000;
    const g = keep(a.createGain());
    lfo(g.gain, 0.08, 0.12, 0.85);
    src.connect(hp).connect(lp).connect(g).connect(out);
  } else if (kind === 'forest') {
    const src = loop('brown');
    const lp = keep(a.createBiquadFilter()); lp.type = 'lowpass';
    lfo(lp.frequency, 0.05, 250, 700);
    src.connect(lp).connect(out);
  } else if (kind === 'noise') {
    const src = loop('brown');
    const lp = keep(a.createBiquadFilter()); lp.type = 'lowpass'; lp.frequency.value = 900;
    src.connect(lp).connect(out);
  } else {
    const lp = keep(a.createBiquadFilter()); lp.type = 'lowpass';
    lfo(lp.frequency, 0.03, 300, 700);
    for (const f of [110, 110.6, 164.8, 220.4]) {
      const o = keep(a.createOscillator()); o.type = 'sine'; o.frequency.value = f; o.connect(lp); o.start();
    }
    lp.connect(out);
  }
  return out;
}

const ambient = {
  nodes: [],
  timers: [],
  master: null,
  current: null,

  async start(kind, volume = 0.4) {
    this.stop();
    const a = ac();
    if (a.state !== 'running') { try { await a.resume(); } catch { /* ignore */ } }
    const master = a.createGain();
    master.gain.setValueAtTime(0, a.currentTime);
    master.gain.linearRampToValueAtTime(volume, a.currentTime + 1.5);
    master.connect(a.destination);
    this.master = master;
    this.current = kind;
    const out = buildAmbient(a, master, kind, (n) => { this.nodes.push(n); return n; });
    console.info('[SOVA] ambient sound', kind, 'context', a.state, 'volume', volume);

    if (kind === 'forest') {
      const chirp = () => {
        if (this.master !== master) return;
        const o = a.createOscillator(); const cg = a.createGain();
        const f = 2400 + Math.random() * 1600; const t = a.currentTime;
        o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 1.25, t + 0.12);
        cg.gain.setValueAtTime(0, t); cg.gain.linearRampToValueAtTime(0.05, t + 0.03); cg.gain.linearRampToValueAtTime(0, t + 0.16);
        o.connect(cg).connect(master); o.start(t); o.stop(t + 0.2);
        this.timers.push(setTimeout(chirp, 3000 + Math.random() * 6000));
      };
      this.timers.push(setTimeout(chirp, 2500));
    }
    return out;
  },

  setVolume(v) {
    if (this.master) this.master.gain.setTargetAtTime(v, ac().currentTime, 0.2);
  },

  stop() {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    const nodes = this.nodes;
    const master = this.master;
    this.nodes = [];
    this.master = null;
    this.current = null;
    if (master) {
      const a = ac();
      master.gain.setTargetAtTime(0, a.currentTime, 0.3);
      setTimeout(() => {
        for (const n of nodes) { try { if (n.stop) n.stop(); n.disconnect(); } catch { /* ignore */ } }
        try { master.disconnect(); } catch { /* ignore */ }
      }, 1500);
    }
  },
};

module.exports = { pace, chime, ambient, buildAmbient, noiseBuffer };
