'use strict';

// The heart: a glossy 3D heart for the focus session, drawn in code.
//
//  live   orange-red; it swells and settles with the real breathing waveform
//         and beats at the measured pulse rate, but only while each reading
//         is usable
//  idle   pale and still: nothing is measured
//
// Like the orb and the breath lines, it never invents a breath or a beat.

const { BreathOrb, themeColours } = require('./breathOrb');

const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const rgba = (c, a) => `rgba(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])}, ${a})`;
const WHITE = [255, 255, 255];
const BLACK = [16, 4, 8];
const RED = [214, 38, 34];

// An organic heart outline, x in about -16..16, y in about -13..15 (y down):
// the classic heart curve blended with an egg shape, so the cleft is shallow,
// the apex is rounded and the left side (the viewer's right) is fuller.
function heartPoint(t) {
  const s = Math.sin(t);
  const hx = 16 * s * s * s;
  const hy = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) - 2.5;
  const ex = 14.5 * s * (1 - 0.18 * Math.cos(t));
  const ey = -13.5 * Math.cos(t) + 1;
  const x = hx * 0.55 + ex * 0.45;
  return [x * (x > 0 ? 1.08 : 0.96), hy * 0.55 + ey * 0.45];
}

function heartPath(ctx, k) {
  ctx.beginPath();
  for (let i = 0; i <= 160; i++) {
    const [x, y] = heartPoint((i / 160) * Math.PI * 2);
    if (i === 0) ctx.moveTo(x * k, y * k); else ctx.lineTo(x * k, y * k);
  }
  ctx.closePath();
}

// A rounded tube with light across it, for the vessels.
function tube(ctx, pts, width, C, dark) {
  const stroke = (w, colour) => {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    if (pts.length === 3) ctx.quadraticCurveTo(pts[1][0], pts[1][1], pts[2][0], pts[2][1]);
    else ctx.bezierCurveTo(pts[1][0], pts[1][1], pts[2][0], pts[2][1], pts[3][0], pts[3][1]);
    ctx.lineWidth = w;
    ctx.strokeStyle = colour;
    ctx.lineCap = 'round';
    ctx.stroke();
  };
  stroke(width, rgba(mix(C, BLACK, dark ? 0.3 : 0.22), 1));
  stroke(width * 0.8, rgba(C, 1));
  stroke(width * 0.3, rgba(mix(C, WHITE, 0.45), 0.8));
}

class BreathHeart extends BreathOrb {
  constructor(canvas, opts = {}) {
    super(canvas, { size: 0.33, ...opts });
    this.beatT = 0;
  }

  step(dt) {
    super.step(dt);
    this.rings = [];   // the heart beats itself; no rings
    if (this.mode === 'live' && this.pulse && !this.reduced) this.beatT += dt;
    else this.beatT = 0;
  }

  // Lub-dub: a strong contraction and a softer second one.
  beat() {
    if (this.mode !== 'live' || !this.pulse || this.reduced) return 0;
    const period = 60 / this.pulse;
    const p = (this.beatT % period) / period;
    const bump = (c, w) => Math.exp(-Math.pow((p - c) / w, 2));
    return bump(0.06, 0.05) + 0.55 * bump(0.24, 0.05);
  }

  draw() {
    const { w, h, dpr } = this.resize();
    const ctx = this.ctx;
    ctx.clearRect(0, 0, w, h);
    const now = performance.now();
    if (!this.theme || now - (this.themeAt || 0) > 500) { this.theme = themeColours(this.canvas); this.themeAt = now; }
    const goal = this.mode === 'live' ? mix(this.theme.live, RED, 0.35) : this.theme[this.mode];
    this.colour = !this.colour || this.reduced ? goal.slice() : mix(this.colour, goal, 0.06);
    const C = this.colour;
    const dark = this.theme.dark;

    const intro = this.reduced ? 1 : Math.min(1, (now - this.born) / 900);
    const ease = 1 - Math.pow(1 - intro, 3);
    ctx.globalAlpha = ease;

    const cx = w / 2;
    const cy = h * 0.54;
    const breath = this.mode === 'idle' ? 0.95 : 0.88 + 0.12 * this.levelNow;
    const R = Math.min(w, h) * this.size * breath * (0.85 + 0.15 * ease) * (1 + 0.07 * this.beat());
    const k = R / 16;

    // Halo
    const haloR = Math.max(R * 1.05, Math.min(R * 1.9, cx, cy, w - cx, h - cy));
    const halo = ctx.createRadialGradient(cx, cy, R * 0.5, cx, cy, haloR);
    halo.addColorStop(0, rgba(C, (this.mode === 'idle' ? 0.10 : 0.2 + 0.14 * this.levelNow + 0.12 * this.beat()) * (dark ? 1.2 : 1)));
    halo.addColorStop(1, rgba(C, 0));
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, w, h);

    // Ground shadow
    ctx.save();
    ctx.translate(cx, cy + 19 * k);
    ctx.scale(1, 0.16);
    const sh = ctx.createRadialGradient(0, 0, 0, 0, 0, R);
    sh.addColorStop(0, rgba(dark ? BLACK : mix(C, BLACK, 0.6), dark ? 0.55 : 0.22));
    sh.addColorStop(1, rgba(BLACK, 0));
    ctx.fillStyle = sh;
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    // Nudged right and down so the heart and its vessels sit centred together.
    ctx.translate(cx + 3 * k, cy + 3 * k);
    ctx.rotate(-0.3 + 0.04 * this.tiltNow[0]);

