// Corporate training: tenant-isolated organisation workspace, department cohorts, mandatory
// learning, skill gaps, enrollment within seat limits, effectiveness and completion reporting.
import { esc, fmtDate, fmtShort, relDays, uid, iso, avg, round, toCSV } from '../core/util.js';
import { icon } from '../core/icons.js';
import { pageHead, pill, btn, empty, tabs, table, kpi, bar, select, input, hbars, stepper, avatar, check, swatch } from '../core/ui.js';
import { visibleOrgs, visibleStudents, displayName } from '../domain/scope.js';
import { progressOf, enroll } from '../domain/progress.js';
import { lastActive } from '../domain/activity.js';
import { attemptStatus } from '../domain/assessment.js';
import { ASSESSMENTS } from '../data/questions.js';
import { DOMAINS } from '../data/catalog.js';
import { exportText, EXPORT_MSG } from '../services/exporter.js';

const WF = ['Client setup', 'Requirements', 'Skill-gap assessment', 'Program configuration', 'Employee enrollment', 'Learning delivery', 'Completion tracking', 'Outcome reporting'];

function orgModel(ctx, org) {
  const emps = ctx.s.students.filter((s) => s.orgId === org.id);
  const courseIds = [...new Set([...org.programs, ...org.mandatory])];
  const rows = emps.map((s) => {
    const enr = ctx.s.enrollments.filter((e) => e.studentId === s.id && courseIds.includes(e.courseId));
    const prog = enr.length ? Math.round(avg(enr, (e) => progressOf(ctx.s.courses.find((c) => c.id === e.courseId), e).pct)) : 0;
    const mand = org.mandatory.map((cid) => enr.find((e) => e.courseId === cid)).filter(Boolean);
    const mandDone = mand.filter((e) => e.status === 'completed').length;
    const assess = ASSESSMENTS.filter((a) => courseIds.includes(a.course)).map((a) => attemptStatus(ctx.s, s.id, a).best?.pct).filter((x) => x !== undefined && x !== null);
    return { s, enr, prog, mandDone, mandTotal: org.mandatory.length, assess: assess.length ? Math.round(avg(assess)) : null, la: lastActive(ctx.idx(), s.id) };
  });
  const depts = org.departments.map((d) => { const r = rows.filter((x) => x.s.dept === d); return { d, n: r.length, prog: r.length ? Math.round(avg(r, (x) => x.prog)) : 0, mand: r.length ? Math.round((r.reduce((a, x) => a + x.mandDone, 0) / Math.max(1, r.reduce((a, x) => a + x.mandTotal, 0))) * 100) : 0, assess: r.filter((x) => x.assess !== null).length ? Math.round(avg(r.filter((x) => x.assess !== null), (x) => x.assess)) : null }; });
  const stage = !org.programs.length ? 1 : !emps.length ? 4 : rows.some((r) => r.enr.some((e) => Object.keys(e.done).length)) ? (rows.some((r) => r.mandDone) ? 7 : 5) : 4;
  return { emps, rows, depts, stage, courseIds };
}

