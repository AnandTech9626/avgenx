// Notification centre and personal preferences (notifications, learning goals, accessibility, privacy).
import { esc, fmtDateTime, relDays } from '../core/util.js';
import { icon } from '../core/icons.js';
import { pageHead, pill, btn, empty, chips, toggle, select, input, check } from '../core/ui.js';
import * as store from '../core/store.js';
import { getIdentity, csrfToken } from '../core/session.js';
import { authFetch } from '../services/auth.js';
import { roleById } from '../core/rbac.js';
import { LANGS } from '../services/executor.js';

export const CATS = { deadline: ['Deadlines', 'clock'], review: ['Reviews', 'folder'], mentor: ['Mentor replies', 'users'], class: ['Classes', 'video'], result: ['Results', 'exam'], announcement: ['Announcements', 'bell'], placement: ['Placement', 'brief'], certificate: ['Certificates', 'cert'], admin: ['Admin alerts', 'shield'] };
const prefsOf = (ctx) => ctx.s.prefs[ctx.me.id] || {};

export const notifications = {
  title: () => 'Notifications',
  render(ctx) {
    const F = ctx.local('notif', { cat: 'all', unread: false });
    const muted = new Set(Object.entries(prefsOf(ctx).notif || {}).filter(([, v]) => v === false).map(([k]) => k));
    let list = ctx.s.notifications.filter((n) => n.userId === ctx.me.id && !muted.has(n.cat)).sort((a, b) => (a.at < b.at ? 1 : -1));
    const unread = list.filter((n) => !n.read).length;
    const counts = Object.fromEntries(Object.keys(CATS).map((c) => [c, list.filter((n) => n.cat === c).length]));
    if (F.cat !== 'all') list = list.filter((n) => n.cat === F.cat);
    if (F.unread) list = list.filter((n) => !n.read);
    return `<div class="page" style="max-width:900px">${pageHead({ title: 'Notifications', lede: `${unread} unread. Choose categories and channels in Preferences.`, actions: `${btn('Mark all as read', { act: 'readAll', ic: 'check', disabled: !unread })}${btn('Preferences', { href: '/me', ic: 'gear' })}` })}
      <div class="toolbar">${chips([['all', 'All'], ...Object.entries(CATS).filter(([k]) => counts[k]).map(([k, v]) => [k, `${v[0]} (${counts[k]})`])], F.cat, 'cat', { label: 'Category' })}<label class="check ml-auto"><input type="checkbox" data-change="unread" ${F.unread ? 'checked' : ''}><span>Unread only</span></label></div>
      ${list.length ? `<div class="panel flush notif-list">${list.map((n) => `<div class="notif ${n.read ? '' : 'unread'}"><span class="n-ic">${icon(CATS[n.cat]?.[1] || 'bell')}</span><button type="button" class="n-body" data-act="open" data-id="${n.id}"><b>${esc(n.title)}</b><span class="small muted">${esc(n.body)}</span><span class="xs muted">${esc(CATS[n.cat]?.[0] || n.cat)} · ${relDays(n.at, ctx.now)} · ${fmtDateTime(n.at)}</span></button><button type="button" class="btn btn-quiet btn-xs" data-act="toggle" data-id="${n.id}" aria-label="Mark as ${n.read ? 'unread' : 'read'}">${n.read ? 'Mark unread' : 'Mark read'}</button></div>`).join('')}</div>` : empty(F.unread ? 'You are all caught up' : 'No notifications', '', { ic: 'bell' })}</div>`;
  },
  actions: {
    cat(el, e, ctx) { ctx.local('notif').cat = el.dataset.id; ctx.rerender(); },
    unread(el, e, ctx) { ctx.local('notif').unread = el.checked; ctx.rerender(); },
    readAll(el, e, ctx) { ctx.commit('notif.readAll', (s) => s.notifications.forEach((n) => { if (n.userId === ctx.me.id) n.read = true; }), { ok: 'All marked as read' }); },
    toggle(el, e, ctx) { ctx.commit('notif.toggle', (s) => { const n = s.notifications.find((x) => x.id === el.dataset.id); n.read = !n.read; }); },
    open(el, e, ctx) { const n = ctx.s.notifications.find((x) => x.id === el.dataset.id); ctx.commit('notif.read', () => { n.read = true; }, { silent: true }); ctx.nav(n.link || '/'); },
  },
};

