// Institute operations: students, admissions (enrollment workflow), cohorts, faculty,
// attendance and leave, fees, placements and the instructor control centre.
import { esc, fmtDate, fmtDateTime, fmtShort, relDays, inr, inrL, iso, uid, addDays, toCSV, avg, round, daysBetween } from '../core/util.js';
import { icon } from '../core/icons.js';
import { pageHead, pill, btn, empty, tabs, table, kpi, bar, select, input, textarea, searchBox, avatar, timeline, hbars, lineChart, barChart, domainVar, swatch, stepper, check } from '../core/ui.js';
import { visibleStudents, visibleCohorts, displayName, teachingCourseIds, canReadMentorNote } from '../domain/scope.js';
import { progressOf, enroll, lessonsOf } from '../domain/progress.js';
import { lastActive } from '../domain/activity.js';
import { invoiceStatus, recordPayment, applyAdjustment, requestRefund, decideRefund, OFFLINE_MODES, newInvoice, collectionsByMonth } from '../domain/fees.js';
import { readiness, APP_STAGES, APP_LABEL, moveApplication } from '../domain/career.js';
import { attendancePct } from '../domain/certification.js';
import { moduleFunnel } from '../domain/analytics.js';
import { studentSummary, riskTone, riskLabel } from './shared.js';
import { RULES } from '../domain/risk.js';
import { DOMAINS } from '../data/catalog.js';
import { ASSESSMENTS } from '../data/questions.js';
import { exportText, EXPORT_MSG } from '../services/exporter.js';
import { STATE_LABEL, STATE_PILL } from '../domain/projects.js';

const cohortName = (ctx, id) => ctx.s.cohorts.find((c) => c.id === id)?.name || '';
async function doExport(ctx, name, rows, cols) {
  const r = await exportText(name, toCSV(rows, cols));
  ctx.commit('export', () => {}, { silent: true, audit: { action: 'export.csv', entity: 'report', entityId: name, detail: `${rows.length} rows`, kind: 'data' } });
  ctx.toast(EXPORT_MSG[r]);
}

// =================================================================== STUDENTS
export const students = {
  perms: ['students.view'],
  title: () => 'Students',
  render(ctx) {
    const F = ctx.local('stu', { q: '', cohort: 'all', status: 'all', risk: 'all', sort: 'name', dir: 'asc', page: 1 });
    const risk = new Map(ctx.risk().map((r) => [r.studentId, r]));
    const scope = visibleStudents(ctx.s, ctx.me);
    const cohorts = [...new Set(scope.map((s) => s.cohortId))].map((id) => ctx.s.cohorts.find((c) => c.id === id));
    const enr = (s) => ctx.s.enrollments.filter((e) => e.studentId === s.id);
    const avgProg = (s) => { const e = enr(s); return e.length ? Math.round(avg(e, (x) => progressOf(ctx.s.courses.find((c) => c.id === x.courseId), x).pct)) : 0; };
    const fee = (s) => { const inv = ctx.s.invoices.find((i) => i.studentId === s.id); return inv ? invoiceStatus(inv, ctx.now) : null; };
    let list = scope.filter((s) => (F.cohort === 'all' || s.cohortId === F.cohort) && (F.status === 'all' || s.status === F.status) && (F.risk === 'all' || (risk.get(s.id)?.level || 'none') === F.risk) && (!F.q || `${s.name} ${s.learnerId} ${s.email} ${s.city}`.toLowerCase().includes(F.q.toLowerCase())));
    const cols = [
      { key: 'name', label: 'Learner', sort: (s) => s.name, render: (s) => `<div class="row nowrap">${avatar(s.name, 'sm')}<div class="min0"><b>${esc(s.name)}</b><div class="sub mono">${esc(s.learnerId)}${s.orgId ? ` · ${esc(ctx.s.orgs.find((o) => o.id === s.orgId).name)}` : ''}</div></div></div>` },
      { key: 'cohort', label: 'Cohort', sort: (s) => cohortName(ctx, s.cohortId), render: (s) => `<span class="small">${esc(cohortName(ctx, s.cohortId))}</span>` },
      { key: 'status', label: 'Status', sort: (s) => s.status, render: (s) => pill(s.status, s.status === 'active' ? 'p-ok' : s.status === 'paused' ? 'p-warn' : 'p-mute') },
      { key: 'prog', label: 'Avg progress', r: true, sort: avgProg, render: (s) => `${avgProg(s)}%` },
      { key: 'last', label: 'Last active', sort: (s) => lastActive(ctx.idx(), s.id) || '', render: (s) => { const la = lastActive(ctx.idx(), s.id); return la ? relDays(la, ctx.now) : '<span class="muted">never</span>'; } },
      { key: 'risk', label: 'Risk', sort: (s) => ({ high: 3, medium: 2, low: 1, none: 0 }[risk.get(s.id)?.level || 'none']), render: (s) => pill(riskLabel[risk.get(s.id)?.level || 'none'], riskTone[risk.get(s.id)?.level || 'none']) },
      ...(ctx.can('fees.view') ? [{ key: 'fees', label: 'Fees', sort: (s) => fee(s)?.outstanding || 0, render: (s) => { const f = fee(s); return f ? (f.status === 'paid' ? pill('Paid', 'p-ok', true) : f.status === 'overdue' ? `${pill('Overdue', 'p-bad', true)}<div class="sub">${inr(f.overdueAmt)}</div>` : `<span class="small">${inr(f.outstanding)} due</span>`) : '<span class="muted small">Corporate</span>'; } }] : []),
    ];
    return `<div class="page">${pageHead({ title: 'Students', lede: `${scope.length} learners in your scope${ctx.me.role === 'mentor' ? ' (your assigned learners)' : ctx.me.role === 'instructor' ? ' (learners in your courses)' : ''}.`, actions: ctx.can('data.export') ? btn('Export CSV', { act: 'export', ic: 'download' }) : '' })}
      <div class="toolbar"><div class="grow-field">${searchBox({ id: 'st-q', value: F.q, placeholder: 'Search name, learner ID, email, city', a: { 'data-input': 'q' } })}</div>
        ${select({ id: 'st-c', label: 'Cohort', value: F.cohort, options: [['all', 'All cohorts'], ...cohorts.map((c) => [c.id, c.name])], a: { 'data-change': 'f', 'data-key': 'cohort' } })}
        ${select({ id: 'st-s', label: 'Status', value: F.status, options: [['all', 'All'], 'active', 'paused', 'withdrawn', 'graduated'], a: { 'data-change': 'f', 'data-key': 'status' } })}
        ${select({ id: 'st-r', label: 'Risk', value: F.risk, options: [['all', 'All'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low'], ['none', 'On track']], a: { 'data-change': 'f', 'data-key': 'risk' } })}</div>
      <section class="panel flush">${table(cols, list, { sortKey: F.sort, sortDir: F.dir, sortAct: 'sort', page: F.page, pageSize: 20, pageAct: 'page', rowAct: 'open', rowId: (s) => s.id, wide: true, caption: 'Students', empty: 'No learners match these filters.' })}</section></div>`;
  },
  actions: {
    q(el, e, ctx) { const F = ctx.local('stu'); F.q = el.value; F.page = 1; clearTimeout(sT); sT = setTimeout(() => ctx.rerender(), 180); },
    f(el, e, ctx) { const F = ctx.local('stu'); F[el.dataset.key] = el.value; F.page = 1; ctx.rerender(); },
    sort(el, e, ctx) { const F = ctx.local('stu'); F.dir = F.sort === el.dataset.id && F.dir === 'asc' ? 'desc' : 'asc'; F.sort = el.dataset.id; ctx.rerender(); },
    page(el, e, ctx) { ctx.local('stu').page = Number(el.dataset.id); ctx.rerender(); },
    open(el, e, ctx) { ctx.nav(`/ops/students/${el.dataset.id}`); },
    export(el, e, ctx) { const risk = new Map(ctx.risk().map((r) => [r.studentId, r.level])); const rows = visibleStudents(ctx.s, ctx.me); doExport(ctx, 'avgenx-students.csv', rows, [{ label: 'Learner ID', value: (s) => s.learnerId }, { label: 'Name', value: (s) => s.name }, { label: 'Email', value: (s) => s.email }, { label: 'Cohort', value: (s) => cohortName(ctx, s.cohortId) }, { label: 'Status', value: (s) => s.status }, { label: 'Risk', value: (s) => risk.get(s.id) || 'none' }, { label: 'Last active', value: (s) => lastActive(ctx.idx(), s.id) || '' }]); },
  },
};
let sT;

