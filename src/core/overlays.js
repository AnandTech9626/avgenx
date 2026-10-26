// Toasts, confirmation dialogs, modals and side panels with focus management.
import { esc } from './util.js';
import { icon } from './icons.js';

const $ = (s) => document.querySelector(s);
let lastFocus = null;

export function toast(message, { tone = '', action = null, ms = 3600 } = {}) {
  const host = $('#toasts');
  if (!host) return;
  const el = document.createElement('div');
  el.className = `toast ${tone}`;
  el.setAttribute('role', tone === 'bad' ? 'alert' : 'status');
  el.innerHTML = `<span>${esc(message)}</span>`;
  if (action) {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = action.label;
    b.addEventListener('click', () => { action.run(); el.remove(); });
    el.appendChild(b);
  }
  host.appendChild(el);
  setTimeout(() => el.remove(), ms);
}
export const toastError = (err) => toast(err?.message || String(err), { tone: 'bad', ms: 5200 });

function trap(host, onClose) {
  const focusables = () => [...host.querySelectorAll('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])')].filter((e) => !e.disabled && e.offsetParent !== null);
  const key = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    if (e.key === 'Tab') {
      const f = focusables(); if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };
  host.addEventListener('keydown', key);
  return () => host.removeEventListener('keydown', key);
}

/**
 * Generic modal. Returns { el, close }. `onMount(el, close)` wires inner controls.
 */
export function modal({ title, body, foot = '', wide = false, onMount, onClose, labelledBy = 'modal-title' }) {
  const host = $('#modal');
  lastFocus = document.activeElement;
  host.innerHTML = `<div class="modal${wide ? ' wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="${labelledBy}"><div class="modal-head"><h2 id="modal-title">${esc(title)}</h2><button type="button" class="icon-btn" data-close aria-label="Close dialog">${icon('x')}</button></div><div class="modal-body">${body}</div>${foot ? `<div class="modal-foot">${foot}</div>` : ''}</div>`;
  host.hidden = false;
  let untrap = () => {};
  const close = () => { untrap(); host.hidden = true; host.innerHTML = ''; onClose?.(); lastFocus?.focus?.(); };
  untrap = trap(host, close);
  host.querySelector('[data-close]').addEventListener('click', close);
  host.onclick = (e) => { if (e.target === host) close(); };
  onMount?.(host.querySelector('.modal'), close);
  setTimeout(() => (host.querySelector('[autofocus]') || host.querySelector('.modal-body input,.modal-body select,.modal-body textarea') || host.querySelector('.modal-foot .btn-primary,.modal-foot .btn-danger') || host.querySelector('[data-close]'))?.focus(), 20);
  return { el: host.querySelector('.modal'), close };
}

/**
 * Confirmation dialog. Destructive actions can require typing a phrase.
 * @returns {Promise<boolean>}
 */
export function confirmDialog({ title, body, confirmLabel = 'Confirm', danger = false, typeToConfirm = '' }) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const m = modal({
      title,
      body: `<p>${body}</p>${typeToConfirm ? `<div class="field"><label for="confirm-phrase">Type <b>${esc(typeToConfirm)}</b> to confirm</label><input class="input" id="confirm-phrase" autocomplete="off"></div>` : ''}`,
      foot: `<button type="button" class="btn btn-ghost" data-no>Cancel</button><button type="button" class="btn ${danger ? 'btn-danger solid' : 'btn-primary'}" data-yes ${typeToConfirm ? 'disabled' : ''}>${esc(confirmLabel)}</button>`,
      onClose: () => finish(false),
      onMount: (el, close) => {
        const yes = el.querySelector('[data-yes]');
        el.querySelector('[data-no]').addEventListener('click', () => { finish(false); close(); });
        yes.addEventListener('click', () => { finish(true); close(); });
        const ph = el.querySelector('#confirm-phrase');
        ph?.addEventListener('input', () => { yes.disabled = ph.value.trim() !== typeToConfirm; });
      },
    });
    return m;
  });
}

/** Contextual side panel. */
export function drawer({ title, sub = '', body, wide = false, onMount, onClose }) {
  const host = $('#drawer');
  lastFocus = document.activeElement;
  host.innerHTML = `<aside class="drawer${wide ? ' wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="drawer-title"><div class="drawer-head"><div class="min0"><h2 id="drawer-title">${esc(title)}</h2>${sub ? `<div class="small muted">${sub}</div>` : ''}</div><button type="button" class="icon-btn" data-close aria-label="Close panel">${icon('x')}</button></div><div class="drawer-body">${body}</div></aside>`;
  host.hidden = false;
  let untrap = () => {};
  const docKey = (e) => { if (e.key === 'Escape' && document.querySelector('#modal')?.hidden && document.querySelector('#palette')?.hidden && !host.contains(document.activeElement)) close(); };
  const close = () => { untrap(); document.removeEventListener('keydown', docKey); host.hidden = true; host.innerHTML = ''; onClose?.(); lastFocus?.focus?.(); };
  untrap = trap(host, close);
  document.addEventListener('keydown', docKey);
  host.querySelector('[data-close]').addEventListener('click', close);
  host.onclick = (e) => { if (e.target === host) close(); };
  onMount?.(host.querySelector('.drawer'), close);
  setTimeout(() => host.querySelector('[data-close]')?.focus(), 20);
  return { el: host.querySelector('.drawer'), close };
}
export const closeDrawer = () => { const h = $('#drawer'); if (h && !h.hidden) h.querySelector('[data-close]')?.click(); };
export const drawerOpen = () => !$('#drawer')?.hidden;
