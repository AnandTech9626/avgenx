// Practice Arena: problem library, daily challenge, weekly contest, leaderboards with
// explainable scoring, preparation paths, topic proficiency, XP history and the problem studio.
import { esc, fmtDateTime, fmtShort, uid, pct } from '../core/util.js';
import { icon } from '../core/icons.js';
import { pageHead, pill, btn, empty, tabs, table, select, searchBox, kpi, bar, hbars, tag, input, textarea, avatar } from '../core/ui.js';
import { allProblems } from '../data/problemsStore.js';
import { PROBLEM_SETS } from '../data/problems.js';
import { leaderboard, weeklyContest, dailyChallenge, xpLedger, badges } from '../domain/motivation.js';
import { streak } from '../domain/activity.js';
import { visibleStudents, displayName } from '../domain/scope.js';
import { runJS } from '../services/executor.js';

const TABS = [['problems', 'Problems'], ['contest', 'Weekly contest'], ['leaders', 'Leaderboards'], ['paths', 'Preparation paths'], ['stats', 'My stats'], ['badges', 'XP and badges'], ['studio', 'Problem studio']];

function stats(ctx, sid) {
  const subs = ctx.s.submissions.filter((x) => x.studentId === sid && x.status !== 'Solution viewed');
  const solved = new Set(subs.filter((x) => x.status === 'Accepted').map((x) => x.problemId));
  const attempted = new Set(subs.map((x) => x.problemId));
  return { subs, solved, attempted };
}

