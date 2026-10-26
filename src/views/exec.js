// Executive intelligence, operational reports and the at-risk learner queue.
import { esc, fmtDate, fmtShort, inr, inrL, iso, round, toCSV, relDays, uid, avg } from '../core/util.js';
import { icon } from '../core/icons.js';
import { pageHead, pill, btn, empty, tabs, table, kpi, bar, select, lineChart, barChart, hbars, seg, avatar, timeline } from '../core/ui.js';
import { execMetrics, execSummary, moduleFunnel } from '../domain/analytics.js';
import { RULES, IV_LABEL, nextIvStates } from '../domain/risk.js';
import { visibleStudents, displayName } from '../domain/scope.js';
import { DOMAINS } from '../data/catalog.js';
import { ASSESSMENTS } from '../data/questions.js';
import { exportText, EXPORT_MSG } from '../services/exporter.js';
import { riskTone, riskLabel } from './shared.js';
import { ivDialog } from './community.js';
import { ask, providerStatus, errorCopy } from '../services/ai.js';
import { md } from './copilot.js';

const pctChange = (a, b) => (b ? ((a - b) / b) * 100 : null);
const dname = (id) => DOMAINS.find((d) => d.id === id)?.short || id;

export const exec = {
  perms: ['exec.view'],
  title: () => 'Executive Analytics',
  render(ctx) {
    const F = ctx.local('exec', { days: 90, domain: 'all', cohort: 'all', drill: null });
    const m = execMetrics(ctx.s, ctx.idx(), ctx.risk(), ctx.now, F);
    const sum = execSummary(m);
    const cohorts = ctx.s.cohorts.filter((c) => F.domain === 'all' || c.domain === F.domain);
    const AI = ctx.local('execAI', { text: '', busy: false, err: '' });
    const live = providerStatus(ctx.s.settings).live;
    const k = (label, value, cur, prev, foot, drill, alert) => kpi({ label, value, delta: pctChange(cur, prev), foot, act: drill ? 'drill' : null, a: drill ? { 'data-id': drill } : {}, alert });
    return `<div class="page">${pageHead({ title: 'Executive analytics', eyebrow: 'Sample data', lede: 'Every figure is computed from the institute\'s records in this demo dataset. None of it describes a real business.', actions: `${btn('Export summary CSV', { act: 'export', ic: 'download' })}` })}
      <div class="toolbar panel tight">${seg([[30, '30 days'], [90, '90 days'], [180, '180 days'], [365, '12 months']], Number(F.days), 'days', 'Time range')}
        ${select({ id: 'ex-d', label: 'Domain', value: F.domain, options: [['all', 'All domains'], ...DOMAINS.map((d) => [d.id, d.short])], a: { 'data-change': 'f', 'data-key': 'domain' } })}
        ${select({ id: 'ex-c', label: 'Cohort', value: F.cohort, options: [['all', 'All cohorts'], ...cohorts.map((c) => [c.id, c.name])], a: { 'data-change': 'f', 'data-key': 'cohort' } })}
        <span class="ml-auto small muted">${fmtDate(m.window.from)} to ${fmtDate(m.window.to)} · compared with the previous ${m.window.days} days</span></div>
      <div class="kpis">
        ${k('Active learners', m.active, m.active, m.activePrev, `of ${m.learners} · active in last 14 days`, 'learners')}
        ${k('New enrollments', m.newEnr, m.newEnr, m.prevEnr, 'course enrollments in window', 'enrollments')}
        ${k('Course completion', `${m.completion}%`, m.completion, m.completionPrev, 'enrollments older than 60 days', 'completion')}
        ${k('Engagement', `${m.engagement}m`, m.engagement, m.engagementPrev, 'minutes per learner per week', 'engagement')}
        ${k('Collected', inrL(m.collected), m.collected, m.collectedPrev, `refunds ${inrL(m.refunds)}`, 'revenue')}
        ${kpi({ label: 'At risk', value: `${m.riskDist.high + m.riskDist.medium}`, foot: `${m.riskDist.high} high · ${m.riskDist.medium} medium`, act: 'drill', a: { 'data-id': 'risk' }, alert: m.riskDist.high > 0 })}
      </div>
      <section class="panel" aria-labelledby="h-sum"><div class="panel-head"><h2 id="h-sum">What changed and what needs attention</h2>${live ? btn(AI.busy ? 'Writing…' : 'Ask AI for a narrative', { act: 'aiSummary', sm: true, ic: 'sparkle', disabled: AI.busy }) : `<span class="xs muted" title="Connect an AI provider for narrative summaries">Rule-based summary · AI not connected</span>`}</div>
        <ul class="summary">${sum.map((x) => `<li class="${x.tone}">${icon(x.tone === 'ok' ? 'check' : 'alert')}<span>${esc(x.text)}</span></li>`).join('') || '<li>No notable changes.</li>'}</ul>
        ${AI.text ? `<div class="ai-note"><div class="eyebrow">AI narrative (from the figures above)</div>${md(AI.text)}</div>` : ''}${AI.err ? `<p class="error-text">${esc(AI.err)}</p>` : ''}</section>
      <div class="grid g2">
        <section class="panel"><div class="panel-head"><h2>Weekly active learners</h2><span class="sub">learners with any activity</span></div>${lineChart({ series: [{ values: m.weekly.map((w) => w.active) }], labels: m.weekly.map((w) => fmtShort(w.week)), title: 'Weekly active learners', every: Math.ceil(m.weekly.length / 6) })}</section>
        <section class="panel"><div class="panel-head"><h2>Enrollments by month</h2><span class="sub">last 12 months</span></div>${barChart({ values: m.monthlyEnrollments.map((x) => x.n), labels: m.monthlyEnrollments.map((x) => x.label), title: 'Enrollments by month', hl: 11 })}</section>
      </div>
      <div class="grid g3">
        <section class="panel"><div class="panel-head"><h2>Cohort retention</h2><button type="button" class="link" data-act="drill" data-id="retention">Details</button></div>${hbars(m.retention.slice().sort((a, b) => a.pct - b.pct).slice(0, 8).map((r) => ({ label: r.name.split(' · ')[0] + (r.name.split(' · ')[1] ? ` · ${r.name.split(' · ')[1]}` : ''), value: round(r.pct), max: 100, display: `${Math.round(r.pct)}%`, color: r.pct < 75 ? 'var(--warn)' : 'var(--s1)' })))}</section>
        <section class="panel"><div class="panel-head"><h2>Risk distribution</h2><a class="more" href="#/ops/risk">Queue</a></div>${hbars([{ label: 'High', value: m.riskDist.high, color: 'var(--bad)' }, { label: 'Medium', value: m.riskDist.medium, color: 'var(--warn)' }, { label: 'Low', value: m.riskDist.low, color: 'var(--info)' }, { label: 'On track', value: m.riskDist.none, color: 'var(--ok)' }])}<p class="hint" style="margin-top:8px">Explainable rules; thresholds in System Settings.</p></section>
        <section class="panel"><div class="panel-head"><h2>Placement pipeline</h2><button type="button" class="link" data-act="drill" data-id="placement">Details</button></div>${hbars(m.pipeline.filter((p) => p.stage !== 'rejected').map((p) => ({ label: p.stage[0].toUpperCase() + p.stage.slice(1), value: p.reached, display: `${p.reached}` })))}<p class="hint" style="margin-top:8px">Applications reaching each stage. Sample employers.</p></section>
      </div>
      <div class="grid g2">
        <section class="panel flush"><div class="panel-head" style="padding:18px 20px 0"><h2>Course popularity</h2><button type="button" class="link" data-act="drill" data-id="courses">All courses</button></div>${table([{ key: 'c', label: 'Course', render: (c) => `<b>${c.id}</b> <span class="small">${esc(c.title)}</span>` }, { key: 'e', label: 'Enrolled', r: true, render: (c) => `${c.enrollments}<div class="sub">+${c.recent} in window</div>` }, { key: 'p', label: 'Avg progress', r: true, render: (c) => `${c.avgProgress}%` }, { key: 'r', label: 'Rating', r: true, render: (c) => `★ ${c.rating}` }], m.popularity.slice(0, 7))}</section>
        <section class="panel"><div class="panel-head"><h2>Instructor utilisation</h2><button type="button" class="link" data-act="drill" data-id="instructors">Details</button></div>${hbars(m.instructors.slice().sort((a, b) => b.pct - a.pct).slice(0, 8).map((i) => ({ label: i.name, value: i.pct, max: 100, display: `${Math.round(i.pct)}%`, color: i.pct > 85 ? 'var(--bad)' : i.pct > 65 ? 'var(--warn)' : 'var(--s1)' })))}<p class="hint" style="margin-top:8px">Teaching hours ×2.5 for preparation plus 45 minutes per pending review, against weekly capacity, over the window plus the next 14 days.</p></section>
      </div>
      <div class="grid g2">
        <section class="panel"><div class="panel-head"><h2>Domain comparison</h2></div>${table([{ key: 'd', label: 'Domain', render: (d) => `<b>${esc(dname(d.domain))}</b>` }, { key: 'l', label: 'Learners', r: true, render: (d) => `${d.active}/${d.learners}<div class="sub">active</div>` }, { key: 'p', label: 'Avg progress', r: true, render: (d) => `${d.avgProgress}%` }, { key: 'r', label: 'Fees collected', r: true, render: (d) => inrL(d.revenue) }], m.byDomain.sort((a, b) => b.revenue - a.revenue))}</section>
        <section class="panel"><div class="panel-head"><h2>Revenue</h2><button type="button" class="link" data-act="drill" data-id="revenue">Details</button></div>${barChart({ values: m.collections.map((x) => round(x.net / 1e5, 1)), labels: m.collections.map((x) => x.label), title: 'Net fee collections by month, lakh rupees', hl: 11, yFmt: (v) => `${v}` })}<dl class="dl small" style="margin-top:8px"><dt>Outstanding</dt><dd>${inr(m.outstanding)}</dd><dt>Overdue</dt><dd>${inr(m.overdue)}</dd><dt>Program profitability</dt><dd class="muted">Needs cost data (faculty cost, infrastructure). Connect the finance system to enable it.</dd></dl></section>
      </div>
      <div class="grid g2">
        <section class="panel flush"><div class="panel-head" style="padding:18px 20px 0"><h2>Assessment performance</h2><span class="sub">Lowest pass rate first</span></div>${table([{ key: 'a', label: 'Assessment', render: (a) => esc(ASSESSMENTS.find((x) => x.id === a.id)?.title || a.id) }, { key: 'n', label: 'Attempts', r: true, render: (a) => a.attempts }, { key: 'v', label: 'Average', r: true, render: (a) => `${a.avg}%` }, { key: 'p', label: 'Pass rate', r: true, render: (a) => pill(`${a.passRate}%`, a.passRate < 60 ? 'p-bad' : a.passRate < 80 ? 'p-warn' : 'p-ok', true) }], m.assessmentPerf.slice(0, 8), { empty: 'No graded attempts in this window.' })}</section>
        <section class="panel flush"><div class="panel-head" style="padding:18px 20px 0"><h2>Corporate clients</h2><a class="more" href="#/admin/orgs">Organizations</a></div>${table([{ key: 'n', label: 'Client', render: (o) => `<b>${esc(o.name)}</b><div class="sub">sample organisation</div>` }, { key: 's', label: 'Seats', r: true, render: (o) => `${o.used}/${o.seats}` }, { key: 'a', label: 'Active', r: true, render: (o) => o.active }, { key: 'p', label: 'Avg progress', r: true, render: (o) => `${o.avgProgress}%` }, { key: 'm', label: 'Mandatory done', r: true, render: (o) => `${o.mandatoryDone}/${o.mandatoryTotal}` }], m.corporate)}</section>
      </div></div>`;
  },
  actions: {
    days(el, e, ctx) { ctx.local('exec').days = Number(el.dataset.id); ctx.local('execAI').text = ''; ctx.rerender(); },
    f(el, e, ctx) { const F = ctx.local('exec'); F[el.dataset.key] = el.value; if (el.dataset.key === 'domain') F.cohort = 'all'; ctx.local('execAI').text = ''; ctx.rerender(); },
    drill(el, e, ctx) { drill(ctx, el.dataset.id); },
    async export(el, e, ctx) {
      const F = ctx.local('exec');
      const m = execMetrics(ctx.s, ctx.idx(), ctx.risk(), ctx.now, F);
      const rows = [['Active learners', m.active, m.activePrev], ['New enrollments', m.newEnr, m.prevEnr], ['Completion %', m.completion, m.completionPrev], ['Engagement min/learner/week', m.engagement, m.engagementPrev], ['Collected INR', m.collected, m.collectedPrev], ['Refunds INR', m.refunds, ''], ['Outstanding INR', m.outstanding, ''], ['High risk', m.riskDist.high, ''], ['Medium risk', m.riskDist.medium, '']];
      const r = await exportText(`avgenx-exec-${m.window.to}-${F.days}d.csv`, toCSV(rows, [{ label: 'Metric', value: (x) => x[0] }, { label: `Current ${F.days}d`, value: (x) => x[1] }, { label: 'Previous period', value: (x) => x[2] }]) + `\n\nSample data generated for the AVGENX prototype; not real business figures.`);
      ctx.commit('export', () => {}, { silent: true, audit: { action: 'export.csv', entity: 'report', entityId: 'executive-summary', kind: 'data' } });
      ctx.toast(EXPORT_MSG[r]);
    },
    async aiSummary(el, e, ctx) {
      const F = ctx.local('exec'); const A = ctx.local('execAI');
      const m = execMetrics(ctx.s, ctx.idx(), ctx.risk(), ctx.now, F);
      A.busy = true; A.err = ''; A.text = ''; ctx.rerender();
      const facts = JSON.stringify({ window: m.window, active: [m.active, m.activePrev], enrollments: [m.newEnr, m.prevEnr], completion: [m.completion, m.completionPrev], engagement: [m.engagement, m.engagementPrev], collected: [m.collected, m.collectedPrev], outstanding: m.outstanding, overdue: m.overdue, risk: m.riskDist, lowRetention: m.retention.filter((r) => r.pct < 80).map((r) => [r.name, Math.round(r.pct)]), weakestAssessments: m.assessmentPerf.slice(0, 3), busiestInstructors: m.instructors.sort((a, b) => b.pct - a.pct).slice(0, 3).map((i) => [i.name, i.pct]) });
      try {
        const r = await ask({ turns: [{ role: 'user', content: `Write a 120-word executive briefing for the CEO of a coding institute from these computed metrics (current vs previous period). Lead with the single most important change, then two risks with one concrete action each. Use only these numbers; do not invent any. This is demo sample data.\n\n${facts}` }], context: 'Executive analytics page', settings: ctx.s.settings, mode: 'quick', onText: ({ text }) => { A.text = text; const n = document.querySelector('.ai-note'); if (n) n.innerHTML = `<div class="eyebrow">AI narrative (from the figures above)</div>${md(text)}`; else ctx.rerender(); } });
        A.text = r.text;
      } catch (err) { A.err = errorCopy(err); } finally { A.busy = false; ctx.rerender(); }
    },
  },
};

