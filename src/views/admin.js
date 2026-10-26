// Administration and governance: users, permission matrix, audit and security logs,
// integrations, system settings, feature flags, retention and demo data controls.
import { esc, fmtDate, fmtDateTime, uid, toCSV, initials } from '../core/util.js';
import { icon } from '../core/icons.js';
import { pageHead, pill, btn, empty, tabs, table, kpi, select, input, toggle, searchBox, avatar } from '../core/ui.js';
import { ROLES, PERMISSIONS, PERM_IDS, LOCKED, can, roleById } from '../core/rbac.js';
import { INTEGRATIONS, integrationStatus } from '../services/integrations.js';
import { providerStatus } from '../services/ai.js';
import { displayName } from '../domain/scope.js';
import { exportText, EXPORT_MSG } from '../services/exporter.js';
import * as store from '../core/store.js';

const accountStatus = (ctx, id) => ctx.s.accounts[id]?.status || 'active';

// =================================================================== USERS
export const users = {
  perms: ['users.manage'],
  title: () => 'People directory',
  render(ctx) {
    const F = ctx.local('usr', { q: '', role: 'all', status: 'all', page: 1 });
    const all = [...ctx.s.users.map((u) => ({ ...u, kind: 'staff' })), ...ctx.s.students.map((s) => ({ id: s.id, name: s.name, email: s.email, role: 'student', kind: 'learner', orgId: s.orgId }))];
    const list = all.filter((u) => (F.role === 'all' || u.role === F.role) && (F.status === 'all' || accountStatus(ctx, u.id) === F.status) && (!F.q || `${u.name} ${u.email} ${u.id}`.toLowerCase().includes(F.q.toLowerCase())));
    return `<div class="page">${pageHead({ title: 'People directory', lede: 'Learning profiles for staff, learners and client contacts in the sample data. Sign-in accounts and passwords are managed under <a href="#/admin/accounts">Accounts and sign-in</a>.', actions: btn('Create a sign-in account', { href: '/admin/accounts', cls: 'btn-primary', ic: 'key' }) })}
      <div class="kpis">${kpi({ label: 'Accounts', value: all.length })}${kpi({ label: 'Staff', value: ctx.s.users.filter((u) => u.role !== 'corporate').length })}${kpi({ label: 'Client contacts', value: ctx.s.users.filter((u) => u.role === 'corporate').length })}${kpi({ label: 'Deactivated', value: Object.values(ctx.s.accounts).filter((a) => a.status === 'deactivated').length })}</div>
      <div class="toolbar"><div class="grow-field">${searchBox({ id: 'u-q', value: F.q, placeholder: 'Search name, email or ID', a: { 'data-input': 'q' } })}</div>${select({ id: 'u-r', label: 'Role', value: F.role, options: [['all', 'All roles'], ...ROLES.map((r) => [r.id, r.label])], a: { 'data-change': 'f', 'data-key': 'role' } })}${select({ id: 'u-s', label: 'Status', value: F.status, options: [['all', 'All'], ['active', 'Active'], ['deactivated', 'Deactivated']], a: { 'data-change': 'f', 'data-key': 'status' } })}</div>
      <section class="panel flush">${table([
        { key: 'n', label: 'Name', sort: (u) => u.name, render: (u) => `<div class="row nowrap">${avatar(u.name, 'sm')}<div class="min0"><b>${esc(u.name)}</b><div class="sub">${esc(u.email)} · <span class="mono">${esc(u.id)}</span></div></div></div>` },
        { key: 'r', label: 'Role', sort: (u) => u.role, render: (u) => `${esc(roleById[u.role]?.short || u.role)}${u.orgId ? `<div class="sub">${esc(ctx.s.orgs.find((o) => o.id === u.orgId)?.name || '')}</div>` : ''}` },
        { key: 's', label: 'Status', render: (u) => (accountStatus(ctx, u.id) === 'active' ? pill('Active', 'p-ok') : pill('Deactivated', 'p-bad')) },
        { key: 'x', label: '', r: true, render: (u) => (u.role === 'superadmin' || u.id === ctx.me.id ? '<span class="xs muted">Protected</span>' : accountStatus(ctx, u.id) === 'active' ? btn('Deactivate', { act: 'deactivate', sm: true, cls: 'btn-danger', attrs: { 'data-id': u.id } }) : btn('Reactivate', { act: 'reactivate', sm: true, attrs: { 'data-id': u.id } })) },
      ], list, { sortKey: 'n', sortDir: 'asc', page: F.page, pageSize: 20, pageAct: 'page', wide: true })}</section>
      <p class="hint">Deactivating a profile here hides it in the learning platform. To stop someone signing in, disable their account under Accounts and sign-in.</p></div>`;
  },
  actions: {
    q(el, e, ctx) { const F = ctx.local('usr'); F.q = el.value; F.page = 1; clearTimeout(uT); uT = setTimeout(() => ctx.rerender(), 180); },
    f(el, e, ctx) { const F = ctx.local('usr'); F[el.dataset.key] = el.value; F.page = 1; ctx.rerender(); },
    page(el, e, ctx) { ctx.local('usr').page = Number(el.dataset.id); ctx.rerender(); },
    deactivate(el, e, ctx) { const name = displayName(ctx.s, el.dataset.id); ctx.confirm({ title: `Deactivate ${name}?`, body: 'They lose access immediately. Their records, submissions and certificates are kept, and you can reactivate the account later.', confirmLabel: 'Deactivate', danger: true }).then((ok) => ok && ctx.commit('user.deactivate', (s) => { s.accounts[el.dataset.id] = { ...(s.accounts[el.dataset.id] || {}), status: 'deactivated', at: new Date().toISOString(), by: ctx.me.id }; }, { ok: `${name} deactivated`, audit: { action: 'user.deactivate', entity: 'user', entityId: el.dataset.id, kind: 'security' } })); },
    reactivate(el, e, ctx) { ctx.commit('user.reactivate', (s) => { s.accounts[el.dataset.id] = { ...(s.accounts[el.dataset.id] || {}), status: 'active', at: new Date().toISOString(), by: ctx.me.id }; }, { ok: 'Reactivated', audit: { action: 'user.reactivate', entity: 'user', entityId: el.dataset.id, kind: 'security' } }); },
    invite(el, e, ctx) {
      const roles = ROLES.filter((r) => !['student', 'corporate'].includes(r.id) && (r.id !== 'superadmin' || ctx.me.role === 'superadmin'));
      ctx.modal({ title: 'Invite a staff member', body: `${input({ id: 'i-n', label: 'Full name', req: true })}${input({ id: 'i-e', label: 'Work email', type: 'email', req: true })}${select({ id: 'i-r', label: 'Role', options: roles.map((r) => [r.id, r.label]) })}${input({ id: 'i-d', label: 'Domains (comma separated ids, for teaching roles)', value: 'prog' })}<p class="hint">In production an SSO invitation email is sent; here the account is created immediately.</p>`, foot: `<button class="btn btn-primary" id="i-go" type="button">Create account</button>`, onMount: (m, close) => { m.querySelector('#i-go').onclick = () => {
        const name = m.querySelector('#i-n').value.trim(), email = m.querySelector('#i-e').value.trim(), role = m.querySelector('#i-r').value;
        if (name.length < 3) return ctx.toast('Name is required.', { tone: 'bad' });
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return ctx.toast('Enter a valid email.', { tone: 'bad' });
        if (ctx.s.users.some((u) => u.email.toLowerCase() === email.toLowerCase())) return ctx.toast('That email already has an account.', { tone: 'bad' });
        const id = `U-${uid('u').slice(2, 8).toUpperCase()}`;
        if (ctx.commit('user.invite', (s) => { s.users.push({ id, name, email, role, domains: m.querySelector('#i-d').value.split(',').map((x) => x.trim()).filter(Boolean), capacity: 16, slots: role === 'mentor' ? ['Wed 18:00'] : undefined }); }, { ok: `${name} added as ${roleById[role].short}`, audit: { action: 'user.invite', entity: 'user', entityId: id, detail: `${email} as ${role}`, kind: 'security' } }) === true) close();
      }; } });
    },
  },
};
let uT;

