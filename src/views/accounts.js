// Accounts and sign-in: administrator console for the real account store on the AVGENX server.
// Every action here is an API call that the server authorises again; hiding a button is only a
// convenience. Temporary passwords and links are shown once and never stored in the browser.
import { esc, fmtDateTime } from '../core/util.js';
import { icon } from '../core/icons.js';
import { pageHead, pill, btn, empty, tabs, table, kpi, select, input, searchBox, avatar } from '../core/ui.js';
import { ROLES, roleById, PRIVILEGED_ROLES } from '../core/rbac.js';
import { createApi } from '../services/api.js';
import { csrfToken, getIdentity, PREVIEW } from '../core/session.js';
import { getState } from '../core/store.js';

const api = createApi({ baseUrl: '/api', getCsrf: csrfToken, retries: 1 });
const data = { accounts: null, audit: null, source: null, loading: false, error: '' };
const fileMode = () => data.source?.kind === 'excel';
let searchT;

async function load(ctx, what = ['accounts']) {
  data.loading = true; data.error = '';
  try {
    if (what.includes('accounts')) { const r = await api.get('/admin/accounts'); data.accounts = r.accounts; data.source = r.source; }
    if (what.includes('audit')) data.audit = (await api.get('/admin/audit')).events;
  } catch (e) { if (e.status === 401) { location.replace('/'); return; } data.error = e.message; }
  data.loading = false;
  ctx.rerender();
}

const ACTION_LABEL = {
  'account.create': 'Account created', 'account.update': 'Details changed', 'account.roles': 'Roles changed', 'account.disable': 'Account disabled', 'account.enable': 'Account enabled', 'account.delete': 'Account deleted',
  'password.admin_reset': 'Temporary password issued', 'password.reset_link': 'Reset link issued', 'password.forgot': 'Reset requested', 'password.reset': 'Password reset', 'password.change': 'Password changed', 'invite.accept': 'Invitation accepted',
  'sessions.revoke': 'Sessions revoked', 'login.success': 'Signed in', 'login.failed': 'Sign-in failed', 'login.blocked': 'Sign-in blocked', 'login.locked': 'Sign-in rate limited', logout: 'Signed out', 'register.export': 'Register exported',
};
const myRole = () => getIdentity()?.role;
const canTouch = (roles) => myRole() === 'superadmin' || !roles.some((r) => PRIVILEGED_ROLES.includes(r));
const grantable = () => ROLES.filter((r) => myRole() === 'superadmin' || !PRIVILEGED_ROLES.includes(r.id));
const statusPill = (a) => (a.status === 'active' ? pill('Active', 'p-ok') : pill('Disabled', 'p-bad'));

/** LMS profiles from the sample data that an account can be linked to, for a role. */
function profilesFor(ctx, role) {
  if (role === 'student') return ctx.s.students.map((x) => [x.id, `${x.name} (${x.id})`]);
  return ctx.s.users.filter((u) => u.role === role).map((u) => [u.id, `${u.name} (${u.id})`]);
}

function oneTime(ctx, { title, intro, label, value }) {
  ctx.modal({
    title,
    body: `<p>${intro}</p><div class="field" style="margin-top:12px"><label for="secret">${esc(label)}</label><div class="row nowrap"><input class="input mono" id="secret" value="${esc(value)}" readonly style="flex:1"><button type="button" class="btn btn-primary" id="copy-secret">${icon('copy')}<span>Copy</span></button></div></div><div class="callout bad small" style="margin-top:12px">This is shown once. It is not stored in the browser and cannot be displayed again. Share it with the person through a private channel.</div>`,
    onMount(m) {
      const i = m.querySelector('#secret');
      i.addEventListener('focus', () => i.select());
      m.querySelector('#copy-secret').addEventListener('click', () => navigator.clipboard?.writeText(value).then(() => ctx.toast('Copied'), () => { i.focus(); i.select(); ctx.toast('Press Ctrl+C to copy'); }));
    },
  });
}