function drill(ctx, kind) {
  const F = ctx.local('exec');
  const m = execMetrics(ctx.s, ctx.idx(), ctx.risk(), ctx.now, F);
  const map = {
    learners: () => ({ title: 'Active learners by cohort', body: table([{ key: 'n', label: 'Cohort', render: (r) => esc(r.name) }, { key: 's', label: 'Learners', r: true, render: (r) => r.size }, { key: 'a', label: 'Active (21d)', r: true, render: (r) => r.retained }], m.retention) }),
    retention: () => ({ title: 'Cohort retention', body: `${table([{ key: 'n', label: 'Cohort', render: (r) => esc(r.name) }, { key: 's', label: 'Size', r: true, render: (r) => `${r.size}/${r.capacity}` }, { key: 'r', label: 'Retained', r: true, render: (r) => r.retained }, { key: 'p', label: 'Rate', r: true, render: (r) => pill(`${Math.round(r.pct)}%`, r.pct < 75 ? 'p-bad' : 'p-ok', true) }], m.retention.slice().sort((a, b) => a.pct - b.pct))}<p class="hint">Retained = not withdrawn or paused, and active in the last 21 days.</p>` }),
    enrollments: () => ({ title: 'Enrollments by course', body: table([{ key: 'c', label: 'Course', render: (c) => `${c.id} ${esc(c.title)}` }, { key: 'r', label: 'In window', r: true, render: (c) => c.recent }, { key: 'e', label: 'All time', r: true, render: (c) => c.enrollments }], m.popularity.slice().sort((a, b) => b.recent - a.recent)) }),
    completion: () => ({ title: 'Completion by course', body: table([{ key: 'c', label: 'Course', render: (c) => c.id }, { key: 'p', label: 'Avg progress', r: true, render: (c) => `${c.avgProgress}%` }, { key: 'f', label: 'Weakest module', render: (c) => { const f = moduleFunnel(ctx.s, ctx.s.courses.find((x) => x.id === c.id)); const w = f.slice().sort((a, b) => a.pct - b.pct)[0]; return w ? `${esc(w.title)} (${w.pct}%)` : ''; } }], m.popularity) }),
    engagement: () => ({ title: 'Weekly learning minutes', body: lineChart({ series: [{ values: m.weekly.map((w) => w.mins) }], labels: m.weekly.map((w) => fmtShort(w.week)), title: 'Total weekly minutes', every: 3 }) }),
    revenue: () => ({ title: 'Collections by month', body: table([{ key: 'm', label: 'Month', render: (x) => x.key }, { key: 'c', label: 'Collected', r: true, render: (x) => inr(x.collected) }, { key: 'r', label: 'Refunds', r: true, render: (x) => inr(x.refunds) }, { key: 'n', label: 'Net', r: true, render: (x) => inr(x.net) }], m.collections) }),
    risk: () => ({ title: 'At-risk learners', body: table([{ key: 's', label: 'Learner', render: (r) => esc(displayName(ctx.s, r.studentId)) }, { key: 'l', label: 'Level', render: (r) => pill(riskLabel[r.level], riskTone[r.level]) }, { key: 'f', label: 'Why', render: (r) => r.flags.map((f) => esc(RULES[f.rule].label)).join(', ') }], ctx.risk().filter((r) => ['high', 'medium'].includes(r.level)).sort((a, b) => b.score - a.score), { rowAct: 'drillStudent', rowId: (r) => r.studentId }) }),
    placement: () => ({ title: 'Placement pipeline', body: table([{ key: 's', label: 'Stage', render: (p) => p.stage }, { key: 'n', label: 'Now at stage', r: true, render: (p) => p.n }, { key: 'r', label: 'Reached', r: true, render: (p) => p.reached }], m.pipeline) }),
    courses: () => ({ title: 'All courses', body: table([{ key: 'c', label: 'Course', render: (c) => `${c.id} ${esc(c.title)}` }, { key: 'e', label: 'Enrolled', r: true, render: (c) => c.enrollments }, { key: 'p', label: 'Progress', r: true, render: (c) => `${c.avgProgress}%` }, { key: 'r', label: 'Rating', r: true, render: (c) => c.rating }], m.popularity) }),
    instructors: () => ({ title: 'Instructor utilisation', body: table([{ key: 'n', label: 'Instructor', render: (i) => esc(i.name) }, { key: 't', label: 'Teaching h', r: true, render: (i) => i.teach }, { key: 'v', label: 'Reviews', r: true, render: (i) => i.reviews }, { key: 'h', label: 'Load h', r: true, render: (i) => `${i.hours}/${i.capacity}` }, { key: 'p', label: '%', r: true, render: (i) => `${Math.round(i.pct)}%` }], m.instructors.slice().sort((a, b) => b.pct - a.pct)) }),
  };
  const p = (map[kind] || map.learners)();
  ctx.openPanel(() => ({ ...p, wide: true, sub: `${fmtDate(m.window.from)} to ${fmtDate(m.window.to)} · sample data` }));
}
exec.actions.drillStudent = (el, e, ctx) => { document.querySelector('#drawer [data-close]')?.click(); ctx.nav(`/ops/students/${el.dataset.id}`); };

