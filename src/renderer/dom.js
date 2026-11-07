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

function toast({ title, body, actions, tone }) {
  const root = document.getElementById('toast-root');
  const el = document.createElement('div');
  el.className = `toast${tone === 'cue' ? ' cue' : ''}`;
  el.setAttribute('role', 'status');
  el.innerHTML = `<strong>${esc(title)}</strong>${body ? `<p class="t-small">${esc(body)}</p>` : ''}<div class="row"></div>`;
  const row = el.querySelector('.row');
  const close = () => {
    if (!el.isConnected) return;
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 180);
  };
  for (const a of actions || []) {
    const b = document.createElement('button');
    b.className = `btn${a.primary ? (tone === 'cue' ? ' btn-accent' : ' btn-primary') : ' btn-quiet'}`;
    b.textContent = a.label;
    b.addEventListener('click', () => { close(); if (a.onClick) a.onClick(); });
    row.appendChild(b);
  }
  // Messages that only inform (no choice to make) close by themselves after
  // 2 seconds, or once the pointer leaves them. Toasts asking for a decision stay.
  const informOnly = (actions || []).every((a) => !a.onClick);
  if (informOnly) {
    let timer = setTimeout(close, 2000);
    el.addEventListener('mouseenter', () => clearTimeout(timer));
    el.addEventListener('mouseleave', () => { timer = setTimeout(close, 1200); });
  }
  root.appendChild(el);
  announce(title);
  return close;
}

// A labelled switch row for settings and preferences.
function switchRow({ id, label, help, checked }) {
  return `<div class="setting"><div class="setting-text"><label class="setting-label" for="${id}">${esc(label)}</label>${help ? `<span class="setting-help" id="${id}-help">${esc(help)}</span>` : ''}</div>
    <span class="switch"><input type="checkbox" role="switch" id="${id}" ${checked ? 'checked' : ''} ${help ? `aria-describedby="${id}-help"` : ''}><span></span></span></div>`;
}

// A small explanation for a biometric term, reachable by keyboard.
function tip(id, text) {
  return `<span class="tip"><button type="button" class="tip-btn" aria-describedby="${id}" aria-label="What is this?"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg></button><span class="tip-body" role="tooltip" id="${id}">${esc(text)}</span></span>`;
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

module.exports = { $, $$, esc, html, announce, toast, switchRow, tip, fmtDate, fmtMinutes };