function workspace(ctx, org, staffView) {
  const M = orgModel(ctx, org);
  const T = ctx.local(`org:${org.id}`, { tab: 'overview' });
  let body;
  if (T.tab === 'overview') body = `<div class="grid g2"><section class="panel"><div class="panel-head"><h2>Department comparison</h2><span class="sub">average course progress</span></div>${hbars(M.depts.map((d) => ({ label: `${d.d} (${d.n})`, value: d.prog, max: 100, display: `${d.prog}%`, color: 'var(--org)' })))}</section>
    <section class="panel"><div class="panel-head"><h2>Mandatory learning compliance</h2></div>${hbars(M.depts.map((d) => ({ label: d.d, value: d.mand, max: 100, display: `${d.mand}%`, color: d.mand < 50 ? 'var(--warn)' : 'var(--ok)' })))}<p class="hint" style="margin-top:8px">Mandatory: ${org.mandatory.map((id) => `<b>${id}</b>`).join(', ')}. Completion means every lesson done.</p></section></div>
    <section class="panel"><div class="panel-head"><h2>Corporate learning path</h2></div><div class="row">${M.courseIds.map((id) => { const c = ctx.s.courses.find((x) => x.id === id); return `<a class="chip" href="#/course/${id}">${swatch(c)} ${id} · ${esc(c.title)}${org.mandatory.includes(id) ? ' · mandatory' : ''}</a>`; }).join('')}</div></section>`;
  else if (T.tab === 'people') body = `<div class="stack">${!staffView || ctx.can('students.manage') ? `<div class="row">${btn('Enroll employee', { act: 'enrollEmp', cls: 'btn-primary', ic: 'plus', disabled: M.emps.length >= org.seats })}<span class="small muted">${M.emps.length} of ${org.seats} contracted seats used</span>${btn('Export completion report', { act: 'export', ic: 'download' })}</div>` : ''}<section class="panel flush">${table([
    { key: 'n', label: 'Employee', sort: (r) => r.s.name, render: (r) => `<b>${esc(r.s.name)}</b><div class="sub">${esc(r.s.dept)} · ${esc(r.s.email)}</div>` },
    { key: 'p', label: 'Progress', sort: (r) => r.prog, render: (r) => `${bar(r.prog)}<span class="sub">${r.prog}% across ${r.enr.length} courses</span>` },
    { key: 'm', label: 'Mandatory', sort: (r) => r.mandDone, render: (r) => pill(`${r.mandDone}/${r.mandTotal}`, r.mandDone === r.mandTotal ? 'p-ok' : 'p-warn', true) },
    { key: 'a', label: 'Assessment avg', r: true, sort: (r) => r.assess ?? -1, render: (r) => (r.assess === null ? '<span class="muted">n/a</span>' : `${r.assess}%`) },
    { key: 'l', label: 'Last active', sort: (r) => r.la || '', render: (r) => (r.la ? relDays(r.la, ctx.now) : 'never') },
  ], M.rows, { sortKey: T.sort || 'n', sortDir: T.dir || 'asc', sortAct: 'sort', empty: 'No employees enrolled yet.' })}</section></div>`;
  else if (T.tab === 'skills') {
    const targets = M.courseIds.map((id) => ctx.s.courses.find((c) => c.id === id));
    const gap = targets.map((c) => { const a = ASSESSMENTS.find((x) => x.id === c.assessmentId); const scores = a ? M.rows.map((r) => attemptStatus(ctx.s, r.s.id, a).best?.pct).filter((x) => x !== undefined && x !== null) : []; const prog = M.rows.map((r) => r.enr.find((e) => e.courseId === c.id)).filter(Boolean).map((e) => progressOf(c, e).pct); return { c, assessed: scores.length, score: scores.length ? Math.round(avg(scores)) : null, prog: prog.length ? Math.round(avg(prog)) : 0 }; });
    body = `<section class="panel flush"><div class="panel-head" style="padding:18px 20px 0"><h2>Skill-gap assessment</h2><span class="sub">Target skills from the agreed program vs current evidence</span></div>${table([{ key: 'c', label: 'Skill area (course)', render: (g) => `<b>${g.c.id}</b> ${esc(g.c.skills.slice(0, 3).join(', '))}` }, { key: 'a', label: 'Employees assessed', r: true, render: (g) => g.assessed }, { key: 's', label: 'Avg assessment', r: true, render: (g) => (g.score === null ? '<span class="muted">Not assessed</span>' : pill(`${g.score}%`, g.score < 60 ? 'p-bad' : g.score < 75 ? 'p-warn' : 'p-ok', true)) }, { key: 'p', label: 'Avg progress', r: true, render: (g) => `${g.prog}%` }, { key: 'gap', label: 'Gap', render: (g) => (g.score === null ? 'Run the diagnostic' : g.score < 60 ? 'Significant: add a live workshop' : g.score < 75 ? 'Moderate: targeted practice' : 'Covered') }], gap)}<p class="hint" style="padding:0 20px 16px">Training effectiveness compares assessment results with progress; pre/post diagnostics give a cleaner signal and can be added to the program.</p></section>`;
  } else body = `<div class="grid g2"><section class="panel"><div class="panel-head"><h2>Contract</h2></div><dl class="dl small"><dt>Seats</dt><dd>${org.seats}</dd><dt>Term</dt><dd>${fmtDate(org.start)} to ${fmtDate(org.end)}</dd><dt>Industry</dt><dd>${esc(org.industry)}</dd><dt>Client contact</dt><dd>${esc(org.contactName)}</dd><dt>Branding</dt><dd><span class="org-dot" style="background:${esc(org.color)}"></span> ${esc(org.color)}</dd></dl></section><section class="panel"><div class="panel-head"><h2>Billing</h2>${pill('Integration needed', 'p-mute')}</div><p class="small muted">Corporate invoices, purchase orders and seat true-ups come from the billing system. Integration point: <span class="mono">POST /api/billing/invoices</span> per contract period. Figures are not shown until it is connected, to avoid estimates being read as billing.</p></section>${staffView && ctx.can('orgs.view') && ctx.can('students.manage') ? `<section class="panel"><div class="panel-head"><h2>Program configuration</h2></div><form data-form="orgcfg" class="stack"><div class="field"><label for="progs">Courses in the program</label><select class="select" id="progs" name="programs" multiple size="6">${ctx.s.courses.filter((c) => c.status === 'published').map((c) => `<option value="${c.id}" ${org.programs.includes(c.id) ? 'selected' : ''}>${c.id} · ${esc(c.title)}</option>`).join('')}</select></div><div class="field"><label for="mand">Mandatory courses</label><select class="select" id="mand" name="mandatory" multiple size="4">${ctx.s.courses.filter((c) => c.status === 'published').map((c) => `<option value="${c.id}" ${org.mandatory.includes(c.id) ? 'selected' : ''}>${c.id} · ${esc(c.title)}</option>`).join('')}</select></div><div class="row"><button class="btn btn-primary btn-sm" type="submit">Save configuration</button></div></form></section>` : ''}</div>`;
  const ready = M.rows.filter((r) => r.mandDone === r.mandTotal).length;
  return `<div class="page org-theme" style="--org:${esc(org.color)}">
    <header class="org-hero"><span class="org-mark" style="background:${esc(org.color)}">${esc(org.name.split(' ').map((w) => w[0]).join('').slice(0, 2))}</span><div class="min0">${staffView ? `<nav class="crumbs" aria-label="Breadcrumb"><a href="#/admin/orgs">Organizations</a><span aria-hidden="true">/</span><span>${esc(org.name)}</span></nav>` : ''}<h1>${esc(org.name)}</h1><p class="lede">Private training program · ${esc(org.industry)} · sample organisation. Data is isolated to this organisation.</p></div></header>
    <section class="panel"><div class="panel-head"><h2>Training program progress</h2><span class="sub">Stage ${M.stage + 1} of ${WF.length}</span></div>${stepper(WF, M.stage)}</section>
    <div class="kpis">${kpi({ label: 'Seats used', value: `${M.emps.length}/${org.seats}` })}${kpi({ label: 'Active in 14 days', value: M.rows.filter((r) => r.la && (ctx.now - new Date(r.la)) / 864e5 < 14).length })}${kpi({ label: 'Average progress', value: `${M.rows.length ? Math.round(avg(M.rows, (r) => r.prog)) : 0}%` })}${kpi({ label: 'Mandatory complete', value: `${ready}/${M.rows.length}`, alert: ready < M.rows.length })}</div>
    ${tabs([['overview', 'Overview'], ['people', 'Employees', M.emps.length], ['skills', 'Skill gaps'], ['contract', 'Contract and billing']], T.tab, 'tab')}${body}</div>`;
}