export const studentProfile = {
  perms: ['students.view'],
  title: (ctx) => ctx.s.students.find((s) => s.id === ctx.params.id)?.name || 'Student',
  render(ctx) {
    if (!visibleStudents(ctx.s, ctx.me).some((s) => s.id === ctx.params.id)) return empty('Student not in your scope', 'Mentors see assigned learners, instructors see learners in their courses, corporate clients see their own employees.', { ic: 'lock' });
    const sum = studentSummary(ctx, ctx.params.id);
    const st = sum.st;
    const T = ctx.local(`sp:${st.id}`, { tab: 'overview' });
    const inv = ctx.s.invoices.find((i) => i.studentId === st.id);
    const notes = ctx.s.mentorNotes.filter((n) => n.studentId === st.id && canReadMentorNote(ctx.me, n));
    const tabsList = [['overview', 'Overview'], ['academics', 'Academics'], ['projects', 'Projects', sum.projects.length], ['attendance', 'Attendance'], ...(ctx.can('fees.view') && inv ? [['fees', 'Fees']] : []), ...(ctx.can('mentor.notes') ? [['notes', 'Mentor notes', notes.length]] : []), ['activity', 'Record history']];
    let body = '';
    if (T.tab === 'overview') body = `<div class="grid g2"><section class="panel"><div class="panel-head"><h2>Risk and evidence</h2>${pill(riskLabel[sum.risk.level], riskTone[sum.risk.level])}</div>${sum.risk.flags.length ? `<div class="list">${sum.risk.flags.map((f) => `<div class="item" style="align-items:flex-start"><div class="min0"><b class="small">${esc(RULES[f.rule].label)}</b><div class="s">${esc(f.evidence)}</div><div class="s"><b>Recommended:</b> ${esc(RULES[f.rule].action)}</div></div></div>`).join('')}</div>${ctx.can('risk.intervene') && !ctx.s.interventions.some((iv) => iv.studentId === st.id && !['resolved'].includes(iv.state)) ? `<div style="margin-top:10px">${btn('Start intervention', { act: 'startIv', cls: 'btn-primary', sm: true })}</div>` : ''}` : '<p class="small muted">No flags under current rules.</p>'}</section>
      <section class="panel"><div class="panel-head"><h2>Snapshot</h2></div><div class="stat-line"><div><b>${sum.streak}</b><span>day streak</span></div><div><b>${sum.solved.length}</b><span>problems solved</span></div><div><b>${sum.ready.score}</b><span>readiness</span></div><div><b>${sum.ledger.total}</b><span>XP</span></div></div><dl class="dl small" style="margin-top:14px"><dt>Email</dt><dd>${esc(st.email)}</dd><dt>City</dt><dd>${esc(st.city)}</dd><dt>Joined</dt><dd>${fmtDate(st.joined)}</dd><dt>Mentor</dt><dd>${esc(displayName(ctx.s, st.mentorId))}</dd><dt>Accommodation</dt><dd>${st.accommodation?.extraTimePct ? `${st.accommodation.extraTimePct}% extra time on assessments` : 'None recorded'}</dd></dl>${btn('Open learner dashboard', { href: `/dashboard?student=${st.id}`, sm: true, ic: 'dash' })}</section></div>`;
    else if (T.tab === 'academics') body = `<section class="panel flush">${table([{ key: 'c', label: 'Course', render: (x) => `<b>${x.c.id}</b> ${esc(x.c.title)}` }, { key: 'p', label: 'Progress', render: (x) => `${bar(x.p.pct)}<span class="sub">${x.p.done}/${x.p.total}</span>` }, { key: 'e', label: 'Enrolled', render: (x) => fmtDate(x.e.enrolledAt) }, { key: 'a', label: 'Attendance', r: true, render: (x) => { const a = attendancePct(ctx.s, st.id, x.c.id); return a === null ? 'n/a' : `${a}%`; } }], sum.enr)}</section>
      <section class="panel flush" style="margin-top:16px"><div class="panel-head" style="padding:18px 20px 0"><h2>Assessment attempts</h2></div>${table([{ key: 'a', label: 'Assessment', render: (a) => esc(ASSESSMENTS.find((x) => x.id === a.assessmentId)?.title || a.assessmentId) }, { key: 'd', label: 'Submitted', render: (a) => fmtShort(a.submittedAt || a.startedAt) }, { key: 's', label: 'Score', r: true, render: (a) => (a.status === 'in_progress' ? pill('In progress', 'p-info') : a.status === 'needs_grading' ? pill('Grading', 'p-warn') : pill(`${a.pct}%`, a.passed ? 'p-ok' : 'p-bad', true)) }, { key: 'x', label: '', r: true, render: (a) => (a.status !== 'in_progress' && !a.seeded ? btn('View', { href: `/assessments/result/${a.id}`, sm: true }) : '') }], ctx.s.attempts.filter((a) => a.studentId === st.id), { empty: 'No attempts.' })}</section>`;
    else if (T.tab === 'projects') body = `<section class="panel flush">${table([{ key: 'a', label: 'Assignment', render: (p) => esc(ctx.s.assignments.find((a) => a.id === p.assignmentId)?.title) }, { key: 's', label: 'State', render: (p) => pill(STATE_LABEL[p.state], STATE_PILL[p.state]) }, { key: 'd', label: 'Due', render: (p) => fmtShort(p.due) }], sum.projects, { rowAct: 'openProject', rowId: (p) => p.id, empty: 'No projects.' })}</section>`;
    else if (T.tab === 'attendance') { const ses = ctx.s.sessions.filter((x) => x.status === 'completed' && st.id in (x.attendance || {})); body = `<section class="panel flush">${table([{ key: 't', label: 'Session', render: (x) => `${esc(x.title)}<div class="sub">${x.courseId}</div>` }, { key: 'd', label: 'Date', render: (x) => fmtDateTime(x.start) }, { key: 'a', label: 'Attendance', render: (x) => (x.attendance[st.id] ? pill('Present', 'p-ok') : pill('Absent', 'p-bad')) }], ses, { empty: 'No completed sessions.' })}</section>${ctx.s.leaveRequests.filter((l) => l.studentId === st.id).length ? `<section class="panel" style="margin-top:16px"><h2>Leave requests</h2><div class="list" style="margin-top:8px">${ctx.s.leaveRequests.filter((l) => l.studentId === st.id).map((l) => `<div class="item"><span class="grow small">${fmtShort(l.from)} to ${fmtShort(l.to)} · ${esc(l.reason)}</span>${pill(l.status, l.status === 'approved' ? 'p-ok' : l.status === 'rejected' ? 'p-bad' : 'p-warn')}</div>`).join('')}</div></section>` : ''}`; }
    else if (T.tab === 'fees') body = invoicePanel(ctx, inv);
    else if (T.tab === 'notes') body = `<section class="panel stack"><p class="small muted">Private. Students never see these notes.</p><form data-form="note" class="stack">${textarea({ id: 'note', label: 'Add a note', rows: 2 })}<div class="row"><button class="btn btn-primary btn-sm" type="submit">Save note</button></div></form><div class="list">${notes.sort((a, b) => (a.at < b.at ? 1 : -1)).map((n) => `<div class="item" style="align-items:flex-start"><span class="small grow">${esc(n.text)}<br><span class="s">${esc(displayName(ctx.s, n.mentorId))} · ${fmtDateTime(n.at)}</span></span></div>`).join('') || '<p class="small muted">No notes.</p>'}</div></section>`;
    else body = `<section class="panel">${timeline(ctx.s.audit.filter((a) => a.entityId === st.id || a.entityId.startsWith(`${st.id}:`) || a.entityId.includes(st.id)).slice(0, 30).map((a) => ({ title: a.action, sub: `${esc(displayName(ctx.s, a.actorId))} · ${fmtDateTime(a.at)} · ${esc(a.detail)}` }))) || '<p class="small muted">No recorded changes for this learner yet.</p>'}</section>`;
    const manage = ctx.can('students.manage');
    return `<div class="page">${pageHead({ title: st.name, crumb: [['Students', '/ops/students'], [st.name]], eyebrow: `${esc(st.learnerId)} · ${esc(cohortName(ctx, st.cohortId))}`, lede: `Status: ${esc(st.status)}${st.orgId ? ` · corporate learner, ${esc(ctx.s.orgs.find((o) => o.id === st.orgId).name)} (${esc(st.dept)})` : ''}`, actions: manage ? `${btn('Edit record', { act: 'edit', ic: 'edit' })}` : '' })}
      ${tabs(tabsList, T.tab, 'tab')}${body}</div>`;
  },
  actions: {
    tab(el, e, ctx) { ctx.local(`sp:${ctx.params.id}`).tab = el.dataset.id; ctx.rerender(); },
    openProject(el, e, ctx) { ctx.nav(`/projects/${el.dataset.id}`); },
    startIv(el, e, ctx) { const r = ctx.risk().find((x) => x.studentId === ctx.params.id); const st = ctx.s.students.find((s) => s.id === ctx.params.id); ctx.commit('iv.create', (s) => { s.interventions.push({ id: uid('IV'), studentId: st.id, state: 'notified', ruleIds: r.flags.map((f) => f.rule), createdAt: new Date().toISOString(), ownerId: st.mentorId, plan: '', outcome: '', history: [{ at: new Date().toISOString(), by: ctx.me.id, state: 'flagged', note: r.flags.map((f) => f.evidence).join(' ') }, { at: new Date().toISOString(), by: 'system', state: 'notified', note: `Mentor ${displayName(s, st.mentorId)} notified` }] }); ctx.notify(st.mentorId, 'mentor', 'Intervention started', `${st.name}: ${r.flags.map((f) => RULES[f.rule].label).join(', ')}`, '/mentors'); }, { ok: 'Intervention started and mentor notified', audit: { action: 'intervention.create', entity: 'student', entityId: st.id } }); },
    edit(el, e, ctx) {
      const st = ctx.s.students.find((s) => s.id === ctx.params.id);
      const mentorsL = ctx.s.users.filter((u) => u.role === 'mentor');
      ctx.modal({ title: `Edit ${st.name}`, body: `${select({ id: 'e-status', label: 'Status', value: st.status, options: ['active', 'paused', 'withdrawn', 'graduated'] })}${select({ id: 'e-cohort', label: 'Cohort', value: st.cohortId, options: visibleCohorts(ctx.s, ctx.me).filter((c) => !!c.orgId === !!st.orgId).map((c) => [c.id, c.name]) })}${select({ id: 'e-mentor', label: 'Mentor', value: st.mentorId, options: mentorsL.map((m) => [m.id, m.name]) })}${input({ id: 'e-extra', label: 'Extra time on assessments (%)', type: 'number', value: st.accommodation?.extraTimePct || 0, hint: 'Accommodation agreed with the learner. 0 to 100.' })}`, foot: `<button class="btn btn-ghost" type="button" data-close>Cancel</button><button class="btn btn-primary" id="e-go" type="button">Save</button>`, onMount: (m, close) => {
        m.parentElement.querySelectorAll('[data-close]').forEach((b) => (b.onclick = close));
        m.querySelector('#e-go').onclick = async () => {
          const status = m.querySelector('#e-status').value, extra = Number(m.querySelector('#e-extra').value);
          if (!(extra >= 0 && extra <= 100)) return ctx.toast('Extra time must be 0 to 100%.', { tone: 'bad' });
          if (status === 'withdrawn' && st.status !== 'withdrawn' && !(await ctx.confirm({ title: 'Withdraw this learner?', body: 'They lose access to classes and assessments. Their records are kept and the change is logged. A refund, if due, is handled in Fees.', confirmLabel: 'Withdraw', danger: true }))) return;
          const changes = [];
          if (ctx.commit('student.update', (s) => { const x = s.students.find((y) => y.id === st.id); if (x.status !== status) changes.push(`status ${x.status} → ${status}`); if (x.cohortId !== m.querySelector('#e-cohort').value) changes.push('cohort changed'); if (x.mentorId !== m.querySelector('#e-mentor').value) { changes.push('mentor changed'); ctx.notify(m.querySelector('#e-mentor').value, 'mentor', 'New learner assigned', x.name, '/mentors'); } x.status = status; x.cohortId = m.querySelector('#e-cohort').value; x.mentorId = m.querySelector('#e-mentor').value; x.accommodation = { extraTimePct: extra }; }, { ok: 'Saved', audit: { action: 'student.update', entity: 'student', entityId: st.id, detail: changes.join('; ') || 'Accommodation updated' } }) === true) close();
        };
      } });
    },
    ...feeActions(),
  },
  forms: {
    note(form, d, ctx) { if (!d.note?.trim()) return; ctx.commit('mentor.note', (s) => { s.mentorNotes.push({ id: uid('MN'), studentId: ctx.params.id, mentorId: ctx.me.id, at: new Date().toISOString(), text: d.note.trim(), private: true }); }, { ok: 'Note saved' }); },
    ...feeForms(),
  },
};

