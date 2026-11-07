'use strict';

// Tiny DOM helpers. All user text goes through textContent or esc().

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function html(el, markup) {
  el.innerHTML = markup;
  return el;
}

function announce(text) {
  const live = document.getElementById('sr-live');
  if (!live) return;
  live.textContent = '';
  setTimeout(() => { live.textContent = text; }, 30);
}

function toast({ title, body, actions }) {
  const root = document.getElementById('toast-root');
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.innerHTML = `<strong>${esc(title)}</strong>${body ? `<span class="small" style="color: var(--text-2)">${esc(body)}</span>` : ''}<div class="row"></div>`;
  const row = el.querySelector('.row');
  const close = () => el.remove();
  for (const a of actions || []) {
    const b = document.createElement('button');
    b.className = `btn${a.primary ? ' primary' : ''}`;
    b.textContent = a.label;
    b.addEventListener('click', () => { close(); if (a.onClick) a.onClick(); });
    row.appendChild(b);
  }
  root.appendChild(el);
  announce(title);
  return close;
}

function fmtDate(iso) {
  try {
    return new Date(iso).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}

function fmtMinutes(seconds) {
  const m = Math.round((seconds || 0) / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

module.exports = { $, $$, esc, html, announce, toast, fmtDate, fmtMinutes };