const orgActions = {
  tab(el, e, ctx) { ctx.local(`org:${orgOf(ctx).id}`).tab = el.dataset.id; ctx.rerender(); },
  sort(el, e, ctx) { const T = ctx.local(`org:${orgOf(ctx).id}`); T.dir = T.sort === el.dataset.id && T.dir === 'asc' ? 'desc' : 'asc'; T.sort = el.dataset.id; ctx.rerender(); },
  async export(el, e, ctx) {
    const org = orgOf(ctx); const M = orgModel(ctx, org);
    const r = await exportText(`${org.name.toLowerCase().replace(/\W+/g, '-')}-completion.csv`, toCSV(M.rows, [{ label: 'Employee', value: (x) => x.s.name }, { label: 'Department', value: (x) => x.s.dept }, { label: 'Email', value: (x) => x.s.email }, { label: 'Progress %', value: (x) => x.prog }, { label: 'Mandatory done', value: (x) => `${x.mandDone}/${x.mandTotal}` }, { label: 'Assessment avg %', value: (x) => x.assess ?? '' }, { label: 'Last active', value: (x) => x.la || '' }]));
    ctx.commit('export', () => {}, { silent: true, audit: { action: 'export.csv', entity: 'org', entityId: org.id, detail: 'Completion report', kind: 'data' } });
    ctx.toast(EXPORT_MSG[r]);
  },
  enrollEmp(el, e, ctx) {
    const org = orgOf(ctx);
    ctx.modal({ title: `Enroll an employee · ${org.name}`, body: `${input({ id: 'e-n', label: 'Full name', req: true })}${input({ id: 'e-e', label: 'Work email', type: 'email', req: true })}${select({ id: 'e-d', label: 'Department', options: org.departments })}<p class="hint">They join the private program and are enrolled in the mandatory courses plus the first program course. In production they receive an SSO invite.</p>`, foot: `<button class="btn btn-primary" id="e-go" type="button">Enroll</button>`, onMount: (m, close) => { m.querySelector('#e-go').onclick = () => {
      const name = m.querySelector('#e-n').value.trim(), em = m.querySelector('#e-e').value.trim();
      if (name.length < 3) return ctx.toast('Enter the employee\'s name.', { tone: 'bad' });
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) return ctx.toast('Enter a valid work email.', { tone: 'bad' });
      if (ctx.s.students.some((s) => s.email.toLowerCase() === em.toLowerCase())) return ctx.toast('Someone with this email is already registered.', { tone: 'bad' });
      if (ctx.s.students.filter((s) => s.orgId === org.id).length >= org.seats) return ctx.toast('All contracted seats are used. Contact your account manager to add seats.', { tone: 'bad' });
      const cohort = ctx.s.cohorts.find((c) => c.orgId === org.id);
      if (ctx.commit('org.enroll', (s) => { const n = s.students.length + 1; const id = `S${2000 + n}`; s.students.push({ id, learnerId: `AVXC-${String(n).padStart(4, '0')}`, name, email: em, city: 'Remote', cohortId: cohort.id, orgId: org.id, dept: m.querySelector('#e-d').value, mentorId: cohort.mentorIds[0], joined: iso(ctx.now), status: 'active', ability: 0.6, engagement: 0.6, lang: 'javascript', weeklyGoalMins: 180, lastActiveOffset: 0, career: { headline: '', links: { github: '', linkedin: '' }, resumes: [], targetRoles: [] }, portfolio: { public: false, slug: `${name.toLowerCase().replace(/[^a-z]+/g, '-')}-${n}`, projectIds: [], certIds: [], bio: '' }, bookmarks: [] }); [...new Set([...org.mandatory, org.programs[0]])].forEach((cid) => { try { enroll(s, id, cid, ctx.now, { override: true }); } catch { /* already enrolled */ } }); ctx.notify(id, 'announcement', `Welcome to the ${org.name} program`, 'Start with your mandatory course.', '/dashboard'); }, { ok: `${name} enrolled`, audit: { action: 'org.enroll', entity: 'org', entityId: org.id, detail: em, kind: 'data' } }) === true) close();
    }; } });
  },
};
const orgForms = {
  orgcfg(form, d, ctx) {
    const org = orgOf(ctx);
    if (!(d.programs || []).length) return ctx.toast('Select at least one program course.', { tone: 'bad' });
    ctx.commit('org.config', (s) => { const o = s.orgs.find((x) => x.id === org.id); o.programs = d.programs; o.mandatory = d.mandatory || []; const c = s.cohorts.find((x) => x.orgId === org.id); if (c) c.path = [...new Set([...o.programs, ...o.mandatory])]; }, { ok: 'Program updated', audit: { action: 'org.configure', entity: 'org', entityId: org.id, detail: `${d.programs.length} courses, ${(d.mandatory || []).length} mandatory` } });
  },
};
function orgOf(ctx) { return ctx.me.role === 'corporate' ? ctx.s.orgs.find((o) => o.id === ctx.me.orgId) : ctx.s.orgs.find((o) => o.id === ctx.params.id); }