// =================================================================== PERMISSIONS
export const permissions = {
  perms: ['roles.manage', 'users.manage'],
  title: () => 'Permissions',
  render(ctx) {
    const editable = ctx.can('roles.manage');
    const ov = ctx.s.settings.permOverrides;
    const changed = Object.values(ov).reduce((a, r) => a + Object.keys(r || {}).length, 0);
    return `<div class="page">${pageHead({ title: 'Roles and permissions', lede: 'The matrix drives navigation, route guards and data scoping in this demo. In production the same matrix is enforced by the API on every request.', actions: editable && changed ? btn(`Reset ${changed} override${changed === 1 ? '' : 's'}`, { act: 'reset', cls: 'btn-danger' }) : '' })}
      ${!editable ? '<div class="callout info small">Read only. Only a Super Administrator can change the matrix.</div>' : ''}
      <section class="panel flush"><div class="tbl-wrap perm-wrap"><table class="tbl perm"><caption class="sr-only">Permission matrix</caption><thead><tr><th scope="col">Permission</th>${ROLES.map((r) => `<th scope="col" class="c"><span class="vert">${esc(r.short)}</span></th>`).join('')}</tr></thead><tbody>${PERM_IDS.map((p) => `<tr><th scope="row"><span class="mono xs">${p}</span><div class="sub">${esc(PERMISSIONS[p].label)}</div></th>${ROLES.map((r) => { const on = can(r.id, p, ov); const locked = LOCKED[r.id]?.includes(p); const overridden = typeof ov?.[r.id]?.[p] === 'boolean'; return `<td class="c ${overridden ? 'ovr' : ''}"><input type="checkbox" aria-label="${esc(r.label)}: ${esc(PERMISSIONS[p].label)}" ${on ? 'checked' : ''} ${!editable || locked ? 'disabled' : ''} data-change="toggle" data-role="${r.id}" data-perm="${p}"></td>`; }).join('')}</tr>`).join('')}</tbody></table></div></section>
      <p class="hint">Highlighted cells differ from the default. Locked cells keep a Super Administrator able to manage roles, settings and audit logs.</p></div>`;
  },
  actions: {
    toggle(el, e, ctx) {
      const { role, perm } = el.dataset;
      const value = el.checked;
      ctx.commit('perm.toggle', (s) => { const o = (s.settings.permOverrides[role] ||= {}); const def = PERMISSIONS[perm].roles.includes(role); if (value === def) delete o[perm]; else o[perm] = value; }, { ok: `${roleById[role].short}: ${perm} ${value ? 'granted' : 'removed'}`, audit: { action: 'permission.change', entity: 'role', entityId: role, detail: `${perm} → ${value}`, kind: 'security' } });
    },
    reset(el, e, ctx) { ctx.confirm({ title: 'Reset all permission overrides?', body: 'Every role returns to its default permissions.', confirmLabel: 'Reset', danger: true }).then((ok) => ok && ctx.commit('perm.reset', (s) => { s.settings.permOverrides = {}; }, { ok: 'Permissions reset to defaults', audit: { action: 'permission.reset', entity: 'role', entityId: 'all', kind: 'security' } })); },
  },
};