export default {
  perms: ['arena.use'],
  title: () => 'Practice Arena',
  render(ctx) {
    const T = ctx.local('arena', { tab: ctx.query.tab || 'problems' });
    if (ctx.query.tab && ctx.query.tab !== T.lastQ) { T.tab = ctx.query.tab; T.lastQ = ctx.query.tab; }
    const visibleTabs = TABS.filter(([id]) => (id === 'studio' ? ctx.can('problems.manage') : id === 'badges' ? ctx.flag('gamification') && ctx.me.role === 'student' : id === 'stats' ? ctx.me.role === 'student' : true));
    if (!visibleTabs.some(([id]) => id === T.tab)) T.tab = 'problems';
    const daily = dailyChallenge(ctx.now);
    const me = stats(ctx, ctx.me.id);
    const head = pageHead({ title: 'Practice Arena', lede: 'Graded practice with real tests. JavaScript runs in a sandbox in your browser; other languages need the server execution service.' });
    const dailyDone = me.solved.has(daily.id);
    const top = `<div class="grid g3">
      <section class="panel daily"><div class="eyebrow">Daily challenge · ${esc(ctx.now.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }))}</div><h2 style="margin:4px 0">${esc(daily.title)}</h2><div class="row" style="--gap:6px"><span class="small diff-${daily.diff.toLowerCase()}">${daily.diff}</span>${daily.topics.map(tag).join('')}</div><div class="row" style="margin-top:12px">${dailyDone ? pill('Solved today', 'p-ok') : ''}${btn(dailyDone ? 'Open again' : 'Solve now', { href: `/lab/${daily.id}`, cls: dailyDone ? 'btn-ghost' : 'btn-primary', sm: true, ic: 'code' })}</div></section>
      ${ctx.me.role === 'student' ? `${kpi({ label: 'Problems solved', value: `${me.solved.size}<span class="muted" style="font-size:1rem">/${allProblems(ctx.s).length}</span>`, foot: `${me.attempted.size} attempted · ${me.subs.length ? Math.round((me.subs.filter((x) => x.status === 'Accepted').length / me.subs.length) * 100) : 0}% acceptance` })}${kpi({ label: 'Practice streak', value: `${streak(ctx.idx(), ctx.me.id, ctx.now)} days`, foot: 'Any lesson, problem or class counts' })}` : `${kpi({ label: 'Problems in library', value: allProblems(ctx.s).length, foot: `${ctx.s.problemDrafts.filter((p) => p.status !== 'published').length} drafts in the studio` })}${kpi({ label: 'Submissions this week', value: ctx.s.submissions.filter((x) => x.at >= new Date(ctx.now.getTime() - 7 * 864e5).toISOString()).length, foot: 'Across all learners' })}`}
    </div>`;
    const body = { problems: problemsTab, contest: contestTab, leaders: leadersTab, paths: pathsTab, stats: statsTab, badges: badgesTab, studio: studioTab }[T.tab](ctx);
    return `<div class="page">${head}${top}${tabs(visibleTabs, T.tab, 'tab', { label: 'Arena sections' })}<div>${body}</div></div>`;
  },
  actions: {
    tab(el, e, ctx) { ctx.local('arena').tab = el.dataset.id; ctx.rerender(); },
    f(el, e, ctx) { const F = ctx.local('arenaF'); F[el.dataset.key] = el.value; F.page = 1; ctx.rerender(); },
    q(el, e, ctx) { const F = ctx.local('arenaF'); F.q = el.value; F.page = 1; clearTimeout(qT); qT = setTimeout(() => ctx.rerender(), 160); },
    page(el, e, ctx) { ctx.local('arenaF').page = Number(el.dataset.id); ctx.rerender(); },
    sort(el, e, ctx) { const F = ctx.local('arenaF'); F.dir = F.sort === el.dataset.id && F.dir === 'asc' ? 'desc' : 'asc'; F.sort = el.dataset.id; ctx.rerender(); },
    open(el, e, ctx) { ctx.nav(`/lab/${el.dataset.id}`); },
    openSet(el, e, ctx) { Object.assign(ctx.local('arenaF', {}), { set: el.dataset.id, page: 1, q: '', diff: 'all', topic: 'all', status: 'all' }); ctx.local('arena').tab = 'problems'; ctx.rerender(); },
    xpPage(el, e, ctx) { ctx.local('xpP').p = Number(el.dataset.id); ctx.rerender(); },
    lb(el, e, ctx) { ctx.local('lb', {})[el.dataset.key] = el.value; ctx.rerender(); },
    explain(el, e, ctx) { const cfg = ctx.s.settings.leaderboard; ctx.modal({ title: 'How rankings are scored', body: `<p>Points come only from the <b>first accepted solution</b> to each problem inside the time window, so resubmitting a solved problem earns nothing.</p><ul class="ticks"><li>${icon('check')}Easy ${cfg.easy}, Medium ${cfg.medium}, Hard ${cfg.hard} points</li><li>${icon('check')}+${cfg.firstTryBonus} first-try bonus when there was no failed submission (or viewed solution) before the accept</li><li>${icon('check')}Ties break on who reached the score first</li></ul><p class="small muted">Administrators can change these weights in System Settings. Every row shows its own calculation.</p>` }); },
    studioNew(el, e, ctx) { studioEditor(ctx, null); },
    studioEdit(el, e, ctx) { studioEditor(ctx, ctx.s.problemDrafts.find((p) => p.id === el.dataset.id)); },
    async studioValidate(el, e, ctx) {
      const p = ctx.s.problemDrafts.find((x) => x.id === el.dataset.id);
      const r = await runJS({ code: p.solution, fn: p.fn, cases: p.tests.map(([args, expected]) => ({ args, expected })) });
      const ok = r.status === 'Accepted';
      ctx.commit('problem.validate', (s) => { const d = s.problemDrafts.find((x) => x.id === p.id); d.validation = { at: new Date().toISOString(), status: r.status, passed: r.results.filter((x) => x.passed).length, total: p.tests.length, error: r.error || '' }; d.status = ok ? 'validated' : 'draft'; }, { ok: ok ? 'All tests pass against the reference solution' : undefined, audit: { action: 'problem.validate', entity: 'problem', entityId: p.id, detail: r.status } });
      if (!ok) ctx.toast(`Validation failed: ${r.status}${r.error ? `, ${r.error}` : ''}`, { tone: 'bad' });
    },
    studioPublish(el, e, ctx) {
      const p = ctx.s.problemDrafts.find((x) => x.id === el.dataset.id);
      if (p.status !== 'validated') return ctx.toast('Validate the tests against the reference solution first.', { tone: 'bad' });
      ctx.commit('problem.publish', (s) => { s.problemDrafts.find((x) => x.id === p.id).status = 'published'; }, { ok: `${p.title} published to the library`, audit: { action: 'problem.publish', entity: 'problem', entityId: p.id, detail: p.title } });
    },
  },
  forms: {
    studio(form, data, ctx) {
      const errs = {};
      if (!data.title?.trim()) errs.title = 'Required';
      if (!/^[A-Za-z_$][\w$]*$/.test(data.fn || '')) errs.fn = 'A valid JavaScript function name';
      let tests;
      try { tests = JSON.parse(data.tests); if (!Array.isArray(tests) || !tests.length || !tests.every((t) => Array.isArray(t) && t.length === 2 && Array.isArray(t[0]))) throw new Error(); } catch { errs.tests = 'Use [[[args...], expected], ...] with at least one test'; }
      if (!data.solution?.includes(data.fn)) errs.solution = 'The reference solution must define the function';
      if (tests && tests.length < 3) errs.tests = 'Add at least three tests (two become visible samples)';
      if (Object.keys(errs).length) { studioEditor(ctx, { ...data, id: data.id || null }, errs); return; }
      const rec = { id: data.id || `custom-${uid('p').slice(2, 10)}`, title: data.title.trim(), diff: data.diff, topics: data.topics.split(',').map((x) => x.trim()).filter(Boolean), sets: ['product'], fn: data.fn, params: (data.params || '').split(',').map((x) => x.trim()).filter(Boolean), statement: data.statement.trim(), tests, hints: data.hints.split('\n').map((x) => x.trim()).filter(Boolean), solution: data.solution, complexity: data.complexity, custom: true, status: 'draft', authorId: ctx.me.id, updatedAt: new Date().toISOString() };
      ctx.commit('problem.save', (s) => { const i = s.problemDrafts.findIndex((x) => x.id === rec.id); if (i >= 0) s.problemDrafts[i] = { ...s.problemDrafts[i], ...rec, status: 'draft', validation: null }; else s.problemDrafts.push(rec); }, { ok: 'Draft saved. Validate it next.', audit: { action: 'problem.save', entity: 'problem', entityId: rec.id, detail: rec.title } });
      document.querySelector('#drawer [data-close]')?.click();
    },
  },
};
let qT;