function rolesFieldset(selected, { disabledAll = false, lockRole = null } = {}) {
  return `<fieldset class="field"><legend style="font-weight:600;font-size:.86rem;margin-bottom:6px">Roles</legend><div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:6px 14px">${ROLES.map((r) => {
    const allowed = grantable().some((g) => g.id === r.id) && !disabledAll;
    const locked = r.id === lockRole;
    return `<label class="check"><input type="checkbox" name="roles" value="${r.id}" ${selected.includes(r.id) ? 'checked' : ''} ${!allowed || locked ? 'disabled' : ''}><span>${esc(r.label)}${!allowed ? ' <span class="xs muted">(super admin only)</span>' : locked ? ' <span class="xs muted">(your current role)</span>' : ''}</span></label>`;
  }).join('')}</div><span class="hint">Selecting a role at sign-in only works if it is assigned here. Institute administrators cannot grant super administrator, institute administrator or CEO.</span></fieldset>`;
}
const checkedRoles = (f) => [...f.querySelectorAll('input[name="roles"]')].filter((x) => x.checked).map((x) => x.value);
function fieldErrors(f, fields = {}) {
  f.querySelectorAll('.error-text').forEach((x) => x.remove());
  f.querySelectorAll('[aria-invalid]').forEach((x) => x.removeAttribute('aria-invalid'));
  for (const [k, msg] of Object.entries(fields)) {
    const el = f.querySelector(`[name="${k}"]`);
    if (!el) continue;
    el.setAttribute('aria-invalid', 'true');
    el.closest('.field')?.insertAdjacentHTML('beforeend', `<span class="error-text" role="alert">${esc(msg)}</span>`);
  }
}
const busy = (f, on) => f.querySelectorAll('button').forEach((b) => { b.disabled = on; });

// ---------------------------------------------------------------- panels
function createPanel(ctx) {
  const first = grantable().find((r) => r.id === 'student') || grantable()[0];
  ctx.openPanel(() => ({
    title: 'Create account', sub: 'Accounts are created only here. There is no public sign-up.', wide: true,
    body: `<form data-form="create" class="stack" novalidate>
      <div class="form-grid">${input({ id: 'name', label: 'Full name', req: true, a: { autocomplete: 'off', maxlength: 80 } })}${input({ id: 'email', label: 'Email', type: 'email', req: true, a: { autocomplete: 'off', maxlength: 254 } })}</div>
      ${input({ id: 'userId', label: 'User ID', hint: 'Leave empty to generate a unique ID such as STU-7K2QXM.', a: { autocomplete: 'off', maxlength: 32, spellcheck: 'false' } })}
      ${rolesFieldset([first.id])}
      ${select({ id: 'lmsRef', label: 'Linked learning profile', options: profilesFor(ctx, first.id), hint: 'Learning records in this build are sample data, so each account opens one sample profile.' })}
      <fieldset class="field"><legend style="font-weight:600;font-size:.86rem;margin-bottom:6px">First sign-in</legend>
        <label class="check"><input type="radio" name="credential" value="temporary" checked><span><b>Temporary password</b>, shown to you once. The person must choose a new password at first sign-in.</span></label>
        <label class="check"><input type="radio" name="credential" value="invite"><span><b>Invitation link</b> valid for 72 hours, shown to you once. The person sets their own password.</span></label>
        <span class="hint">Email delivery is not connected, so you share the password or link yourself.</span>
      </fieldset>
      <div class="row">${btn('Create account', { type: 'submit', cls: 'btn-primary', ic: 'plus' })}</div>
    </form>`,
  }));
}

