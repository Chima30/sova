'use strict';

// The breath orb: SOVA's centrepiece. A glossy glass sphere with breath
// lines inside it.
//
//  live   orange; its size follows the real breathing waveform and soft rings
//         leave it at the measured pulse rate
//  guide  lavender; its size follows the breathing guide
//  idle   pale glass, still size: nothing is measured or guided
//
// Like the breath lines, the orb never invents a breath. Without a level it
// stays idle, and pulse rings appear only while a usable pulse is passed in.

const FALLBACK = { live: [242, 92, 38], guide: [150, 132, 232], idle: [176, 172, 196] };

function themeColours(el) {
  const cs = getComputedStyle(el);
  const read = (name, fb) => {
    const v = cs.getPropertyValue(name).split(',').map((x) => Number(x.trim()));
    return v.length === 3 && v.every(Number.isFinite) ? v : fb;
  };
  return {
    live: read('--orb-live', FALLBACK.live),
    guide: read('--orb-guide', FALLBACK.guide),
    idle: read('--orb-idle', FALLBACK.idle),
    dark: document.documentElement.dataset.theme === 'dark',
  };
}

const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const rgba = (c, a) => `rgba(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])}, ${a})`;
const WHITE = [255, 255, 255];
const BLACK = [10, 6, 20];

class BreathOrb {
  constructor(canvas, { reduced = false, size = 0.34 } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.reduced = reduced;
    this.size = size;          // orb radius as a share of the canvas' short side
    this.live = null;
    this.guide = null;
    this.pulse = null;         // beats per minute, only while usable
    this.levelNow = 0.35;
    this.mode = 'idle';
    this.colour = null;        // current colour, eased between modes
    this.drift = 0;
    this.beatClock = 0;
    this.rings = [];
    this.tilt = [0, 0];
    this.tiltNow = [0, 0];
    this.born = performance.now();
    this.running = false;
    this.raf = 0;
    this.last = 0;
    this.onMove = (e) => {
      const r = this.canvas.getBoundingClientRect();
      this.tilt = [((e.clientX - r.left) / r.width - 0.5) * 2, ((e.clientY - r.top) / r.height - 0.5) * 2];
    };
    this.onLeave = () => { this.tilt = [0, 0]; };
  }

  setLive(level) { this.live = level == null ? null : Math.max(0, Math.min(1, level)); }
  setGuide(level) { this.guide = level == null ? null : Math.max(0, Math.min(1, level)); }
  setPulse(bpm) { this.pulse = Number.isFinite(bpm) && bpm > 0 ? bpm : null; }
  setReduced(on) { this.reduced = !!on; }

  start() {
    if (this.running) return;
    this.running = true;
    window.addEventListener('pointermove', this.onMove);
    document.addEventListener('pointerleave', this.onLeave);
    const loop = (ts) => {
      if (!this.running) return;
      if (this.reduced && ts - this.last < 250) { this.raf = requestAnimationFrame(loop); return; }
      const dt = this.last ? Math.min(0.1, (ts - this.last) / 1000) : 0;
      this.last = ts;
      this.step(dt);
      this.draw();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('pointermove', this.onMove);
    document.removeEventListener('pointerleave', this.onLeave);
  }

  target() {
    if (this.live != null) return { mode: 'live', level: this.live };
    if (this.guide != null) return { mode: 'guide', level: this.guide };
    return { mode: 'idle', level: 0.35 };
  }

  step(dt) {
    const t = this.target();
    this.mode = t.mode;
    const k = this.reduced ? 1 : Math.min(1, dt * 4);
    this.levelNow += (t.level - this.levelNow) * k;
    if (!this.reduced) {
      // Light drifts through the glass; the breath lines inside move only
      // while something is measured or guided.
      this.drift += dt * (t.mode === 'idle' ? 0.05 : 0.4);
      const tk = Math.min(1, dt * 3);
      this.tiltNow = [this.tiltNow[0] + (this.tilt[0] - this.tiltNow[0]) * tk, this.tiltNow[1] + (this.tilt[1] - this.tiltNow[1]) * tk];
    }
    // Pulse rings at the measured rate, live mode only.
    if (t.mode === 'live' && this.pulse && !this.reduced) {
      this.beatClock += dt;
      const period = 60 / this.pulse;
      if (this.beatClock >= period) { this.beatClock %= period; this.rings.push({ age: 0 }); }
    } else {
      this.beatClock = 0;
    }
    for (const r of this.rings) r.age += dt;
    this.rings = this.rings.filter((r) => r.age < 1.6);
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    return { w, h, dpr };
  }

  draw() {
    const { w, h, dpr } = this.resize();
    const ctx = this.ctx;
    ctx.clearRect(0, 0, w, h);
    const now = performance.now();
    if (!this.theme || now - (this.themeAt || 0) > 500) { this.theme = themeColours(this.canvas); this.themeAt = now; }
    const goal = this.theme[this.mode];
    this.colour = !this.colour || this.reduced ? goal.slice() : mix(this.colour, goal, 0.06);
    const C = this.colour;
    const dark = this.theme.dark;

    // A soft entrance the first time the orb appears.
    const intro = this.reduced ? 1 : Math.min(1, (now - this.born) / 900);
    const ease = 1 - Math.pow(1 - intro, 3);

    const cx = w / 2;
    const cy = h * 0.47;
    const base = Math.min(w, h) * this.size;
    const breath = this.mode === 'idle' ? 0.94 : 0.84 + 0.2 * this.levelNow;
    const R = base * breath * (0.82 + 0.18 * ease);
    ctx.globalAlpha = ease;

    // Halo
    // Keep the glow inside the canvas so it never shows a hard edge.
    const haloR = Math.max(R * 1.05, Math.min(R * 1.9, cx, cy, w - cx, h - cy));
    const halo = ctx.createRadialGradient(cx, cy, R * 0.6, cx, cy, haloR);
    halo.addColorStop(0, rgba(C, (this.mode === 'idle' ? 0.10 : 0.22 + 0.16 * this.levelNow) * (dark ? 1.2 : 1)));
    halo.addColorStop(1, rgba(C, 0));
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, w, h);

    // Pulse rings
    for (const r of this.rings) {
      const p = r.age / 1.6;
      ctx.beginPath();
      ctx.arc(cx, cy, R * (1.02 + 0.55 * (1 - Math.pow(1 - p, 2))), 0, Math.PI * 2);
      ctx.strokeStyle = rgba(C, 0.45 * (1 - p));
      ctx.lineWidth = (2.2 - 1.4 * p) * dpr;
      ctx.stroke();
    }

    // Ground shadow
    ctx.save();
    ctx.translate(cx, cy + R * 1.12);
    ctx.scale(1, 0.16);
    const sh = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 0.95);
    sh.addColorStop(0, rgba(dark ? BLACK : mix(C, BLACK, 0.55), dark ? 0.55 : 0.22));
    sh.addColorStop(1, rgba(BLACK, 0));
    ctx.fillStyle = sh;
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.95, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Body: lit from the top left, the light follows the pointer a little.
    const lx = cx - R * (0.38 - 0.12 * this.tiltNow[0]);
    const ly = cy - R * (0.42 - 0.10 * this.tiltNow[1]);
    const body = ctx.createRadialGradient(lx, ly, R * 0.05, cx, cy, R);
    body.addColorStop(0, rgba(mix(C, WHITE, 0.78), 1));
    body.addColorStop(0.38, rgba(mix(C, WHITE, 0.22), 1));
    body.addColorStop(0.78, rgba(C, 1));
    body.addColorStop(1, rgba(mix(C, BLACK, 0.32), 1));
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fillStyle = body;
    ctx.fill();