function problemsTab(ctx) {
  const F = ctx.local('arenaF', { q: '', diff: 'all', topic: 'all', set: 'all', status: 'all', page: 1, sort: 'id', dir: 'asc' });
  const me = stats(ctx, ctx.me.id);
  const all = allProblems(ctx.s);
  const topics = [...new Set(all.flatMap((p) => p.topics))].sort();
  const subsBy = new Map();
  ctx.s.submissions.forEach((x) => { if (x.status === 'Solution viewed') return; const r = subsBy.get(x.problemId) || { n: 0, ac: 0 }; r.n++; if (x.status === 'Accepted') r.ac++; subsBy.set(x.problemId, r); });
  let list = all.filter((p) => (F.diff === 'all' || p.diff === F.diff) && (F.topic === 'all' || p.topics.includes(F.topic)) && (F.set === 'all' || p.sets.includes(F.set)) && (!F.q || `${p.title} ${p.topics.join(' ')}`.toLowerCase().includes(F.q.toLowerCase())));
  if (F.status !== 'all') list = list.filter((p) => (F.status === 'solved' ? me.solved.has(p.id) : F.status === 'attempted' ? me.attempted.has(p.id) && !me.solved.has(p.id) : !me.attempted.has(p.id)));
  const acc = (p) => { const r = subsBy.get(p.id); return r ? r.ac / r.n : 0; };
  return `<div class="stack"><div class="toolbar">
    <div class="grow-field">${searchBox({ id: 'ar-q', value: F.q, placeholder: 'Search problems or topics', a: { 'data-input': 'q' } })}</div>
    ${select({ id: 'ar-diff', label: 'Difficulty', value: F.diff, options: [['all', 'All'], 'Easy', 'Medium', 'Hard'], a: { 'data-change': 'f', 'data-key': 'diff' } })}
    ${select({ id: 'ar-topic', label: 'Topic', value: F.topic, options: [['all', 'All topics'], ...topics], a: { 'data-change': 'f', 'data-key': 'topic' } })}
    ${select({ id: 'ar-set', label: 'Practice set', value: F.set, options: [['all', 'All sets'], ...Object.entries(PROBLEM_SETS).map(([k, v]) => [k, v.label])], a: { 'data-change': 'f', 'data-key': 'set' } })}
    ${ctx.me.role === 'student' ? select({ id: 'ar-status', label: 'Status', value: F.status, options: [['all', 'All'], ['solved', 'Solved'], ['attempted', 'Attempted'], ['new', 'Not attempted']], a: { 'data-change': 'f', 'data-key': 'status' } }) : ''}
  </div>
  <section class="panel flush">${table([
    { key: 'st', label: '', render: (p) => (me.solved.has(p.id) ? `<span title="Solved" style="color:var(--ok)">${icon('check', 'style="width:16px;height:16px"')}</span>` : me.attempted.has(p.id) ? `<span title="Attempted" style="color:var(--warn)">${icon('dot', 'style="width:14px;height:14px"')}</span>` : '<span class="sr-only">Not attempted</span>') },
    { key: 'id', label: 'Problem', sort: (p) => p.title, render: (p) => `<a href="#/lab/${p.id}" style="font-weight:600;text-decoration:none">${esc(p.title)}</a>${p.custom ? ` ${pill('Instructor', 'p-info', true)}` : ''}<div class="sub">${p.topics.join(' · ')}</div>` },
    { key: 'diff', label: 'Difficulty', sort: (p) => ['Easy', 'Medium', 'Hard'].indexOf(p.diff), render: (p) => `<span class="diff-${p.diff.toLowerCase()}" style="font-weight:600">${p.diff}</span>` },
    { key: 'sets', label: 'Sets', render: (p) => p.sets.map((s) => tag(s)).join(' ') },
    { key: 'acc', label: 'Acceptance', r: true, sort: acc, render: (p) => { const r = subsBy.get(p.id); return r ? `${Math.round(acc(p) * 100)}%<div class="sub">${r.n} subs</div>` : '<span class="muted">n/a</span>'; } },
  ], list, { sortKey: F.sort, sortDir: F.dir, sortAct: 'sort', page: F.page, pageSize: 15, pageAct: 'page', rowAct: 'open', rowId: (p) => p.id, empty: 'No problems match. Clear a filter.', caption: 'Problem library' })}</section></div>`;
}

