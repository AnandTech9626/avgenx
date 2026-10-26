// Assignment and project lifecycle: learner submissions, reviewer queue, rubric scoring,
// revision loop, version history, integrity and repository integration points.
import { esc, fmtDate, fmtDateTime, fmtShort, relDays, iso, uid } from '../core/util.js';
import { icon } from '../core/icons.js';
import { pageHead, pill, btn, empty, tabs, table, select, input, textarea, stepper, timeline, kpi, avatar, bar } from '../core/ui.js';
import { STATE_LABEL, STATE_PILL, ORDER, allowedEvents, transition, TRANSITIONS, totalScore, latePenalty, publishAssignment } from '../domain/projects.js';
import { teachingCourseIds, displayName, visibleStudents } from '../domain/scope.js';

const isReviewer = (ctx) => ctx.can('projects.review');
const asg = (ctx, id) => ctx.s.assignments.find((a) => a.id === id);
const STEPS = ['Assigned', 'In progress', 'Submitted', 'Under review', 'Revision', 'Approved'];
const stepIdx = (p) => ORDER.indexOf(p.state);

export const projectsList = {
  perms: ['projects.submit', 'projects.review'],
  title: () => 'Projects',
  render(ctx) {
    if (!isReviewer(ctx)) return learnerList(ctx);
    const T = ctx.local('prT', { tab: 'queue', state: 'all', course: 'all' });
    const mine = ctx.me.role === 'instructor' || ctx.me.role === 'ta' || ctx.me.role === 'mentor' ? new Set(teachingCourseIds(ctx.s, ctx.me)) : null;
    const scoped = ctx.s.projects.filter((p) => !mine || mine.has(p.courseId));
    const queue = scoped.filter((p) => ['submitted', 'under_review'].includes(p.state)).sort((a, b) => (a.submittedAt < b.submittedAt ? -1 : 1));
    const courses = [...new Set(scoped.map((p) => p.courseId))];
    let body = '';
    if (T.tab === 'queue') body = `<section class="panel flush">${table(rowsCols(ctx), queue, { rowAct: 'open', rowId: (p) => p.id, empty: 'Review queue is clear.' })}</section>`;
    else if (T.tab === 'all') {
      const list = scoped.filter((p) => (T.state === 'all' || p.state === T.state) && (T.course === 'all' || p.courseId === T.course));
      body = `<div class="stack"><div class="toolbar">${select({ id: 'pr-state', label: 'State', value: T.state, options: [['all', 'All states'], ...ORDER.map((s) => [s, STATE_LABEL[s]])], a: { 'data-change': 'f', 'data-key': 'state' } })}${select({ id: 'pr-course', label: 'Course', value: T.course, options: [['all', 'All courses'], ...courses.map((c) => [c, c])], a: { 'data-change': 'f', 'data-key': 'course' } })}</div><section class="panel flush">${table(rowsCols(ctx), list, { rowAct: 'open', rowId: (p) => p.id, page: T.page || 1, pageSize: 20, pageAct: 'page', empty: 'No projects match.' })}</section></div>`;
    } else body = assignmentsTab(ctx, mine);
    const overdue = scoped.filter((p) => ['assigned', 'in_progress', 'revision'].includes(p.state) && p.due < iso(ctx.now)).length;
    return `<div class="page">${pageHead({ title: 'Projects and assignments', lede: 'Review learner work against the rubric, request revisions, and approve for portfolios and certificates.' })}
      <div class="kpis">${kpi({ label: 'Waiting for review', value: queue.length, alert: queue.length > 8 })}${kpi({ label: 'Revision requested', value: scoped.filter((p) => p.state === 'revision').length })}${kpi({ label: 'Approved', value: scoped.filter((p) => p.state === 'approved').length })}${kpi({ label: 'Overdue (not submitted)', value: overdue, alert: overdue > 0 })}</div>
      ${tabs([['queue', 'Review queue', queue.length], ['all', 'All work items', scoped.length], ['assign', 'Assignments']], T.tab, 'tab')}${body}</div>`;
  },
  actions: {
    tab(el, e, ctx) { ctx.local('prT').tab = el.dataset.id; ctx.rerender(); },
    f(el, e, ctx) { const T = ctx.local('prT'); T[el.dataset.key] = el.value; T.page = 1; ctx.rerender(); },
    page(el, e, ctx) { ctx.local('prT').page = Number(el.dataset.id); ctx.rerender(); },
    open(el, e, ctx) { ctx.nav(`/projects/${el.dataset.id}`); },
    newAssignment(el, e, ctx) { assignmentEditor(ctx); },
    publishA(el, e, ctx) {
      const a = asg(ctx, el.dataset.id);
      const n = ctx.s.enrollments.filter((x) => x.courseId === a.courseId).length;
      ctx.confirm({ title: `Publish "${a.title}"?`, body: `This assigns it to ${n} enrolled learner${n === 1 ? '' : 's'} in ${a.courseId} and starts their due dates.`, confirmLabel: 'Publish and assign' }).then((ok) => { if (!ok) return; let made = 0; ctx.commit('assignment.publish', (s) => { const x = s.assignments.find((y) => y.id === a.id); made = publishAssignment(s, x, ctx.now); s.enrollments.filter((en) => en.courseId === a.courseId).forEach((en) => ctx.notify(en.studentId, 'deadline', `New assignment: ${a.title}`, `Due in ${a.dueOffset} days.`, '/projects')); }, { audit: { action: 'assignment.publish', entity: 'assignment', entityId: a.id, detail: a.title } }) === true && ctx.toast(`Published and assigned to ${made} learners`); });
    },
  },
  forms: {
    assignment(form, d, ctx) {
      const errs = {};
      if ((d.title || '').trim().length < 5) errs.title = 'At least 5 characters';
      if (!(Number(d.dueOffset) >= 1 && Number(d.dueOffset) <= 120)) errs.dueOffset = '1 to 120 days';
      if ((d.brief || '').trim().length < 20) errs.brief = 'Describe the deliverable (20+ characters)';
      if (Object.keys(errs).length) return assignmentEditor(ctx, d, errs);
      const rec = { id: `AS-${uid('x').slice(2, 9).toUpperCase()}`, courseId: d.courseId, title: d.title.trim(), kind: d.kind, brief: d.brief.trim(), dueOffset: Number(d.dueOffset), rubric: [{ id: 'func', label: 'Functionality and correctness', max: 40 }, { id: 'code', label: 'Code quality and structure', max: 25 }, { id: 'test', label: 'Testing', max: 15 }, { id: 'docs', label: 'Documentation and demo', max: 20 }], late: { graceDays: Number(d.grace || 0), penaltyPct: Number(d.penalty || 0) }, status: 'draft', createdBy: ctx.me.id, createdAt: new Date().toISOString() };
      ctx.commit('assignment.create', (s) => { s.assignments.push(rec); }, { ok: 'Assignment saved as draft', audit: { action: 'assignment.create', entity: 'assignment', entityId: rec.id, detail: rec.title } });
      document.querySelector('#drawer [data-close]')?.click();
    },
  },
};

