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

module.exports = { pace, chime };