function contestTab(ctx) {
  const c = weeklyContest(ctx.now);
  const ps = c.problems.map((id) => allProblems(ctx.s).find((p) => p.id === id));
  const scope = visibleStudents(ctx.s, ctx.me.role === 'student' ? { role: 'admin' } : ctx.me).filter((s) => !s.orgId);
  const lb = leaderboard(ctx.s, scope, ctx.now, { days: 7, problemIds: c.problems });
  const mine = lb.find((r) => r.studentId === ctx.me.id);
  return `<div class="grid g-main"><section class="panel"><div class="panel-head"><h2>${esc(c.title)}</h2>${pill(`${fmtShort(c.start)} to ${fmtShort(c.end)}`, 'p-info', true)}</div>
    <p class="small muted">Four problems, scored like the leaderboard. Enter timed mode for a ${c.minutes}-minute focus timer; your accepted solutions during the week count.</p>
    <div class="list" style="margin-top:12px">${ps.map((p, i) => `<a class="item" href="#/lab/${p.id}?contest=1"><span class="mono" style="min-width:28px">P${i + 1}</span><span class="grow min0"><span class="t">${esc(p.title)}</span><br><span class="s">${p.topics.join(', ')}</span></span><span class="small diff-${p.diff.toLowerCase()}">${p.diff} · ${ctx.s.settings.leaderboard[p.diff.toLowerCase()]} pts</span></a>`).join('')}</div>
    ${ctx.me.role === 'student' ? `<div class="row" style="margin-top:14px">${btn('Enter timed mode', { href: `/lab/${ps[0].id}?contest=1`, cls: 'btn-primary', ic: 'clock' })}${mine ? `<span class="small">Your rank: <b>#${mine.rank}</b> · ${mine.pts} pts</span>` : '<span class="small muted">No contest points yet this week.</span>'}</div>` : ''}</section>
    <section class="panel"><div class="panel-head"><h2>Contest ranking</h2>${btn('How scoring works', { act: 'explain', sm: true, cls: 'btn-quiet', ic: 'info' })}</div>${lb.length ? rankList(ctx, lb.slice(0, 12)) : empty('No accepted solutions yet this week', 'Be the first on the board.', { ic: 'trophy' })}</section></div>`;
}