function detailPanel(ctx, id) {
  ctx.openPanel(() => {
    const a = data.accounts?.find((x) => x.id === id);
    if (!a) return { title: 'Account', body: empty('Account not found') };
    const mine = a.userId === getIdentity()?.userId;
    const accessOk = canTouch(a.roles);
    const editable = accessOk && !fileMode();
    const roleOptions = profilesFor(ctx, a.roles[0]);
    if (a.lmsRef && !roleOptions.some(([v]) => v === a.lmsRef)) roleOptions.unshift([a.lmsRef, a.lmsRef]);
    return {
      title: a.name, sub: `${a.userId} · ${a.email}`, wide: true,
      body: `<div class="stack">
        <div class="row">${statusPill(a)}${a.mustChangePassword ? pill('Password change pending', 'p-warn') : ''}${a.invited ? pill('Invitation pending', 'p-info') : ''}${a.isTest ? pill('Development test account', 'p-warn') : ''}${mine ? pill('You', 'p-mute') : ''}</div>
        <dl class="dl"><dt>Created</dt><dd>${esc(fmtDateTime(a.createdAt))}${a.createdBy ? ` by <span class="mono">${esc(a.createdBy)}</span>` : ' (command line)'}</dd><dt>Last sign-in</dt><dd>${a.lastLoginAt ? esc(fmtDateTime(a.lastLoginAt)) : 'Never'}</dd><dt>Active sessions</dt><dd>${a.activeSessions}</dd></dl>
        ${accessOk ? '' : '<div class="callout info small">Only a super administrator can change accounts that hold the super administrator, institute administrator or CEO role.</div>'}
        ${fileMode() ? `<div class="callout info small">Name, email, roles, linked profile and status come from <b>${esc(data.source.file)}</b> on the server. Change them in the file and save it.</div>` : ''}
        <form data-form="edit" data-id="${esc(a.id)}" class="stack panel" novalidate><h3>Details</h3>
          <div class="form-grid">${input({ id: 'name', label: 'Full name', value: a.name, req: true, a: { disabled: !editable, maxlength: 80 } })}${input({ id: 'email', label: 'Email', type: 'email', value: a.email, req: true, a: { disabled: !editable, maxlength: 254 } })}</div>
          ${select({ id: 'lmsRef', label: 'Linked learning profile (sample data)', value: a.lmsRef || '', options: roleOptions, a: { disabled: !editable } })}
          ${editable ? `<div class="row">${btn('Save details', { type: 'submit', cls: 'btn-primary', sm: true })}</div>` : ''}
        </form>
        <form data-form="roles" data-id="${esc(a.id)}" class="stack panel" novalidate><h3>Roles</h3>
          ${rolesFieldset(a.roles, { disabledAll: !editable, lockRole: mine ? myRole() : null })}
          ${editable ? `<div class="row">${btn('Save roles', { type: 'submit', cls: 'btn-primary', sm: true })}</div>` : ''}
        </form>
        <section class="panel stack"><h3>Access</h3>
          <div class="row">${editable && !mine ? (a.status === 'active' ? btn('Disable account', { act: 'setStatus', cls: 'btn-danger', ic: 'lock', sm: true, attrs: { 'data-id': a.id, 'data-status': 'disabled' } }) : btn('Enable account', { act: 'setStatus', ic: 'unlock', sm: true, attrs: { 'data-id': a.id, 'data-status': 'active' } })) : ''}
          ${accessOk ? btn(`Sign out everywhere (${a.activeSessions})`, { act: 'revoke', ic: 'out', sm: true, disabled: !a.activeSessions, attrs: { 'data-id': a.id } }) : ''}</div>
          ${accessOk ? `<div class="row">${btn('Issue temporary password', { act: 'reset', ic: 'key', sm: true, attrs: { 'data-id': a.id, 'data-mode': 'temporary' } })}${btn('Create reset link', { act: 'reset', ic: 'link', sm: true, attrs: { 'data-id': a.id, 'data-mode': 'link' } })}</div><p class="hint">Either option signs the person out of every device. Reset links work once and expire in 24 hours.</p>` : ''}
        </section>
      </div>`,
    };
  });
}