// =================================================================== FEES (shared invoice panel)
function invoicePanel(ctx, inv) {
  const st = invoiceStatus(inv, ctx.now);
  const s = ctx.s.students.find((x) => x.id === inv.studentId);
  const manage = ctx.can('fees.manage');
  const refunds = ctx.s.refunds.filter((r) => r.studentId === inv.studentId);
  return `<div class="stack"><div class="kpis">${kpi({ label: 'Program fee (list)', value: inr(inv.list) })}${kpi({ label: 'Payable after adjustments', value: inr(inv.total), foot: `${inv.scholarshipPct}% scholarship${inv.discountPct ? `, ${inv.discountPct}% discount` : ''}` })}${kpi({ label: 'Paid', value: inr(st.paid) })}${kpi({ label: 'Outstanding', value: inr(st.outstanding), alert: st.overdueAmt > 0, foot: st.overdueAmt ? `${inr(st.overdueAmt)} overdue` : '' })}</div>
    <section class="panel flush"><div class="panel-head" style="padding:18px 20px 0"><h2>Installment schedule</h2>${manage ? btn('Scholarship or discount', { act: 'adjust', sm: true, attrs: { 'data-id': inv.id } }) : ''}</div>${table([
      { key: 'n', label: '#', render: (i) => i.n },
      { key: 'd', label: 'Due', render: (i) => `${fmtDate(i.due)}${!i.paidAt && i.due < iso(ctx.now) ? `<div class="sub" style="color:var(--bad)">${daysBetween(i.due, ctx.now)} days overdue</div>` : ''}` },
      { key: 'a', label: 'Amount', r: true, render: (i) => inr(i.amount) },
      { key: 's', label: 'Status', render: (i) => (i.paidAt ? `${pill('Paid', 'p-ok')}<div class="sub">${fmtShort(i.paidAt)} · ${esc(i.mode)} · ${esc(i.ref)}</div>` : i.due < iso(ctx.now) ? pill('Overdue', 'p-bad') : pill('Due', 'p-mute')) },
      { key: 'x', label: '', r: true, render: (i) => (i.paidAt ? btn('Receipt', { act: 'receipt', sm: true, cls: 'btn-quiet', attrs: { 'data-id': inv.id, 'data-n': i.n } }) : manage ? `<div class="row" style="justify-content:flex-end">${btn('Record payment', { act: 'pay', sm: true, attrs: { 'data-id': inv.id, 'data-n': i.n } })}${btn('Payment link', { sm: true, cls: 'btn-quiet', disabled: true, title: 'Online collection needs the payment gateway integration' })}</div>` : '') },
    ], inv.installments)}</section>
    <section class="panel"><div class="panel-head"><h2>Refunds</h2>${manage ? btn('Raise refund', { act: 'refund', sm: true, attrs: { 'data-id': inv.studentId } }) : ''}</div>${refunds.length ? `<div class="list">${refunds.map((r) => `<div class="item"><span class="grow small">${inr(r.amount)} · ${esc(r.reason)}<br><span class="s">${fmtShort(r.at)}${r.decidedBy ? ` · decided by ${esc(displayName(ctx.s, r.decidedBy))}` : ''}${r.payout ? ` · ${esc(r.payout)}` : ''}</span></span>${pill(r.status, r.status === 'approved' ? 'p-ok' : r.status === 'rejected' ? 'p-bad' : 'p-warn')}${r.status === 'requested' && ctx.can('refunds.approve') ? `${btn('Approve', { act: 'refundDecide', sm: true, attrs: { 'data-id': r.id, 'data-ok': '1' } })}${btn('Reject', { act: 'refundDecide', sm: true, cls: 'btn-quiet', attrs: { 'data-id': r.id, 'data-ok': '0' } })}` : ''}</div>`).join('')}</div>` : '<p class="small muted">No refunds.</p>'}</section>
    <p class="hint">Card and UPI collection through a gateway needs provider confirmation before an installment is marked paid; staff can only record offline payments with a bank reference here. Card details are never stored.</p></div>`;
}
function feeActions() {
  return {
    pay(el, e, ctx) {
      const { id, n } = el.dataset;
      ctx.modal({ title: `Record payment · installment ${n}`, body: `${select({ id: 'p-mode', label: 'Mode', options: OFFLINE_MODES })}${input({ id: 'p-ref', label: 'Bank or UPI reference', req: true, a: { autocomplete: 'off' } })}${input({ id: 'p-date', label: 'Payment date', type: 'date', value: iso(ctx.now), a: { max: iso(ctx.now) } })}`, foot: `<button class="btn btn-ghost" type="button" data-close>Cancel</button><button class="btn btn-primary" id="p-go" type="button">Record</button>`, onMount: (m, close) => { m.parentElement.querySelectorAll('[data-close]').forEach((b) => (b.onclick = close)); m.querySelector('#p-go').onclick = () => { if (ctx.commit('fees.pay', (s) => { const inv = s.invoices.find((x) => x.id === id); const i = recordPayment(inv, n, { ref: m.querySelector('#p-ref').value, mode: m.querySelector('#p-mode').value, date: m.querySelector('#p-date').value }, ctx.now); ctx.notify(inv.studentId, 'admin', 'Payment received', `${inr(i.amount)} for installment ${n}`, '/me'); }, { ok: 'Payment recorded', audit: { action: 'fees.payment', entity: 'invoice', entityId: id, detail: `Installment ${n} via ${m.querySelector('#p-mode').value}` } }) === true) close(); }; } });
    },
    adjust(el, e, ctx) {
      const inv = ctx.s.invoices.find((x) => x.id === el.dataset.id);
      ctx.modal({ title: 'Scholarship or discount', body: `<p class="small muted">Unpaid installments are re-priced; paid ones stay as they are.</p><div class="form-grid">${input({ id: 'a-s', label: 'Scholarship %', type: 'number', value: inv.scholarshipPct })}${input({ id: 'a-d', label: 'Discount %', type: 'number', value: inv.discountPct || 0 })}</div>${input({ id: 'a-r', label: 'Reason', req: true })}`, foot: `<button class="btn btn-primary" id="a-go" type="button">Apply</button>`, onMount: (m, close) => { m.querySelector('#a-go').onclick = () => { const reason = m.querySelector('#a-r').value.trim(); if (reason.length < 5) return ctx.toast('Record a reason for the audit trail.', { tone: 'bad' }); if (ctx.commit('fees.adjust', (s) => { applyAdjustment(s.invoices.find((x) => x.id === inv.id), { scholarshipPct: m.querySelector('#a-s').value, discountPct: m.querySelector('#a-d').value }); }, { ok: 'Fee plan updated', audit: { action: 'fees.adjust', entity: 'invoice', entityId: inv.id, detail: `${m.querySelector('#a-s').value}% scholarship, ${m.querySelector('#a-d').value}% discount: ${reason}` } }) === true) close(); }; } });
    },
    refund(el, e, ctx) {
      ctx.modal({ title: 'Raise refund request', body: `${input({ id: 'r-a', label: 'Amount (₹)', type: 'number', req: true })}${input({ id: 'r-r', label: 'Reason', req: true })}`, foot: `<button class="btn btn-primary" id="r-go" type="button">Raise request</button>`, onMount: (m, close) => { m.querySelector('#r-go').onclick = () => { if (ctx.commit('fees.refund', (s) => { requestRefund(s, el.dataset.id, Number(m.querySelector('#r-a').value), m.querySelector('#r-r').value, ctx.now); }, { ok: 'Refund requested', audit: { action: 'refund.request', entity: 'student', entityId: el.dataset.id, detail: `${m.querySelector('#r-a').value}` } }) === true) close(); }; } });
    },
    refundDecide(el, e, ctx) {
      const ok = el.dataset.ok === '1';
      ctx.confirm({ title: ok ? 'Approve refund?' : 'Reject refund?', body: ok ? 'The refund is approved for payout. Payout itself needs the payment provider or a bank transfer, recorded separately.' : 'The learner will be notified.', confirmLabel: ok ? 'Approve' : 'Reject', danger: !ok }).then((y) => y && ctx.commit('fees.refundDecide', (s) => { const r = decideRefund(s, el.dataset.id, ok, ctx.me.id, ctx.now); ctx.notify(r.studentId, 'admin', `Refund ${r.status}`, inr(r.amount), '/me'); }, { ok: ok ? 'Refund approved' : 'Refund rejected', audit: { action: ok ? 'refund.approve' : 'refund.reject', entity: 'refund', entityId: el.dataset.id, kind: 'admin' } }));
    },
    receipt(el, e, ctx) {
      const inv = ctx.s.invoices.find((x) => x.id === el.dataset.id); const i = inv.installments.find((x) => x.n === Number(el.dataset.n)); const s = ctx.s.students.find((x) => x.id === inv.studentId);
      ctx.modal({ title: 'Payment receipt', body: `<div class="receipt"><div class="spread"><b>${esc(ctx.s.settings.institute.legal)}</b><span class="mono small">RCPT-${esc(inv.id.slice(4))}-${i.n}</span></div><dl class="dl small" style="margin-top:10px"><dt>Received from</dt><dd>${esc(s.name)} (${esc(s.learnerId)})</dd><dt>Program</dt><dd>${esc(cohortName(ctx, inv.cohortId))}</dd><dt>Installment</dt><dd>${i.n} of ${inv.installments.length}</dd><dt>Amount</dt><dd><b>${inr(i.amount)}</b></dd><dt>Paid on</dt><dd>${fmtDate(i.paidAt)}</dd><dt>Mode</dt><dd>${esc(i.mode)}</dd><dt>Reference</dt><dd class="mono">${esc(i.ref)}</dd></dl><p class="xs muted" style="margin-top:10px">Demo receipt. Tax invoices with GST details are generated by the finance system once integrated.</p></div>` });
    },
  };
}
function feeForms() { return {}; }

