// Command palette: unified, permission-aware search with keyboard navigation and recent searches.
import { icon } from '../core/icons.js';
import { esc, highlight, debounce } from '../core/util.js';
import { searchIndex } from '../core/select.js';
import { search, CATEGORIES } from '../domain/search.js';
import { getUI, setUI } from '../core/store.js';
import { nav } from '../core/router.js';

const TYPE_ICON = { page: 'arrow', course: 'layers', lesson: 'book', problem: 'code', person: 'user', project: 'folder', thread: 'chat', job: 'brief', student: 'users' };
const TYPE_LABEL = Object.fromEntries(CATEGORIES);
let state = { q: '', cat: 'all', sel: 0, results: [] };
let lastFocus = null;

export function openPalette(initial = '') {
  const host = document.querySelector('#palette');
  lastFocus = document.activeElement;
  state = { q: initial, cat: 'all', sel: 0, results: [] };
  host.hidden = false;
  host.innerHTML = `<div class="palette" role="dialog" aria-modal="true" aria-label="Search">
    <div class="palette-in">${icon('search')}<input id="pal-q" type="search" placeholder="Search courses, lessons, problems, people, jobs…" autocomplete="off" aria-controls="pal-res" aria-autocomplete="list" role="combobox" aria-expanded="true" value="${esc(initial)}"><kbd>Esc</kbd></div>
    <div class="palette-cats" role="group" aria-label="Filter results">${CATEGORIES.map(([id, l]) => `<button type="button" class="chip" data-cat="${id}" aria-pressed="${id === 'all'}">${esc(l)}</button>`).join('')}</div>
    <div class="palette-res" id="pal-res" role="listbox" aria-label="Results"></div>
    <div class="palette-foot"><span><kbd>↑</kbd> <kbd>↓</kbd> move</span><span><kbd>Enter</kbd> open</span><span>Results only include records your role can open.</span></div>
  </div>`;
  const input = host.querySelector('#pal-q');
  const update = debounce(() => { state.q = input.value; state.sel = 0; draw(); }, 90);
  input.addEventListener('input', update);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); state.sel = Math.min(state.results.length - 1, state.sel + 1); draw(false); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); state.sel = Math.max(0, state.sel - 1); draw(false); }
    else if (e.key === 'Enter') { e.preventDefault(); const r = state.results[state.sel]; if (r) go(r); }
  });
  host.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } });
  host.onclick = (e) => {
    if (e.target === host) return close();
    const c = e.target.closest('[data-cat]');
    if (c) { state.cat = c.dataset.cat; host.querySelectorAll('[data-cat]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.cat === state.cat)); state.sel = 0; draw(); input.focus(); return; }
    const a = e.target.closest('[data-i]');
    if (a) { e.preventDefault(); const r = state.results[Number(a.dataset.i)]; if (r) go(r); }
    const rq = e.target.closest('[data-recent]');
    if (rq) { input.value = rq.dataset.recent; state.q = input.value; draw(); input.focus(); }
  };
  draw();
  setTimeout(() => input.focus(), 10);
}

function go(r) {
  const ui = getUI();
  const q = state.q.trim();
  if (q) setUI({ recent: [q, ...ui.recent.filter((x) => x !== q)].slice(0, 6) }, { silent: true });
  close();
  nav(r.link);
}
function close() {
  const host = document.querySelector('#palette');
  host.hidden = true; host.innerHTML = '';
  lastFocus?.focus?.();
}

function draw(recompute = true) {
  const box = document.querySelector('#pal-res');
  if (!box) return;
  if (recompute) state.results = search(searchIndex(), state.q, state.cat, 40);
  const input = document.querySelector('#pal-q');
  if (!state.q.trim()) {
    const rec = getUI().recent;
    box.innerHTML = rec.length ? `<h4>Recent searches</h4>${rec.map((r) => `<a href="#" data-recent="${esc(r)}">${icon('clock')}<span class="t">${esc(r)}</span></a>`).join('')}` : `<div class="empty" style="margin:10px">${icon('search')}<b>Search across the institute</b><span>Try "react", "two sum", "SAP", a learner's name, or "deadline".</span></div>`;
    input?.removeAttribute('aria-activedescendant');
    return;
  }
  if (!state.results.length) { box.innerHTML = `<div class="empty" style="margin:10px">${icon('search')}<b>No results for "${esc(state.q)}"</b><span>Check the spelling, try a broader word, or switch the filter back to All.</span></div>`; return; }
  let html = '';
  let lastType = '';
  state.results.forEach((r, i) => {
    if (r.type !== lastType) { html += `<h4>${esc(TYPE_LABEL[r.type] || r.type)}</h4>`; lastType = r.type; }
    html += `<a href="#${esc(r.link)}" id="pal-${i}" role="option" data-i="${i}" aria-selected="${i === state.sel}">${icon(TYPE_ICON[r.type] || 'dot')}<span class="min0"><span class="t">${highlight(r.title, state.q)}</span><br><span class="s">${highlight(r.sub, state.q)}</span></span></a>`;
  });
  box.innerHTML = html;
  input?.setAttribute('aria-activedescendant', `pal-${state.sel}`);
  document.querySelector(`#pal-${state.sel}`)?.scrollIntoView({ block: 'nearest' });
}

/** Global keyboard shortcuts. */
export function paletteKeys({ go, shortcuts, copilot }) {
  let gPressed = 0;
  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable || e.target.closest?.('.CodeMirror');
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); return; }
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
    if (!document.querySelector('#modal')?.hidden || !document.querySelector('#palette')?.hidden) return;
    if (e.key === '/') { e.preventDefault(); openPalette(); return; }
    if (e.key === '?') { e.preventDefault(); shortcuts(); return; }
    if (e.key.toLowerCase() === 'g') { gPressed = Date.now(); return; }
    if (Date.now() - gPressed < 900) {
      const k = e.key.toLowerCase();
      const map = { d: '/dashboard', l: '/lab', n: '/notifications', p: '/programs', a: '/arena' };
      if (map[k]) { e.preventDefault(); go(map[k]); }
      if (k === 'c') { e.preventDefault(); copilot(); }
      gPressed = 0;
    }
  });
}