function rowsCols(ctx) {
  return [
    { key: 's', label: 'Learner', render: (p) => `<div class="row nowrap">${avatar(displayName(ctx.s, p.studentId), 'sm')}<div class="min0"><b>${esc(displayName(ctx.s, p.studentId))}</b><div class="sub">${p.studentId}</div></div></div>` },
    { key: 'a', label: 'Assignment', render: (p) => `${esc(asg(ctx, p.assignmentId)?.title || p.assignmentId)}<div class="sub">${p.courseId} · ${asg(ctx, p.assignmentId)?.kind}</div>` },
    { key: 'st', label: 'State', render: (p) => pill(STATE_LABEL[p.state], STATE_PILL[p.state]) },
    { key: 'd', label: 'Due / submitted', render: (p) => `${fmtShort(p.due)}${p.submittedAt ? `<div class="sub">sent ${fmtShort(p.submittedAt)}${latePenalty(asg(ctx, p.assignmentId), p).daysLate ? ` · ${latePenalty(asg(ctx, p.assignmentId), p).daysLate}d late` : ''}</div>` : ''}` },
    { key: 'r', label: 'Reviewer', render: (p) => esc(displayName(ctx.s, p.reviewerId)) },
  ];
}

function assignmentsTab(ctx, mine) {
  const list = ctx.s.assignments.filter((a) => !mine || mine.has(a.courseId));
  return `<div class="stack"><div class="row">${ctx.can('projects.manage') ? btn('New assignment', { act: 'newAssignment', cls: 'btn-primary', ic: 'plus' }) : '<span class="small muted">Assignment authoring needs the "Create and publish assignments" permission.</span>'}</div><section class="panel flush">${table([
    { key: 't', label: 'Assignment', render: (a) => `<b>${esc(a.title)}</b><div class="sub">${a.courseId} · ${a.kind} · due ${a.dueOffset} days after publishing</div>` },
    { key: 's', label: 'Status', render: (a) => pill(a.status === 'published' ? 'Published' : 'Draft', a.status === 'published' ? 'p-ok' : 'p-mute') },
    { key: 'n', label: 'Work items', r: true, render: (a) => ctx.s.projects.filter((p) => p.assignmentId === a.id).length },
    { key: 'l', label: 'Late policy', render: (a) => `${a.late.graceDays}-day grace, ${a.late.penaltyPct}% per day` },
    { key: 'x', label: '', r: true, render: (a) => (a.status === 'draft' && ctx.can('projects.manage') ? btn('Publish', { act: 'publishA', sm: true, cls: 'btn-primary', attrs: { 'data-id': a.id } }) : '') },
  ], list, { empty: 'No assignments yet.' })}</section></div>`;
}