export const fees = {
  perms: ['fees.view'],
  title: () => 'Fees',
  render(ctx) {
    const F = ctx.local('fee', { tab: 'balances', status: 'all', cohort: 'all', page: 1 });
    const rows = ctx.s.invoices.map((inv) => ({ inv, st: invoiceStatus(inv, ctx.now), s: ctx.s.students.find((x) => x.id === inv.studentId) })).filter((r) => (F.status === 'all' || r.st.status === F.status) && (F.cohort === 'all' || r.inv.cohortId === F.cohort));
    const all = ctx.s.invoices.map((inv) => invoiceStatus(inv, ctx.now));
    const month = iso(ctx.now).slice(0, 7);
    const collectedMonth = ctx.s.invoices.flatMap((i) => i.installments).filter((x) => x.paidAt?.slice(0, 7) === month).reduce((a, x) => a + x.amount, 0);
    const pend = ctx.s.refunds.filter((r) => r.status === 'requested');
    const series = collectionsByMonth(ctx.s, 12, ctx.now);
    let body;
    if (F.tab === 'balances') body = `<div class="stack"><div class="toolbar">${select({ id: 'fe-s', label: 'Status', value: F.status, options: [['all', 'All'], ['overdue', 'Overdue'], ['partial', 'Partly paid'], ['due', 'Not yet paid'], ['paid', 'Paid in full']], a: { 'data-change': 'f', 'data-key': 'status' } })}${select({ id: 'fe-c', label: 'Cohort', value: F.cohort, options: [['all', 'All cohorts'], ...ctx.s.cohorts.filter((c) => !c.private).map((c) => [c.id, c.name])], a: { 'data-change': 'f', 'data-key': 'cohort' } })}<div class="ml-auto">${ctx.can('data.export') ? btn('Export outstanding report', { act: 'export', ic: 'download' }) : ''}</div></div>
      <section class="panel flush">${table([
        { key: 's', label: 'Learner', sort: (r) => r.s.name, render: (r) => `<b>${esc(r.s.name)}</b><div class="sub">${esc(cohortName(ctx, r.inv.cohortId))}</div>` },
        { key: 't', label: 'Payable', r: true, sort: (r) => r.inv.total, render: (r) => `${inr(r.inv.total)}${r.inv.scholarshipPct ? `<div class="sub">${r.inv.scholarshipPct}% scholarship</div>` : ''}` },
        { key: 'p', label: 'Paid', r: true, sort: (r) => r.st.paid, render: (r) => inr(r.st.paid) },
        { key: 'o', label: 'Outstanding', r: true, sort: (r) => r.st.outstanding, render: (r) => inr(r.st.outstanding) },
        { key: 'n', label: 'Next due', sort: (r) => r.st.next?.due || '9', render: (r) => (r.st.next ? `${fmtShort(r.st.next.due)}<div class="sub">${inr(r.st.next.amount)}</div>` : '<span class="muted">n/a</span>') },
        { key: 'st', label: 'Status', sort: (r) => r.st.status, render: (r) => pill({ paid: 'Paid', overdue: `Overdue ${inr(r.st.overdueAmt)}`, partial: 'Partly paid', due: 'Due' }[r.st.status], { paid: 'p-ok', overdue: 'p-bad', partial: 'p-info', due: 'p-mute' }[r.st.status]) },
      ], rows, { sortKey: F.sort || 'o', sortDir: F.dir || 'desc', sortAct: 'sort', page: F.page, pageSize: 20, pageAct: 'page', rowAct: 'openInv', rowId: (r) => r.inv.id, wide: true })}</section></div>`;
    else if (F.tab === 'refunds') body = `<section class="panel flush">${table([{ key: 's', label: 'Learner', render: (r) => esc(displayName(ctx.s, r.studentId)) }, { key: 'a', label: 'Amount', r: true, render: (r) => inr(r.amount) }, { key: 'r', label: 'Reason', render: (r) => esc(r.reason) }, { key: 'd', label: 'Requested', render: (r) => fmtShort(r.at) }, { key: 'st', label: 'Status', render: (r) => pill(r.status, r.status === 'approved' ? 'p-ok' : r.status === 'rejected' ? 'p-bad' : 'p-warn') }, { key: 'x', label: '', r: true, render: (r) => (r.status === 'requested' && ctx.can('refunds.approve') ? `${btn('Approve', { act: 'refundDecide', sm: true, attrs: { 'data-id': r.id, 'data-ok': '1' } })}${btn('Reject', { act: 'refundDecide', sm: true, cls: 'btn-quiet', attrs: { 'data-id': r.id, 'data-ok': '0' } })}` : '') }], ctx.s.refunds.slice().reverse(), { empty: 'No refunds.' })}</section>`;
    else body = `<section class="panel"><div class="panel-head"><h2>Net collections by month</h2><span class="sub">₹ lakh, last 12 months</span></div>${barChart({ values: series.map((x) => round(x.net / 1e5, 1)), labels: series.map((x) => x.label), yFmt: (v) => `${v}`, title: 'Net collections by month in lakh rupees', hl: series.length - 1 })}<p class="hint">Computed from recorded installment payments minus approved refunds. Corporate contracts are billed separately and are not included.</p></section>`;
    return `<div class="page">${pageHead({ title: 'Fees and payments', lede: 'Installment plans, scholarships, offline payment recording, refunds and outstanding balances.' })}
      <div class="kpis">${kpi({ label: 'Collected this month', value: inrL(collectedMonth) })}${kpi({ label: 'Outstanding', value: inrL(all.reduce((a, x) => a + x.outstanding, 0)) })}${kpi({ label: 'Overdue', value: inrL(all.reduce((a, x) => a + x.overdueAmt, 0)), alert: true, foot: `${all.filter((x) => x.status === 'overdue').length} learners` })}${kpi({ label: 'Refunds to decide', value: pend.length, alert: pend.length > 0 })}</div>
      ${tabs([['balances', 'Outstanding balances'], ['refunds', 'Refunds', pend.length], ['collections', 'Collections']], F.tab, 'tab')}${body}</div>`;
  },
  actions: {
    tab(el, e, ctx) { ctx.local('fee').tab = el.dataset.id; ctx.rerender(); },
    f(el, e, ctx) { const F = ctx.local('fee'); F[el.dataset.key] = el.value; F.page = 1; ctx.rerender(); },
    sort(el, e, ctx) { const F = ctx.local('fee'); F.dir = F.sort === el.dataset.id && F.dir === 'desc' ? 'asc' : 'desc'; F.sort = el.dataset.id; ctx.rerender(); },
    page(el, e, ctx) { ctx.local('fee').page = Number(el.dataset.id); ctx.rerender(); },
    openInv(el, e, ctx) { const inv = ctx.s.invoices.find((x) => x.id === el.dataset.id); ctx.openPanel(() => ({ title: displayName(ctx.s, inv.studentId), sub: cohortName(ctx, inv.cohortId), wide: true, body: invoicePanel(ctx, ctx.s.invoices.find((x) => x.id === inv.id)) })); },
    export(el, e, ctx) { const rows = ctx.s.invoices.map((inv) => ({ inv, st: invoiceStatus(inv, ctx.now), s: ctx.s.students.find((x) => x.id === inv.studentId) })).filter((r) => r.st.outstanding > 0); doExport(ctx, 'avgenx-outstanding-fees.csv', rows, [{ label: 'Learner ID', value: (r) => r.s.learnerId }, { label: 'Name', value: (r) => r.s.name }, { label: 'Cohort', value: (r) => cohortName(ctx, r.inv.cohortId) }, { label: 'Payable', value: (r) => r.inv.total }, { label: 'Paid', value: (r) => r.st.paid }, { label: 'Outstanding', value: (r) => r.st.outstanding }, { label: 'Overdue', value: (r) => r.st.overdueAmt }, { label: 'Next due', value: (r) => r.st.next?.due || '' }]); },
    ...feeActions(),
  },
};

