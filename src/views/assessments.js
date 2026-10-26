// Assessment engine UI: catalogue, rules, timed attempts with autosave, results with feedback,
// manual grading queue, question analytics and question-bank management.
import { esc, fmtDateTime, fmtShort, uid } from '../core/util.js';
import { icon } from '../core/icons.js';
import { pageHead, pill, btn, empty, tabs, table, kpi, bar, select, input, textarea, hbars } from '../core/ui.js';
import { QUESTIONS, ASSESSMENTS } from '../data/questions.js';
import { allQuestions, attemptStatus, startAttempt, submitAttempt, scoreAttempt, applyManualGrade, questionAnalytics, marksFor, timeAllowedMs } from '../domain/assessment.js';
import { enrollmentFor } from '../domain/progress.js';
import { teachingCourseIds, displayName, visibleStudents } from '../domain/scope.js';
import { problemById } from '../data/problemsStore.js';
import { runJS } from '../services/executor.js';
import { DOMAINS } from '../data/catalog.js';
import * as store from '../core/store.js';

const QS = (ctx) => allQuestions(ctx.s, QUESTIONS);
const A = (id) => ASSESSMENTS.find((a) => a.id === id);
const TYPE_LABEL = { mcq: 'Multiple choice', multi: 'Multiple select', short: 'Short answer', sql: 'SQL', code: 'Coding' };
let timerHandle = null;
let unloadGuard = null;

function availableFor(ctx, sid) {
  const st = ctx.s.students.find((x) => x.id === sid);
  return ASSESSMENTS.filter((a) => (a.course ? !!enrollmentFor(ctx.s, sid, a.course) : a.kind === 'diagnostic' && ['C-FS-B', 'C-SEC-A'].includes(st.cohortId) || a.kind === 'diagnostic'));
}

export const list = {
  perms: ['assess.take', 'assess.grade', 'assess.manage'],
  title: () => 'Assessments',
  render(ctx) {
    const T = ctx.local('asT', { tab: ctx.me.role === 'student' ? 'mine' : ctx.can('assess.grade') ? 'grading' : 'analytics' });
    const tabsList = [...(ctx.me.role === 'student' ? [['mine', 'My assessments']] : []), ...(ctx.can('assess.grade') ? [['grading', 'Grading queue', ctx.s.attempts.filter((a) => a.status === 'needs_grading').length]] : []), ...(ctx.can('assess.manage') || ctx.can('assess.grade') ? [['analytics', 'Assessment analytics'], ['bank', 'Question bank', QS(ctx).length]] : [])];
    if (!tabsList.some(([id]) => id === T.tab)) T.tab = tabsList[0][0];
    const body = { mine: mineTab, grading: gradingTab, analytics: analyticsTab, bank: bankTab }[T.tab](ctx);
    return `<div class="page">${pageHead({ title: 'Assessments', lede: 'Randomised, difficulty-weighted assessments with automatic and rubric-based manual grading.' })}${tabs(tabsList, T.tab, 'tab')}<div>${body}</div></div>`;
  },
  actions: {
    tab(el, e, ctx) { ctx.local('asT').tab = el.dataset.id; ctx.rerender(); },
    bankF(el, e, ctx) { ctx.local('bankF', {})[el.dataset.key] = el.value; ctx.rerender(); },
    addQuestion(el, e, ctx) { questionEditor(ctx); },
    anaPick(el, e, ctx) { ctx.local('ana', {}).id = el.value; ctx.rerender(); },
  },
  forms: {
    question(form, d, ctx) {
      const errs = {};
      if ((d.text || '').trim().length < 10) errs.text = 'Write the full question (10+ characters)';
      const options = (d.options || '').split('\n').map((x) => x.trim()).filter(Boolean);
      let answer;
      if (['mcq', 'multi'].includes(d.type)) {
        if (options.length < 2) errs.options = 'At least two options';
        const idx = (d.answer || '').split(',').map((x) => Number(x.trim()) - 1).filter((n) => Number.isInteger(n));
        if (!idx.length || idx.some((n) => n < 0 || n >= options.length)) errs.answer = 'Give the correct option number(s), like 2 or 1,3';
        if (d.type === 'mcq' && idx.length !== 1) errs.answer = 'Exactly one correct option for multiple choice';
        answer = d.type === 'mcq' ? idx[0] : idx;
      }
      if (Object.keys(errs).length) return questionEditor(ctx, d, errs);
      const q = { id: `cq-${uid('q').slice(2, 9)}`, domain: d.domain, diff: Number(d.diff), type: d.type, text: d.text.trim(), options, answer, accept: d.type === 'short' || d.type === 'sql' ? (d.accept || '').split('\n').map((x) => x.trim()).filter(Boolean) : undefined, manual: (d.type === 'short' || d.type === 'sql') && !(d.accept || '').trim(), explain: d.explain, authorId: ctx.me.id };
      ctx.commit('question.add', (s) => { s.customQuestions.push(q); }, { ok: 'Question added to the bank', audit: { action: 'question.create', entity: 'question', entityId: q.id, detail: q.text.slice(0, 60) } });
      document.querySelector('#drawer [data-close]')?.click();
    },
  },
};

