// Student intelligence dashboard. Students see their own; staff pick any learner in scope.
import { esc, fmtMins, fmtShort, fmtDateTime, relDays, iso, pct } from '../core/util.js';
import { icon } from '../core/icons.js';
import { pageHead, kpi, bar, ring, pill, table, lineChart, barChart, hbars, heatmap, empty, btn, select, avatar, domainVar, swatch, check } from '../core/ui.js';
import { studentSummary, nextBest, riskTone, riskLabel, dailySeries, weeklySeries, velocity } from './shared.js';
import { visibleStudents } from '../domain/scope.js';
import { RULES } from '../domain/risk.js';
import { STATE_LABEL, STATE_PILL } from '../domain/projects.js';
import { DOMAINS } from '../data/catalog.js';
import { displayName } from '../domain/scope.js';
import { badges } from '../domain/motivation.js';

const WIDGETS = [['next', 'Recommended next activity'], ['roadmap', 'Personalised roadmap'], ['mastery', 'Skill mastery by domain'], ['courses', 'Courses and assessments'], ['schedule', 'Upcoming classes and deadlines'], ['reviews', 'Pending reviews and mentor help'], ['practice', 'Coding practice activity'], ['velocity', 'Learning velocity and consistency'], ['readiness', 'Placement readiness'], ['risk', 'Learning health'], ['xp', 'XP and badges']];

function pickStudent(ctx) {
  if (ctx.me.role === 'student') return ctx.me.id;
  const list = visibleStudents(ctx.s, ctx.me);
  const L = ctx.local('dash', { sid: null, cohort: 'all', status: 'all' });
  if (ctx.query.student && list.some((s) => s.id === ctx.query.student)) L.sid = ctx.query.student;
  if (!L.sid || !list.some((s) => s.id === L.sid)) L.sid = list[0]?.id || null;
  return L.sid;
}

