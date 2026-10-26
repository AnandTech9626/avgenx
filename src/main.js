// Application bootstrap: shell, routing, event delegation, error boundary.
import './styles/tokens.css';
import './styles/base.css';
import './styles/layout.css';
import './styles/components.css';
import './styles/views.css';
import 'codemirror/lib/codemirror.css';

import * as store from './core/store.js';
import { compile, match, parseHash, nav } from './core/router.js';
import { navFor, roleById, can as canRaw, canAny } from './core/rbac.js';
import { getIdentity, setIdentity, PREVIEW, readPreview, savePreview, signOut } from './core/session.js';
import { setServerAI } from './services/ai.js';
import { fetchMe, tabNote } from './services/auth.js';
import { icon } from './core/icons.js';
import { esc, initials } from './core/util.js';
import { toast, toastError, confirmDialog, modal, drawer, drawerOpen } from './core/overlays.js';
import { now, actor, can, flag, activityIndex, riskAll } from './core/select.js';
import { denied } from './core/ui.js';
import { ROUTES } from './views/index.js';
import { openPalette, paletteKeys } from './views/palette.js';
import { openCopilot, copilotButton } from './views/copilot.js';
import { initAI } from './services/ai.js';
import { applyDisplayPrefs } from './views/notifications.js';

const compiled = compile(ROUTES);
const $ = (s) => document.querySelector(s);
const localState = new Map();
let current = { view: null, params: {}, query: {}, path: '' };
let panel = null; // { render: () => {title, sub, body, wide} } for the open side panel
let renderQueued = false;

/** Per-view ephemeral UI state that survives re-renders (filters, tabs, pages). */
const local = (key, init = {}) => {
  if (!localState.has(key)) localState.set(key, { ...init });
  const o = localState.get(key);
  for (const k in init) if (!(k in o)) o[k] = init[k];
  return o;
};

function makeCtx() {
  const s = store.getState();
  const me = actor();
  return {
    s, ui: store.getUI(), me, now: now(), params: current.params, query: current.query, path: current.path,
    can, flag, local, nav, toast, toastError, confirm: confirmDialog, modal,
    idx: activityIndex, risk: riskAll,
    /** Commit with error handling + optional audit. Returns true on success. */
    commit(label, fn, { audit, ok, silent } = {}) {
      try {
        store.commit(label, fn, { audit: audit ? { actorId: me.id, kind: 'admin', ...audit } : undefined, silent });
        if (ok) toast(ok);
        return true;
      } catch (err) { toastError(err); if (err?.fields) return err.fields; return false; }
    },
    notify: (userId, cat, title, body, link) => store.notify(userId, cat, title, body, link),
    openPanel(renderFn) {
      panel = { render: renderFn };
      const p = renderFn();
      drawer({ ...p, onClose: () => { panel = null; } });
    },
    refreshPanel() { if (panel && drawerOpen()) { const p = panel.render(); const body = document.querySelector('#drawer .drawer-body'); if (body && p) { const top = body.scrollTop; body.innerHTML = p.body; body.scrollTop = top; const t = document.querySelector('#drawer-title'); if (t) t.textContent = p.title; } } },
    rerender: () => queueRender(),
  };
}

// ---------------------------------------------------------------- shell
function shell() {
  $('#app').innerHTML = `
  <a class="skip" href="#main" data-act="g:skip">Skip to content</a>
  <div class="app" id="frame" data-nav-open="false">
    <aside class="rail" id="rail" aria-label="Primary">
      <a class="brand" href="#/"><span class="brand-mark">A</span><span><b>AVGENX Academy</b><small>Coding Institute Platform</small></span></a>
      <div class="role-card" id="who"></div>
      <nav class="nav" id="nav" aria-label="Main navigation"></nav>
      <div class="rail-foot">
        <button type="button" data-act="g:palette">${icon('search')}<span>Search</span> <kbd style="margin-left:auto">Ctrl K</kbd></button>
        <button type="button" data-act="g:shortcuts">${icon('key')}<span>Keyboard shortcuts</span></button>
      </div>
    </aside>
    <div class="scrim" data-act="g:closeNav"></div>
    <div class="main">
      <header class="topbar">
        <button type="button" class="icon-btn menu-btn" data-act="g:openNav" aria-label="Open navigation" aria-controls="rail">${icon('menu')}</button>
        <button type="button" class="search-trigger" data-act="g:palette" aria-label="Search everything">${icon('search')}<span class="label-long">Search courses, problems, people, jobs…</span><span class="label-short">Search</span><kbd>Ctrl K</kbd></button>
        <div class="top-actions">
          <span class="demo-flag${PREVIEW ? ' preview-flag' : ''}" title="${PREVIEW ? 'Preview build: no server, no real accounts, sample data only' : 'Learning records are generated sample data stored in this browser; sign-in and accounts are real'}">${PREVIEW ? 'Preview' : 'Sample data'}</span>
          <span id="copilot-slot"></span>
          <button type="button" class="icon-btn" data-act="g:theme" aria-label="Toggle colour theme" id="theme-btn">${icon('moon')}</button>
          <a class="icon-btn" href="#/notifications" aria-label="Notifications" id="bell">${icon('bell')}</a>
          <a href="#/me" class="avatar pencil hide-sm" id="me-avatar" aria-label="My preferences"></a>
        </div>
      </header>
      <main class="view" id="main" tabindex="-1"></main>
    </div>
  </div>`;
}