function mineTab(ctx) {
  const items = availableFor(ctx, ctx.me.id);
  if (!items.length) return empty('No assessments yet', 'Assessments appear for courses you are enrolled in.', { ic: 'exam' });
  return `<div class="grid g-auto" style="--min:300px">${items.map((a) => { const st = attemptStatus(ctx.s, ctx.me.id, a); const pending = st.list.some((x) => x.status === 'needs_grading'); const d = DOMAINS.find((x) => x.id === a.domain); return `<section class="panel stack" style="--gap:10px;--cat:var(${d.color})"><div class="spread"><span class="mono small" style="color:var(--cat)">${a.course || 'DIAGNOSTIC'} · ${a.kind}</span>${st.passed ? pill('Passed', 'p-ok') : pending ? pill('Awaiting grading', 'p-warn') : st.used ? pill('Not passed yet', 'p-bad') : pill('Not started', 'p-mute')}</div><h3>${esc(a.title)}</h3><div class="meta"><span>${a.pick} questions</span><span>${a.minutes} min</span><span>pass ${a.passPct}%</span><span>${st.left} of ${a.attempts} attempts left</span>${a.negative ? `<span>negative marking ${a.negative * 100}%</span>` : ''}</div>${st.best ? `<div>${bar(st.best.pct, st.best.passed ? '' : 'bad')}<span class="hint">Best ${st.best.pct}%</span></div>` : ''}<div class="row">${st.open ? btn('Resume attempt', { href: `/assessments/take/${st.open.id}`, cls: 'btn-primary', ic: 'play', sm: true }) : btn(st.left ? 'View and start' : 'View results', { href: `/assessments/${a.id}`, cls: st.left && !st.passed ? 'btn-primary' : 'btn-ghost', sm: true })}</div></section>`; }).join('')}</div>`;
}

function gradingTab(ctx) {
  const mine = ctx.me.role === 'instructor' || ctx.me.role === 'ta' ? new Set(teachingCourseIds(ctx.s, ctx.me)) : null;
  const rows = ctx.s.attempts.filter((a) => a.status === 'needs_grading' && (!mine || mine.has(A(a.assessmentId)?.course))).sort((a, b) => (a.submittedAt < b.submittedAt ? -1 : 1));
  return `<section class="panel flush">${table([
    { key: 's', label: 'Learner', render: (a) => `<b>${esc(displayName(ctx.s, a.studentId))}</b><div class="sub">${a.studentId}</div>` },
    { key: 'a', label: 'Assessment', render: (a) => `${esc(A(a.assessmentId).title)}<div class="sub">${A(a.assessmentId).course || 'Diagnostic'}</div>` },
    { key: 'p', label: 'Pending', r: true, render: (a) => `${scoreAttempt(A(a.assessmentId), QS(ctx), a).pending} question(s)` },
    { key: 't', label: 'Submitted', render: (a) => fmtDateTime(a.submittedAt) },
    { key: 'x', label: '', r: true, render: (a) => btn('Grade', { href: `/assessments/grade/${a.id}`, cls: 'btn-primary', sm: true }) },
  ], rows, { empty: 'Nothing to grade. Written and unmatched SQL answers land here.' })}</section>`;
}