export default {
  perms: ['learn.self', 'dashboard.any'],
  title: (ctx) => (ctx.me.role === 'student' ? 'My Dashboard' : 'Learner dashboard'),
  render(ctx) {
    const s = ctx.s;
    const F = ctx.local('dashF', { range: 8, domain: 'all', course: 'all', status: 'all' });
    const sid = pickStudent(ctx);
    const staffPicker = ctx.me.role !== 'student' ? learnerPicker(ctx) : '';
    if (!sid) return `<div class="page">${pageHead({ title: 'Learner dashboard' })}${staffPicker}${empty('No learners in your scope', 'Mentors see their assigned learners; instructors see learners in their courses.')}</div>`;
    const sum = studentSummary(ctx, sid);
    const prefs = s.prefs[ctx.me.id] || {};
    const hidden = new Set(prefs.hiddenWidgets || []);
    const show = (w) => !hidden.has(w);
    const nb = nextBest(ctx, sum);
    const self = ctx.me.role === 'student';
    const greet = self ? `${ctx.now.getHours() < 12 ? 'Good morning' : ctx.now.getHours() < 17 ? 'Good afternoon' : 'Good evening'}, ${esc(sum.st.name.split(' ')[0])}` : sum.st.name;
    const goal = sum.st.weeklyGoalMins;
    const enrF = sum.enr.filter((x) => (F.domain === 'all' || x.c.domain === F.domain) && (F.course === 'all' || x.c.id === F.course) && (F.status === 'all' || (F.status === 'done' ? x.p.pct === 100 : x.p.pct < 100)));
    const domainsHere = [...new Set(sum.enr.map((x) => x.c.domain))];

    const filters = `<div class="toolbar panel tight" role="search" aria-label="Dashboard filters">
      ${select({ id: 'df-range', label: 'Date range', value: F.range, options: [[4, 'Last 4 weeks'], [8, 'Last 8 weeks'], [12, 'Last 12 weeks'], [26, 'Last 26 weeks']], a: { 'data-change': 'filter', 'data-key': 'range' } })}
      ${select({ id: 'df-domain', label: 'Domain', value: F.domain, options: [['all', 'All domains'], ...domainsHere.map((d) => [d, DOMAINS.find((x) => x.id === d).short])], a: { 'data-change': 'filter', 'data-key': 'domain' } })}
      ${select({ id: 'df-course', label: 'Course', value: F.course, options: [['all', 'All courses'], ...sum.enr.map((x) => [x.c.id, `${x.c.id} · ${x.c.title}`])], a: { 'data-change': 'filter', 'data-key': 'course' } })}
      ${select({ id: 'df-status', label: 'Learning status', value: F.status, options: [['all', 'All'], ['active', 'In progress'], ['done', 'Completed']], a: { 'data-change': 'filter', 'data-key': 'status' } })}
      <div class="ml-auto row">${btn('Customise widgets', { act: 'customise', ic: 'grid', sm: true })}</div>
    </div>`;

    const kpis = `<div class="kpis">
      ${kpi({ label: 'Learning streak', value: `${sum.streak} day${sum.streak === 1 ? '' : 's'}`, foot: sum.streak ? 'Keep it going today' : 'Start a new streak today' })}
      ${kpi({ label: 'This week', value: fmtMins(sum.weekMins), foot: `${Math.min(100, Math.round((sum.weekMins / goal) * 100))}% of ${fmtMins(goal)} goal ${bar((sum.weekMins / goal) * 100, sum.weekMins >= goal ? '' : 'pencil', 'Weekly goal progress')}` })}
      ${kpi({ label: 'Courses', value: `${sum.enr.filter((x) => x.p.pct === 100).length}/${sum.enr.length}`, foot: 'completed / enrolled' })}
      ${kpi({ label: 'Problems solved', value: sum.solved.length, foot: `${sum.subs.length} submissions, ${sum.subs.length ? Math.round((sum.subs.filter((x) => x.status === 'Accepted').length / sum.subs.length) * 100) : 0}% accepted` })}
      ${kpi({ label: 'Placement readiness', value: `${sum.ready.score}`, foot: `${sum.ready.level} · out of 100` })}
      ${ctx.flag('gamification') ? kpi({ label: 'XP', value: sum.ledger.total.toLocaleString('en-IN'), foot: `Level ${sum.ledger.level} · ${sum.ledger.nextAt - sum.ledger.total} XP to next` }) : ''}
    </div>`;

    const next = show('next') ? `<section class="panel next-card" aria-labelledby="h-next"><div class="row nowrap" style="--gap:16px"><span class="next-ic">${icon(nb.ic)}</span><div class="grow"><div class="eyebrow" id="h-next">Recommended next</div><h2 style="margin-top:2px">${esc(nb.title)}</h2><p class="muted small" style="margin-top:4px">${esc(nb.why)}</p></div>${btn(self ? 'Start' : 'Open', { href: nb.href, cls: 'btn-primary', ic: 'arrow' })}</div></section>` : '';

    const path = sum.cohort?.path || [];
    const roadmap = show('roadmap') ? `<section class="panel" aria-labelledby="h-road"><div class="panel-head"><h2 id="h-road">Personalised roadmap</h2><span class="sub">${esc(sum.cohort?.name || '')}</span></div>
      <ol class="roadmap">${path.map((cid, i) => { const c = s.courses.find((x) => x.id === cid); const e = sum.enr.find((x) => x.c.id === cid); const st = !e ? 'locked' : e.p.pct === 100 ? 'done' : 'now'; return `<li class="${st}" style="${domainVar(c.domain)}"><span class="rm-dot">${st === 'done' ? icon('check') : st === 'locked' ? icon('lock') : i + 1}</span><a href="#/course/${c.id}" class="rm-body"><span class="mono small">${c.id} · ${c.level}</span><b>${esc(c.title)}</b><span class="small muted">${e ? `${e.p.done}/${e.p.total} lessons${e.p.next && st === 'now' ? ` · next: ${esc(e.p.next.title)}` : ''}` : c.status !== 'published' ? 'Not yet published' : `Unlocks in sequence${c.prereqs.length ? ` · needs ${c.prereqs.join(', ')}` : ''}`}</span>${e ? bar(e.p.pct) : ''}</a></li>`; }).join('')}</ol></section>` : '';

    const mastery = show('mastery') ? `<section class="panel" aria-labelledby="h-mas"><div class="panel-head"><h2 id="h-mas">Skill mastery by domain</h2><span class="sub">0 to 100</span></div>${sum.mastery.length ? hbars(sum.mastery.filter((m) => F.domain === 'all' || m.domain.id === F.domain).map((m) => ({ label: m.domain.short, value: m.value, max: 100, color: `var(${m.domain.color})`, display: `${m.value}` }))) + `<p class="hint" style="margin-top:10px">Weighted: lessons 50%, best assessment scores 30%, problems solved 20% (programming and web only).</p>` : empty('No domains yet', 'Enroll in a course to start building mastery.')}</section>` : '';

    const courseRows = enrF.map((x) => { const a = s.attempts.filter((t) => t.studentId === sid && t.assessmentId === x.c.assessmentId && t.status === 'graded'); const best = a.length ? Math.max(...a.map((t) => t.pct)) : null; return { ...x, best, tries: a.length }; });
    const courses = show('courses') ? `<section class="panel flush" aria-labelledby="h-courses"><div class="panel-head" style="padding:18px 20px 0"><h2 id="h-courses">Courses and assessments</h2><a class="more" href="#/assessments">All assessments</a></div>${table([
      { key: 'c', label: 'Course', render: (r) => `<div class="row nowrap">${swatch(r.c)}<div class="min0"><a href="#/course/${r.c.id}" style="font-weight:600;text-decoration:none">${esc(r.c.title)}</a><div class="sub">${r.c.id} · ${r.c.level}</div></div></div>`, sort: (r) => r.c.id },
      { key: 'p', label: 'Progress', render: (r) => `<div style="min-width:120px">${bar(r.p.pct)}<span class="sub">${r.p.done}/${r.p.total} lessons · ${r.p.pct}%</span></div>`, sort: (r) => r.p.pct },
      { key: 'a', label: 'Best assessment', r: true, render: (r) => (r.c.assessmentId ? (r.best === null ? '<span class="muted">Not attempted</span>' : `${pill(`${r.best}%`, r.best >= 60 ? 'p-ok' : 'p-bad', true)}<div class="sub">${r.tries} attempt${r.tries === 1 ? '' : 's'}</div>`) : '<span class="muted">None</span>'), sort: (r) => r.best ?? -1 },
      { key: 'l', label: 'Last activity', render: (r) => (r.p.lastAt ? `${fmtShort(r.p.lastAt)}<div class="sub">${relDays(r.p.lastAt, ctx.now)}</div>` : '<span class="muted">Not started</span>'), sort: (r) => r.p.lastAt || '' },
    ], courseRows, { sortKey: ctx.local('dashT', { k: 'p', d: 'desc' }).k, sortDir: ctx.local('dashT').d, sortAct: 'sort', empty: 'No courses match these filters.' })}</section>` : '';

    const upcoming = [...sum.sessions.slice(0, 4).map((x) => ({ at: x.start, t: x.title, s: `${x.kind} · ${s.courses.find((c) => c.id === x.courseId)?.id} · ${x.mode === 'online' ? 'Online' : x.room}`, href: '/live', tag: pill(x.registered.includes(sid) ? 'Registered' : 'Not registered', x.registered.includes(sid) ? 'p-ok' : 'p-mute') })),
      ...sum.deadlines.filter((p) => F.course === 'all' || p.courseId === F.course).slice(0, 4).map((p) => ({ at: p.due, t: s.assignments.find((a) => a.id === p.assignmentId)?.title || p.assignmentId, s: `Project due · ${STATE_LABEL[p.state]}`, href: `/projects/${p.id}`, tag: pill(relDays(p.due, ctx.now), p.due < iso(ctx.now) ? 'p-bad' : 'p-warn') }))].sort((a, b) => (a.at < b.at ? -1 : 1));
    const schedule = show('schedule') ? `<section class="panel" aria-labelledby="h-sched"><div class="panel-head"><h2 id="h-sched">Upcoming classes and deadlines</h2><a class="more" href="#/live">Calendar</a></div>${upcoming.length ? `<div class="list">${upcoming.map((u) => `<a class="item" href="#${u.href}"><div class="date-chip"><b>${new Date(u.at).getDate()}</b><span>${new Date(u.at).toLocaleDateString('en-GB', { month: 'short' })}</span></div><div class="grow min0"><div class="t">${esc(u.t)}</div><div class="s">${esc(u.s)}${u.at.length > 10 ? ` · ${fmtDateTime(u.at)}` : ''}</div></div>${u.tag}</a>`).join('')}</div>` : empty('Nothing scheduled', 'New classes and deadlines appear here.', { ic: 'calendar' })}</section>` : '';

    const pendingReviews = sum.projects.filter((p) => ['submitted', 'under_review'].includes(p.state));
    const helps = s.mentorRequests.filter((r) => r.studentId === sid && ['open', 'scheduled'].includes(r.status));
    const reviews = show('reviews') ? `<section class="panel" aria-labelledby="h-rev"><div class="panel-head"><h2 id="h-rev">Pending reviews and mentor help</h2><a class="more" href="#/mentors">Mentors</a></div>${pendingReviews.length + helps.length ? `<div class="list">${pendingReviews.map((p) => `<a class="item" href="#/projects/${p.id}">${icon('folder')}<div class="grow min0"><div class="t">${esc(p.assignmentId.replace(/^AS-|^CAP-/, ''))} project</div><div class="s">Submitted ${fmtShort(p.submittedAt)} · reviewer ${esc(displayName(s, p.reviewerId))}</div></div>${pill(STATE_LABEL[p.state], STATE_PILL[p.state])}</a>`).join('')}${helps.map((r) => `<a class="item" href="#/mentors">${icon('users')}<div class="grow min0"><div class="t">${esc(r.topic)}</div><div class="s">${esc(displayName(s, r.mentorId))}${r.slot ? ` · ${fmtDateTime(r.slot)}` : ' · waiting for a slot'}</div></div>${pill(r.status === 'open' ? 'Waiting' : 'Scheduled', r.status === 'open' ? 'p-warn' : 'p-info')}</a>`).join('')}</div>` : empty('Nothing waiting', 'Submitted projects and mentor requests appear here.', { ic: 'check' })}</section>` : '';

    const weeks = Number(F.range);
    const daily = dailySeries(sum.idx, [sid], 26 * 7, ctx.now);
    const subsIn = sum.subs.filter((x) => x.at >= new Date(ctx.now.getTime() - weeks * 7 * 864e5).toISOString());
    const practice = show('practice') ? `<section class="panel" aria-labelledby="h-prac"><div class="panel-head"><h2 id="h-prac">Coding practice activity</h2><a class="more" href="#/arena">Practice Arena</a></div>
      <div class="stat-line"><div><b>${subsIn.length}</b><span>Submissions (${weeks} wks)</span></div><div><b>${new Set(subsIn.filter((x) => x.status === 'Accepted').map((x) => x.problemId)).size}</b><span>Problems accepted</span></div><div><b>${['Easy', 'Medium', 'Hard'].map((d) => sum.solved.filter((p) => p.diff === d).length).join(' / ')}</b><span>Easy / Medium / Hard all-time</span></div></div>
      <div style="margin-top:14px">${heatmap(daily, { cols: 26, label: 'Daily learning minutes over 26 weeks' })}</div><p class="hint" style="margin-top:6px">Each square is a day over the last 26 weeks, darker means more minutes of lessons, practice, assessments and classes.</p></section>` : '';

    const ws = weeklySeries(sum.idx, [sid], weeks, ctx.now);
    const vel = velocity(s, sid, weeks, ctx.now);
    const goalWeeks = ws.filter((w) => w.mins >= goal).length;
    const velocityW = show('velocity') ? `<section class="panel" aria-labelledby="h-vel"><div class="panel-head"><h2 id="h-vel">Learning velocity and consistency</h2><span class="sub">Goal met in ${goalWeeks} of ${weeks} weeks</span></div>
      ${lineChart({ series: [{ values: ws.map((w) => w.mins) }], labels: ws.map((w) => fmtShort(w.week)), yFmt: (v) => `${Math.round(v)}m`, title: 'Minutes learned per week', every: Math.ceil(weeks / 6) })}
      <div class="eyebrow" style="margin:10px 0 4px">Lessons completed per week</div>
      ${barChart({ values: vel, labels: ws.map((w) => fmtShort(w.week).split(' ')[0]), height: 120, title: 'Lessons completed per week', hl: vel.length - 1 })}</section>` : '';

    const readinessW = show('readiness') ? `<section class="panel" aria-labelledby="h-ready"><div class="panel-head"><h2 id="h-ready">Placement readiness</h2><a class="more" href="#/placement">Details</a></div><div class="row nowrap" style="--gap:18px">${ring(sum.ready.score, String(sum.ready.score), 84)}<div class="grow min0"><b>${esc(sum.ready.level)}</b><p class="small muted">Transparent weighted score. It guides preparation; it does not predict or guarantee a job.</p></div></div>
      <div class="list" style="margin-top:12px">${sum.ready.gaps.slice(0, 3).map((g) => `<div class="item"><span class="grow min0"><span class="t small">${esc(g.label.split(' (')[0])}</span><br><span class="s">${esc(g.detail)}</span></span><span class="mono small">+${Math.round(g.gap)} possible</span></div>`).join('') || '<p class="small muted">No significant gaps.</p>'}</div></section>` : '';

    const riskW = show('risk') ? `<section class="panel" aria-labelledby="h-risk"><div class="panel-head"><h2 id="h-risk">Learning health</h2>${pill(riskLabel[sum.risk.level], riskTone[sum.risk.level])}</div>${sum.risk.flags.length ? `<div class="list">${sum.risk.flags.map((f) => `<div class="item" style="align-items:flex-start">${icon('alert', 'style="width:18px;height:18px;color:var(--warn);flex:none;margin-top:2px"')}<div class="min0"><div class="t">${esc(RULES[f.rule].label)}</div><div class="s">${esc(f.evidence)}</div><div class="s" style="margin-top:3px"><b>${self ? 'Suggested' : 'Recommended intervention'}:</b> ${esc(self ? RULES[f.rule].action.replace('Mentor call within 48 hours; agree', 'Book time with your mentor and agree') : RULES[f.rule].action)}</div></div></div>`).join('')}</div>${self ? `<div style="margin-top:12px">${btn('Ask my mentor for help', { href: '/mentors', cls: 'btn-primary', sm: true })}</div>` : ''}` : `<p class="small muted">No warning signs under the institute's current rules.</p>`}</section>` : '';

    const xpW = show('xp') && ctx.flag('gamification') ? `<section class="panel" aria-labelledby="h-xp"><div class="panel-head"><h2 id="h-xp">XP and badges</h2><a class="more" href="#/arena?tab=badges">History</a></div>${badgeStrip(ctx, sum)}<div class="eyebrow" style="margin:12px 0 4px">Recent XP</div><div class="list">${sum.ledger.entries.slice(0, 4).map((e) => `<div class="item"><span class="mono small" style="color:var(--accent);min-width:46px">+${e.pts}</span><span class="grow min0 small">${esc(e.reason)}</span><span class="s">${fmtShort(e.at)}</span></div>`).join('')}</div></section>` : '';

    const header = pageHead({ title: self ? '' : sum.st.name, eyebrow: self ? esc(ctx.now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })) : `${esc(sum.st.learnerId)} · ${esc(sum.cohort?.name || '')}`, lede: self ? `You have ${sum.deadlines.length} open project${sum.deadlines.length === 1 ? '' : 's'} and ${sum.sessions.length} upcoming class${sum.sessions.length === 1 ? '' : 'es'}.` : `Mentor ${esc(displayName(s, sum.st.mentorId))} · last active ${sum.lastActive ? relDays(sum.lastActive, ctx.now) : 'never'} · status ${esc(sum.st.status)}`, actions: self ? btn('Browse programs', { href: '/programs', ic: 'compass' }) : `${pill(riskLabel[sum.risk.level], riskTone[sum.risk.level])}${btn('Full profile', { href: `/ops/students/${sid}`, ic: 'user', sm: true })}` }).replace('<h1 id="page-title"></h1>', `<h1 id="page-title">${greet}</h1>`);

    return `<div class="page">${staffPicker}${header}${filters}${kpis}
      <div class="grid g-main"><div class="stack">${next}${roadmap}${courses}${velocityW}${practice}</div><div class="stack">${riskW}${schedule}${reviews}${readinessW}${mastery}${xpW}</div></div></div>`;
  },
  actions: {
    filter(el, e, ctx) { ctx.local('dashF')[el.dataset.key] = el.value; ctx.rerender(); },
    sort(el, e, ctx) { const t = ctx.local('dashT'); t.d = t.k === el.dataset.id && t.d === 'desc' ? 'asc' : 'desc'; t.k = el.dataset.id; ctx.rerender(); },
    pick(el, e, ctx) { ctx.local('dash').sid = el.value; ctx.nav(`/dashboard?student=${el.value}`); },
    pickFilter(el, e, ctx) { ctx.local('dash')[el.dataset.key] = el.value; ctx.local('dash').sid = null; ctx.rerender(); },
    customise(el, e, ctx) {
      const prefs = ctx.s.prefs[ctx.me.id] || {};
      const hidden = new Set(prefs.hiddenWidgets || []);
      ctx.modal({ title: 'Customise dashboard', body: `<p class="muted small">Choose the widgets you want to see. Saved to your preferences.</p><div class="stack" style="--gap:8px">${WIDGETS.map(([id, l]) => check({ id: `w-${id}`, label: esc(l), checked: !hidden.has(id), a: { 'data-w': id } })).join('')}</div>`, foot: `<button type="button" class="btn btn-ghost" data-close>Cancel</button><button type="button" class="btn btn-primary" id="w-save">Save</button>`, onMount: (m, close) => { m.querySelector('#w-save').onclick = () => { const off = [...m.querySelectorAll('[data-w]')].filter((x) => !x.checked).map((x) => x.dataset.w); ctx.commit('prefs.widgets', (s) => { s.prefs[ctx.me.id] = { ...(s.prefs[ctx.me.id] || {}), hiddenWidgets: off }; }, { ok: 'Dashboard updated' }); close(); }; m.parentElement.querySelectorAll('[data-close]').forEach((b) => (b.onclick = close)); } });
    },
  },
};