// =================================================================== ADMISSIONS
const ADM = ['applied', 'screening', 'assessment', 'offer', 'enrolled'];
const ADM_LABEL = { applied: 'Applied', screening: 'Screening', assessment: 'Diagnostic', offer: 'Offer', enrolled: 'Enrolled', rejected: 'Rejected' };
export const admissions = {
  perms: ['admissions.manage'],
  title: () => 'Admissions',
  render(ctx) {
    const list = ctx.s.admissions;
    const cohorts = ctx.s.cohorts.filter((c) => !c.private);
    return `<div class="page">${pageHead({ title: 'Admissions', lede: 'Application → screening → diagnostic → offer → enrollment. Enrolling creates the learner record, cohort assignment, first-course enrollment, fee plan and personalised roadmap.', actions: btn('New application', { act: 'newApp', cls: 'btn-primary', ic: 'plus' }) })}
      <div class="kpis">${ADM.map((s) => kpi({ label: ADM_LABEL[s], value: list.filter((a) => a.stage === s).length })).join('')}${kpi({ label: 'Rejected', value: list.filter((a) => a.stage === 'rejected').length })}</div>
      <div class="kanban" aria-label="Admissions pipeline">${ADM.map((stg) => `<section class="lane" aria-label="${ADM_LABEL[stg]}"><h3>${ADM_LABEL[stg]} <span>${list.filter((a) => a.stage === stg).length}</span></h3>${list.filter((a) => a.stage === stg).map((a) => `<article class="ticket"><div class="spread"><span class="t">${esc(a.name)}</span><span class="mono xs muted">${a.id}</span></div><div class="xs muted">${esc(DOMAINS.find((d) => d.id === a.domain).short)} · ${esc(cohorts.find((c) => c.id === a.cohortId)?.name.split(' · ')[0] || '')} · via ${esc(a.source)}</div>${a.diagnostic !== null ? `<div class="xs">Diagnostic ${a.diagnostic}%${a.diagnostic < 50 ? ' · suggest PRG101 first' : ''}</div>` : ''}${a.scholarshipPct ? `<div class="xs">${a.scholarshipPct}% scholarship offered</div>` : ''}<div class="row" style="--gap:4px">${stg !== 'enrolled' ? btn(stg === 'offer' ? 'Enroll' : stg === 'assessment' ? 'Record result' : 'Advance', { act: 'advance', sm: true, cls: 'btn-primary', attrs: { 'data-id': a.id } }) + btn('Reject', { act: 'reject', sm: true, cls: 'btn-quiet', attrs: { 'data-id': a.id } }) : btn('Open learner', { href: `/ops/students/${a.studentId || ''}`, sm: true, disabled: !a.studentId })}</div></article>`).join('') || '<p class="xs muted">Empty</p>'}</section>`).join('')}</div>
      ${list.filter((a) => a.stage === 'rejected').length ? `<details class="panel"><summary class="small"><b>Rejected applications (${list.filter((a) => a.stage === 'rejected').length})</b></summary><div class="list" style="margin-top:8px">${list.filter((a) => a.stage === 'rejected').map((a) => `<div class="item"><span class="grow small">${esc(a.name)} · ${esc(a.history[a.history.length - 1]?.note || '')}</span></div>`).join('')}</div></details>` : ''}
      <p class="hint">Applicant contact details are sample data. Phone numbers are masked.</p></div>`;
  },
  actions: {
    newApp(el, e, ctx) {
      ctx.modal({ title: 'New application', body: `${input({ id: 'n-n', label: 'Full name', req: true })}${input({ id: 'n-e', label: 'Email', type: 'email', req: true })}${select({ id: 'n-d', label: 'Domain', options: DOMAINS.map((d) => [d.id, d.name]) })}${select({ id: 'n-c', label: 'Preferred cohort', options: ctx.s.cohorts.filter((c) => !c.private).map((c) => [c.id, c.name]) })}${select({ id: 'n-s', label: 'Source', options: ['Website', 'Referral', 'Campus drive', 'LinkedIn', 'Walk-in'] })}`, foot: `<button class="btn btn-primary" id="n-go" type="button">Create</button>`, onMount: (m, close) => { m.querySelector('#n-go').onclick = () => { const name = m.querySelector('#n-n').value.trim(), email = m.querySelector('#n-e').value.trim(); if (name.length < 3) return ctx.toast('Enter the applicant\'s full name.', { tone: 'bad' }); if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return ctx.toast('Enter a valid email address.', { tone: 'bad' }); if (ctx.s.admissions.some((a) => a.email.toLowerCase() === email.toLowerCase()) || ctx.s.students.some((s) => s.email.toLowerCase() === email.toLowerCase())) return ctx.toast('An application or learner with this email already exists.', { tone: 'bad' }); if (ctx.commit('adm.create', (s) => { s.admissions.unshift({ id: `AD-${String(s.admissions.length + 1).padStart(3, '0')}`, name, email, phone: '', domain: m.querySelector('#n-d').value, cohortId: m.querySelector('#n-c').value, stage: 'applied', source: m.querySelector('#n-s').value, createdAt: new Date().toISOString(), diagnostic: null, scholarshipPct: 0, notes: '', history: [{ at: new Date().toISOString(), stage: 'applied', by: ctx.me.id }] }); }, { ok: 'Application created', audit: { action: 'admission.create', entity: 'admission', entityId: email, kind: 'data' } }) === true) close(); }; } });
    },
    reject(el, e, ctx) { ctx.modal({ title: 'Reject application', body: textarea({ id: 'rj', label: 'Reason (kept on record, not sent)', req: true, rows: 2 }), foot: `<button class="btn btn-danger solid" id="rj-go" type="button">Reject</button>`, onMount: (m, close) => { m.querySelector('#rj-go').onclick = () => { const r = m.querySelector('#rj').value.trim(); if (r.length < 5) return ctx.toast('Record a reason.', { tone: 'bad' }); if (ctx.commit('adm.reject', (s) => { const a = s.admissions.find((x) => x.id === el.dataset.id); a.stage = 'rejected'; a.history.push({ at: new Date().toISOString(), stage: 'rejected', by: ctx.me.id, note: r }); }, { ok: 'Rejected', audit: { action: 'admission.reject', entity: 'admission', entityId: el.dataset.id, detail: r } }) === true) close(); }; } }); },
    advance(el, e, ctx) {
      const a = ctx.s.admissions.find((x) => x.id === el.dataset.id);
      const next = ADM[ADM.indexOf(a.stage) + 1];
      if (a.stage === 'assessment') {
        return ctx.modal({ title: 'Record diagnostic result', body: `<p class="small muted">The "Programming readiness diagnostic" places applicants. Below 50% suggests starting with PRG101.</p>${input({ id: 'dg', label: 'Diagnostic score (%)', type: 'number', req: true })}${input({ id: 'sc', label: 'Scholarship to offer (%)', type: 'number', value: 0 })}`, foot: `<button class="btn btn-primary" id="dg-go" type="button">Make offer</button>`, onMount: (m, close) => { m.querySelector('#dg-go').onclick = () => { const d = Number(m.querySelector('#dg').value), sc = Number(m.querySelector('#sc').value); if (!(d >= 0 && d <= 100) || !(sc >= 0 && sc <= 100)) return ctx.toast('Scores are 0 to 100.', { tone: 'bad' }); if (ctx.commit('adm.offer', (s) => { const x = s.admissions.find((y) => y.id === a.id); x.diagnostic = d; x.scholarshipPct = sc; x.stage = 'offer'; x.history.push({ at: new Date().toISOString(), stage: 'offer', by: ctx.me.id, note: `Diagnostic ${d}%, scholarship ${sc}%` }); }, { ok: 'Offer made', audit: { action: 'admission.offer', entity: 'admission', entityId: a.id, detail: `diag ${d}%, scholarship ${sc}%` } }) === true) close(); }; } });
      }
      if (a.stage === 'offer') return enrollApplicant(ctx, a);
      ctx.commit('adm.advance', (s) => { const x = s.admissions.find((y) => y.id === a.id); x.stage = next; x.history.push({ at: new Date().toISOString(), stage: next, by: ctx.me.id }); }, { ok: `Moved to ${ADM_LABEL[next]}`, audit: { action: 'admission.advance', entity: 'admission', entityId: a.id, detail: `→ ${next}` } });
    },
  },
};
function enrollApplicant(ctx, a) {
  const cohort = ctx.s.cohorts.find((c) => c.id === a.cohortId);
  const first = cohort.path.map((id) => ctx.s.courses.find((c) => c.id === id)).find((c) => c.status === 'published' && !c.prereqs.length) || ctx.s.courses.find((c) => c.id === 'PRG101');
  const needsFoundation = a.diagnostic !== null && a.diagnostic < 50 && first.id !== 'PRG101';
  ctx.confirm({ title: `Enroll ${a.name}?`, body: `Creates the learner in <b>${esc(cohort.name)}</b>, enrolls them in <b>${first.id}</b>${needsFoundation ? ' and PRG101 (diagnostic below 50%)' : ''}, assigns mentor and fee plan (${inr(cohort.fee)}${a.scholarshipPct ? ` less ${a.scholarshipPct}% scholarship` : ''}), and sends a welcome notification.`, confirmLabel: 'Approve enrollment' }).then((ok) => {
    if (!ok) return;
    let sid;
    ctx.commit('adm.enroll', (s) => {
      const n = s.students.length + 1;
      sid = `S${1000 + n + 50}`;
      const st = { id: sid, learnerId: `AVX${String(ctx.now.getFullYear()).slice(2)}-${String(n + 50).padStart(4, '0')}`, name: a.name, email: a.email, city: 'Hyderabad', cohortId: cohort.id, orgId: null, dept: null, mentorId: cohort.mentorIds[n % cohort.mentorIds.length], joined: iso(ctx.now), status: 'active', ability: 0.6, engagement: 0.6, lang: 'javascript', weeklyGoalMins: 300, lastActiveOffset: 0, career: { headline: '', links: { github: '', linkedin: '' }, resumes: [], targetRoles: [] }, portfolio: { public: false, slug: a.name.toLowerCase().replace(/[^a-z]+/g, '-') + '-' + n, projectIds: [], certIds: [], bio: '' }, bookmarks: [] };
      s.students.push(st);
      enroll(s, sid, first.id, ctx.now);
      if (needsFoundation) try { enroll(s, sid, 'PRG101', ctx.now); } catch { /* already enrolled */ }
      if (cohort.fee) s.invoices.push(newInvoice(st, cohort, a.scholarshipPct, ctx.now));
      const x = s.admissions.find((y) => y.id === a.id); x.stage = 'enrolled'; x.studentId = sid; x.history.push({ at: new Date().toISOString(), stage: 'enrolled', by: ctx.me.id, note: `Learner ${st.learnerId} created` });
      ctx.notify(sid, 'announcement', `Welcome to AVGENX Academy, ${a.name.split(' ')[0]}`, `Your roadmap for ${cohort.name} is ready. Start with ${first.id}.`, '/dashboard');
      ctx.notify(st.mentorId, 'mentor', 'New learner assigned', `${a.name} joined ${cohort.name}`, '/mentors');
    }, { audit: { action: 'admission.enroll', entity: 'student', entityId: a.id, detail: `Enrolled in ${cohort.name}` } }) === true && ctx.toast(`${a.name} enrolled. Switch to Student role and pick them to see their roadmap.`);
  });
}