export const preferences = {
  title: () => 'Preferences',
  render(ctx) {
    const p = prefsOf(ctx);
    const st = ctx.me.role === 'student' ? ctx.s.students.find((x) => x.id === ctx.me.id) : null;
    const n = p.notif || {};
    const blocked = (p.blocked || []).map((id) => ctx.s.students.find((s) => s.id === id)).filter(Boolean);
    const acct = getIdentity();
    const accountPanel = acct?.mode === 'server' ? `<form class="panel stack" data-form="password" novalidate><h2>Account and password</h2>
        <dl class="dl"><dt>User ID</dt><dd class="mono">${esc(acct.userId)}</dd><dt>Name</dt><dd>${esc(acct.name)}</dd><dt>Email</dt><dd>${esc(acct.email)}</dd><dt>Signed in as</dt><dd>${esc(roleById[acct.role].label)}</dd></dl>
        ${acct.features?.passwordsInFile ? '<div class="callout info small">Your institute keeps passwords in its account file, so its administrators can see the password you choose. Do not reuse a password you use anywhere else.</div>' : ''}
        <div class="form-grid">${input({ id: 'current', label: 'Current password', type: 'password', req: true, a: { autocomplete: 'current-password', maxlength: 128 } })}${input({ id: 'next', label: 'New password', type: 'password', req: true, hint: 'At least 12 characters. Other devices will be signed out.', a: { autocomplete: 'new-password', maxlength: 128 } })}${input({ id: 'confirm', label: 'Confirm new password', type: 'password', req: true, a: { autocomplete: 'new-password', maxlength: 128 } })}</div>
        <div class="row"><button class="btn btn-primary" type="submit">Change password</button></div></form>` : '';
    return `<div class="page" style="max-width:900px">${pageHead({ title: 'Preferences', lede: `Signed in as ${esc(acct?.name || ctx.me.name)} (${esc(roleById[ctx.me.role].label)}). Display and notification settings are kept on this device.` })}
      ${accountPanel}
      <form class="panel stack" data-form="prefs"><h2>Notifications</h2><p class="small muted">In-app notifications per category. Email, SMS and push need their integrations; you can choose them now and they start once connected.</p>
        <div class="grid g2" style="--gap:10px">${Object.entries(CATS).map(([k, v]) => toggle({ id: `n-${k}`, label: v[0], checked: n[k] !== false })).join('')}</div>
        <div class="row" style="--gap:18px">${['email', 'sms', 'push'].map((c) => `<label class="check"><input type="checkbox" name="ch-${c}" ${p.channels?.[c] ? 'checked' : ''}><span>${c.toUpperCase()} ${pill(ctx.s.settings.integrations[c]?.endpoint ? 'Connected' : 'Not connected', ctx.s.settings.integrations[c]?.endpoint ? 'p-ok' : 'p-mute', true)}</span></label>`).join('')}</div>
        ${st ? `<h2 style="margin-top:8px">Learning</h2><div class="form-grid">${input({ id: 'goal', label: 'Weekly learning goal (minutes)', type: 'number', value: st.weeklyGoalMins, a: { min: 60, max: 2400, step: 30 } })}${select({ id: 'lang', label: 'Preferred coding language', value: st.lang, options: LANGS.map((l) => [l.id, l.label]) })}</div>
          <h2 style="margin-top:8px">Privacy and consent</h2>${check({ id: 'analytics', label: 'Use my learning activity to personalise recommendations and risk alerts. Staff still see records needed to teach and support you.', checked: p.consent?.analytics !== false })}${check({ id: 'recruiters', label: 'Allow the placement office to share my portfolio with partner employers when I apply.', checked: p.consent?.recruiters !== false })}` : ''}
        <h2 style="margin-top:8px">Display and accessibility</h2><div class="form-grid">${select({ id: 'theme', label: 'Theme', value: store.getUI().theme || 'system', options: [['system', 'Match my device'], ['light', 'Light'], ['dark', 'Dark']] })}${select({ id: 'text', label: 'Text size', value: p.textSize || '100', options: [['100', 'Default'], ['112', 'Large'], ['125', 'Extra large']] })}${select({ id: 'motion', label: 'Motion', value: p.motion || 'system', options: [['system', 'Match my device'], ['reduce', 'Reduce motion']] })}</div>
        <div class="row"><button class="btn btn-primary" type="submit">Save preferences</button></div></form>
      ${blocked.length ? `<section class="panel"><h2>Blocked people</h2><div class="list" style="margin-top:8px">${blocked.map((b) => `<div class="item"><span class="grow">${esc(b.name)}</span>${btn('Unblock', { act: 'unblock', sm: true, attrs: { 'data-id': b.id } })}</div>`).join('')}</div></section>` : ''}
      ${st ? `<section class="panel stack"><h2>Your data</h2><p class="small muted">Get a copy of the records this platform holds about you (profile, enrollments, submissions, attempts, projects, certificates). In production this request is logged and fulfilled by the server.</p><div class="row">${btn('Copy my data as JSON', { act: 'export', ic: 'copy' })}</div></section>` : ''}</div>`;
  },
  actions: {
    unblock(el, e, ctx) { ctx.commit('user.unblock', (s) => { const p = s.prefs[ctx.me.id]; p.blocked = (p.blocked || []).filter((x) => x !== el.dataset.id); }, { ok: 'Unblocked' }); },
    export(el, e, ctx) {
      const s = ctx.s, id = ctx.me.id;
      const data = { exportedAt: new Date().toISOString(), profile: s.students.find((x) => x.id === id), enrollments: s.enrollments.filter((x) => x.studentId === id), submissions: s.submissions.filter((x) => x.studentId === id), attempts: s.attempts.filter((x) => x.studentId === id), projects: s.projects.filter((x) => x.studentId === id), certificates: s.certificates.filter((x) => x.studentId === id), applications: s.applications.filter((x) => x.studentId === id), mentorRequests: s.mentorRequests.filter((x) => x.studentId === id), note: 'Private mentor notes are excluded from self-service export and are released on formal request.' };
      const text = JSON.stringify(data, null, 2);
      ctx.commit('data.export.self', () => {}, { audit: { action: 'export.self', entity: 'student', entityId: id, kind: 'data' }, silent: true });
      navigator.clipboard?.writeText(text).then(() => ctx.toast(`Copied ${Math.round(text.length / 1024)} KB of JSON to your clipboard`), () => ctx.modal({ title: 'Your data', wide: true, body: `<textarea class="textarea mono" rows="16" readonly>${esc(text)}</textarea>` }));
    },
  },
  forms: {
    async password(form, d, ctx) {
      if (d.next !== d.confirm) return ctx.toast('The new passwords do not match.', { tone: 'bad' });
      const btnEl = form.querySelector('button[type="submit"]'); btnEl.disabled = true;
      try {
        const r = await authFetch('/api/auth/change-password', { current: d.current, next: d.next }, csrfToken());
        if (!r.ok) { btnEl.disabled = false; return ctx.toast(r.data.message || 'Could not change the password.', { tone: 'bad' }); }
        ctx.toast(r.data.file === 'written' ? 'Password changed and written to accounts.xlsx. Other devices were signed out.' : r.data.file === 'queued' ? 'Password changed. accounts.xlsx is open in Excel, so it will be written there as soon as the file is closed.' : 'Password changed. Other devices were signed out.', { ms: 7000 });
        setTimeout(() => location.reload(), 900); // the session was rotated; reload picks up the new CSRF token
      } catch { btnEl.disabled = false; ctx.toast('Could not reach the server.', { tone: 'bad' }); }
    },
    prefs(form, d, ctx) {
      const errs = [];
      if (d.goal !== undefined && !(Number(d.goal) >= 60 && Number(d.goal) <= 2400)) errs.push('Weekly goal must be 60 to 2,400 minutes.');
      if (errs.length) return ctx.toast(errs.join(' '), { tone: 'bad' });
      ctx.commit('prefs.save', (s) => {
        const p = (s.prefs[ctx.me.id] ||= {});
        p.notif = Object.fromEntries(Object.keys(CATS).map((k) => [k, !!d[`n-${k}`]]));
        p.channels = { email: !!d['ch-email'], sms: !!d['ch-sms'], push: !!d['ch-push'] };
        p.textSize = d.text; p.motion = d.motion;
        if (ctx.me.role === 'student') { const st = s.students.find((x) => x.id === ctx.me.id); st.weeklyGoalMins = Number(d.goal); st.lang = d.lang; p.consent = { analytics: !!d.analytics, recruiters: !!d.recruiters }; }
      }, { ok: 'Preferences saved' });
      store.setUI({ theme: d.theme === 'system' ? null : d.theme }, { silent: true });
      applyDisplayPrefs(ctx.s.prefs[ctx.me.id], d.theme);
    },
  },
};

/** Apply text size, motion and theme preferences to the document. */
export function applyDisplayPrefs(p = {}, theme = store.getUI().theme) {
  const r = document.documentElement;
  if (theme && theme !== 'system') r.dataset.theme = theme; else delete r.dataset.theme;
  r.style.fontSize = p.textSize && p.textSize !== '100' ? `${p.textSize}%` : '';
  r.classList.toggle('reduce-motion', p.motion === 'reduce');
}