export const myOrg = {
  perms: ['orgs.own'],
  flag: 'corporate',
  title: () => 'My Organization',
  render(ctx) { const org = visibleOrgs(ctx.s, ctx.me)[0]; return org ? workspace(ctx, org, false) : empty('No organisation linked to this account'); },
  actions: orgActions,
  forms: orgForms,
};

export const orgs = {
  perms: ['orgs.view'],
  flag: 'corporate',
  title: () => 'Organizations',
  render(ctx) {
    const list = visibleOrgs(ctx.s, ctx.me);
    return `<div class="page">${pageHead({ title: 'Corporate organizations', lede: 'Each client is a separate tenant: its employees, reports and private cohort are invisible to other clients.', actions: ctx.can('users.manage') ? btn('Set up client', { act: 'newOrg', cls: 'btn-primary', ic: 'plus' }) : '' })}
      <div class="grid g-auto" style="--min:320px">${list.map((o) => { const M = orgModel(ctx, o); return `<a class="panel stack org-card" href="#/admin/orgs/${o.id}" style="--gap:10px;--org:${esc(o.color)}"><div class="row nowrap"><span class="org-mark" style="background:${esc(o.color)}">${esc(o.name.split(' ').map((w) => w[0]).join('').slice(0, 2))}</span><div class="min0"><b>${esc(o.name)}</b><div class="xs muted">${esc(o.industry)} · ${o.departments.length} departments · sample</div></div></div><div class="stat-line"><div><b>${M.emps.length}/${o.seats}</b><span>seats</span></div><div><b>${M.rows.length ? Math.round(avg(M.rows, (r) => r.prog)) : 0}%</b><span>avg progress</span></div><div><b>${M.rows.filter((r) => r.mandDone === r.mandTotal).length}</b><span>mandatory done</span></div></div><div class="small">Program stage: <b>${WF[M.stage]}</b> (${M.stage + 1} of ${WF.length})</div>${bar(((M.stage + 1) / WF.length) * 100)}<span class="xs muted">Contract ${fmtShort(o.start)} to ${fmtShort(o.end)}</span></a>`; }).join('')}</div></div>`;
  },
  actions: {
    newOrg(el, e, ctx) {
      ctx.modal({ title: 'Set up a corporate client', body: `${input({ id: 'o-n', label: 'Organisation name', req: true })}<div class="form-grid">${input({ id: 'o-i', label: 'Industry', value: 'Technology' })}${input({ id: 'o-s', label: 'Seats', type: 'number', value: 10 })}${input({ id: 'o-c', label: 'Brand colour', type: 'color', value: '#1F6F8B' })}</div><div class="form-grid">${input({ id: 'o-st', label: 'Contract start', type: 'date', value: iso(ctx.now) })}${input({ id: 'o-en', label: 'Contract end', type: 'date', value: iso(new Date(ctx.now.getTime() + 365 * 864e5)) })}</div>${input({ id: 'o-d', label: 'Departments (comma separated)', value: 'Engineering, Data' })}${input({ id: 'o-ct', label: 'Client contact name', req: true })}${select({ id: 'o-p', label: 'First program course', options: ctx.s.courses.filter((c) => c.status === 'published').map((c) => [c.id, `${c.id} · ${c.title}`]) })}`, foot: `<button class="btn btn-primary" id="o-go" type="button">Create client</button>`, onMount: (m, close) => { m.querySelector('#o-go').onclick = () => {
        const name = m.querySelector('#o-n').value.trim(); const seats = Number(m.querySelector('#o-s').value); const contact = m.querySelector('#o-ct').value.trim();
        if (name.length < 3 || contact.length < 3) return ctx.toast('Name and client contact are required.', { tone: 'bad' });
        if (!(seats >= 1 && seats <= 1000)) return ctx.toast('Seats must be 1 to 1,000.', { tone: 'bad' });
        if (m.querySelector('#o-en').value <= m.querySelector('#o-st').value) return ctx.toast('Contract end must be after the start.', { tone: 'bad' });
        const id = `ORG-${uid('o').slice(2, 6).toUpperCase()}`;
        const first = m.querySelector('#o-p').value;
        if (ctx.commit('org.create', (s) => { s.orgs.push({ id, name, industry: m.querySelector('#o-i').value, color: m.querySelector('#o-c').value, departments: m.querySelector('#o-d').value.split(',').map((x) => x.trim()).filter(Boolean), contactName: contact, seats, start: m.querySelector('#o-st').value, end: m.querySelector('#o-en').value, programs: [first], mandatory: ['SEC201'] }); s.cohorts.push({ id: `C-${id}`, name: `${name} · private program`, domain: s.courses.find((c) => c.id === first).domain, path: [first, 'SEC201'], start: m.querySelector('#o-st').value, end: m.querySelector('#o-en').value, weeks: 30, fee: 0, pmId: 'U-PM1', capacity: seats, mentorIds: ['U-M01'], orgId: id, private: true }); s.users.push({ id: `U-CC-${id}`, name: contact, role: 'corporate', orgId: id, email: `${contact.toLowerCase().replace(/[^a-z]+/g, '.')}@client.example` }); }, { ok: `${name} created with a private cohort and client login`, audit: { action: 'org.create', entity: 'org', entityId: id, detail: `${name}, ${seats} seats` } }) === true) { close(); ctx.nav(`/admin/orgs/${id}`); }
      }; } });
    },
  },
};

export const orgDetail = {
  perms: ['orgs.view'],
  flag: 'corporate',
  title: (ctx) => ctx.s.orgs.find((o) => o.id === ctx.params.id)?.name || 'Organization',
  render(ctx) { const org = visibleOrgs(ctx.s, ctx.me).find((o) => o.id === ctx.params.id); return org ? workspace(ctx, org, true) : empty('Organisation not found'); },
  actions: orgActions,
  forms: orgForms,
};