function learnerPicker(ctx) {
  const L = ctx.local('dash', { sid: null, cohort: 'all', status: 'all' });
  const risk = new Map(ctx.risk().map((r) => [r.studentId, r.level]));
  let list = visibleStudents(ctx.s, ctx.me);
  const cohorts = [...new Set(list.map((s) => s.cohortId))].map((id) => ctx.s.cohorts.find((c) => c.id === id));
  if (L.cohort !== 'all') list = list.filter((s) => s.cohortId === L.cohort);
  if (L.status !== 'all') list = list.filter((s) => (L.status === 'risk' ? ['high', 'medium'].includes(risk.get(s.id)) : s.status === L.status));
  const sid = pickStudent(ctx);
  return `<div class="toolbar panel tight" aria-label="Choose a learner">
    ${select({ id: 'dp-cohort', label: 'Cohort', value: L.cohort, options: [['all', 'All cohorts in scope'], ...cohorts.map((c) => [c.id, c.name])], a: { 'data-change': 'pickFilter', 'data-key': 'cohort' } })}
    ${select({ id: 'dp-status', label: 'Status', value: L.status, options: [['all', 'All'], ['active', 'Active'], ['risk', 'At risk (medium or high)'], ['paused', 'Paused'], ['withdrawn', 'Withdrawn']], a: { 'data-change': 'pickFilter', 'data-key': 'status' } })}
    ${select({ id: 'dp-student', label: `Learner (${list.length})`, value: sid, options: list.map((s) => [s.id, `${s.name} · ${s.learnerId}`]), a: { 'data-change': 'pick' }, cls: 'grow-field' })}
  </div>`;
}

function badgeStrip(ctx, sum) {
  return `<div class="badges">${badgesOf(ctx, sum).slice(0, 10).map((b) => `<span class="badge-chip tip ${b.earned ? 'on' : ''}" tabindex="0" data-tip="${esc(b.how)} (${esc(b.progress)})">${icon(b.earned ? 'star' : 'lock')}${esc(b.label)}</span>`).join('')}</div>`;
}
const badgesOf = (ctx, sum) => badges(ctx.s, sum.st.id, sum.ledger, sum.streak);