// =================================================================== AUDIT
export const audit = {
  perms: ['audit.view'],
  title: () => 'Audit Logs',
  render(ctx) {
    const F = ctx.local('aud', { kind: 'all', q: '', actor: 'all', page: 1 });
    const list = ctx.s.audit.filter((a) => (F.kind === 'all' || a.kind === F.kind) && (F.actor === 'all' || a.actorId === F.actor) && (!F.q || `${a.action} ${a.entity} ${a.entityId} ${a.detail}`.toLowerCase().includes(F.q.toLowerCase())));
    const actors = [...new Set(ctx.s.audit.map((a) => a.actorId))];
    return `<div class="page">${pageHead({ title: 'Audit and security logs', lede: `Every administrative, data and security action is recorded with who, what and when. Retention: ${ctx.s.settings.retention.auditDays} days.`, actions: ctx.can('data.export') ? btn('Export CSV', { act: 'export', ic: 'download' }) : '' })}
      <div class="kpis">${kpi({ label: 'Events', value: ctx.s.audit.length })}${kpi({ label: 'Security events', value: ctx.s.audit.filter((a) => a.kind === 'security').length })}${kpi({ label: 'Data exports', value: ctx.s.audit.filter((a) => a.action.startsWith('export')).length })}${kpi({ label: 'Last 24 hours', value: ctx.s.audit.filter((a) => Date.now() - new Date(a.at) < 864e5).length })}</div>
      <div class="toolbar"><div class="grow-field">${searchBox({ id: 'a-q', value: F.q, placeholder: 'Search action, record or detail', a: { 'data-input': 'q' } })}</div>${select({ id: 'a-k', label: 'Type', value: F.kind, options: [['all', 'All'], ['admin', 'Administrative'], ['security', 'Security'], ['data', 'Data']], a: { 'data-change': 'f', 'data-key': 'kind' } })}${select({ id: 'a-a', label: 'Actor', value: F.actor, options: [['all', 'Anyone'], ...actors.map((id) => [id, displayName(ctx.s, id)])], a: { 'data-change': 'f', 'data-key': 'actor' } })}</div>
      <section class="panel flush">${table([
        { key: 't', label: 'When', render: (a) => `<span class="small">${fmtDateTime(a.at)}</span>` },
        { key: 'u', label: 'Actor', render: (a) => esc(displayName(ctx.s, a.actorId)) },
        { key: 'a', label: 'Action', render: (a) => `<span class="mono small">${esc(a.action)}</span> ${a.kind === 'security' ? pill('security', 'p-bad', true) : a.kind === 'data' ? pill('data', 'p-info', true) : ''}` },
        { key: 'e', label: 'Record', render: (a) => `<span class="small">${esc(a.entity)}</span><div class="sub mono">${esc(a.entityId)}</div>` },
        { key: 'd', label: 'Detail', render: (a) => `<span class="small">${esc(a.detail)}</span>` },
      ], list, { page: F.page, pageSize: 25, pageAct: 'page', wide: true, empty: 'No events match.' })}</section>
      <p class="hint">In production the audit log is append-only on the server and shipped to a log store; this browser copy is for demonstration.</p></div>`;
  },
  actions: {
    q(el, e, ctx) { const F = ctx.local('aud'); F.q = el.value; F.page = 1; clearTimeout(aT); aT = setTimeout(() => ctx.rerender(), 180); },
    f(el, e, ctx) { const F = ctx.local('aud'); F[el.dataset.key] = el.value; F.page = 1; ctx.rerender(); },
    page(el, e, ctx) { ctx.local('aud').page = Number(el.dataset.id); ctx.rerender(); },
    async export(el, e, ctx) { const r = await exportText('avgenx-audit.csv', toCSV(ctx.s.audit, [{ label: 'At', value: (a) => a.at }, { label: 'Actor', value: (a) => displayName(ctx.s, a.actorId) }, { label: 'Action', value: (a) => a.action }, { label: 'Type', value: (a) => a.kind }, { label: 'Entity', value: (a) => a.entity }, { label: 'Entity ID', value: (a) => a.entityId }, { label: 'Detail', value: (a) => a.detail }])); ctx.commit('export', () => {}, { silent: true, audit: { action: 'export.csv', entity: 'audit', entityId: 'all', kind: 'data' } }); ctx.toast(EXPORT_MSG[r]); },
  },
};
let aT;

