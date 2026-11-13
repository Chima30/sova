'use strict';

// The session story card: one shareable image at the end of a session.
// Focus time, resets, and breathing before and after the last reset, drawn
// over the real breath waveform when SOVA had a steady one. Values come only
// from the stored session record, which holds readings that passed the
// signal checks. Drawn on a canvas so the PNG matches what is on screen.

const W = 1040;
const H = 600;
const ORANGE = [255, 116, 66];
const LAVENDER = [180, 166, 245];
const rgba = (c, a) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;
const FONT = '"Geist", "Segoe UI", system-ui, sans-serif';
const MONO = '"Geist Mono", ui-monospace, monospace';

function roundRect(x, X, Y, w, h, r) {
  x.beginPath();
  x.moveTo(X + r, Y);
  x.arcTo(X + w, Y, X + w, Y + h, r);
  x.arcTo(X + w, Y + h, X, Y + h, r);
  x.arcTo(X, Y + h, X, Y, r);
  x.arcTo(X, Y, X + w, Y, r);
  x.closePath();
}

// The facts on the card, from the stored record only.
function cardFacts(record) {
  const events = record.events || [];
  const resets = events.filter((e) => e.type === 'reset');
  const pair = [...resets].reverse().find((e) => e.before && e.after && e.before.breathing != null && e.after.breathing != null);
  return {
    preset: record.presetName || 'Focus session',
    date: new Date(record.startedAt).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }),
    minutes: Math.round((record.focusSeconds || 0) / 60),
    resets: resets.length,
    before: pair ? Math.round(pair.before.breathing) : null,
    after: pair ? Math.round(pair.after.breathing) : null,
  };
}

