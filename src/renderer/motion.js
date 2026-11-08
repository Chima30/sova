'use strict';

// Motion for the whole UI, in one place.
//
//  - cards rise in one after another when a section opens
//  - counts that are not readings (minutes, sessions, resets) count up
//  - live readings never count up: a tween would show values that were never
//    measured. A changed reading slides in instead (roll()).
//  - charts draw in: bars grow, range bands wipe, lines trace
//
// Everything is skipped with reduced motion.

const STAGGER = '.panel, .stat, .tile, .notice, .greet, .feel';

function reduced() {
  return document.body.classList.contains('reduced-motion') || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// Give each card its place in the entrance order.
function stagger(root) {
  let i = 0;
  for (const el of root.querySelectorAll(STAGGER)) {
    if (el.parentElement && el.parentElement.closest('.panel, .stat, .tile')) continue;
    el.style.setProperty('--i', String(Math.min(i++, 12)));
  }
}

const easeOut = (t) => 1 - Math.pow(1 - t, 4);

// <span data-count="42">42</span> counts up from 0. Decimals follow the target.
function countUp(root) {
  const els = root.querySelectorAll('[data-count]');
  if (!els.length) return;
  if (reduced()) return;
  for (const el of els) {
    const target = Number(el.dataset.count);
    if (!Number.isFinite(target) || target === 0) continue;
    const decimals = (el.dataset.count.split('.')[1] || '').length;
    const suffix = el.dataset.suffix || '';
    const delay = Number(getComputedStyle(el.closest('[style*="--i"]') || el).getPropertyValue('--i') || 0) * 60;
    const t0 = performance.now() + delay;
    const dur = 900;
    el.textContent = `${(0).toFixed(decimals)}${suffix}`;
    const tick = (ts) => {
      if (!el.isConnected) return;
      const p = Math.max(0, Math.min(1, (ts - t0) / dur));
      el.textContent = `${(target * easeOut(p)).toFixed(decimals)}${suffix}`;
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
}

// SVG lines with class "trace" draw themselves in.
function traceLines(root) {
  for (const path of root.querySelectorAll('svg .trace')) {
    if (typeof path.getTotalLength !== 'function') continue;
    const len = Math.ceil(path.getTotalLength());
    path.style.setProperty('--len', String(len));
    path.classList.add('tracing');
  }
}

// A new value slides in. Text is set immediately for screen readers.
function roll(el) {
  if (!el || reduced()) return;
  el.classList.remove('roll');
  void el.offsetWidth;
  el.classList.add('roll');
}

// Run the entrance for whatever was just rendered into root.
function enter(root) {
  if (!root) return;
  stagger(root);
  countUp(root);
  traceLines(root);
}

// Watch a container: each time its content is replaced, play the entrance.
function watch(root) {
  if (!root) return;
  const obs = new MutationObserver((records) => {
    if (records.some((r) => r.target === root && r.addedNodes.length)) enter(root);
  });
  obs.observe(root, { childList: true });
}

// The sliding marker behind the current item in the side rail.
function moveIndicator(nav) {
  const ind = nav && nav.querySelector('.rail-indicator');
  const cur = nav && nav.querySelector('[aria-current="page"]');
  if (!ind) return;
  if (!cur) { ind.style.opacity = '0'; return; }
  ind.style.opacity = '1';
  ind.style.transform = `translateY(${cur.offsetTop}px)`;
}

module.exports = { enter, watch, roll, countUp, moveIndicator, reduced };