function badgeCounts(me, s) {
  const ov = s.settings.permOverrides;
  const has = (p) => canRaw(me.role, p, ov);
  const b = {};
  if (me.role === 'student') b.projects = s.projects.filter((p) => p.studentId === me.id && p.state === 'revision').length;
  else if (has('projects.review')) { const mine = me.role === 'instructor' ? s.projects.filter((p) => p.reviewerId === me.id) : s.projects; b.projects = mine.filter((p) => ['submitted', 'under_review'].includes(p.state)).length; }
  if (has('assess.grade')) b.grading = s.attempts.filter((a) => a.status === 'needs_grading').length;
  if (has('mentor.workspace')) b.mentor = s.mentorRequests.filter((r) => r.status === 'open' && (me.role !== 'mentor' || r.mentorId === me.id)).length;
  if (has('community.moderate')) b.reports = s.threads.filter((t) => t.reports.length && t.status !== 'hidden').length;
  if (has('admissions.manage')) b.admissions = s.admissions.filter((a) => ['applied', 'screening'].includes(a.stage)).length;
  if (has('courses.approve')) b.review = s.courses.filter((c) => c.status === 'review').length;
  if (has('reports.view')) b.risk = riskAll().filter((r) => r.level === 'high' && (me.role !== 'mentor' || s.students.find((x) => x.id === r.studentId)?.mentorId === me.id)).length;
  return b;
}

function renderChrome() {
  const s = store.getState();
  const ui = store.getUI();
  const me = actor();
  const groups = navFor(me.role, s.settings.permOverrides);
  const counts = badgeCounts(me, s);
  const path = current.path;
  const isCurrent = (p) => path === p || (p !== '/' && path.startsWith(p + '/')) || (p === '/programs' && path.startsWith('/course/'));
  const hidden = { '/discussions': !flag('community'), '/groups': !flag('community'), '/placement': !flag('placement'), '/jobs': !flag('placement'), '/interview': !flag('placement'), '/ops/placements': !flag('placement'), '/corporate': !flag('corporate'), '/admin/orgs': !flag('corporate') };
  $('#nav').innerHTML = groups.map((g) => {
    const items = g.items.filter((i) => !hidden[i.path]);
    if (!items.length) return '';
    const collapsed = !!ui.nav[g.group];
    return `<div class="nav-group" data-collapsed="${collapsed}"><button type="button" data-act="g:navGroup" data-id="${esc(g.group)}" aria-expanded="${!collapsed}">${esc(g.group)}${icon('chevron')}</button><ul>${items.map((i) => `<li><a href="#${i.path}" ${isCurrent(i.path) ? 'aria-current="page"' : ''}>${icon(i.icon)}<span>${esc(i.label)}</span>${i.badge && counts[i.badge] ? `<span class="badge" aria-label="${counts[i.badge]} pending">${counts[i.badge]}</span>` : ''}</a></li>`).join('')}</ul></div>`;
  }).join('');
  const acct = getIdentity();
  const shown = acct?.name || me.name;
  $('#who').innerHTML = `<div class="who"><span class="avatar sm pencil" aria-hidden="true">${esc(initials(shown))}</span><span><b>${esc(shown)}</b><small>${esc(roleById[me.role].label)}</small></span></div>${me.user && me.user.name !== shown ? `<div class="linked">Linked profile: ${esc(me.user.name)} (sample data)</div>` : ''}<button type="button" class="signout" data-act="g:signout" id="signout">${icon('out')}<span>${PREVIEW ? 'Leave preview' : 'Sign out'}</span></button>`;
  const unread = s.notifications.filter((n) => n.userId === me.id && !n.read).length;
  $('#bell').innerHTML = `${icon('bell')}${unread ? `<span class="dot">${unread > 99 ? '99+' : unread}</span>` : ''}`;
  $('#bell').setAttribute('aria-label', `Notifications, ${unread} unread`);
  $('#me-avatar').textContent = initials(shown);
  const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  $('#theme-btn').innerHTML = icon(dark ? 'sun' : 'moon');
  $('#copilot-slot').innerHTML = flag('aiCopilot') && can('ai.use') ? copilotButton() : '';
}