function analyticsTab(ctx) {
  const L = ctx.local('ana', { id: ASSESSMENTS[2].id });
  const a = A(L.id);
  const atts = ctx.s.attempts.filter((x) => x.assessmentId === a.id && x.status !== 'in_progress');
  const rows = questionAnalytics(ctx.s, a).map((r) => ({ ...r, q: QS(ctx).find((q) => q.id === r.id) })).filter((r) => r.q).sort((x, y) => x.facility - y.facility);
  const dist = [0, 20, 40, 60, 80].map((lo) => ({ label: `${lo}–${lo + 19}%`.replace('80–99', '80–100'), value: atts.filter((x) => x.pct >= lo && (lo === 80 ? x.pct <= 100 : x.pct < lo + 20)).length }));
  return `<div class="stack"><div class="toolbar">${select({ id: 'ana-pick', label: 'Assessment', value: a.id, options: ASSESSMENTS.map((x) => [x.id, `${x.title}${x.course ? ` (${x.course})` : ''}`]), a: { 'data-change': 'anaPick' }, cls: 'grow-field' })}</div>
    <div class="kpis">${kpi({ label: 'Attempts', value: atts.length })}${kpi({ label: 'Average score', value: atts.length ? `${(atts.reduce((s, x) => s + (x.pct || 0), 0) / atts.length).toFixed(1)}%` : 'n/a' })}${kpi({ label: 'Pass rate', value: atts.length ? `${Math.round((atts.filter((x) => x.passed).length / atts.length) * 100)}%` : 'n/a', foot: `pass mark ${a.passPct}%` })}${kpi({ label: 'Awaiting grading', value: atts.filter((x) => x.status === 'needs_grading').length })}</div>
    <div class="grid g-main"><section class="panel flush"><div class="panel-head" style="padding:18px 20px 0"><h2>Question-level performance</h2><span class="sub">Lowest facility first</span></div>${table([
      { key: 'q', label: 'Question', render: (r) => `${esc(r.q.text.slice(0, 90))}${r.q.text.length > 90 ? '…' : ''}<div class="sub">${TYPE_LABEL[r.q.type]} · difficulty ${r.q.diff}</div>` },
      { key: 'n', label: 'Seen', r: true, render: (r) => r.n },
      { key: 'f', label: 'Fully correct', r: true, render: (r) => `${pill(`${r.facility}%`, r.facility < 40 ? 'p-bad' : r.facility < 65 ? 'p-warn' : 'p-ok', true)}` },
      { key: 'm', label: 'Avg marks', r: true, render: (r) => `${r.avgPct}%` },
    ], rows, { empty: 'No per-question data yet.' })}<p class="hint" style="padding:0 20px 16px">Questions below 40% may be ambiguous or under-taught; review the wording and the related lesson.</p></section>
    <section class="panel"><div class="panel-head"><h2>Score distribution</h2></div>${hbars(dist.map((d) => ({ ...d, display: `${d.value}` })))}</section></div></div>`;
}

function bankTab(ctx) {
  const F = ctx.local('bankF', { domain: 'all', type: 'all' });
  const list = QS(ctx).filter((q) => (F.domain === 'all' || q.domain === F.domain) && (F.type === 'all' || q.type === F.type));
  const usedIn = (id) => ASSESSMENTS.filter((a) => a.bank.includes(id)).map((a) => a.id);
  return `<div class="stack"><div class="toolbar">${select({ id: 'bk-d', label: 'Domain', value: F.domain, options: [['all', 'All'], ...DOMAINS.map((d) => [d.id, d.short])], a: { 'data-change': 'bankF', 'data-key': 'domain' } })}${select({ id: 'bk-t', label: 'Type', value: F.type, options: [['all', 'All'], ...Object.entries(TYPE_LABEL)], a: { 'data-change': 'bankF', 'data-key': 'type' } })}<div class="ml-auto">${ctx.can('assess.manage') ? btn('Add question', { act: 'addQuestion', cls: 'btn-primary', ic: 'plus' }) : ''}</div></div>
    <section class="panel flush">${table([
      { key: 't', label: 'Question', render: (q) => `${esc(q.text)}${q.authorId ? ` ${pill('New', 'p-info', true)}` : ''}` },
      { key: 'ty', label: 'Type', render: (q) => `${TYPE_LABEL[q.type]}${q.manual ? '<div class="sub">manual grading</div>' : ''}` },
      { key: 'd', label: 'Diff', c: true, render: (q) => q.diff },
      { key: 'u', label: 'Used in', render: (q) => usedIn(q.id).join(', ') || '<span class="muted">Bank only</span>' },
    ], list, { page: ctx.local('bankP', { p: 1 }).p, pageSize: 15, pageAct: 'bankPage' })}</section></div>`;
}

function questionEditor(ctx, d = {}, errs = {}) {
  ctx.openPanel(() => ({ title: 'Add question', sub: 'Added to the bank; attach it to an assessment configuration to use it', body: `<form data-form="question" class="stack" novalidate>
    <div class="form-grid">${select({ id: 'domain', label: 'Domain', value: d.domain || 'prog', options: DOMAINS.map((x) => [x.id, x.short]) })}${select({ id: 'type', label: 'Type', value: d.type || 'mcq', options: Object.entries(TYPE_LABEL).filter(([k]) => k !== 'code') })}${select({ id: 'diff', label: 'Difficulty', value: d.diff || 1, options: [[1, '1 · Easy'], [2, '2 · Medium'], [3, '3 · Hard']] })}</div>
    ${textarea({ id: 'text', label: 'Question', value: d.text || '', req: true, error: errs.text })}
    ${textarea({ id: 'options', label: 'Options (one per line, for choice questions)', value: d.options || '', error: errs.options })}
    ${input({ id: 'answer', label: 'Correct option number(s)', value: d.answer || '', error: errs.answer, hint: 'For example 2, or 1,3 for multiple select' })}
    ${textarea({ id: 'accept', label: 'Accepted answer patterns (short answer and SQL)', value: d.accept || '', hint: 'One regular expression per line, case-insensitive. Leave empty to grade manually.', rows: 2 })}
    ${textarea({ id: 'explain', label: 'Explanation shown after submission', value: d.explain || '', rows: 2 })}
    <div class="row"><button type="submit" class="btn btn-primary">Add to bank</button></div></form>` }));
}
list.actions.bankPage = (el, e, ctx) => { ctx.local('bankP').p = Number(el.dataset.id); ctx.rerender(); };

