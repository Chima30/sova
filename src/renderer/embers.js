'use strict';

// Rising embers: soft orange and lavender motes drifting up behind every page.
// Purely decorative: they show no data. About 30 frames a second from
// pre-drawn sprites; one still frame with reduced motion; paused while the
// window is hidden.

const COUNT = 70;
const FPS = 30;

function sprite(rgb, radius) {
  const c = document.createElement('canvas');
  const size = Math.ceil(radius * 8);
  c.width = c.height = size;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, `rgba(${rgb}, 1)`);
  g.addColorStop(0.25, `rgba(${rgb}, 0.55)`);
  g.addColorStop(1, `rgba(${rgb}, 0)`);
  x.fillStyle = g;
  x.fillRect(0, 0, size, size);
  return c;
}

function startEmbers({ reduced }) {
  const canvas = document.createElement('canvas');
  canvas.className = 'embers';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.prepend(canvas);
  const ctx = canvas.getContext('2d');

  let seed = 11;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const motes = Array.from({ length: COUNT }, () => ({
    x: rnd(), y: rnd(), r: 1 + rnd() * 2.4, speed: 0.012 + rnd() * 0.03,
    sway: 6 + rnd() * 16, phase: rnd() * Math.PI * 2, lav: rnd() < 0.35,
  }));

  let sprites = null;
  let themeKey = '';
  let w = 0, h = 0, dpr = 1;
  const readTheme = () => {
    const cs = getComputedStyle(document.documentElement);
    const live = cs.getPropertyValue('--line-live').trim() || '255, 116, 66';
    const guide = cs.getPropertyValue('--line-guide').trim() || '180, 166, 245';
    const key = `${live}|${guide}|${document.documentElement.dataset.theme}`;
    if (key === themeKey) return;
    themeKey = key;
    sprites = { live: sprite(live, 4), guide: sprite(guide, 4) };
  };
  const resize = () => {
    dpr = window.devicePixelRatio || 1;
    w = window.innerWidth; h = window.innerHeight;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  };

  const draw = (t) => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const light = document.documentElement.dataset.theme === 'light';
    for (const m of motes) {
      const y = ((m.y - t * m.speed) % 1 + 1) % 1;
      const x = m.x * w + Math.sin(t * 0.6 + m.phase) * m.sway;
      // Fade in near the bottom and out near the top, with a slow twinkle.
      const edge = Math.min(1, y / 0.12, (1 - y) / 0.2);
      const a = Math.max(0, edge) * (0.45 + 0.35 * Math.sin(t * 1.3 + m.phase)) * (light ? 0.7 : 1);
      const s = m.r * 8;
      ctx.globalAlpha = a;
      ctx.drawImage(m.lav ? sprites.guide : sprites.live, x - s / 2, y * h - s / 2, s, s);
    }
    ctx.globalAlpha = 1;
  };

  resize();
  readTheme();
  window.addEventListener('resize', () => { resize(); if (reduced()) draw(0); });

  let last = 0;
  let themeAt = 0;
  let still = '';
  let raf = 0;
  const loop = (ts) => {
    raf = requestAnimationFrame(loop);
    if (ts - last < 1000 / FPS) return;
    last = ts;
    if (ts - themeAt > 1000) { themeAt = ts; readTheme(); }
    if (reduced()) {
      // One still frame, redrawn only when the theme or size changes.
      const key = `${themeKey}|${w}x${h}`;
      if (still !== key) { still = key; draw(0); }
      return;
    }
    still = '';
    draw(ts / 1000);
  };
  raf = requestAnimationFrame(loop);
  return { stop: () => { cancelAnimationFrame(raf); canvas.remove(); } };
}

module.exports = { startEmbers };