function rankList(ctx, rows) {
  return `<ol class="ranks">${rows.map((r) => `<li class="${r.studentId === ctx.me.id ? 'me' : ''}"><span class="rank mono">${r.rank}</span>${avatar(displayName(ctx.s, r.studentId), 'sm')}<span class="grow min0"><span class="t small">${esc(displayName(ctx.s, r.studentId))}${r.studentId === ctx.me.id ? ' (you)' : ''}</span><br><span class="s mono">${esc(r.explain)}</span></span><b class="mono">${r.pts}</b></li>`).join('')}</ol>`;
}

function leadersTab(ctx) {
  const L = ctx.local('lb', { scope: 'cohort', window: '30' });
  const meSt = ctx.s.students.find((s) => s.id === ctx.me.id);
  const base = ctx.me.role === 'student' ? ctx.s.students.filter((s) => (meSt.orgId ? s.orgId === meSt.orgId : !s.orgId)) : visibleStudents(ctx.s, ctx.me);
  const pool = L.scope === 'cohort' && meSt ? base.filter((s) => s.cohortId === meSt.cohortId) : base;
  const lb = leaderboard(ctx.s, pool, ctx.now, { days: L.window === 'all' ? 0 : Number(L.window) });
  const cohorts = [...new Set(base.map((s) => s.cohortId))].map((id) => ctx.s.cohorts.find((c) => c.id === id));
  const teams = cohorts.map((c) => { const m = base.filter((s) => s.cohortId === c.id); const pts = leaderboard(ctx.s, m, ctx.now, { days: L.window === 'all' ? 0 : Number(L.window) }).reduce((a, r) => a + r.pts, 0); return { label: c.name.split(' · ')[0] + ' · ' + (c.name.split(' · ')[1] || ''), value: Math.round(pts / Math.max(1, m.length)), id: c.id }; }).sort((a, b) => b.value - a.value);
  return `<div class="grid g-main"><section class="panel"><div class="panel-head"><h2>Individual leaderboard</h2><div class="row">${select({ id: 'lb-scope', value: L.scope, options: meSt ? [['cohort', 'My cohort'], ['all', 'All learners']] : [['all', 'Learners in scope']], sm: true, a: { 'data-change': 'lb', 'data-key': 'scope', 'aria-label': 'Scope' } })}${select({ id: 'lb-window', value: L.window, options: [['7', 'Last 7 days'], ['30', 'Last 30 days'], ['all', 'All time']], sm: true, a: { 'data-change': 'lb', 'data-key': 'window', 'aria-label': 'Window' } })}${btn('Scoring', { act: 'explain', sm: true, cls: 'btn-quiet', ic: 'info' })}</div></div>
    ${lb.length ? rankList(ctx, lb.slice(0, 20)) : empty('No accepted solutions in this window', 'Try a longer window.', { ic: 'trophy' })}</section>
    <section class="panel"><div class="panel-head"><h2>Team competition</h2><span class="sub">Average points per learner, by cohort</span></div>${hbars(teams, { fmt: (v) => `${v} pts` })}<p class="hint" style="margin-top:10px">Averages keep large and small cohorts comparable.</p></section></div>`;
}

function pathsTab(ctx) {
  const me = stats(ctx, ctx.me.id);
  return `<div class="grid g-auto" style="--min:300px">${Object.entries(PROBLEM_SETS).map(([k, v]) => { const ps = allProblems(ctx.s).filter((p) => p.sets.includes(k)); const done = ps.filter((p) => me.solved.has(p.id)).length; return `<section class="panel"><div class="panel-head"><h2>${esc(v.label)}</h2><span class="mono small">${done}/${ps.length}</span></div><p class="small muted">${esc(v.blurb)}</p>${bar((done / ps.length) * 100)}<div class="list" style="margin-top:10px">${ps.slice(0, 6).map((p) => `<a class="item" href="#/lab/${p.id}">${me.solved.has(p.id) ? icon('check', 'style="width:15px;height:15px;color:var(--ok)"') : icon('code', 'style="width:15px;height:15px;color:var(--faint)"')}<span class="grow t small">${esc(p.title)}</span><span class="xs diff-${p.diff.toLowerCase()}">${p.diff}</span></a>`).join('')}</div>${ps.length > 6 ? `<button type="button" class="link" data-act="openSet" data-id="${k}" style="margin-top:8px">See all ${ps.length} problems</button>` : ''}</section>`; }).join('')}</div><p class="hint" style="margin-top:12px">Preparation sets group problems by interview style. They are not lists of questions asked by any particular employer.</p>`;
}