// =================================================================== REPORTS
export const reports = {
  perms: ['reports.view'],
  title: () => 'Reports',
  render(ctx) {
    const scope = visibleStudents(ctx.s, ctx.me);
    const ids = new Set(scope.map((s) => s.id));
    const courses = ctx.s.courses.filter((c) => c.status === 'published');
    const funnels = courses.map((c) => { const f = moduleFunnel(ctx.s, c); const enrolled = ctx.s.enrollments.filter((e) => e.courseId === c.id && ids.has(e.studentId)).length; const worst = f.slice(1).sort((a, b) => a.pct - b.pct)[0]; return { c, enrolled, worst, drop: f.length > 1 ? Math.max(0, f[0].pct - f[f.length - 1].pct) : 0 }; }).filter((x) => x.enrolled >= 3).sort((a, b) => b.drop - a.drop);
    const overloaded = ctx.s.cohorts.map((c) => { const m = ctx.s.students.filter((s) => s.cohortId === c.id && s.status === 'active'); const mentorOver = c.mentorIds.filter((id) => ctx.s.students.filter((s) => s.mentorId === id && s.status === 'active').length > (ctx.s.users.find((u) => u.id === id)?.capacity || 14)); return { c, size: m.length, over: m.length > c.capacity, mentorOver }; }).filter((x) => x.over || x.mentorOver.length);
    const byRule = Object.keys(RULES).map((k) => ({ label: RULES[k].label, value: ctx.risk().filter((r) => ids.has(r.studentId) && r.flags.some((f) => f.rule === k)).length }));
    const failRepeat = ctx.risk().filter((r) => ids.has(r.studentId) && r.flags.some((f) => f.rule === 'failedAttempts')).length;
    return `<div class="page">${pageHead({ title: 'Operational reports', lede: 'Where learners stall, which cohorts are overloaded and which rules are firing. Scoped to the learners you can see.' })}
      <div class="grid g2"><section class="panel"><div class="panel-head"><h2>Risk signals by rule</h2><a class="more" href="#/ops/risk">Queue</a></div>${hbars(byRule)}<p class="hint" style="margin-top:8px">${failRepeat} learners have repeated assessment failures with no pass.</p></section>
      <section class="panel"><div class="panel-head"><h2>Overloaded cohorts and mentors</h2></div>${overloaded.length ? `<div class="list">${overloaded.map((x) => `<div class="item"><span class="grow small"><b>${esc(x.c.name)}</b><br><span class="s">${x.over ? `${x.size} learners over capacity ${x.c.capacity}. ` : ''}${x.mentorOver.length ? `Mentor over capacity: ${x.mentorOver.map((id) => esc(displayName(ctx.s, id))).join(', ')}` : ''}</span></span>${btn('Cohort', { href: '/ops/cohorts', sm: true })}</div>`).join('')}</div>` : '<p class="small muted">No cohort or mentor is over capacity.</p>'}</section></div>
      <section class="panel flush"><div class="panel-head" style="padding:18px 20px 0"><h2>Underperforming modules</h2><span class="sub">Biggest drop from first to last module completion</span></div>${table([{ key: 'c', label: 'Course', render: (x) => `<b>${x.c.id}</b> ${esc(x.c.title)}` }, { key: 'e', label: 'Enrolled', r: true, render: (x) => x.enrolled }, { key: 'w', label: 'Weakest module', render: (x) => (x.worst ? `${esc(x.worst.title)} <span class="sub">${x.worst.pct}% complete</span>` : '') }, { key: 'd', label: 'Drop-off', r: true, render: (x) => pill(`${Math.round(x.drop)} pts`, x.drop > 40 ? 'p-bad' : x.drop > 20 ? 'p-warn' : 'p-mute', true) }], funnels.slice(0, 12))}</section></div>`;
  },
};