    // Breath lines inside the glass
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.985, 0, Math.PI * 2);
    ctx.clip();
    const lines = 11;
    const segs = 64;
    const amp = R * (this.mode === 'idle' ? 0.05 : 0.08 + 0.16 * this.levelNow);
    for (let i = 0; i < lines; i++) {
      const u = i / (lines - 1);
      const yBase = cy - R * 0.7 + u * R * 1.4;
      ctx.beginPath();
      for (let s = 0; s <= segs; s++) {
        const x = s / segs;
        const env = Math.sin(Math.PI * x);
        const y = yBase - amp * env * (0.6 * Math.sin(2 * Math.PI * (x * 1.2 + 0.3 * u) + this.drift)
          + 0.4 * Math.sin(2 * Math.PI * (x * 2.1 - 0.5 * u) - this.drift * 0.7));
        const px = cx - R + x * 2 * R;
        if (s === 0) ctx.moveTo(px, y); else ctx.lineTo(px, y);
      }
      const centre = 1 - Math.abs(u - 0.5) * 2;
      ctx.strokeStyle = rgba(WHITE, 0.08 + 0.26 * centre);
      ctx.lineWidth = dpr * (centre > 0.85 ? 1.4 : 1);
      ctx.stroke();
    }
    // Inner shade at the bottom for depth
    const shade = ctx.createLinearGradient(0, cy, 0, cy + R);
    shade.addColorStop(0, rgba(BLACK, 0));
    shade.addColorStop(1, rgba(mix(C, BLACK, 0.6), 0.32));
    ctx.fillStyle = shade;
    ctx.fillRect(cx - R, cy, R * 2, R);
    ctx.restore();

    // Rim light
    const rim = ctx.createLinearGradient(cx, cy - R, cx, cy + R);
    rim.addColorStop(0, rgba(WHITE, 0.75));
    rim.addColorStop(0.5, rgba(WHITE, 0.08));
    rim.addColorStop(1, rgba(mix(C, WHITE, 0.5), 0.5));
    ctx.beginPath();
    ctx.arc(cx, cy, R - dpr * 0.75, 0, Math.PI * 2);
    ctx.strokeStyle = rim;
    ctx.lineWidth = dpr * 1.5;
    ctx.stroke();

    // Specular highlight
    ctx.save();
    ctx.translate(lx + R * 0.04, ly - R * 0.02);
    ctx.rotate(-0.6);
    ctx.scale(1, 0.62);
    const spec = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 0.34);
    spec.addColorStop(0, rgba(WHITE, 0.9));
    spec.addColorStop(1, rgba(WHITE, 0));
    ctx.fillStyle = spec;
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.34, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Bounce light on the lower right edge
    const bounce = ctx.createRadialGradient(cx + R * 0.55, cy + R * 0.6, 0, cx + R * 0.55, cy + R * 0.6, R * 0.5);
    bounce.addColorStop(0, rgba(mix(C, WHITE, 0.6), 0.35));
    bounce.addColorStop(1, rgba(WHITE, 0));
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = bounce;
    ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
    ctx.restore();

    ctx.globalAlpha = 1;
    if (this.reduced && intro < 1) this.born = now - 900;
  }
}

module.exports = { BreathOrb };