// =================================================================== COHORTS
export const cohorts = {
  perms: ['cohorts.view'],
  title: () => 'Cohorts',
  render(ctx) {
    const list = visibleCohorts(ctx.s, ctx.me);
    const risk = new Map(ctx.risk().map((r) => [r.studentId, r.level]));
    return `<div class="page">${pageHead({ title: 'Cohorts', lede: 'Batches with their program path, capacity, mentors and health.' })}
      <div class="grid g-auto" style="--min:330px">${list.map((c) => { const m = ctx.s.students.filter((s) => s.cohortId === c.id); const act = m.filter((s) => s.status === 'active'); const enr = ctx.s.enrollments.filter((e) => m.some((s) => s.id === e.studentId)); const avgP = enr.length ? Math.round(avg(enr, (e) => progressOf(ctx.s.courses.find((x) => x.id === e.courseId), e).pct)) : 0; const elapsed = Math.max(0, Math.min(100, Math.round((daysBetween(c.start, ctx.now) / (c.weeks * 7)) * 100))); const atRisk = m.filter((s) => ['high', 'medium'].includes(risk.get(s.id))).length; const mentorLoad = c.mentorIds.map((id) => ({ id, n: ctx.s.students.filter((s) => s.mentorId === id && s.status === 'active').length, cap: ctx.s.users.find((u) => u.id === id)?.capacity || 14 })); const overloaded = mentorLoad.some((x) => x.n > x.cap) || m.length > c.capacity; return `<section class="panel stack" style="--gap:10px;${domainVar(c.domain)}"><div class="spread"><span class="mono small" style="color:var(--cat)">${esc(c.id)}${c.private ? ' · PRIVATE' : ''}</span>${overloaded ? pill('Overloaded', 'p-bad') : atRisk > m.length * 0.3 ? pill(`${atRisk} at risk`, 'p-warn') : pill('Healthy', 'p-ok')}</div><h3>${esc(c.name)}</h3><div class="meta"><span>${fmtShort(c.start)} to ${fmtShort(c.end)}</span><span>${m.length}/${c.capacity} learners</span><span>PM ${esc(displayName(ctx.s, c.pmId))}</span></div>
        <div><div class="spread xs"><span>Schedule elapsed</span><span class="mono">${elapsed}%</span></div>${bar(elapsed, 'pencil')}</div><div><div class="spread xs"><span>Average course progress</span><span class="mono">${avgP}%</span></div>${bar(avgP)}</div>
        <div class="chips">${c.path.map((id) => `<a class="chip" href="#/course/${id}">${id}</a>`).join('')}</div>
        <div class="xs muted">Mentors: ${mentorLoad.map((x) => `${esc(displayName(ctx.s, x.id))} (${x.n}/${x.cap})`).join(', ')} · ${act.length} active, ${atRisk} at risk</div>
        ${ctx.can('cohorts.manage') ? `<div class="row">${btn('Edit', { act: 'edit', sm: true, attrs: { 'data-id': c.id } })}${btn('Members', { href: '/ops/students', sm: true, cls: 'btn-quiet' })}</div>` : ''}</section>`; }).join('')}</div></div>`;
  },
  actions: {
    edit(el, e, ctx) {
      const c = ctx.s.cohorts.find((x) => x.id === el.dataset.id);
      const ms = ctx.s.users.filter((u) => u.role === 'mentor');
      ctx.modal({ title: `Edit ${c.name}`, body: `${input({ id: 'c-cap', label: 'Capacity', type: 'number', value: c.capacity })}${select({ id: 'c-pm', label: 'Program manager', value: c.pmId, options: ctx.s.users.filter((u) => u.role === 'pm').map((u) => [u.id, u.name]) })}<fieldset class="stack" style="--gap:6px;border:0;padding:0"><legend class="small" style="font-weight:600">Mentors</legend>${ms.map((m) => check({ id: `cm-${m.id}`, label: `${esc(m.name)} · ${m.domains.join(', ')}`, checked: c.mentorIds.includes(m.id), a: { 'data-m': m.id } })).join('')}</fieldset>`, foot: `<button class="btn btn-primary" id="c-go" type="button">Save</button>`, onMount: (m, close) => { m.querySelector('#c-go').onclick = () => { const cap = Number(m.querySelector('#c-cap').value); const size = ctx.s.students.filter((s) => s.cohortId === c.id).length; if (!(cap >= size && cap <= 200)) return ctx.toast(`Capacity must be between current size (${size}) and 200.`, { tone: 'bad' }); const mids = [...m.querySelectorAll('[data-m]')].filter((x) => x.checked).map((x) => x.dataset.m); if (!mids.length) return ctx.toast('Assign at least one mentor.', { tone: 'bad' }); if (ctx.commit('cohort.update', (s) => { const x = s.cohorts.find((y) => y.id === c.id); x.capacity = cap; x.pmId = m.querySelector('#c-pm').value; x.mentorIds = mids; }, { ok: 'Cohort updated', audit: { action: 'cohort.update', entity: 'cohort', entityId: c.id, detail: `capacity ${cap}, ${mids.length} mentors` } }) === true) close(); }; } });
    },
  },
};

// =================================================================== FACULTY
export const faculty = {
  perms: ['faculty.view'],
  title: () => 'Faculty',
  render(ctx) {
    const staff = ctx.s.users.filter((u) => ['instructor', 'mentor', 'ta'].includes(u.role));
    const now = ctx.now.toISOString();
    const rows = staff.map((u) => { const courses = ctx.s.courses.filter((c) => c.instructorId === u.id || c.mentorIds.includes(u.id)); const teach = ctx.s.sessions.filter((x) => x.instructorId === u.id && x.status !== 'cancelled' && x.start >= addDays(ctx.now, -30).toISOString() && x.start <= now).reduce((a, x) => a + x.mins / 60, 0); const upcoming = ctx.s.sessions.filter((x) => x.instructorId === u.id && x.status === 'scheduled' && x.start >= now).length; const reviews = ctx.s.projects.filter((p) => p.reviewerId === u.id && ['submitted', 'under_review'].includes(p.state)).length; const mentees = ctx.s.students.filter((s) => s.mentorId === u.id && s.status === 'active').length; const rating = courses.length ? avg(courses, (c) => c.feedback.rating) : null; return { u, courses, teach, upcoming, reviews, mentees, rating }; });
    return `<div class="page">${pageHead({ title: 'Faculty', lede: 'Instructors, mentors and teaching assistants with their courses and current load.' })}<section class="panel flush">${table([
      { key: 'n', label: 'Name', sort: (r) => r.u.name, render: (r) => `<div class="row nowrap">${avatar(r.u.name, 'sm')}<div><b>${esc(r.u.name)}</b><div class="sub">${esc(r.u.role)} · ${r.u.domains.map((d) => DOMAINS.find((x) => x.id === d)?.short).join(', ')}</div></div></div>` },
      { key: 'c', label: 'Courses', render: (r) => r.courses.map((c) => `<span class="tag">${c.id}</span>`).join(' ') || '<span class="muted">n/a</span>' },
      { key: 't', label: 'Taught (30 days)', r: true, sort: (r) => r.teach, render: (r) => `${r.teach.toFixed(1)}h<div class="sub">${r.upcoming} upcoming</div>` },
      { key: 'v', label: 'Reviews pending', r: true, sort: (r) => r.reviews, render: (r) => (r.reviews > 10 ? pill(String(r.reviews), 'p-bad', true) : r.reviews) },
      { key: 'm', label: 'Mentees', r: true, sort: (r) => r.mentees, render: (r) => (r.u.role === 'mentor' ? `${r.mentees}/${r.u.capacity}` : '<span class="muted">n/a</span>') },
      { key: 'r', label: 'Course rating', r: true, sort: (r) => r.rating || 0, render: (r) => (r.rating ? `★ ${r.rating.toFixed(1)}` : '<span class="muted">n/a</span>') },
    ], rows, { sortKey: ctx.local('fac', { k: 'n', d: 'asc' }).k, sortDir: ctx.local('fac').d, sortAct: 'sort', wide: true })}</section></div>`;
  },
  actions: { sort(el, e, ctx) { const F = ctx.local('fac'); F.d = F.k === el.dataset.id && F.d === 'asc' ? 'desc' : 'asc'; F.k = el.dataset.id; ctx.rerender(); } },
};

// =================================================================== ATTENDANCE
export const attendance = {
  perms: ['attendance.mark'],
  title: () => 'Attendance',
  render(ctx) {
    const F = ctx.local('att', { cohort: visibleCohorts(ctx.s, ctx.me)[0]?.id });
    const cohortsL = visibleCohorts(ctx.s, ctx.me).filter((c) => ctx.s.sessions.some((x) => x.cohortId === c.id));
    if (!cohortsL.some((c) => c.id === F.cohort)) F.cohort = cohortsL[0]?.id;
    const ses = ctx.s.sessions.filter((x) => x.cohortId === F.cohort && (x.status === 'completed' || x.start < ctx.now.toISOString()) && x.status !== 'cancelled').sort((a, b) => (a.start < b.start ? -1 : 1));
    const members = ctx.s.students.filter((s) => s.cohortId === F.cohort && s.status !== 'withdrawn');
    const leaves = ctx.s.leaveRequests.filter((l) => visibleStudents(ctx.s, ctx.me).some((s) => s.id === l.studentId));
    return `<div class="page">${pageHead({ title: 'Attendance', lede: 'Registers by cohort and session, plus leave requests.' })}
      <div class="toolbar">${select({ id: 'at-c', label: 'Cohort', value: F.cohort, options: cohortsL.map((c) => [c.id, c.name]), a: { 'data-change': 'cohort' } })}</div>
      <section class="panel flush"><div class="tbl-wrap"><table class="tbl wide"><caption class="sr-only">Attendance register</caption><thead><tr><th scope="col">Learner</th>${ses.map((x) => `<th scope="col" class="c" title="${esc(x.title)}">${fmtShort(x.start)}</th>`).join('')}<th scope="col" class="r">Rate</th></tr></thead><tbody>${members.map((s) => { const marks = ses.map((x) => x.attendance?.[s.id]); const known = marks.filter((m) => m !== undefined); const rate = known.length ? Math.round((known.filter(Boolean).length / known.length) * 100) : null; return `<tr><td><b>${esc(s.name)}</b></td>${marks.map((m) => `<td class="c">${m === true ? `<span style="color:var(--ok)" role="img" aria-label="present">${icon('check', 'style="width:15px;height:15px"')}</span>` : m === false ? '<span style="color:var(--bad)" role="img" aria-label="absent">✕</span>' : '<span class="muted" role="img" aria-label="not marked">·</span>'}</td>`).join('')}<td class="r">${rate === null ? 'n/a' : pill(`${rate}%`, rate >= 75 ? 'p-ok' : rate >= 60 ? 'p-warn' : 'p-bad', true)}</td></tr>`; }).join('')}</tbody></table></div><p class="hint" style="padding:10px 14px">Mark or correct attendance from each session on the Live Classes page.</p></section>
      <section class="panel flush"><div class="panel-head" style="padding:18px 20px 0"><h2>Leave requests</h2></div>${table([{ key: 's', label: 'Learner', render: (l) => esc(displayName(ctx.s, l.studentId)) }, { key: 'd', label: 'Dates', render: (l) => `${fmtShort(l.from)} to ${fmtShort(l.to)}` }, { key: 'r', label: 'Reason', render: (l) => esc(l.reason) }, { key: 'st', label: 'Status', render: (l) => pill(l.status, l.status === 'approved' ? 'p-ok' : l.status === 'rejected' ? 'p-bad' : 'p-warn') }, { key: 'x', label: '', r: true, render: (l) => (l.status === 'pending' ? `${btn('Approve', { act: 'leave', sm: true, attrs: { 'data-id': l.id, 'data-ok': '1' } })}${btn('Decline', { act: 'leave', sm: true, cls: 'btn-quiet', attrs: { 'data-id': l.id, 'data-ok': '0' } })}` : '') }], leaves, { empty: 'No leave requests.' })}</section></div>`;
  },
  actions: {
    cohort(el, e, ctx) { ctx.local('att').cohort = el.value; ctx.rerender(); },
    leave(el, e, ctx) { const ok = el.dataset.ok === '1'; ctx.commit('leave.decide', (s) => { const l = s.leaveRequests.find((x) => x.id === el.dataset.id); l.status = ok ? 'approved' : 'rejected'; l.decidedBy = ctx.me.id; ctx.notify(l.studentId, 'class', `Leave ${l.status}`, `${fmtShort(l.from)} to ${fmtShort(l.to)}`, '/live'); }, { ok: ok ? 'Leave approved' : 'Leave declined', audit: { action: 'leave.decide', entity: 'leave', entityId: el.dataset.id, detail: ok ? 'approved' : 'declined' } }); },
  },
};