// ---------------------------------------------------------------- view
export const accounts = {
  perms: ['accounts.manage'],
  title: () => 'Accounts and sign-in',
  render(ctx) {
    if (PREVIEW) return `<div class="page">${pageHead({ title: 'Accounts and sign-in', lede: 'Create accounts, assign roles, disable access, reset passwords and export the account register.' })}<section class="panel">${empty('Not available in the preview', 'This preview has no server, so there are no real accounts to manage. In the live installation this page manages the server account store, and every change is verified and audited on the server.', { ic: 'lock' })}</section></div>`;
    const F = ctx.local('acc', { tab: 'accounts', q: '', role: 'all', status: 'all', page: 1 });
    const list = data.accounts || [];
    const shown = list.filter((a) => (F.role === 'all' || a.roles.includes(F.role)) && (F.status === 'all' || a.status === F.status || (F.status === 'pending' && (a.mustChangePassword || a.invited))) && (!F.q || `${a.name} ${a.email} ${a.userId}`.toLowerCase().includes(F.q.toLowerCase())));
    const src = data.source;
    const head = pageHead({ title: 'Accounts and sign-in', lede: fileMode() ? `Only the people listed as Active in <b>${esc(src.file)}</b> on the server can sign in. Add, edit or remove people in that file and save it; the server applies it within seconds and before every sign-in.` : 'Who can sign in and with which roles. Changes take effect on the server immediately and are recorded in the sign-in audit.', actions: `<a class="btn btn-ghost" href="/api/admin/accounts.xlsx" download id="export-register">${icon('download')}<span>Export register (.xlsx)</span></a>${fileMode() ? btn('Sync now', { act: 'syncFile', cls: 'btn-primary', ic: 'refresh' }) : btn('Create account', { act: 'create', cls: 'btn-primary', ic: 'plus' })}` });
    const fileBanner = fileMode() ? `<div class="callout ${src.errors?.length || src.writeBlocked || src.pending ? 'bad' : 'ok'} small" id="file-status"><b>${esc(src.file)}</b>: ${src.lastSync ? `last applied ${esc(fmtDateTime(src.lastSync))}, ${src.active} active ${src.active === 1 ? 'person' : 'people'}` : 'not read yet'}.${src.pending ? ` <b>${src.pending} new password${src.pending === 1 ? ' is' : 's are'} waiting to be written</b> because the file is open in Excel; close it and they are saved within a few seconds.` : src.writeBlocked ? ' The server could not write to the file (is it open in Excel?). Close it so passwords and results can be filled in.' : ''}${src.errors?.length ? `<ul style="margin:6px 0 0 18px">${src.errors.slice(0, 8).map((e) => `<li>${esc(e)}</li>`).join('')}</ul>${src.errors.length > 8 ? `<div>and ${src.errors.length - 8} more; see the Sync result column.</div>` : ''}` : ''}</div>` : '';
    const t = tabs([['accounts', 'Accounts', list.length || null], ['audit', 'Sign-in audit']], F.tab, 'tab');
    if (data.error) return `<div class="page">${head}${t}<div class="callout bad" role="alert">${esc(data.error)} ${btn('Try again', { act: 'reload', sm: true })}</div></div>`;
    if (F.tab === 'audit') {
      const ev = data.audit;
      return `<div class="page">${head}${t}<section class="panel flush">${ev ? table([
        { key: 'at', label: 'When (your time)', render: (e) => `<span class="nowrap">${esc(fmtDateTime(e.at))}</span>` },
        { key: 'action', label: 'Event', render: (e) => `<b>${esc(ACTION_LABEL[e.action] || e.action)}</b>` },
        { key: 'actor', label: 'By', render: (e) => (e.actor ? `<span class="mono">${esc(e.actor)}</span>` : '<span class="muted">Anonymous or system</span>') },
        { key: 'target', label: 'Account', render: (e) => (e.target ? `<span class="mono">${esc(e.target)}</span>` : '') },
        { key: 'detail', label: 'Detail', render: (e) => `<span class="small">${esc(e.detail || '')}</span>` },
        { key: 'ip', label: 'IP', render: (e) => `<span class="mono xs">${esc(e.ip || '')}</span>` },
      ], ev, { wide: true, empty: 'No events yet', caption: 'Sign-in and account audit events, newest first' }) : `<div class="empty"><b>Loading audit events</b></div>`}</section><p class="hint">The last 300 events. The server stores this log append-only.</p></div>`;
    }
    const n = (fn) => list.filter(fn).length;
    return `<div class="page">${head}${t}
      ${fileBanner}
      <div class="kpis">${kpi({ label: 'Accounts', value: list.length })}${kpi({ label: 'Active', value: n((a) => a.status === 'active') })}${kpi({ label: 'Disabled', value: n((a) => a.status === 'disabled') })}${kpi({ label: 'Awaiting first password', value: n((a) => a.mustChangePassword || a.invited) })}</div>
      ${n((a) => a.isTest && a.status === 'active') ? `<div class="callout bad small">${n((a) => a.isTest && a.status === 'active')} development test accounts are active. Remove them before going live; the server refuses to start in production while they exist.</div>` : ''}
      <div class="toolbar"><div class="grow-field">${searchBox({ id: 'acc-q', value: F.q, placeholder: 'Search name, email or user ID', a: { 'data-input': 'q' } })}</div>${select({ id: 'acc-r', label: 'Role', value: F.role, options: [['all', 'All roles'], ...ROLES.map((r) => [r.id, r.label])], a: { 'data-change': 'f', 'data-key': 'role' }, sm: true })}${select({ id: 'acc-s', label: 'Status', value: F.status, options: [['all', 'All'], ['active', 'Active'], ['disabled', 'Disabled'], ['pending', 'Awaiting first password']], a: { 'data-change': 'f', 'data-key': 'status' }, sm: true })}</div>
      <section class="panel flush">${data.accounts ? table([
        { key: 'n', label: 'Account', sort: (a) => a.name.toLowerCase(), render: (a) => `<div class="row nowrap">${avatar(a.name, 'sm')}<div class="min0"><b>${esc(a.name)}</b><div class="sub"><span class="mono">${esc(a.userId)}</span> · ${esc(a.email)}</div></div></div>` },
        { key: 'r', label: 'Roles', render: (a) => a.roles.map((r) => esc(roleById[r]?.short || r)).join(', ') },
        { key: 's', label: 'Status', sort: (a) => a.status, render: (a) => `${statusPill(a)}${a.mustChangePassword || a.invited ? ` ${pill(a.invited ? 'Invited' : 'Temp password', 'p-warn')}` : ''}${a.isTest ? ` ${pill('Test', 'p-mute')}` : ''}` },
        { key: 'l', label: 'Last sign-in', sort: (a) => a.lastLoginAt || '', render: (a) => (a.lastLoginAt ? `<span class="nowrap small">${esc(fmtDateTime(a.lastLoginAt))}</span>` : '<span class="muted small">Never</span>') },
      ], shown, { sortKey: 'n', sortDir: 'asc', page: F.page, pageSize: 25, pageAct: 'page', rowAct: 'open', rowId: (a) => a.id, wide: true, empty: 'No accounts match', caption: 'Sign-in accounts' }) : '<div class="empty"><b>Loading accounts</b></div>'}</section>
      <p class="hint">The register export lists user IDs, names, emails, roles, status and dates. It never contains passwords, hashes, session tokens or reset links.</p></div>`;
  },
  mount(main, ctx) {
    const F = ctx.local('acc');
    if (PREVIEW || data.loading) return;
    if (!data.accounts && !data.error) load(ctx, ['accounts']);
    else if (F?.tab === 'audit' && !data.audit) load(ctx, ['audit']);
  },
  actions: {
    tab(el, e, ctx) { const F = ctx.local('acc'); F.tab = el.dataset.id; if (F.tab === 'audit') { data.audit = null; load(ctx, ['audit']); } ctx.rerender(); },
    q(el, e, ctx) { const F = ctx.local('acc'); F.q = el.value; F.page = 1; clearTimeout(searchT); searchT = setTimeout(() => ctx.rerender(), 160); },
    f(el, e, ctx) { const F = ctx.local('acc'); F[el.dataset.key] = el.value; F.page = 1; ctx.rerender(); },
    page(el, e, ctx) { ctx.local('acc').page = Number(el.dataset.id); ctx.rerender(); },
    async syncFile(el, e, ctx) {
      el.disabled = true;
      try { const r = await api.post('/admin/accounts/sync', {}); data.source = r.source; await load(ctx, ['accounts']); ctx.toast(r.source.errors?.length ? `Synced with ${r.source.errors.length} row problem(s)` : 'Synced from the file'); } catch (err) { el.disabled = false; ctx.toastError(err); }
    },
    reload(el, e, ctx) { data.accounts = null; data.error = ''; load(ctx, ['accounts']); },
    create(el, e, ctx) { createPanel(ctx); },
    open(el, e, ctx) { detailPanel(ctx, el.dataset.id); },
    async setStatus(el, e, ctx) {
      const a = data.accounts.find((x) => x.id === el.dataset.id);
      const disabling = el.dataset.status === 'disabled';
      const ok = await ctx.confirm(disabling ? { title: `Disable ${a.name}?`, body: 'They are signed out of every device immediately and cannot sign in until an administrator enables the account. Their records are kept.', confirmLabel: 'Disable account', danger: true } : { title: `Enable ${a.name}?`, body: 'They will be able to sign in again with their existing password.', confirmLabel: 'Enable account' });
      if (!ok) return;
      try { const r = await api.patch(`/admin/accounts/${a.id}`, { status: el.dataset.status }); Object.assign(a, r.account); ctx.toast(disabling ? 'Account disabled and signed out everywhere' : 'Account enabled'); ctx.rerender(); } catch (err) { ctx.toastError(err); }
    },
    async revoke(el, e, ctx) {
      const a = data.accounts.find((x) => x.id === el.dataset.id);
      if (!(await ctx.confirm({ title: `Sign ${a.name} out everywhere?`, body: 'All of their sessions end now. They can sign in again with their password.', confirmLabel: 'Sign out everywhere' }))) return;
      try { const r = await api.post(`/admin/accounts/${a.id}/revoke-sessions`, {}); a.activeSessions = 0; ctx.toast(`${r.revoked} session(s) ended`); ctx.rerender(); } catch (err) { ctx.toastError(err); }
    },
    async reset(el, e, ctx) {
      const a = data.accounts.find((x) => x.id === el.dataset.id);
      const temp = el.dataset.mode === 'temporary';
      if (!(await ctx.confirm({ title: temp ? `Issue a temporary password for ${a.name}?` : `Create a reset link for ${a.name}?`, body: temp ? 'Their current password stops working now and they are signed out everywhere. They must choose a new password at next sign-in.' : 'They are signed out everywhere. The link works once and expires in 24 hours; their current password keeps working until they use it.', confirmLabel: temp ? 'Issue temporary password' : 'Create link' }))) return;
      try {
        const r = await api.post(`/admin/accounts/${a.id}/reset-password`, { mode: el.dataset.mode });
        a.activeSessions = 0; if (temp) a.mustChangePassword = true;
        ctx.rerender();
        oneTime(ctx, temp ? { title: 'Temporary password', intro: `Give this to ${esc(a.name)} (<span class="mono">${esc(a.userId)}</span>). They must change it at sign-in.`, label: 'Temporary password', value: r.temporaryPassword } : { title: 'Password reset link', intro: `Send this link to ${esc(a.name)}. It works once and expires in 24 hours.`, label: 'Reset link', value: r.resetLink });
      } catch (err) { ctx.toastError(err); }
    },
  },
  forms: {
    async create(f, d, ctx) {
      const roles = [...f.querySelectorAll('input[name="roles"]:checked')].map((x) => x.value);
      const body = { name: d.name, email: d.email, userId: d.userId.trim() || undefined, roles, lmsRef: d.lmsRef, credential: d.credential };
      fieldErrors(f, {}); busy(f, true);
      try {
        const r = await api.post('/admin/accounts', body);
        (data.accounts ||= []).unshift(r.account);
        document.querySelector('#drawer [data-close]')?.click();
        ctx.rerender();
        if (r.temporaryPassword) oneTime(ctx, { title: 'Account created', intro: `<b>${esc(r.account.name)}</b> can now sign in as ${esc(r.account.roles.map((x) => roleById[x].label).join(' or '))} with user ID <span class="mono">${esc(r.account.userId)}</span> and this temporary password. They must change it at first sign-in.`, label: 'Temporary password', value: r.temporaryPassword });
        else oneTime(ctx, { title: 'Account created', intro: `Send this invitation link to <b>${esc(r.account.name)}</b> (user ID <span class="mono">${esc(r.account.userId)}</span>). It works once and expires in 72 hours.`, label: 'Invitation link', value: r.inviteLink });
      } catch (err) { busy(f, false); fieldErrors(f, err.details || {}); ctx.toastError(err); }
    },
    async edit(f, d, ctx) {
      fieldErrors(f, {}); busy(f, true);
      try { const r = await api.patch(`/admin/accounts/${f.dataset.id}`, { name: d.name, email: d.email, lmsRef: d.lmsRef }); Object.assign(data.accounts.find((x) => x.id === f.dataset.id), r.account); ctx.toast('Details saved'); ctx.rerender(); } catch (err) { busy(f, false); fieldErrors(f, err.details || {}); ctx.toastError(err); }
    },
    async roles(f, d, ctx) {
      const roles = checkedRoles(f);
      const a = data.accounts.find((x) => x.id === f.dataset.id);
      const removed = a.roles.filter((r) => !roles.includes(r));
      if (removed.length && !(await ctx.confirm({ title: 'Remove roles?', body: `${esc(a.name)} loses ${esc(removed.map((r) => roleById[r].label).join(', '))}. Any session signed in with a removed role ends now.`, confirmLabel: 'Save roles', danger: true }))) return;
      busy(f, true);
      try { const r = await api.patch(`/admin/accounts/${a.id}`, { roles }); Object.assign(a, r.account); ctx.toast('Roles saved'); ctx.rerender(); } catch (err) { busy(f, false); ctx.toastError(err); }
    },
  },
};

// Keep the linked-profile list in the create form in step with the first selected role.
if (typeof document !== 'undefined') document.addEventListener('change', (e) => {
  const f = e.target.closest?.('form[data-form="create"]');
  if (!f || e.target.name !== 'roles') return;
  const first = ROLES.find((r) => f.querySelector(`input[name="roles"][value="${r.id}"]`)?.checked);
  const sel = f.querySelector('#lmsRef');
  if (!first || !sel) return;
  const opts = profilesFor({ s: getState() }, first.id);
  sel.innerHTML = opts.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join('') || '<option value="">No sample profile for this role</option>';
});