// =================================================================== AT-RISK QUEUE
export const risk = {
  perms: ['reports.view'],
  title: () => 'At-risk Learners',
  render(ctx) {
    const F = ctx.local('risk', { level: 'actionable', rule: 'all', cohort: 'all' });
    const scope = new Map(visibleStudents(ctx.s, ctx.me).map((s) => [s.id, s]));
    let rows = ctx.risk().filter((r) => scope.has(r.studentId));
    const cohorts = [...new Set(rows.map((r) => scope.get(r.studentId).cohortId))].map((id) => ctx.s.cohorts.find((c) => c.id === id));
    if (F.level === 'actionable') rows = rows.filter((r) => ['high', 'medium'].includes(r.level)); else if (F.level !== 'all') rows = rows.filter((r) => r.level === F.level);
    if (F.rule !== 'all') rows = rows.filter((r) => r.flags.some((f) => f.rule === F.rule));
    if (F.cohort !== 'all') rows = rows.filter((r) => scope.get(r.studentId).cohortId === F.cohort);
    rows.sort((a, b) => b.score - a.score);
    const ivs = ctx.s.interventions.filter((iv) => scope.has(iv.studentId));
    const ivFor = (sid) => ivs.find((iv) => iv.studentId === sid && iv.state !== 'resolved');
    return `<div class="page">${pageHead({ title: 'At-risk learners', lede: 'Explainable rules flag learners; staff decide what to do. Every intervention records its reason and outcome.', actions: ctx.can('settings.manage') ? btn('Tune rules', { href: '/admin/settings', ic: 'gear' }) : '' })}
      <div class="kpis">${kpi({ label: 'High risk', value: ctx.risk().filter((r) => scope.has(r.studentId) && r.level === 'high').length, alert: true })}${kpi({ label: 'Medium risk', value: ctx.risk().filter((r) => scope.has(r.studentId) && r.level === 'medium').length })}${kpi({ label: 'Open interventions', value: ivs.filter((iv) => !['resolved'].includes(iv.state)).length })}${kpi({ label: 'Resolved', value: ivs.filter((iv) => iv.state === 'resolved').length })}</div>
      <div class="toolbar">${select({ id: 'rk-l', label: 'Level', value: F.level, options: [['actionable', 'High and medium'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low'], ['all', 'Everyone']], a: { 'data-change': 'f', 'data-key': 'level' } })}${select({ id: 'rk-r', label: 'Rule', value: F.rule, options: [['all', 'Any rule'], ...Object.entries(RULES).map(([k, v]) => [k, v.label])], a: { 'data-change': 'f', 'data-key': 'rule' } })}${select({ id: 'rk-c', label: 'Cohort', value: F.cohort, options: [['all', 'All'], ...cohorts.map((c) => [c.id, c.name])], a: { 'data-change': 'f', 'data-key': 'cohort' } })}</div>
      <div class="stack" style="--gap:10px">${rows.slice(0, 40).map((r) => { const st = scope.get(r.studentId); const iv = ivFor(st.id); return `<article class="panel risk-card ${r.level}"><div class="spread"><div class="row nowrap">${avatar(st.name, 'sm')}<div class="min0"><a href="#/ops/students/${st.id}" style="font-weight:700;text-decoration:none">${esc(st.name)}</a><div class="xs muted">${esc(ctx.s.cohorts.find((c) => c.id === st.cohortId)?.name || '')} · mentor ${esc(displayName(ctx.s, st.mentorId))}</div></div></div><div class="row">${pill(riskLabel[r.level], riskTone[r.level])}<span class="mono xs muted">score ${r.score}</span></div></div>
        <ul class="evidence">${r.flags.map((f) => `<li><b>${esc(RULES[f.rule].label)}.</b> ${esc(f.evidence)} <span class="muted">Recommended: ${esc(RULES[f.rule].action)}</span></li>`).join('')}</ul>
        <div class="row">${iv ? `${pill(`Intervention: ${IV_LABEL[iv.state]}`, 'p-info')}${ctx.can('risk.intervene') ? nextIvStates(iv.state).map((to) => btn(IV_LABEL[to], { act: 'ivMove', sm: true, cls: to === 'escalated' ? 'btn-danger' : 'btn-ghost', attrs: { 'data-id': iv.id, 'data-to': to } })).join('') : ''}` : ctx.can('risk.intervene') ? btn('Start intervention', { act: 'start', sm: true, cls: 'btn-primary', attrs: { 'data-id': st.id } }) : '<span class="xs muted">Interventions are run by mentors and program staff.</span>'}${btn('Dashboard', { href: `/dashboard?student=${st.id}`, sm: true, cls: 'btn-quiet' })}</div></article>`; }).join('') || empty('Nobody matches', 'No learner meets these rule filters right now.', { ic: 'check' })}</div>
      ${ivs.filter((iv) => iv.state === 'resolved').length ? `<section class="panel"><h2>Resolved interventions</h2><div class="list" style="margin-top:8px">${ivs.filter((iv) => iv.state === 'resolved').map((iv) => `<div class="item"><span class="grow small"><b>${esc(displayName(ctx.s, iv.studentId))}</b>: ${esc(iv.outcome)}</span></div>`).join('')}</div></section>` : ''}
      <p class="hint">A predictive model can be added through the risk-model integration as an extra signal. High-impact academic decisions stay with staff.</p></div>`;
  },
  actions: {
    f(el, e, ctx) { ctx.local('risk')[el.dataset.key] = el.value; ctx.rerender(); },
    ivMove(el, e, ctx) { ivDialog(ctx, el.dataset.id, el.dataset.to); },
    start(el, e, ctx) {
      const r = ctx.risk().find((x) => x.studentId === el.dataset.id);
      const st = ctx.s.students.find((s) => s.id === el.dataset.id);
      ctx.commit('iv.create', (s) => { s.interventions.push({ id: uid('IV'), studentId: st.id, state: 'notified', ruleIds: r.flags.map((f) => f.rule), createdAt: new Date().toISOString(), ownerId: st.mentorId, plan: '', outcome: '', history: [{ at: new Date().toISOString(), by: ctx.me.id, state: 'flagged', note: r.flags.map((f) => f.evidence).join(' ') }, { at: new Date().toISOString(), by: 'system', state: 'notified', note: `Mentor ${displayName(s, st.mentorId)} notified` }] }); ctx.notify(st.mentorId, 'mentor', 'Intervention started', `${st.name}: ${r.flags.map((f) => RULES[f.rule].label).join(', ')}`, '/mentors'); }, { ok: 'Intervention started; mentor notified', audit: { action: 'intervention.create', entity: 'student', entityId: st.id, detail: r.flags.map((f) => f.rule).join(', ') } });
    },
  },
};