// =================================================================== PLACEMENTS (staff)
export const placements = {
  perms: ['placement.view'],
  flag: 'placement',
  title: () => 'Placements',
  render(ctx) {
    const T = ctx.local('plc', { tab: 'pipeline' });
    const manage = ctx.can('placement.manage');
    const apps = ctx.s.applications;
    const active = ctx.s.students.filter((s) => s.status === 'active' && !s.orgId);
    const ready = active.map((s) => readiness(ctx.s, s).score);
    let body;
    if (T.tab === 'pipeline') body = `<div class="kanban">${[...APP_STAGES, 'rejected'].map((stg) => `<section class="lane"><h3>${APP_LABEL[stg]} <span>${apps.filter((a) => a.stage === stg).length}</span></h3>${apps.filter((a) => a.stage === stg).slice(0, 25).map((a) => { const j = ctx.s.jobs.find((x) => x.id === a.jobId); return `<article class="ticket"><span class="t">${esc(displayName(ctx.s, a.studentId))}</span><span class="xs muted">${esc(j.title)} · ${esc(ctx.s.employers.find((e) => e.id === j.employerId).name)}</span>${a.offer ? `<span class="xs">${esc(a.offer.note)}</span>` : ''}${manage && !['hired', 'rejected', 'withdrawn'].includes(stg) ? `<div class="row" style="--gap:4px">${btn(`→ ${APP_LABEL[APP_STAGES[APP_STAGES.indexOf(stg) + 1]]}`, { act: 'move', sm: true, attrs: { 'data-id': a.id, 'data-to': APP_STAGES[APP_STAGES.indexOf(stg) + 1] } })}${btn('Not selected', { act: 'move', sm: true, cls: 'btn-quiet', attrs: { 'data-id': a.id, 'data-to': 'rejected' } })}</div>` : ''}</article>`; }).join('')}</section>`).join('')}</div>`;
    else if (T.tab === 'jobs') body = `<div class="stack">${manage ? `<div class="row">${btn('Post a job', { act: 'newJob', cls: 'btn-primary', ic: 'plus' })}</div>` : ''}<section class="panel flush">${table([{ key: 't', label: 'Role', render: (j) => `<b>${esc(j.title)}</b><div class="sub">${esc(ctx.s.employers.find((e) => e.id === j.employerId).name)} · ${j.kind}</div>` }, { key: 'r', label: 'Rules', render: (j) => `Readiness ≥ ${j.minReadiness} · ${esc(DOMAINS.find((d) => d.id === j.domain).short)} track` }, { key: 'e', label: 'Eligible learners', r: true, render: (j) => active.filter((s) => readiness(ctx.s, s).score >= j.minReadiness).length }, { key: 'a', label: 'Applicants', r: true, render: (j) => apps.filter((a) => a.jobId === j.id).length }, { key: 'd', label: 'Deadline', render: (j) => `${fmtShort(j.deadline)} ${j.status === 'closed' ? pill('Closed', 'p-mute') : ''}` }, { key: 'x', label: '', r: true, render: (j) => (manage && j.status === 'open' ? btn('Close', { act: 'closeJob', sm: true, cls: 'btn-quiet', attrs: { 'data-id': j.id } }) : '') }], ctx.s.jobs)}</section></div>`;
    else if (T.tab === 'employers') body = `<section class="panel flush">${table([{ key: 'n', label: 'Employer', render: (e) => `<b>${esc(e.name)}</b><div class="sub">${esc(e.industry)} · sample</div>` }, { key: 'c', label: 'Contact', render: (e) => `<span class="mono small">${esc(e.contact)}</span>` }, { key: 'j', label: 'Open roles', r: true, render: (e) => ctx.s.jobs.filter((j) => j.employerId === e.id && j.status === 'open').length }, { key: 'h', label: 'Hires recorded', r: true, render: (e) => apps.filter((a) => a.stage === 'hired' && ctx.s.jobs.find((j) => j.id === a.jobId)?.employerId === e.id).length }], ctx.s.employers)}</section>`;
    else { const funnel = APP_STAGES.map((s) => ({ label: APP_LABEL[s], value: apps.filter((a) => a.history.some((h) => h.stage === s)).length })); const bands = [[0, 40], [40, 55], [55, 75], [75, 101]].map(([lo, hi]) => ({ label: `${lo} to ${hi === 101 ? 100 : hi - 1}`, value: ready.filter((r) => r >= lo && r < hi).length })); body = `<div class="grid g2"><section class="panel"><div class="panel-head"><h2>Application funnel</h2><span class="sub">Applications that reached each stage</span></div>${hbars(funnel)}</section><section class="panel"><div class="panel-head"><h2>Readiness distribution</h2><span class="sub">${active.length} active learners</span></div>${hbars(bands)}</section></div><p class="hint">Outcomes shown are the demo's sample records. The institute reports only verified offers recorded by the placement office.</p>`; }
    return `<div class="page">${pageHead({ title: 'Placements', lede: 'Applications, interview stages, offers and employers. All employers and listings are fictional sample data.' })}
      <div class="kpis">${kpi({ label: 'Active applications', value: apps.filter((a) => !['rejected', 'withdrawn', 'hired'].includes(a.stage)).length })}${kpi({ label: 'In interviews', value: apps.filter((a) => a.stage === 'interview').length })}${kpi({ label: 'Offers recorded', value: apps.filter((a) => ['offer', 'hired'].includes(a.stage)).length })}${kpi({ label: 'Learners ready (75+)', value: ready.filter((r) => r >= 75).length, foot: `of ${active.length} active` })}</div>
      ${tabs([['pipeline', 'Pipeline'], ['jobs', 'Jobs'], ['employers', 'Employers'], ['outcomes', 'Outcomes']], T.tab, 'tab')}${body}</div>`;
  },
  actions: {
    tab(el, e, ctx) { ctx.local('plc').tab = el.dataset.id; ctx.rerender(); },
    move(el, e, ctx) {
      const to = el.dataset.to;
      const go = (note) => ctx.commit('app.move', (s) => { const a = s.applications.find((x) => x.id === el.dataset.id); moveApplication(a, to, ctx.me.id, note, new Date()); ctx.notify(a.studentId, 'placement', `Application update: ${APP_LABEL[to]}`, s.jobs.find((j) => j.id === a.jobId).title, '/placement'); }, { ok: `Moved to ${APP_LABEL[to]}`, audit: { action: 'application.move', entity: 'application', entityId: el.dataset.id, detail: to } });
      if (to === 'offer' || to === 'rejected') ctx.modal({ title: to === 'offer' ? 'Record offer' : 'Not selected', body: textarea({ id: 'of', label: to === 'offer' ? 'Offer details (role, start date)' : 'Reason (shared with learner)', req: true, rows: 2 }), foot: `<button class="btn btn-primary" id="of-go" type="button">Save</button>`, onMount: (m, close) => { m.querySelector('#of-go').onclick = () => { if (go(m.querySelector('#of').value) === true) close(); }; } });
      else go('');
    },
    closeJob(el, e, ctx) { ctx.confirm({ title: 'Close applications for this role?', body: 'Learners can no longer apply. Existing applications stay in the pipeline.', confirmLabel: 'Close role' }).then((ok) => ok && ctx.commit('job.close', (s) => { s.jobs.find((j) => j.id === el.dataset.id).status = 'closed'; }, { ok: 'Role closed', audit: { action: 'job.close', entity: 'job', entityId: el.dataset.id } })); },
    newJob(el, e, ctx) {
      ctx.modal({ title: 'Post a job', body: `${select({ id: 'j-e', label: 'Employer', options: ctx.s.employers.map((x) => [x.id, x.name]) })}${input({ id: 'j-t', label: 'Title', req: true })}<div class="form-grid">${select({ id: 'j-k', label: 'Type', options: [['job', 'Job'], ['internship', 'Internship']] })}${select({ id: 'j-d', label: 'Domain', options: DOMAINS.map((d) => [d.id, d.short]) })}${input({ id: 'j-r', label: 'Min readiness', type: 'number', value: 60 })}${input({ id: 'j-dl', label: 'Deadline', type: 'date', value: iso(addDays(ctx.now, 21)) })}</div>${input({ id: 'j-s', label: 'Skills (comma separated)' })}${input({ id: 'j-l', label: 'Location', value: 'Hyderabad' })}`, foot: `<button class="btn btn-primary" id="j-go" type="button">Post</button>`, onMount: (m, close) => { m.querySelector('#j-go').onclick = () => { const t = m.querySelector('#j-t').value.trim(); const r = Number(m.querySelector('#j-r').value); if (t.length < 4) return ctx.toast('Add a job title.', { tone: 'bad' }); if (!(r >= 0 && r <= 100)) return ctx.toast('Readiness is 0 to 100.', { tone: 'bad' }); if (ctx.commit('job.create', (s) => { const j = { id: uid('JB'), employerId: m.querySelector('#j-e').value, title: t, kind: m.querySelector('#j-k').value, domain: m.querySelector('#j-d').value, skills: m.querySelector('#j-s').value.split(',').map((x) => x.trim()).filter(Boolean), minReadiness: r, deadline: m.querySelector('#j-dl').value, location: m.querySelector('#j-l').value, mode: 'Hybrid', status: 'open', postedAt: iso(ctx.now) }; s.jobs.unshift(j); s.students.filter((st) => st.status === 'active' && readiness(s, st).score >= r).forEach((st) => ctx.notify(st.id, 'placement', 'New role matches your readiness', t, `/jobs?job=${j.id}`)); }, { ok: 'Job posted and eligible learners notified', audit: { action: 'job.create', entity: 'job', entityId: t } }) === true) close(); }; } });
    },
  },
};