// ------------------------------------------------------------------ detail
export const detail = {
  perms: ['assess.take', 'assess.grade', 'assess.manage'],
  title: (ctx) => A(ctx.params.id)?.title || 'Assessment',
  render(ctx) {
    const a = A(ctx.params.id);
    if (!a) return empty('Assessment not found');
    const student = ctx.me.role === 'student';
    const st = student ? attemptStatus(ctx.s, ctx.me.id, a) : null;
    const eligible = !student || !a.course || !!enrollmentFor(ctx.s, ctx.me.id, a.course);
    const stu = student ? ctx.s.students.find((x) => x.id === ctx.me.id) : null;
    const mins = stu ? Math.round(timeAllowedMs(a, stu) / 60000) : a.minutes;
    return `<div class="page">${pageHead({ title: a.title, crumb: [['Assessments', '/assessments'], [a.title]], lede: a.course ? `For ${a.course}` : 'Placement diagnostic' })}
      <div class="grid g-main"><section class="panel stack"><h2>Before you start</h2>
        <ul class="ticks">
          <li>${icon('clock')}${mins} minutes${mins !== a.minutes ? ` (includes your ${stu.accommodation.extraTimePct}% extra-time accommodation)` : ''}. The timer keeps running if you leave; the attempt submits automatically at zero.</li>
          <li>${icon('layers')}${a.pick} questions drawn at random from a bank of ${a.bank.length}, ${a.mix ? `with a fixed mix of ${a.mix[1]} easy, ${a.mix[2]} medium and ${a.mix[3]} hard` : 'covering every difficulty in the bank'}. Marks per question: easy ${a.weights[1]}, medium ${a.weights[2]}, hard ${a.weights[3]}.</li>
          ${a.negative ? `<li>${icon('alert')}Negative marking: a wrong objective answer deducts ${a.negative * 100}% of that question's marks. Leaving it blank deducts nothing.</li>` : `<li>${icon('check')}No negative marking.</li>`}
          <li>${icon('refresh')}${a.attempts} attempt${a.attempts > 1 ? 's' : ''} allowed. Your answers save as you go, so a refresh or lost connection does not lose work.</li>
          <li>${icon('exam')}Pass mark ${a.passPct}%. Written answers are graded by an instructor; your result is provisional until then.</li>
          <li>${icon('lock')}The learning copilot is paused while an attempt is open.</li>
        </ul>${a.instructions ? `<div class="callout">${esc(a.instructions)}</div>` : ''}
        ${student ? (!eligible ? `<div class="callout bad">Enroll in ${a.course} to take this assessment.</div>` : st.open ? btn('Resume attempt', { href: `/assessments/take/${st.open.id}`, cls: 'btn-primary', ic: 'play' }) : st.left ? btn(`Start attempt ${st.used + 1} of ${a.attempts}`, { act: 'start', cls: 'btn-primary', ic: 'play' }) : '<div class="callout">No attempts left. Talk to your instructor if you need a re-attempt.</div>') : demoStaffNote()}
      </section>
      <section class="panel"><div class="panel-head"><h2>${student ? 'Your attempts' : 'Configuration'}</h2></div>${student ? (st.list.length ? `<div class="list">${st.list.map((x, i) => `<a class="item" href="#/assessments/${x.status === 'in_progress' ? 'take' : 'result'}/${x.id}"><span class="mono small">#${i + 1}</span><span class="grow min0"><span class="t small">${x.status === 'in_progress' ? 'In progress' : `${x.pct}%`}</span><br><span class="s">${fmtDateTime(x.submittedAt || x.startedAt)}${x.autoSubmitted ? ' · auto-submitted' : ''}</span></span>${x.status === 'needs_grading' ? pill('Awaiting grading', 'p-warn') : x.status === 'in_progress' ? pill('Open', 'p-info') : x.passed ? pill('Passed', 'p-ok') : pill('Not passed', 'p-bad')}</a>`).join('')}</div>` : empty('No attempts yet', '', { ic: 'exam' })) : `<dl class="dl small"><dt>Bank</dt><dd>${a.bank.join(', ')}</dd><dt>Draw</dt><dd>${a.pick} per attempt</dd><dt>Time</dt><dd>${a.minutes} min</dd><dt>Attempts</dt><dd>${a.attempts}</dd><dt>Negative</dt><dd>${a.negative * 100}%</dd><dt>Pass</dt><dd>${a.passPct}%</dd></dl>`}</section></div></div>`;
  },
  actions: {
    start(el, e, ctx) {
      const a = A(ctx.params.id);
      const stu = ctx.s.students.find((x) => x.id === ctx.me.id);
      ctx.confirm({ title: 'Start the timed attempt?', body: `The ${Math.round(timeAllowedMs(a, stu) / 60000)}-minute timer starts now and keeps running even if you close the tab.`, confirmLabel: 'Start now' }).then((ok) => {
        if (!ok) return;
        let att;
        if (ctx.commit('assess.start', (s) => { att = startAttempt(s, s.students.find((x) => x.id === ctx.me.id), a, QS(ctx), new Date()); }, { audit: { action: 'assessment.start', entity: 'attempt', entityId: a.id, kind: 'data' } }) === true) ctx.nav(`/assessments/take/${att.id}`);
      });
    },
  },
};
const demoStaffNote = () => `<p class="small muted">Staff see the configuration. Switch to the Student role to take this assessment.</p>`;

// ------------------------------------------------------------------ take
export const take = {
  perms: ['assess.take'],
  title: () => 'Assessment in progress',
  render(ctx) {
    const att = ctx.s.attempts.find((x) => x.id === ctx.params.attempt && x.studentId === ctx.me.id);
    if (!att) return empty('Attempt not found', 'It may belong to another learner.', { ic: 'lock' });
    if (att.status !== 'in_progress') return `<div class="page">${empty('This attempt is submitted', '', { ic: 'check', action: btn('See results', { href: `/assessments/result/${att.id}`, cls: 'btn-primary', sm: true }) })}</div>`;
    const a = A(att.assessmentId);
    const qs = att.questionIds.map((id) => QS(ctx).find((q) => q.id === id));
    const L = ctx.local(`take:${att.id}`, { i: 0 });
    const q = qs[L.i];
    const ans = att.answers[q.id];
    const answered = (x) => { const v = att.answers[x.id]; return !(v === undefined || v === '' || (Array.isArray(v) && !v.length) || (x.type === 'code' && !v?.code?.trim())); };
    let field = '';
    if (q.type === 'mcq' || q.type === 'multi') field = `<div class="stack" style="--gap:8px">${q.options.map((o, oi) => { const sel = q.type === 'multi' ? (ans || []).includes(oi) : ans === oi; return `<label class="opt"><input type="${q.type === 'multi' ? 'checkbox' : 'radio'}" name="ans" ${sel ? 'checked' : ''} data-change="answer" data-o="${oi}"><span>${esc(o)}</span></label>`; }).join('')}${ans !== undefined && q.type === 'mcq' ? `<button type="button" class="link" data-act="clearAns">Clear my answer</button>` : ''}</div>`;
    else if (q.type === 'short' || q.type === 'sql') field = `<textarea class="textarea ${q.type === 'sql' ? 'mono' : ''}" id="ans-text" rows="${q.type === 'sql' ? 6 : 4}" data-input="answerText" aria-label="Your answer" placeholder="${q.type === 'sql' ? 'SELECT …' : 'Your answer'}">${esc(ans || '')}</textarea>`;
    else if (q.type === 'code') { const p = problemById(ctx.s, q.problem); field = `<div class="stack" style="--gap:8px"><p class="small">${esc(p.statement)}</p><textarea class="textarea mono code-answer" id="ans-code" rows="12" data-input="answerCode" spellcheck="false" aria-label="Your JavaScript code">${esc(ans?.code || `function ${p.fn}(${p.params.join(', ')}) {\n  \n}\n`)}</textarea><div class="row">${btn('Run sample tests', { act: 'runSample', sm: true, ic: 'play' })}<span class="small muted" id="sample-out">Hidden tests run when you submit.</span></div></div>`; }
    const unanswered = qs.filter((x) => !answered(x)).length;
    return `<div class="page exam-page">
      <div class="exam-bar" role="region" aria-label="Attempt status"><div class="min0"><b>${esc(a.title)}</b><div class="small muted">Answers save automatically</div></div><div class="exam-timer mono" id="exam-timer" role="timer" aria-live="off"></div>${btn('Submit attempt', { act: 'submit', cls: 'btn-primary', ic: 'check' })}</div>
      <div class="exam">
        <nav class="panel exam-nav" aria-label="Questions"><div class="eyebrow">Questions</div><div class="qgrid">${qs.map((x, i) => `<button type="button" class="qbtn ${i === L.i ? 'cur' : ''} ${answered(x) ? 'done' : ''} ${(att.flagged || []).includes(x.id) ? 'flag' : ''}" data-act="go" data-id="${i}" aria-label="Question ${i + 1}${answered(x) ? ', answered' : ''}${(att.flagged || []).includes(x.id) ? ', flagged' : ''}" ${i === L.i ? 'aria-current="step"' : ''}>${i + 1}</button>`).join('')}</div><p class="hint" style="margin-top:10px">${qs.length - unanswered} of ${qs.length} answered</p></nav>
        <section class="panel stack" aria-labelledby="q-title" style="--gap:16px">
          <div class="spread"><span class="eyebrow">Question ${L.i + 1} of ${qs.length} · ${TYPE_LABEL[q.type]} · ${marksFor(a, q)} mark${marksFor(a, q) > 1 ? 's' : ''}${a.negative && ['mcq', 'multi'].includes(q.type) ? ` · −${(a.negative * marksFor(a, q)).toFixed(2)} if wrong` : ''}</span>${btn((att.flagged || []).includes(q.id) ? 'Flagged' : 'Flag for review', { act: 'flag', sm: true, cls: 'btn-quiet', ic: 'flag', attrs: { 'aria-pressed': String((att.flagged || []).includes(q.id)) } })}</div>
          <h2 id="q-title" style="font-size:1.12rem;font-family:var(--f-body);font-weight:600;line-height:1.45">${esc(q.text)}</h2>
          ${q.type === 'multi' ? '<p class="small muted">Select all that apply. Partial selections score zero.</p>' : ''}
          ${field}
          <div class="spread">${btn('Previous', { act: 'go', ic: 'back', attrs: { 'data-id': L.i - 1 }, disabled: L.i === 0 })}${btn(L.i === qs.length - 1 ? 'Review and submit' : 'Next', { act: L.i === qs.length - 1 ? 'submit' : 'go', cls: 'btn-primary', attrs: { 'data-id': L.i + 1 } })}</div>
        </section>
      </div></div>`;
  },
  mount(root, ctx) {
    const att = ctx.s.attempts.find((x) => x.id === ctx.params.attempt);
    if (!att || att.status !== 'in_progress') return;
    const el = root.querySelector('#exam-timer');
    clearInterval(timerHandle);
    const tick = () => {
      const left = new Date(att.deadline).getTime() - Date.now();
      if (!document.body.contains(el)) { clearInterval(timerHandle); return; }
      if (left <= 0) { clearInterval(timerHandle); el.textContent = '0:00'; finalize(ctx, att, true); return; }
      const m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
      el.textContent = `${m}:${String(s).padStart(2, '0')}`;
      el.classList.toggle('low', left < 120000);
      if (left < 60000 && left > 59000) ctx.toast('One minute left. Your answers are saved.');
    };
    tick(); timerHandle = setInterval(tick, 1000);
    unloadGuard = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', unloadGuard);
  },
  unmount() { clearInterval(timerHandle); if (unloadGuard) window.removeEventListener('beforeunload', unloadGuard); },
  onStoreChange(ctx, d) { return !['assess.answer'].includes(d.label); },
  actions: {
    go(el, e, ctx) { const n = Number(el.dataset.id); const att = cur(ctx); if (n >= 0 && n < att.questionIds.length) { ctx.local(`take:${att.id}`).i = n; ctx.rerender(); } },
    answer(el, e, ctx) {
      const att = cur(ctx); const q = currentQ(ctx, att); const o = Number(el.dataset.o);
      saveAnswer(ctx, att, q.id, q.type === 'multi' ? (() => { const s = new Set(att.answers[q.id] || []); el.checked ? s.add(o) : s.delete(o); return [...s].sort(); })() : o, true);
    },
    clearAns(el, e, ctx) { const att = cur(ctx); const q = currentQ(ctx, att); saveAnswer(ctx, att, q.id, undefined, true); },
    answerText(el, e, ctx) { const att = cur(ctx); const q = currentQ(ctx, att); clearTimeout(ansT); ansT = setTimeout(() => saveAnswer(ctx, att, q.id, el.value, false), 350); },
    answerCode(el, e, ctx) { const att = cur(ctx); const q = currentQ(ctx, att); clearTimeout(ansT); ansT = setTimeout(() => saveAnswer(ctx, att, q.id, { code: el.value }, false), 350); },
    flag(el, e, ctx) { const att = cur(ctx); const q = currentQ(ctx, att); store.commit('assess.flag', () => { att.flagged = (att.flagged || []).includes(q.id) ? att.flagged.filter((x) => x !== q.id) : [...(att.flagged || []), q.id]; }); },
    async runSample(el, e, ctx) {
      const att = cur(ctx); const q = currentQ(ctx, att); const p = problemById(ctx.s, q.problem);
      const code = document.querySelector('#ans-code').value; const out = document.querySelector('#sample-out');
      out.textContent = 'Running…';
      const r = await runJS({ code, fn: p.fn, cases: p.tests.slice(0, 2).map(([args, expected]) => ({ args, expected })) });
      out.textContent = r.status === 'Accepted' ? 'Both sample tests pass.' : `${r.status}${r.error ? `: ${r.error}` : `: ${r.results.filter((x) => x.passed).length}/2 samples pass`}`;
    },
    submit(el, e, ctx) {
      const att = cur(ctx);
      const qs = att.questionIds.map((id) => QS(ctx).find((q) => q.id === id));
      const un = qs.filter((x) => { const v = att.answers[x.id]; return v === undefined || v === '' || (Array.isArray(v) && !v.length) || (x.type === 'code' && !v?.code?.trim()); }).length;
      const fl = (att.flagged || []).length;
      ctx.confirm({ title: 'Submit this attempt?', body: `${un ? `<b>${un} question${un > 1 ? 's are' : ' is'} unanswered.</b> ` : 'All questions answered. '}${fl ? `${fl} flagged for review. ` : ''}You cannot change answers after submitting.`, confirmLabel: 'Submit attempt' }).then((ok) => ok && finalize(ctx, att, false));
    },
  },
};
let ansT;
const cur = (ctx) => ctx.s.attempts.find((x) => x.id === ctx.params.attempt);
const currentQ = (ctx, att) => QS(ctx).find((q) => q.id === att.questionIds[ctx.local(`take:${att.id}`).i]);
function saveAnswer(ctx, att, qid, value, rerender) {
  store.commit(rerender ? 'assess.pick' : 'assess.answer', () => { if (value === undefined) delete att.answers[qid]; else att.answers[qid] = value; });
}
async function finalize(ctx, att, auto) {
  if (att.status !== 'in_progress') return;
  const a = A(att.assessmentId);
  clearInterval(timerHandle);
  // Judge coding answers in the sandbox before scoring.
  for (const id of att.questionIds) {
    const q = QS(ctx).find((x) => x.id === id);
    if (q.type !== 'code' || !att.answers[id]?.code) continue;
    const p = problemById(ctx.s, q.problem);
    const r = await runJS({ code: att.answers[id].code, fn: p.fn, cases: p.tests.map(([args, expected]) => ({ args, expected })) });
    att.answers[id] = { ...att.answers[id], result: { passed: r.results.filter((x) => x.passed).length, total: p.tests.length, status: r.status } };
  }
  let res;
  const ok = ctx.commit('assess.submit', (s) => { res = submitAttempt(s, att, a, QS(ctx), new Date(), { auto }); if (res.pending) ctx.notify(ctx.me.id, 'result', 'Attempt submitted for grading', `${a.title}: ${res.pending} answer(s) need an instructor.`, `/assessments/result/${att.id}`); else ctx.notify(ctx.me.id, 'result', `Assessment result: ${res.pct}%`, `${a.title}: ${res.passed ? 'passed' : 'not passed'}.`, `/assessments/result/${att.id}`); }, { audit: { action: auto ? 'assessment.autosubmit' : 'assessment.submit', entity: 'attempt', entityId: att.id, detail: `${a.id}`, kind: 'data' } });
  if (unloadGuard) window.removeEventListener('beforeunload', unloadGuard);
  if (ok === true) { ctx.toast(auto ? 'Time is up. Your attempt was submitted automatically.' : 'Attempt submitted'); ctx.nav(`/assessments/result/${att.id}`); }
}

// ------------------------------------------------------------------ result
export const result = {
  perms: ['assess.take', 'assess.grade', 'assess.manage'],
  title: () => 'Assessment result',
  render(ctx) {
    const att = ctx.s.attempts.find((x) => x.id === ctx.params.attempt);
    if (!att || (ctx.me.role === 'student' && att.studentId !== ctx.me.id) || (ctx.me.role !== 'student' && !visibleStudents(ctx.s, ctx.me).some((x) => x.id === att.studentId) && !ctx.can('assess.manage'))) return empty('Result not available', 'You can only see results you have access to.', { ic: 'lock' });
    const a = A(att.assessmentId);
    if (att.seeded) return `<div class="page">${pageHead({ title: a.title, crumb: [['Assessments', '/assessments'], ['Result']] })}<section class="panel"><div class="stat-line"><div><b>${att.pct}%</b><span>Score</span></div><div><b>${att.passed ? 'Passed' : 'Not passed'}</b><span>Pass mark ${a.passPct}%</span></div><div><b>${fmtShort(att.submittedAt)}</b><span>Submitted</span></div></div><p class="small muted" style="margin-top:12px">This is an imported historical result; per-question answers were not migrated.</p></section></div>`;
    const r = scoreAttempt(a, QS(ctx), att);
    return `<div class="page">${pageHead({ title: a.title, crumb: [['Assessments', '/assessments'], ['Result']], lede: `${esc(displayName(ctx.s, att.studentId))} · submitted ${fmtDateTime(att.submittedAt)}${att.autoSubmitted ? ' (auto-submitted when time ran out)' : ''}` })}
      <section class="panel"><div class="stat-line"><div><b>${r.pct}%</b><span>Score (${r.score} of ${r.max} marks)</span></div><div><b>${r.pending ? 'Provisional' : r.passed ? 'Passed' : 'Not passed'}</b><span>Pass mark ${a.passPct}%</span></div><div><b>${r.per.filter((p) => p.status === 'correct').length}/${r.per.length}</b><span>Fully correct</span></div><div><b>${r.pending}</b><span>Awaiting manual grading</span></div></div>${r.pending ? '<div class="callout warn small" style="margin-top:12px">Some answers are with an instructor. Your final score will update here and you will be notified.</div>' : ''}</section>
      <section class="stack">${att.questionIds.map((id, i) => { const q = QS(ctx).find((x) => x.id === id); const p = r.per[i]; const ans = att.answers[id]; return `<article class="panel stack result-q ${p.status}" style="--gap:8px"><div class="spread"><span class="eyebrow">Q${i + 1} · ${TYPE_LABEL[q.type]}</span>${pill(`${p.status === 'pending' ? 'Pending' : p.status} · ${Math.round(p.marks * 100) / 100}/${p.max}`, p.status === 'correct' ? 'p-ok' : p.status === 'pending' ? 'p-warn' : p.status === 'partial' ? 'p-info' : p.status === 'blank' ? 'p-mute' : 'p-bad')}</div><b>${esc(q.text)}</b>
        ${q.options ? `<ul class="optlist">${q.options.map((o, oi) => { const right = q.type === 'multi' ? q.answer.includes(oi) : q.answer === oi; const sel = q.type === 'multi' ? (ans || []).includes(oi) : ans === oi; return `<li class="${right ? 'right' : ''} ${sel && !right ? 'wrong' : ''}">${sel ? icon('checkSq') : icon('dot')}${esc(o)}${right ? ' <span class="xs">(correct)</span>' : ''}</li>`; }).join('')}</ul>` : q.type === 'code' ? `<pre class="md-code"><code>${esc(ans?.code || '(no code)')}</code></pre>` : `<div class="answer-box ${q.type === 'sql' ? 'mono' : ''}">${esc(ans || '(blank)')}</div>`}
        ${p.feedback ? `<p class="small muted">${esc(p.feedback)}</p>` : ''}${p.gradedBy ? `<p class="xs muted">Graded by ${esc(displayName(ctx.s, p.gradedBy))}</p>` : ''}</article>`; }).join('')}</section></div>`;
  },
};

// ------------------------------------------------------------------ grade
export const grade = {
  perms: ['assess.grade'],
  title: () => 'Grade attempt',
  render(ctx) {
    const att = ctx.s.attempts.find((x) => x.id === ctx.params.attempt);
    if (!att) return empty('Attempt not found');
    const a = A(att.assessmentId);
    const r = scoreAttempt(a, QS(ctx), att);
    const pend = r.per.filter((p) => p.status === 'pending');
    return `<div class="page">${pageHead({ title: `Grade: ${a.title}`, crumb: [['Assessments', '/assessments'], ['Grading']], lede: `${esc(displayName(ctx.s, att.studentId))} · submitted ${fmtDateTime(att.submittedAt)} · current ${r.pct}% with ${r.pending} pending` })}
      ${pend.length ? pend.map((p) => { const q = QS(ctx).find((x) => x.id === p.id); return `<form class="panel stack" data-form="grade" style="--gap:10px"><input type="hidden" name="qid" value="${q.id}"><div class="spread"><span class="eyebrow">${TYPE_LABEL[q.type]} · up to ${p.max} marks</span></div><b>${esc(q.text)}</b><div class="answer-box ${q.type === 'sql' ? 'mono' : ''}">${esc(att.answers[q.id] || '(blank)')}</div>${q.rubric ? `<div class="callout small"><b>Rubric:</b> ${esc(q.rubric)}</div>` : q.explain ? `<div class="callout small"><b>Reference:</b> ${esc(q.explain)}</div>` : ''}<div class="form-grid">${input({ id: `marks-${q.id}`, label: `Marks (0 to ${p.max})`, type: 'number', value: '', req: true, a: { name: 'marks', min: 0, max: p.max, step: '0.5' } })}${input({ id: `note-${q.id}`, label: 'Feedback to learner', value: '', a: { name: 'note' } })}</div><div class="row"><button class="btn btn-primary" type="submit">Save grade</button></div></form>`; }).join('') : `<section class="panel">${empty('All answers graded', `Final score ${r.pct}% (${r.passed ? 'passed' : 'not passed'}).`, { ic: 'check', action: btn('Back to queue', { href: '/assessments', sm: true }) })}</section>`}</div>`;
  },
  forms: {
    grade(form, d, ctx) {
      const att = ctx.s.attempts.find((x) => x.id === ctx.params.attempt);
      const a = A(att.assessmentId);
      const marks = d.marks === '' ? NaN : Number(d.marks);
      let res;
      const ok = ctx.commit('assess.grade', (s) => { res = applyManualGrade(s, att, a, QS(ctx), d.qid, marks, d.note, ctx.me.id); if (!res.pending) ctx.notify(att.studentId, 'result', `Assessment graded: ${res.pct}%`, `${a.title} is fully graded.`, `/assessments/result/${att.id}`); }, { audit: { action: 'assessment.grade', entity: 'attempt', entityId: att.id, detail: `${d.qid}: ${marks}` } });
      if (ok === true) ctx.toast(res.pending ? 'Grade saved' : `All graded. Final score ${res.pct}%`);
    },
  },
};