    // Vessels behind the body: a vein on the far side, the aortic arch with
    // three branches, and the pulmonary trunk in front of it.
    const vessel = mix(C, WHITE, 0.06);
    tube(ctx, [[-9 * k, -6 * k], [-9.5 * k, -14 * k], [-10 * k, -20 * k]], 5 * k, mix(vessel, BLACK, 0.12), dark);
    tube(ctx, [[-1 * k, -8 * k], [-1 * k, -23 * k], [-11 * k, -23 * k], [-13.5 * k, -12 * k]], 7.5 * k, vessel, dark);
    tube(ctx, [[-3.5 * k, -20 * k], [-3.8 * k, -25 * k], [-3 * k, -28 * k]], 2.8 * k, vessel, dark);
    tube(ctx, [[-6.5 * k, -21 * k], [-7.5 * k, -26 * k], [-7.8 * k, -28.5 * k]], 2.6 * k, vessel, dark);
    tube(ctx, [[-9.5 * k, -19.5 * k], [-11.5 * k, -24 * k], [-13 * k, -26 * k]], 2.4 * k, vessel, dark);
    tube(ctx, [[4 * k, -6 * k], [4 * k, -15 * k], [10 * k, -18 * k]], 6.5 * k, mix(vessel, WHITE, 0.1), dark);

    // Body
    const lx = -7 * k + 2 * k * this.tiltNow[0];
    const ly = -6 * k + 2 * k * this.tiltNow[1];
    heartPath(ctx, k);
    const body = ctx.createRadialGradient(lx, ly, k, 0, 2 * k, 20 * k);
    body.addColorStop(0, rgba(mix(C, WHITE, 0.6), 1));
    body.addColorStop(0.3, rgba(mix(C, WHITE, 0.15), 1));
    body.addColorStop(0.7, rgba(C, 1));
    body.addColorStop(1, rgba(mix(C, BLACK, 0.45), 1));
    ctx.fillStyle = body;
    ctx.fill();

    ctx.save();
    heartPath(ctx, k);
    ctx.clip();
    // Second lobe catches its own light
    const lobe = ctx.createRadialGradient(7 * k, -6 * k, 0, 7 * k, -6 * k, 8 * k);
    lobe.addColorStop(0, rgba(mix(C, WHITE, 0.4), 0.55));
    lobe.addColorStop(1, rgba(C, 0));
    ctx.fillStyle = lobe;
    ctx.fillRect(-16 * k, -14 * k, 32 * k, 32 * k);
    // The groove between the two sides, with coronary vessels branching
    // across the surface (blue-violet, like veins under the light).
    const curve = (pts, width, colour) => {
      ctx.beginPath();
      ctx.moveTo(pts[0][0] * k, pts[0][1] * k);
      ctx.bezierCurveTo(pts[1][0] * k, pts[1][1] * k, pts[2][0] * k, pts[2][1] * k, pts[3][0] * k, pts[3][1] * k);
      ctx.lineWidth = width * k;
      ctx.strokeStyle = colour;
      ctx.lineCap = 'round';
      ctx.stroke();
    };
    const groove = rgba(mix(C, BLACK, 0.5), 0.45);
    curve([[0, -7], [3, 0], [1, 7], [3, 14]], 1.8, groove);
    const vein = rgba(mix(C, [70, 60, 170], this.mode === 'idle' ? 0.25 : 0.55), 0.85);
    const veinLight = rgba(mix(C, WHITE, 0.55), 0.4);
    const veins = [
      [[0.5, -6], [2.5, 0], [1, 7], [2.5, 13]],
      [[2, -2], [5, 0], [8, 2], [11, 1]],
      [[1.8, 3], [5, 5], [7, 9], [9, 10]],
      [[-1, -4], [-4, -1], [-7, 0], [-10, -2]],
      [[-1.5, 1], [-4, 4], [-6, 7], [-7, 11]],
      [[-4, -1], [-5, -4], [-7, -5], [-9, -7]],
    ];
    veins.forEach((v, i) => {
      curve(v, i === 0 ? 1.1 : 0.7, vein);
      curve(v.map(([x, y]) => [x + 0.35, y - 0.35]), i === 0 ? 0.35 : 0.22, veinLight);
    });
    // Shade toward the tip
    const shade = ctx.createLinearGradient(0, 2 * k, 0, 15 * k);
    shade.addColorStop(0, rgba(BLACK, 0));
    shade.addColorStop(1, rgba(mix(C, BLACK, 0.6), 0.4));
    ctx.fillStyle = shade;
    ctx.fillRect(-16 * k, 2 * k, 32 * k, 14 * k);
    ctx.restore();

    // Rim light
    heartPath(ctx, k);
    const rim = ctx.createLinearGradient(0, -12 * k, 0, 15 * k);
    rim.addColorStop(0, rgba(WHITE, 0.7));
    rim.addColorStop(0.5, rgba(WHITE, 0.05));
    rim.addColorStop(1, rgba(mix(C, WHITE, 0.4), 0.45));
    ctx.strokeStyle = rim;
    ctx.lineWidth = 1.4 * dpr;
    ctx.stroke();

    // Specular highlights on both lobes
    const spec = (x, y, r, rot, a) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rot);
      ctx.scale(1, 0.55);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
      g.addColorStop(0, rgba(WHITE, a));
      g.addColorStop(1, rgba(WHITE, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };
    spec(lx, ly, 5 * k, -0.7, 0.85);
    spec(8 * k, -8 * k, 3 * k, 0.5, 0.45);

    ctx.restore();
    ctx.globalAlpha = 1;
    if (this.reduced && intro < 1) this.born = now - 900;
  }
}

module.exports = { BreathHeart };