// ---------------------------------------------------------------- render
function queueRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; render(); });
}

function render({ routeChanged = false } = {}) {
  const { path, query } = parseHash();
  const m = match(compiled, path === '/' ? roleById[actor().role].home : path);
  if (path === '/' ) { nav(roleById[actor().role].home); return; }
  const main = $('#main');
  const keepFocus = !routeChanged && document.activeElement && document.activeElement.id && main.contains(document.activeElement) ? { id: document.activeElement.id, start: document.activeElement.selectionStart, end: document.activeElement.selectionEnd } : null;
  if (routeChanged && current.view?.unmount) { try { current.view.unmount(); } catch (e) { console.error(e); } }
  current = { view: m?.route.view || null, params: m?.params || {}, query, path, route: m?.route };
  renderChrome();
  const ctx = makeCtx();
  let html;
  let title = 'Not found';
  let rendered = false;
  try {
    if (!m) html = `<div class="denied"><h1>Page not found</h1><p class="muted">The address ${esc(path)} does not match any page.</p><a class="btn btn-primary" href="#/">Go to your home page</a></div>`;
    else {
      const perms = m.route.perms || m.route.view.perms;
      if (ctx.s.accounts[ctx.me.id]?.status === 'deactivated') { html = `<div class="denied"><div class="lock">${icon('lock')}</div><h2>This account is deactivated</h2><p class="muted">${esc(ctx.me.name)} cannot access the platform. An administrator can reactivate it under Administration, People Directory.</p></div>`; title = 'Account deactivated'; }
      else if (perms && !canAny(ctx.me.role, perms, ctx.s.settings.permOverrides)) { html = denied(m.route.label || 'this page'); title = 'Access denied'; }
      else if (m.route.flag && !flag(m.route.flag)) { html = `<div class="denied"><div class="lock">${icon('flag')}</div><h2>This feature is switched off</h2><p class="muted">An administrator disabled it under System Settings, Feature flags.</p></div>`; title = 'Feature disabled'; }
      else { html = m.route.view.render(ctx, m.route); rendered = true; title = (typeof m.route.view.title === 'function' ? m.route.view.title(ctx, m.route) : m.route.label) || 'AVGENX Academy'; }
    }
  } catch (err) {
    console.error('[render]', err);
    html = `<div class="panel" role="alert"><h2>Something went wrong on this page</h2><p class="muted" style="margin-top:6px">The error was contained so the rest of the app keeps working. Details: <span class="mono">${esc(err.message)}</span></p><div class="row" style="margin-top:14px"><button class="btn btn-primary" type="button" data-act="g:retry">Try again</button><a class="btn btn-ghost" href="#/">Go home</a></div></div>`;
    title = 'Error';
  }
  main.innerHTML = html;
  document.title = `${title} · AVGENX Academy`;
  if (routeChanged) { window.scrollTo(0, 0); main.focus({ preventScroll: true }); }
  if (keepFocus) { const el = document.getElementById(keepFocus.id); if (el) { el.focus(); try { if (keepFocus.start != null) el.setSelectionRange(keepFocus.start, keepFocus.end); } catch { /* not a text input */ } } }
  if (rendered) try { m.route.view.mount?.(main, ctx, m.route); } catch (err) { console.error('[mount]', err); }
  ctx.refreshPanel();
}