function assignmentEditor(ctx, d = {}, errs = {}) {
  const courses = ctx.me.role === 'instructor' ? ctx.s.courses.filter((c) => c.instructorId === ctx.me.id) : ctx.s.courses.filter((c) => c.status === 'published');
  ctx.openPanel(() => ({ title: 'New assignment', sub: 'Saved as a draft. Publishing assigns it to every enrolled learner.', body: `<form data-form="assignment" class="stack" novalidate>
    ${select({ id: 'courseId', label: 'Course', value: d.courseId || courses[0]?.id, options: courses.map((c) => [c.id, `${c.id} · ${c.title}`]) })}
    ${input({ id: 'title', label: 'Title', value: d.title || '', req: true, error: errs.title })}
    ${select({ id: 'kind', label: 'Kind', value: d.kind || 'assignment', options: [['assignment', 'Assignment'], ['project', 'Project'], ['capstone', 'Capstone']] })}
    ${textarea({ id: 'brief', label: 'Brief', value: d.brief || '', req: true, error: errs.brief, rows: 4 })}
    <div class="form-grid">${input({ id: 'dueOffset', label: 'Due (days after publishing)', type: 'number', value: d.dueOffset || 14, error: errs.dueOffset })}${input({ id: 'grace', label: 'Grace days', type: 'number', value: d.grace ?? 2 })}${input({ id: 'penalty', label: 'Late penalty % per day', type: 'number', value: d.penalty ?? 10 })}</div>
    <p class="hint">Uses the standard four-criterion rubric (100 marks). Capstones add a live demonstration criterion when published from the course builder.</p>
    <div class="row"><button class="btn btn-primary" type="submit">Save draft</button></div></form>` }));
}

function learnerList(ctx) {
  const mine = ctx.s.projects.filter((p) => p.studentId === ctx.me.id);
  const groups = [['Needs your action', mine.filter((p) => ['assigned', 'in_progress', 'revision'].includes(p.state))], ['With reviewers', mine.filter((p) => ['submitted', 'under_review'].includes(p.state))], ['Approved', mine.filter((p) => p.state === 'approved')]];
  return `<div class="page">${pageHead({ title: 'My projects', lede: 'Submit a repository link, respond to reviewer feedback, and publish approved work to your portfolio.' })}
    ${mine.length ? groups.map(([label, list]) => (list.length ? `<section class="stack" style="--gap:10px"><h2>${label} <span class="mono small muted">${list.length}</span></h2><div class="grid g-auto" style="--min:300px">${list.sort((a, b) => (a.due < b.due ? -1 : 1)).map((p) => { const a = asg(ctx, p.assignmentId); const late = p.due < iso(ctx.now) && ['assigned', 'in_progress', 'revision'].includes(p.state); return `<a class="card" href="#/projects/${p.id}" style="padding:16px"><div class="spread"><span class="mono small muted">${p.courseId} · ${a.kind}</span>${pill(STATE_LABEL[p.state], STATE_PILL[p.state])}</div><b>${esc(a.title)}</b><div><div class="spread xs muted"><span>Step ${stepIdx(p) + 1} of ${STEPS.length}</span><span>${esc(STEPS[stepIdx(p)])}</span></div>${bar(((stepIdx(p) + 1) / STEPS.length) * 100, p.state === 'revision' ? 'bad' : '', 'Project lifecycle progress')}</div><div class="small ${late ? 'error-text' : 'muted'}">${p.state === 'approved' ? `Approved · ${totalScore(a, p).final}/${totalScore(a, p).max}` : `Due ${fmtDate(p.due)} (${relDays(p.due, ctx.now)})`}</div></a>`; }).join('')}</div></section>` : '')).join('') : empty('No projects yet', 'Projects are assigned as you progress through your courses.', { ic: 'folder' })}</div>`;
}