// trace: breathing waveform values from a steady stretch, or null.
function drawCard(canvas, record, trace) {
  const f = cardFacts(record);
  const S = 2;
  canvas.width = W * S;
  canvas.height = H * S;
  const x = canvas.getContext('2d');
  x.setTransform(S, 0, 0, S, 0, 0);

  // Background with soft plum and ember light, and a few still embers.
  roundRect(x, 0, 0, W, H, 40);
  x.save();
  x.clip();
  x.fillStyle = '#15131d';
  x.fillRect(0, 0, W, H);
  const glow = (cx, cy, r, c, a) => {
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, rgba(c, a));
    g.addColorStop(1, rgba(c, 0));
    x.fillStyle = g;
    x.fillRect(0, 0, W, H);
  };
  glow(80, 0, 560, [124, 96, 230], 0.42);
  glow(W, H, 620, [240, 104, 52], 0.30);
  let seed = 5;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 26; i++) {
    const c = rnd() < 0.35 ? LAVENDER : ORANGE;
    const px = rnd() * W, py = rnd() * H, r = 1 + rnd() * 2.2;
    const g = x.createRadialGradient(px, py, 0, px, py, r * 4);
    g.addColorStop(0, rgba(c, 0.5));
    g.addColorStop(1, rgba(c, 0));
    x.fillStyle = g;
    x.fillRect(px - r * 4, py - r * 4, r * 8, r * 8);
  }
  x.restore();
  roundRect(x, 0.5, 0.5, W - 1, H - 1, 40);
  x.strokeStyle = 'rgba(255, 255, 255, 0.10)';
  x.lineWidth = 1;
  x.stroke();

  const P = 56;
  // Mark and wordmark
  x.strokeStyle = rgba(ORANGE, 0.6);
  x.lineWidth = 1.6;
  x.beginPath(); x.arc(P + 14, P + 14, 14, 0, Math.PI * 2); x.stroke();
  x.strokeStyle = rgba(ORANGE, 1);
  x.beginPath();
  for (let i = 0; i <= 24; i++) {
    const u = i / 24;
    const px = P + 3 + u * 22, py = P + 14 - 4 * Math.sin(u * Math.PI * 2);
    if (i) x.lineTo(px, py); else x.moveTo(px, py);
  }
  x.stroke();
  x.fillStyle = '#f3f2f7';
  x.font = `600 14px ${FONT}`;
  x.textBaseline = 'middle';
  x.letterSpacing = '5px';
  x.fillText('SOVA', P + 40, P + 15);
  x.letterSpacing = '0px';
  x.font = `400 14px ${MONO}`;
  x.fillStyle = '#86839b';
  x.textAlign = 'right';
  x.fillText(`${f.date} · ${f.preset}`, W - P, P + 15);
  x.textAlign = 'left';

  // Title
  x.fillStyle = '#f3f2f7';
  x.font = `300 46px ${FONT}`;
  x.textBaseline = 'alphabetic';
  x.fillText(`${f.preset}, ${f.minutes} min of focus`, P, P + 96);

  // Breath ribbon: the real waveform, or a still grey line without one.
  const top = 190, bandH = 120, mid = top + bandH / 2;
  const left = P, width = W - 2 * P;
  if (trace && trace.length >= 20) {
    const lo = Math.min(...trace), hi = Math.max(...trace);
    const norm = trace.map((v) => (hi - lo > 0 ? (v - lo) / (hi - lo) - 0.5 : 0));
    for (let k = 0; k < 12; k++) {
      const u = k / 11;
      const centre = 1 - Math.abs(u - 0.5) * 2;
      const amp = bandH * 0.42 * (0.35 + 0.65 * centre);
      x.beginPath();
      norm.forEach((v, i) => {
        const t = i / (norm.length - 1);
        const env = Math.pow(Math.sin(Math.PI * t), 1.2);
        const px = left + t * width;
        const py = mid - v * amp * env + (u - 0.5) * 10 * env;
        if (i) x.lineTo(px, py); else x.moveTo(px, py);
      });
      x.strokeStyle = rgba(ORANGE, 0.12 + 0.7 * centre * centre);
      x.lineWidth = centre > 0.9 ? 2 : 1;
      x.stroke();
    }
    x.font = `400 13px ${FONT}`;
    x.fillStyle = '#b1aec2';
    x.fillText('Your breathing from the camera, the last steady 20 seconds', left, top + bandH + 22);
  } else {
    x.beginPath(); x.moveTo(left, mid); x.lineTo(left + width, mid);
    x.strokeStyle = 'rgba(160, 156, 184, 0.45)'; x.lineWidth = 1.2; x.stroke();
    x.font = `400 13px ${FONT}`;
    x.fillStyle = '#86839b';
    x.fillText('No live breath line for this session', left, top + bandH + 22);
  }

  // Tiles
  const ty = 370, th = 120, gap = 16, tw = (width - 2 * gap) / 3;
  const tile = (i, label, value, unit, inverted) => {
    const tx = left + i * (tw + gap);
    roundRect(x, tx, ty, tw, th, 22);
    x.fillStyle = inverted ? '#f3f2f7' : 'rgba(255, 255, 255, 0.06)';
    x.fill();
    if (!inverted) { x.strokeStyle = 'rgba(255, 255, 255, 0.10)'; x.lineWidth = 1; x.stroke(); }
    x.fillStyle = inverted ? '#5a5868' : '#b1aec2';
    x.font = `400 15px ${FONT}`;
    x.fillText(label, tx + 22, ty + 34);
    x.fillStyle = inverted ? '#121117' : '#f3f2f7';
    x.font = `300 ${value.length > 6 ? 40 : 52}px ${FONT}`;
    x.fillText(value, tx + 22, ty + 96);
    if (unit) {
      const vw = x.measureText(value).width;
      x.font = `400 15px ${FONT}`;
      x.fillStyle = inverted ? '#5a5868' : '#b1aec2';
      x.fillText(unit, tx + 30 + vw, ty + 96);
    }
  };
  tile(0, 'Focused', String(f.minutes), 'min');
  tile(1, 'Resets', String(f.resets), '');
  if (f.before != null) tile(2, 'Breathing, before → after', `${f.before} → ${f.after}`, '/min', true);
  else tile(2, 'Breathing, before → after', '–', 'no steady pair', true);

  x.font = `400 13px ${FONT}`;
  x.fillStyle = '#86839b';
  x.fillText(f.before != null
    ? 'Before and after your last reset, measured live by the Presage SmartSpectra SDK. Not medical.'
    : 'Measured with the Presage SmartSpectra SDK. Not medical.', left, H - 52);
  return f;
}

// The card section for the summary page: the canvas plus save and copy.
function storyCard(container, record, trace) {
  container.innerHTML = `
    <canvas class="story-canvas" role="img"></canvas>
    <div class="row">
      <button class="btn btn-primary" id="card-save">Save as image</button>
      <button class="btn btn-quiet" id="card-copy">Copy</button>
      <span class="t-small" id="card-status" aria-live="polite"></span>
    </div>`;
  const canvas = container.querySelector('canvas');
  const paint = () => {
    const f = drawCard(canvas, record, trace);
    canvas.setAttribute('aria-label', `Session card: ${f.preset}, ${f.minutes} minutes of focus, ${f.resets} resets${f.before != null ? `, breathing ${f.before} to ${f.after} per minute around the last reset` : ''}.`);
  };
  paint();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(paint);
  const status = container.querySelector('#card-status');
  const name = `sova-${String(record.startedAt || '').slice(0, 10) || 'session'}.png`;
  container.querySelector('#card-save').addEventListener('click', async () => {
    const r = await window.sova.saveCard(canvas.toDataURL('image/png'), name);
    status.textContent = r && r.ok ? 'Saved' : '';
  });
  container.querySelector('#card-copy').addEventListener('click', async () => {
    const r = await window.sova.copyCard(canvas.toDataURL('image/png'));
    status.textContent = r && r.ok ? 'Copied to the clipboard' : '';
  });
}

module.exports = { storyCard, drawCard, cardFacts };