// ---------------------------------------------------------------- events
const GLOBAL = {
  'g:signout': (el) => { el.disabled = true; store.flush(); signOut(); },
  'g:theme': () => { const r = document.documentElement; const dark = r.dataset.theme ? r.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches; r.dataset.theme = dark ? 'light' : 'dark'; store.setUI({ theme: r.dataset.theme }, { silent: true }); renderChrome(); },
  'g:palette': () => openPalette(),
  'g:navGroup': (el) => { const ui = store.getUI(); store.setUI({ nav: { ...ui.nav, [el.dataset.id]: !ui.nav[el.dataset.id] } }, { silent: true }); renderChrome(); },
  'g:openNav': () => { $('#frame').dataset.navOpen = 'true'; $('#nav a')?.focus(); },
  'g:closeNav': () => { $('#frame').dataset.navOpen = 'false'; },
  'g:retry': () => render(),
  'g:skip': (el, e) => { e.preventDefault(); $('#main').focus(); },
  'g:copilot': () => openCopilot(makeCtx(), current),
  'g:shortcuts': () => modal({ title: 'Keyboard shortcuts', body: `<dl class="dl"><dt><kbd>Ctrl</kbd> + <kbd>K</kbd> or <kbd>/</kbd></dt><dd>Search everything</dd><dt><kbd>G</kbd> then <kbd>D</kbd></dt><dd>Go to dashboard</dd><dt><kbd>G</kbd> then <kbd>L</kbd></dt><dd>Go to Coding Lab</dd><dt><kbd>G</kbd> then <kbd>N</kbd></dt><dd>Notifications</dd><dt><kbd>Ctrl</kbd> + <kbd>Enter</kbd></dt><dd>Run code (in the lab)</dd><dt><kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>Enter</kbd></dt><dd>Submit code (in the lab)</dd><dt><kbd>Alt</kbd> + <kbd>Shift</kbd> + <kbd>F</kbd></dt><dd>Format code</dd><dt><kbd>Esc</kbd></dt><dd>Close dialogs and panels</dd><dt><kbd>?</kbd></dt><dd>This list</dd></dl>` }),
};

function handler(name) {
  if (name.startsWith('g:')) return GLOBAL[name];
  return current.view?.actions?.[name];
}
function run(name, el, ev) {
  const fn = handler(name);
  if (!fn) { console.warn('[action] no handler for', name); return; }
  try { const r = fn(el, ev, makeCtx()); if (r?.catch) r.catch(toastError); } catch (err) { toastError(err); }
}

function wire() {
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    if (el.tagName === 'A' && !el.dataset.act.startsWith('g:skip')) { /* links with actions run the action instead of navigating */ e.preventDefault(); }
    if ($('#frame')?.dataset.navOpen === 'true' && el.closest('#nav')) $('#frame').dataset.navOpen = 'false';
    run(el.dataset.act, el, e);
  });
  document.addEventListener('click', (e) => { if (e.target.closest('#nav a') && $('#frame')) $('#frame').dataset.navOpen = 'false'; });
  document.addEventListener('keydown', (e) => {
    const el = e.target.closest?.('tr[data-act]');
    if (el && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); run(el.dataset.act, el, e); }
  });
  document.addEventListener('submit', (e) => {
    const f = e.target.closest('form[data-form]');
    if (!f) return;
    e.preventDefault();
    const data = {};
    [...f.elements].forEach((x) => { if (!x.name) return; if (x.type === 'checkbox') data[x.name] = x.checked; else if (x.type === 'radio') { if (x.checked) data[x.name] = x.value; } else if (x.type === 'file') data[x.name] = x.files; else if (x.multiple) data[x.name] = [...x.selectedOptions].map((o) => o.value); else data[x.name] = x.value; });
    const fn = current.view?.forms?.[f.dataset.form];
    if (!fn) { console.warn('[form] no handler for', f.dataset.form); return; }
    try { const r = fn(f, data, makeCtx(), e); if (r?.catch) r.catch(toastError); } catch (err) { toastError(err); }
  });
  for (const type of ['change', 'input']) document.addEventListener(type, (e) => {
    const el = e.target.closest?.(`[data-${type}]`);
    if (el) run(el.dataset[type], el, e);
  });
  paletteKeys({ go: nav, shortcuts: () => GLOBAL['g:shortcuts'](), copilot: () => flag('aiCopilot') && can('ai.use') && GLOBAL['g:copilot']() });
  window.addEventListener('hashchange', () => render({ routeChanged: true }));
  window.addEventListener('beforeunload', () => store.flush());
  window.addEventListener('pagehide', () => store.flush());
  window.addEventListener('error', (e) => console.error('[uncaught]', e.message));
  window.addEventListener('unhandledrejection', (e) => console.error('[unhandled]', e.reason));
  store.subscribe((d) => {
    if (current.view?.onStoreChange && current.view.onStoreChange(makeCtx(), d) === false) { renderChrome(); return; }
    queueRender();
  });
}