// =================================================================== INSTRUCTOR CENTRE
export const teaching = {
  perms: ['teaching.center'],
  title: () => 'Instructor Center',
  render(ctx) {
    const ids = teachingCourseIds(ctx.s, ctx.me);
    const courses = ctx.s.courses.filter((c) => ids.includes(c.id));
    const now = ctx.now.toISOString();
    const upcoming = ctx.s.sessions.filter((x) => ids.includes(x.courseId) && x.status === 'scheduled' && x.start >= now).sort((a, b) => (a.start < b.start ? -1 : 1));
    const grading = ctx.s.attempts.filter((a) => a.status === 'needs_grading' && ids.includes(ASSESSMENTS.find((x) => x.id === a.assessmentId)?.course));
    const reviews = ctx.s.projects.filter((p) => ids.includes(p.courseId) && ['submitted', 'under_review'].includes(p.state));
    const taught30 = ctx.s.sessions.filter((x) => (ctx.me.role === 'instructor' ? x.instructorId === ctx.me.id : ids.includes(x.courseId)) && x.status === 'completed' && x.start >= addDays(ctx.now, -30).toISOString()).reduce((a, x) => a + x.mins / 60, 0);
    const turnaround = ctx.s.projects.filter((p) => ids.includes(p.courseId) && p.state === 'approved' && p.submittedAt && p.history.length).map((p) => daysBetween(p.submittedAt, p.history[p.history.length - 1].at)).filter((d) => d >= 0);
    const me = ctx.s.users.find((u) => u.id === ctx.me.id);
    const loadH = taught30 * 2.5 + reviews.length * 0.75;
    const cap = (me?.capacity || 18) * 4.3;
    const risk = new Map(ctx.risk().map((r) => [r.studentId, r.level]));
    const C = ctx.local('tc', { course: courses[0]?.id });
    const sel = courses.find((c) => c.id === C.course) || courses[0];
    const roster = sel ? ctx.s.enrollments.filter((e) => e.courseId === sel.id).map((e) => ({ e, s: ctx.s.students.find((x) => x.id === e.studentId), p: progressOf(sel, e) })) : [];
    return `<div class="page">${pageHead({ title: 'Instructor Center', lede: `${courses.length} course${courses.length === 1 ? '' : 's'} · ${upcoming.length} upcoming session${upcoming.length === 1 ? '' : 's'}`, actions: `${btn('Announcement', { href: '/discussions', ic: 'bell' })}${btn('Question bank', { href: '/assessments', ic: 'exam' })}` })}
      <div class="kpis">${kpi({ label: 'Grading queue', value: grading.length, alert: grading.length > 0, act: 'goGrading' })}${kpi({ label: 'Projects to review', value: reviews.length, alert: reviews.length > 6, act: 'goReviews' })}${kpi({ label: 'Taught, last 30 days', value: `${taught30.toFixed(1)}h`, foot: `${upcoming.length} sessions scheduled` })}${kpi({ label: 'Workload', value: `${Math.round((loadH / cap) * 100)}%`, foot: 'teaching ×2.5 for prep, plus 45 min per review, vs monthly capacity', alert: loadH / cap > 0.85 })}${kpi({ label: 'Review turnaround', value: turnaround.length ? `${(turnaround.reduce((a, b) => a + b, 0) / turnaround.length).toFixed(1)} days` : 'n/a', foot: 'submission to approval' })}</div>
      <div class="grid g-main"><div class="stack">
        <section class="panel"><div class="panel-head"><h2>My courses</h2></div><div class="list">${courses.map((c) => { const e = ctx.s.enrollments.filter((x) => x.courseId === c.id); const a = e.length ? Math.round(avg(e, (x) => progressOf(c, x).pct)) : 0; return `<button type="button" class="item" data-act="pickCourse" data-id="${c.id}" ${sel?.id === c.id ? 'aria-current="true"' : ''}>${swatch(c)}<span class="grow min0"><span class="t">${esc(c.title)}</span><br><span class="s">${e.length} learners · avg progress ${a}% · ★ ${c.feedback.rating} · ${c.status}</span></span>${icon('arrow')}</button>`; }).join('') || empty('No courses assigned')}</div></section>
        ${sel ? `<section class="panel"><div class="panel-head"><h2>${sel.id}: where learners stall</h2><span class="sub">Share of enrolled learners who completed each module</span></div>${hbars(moduleFunnel(ctx.s, sel).map((m) => ({ label: m.title, value: m.pct, max: 100, display: `${m.pct}%`, color: m.pct < 40 ? 'var(--warn)' : 'var(--s1)' })))}</section>
        <section class="panel flush"><div class="panel-head" style="padding:18px 20px 0"><h2>Roster: ${sel.id}</h2><span class="sub">${roster.length} learners</span></div>${table([{ key: 'n', label: 'Learner', sort: (r) => r.s.name, render: (r) => `<a href="#/ops/students/${r.s.id}" style="font-weight:600;text-decoration:none">${esc(r.s.name)}</a>` }, { key: 'p', label: 'Progress', sort: (r) => r.p.pct, render: (r) => `${bar(r.p.pct)}<span class="sub">${r.p.done}/${r.p.total}</span>` }, { key: 'l', label: 'Last lesson', sort: (r) => r.p.lastAt || '', render: (r) => (r.p.lastAt ? relDays(r.p.lastAt, ctx.now) : 'never') }, { key: 'a', label: 'Attendance', r: true, render: (r) => { const a = attendancePct(ctx.s, r.s.id, sel.id); return a === null ? 'n/a' : `${a}%`; } }, { key: 'r', label: 'Engagement', render: (r) => pill(riskLabel[risk.get(r.s.id) || 'none'], riskTone[risk.get(r.s.id) || 'none']) }], roster, { sortKey: C.k || 'p', sortDir: C.d || 'asc', sortAct: 'rsort', page: C.page || 1, pageSize: 12, pageAct: 'rpage' })}</section>` : ''}
      </div><div class="stack">
        <section class="panel"><div class="panel-head"><h2>Upcoming classes</h2><a class="more" href="#/live">Schedule</a></div>${upcoming.slice(0, 6).map((x) => `<div class="item" style="display:flex;gap:10px;padding:8px 0;border-top:1px solid var(--line)"><div class="date-chip"><b>${new Date(x.start).getDate()}</b><span>${new Date(x.start).toLocaleDateString('en-GB', { month: 'short' })}</span></div><span class="grow min0 small"><b>${esc(x.title)}</b><br><span class="muted">${fmtDateTime(x.start)} · ${x.registered.length} registered</span></span></div>`).join('') || '<p class="small muted">Nothing scheduled.</p>'}</section>
        <section class="panel"><div class="panel-head"><h2>Quality indicators</h2></div><dl class="dl small"><dt>Avg course rating</dt><dd>${courses.length ? `★ ${avg(courses, (c) => c.feedback.rating).toFixed(1)}` : 'n/a'}</dd><dt>Assessment pass rate</dt><dd>${(() => { const at = ctx.s.attempts.filter((a) => a.status === 'graded' && ids.includes(ASSESSMENTS.find((x) => x.id === a.assessmentId)?.course)); return at.length ? `${Math.round((at.filter((a) => a.passed).length / at.length) * 100)}% of ${at.length}` : 'n/a'; })()}</dd><dt>Projects approved first time</dt><dd>${(() => { const ap = ctx.s.projects.filter((p) => ids.includes(p.courseId) && p.state === 'approved'); return ap.length ? `${Math.round((ap.filter((p) => !p.history.some((h) => h.to === 'revision')).length / ap.length) * 100)}%` : 'n/a'; })()}</dd><dt>Session feedback</dt><dd>${(() => { const fb = ctx.s.sessions.filter((x) => ids.includes(x.courseId)).flatMap((x) => x.feedback || []); return fb.length ? `${(fb.reduce((a, f) => a + f.rating, 0) / fb.length).toFixed(1)}/5 from ${fb.length}` : 'n/a'; })()}</dd></dl><p class="hint" style="margin-top:8px">Thresholds for alerts are configured by the academic director.</p></section>
      </div></div></div>`;
  },
  actions: {
    pickCourse(el, e, ctx) { ctx.local('tc').course = el.dataset.id; ctx.local('tc').page = 1; ctx.rerender(); },
    rsort(el, e, ctx) { const C = ctx.local('tc'); C.d = C.k === el.dataset.id && C.d === 'asc' ? 'desc' : 'asc'; C.k = el.dataset.id; ctx.rerender(); },
    rpage(el, e, ctx) { ctx.local('tc').page = Number(el.dataset.id); ctx.rerender(); },
    goGrading(el, e, ctx) { ctx.nav('/assessments'); },
    goReviews(el, e, ctx) { ctx.nav('/projects'); },
  },
};