function statsTab(ctx) {
  const me = stats(ctx, ctx.me.id);
  const all = allProblems(ctx.s);
  const topics = [...new Set(all.flatMap((p) => p.topics))].map((t) => { const ps = all.filter((p) => p.topics.includes(t)); const s = ps.filter((p) => me.solved.has(p.id)).length; return { label: t, value: Math.round((s / ps.length) * 100), display: `${s}/${ps.length}`, max: 100 }; }).sort((a, b) => b.value - a.value);
  const by = ['Easy', 'Medium', 'Hard'].map((d) => ({ d, s: all.filter((p) => p.diff === d && me.solved.has(p.id)).length, n: all.filter((p) => p.diff === d).length }));
  const recent = me.subs.slice().sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 10);
  return `<div class="grid g-main"><section class="panel"><div class="panel-head"><h2>Topic proficiency</h2><span class="sub">Share of problems solved per topic</span></div>${hbars(topics)}</section>
    <div class="stack"><section class="panel"><div class="panel-head"><h2>Solved by difficulty</h2></div><div class="stack" style="--gap:10px">${by.map((x) => `<div><div class="spread small"><span class="diff-${x.d.toLowerCase()}" style="font-weight:600">${x.d}</span><span class="mono">${x.s}/${x.n}</span></div>${bar((x.s / x.n) * 100)}</div>`).join('')}</div></section>
    <section class="panel"><div class="panel-head"><h2>Recent submissions</h2></div>${recent.length ? `<div class="list">${recent.map((x) => `<a class="item" href="#/lab/${x.problemId}">${pill(x.status, x.status === 'Accepted' ? 'p-ok' : 'p-bad')}<span class="grow min0 small">${esc(allProblems(ctx.s).find((p) => p.id === x.problemId)?.title || x.problemId)}<br><span class="s">${fmtDateTime(x.at)} · ${x.lang}</span></span></a>`).join('')}</div>` : empty('No submissions yet')}</section></div></div>`;
}

function badgesTab(ctx) {
  const L = xpLedger(ctx.s, ctx.me.id, ctx.idx(), ctx.now);
  const B = badges(ctx.s, ctx.me.id, L, streak(ctx.idx(), ctx.me.id, ctx.now));
  const x = ctx.s.settings.xp;
  return `<div class="grid g-main"><section class="panel flush"><div class="panel-head" style="padding:18px 20px 0"><h2>Achievement history</h2><span class="sub">${L.total.toLocaleString('en-IN')} XP · level ${L.level}</span></div>${table([{ key: 'pts', label: 'XP', r: true, render: (e) => `<b class="mono" style="color:var(--accent)">+${e.pts}</b>` }, { key: 'reason', label: 'Earned for', render: (e) => esc(e.reason) }, { key: 'at', label: 'When', render: (e) => fmtShort(e.at) }], L.entries, { page: ctx.local('xpP', { p: 1 }).p, pageSize: 12, pageAct: 'xpPage' })}</section>
    <div class="stack"><section class="panel"><div class="panel-head"><h2>Badges</h2><span class="sub">${B.filter((b) => b.earned).length} of ${B.length}</span></div><div class="badge-grid">${B.map((b) => `<div class="badge-card ${b.earned ? 'on' : ''}">${icon(b.earned ? 'star' : 'lock')}<b>${esc(b.label)}</b><span class="xs muted">${esc(b.how)}</span><span class="mono xs">${esc(b.progress)}</span></div>`).join('')}</div></section>
    <section class="panel"><div class="panel-head"><h2>How XP works</h2></div><p class="small">XP is calculated from verified records, so repeating an action never adds points twice.</p><dl class="dl small" style="margin-top:8px"><dt>Lesson completed</dt><dd>${x.lesson}</dd><dt>First accepted solve</dt><dd>${x.solveEasy} / ${x.solveMedium} / ${x.solveHard} by difficulty</dd><dt>Assessment passed (first time)</dt><dd>${x.assessmentPass}</dd><dt>Project approved</dt><dd>${x.projectApproved}</dd><dt>Live class attended</dt><dd>${x.attendance}</dd><dt>Weekly minutes goal met</dt><dd>${x.weeklyGoal}</dd></dl></section></div></div>`;
}

