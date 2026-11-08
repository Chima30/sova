'use strict';

// SOVA's breath lines: a ribbon of contour lines that taper at both ends.
//
//  live   orange lines whose height follows the real breathing waveform
//  guide  lavender lines that follow the breathing guide (resets, previews)
//  idle   still, grey and low: there is no reliable reading to show
//
// The ribbon never invents a breath. Without a level it falls back to idle.

// Fallbacks; the real colours come from the theme (--line-live and friends).
const FALLBACK = { live: [111, 216, 198], guide: [185, 170, 242], idle: [150, 144, 190] };

function themeColours(el) {
  const cs = getComputedStyle(el);
  const read = (name, fb) => {
    const v = cs.getPropertyValue(name).split(',').map((x) => Number(x.trim()));
    return v.length === 3 && v.every(Number.isFinite) ? v : fb;
  };
  return { live: read('--line-live', FALLBACK.live), guide: read('--line-guide', FALLBACK.guide), idle: read('--line-idle', FALLBACK.idle) };
}

function rgba(c, a) { return `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`; }

class BreathLines {
  constructor(canvas, { lines = 26, reduced = false } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.lines = lines;
    this.reduced = reduced;
    this.live = null;       // target level 0..1, or null
    this.guide = null;
    this.liveNow = 0;       // smoothed levels
    this.guideNow = 0;
    this.drift = 0;
    this.raf = 0;
    this.last = 0;
    this.running = false;
  }

  setLive(level) { this.live = level == null ? null : Math.max(0, Math.min(1, level)); }
  setGuide(level) { this.guide = level == null ? null : Math.max(0, Math.min(1, level)); }
  setReduced(on) { this.reduced = !!on; }

  start() {
    if (this.running) return;
    this.running = true;
    const loop = (ts) => {
      if (!this.running) return;
      const dt = this.last ? Math.min(0.1, (ts - this.last) / 1000) : 0;
      // Reduced motion: no drift, a few calm redraws a second.
      if (this.reduced && ts - this.last < 250) { this.raf = requestAnimationFrame(loop); return; }
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
  }

  step(dt) {
    const k = this.reduced ? 1 : Math.min(1, dt * 5);
    this.liveNow += ((this.live == null ? 0 : this.live) - this.liveNow) * k;
    this.guideNow += ((this.guide == null ? 0 : this.guide) - this.guideNow) * k;
    const moving = this.live != null || this.guide != null;
    if (!this.reduced && moving) this.drift += dt * 0.35;
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    return { w, h, dpr };
  }

  // One set of contour lines around the centre line.
  ribbon(w, h, dpr, level, color, count, alphaLo, alphaHi, phaseShift) {
    const ctx = this.ctx;
    const cy = h / 2;
    const maxAmp = h * 0.42;
    const amp = maxAmp * (0.10 + 0.90 * level);
    const segs = Math.max(80, Math.round(w / (6 * dpr)));
    const d = this.drift + phaseShift;
    for (let i = 0; i < count; i++) {
      const u = count === 1 ? 0.5 : i / (count - 1);
      const centre = 1 - Math.abs(u - 0.5) * 2;           // 1 in the middle of the bundle
      ctx.beginPath();
      for (let s = 0; s <= segs; s++) {
        const x = s / segs;
        const env = Math.pow(Math.sin(Math.PI * x), 1.7);
        const shape = 0.55 * Math.sin(2 * Math.PI * (x * 1.1 + 0.32 * u) + d)
          + 0.30 * Math.sin(2 * Math.PI * (x * 2.3 - 0.58 * u) - d * 0.8)
          + 0.15 * Math.sin(2 * Math.PI * (x * 4.1 + 0.95 * u) + d * 1.4);
        const spread = 0.45 + 0.75 * Math.sin(Math.PI * (0.15 + 0.7 * u));
        const y = cy - amp * env * shape * spread;
        const px = x * w;
        if (s === 0) ctx.moveTo(px, y); else ctx.lineTo(px, y);
      }
      ctx.strokeStyle = rgba(color, alphaLo + (alphaHi - alphaLo) * centre * centre);
      ctx.lineWidth = (centre > 0.96 ? 1.6 : 1) * dpr;
      ctx.stroke();
    }
  }

  // A soft, warm glow under the live ribbon, stronger as the breath rises.
  glow(w, h, color, level) {
    const ctx = this.ctx;
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.5);
    g.addColorStop(0, rgba(color, 0.10 + 0.12 * level));
    g.addColorStop(1, rgba(color, 0));
    ctx.save();
    ctx.translate(0, h / 2);
    ctx.scale(1, 0.45);
    ctx.translate(0, -h / 2);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  draw() {
    const { w, h, dpr } = this.resize();
    const ctx = this.ctx;
    ctx.clearRect(0, 0, w, h);
    const now = performance.now();
    if (!this.colours || now - (this.coloursAt || 0) > 500) { this.colours = themeColours(this.canvas); this.coloursAt = now; }
    const { live: LIVE, guide: LAVENDER, idle: GREY } = this.colours;
    const hasLive = this.live != null;
    const hasGuide = this.guide != null;
    if (!hasLive && !hasGuide) {
      // Idle: still, low and grey. Nothing is being measured or guided.
      this.ribbon(w, h, dpr, 0, GREY, Math.round(this.lines * 0.6), 0.10, 0.32, 0);
      return;
    }
    if (hasGuide) this.ribbon(w, h, dpr, this.guideNow, LAVENDER, hasLive ? Math.round(this.lines * 0.5) : this.lines, 0.06, hasLive ? 0.35 : 0.7, 0.9);
    if (hasLive) {
      this.glow(w, h, LIVE, this.liveNow);
      this.ribbon(w, h, dpr, this.liveNow, LIVE, this.lines, 0.08, 0.9, 0);
    }
  }
}

// Normalised level (0..1) of the newest point in a breathing waveform window.
function levelFromTrace(points) {
  if (!points || points.length < 4) return null;
  let min = Infinity, max = -Infinity;
  for (const p of points) { min = Math.min(min, p.value); max = Math.max(max, p.value); }
  if (max - min <= 0) return null;
  return (points[points.length - 1].value - min) / (max - min);
}

// The SOVA mark: three contour lines in a ring, as inline SVG.
function mark(size = 22) {
  return `<svg class="mark" width="${size}" height="${size}" viewBox="0 0 32 32" fill="none" aria-hidden="true">
    <circle cx="16" cy="16" r="14" stroke="currentColor" stroke-width="1.5" opacity="0.55"/>
    <path d="M4.5 16.5c3.5-6 7.5-6 11.5 0s8 6 11.5 0" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
    <path d="M6 16c3.2-3.8 6.8-3.8 10 0s6.8 3.8 10 0" stroke="currentColor" stroke-width="1" stroke-linecap="round" opacity="0.5"/>
  </svg>`;
}

module.exports = { BreathLines, levelFromTrace, mark };