// ---------------------------------------------------------------- boot
/** Start the LMS for a verified identity. */
function start() {
  const ui = store.getUI();
  applyDisplayPrefs(store.getState().prefs[actor().id] || {}, ui.theme);
  shell();
  wire();
  initAI().then(() => renderChrome());
  if (!store.isPersistent()) setTimeout(() => toast('Browser storage is unavailable, so changes to sample data will reset when you close this tab.'), 400);
  // Land on a page this role may open: deep links that the role cannot use go to its home page.
  const { path } = parseHash();
  const m = path !== '/' && match(compiled, path);
  const perms = m && (m.route.perms || m.route.view.perms);
  if (m && perms && !canAny(actor().role, perms, store.getState().settings.permOverrides)) { history.replaceState(null, '', `#${roleById[actor().role].home}`); setTimeout(() => toast('That page is not available for your role, so you are on your home page.'), 300); }
  render({ routeChanged: true });
  const flash = tabNote.get('avgenx-flash');
  if (flash) { tabNote.del('avgenx-flash'); setTimeout(() => toast(flash, { ms: 7000 }), 500); }
}

async function previewBoot() {
  const chosen = readPreview();
  if (chosen) { setIdentity({ mode: 'preview', role: chosen.role, lmsRef: chosen.ref, name: null }); return start(); }
  const [{ mountLogin }, { default: css }] = await Promise.all([import('./login/view.js'), import('./login/login.css?text')]);
  const host = $('#app');
  const root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
  root.innerHTML = '<style></style><div id="login-root"></div>';
  root.querySelector('style').textContent = css;
  mountLogin(root.querySelector('#login-root'), {
    mode: 'preview',
    onPreview(role, ref) {
      const s = store.getState();
      if (ref) {
        const ok = role === 'student' ? s.students.some((x) => x.id === ref) : s.users.some((u) => u.id === ref && u.role === role);
        if (!ok) return `No sample ${roleById[role].short.toLowerCase()} has the ID ${ref}.`;
      }
      savePreview({ role, ref: ref || null });
      location.reload();
      return '';
    },
  });
}

async function serverBoot() {
  if (location.protocol === 'file:') {
    $('#app').innerHTML = `<div style="max-width:560px;margin:12vh auto;padding:0 16px;font:16px/1.6 system-ui,sans-serif"><h1 style="font-size:1.6rem;margin:0 0 8px">Start the AVGENX server</h1><p>This page was opened as a file. The signed-in platform only runs through the server.</p><p>In a terminal in the <b>avgenx-academy</b> folder run <code>npm start</code>, then open the address it prints, <a href="http://127.0.0.1:8080">http://127.0.0.1:8080</a>. To look around without the server, open <b>dist/preview.html</b>.</p></div>`;
    return;
  }
  let me;
  try {
    const r = await fetchMe();
    if (!r.ok) throw new Error(String(r.status));
    me = r.data;
  } catch { location.replace('/'); return; }
  if (me.restricted) { location.replace('/'); return; }
  setIdentity({ mode: 'server', role: me.user.role, lmsRef: me.user.lmsRef, userId: me.user.userId, name: me.user.name, email: me.user.email, csrf: me.csrf, features: me.features });
  if (me.features?.ai) setServerAI('/api/ai');
  start();
  watchSession();
}

/**
 * The session can end while this tab is open (server restarted, signed out elsewhere, account
 * disabled). Check when the tab comes back into focus and once a minute; if the server no longer
 * knows us, go to the sign-in page. A server that cannot be reached is left alone.
 */
function watchSession() {
  let busy = false;
  const check = async () => {
    if (busy || document.hidden) return;
    busy = true;
    try { const r = await fetchMe(); if (r.status === 401 || (r.ok && r.data.restricted)) { store.flush(); tabNote.set('avgenx-signed-out', '1'); location.replace('/'); } } catch { /* offline: try again later */ } finally { busy = false; }
  };
  document.addEventListener('visibilitychange', check);
  window.addEventListener('focus', check);
  setInterval(check, 60000);
}

export function boot() {
  const { ui } = store.init();
  if (ui.theme) document.documentElement.dataset.theme = ui.theme;
  (PREVIEW ? previewBoot() : serverBoot()).catch((e) => { console.error('[boot]', e); });
}
boot();