function studioTab(ctx) {
  const drafts = ctx.s.problemDrafts;
  const S = { draft: ['Draft', 'p-mute'], validated: ['Validated', 'p-info'], published: ['Published', 'p-ok'] };
  return `<div class="stack"><div class="callout info small"><b>Workflow:</b> write the problem and tests, validate them against your reference solution in the sandbox, then publish. Only validated problems can be published; editing a problem returns it to draft.</div>
    <div class="row">${btn('New problem', { act: 'studioNew', cls: 'btn-primary', ic: 'plus' })}</div>
    <section class="panel flush">${table([
      { key: 't', label: 'Problem', render: (p) => `<b>${esc(p.title)}</b><div class="sub">${esc(p.fn)}(${esc(p.params.join(', '))}) · ${p.tests.length} tests</div>` },
      { key: 'd', label: 'Difficulty', render: (p) => p.diff },
      { key: 's', label: 'Status', render: (p) => pill(...S[p.status]) },
      { key: 'v', label: 'Validation', render: (p) => (p.validation ? `${pill(p.validation.status, p.validation.status === 'Accepted' ? 'p-ok' : 'p-bad', true)}<div class="sub">${p.validation.passed}/${p.validation.total} · ${fmtDateTime(p.validation.at)}</div>` : '<span class="muted">Not run</span>') },
      { key: 'a', label: '', r: true, render: (p) => `<div class="row" style="justify-content:flex-end">${btn('Edit', { act: 'studioEdit', sm: true, attrs: { 'data-id': p.id } })}${btn('Validate', { act: 'studioValidate', sm: true, attrs: { 'data-id': p.id } })}${p.status !== 'published' ? btn('Publish', { act: 'studioPublish', sm: true, cls: 'btn-primary', attrs: { 'data-id': p.id }, disabled: p.status !== 'validated' }) : btn('Open', { href: `/lab/${p.id}`, sm: true })}</div>` },
    ], drafts, { empty: 'No authored problems yet. Create one to start the workflow.' })}</section></div>`;
}

function studioEditor(ctx, p, errs = {}) {
  const v = p || { title: '', diff: 'Easy', topics: 'Arrays', fn: 'solve', params: 'nums', statement: '', tests: '[[[[1,2,3]], 6], [[[5]], 5], [[[]], 0]]', hints: '', solution: 'function solve(nums) {\n  return nums.reduce((a, b) => a + b, 0);\n}', complexity: 'O(n)' };
  const val = (k) => (typeof v[k] === 'string' ? v[k] : Array.isArray(v[k]) ? (k === 'tests' ? JSON.stringify(v[k]) : k === 'hints' ? v[k].join('\n') : v[k].join(', ')) : v[k] ?? '');
  ctx.openPanel(() => ({ title: p?.id ? `Edit ${p.title}` : 'New problem', sub: 'Saved as a draft until validated and published', wide: true, body: `<form data-form="studio" class="stack" novalidate>
    <input type="hidden" name="id" value="${esc(p?.id || '')}">
    <div class="form-grid">${input({ id: 'title', label: 'Title', value: val('title'), req: true, error: errs.title })}${`<div class="field"><label for="diff">Difficulty</label><select class="select" id="diff" name="diff">${['Easy', 'Medium', 'Hard'].map((d) => `<option ${val('diff') === d ? 'selected' : ''}>${d}</option>`).join('')}</select></div>`}${input({ id: 'topics', label: 'Topics (comma separated)', value: val('topics') })}${input({ id: 'fn', label: 'Function name', value: val('fn'), req: true, error: errs.fn })}${input({ id: 'params', label: 'Parameters (comma separated)', value: val('params') })}${input({ id: 'complexity', label: 'Expected complexity', value: val('complexity') })}</div>
    ${textarea({ id: 'statement', label: 'Statement', value: val('statement'), rows: 3 })}
    ${textarea({ id: 'tests', label: 'Tests (JSON)', value: val('tests'), rows: 4, error: errs.tests, hint: 'Array of [argsArray, expected]. The first two are visible samples, the rest are hidden.', cls: 'mono-field' })}
    ${textarea({ id: 'solution', label: 'Reference solution (JavaScript)', value: val('solution'), rows: 6, error: errs.solution, cls: 'mono-field' })}
    ${textarea({ id: 'hints', label: 'Hints (one per line)', value: val('hints'), rows: 2 })}
    <div class="row"><button type="submit" class="btn btn-primary">Save draft</button></div></form>` }));
}