// =================================================================== INTEGRATIONS
export const integrations = {
  perms: ['integrations.manage', 'settings.manage'],
  title: () => 'Integrations',
  render(ctx) {
    const edit = ctx.can('integrations.manage');
    const artifactAI = providerStatus(ctx.s.settings).id === 'claude-artifact';
    const cats = [...new Set(INTEGRATIONS.map((i) => i.category))];
    return `<div class="page">${pageHead({ title: 'Integrations', lede: 'External services this platform depends on. Only endpoint URLs are stored here; API keys and secrets live on the server and are never sent to the browser.' })}
      ${cats.map((c) => `<section class="stack" style="--gap:10px"><h2>${esc(c)}</h2><div class="grid g-auto" style="--min:330px">${INTEGRATIONS.filter((i) => i.category === c).map((i) => { const st = integrationStatus(ctx.s.settings, i.id, { artifactAI, browserJS: true }); return `<article class="panel stack" style="--gap:8px"><div class="spread"><b>${esc(i.name)}</b>${st.connected ? pill('Connected', 'p-ok') : st.partial ? pill('Partial', 'p-warn') : pill('Not connected', 'p-mute')}</div><p class="small muted">${esc(i.uses)}</p><dl class="dl xs"><dt>Interface</dt><dd class="mono">${esc(i.iface)}</dd><dt>Credentials</dt><dd>${esc(i.creds)}</dd>${i.sample ? `<dt>Sample</dt><dd class="mono">${esc(i.sample)}</dd>` : ''}<dt>Status</dt><dd>${esc(st.label)}</dd></dl>${edit ? `<form class="row" data-form="endpoint" style="--gap:6px"><input type="hidden" name="id" value="${i.id}"><label class="sr-only" for="ep-${i.id}">${esc(i.name)} endpoint</label><input class="input sm grow" id="ep-${i.id}" name="endpoint" placeholder="https://api.yourdomain.com/…" value="${esc(ctx.s.settings.integrations[i.id]?.endpoint || '')}"><button class="btn btn-ghost btn-sm" type="submit">Save</button>${ctx.s.settings.integrations[i.id]?.endpoint ? btn('Test', { act: 'test', sm: true, attrs: { 'data-id': i.id } }) : ''}</form>` : ''}</article>`; }).join('')}</div></section>`).join('')}</div>`;
  },
  actions: {
    async test(el, e, ctx) {
      const ep = ctx.s.settings.integrations[el.dataset.id].endpoint;
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 4000);
      try { const r = await fetch(ep, { method: 'OPTIONS', signal: ctl.signal }); ctx.toast(`Reached ${ep}: HTTP ${r.status}`); } catch (err) { ctx.toast(`Could not reach ${ep}. ${err.name === 'AbortError' ? 'Timed out.' : 'The network or this page\'s security policy blocked it.'}`, { tone: 'bad' }); } finally { clearTimeout(t); }
    },
  },
  forms: {
    endpoint(form, d, ctx) {
      const v = d.endpoint.trim();
      if (v && !/^https:\/\/[^\s]+$/.test(v) && !/^\/api\/[\w/-]+$/.test(v)) return ctx.toast('Use an https URL or a same-origin path like /api/ai.', { tone: 'bad' });
      if (/key=|token=|secret|sk-/i.test(v)) return ctx.toast('Do not put credentials in the URL. Keep secrets on the server.', { tone: 'bad' });
      ctx.commit('integration.set', (s) => { s.settings.integrations[d.id] = { endpoint: v }; }, { ok: v ? 'Endpoint saved' : 'Endpoint cleared', audit: { action: 'integration.update', entity: 'integration', entityId: d.id, detail: v ? 'endpoint set' : 'cleared', kind: 'security' } });
    },
  },
};