export const projectDetail = {
  perms: ['projects.submit', 'projects.review'],
  title: (ctx) => asg(ctx, ctx.s.projects.find((p) => p.id === ctx.params.id)?.assignmentId)?.title || 'Project',
  render(ctx) {
    const p = ctx.s.projects.find((x) => x.id === ctx.params.id);
    const allowed = p && (ctx.me.role === 'student' ? p.studentId === ctx.me.id : visibleStudents(ctx.s, ctx.me).some((s) => s.id === p.studentId) || ['director', 'superadmin'].includes(ctx.me.role));
    if (!allowed) return empty('Project not found', 'It may belong to another learner or a course outside your scope.', { ic: 'lock' });
    const a = asg(ctx, p.assignmentId);
    const learner = ctx.me.role === 'student';
    const who = learner ? 'learner' : 'reviewer';
    const events = isReviewer(ctx) && !learner ? allowedEvents(p, 'reviewer') : learner ? allowedEvents(p, 'learner') : [];
    const score = totalScore(a, p);
    const late = latePenalty(a, p);
    const F = ctx.local(`pr:${p.id}`, { errs: {} });
    const submitForm = learner && events.some((e) => ['submit', 'resubmit'].includes(e)) ? `<form class="panel stack" data-form="submit" novalidate><h2>${p.state === 'revision' ? 'Resubmit after revision' : 'Submit your work'}</h2>
      ${input({ id: 'repo', label: 'Repository URL', value: p.repo || '', req: true, error: F.errs.repo, hint: 'Public or shared GitHub, GitLab or Bitbucket repository.', a: { placeholder: 'https://github.com/you/project', inputmode: 'url' } })}
      ${input({ id: 'demo', label: 'Live demo or video URL (optional)', value: p.demo || '', error: F.errs.demo, a: { placeholder: 'https://' } })}
      <div class="field"><label for="files">Attachments (optional)</label><input class="input" type="file" id="files" name="files" multiple accept=".pdf,.png,.jpg,.jpeg,.md,.zip"><span class="hint">PDF, PNG, JPG, Markdown or ZIP up to 10 MB each. File storage needs the storage integration; this demo records names and sizes only.</span>${F.errs.files ? `<span class="error-text">${esc(F.errs.files)}</span>` : ''}</div>
      ${textarea({ id: 'note', label: 'Note to reviewer', value: '', rows: 2, error: F.errs.note })}
      <div class="row"><button type="submit" class="btn btn-primary">${p.state === 'revision' ? 'Resubmit' : 'Submit for review'}</button>${late.daysLate || p.due < iso(ctx.now) ? `<span class="small error-text">Past due. Late policy: ${a.late.graceDays}-day grace, then ${a.late.penaltyPct}% per day (max 50%).</span>` : ''}</div></form>` : '';
    const reviewForm = !learner && events.includes('approve') ? `<form class="panel stack" data-form="approve" novalidate><h2>Rubric scoring</h2>${a.rubric.map((r) => input({ id: `sc-${r.id}`, label: `${r.label} (0 to ${r.max})`, type: 'number', value: p.scores?.[r.id] ?? '', error: F.errs[r.id], a: { name: `sc-${r.id}`, min: 0, max: r.max } })).join('')}${late.penaltyPct ? `<div class="callout warn small">Submitted ${late.daysLate} days late: a ${late.penaltyPct}% penalty applies to the total.</div>` : ''}${textarea({ id: 'comment', label: 'Feedback to learner', rows: 3 })}<div class="row"><button class="btn btn-primary" type="submit">Approve</button><button type="button" class="btn btn-danger" data-act="revise">Request revision</button></div></form>` : '';
    return `<div class="page">${pageHead({ title: a.title, crumb: [['Projects', '/projects'], [a.title]], lede: `${esc(displayName(ctx.s, p.studentId))} · ${p.courseId} · ${a.kind}`, actions: pill(STATE_LABEL[p.state], STATE_PILL[p.state]) })}
      <section class="panel">${stepper(STEPS, stepIdx(p), { bad: p.state === 'revision' ? 4 : -1 })}</section>
      <div class="grid g-main"><div class="stack">
        <section class="panel stack" style="--gap:10px"><h2>Brief</h2><p>${esc(a.brief)}</p><dl class="dl small"><dt>Due</dt><dd>${fmtDate(p.due)} (${relDays(p.due, ctx.now)})</dd><dt>Late policy</dt><dd>${a.late.graceDays}-day grace, then ${a.late.penaltyPct}% per day, capped at 50%</dd><dt>Reviewer</dt><dd>${esc(displayName(ctx.s, p.reviewerId))}</dd></dl>
          <div class="row">${learner ? events.filter((e) => ['start', 'withdraw'].includes(e)).map((e) => btn(TRANSITIONS[e].label, { act: 'go', attrs: { 'data-id': e }, cls: e === 'start' ? 'btn-primary' : 'btn-ghost', sm: true })).join('') : events.filter((e) => e === 'startReview').map((e) => btn('Start review', { act: 'go', attrs: { 'data-id': e }, cls: 'btn-primary', sm: true })).join('')}</div></section>
        ${submitForm}${reviewForm}
        <section class="panel"><div class="panel-head"><h2>Rubric</h2>${p.state === 'approved' ? pill(`${score.final}/${score.max}${score.penaltyPct ? ` after ${score.penaltyPct}% late penalty` : ''}`, 'p-ok', true) : ''}</div><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Criterion</th><th class="r">Max</th><th class="r">Score</th></tr></thead><tbody>${a.rubric.map((r) => `<tr><td>${esc(r.label)}</td><td class="r">${r.max}</td><td class="r">${p.scores?.[r.id] ?? '<span class="muted">n/a</span>'}</td></tr>`).join('')}</tbody></table></div></section>
        <section class="panel"><div class="panel-head"><h2>Discussion</h2></div>${(p.comments || []).length ? `<div class="list">${p.comments.map((c) => `<div class="item" style="align-items:flex-start">${avatar(displayName(ctx.s, c.by), 'sm')}<div class="min0"><div class="t small">${esc(displayName(ctx.s, c.by))} <span class="s">· ${fmtDateTime(c.at)}</span></div><p class="small">${esc(c.text)}</p></div></div>`).join('')}</div>` : '<p class="small muted">No comments yet.</p>'}
          <form data-form="comment" class="row" style="margin-top:12px"><label class="sr-only" for="pc">Add a comment</label><input class="input grow" id="pc" name="text" placeholder="Add a comment" autocomplete="off"><button class="btn btn-ghost btn-sm" type="submit">Post</button></form></section>
      </div><div class="stack">
        <section class="panel"><div class="panel-head"><h2>Submission</h2></div>${p.repo ? `<dl class="dl small"><dt>Repository</dt><dd><a href="${esc(p.repo)}" target="_blank" rel="noopener noreferrer">${esc(p.repo.replace('https://', ''))}</a></dd>${p.demo ? `<dt>Demo</dt><dd><a href="${esc(p.demo)}" target="_blank" rel="noopener noreferrer">${esc(p.demo.replace('https://', ''))}</a></dd>` : ''}${(p.files || []).length ? `<dt>Files</dt><dd>${p.files.map(esc).join(', ')}</dd>` : ''}</dl>` : '<p class="small muted">Nothing submitted yet.</p>'}</section>
        <section class="panel"><div class="panel-head"><h2>Repository integration</h2>${pill('Not connected', 'p-mute')}</div><p class="small muted">Commit activity, pull-request reviews and CI status appear here once the GitHub or GitLab app is connected (OAuth, no passwords collected). Until then reviewers open the link directly.</p></section>
        <section class="panel"><div class="panel-head"><h2>Academic integrity</h2>${pill('Check not configured', 'p-mute')}</div><p class="small muted">Similarity checks run through the plagiarism-detection integration (for example MOSS). ${!learner ? 'Connect it under Integrations to enable checks on submission.' : ''}</p></section>
        <section class="panel"><div class="panel-head"><h2>Version history</h2></div>${(p.versions || []).length ? `<div class="list">${p.versions.slice().reverse().map((v) => `<div class="item"><span class="mono small">v${v.v}</span><span class="grow min0 small">${esc(v.note)}<br><span class="s">${fmtDateTime(v.at)}</span></span></div>`).join('')}</div>` : '<p class="small muted">No versions yet.</p>'}</section>
        <section class="panel"><div class="panel-head"><h2>Decision history</h2></div>${p.history.length ? timeline(p.history.slice().reverse().map((h) => ({ title: `${STATE_LABEL[h.from] || h.from} → ${STATE_LABEL[h.to]}`, sub: `${esc(displayName(ctx.s, h.by))} · ${fmtDateTime(h.at)}${h.note ? ` · ${esc(h.note)}` : ''}`, cls: h.to === 'revision' ? 'fail' : 'done' }))) : '<p class="small muted">No changes yet.</p>'}</section>
        ${learner && p.state === 'approved' ? `<section class="panel"><div class="panel-head"><h2>Portfolio</h2></div>${btn(ctx.s.students.find((s) => s.id === ctx.me.id).portfolio.projectIds.includes(p.id) ? 'Remove from portfolio' : 'Add to portfolio', { act: 'portfolio', ic: 'user', sm: true })}</section>` : ''}
      </div></div></div>`;
  },
  actions: {
    go(el, e, ctx) { act(ctx, el.dataset.id, {}); },
    revise(el, e, ctx) {
      const comment = document.querySelector('#comment')?.value || '';
      if (comment.trim().length < 10) { ctx.toast('Write what needs to change in the feedback box (at least 10 characters) before requesting a revision.', { tone: 'bad' }); document.querySelector('#comment')?.focus(); return; }
      act(ctx, 'requestRevision', { comment });
    },
    portfolio(el, e, ctx) { ctx.commit('portfolio.toggle', (s) => { const st = s.students.find((x) => x.id === ctx.me.id); const id = ctx.params.id; st.portfolio.projectIds = st.portfolio.projectIds.includes(id) ? st.portfolio.projectIds.filter((x) => x !== id) : [...st.portfolio.projectIds, id]; }, { ok: 'Portfolio updated' }); },
  },
  forms: {
    submit(form, d, ctx) {
      const files = [...(d.files || [])];
      const bad = files.find((f) => f.size > 10 * 1024 * 1024 || !/\.(pdf|png|jpe?g|md|zip)$/i.test(f.name));
      if (bad) { ctx.local(`pr:${ctx.params.id}`).errs = { files: `${bad.name} is not allowed (type or size).` }; return ctx.rerender(); }
      const p = ctx.s.projects.find((x) => x.id === ctx.params.id);
      const ev = p.state === 'revision' ? 'resubmit' : 'submit';
      act(ctx, ev, { repo: d.repo, demo: d.demo, note: d.note }, (s, proj) => { if (files.length) proj.files = files.map((f) => `${f.name} (${Math.ceil(f.size / 1024)} KB)`); });
    },
    approve(form, d, ctx) {
      const p = ctx.s.projects.find((x) => x.id === ctx.params.id);
      const a = asg(ctx, p.assignmentId);
      const scores = Object.fromEntries(a.rubric.map((r) => [r.id, d[`sc-${r.id}`]]));
      act(ctx, 'approve', { scores, comment: d.comment });
    },
    comment(form, d, ctx) {
      if (!d.text?.trim()) return;
      const p = ctx.s.projects.find((x) => x.id === ctx.params.id);
      ctx.commit('project.comment', (s) => { const x = s.projects.find((y) => y.id === p.id); x.comments = [...(x.comments || []), { by: ctx.me.id, at: new Date().toISOString(), text: d.text.trim() }]; ctx.notify(ctx.me.id === p.studentId ? p.reviewerId : p.studentId, 'review', 'New comment on a project', d.text.trim().slice(0, 80), `/projects/${p.id}`); });
    },
  },
};