// =================================================================== SETTINGS
export const settings = {
  perms: ['settings.manage'],
  title: () => 'System Settings',
  render(ctx) {
    const S = ctx.s.settings;
    const T = ctx.local('set', { tab: 'flags' });
    let body;
    if (T.tab === 'flags') body = `<form class="panel stack" data-form="flags"><h2>Feature flags</h2><p class="small muted">Switching a feature off hides it from navigation and blocks its pages for every role.</p>${[['aiCopilot', 'AI learning copilot'], ['gamification', 'XP, badges and leaderboards'], ['community', 'Discussions and study groups'], ['corporate', 'Corporate training workspaces'], ['placement', 'Placement centre, jobs and interview prep'], ['codeExecution', 'In-browser JavaScript execution']].map(([k, l]) => toggle({ id: `f-${k}`, label: l, checked: S.flags[k] })).join('')}<div class="row"><button class="btn btn-primary" type="submit">Save flags</button></div></form>`;
    else if (T.tab === 'rules') body = `<form class="panel stack" data-form="rules"><h2>At-risk rules</h2><div class="form-grid">${input({ id: 'inactiveDays', label: 'Inactive for (days)', type: 'number', value: S.risk.inactiveDays })}${input({ id: 'failedAttempts', label: 'Failed attempts without a pass', type: 'number', value: S.risk.failedAttempts })}${input({ id: 'overdueProjects', label: 'Overdue projects', type: 'number', value: S.risk.overdueProjects })}${input({ id: 'engagementDropPct', label: 'Engagement drop (%)', type: 'number', value: S.risk.engagementDropPct })}${input({ id: 'attendancePct', label: 'Attendance below (%)', type: 'number', value: S.risk.attendancePct })}${input({ id: 'progressGapPct', label: 'Behind schedule by (points)', type: 'number', value: S.risk.progressGapPct })}</div>
      <h2>Placement readiness weights</h2><p class="small muted">Must add up to 100.</p><div class="form-grid">${Object.entries(S.readiness).map(([k, v]) => input({ id: `rw-${k}`, label: k, type: 'number', value: v })).join('')}</div>
      <h2>XP rules</h2><div class="form-grid">${Object.entries(S.xp).map(([k, v]) => input({ id: `xp-${k}`, label: k, type: 'number', value: v })).join('')}</div>
      <h2>Leaderboard scoring</h2><div class="form-grid">${Object.entries(S.leaderboard).map(([k, v]) => input({ id: `lb-${k}`, label: k, type: 'number', value: v })).join('')}</div>
      <div class="row"><button class="btn btn-primary" type="submit">Save rules</button></div></form>`;
    else if (T.tab === 'privacy') body = `<form class="panel stack" data-form="retention"><h2>Data retention and privacy</h2><div class="form-grid">${input({ id: 'auditDays', label: 'Keep audit logs (days)', type: 'number', value: S.retention.auditDays })}${input({ id: 'chatDays', label: 'Keep copilot chat history (days)', type: 'number', value: S.retention.chatDays })}${input({ id: 'inactiveAccountDays', label: 'Review inactive accounts after (days)', type: 'number', value: S.retention.inactiveAccountDays })}</div>${toggle({ id: 'exportApproval', label: 'Bulk data exports require an administrator role', checked: S.retention.exportApproval })}<p class="hint">Backups and point-in-time recovery are handled by the database provider (Backups integration). Learner consent choices are respected by recommendations and risk analytics.</p><div class="row"><button class="btn btn-primary" type="submit">Save retention</button></div></form>`;
    else body = `<div class="stack"><section class="panel stack"><h2>Institute</h2><form class="stack" data-form="institute">${input({ id: 'name', label: 'Display name', value: S.institute.name })}${input({ id: 'supportEmail', label: 'Support email', type: 'email', value: S.institute.supportEmail })}<div class="row"><button class="btn btn-primary btn-sm" type="submit">Save</button></div></form></section>
      <section class="panel stack"><h2>Demo data</h2><p class="small">Demo clock: <b>${fmtDate(ctx.s.meta.clock)}</b>. The dataset was generated on ${fmtDateTime(ctx.s.meta.seededAt)} from seed ${ctx.s.meta.seed}. Changes you make are saved in this browser only.</p><p class="small muted">Browser storage is a development convenience. It is not secure, shared or multi-user; production persistence uses the API and database.</p><div class="row">${btn('Reset demo data', { act: 'reset', cls: 'btn-danger', ic: 'refresh' })}${ctx.can('data.export') ? btn('Export all demo data (JSON)', { act: 'exportAll', ic: 'download' }) : ''}</div></section></div>`;
    return `<div class="page">${pageHead({ title: 'System settings', lede: 'Configuration that drives platform behaviour. Every change is audited.' })}${tabs([['flags', 'Feature flags'], ['rules', 'Rules and scoring'], ['privacy', 'Retention and privacy'], ['system', 'Institute and demo data']], T.tab, 'tab')}${body}</div>`;
  },
  actions: {
    tab(el, e, ctx) { ctx.local('set').tab = el.dataset.id; ctx.rerender(); },
    reset(el, e, ctx) { ctx.confirm({ title: 'Reset all demo data?', body: 'Every change made in this browser (submissions, grades, settings, new records) is replaced with a fresh dataset dated today. This cannot be undone.', confirmLabel: 'Reset demo data', danger: true, typeToConfirm: 'RESET' }).then((ok) => { if (!ok) return; store.resetDemo(); ctx.toast('Demo data reset'); }); },
    async exportAll(el, e, ctx) { const r = await exportText(`avgenx-demo-${ctx.s.meta.clock}.json`, store.exportJSON(), 'application/json'); ctx.commit('export', () => {}, { silent: true, audit: { action: 'export.json', entity: 'dataset', entityId: 'all', kind: 'data' } }); ctx.toast(EXPORT_MSG[r]); },
  },
  forms: {
    flags(form, d, ctx) { ctx.commit('settings.flags', (s) => { Object.keys(s.settings.flags).forEach((k) => { s.settings.flags[k] = !!d[`f-${k}`]; }); }, { ok: 'Feature flags saved', audit: { action: 'settings.flags', entity: 'settings', entityId: 'flags', detail: Object.keys(ctx.s.settings.flags).filter((k) => !d[`f-${k}`]).map((k) => `${k} off`).join(', ') || 'all on' } }); },
    rules(form, d, ctx) {
      const num = (k) => Number(d[k]);
      const rw = Object.keys(ctx.s.settings.readiness).reduce((a, k) => a + num(`rw-${k}`), 0);
      if (rw !== 100) return ctx.toast(`Readiness weights add up to ${rw}; they must total 100.`, { tone: 'bad' });
      const all = Object.keys(d).filter((k) => k !== 'undefined').map((k) => num(k));
      if (all.some((v) => !(v >= 0 && v <= 1000))) return ctx.toast('Values must be between 0 and 1,000.', { tone: 'bad' });
      ctx.commit('settings.rules', (s) => { Object.keys(s.settings.risk).forEach((k) => { s.settings.risk[k] = num(k); }); Object.keys(s.settings.readiness).forEach((k) => { s.settings.readiness[k] = num(`rw-${k}`); }); Object.keys(s.settings.xp).forEach((k) => { s.settings.xp[k] = num(`xp-${k}`); }); Object.keys(s.settings.leaderboard).forEach((k) => { s.settings.leaderboard[k] = num(`lb-${k}`); }); }, { ok: 'Rules saved. Dashboards recalculate now.', audit: { action: 'settings.rules', entity: 'settings', entityId: 'rules' } });
    },
    retention(form, d, ctx) { const a = Number(d.auditDays), c = Number(d.chatDays), i = Number(d.inactiveAccountDays); if (!(a >= 90 && a <= 3650)) return ctx.toast('Audit retention must be 90 to 3,650 days.', { tone: 'bad' }); if (!(c >= 1 && c <= 365)) return ctx.toast('Chat retention must be 1 to 365 days.', { tone: 'bad' }); ctx.commit('settings.retention', (s) => { Object.assign(s.settings.retention, { auditDays: a, chatDays: c, inactiveAccountDays: i, exportApproval: !!d.exportApproval }); }, { ok: 'Retention saved', audit: { action: 'settings.retention', entity: 'settings', entityId: 'retention', detail: `audit ${a}d, chat ${c}d`, kind: 'security' } }); },
    institute(form, d, ctx) { if ((d.name || '').trim().length < 3) return ctx.toast('Name is required.', { tone: 'bad' }); ctx.commit('settings.institute', (s) => { s.settings.institute.name = d.name.trim(); s.settings.institute.supportEmail = d.supportEmail.trim(); }, { ok: 'Saved', audit: { action: 'settings.institute', entity: 'settings', entityId: 'institute' } }); },
  },
};