function act(ctx, ev, payload, extra) {
  const p = ctx.s.projects.find((x) => x.id === ctx.params.id);
  const a = asg(ctx, p.assignmentId);
  const L = ctx.local(`pr:${p.id}`);
  const res = ctx.commit(`project.${ev}`, (s) => {
    const proj = s.projects.find((x) => x.id === p.id);
    transition(proj, a, ev, ctx.me.id, payload, new Date());
    extra?.(s, proj);
    const to = proj.state;
    if (['submitted'].includes(to)) ctx.notify(proj.reviewerId, 'review', 'Project submitted for review', `${displayName(s, proj.studentId)}: ${a.title}`, `/projects/${proj.id}`);
    if (['revision', 'approved', 'under_review'].includes(to)) ctx.notify(proj.studentId, 'review', to === 'approved' ? 'Project approved' : to === 'revision' ? 'Revision requested' : 'Review started', a.title, `/projects/${proj.id}`);
  }, { audit: { action: `project.${ev}`, entity: 'project', entityId: p.id, detail: TRANSITIONS[ev].label, kind: 'data' } });
  if (res === true) { L.errs = {}; ctx.toast(`${TRANSITIONS[ev].label}: done`); }
  else if (res && typeof res === 'object') { L.errs = res; ctx.rerender(); }
}
