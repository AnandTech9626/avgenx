// Course builder: create, edit, duplicate, archive and publish courses with review workflow,
// validation, version history, prerequisites, assessment rules and module/lesson editing.
import { esc, fmtDate, fmtDateTime } from '../core/util.js';
import { icon } from '../core/icons.js';
import { pageHead, pill, btn, empty, tabs, table, kpi, select, input, textarea, check, timeline, swatch, domainVar, hbars } from '../core/ui.js';
import { COURSE_STATES, validateCourse, moveCourse, newCourse, nextLessonId, canMove } from '../domain/courses.js';
import { lessonsOf } from '../domain/progress.js';
import { moduleFunnel } from '../domain/analytics.js';
import { displayName } from '../domain/scope.js';
import { DOMAINS } from '../data/catalog.js';
import { ASSESSMENTS } from '../data/questions.js';

const canEditCourse = (ctx, c) => ctx.can('courses.edit') && (ctx.me.role !== 'instructor' || c.instructorId === ctx.me.id);

export const courseList = {
  perms: ['courses.view'],
  title: () => 'Courses',
  render(ctx) {
    const F = ctx.local('cb', { status: 'all', domain: 'all' });
    const list = ctx.s.courses.filter((c) => (F.status === 'all' || c.status === F.status) && (F.domain === 'all' || c.domain === F.domain));
    const count = (st) => ctx.s.courses.filter((c) => c.status === st).length;
    return `<div class="page">${pageHead({ title: 'Course builder', lede: 'Draft, review, approve and publish. Learners only see published courses.', actions: ctx.can('courses.edit') ? btn('New course', { act: 'new', cls: 'btn-primary', ic: 'plus' }) : '' })}
      <div class="kpis">${Object.entries(COURSE_STATES).map(([k, v]) => kpi({ label: v[0], value: count(k), alert: k === 'review' && count(k) > 0 && ctx.can('courses.approve') })).join('')}</div>
      ${tabs([['all', 'All', ctx.s.courses.length], ...Object.entries(COURSE_STATES).map(([k, v]) => [k, v[0], count(k)])], F.status, 'status')}
      <div class="toolbar">${select({ id: 'cb-d', label: 'Domain', value: F.domain, options: [['all', 'All domains'], ...DOMAINS.map((d) => [d.id, d.short])], a: { 'data-change': 'domain' } })}</div>
      <section class="panel flush">${table([
        { key: 'c', label: 'Course', sort: (c) => c.id, render: (c) => `<div class="row nowrap">${swatch(c)}<div class="min0"><b>${esc(c.title)}</b><div class="sub">${c.id} · ${c.level} · ${c.hours} h</div></div></div>` },
        { key: 's', label: 'Status', render: (c) => pill(...COURSE_STATES[c.status]) },
        { key: 'v', label: 'Version', r: true, render: (c) => (c.version ? `v${c.version}` : '<span class="muted">n/a</span>') },
        { key: 'i', label: 'Instructor', render: (c) => esc(displayName(ctx.s, c.instructorId)) },
        { key: 'e', label: 'Learners', r: true, render: (c) => ctx.s.enrollments.filter((e) => e.courseId === c.id).length },
        { key: 'r', label: 'Rating', r: true, render: (c) => (c.feedback.responses ? `★ ${c.feedback.rating}` : 'n/a') },
      ], list, { rowAct: 'open', rowId: (c) => c.id, sortKey: 'c', sortDir: 'asc' })}</section></div>`;
  },
  actions: {
    status(el, e, ctx) { ctx.local('cb').status = el.dataset.id; ctx.rerender(); },
    domain(el, e, ctx) { ctx.local('cb').domain = el.value; ctx.rerender(); },
    open(el, e, ctx) { ctx.nav(`/ops/courses/${el.dataset.id}`); },
    new(el, e, ctx) { createDialog(ctx); },
  },
};

function createDialog(ctx, base = null) {
  const instructors = ctx.s.users.filter((u) => u.role === 'instructor');
  ctx.modal({ title: base ? `Duplicate ${base.id}` : 'New course', body: `<div class="form-grid">${input({ id: 'n-id', label: 'Course code', req: true, value: '', hint: 'Three capital letters and three digits, for example WEB401' })}${select({ id: 'n-d', label: 'Domain', value: base?.domain, options: DOMAINS.map((d) => [d.id, d.short]) })}</div>${input({ id: 'n-t', label: 'Title', req: true, value: base ? `${base.title} (copy)` : '' })}<div class="form-grid">${select({ id: 'n-l', label: 'Level', value: base?.level, options: ['Foundation', 'Intermediate', 'Advanced'] })}${input({ id: 'n-h', label: 'Learning hours', type: 'number', value: base?.hours || 40 })}${select({ id: 'n-i', label: 'Instructor', value: ctx.me.role === 'instructor' ? ctx.me.id : base?.instructorId, options: instructors.map((u) => [u.id, u.name]), a: ctx.me.role === 'instructor' ? { disabled: true } : {} })}</div>`, foot: `<button class="btn btn-ghost" type="button" data-close>Cancel</button><button class="btn btn-primary" id="n-go" type="button">${base ? 'Duplicate as draft' : 'Create draft'}</button>`, onMount: (m, close) => {
    m.parentElement.querySelectorAll('[data-close]').forEach((b) => (b.onclick = close));
    m.querySelector('#n-go').onclick = () => {
      const id = m.querySelector('#n-id').value.trim().toUpperCase(), title = m.querySelector('#n-t').value.trim(), hours = Number(m.querySelector('#n-h').value);
      if (!/^[A-Z]{3}\d{3}$/.test(id)) return ctx.toast('Use a code like WEB401: three letters, three digits.', { tone: 'bad' });
      if (ctx.s.courses.some((c) => c.id === id)) return ctx.toast(`${id} already exists. Choose another code.`, { tone: 'bad' });
      if (title.length < 5) return ctx.toast('Give the course a descriptive title.', { tone: 'bad' });
      if (!(hours >= 4 && hours <= 400)) return ctx.toast('Learning hours must be between 4 and 400.', { tone: 'bad' });
      const instructorId = ctx.me.role === 'instructor' ? ctx.me.id : m.querySelector('#n-i').value;
      let c;
      if (base) { c = JSON.parse(JSON.stringify(base)); Object.assign(c, { id, title, domain: m.querySelector('#n-d').value, level: m.querySelector('#n-l').value, hours, instructorId, status: 'draft', version: 0, versions: [], workflow: [], publishAt: null, feedback: { rating: 0, responses: 0 } }); c.modules = c.modules.map((mm, mi) => ({ ...mm, id: `${id}-M${mi + 1}`, lessons: mm.lessons.map((l) => ({ ...l, id: l.id.replace(base.id, id) })) })); }
      else c = newCourse({ id, title, domain: m.querySelector('#n-d').value, level: m.querySelector('#n-l').value, hours, instructorId });
      c.workflow.push({ at: new Date().toISOString(), by: ctx.me.id, state: 'draft', note: base ? `Duplicated from ${base.id}` : 'Draft created' });
      if (ctx.commit('course.create', (s) => { s.courses.push(c); }, { ok: 'Draft created', audit: { action: base ? 'course.duplicate' : 'course.create', entity: 'course', entityId: id, detail: title } }) === true) { close(); ctx.nav(`/ops/courses/${id}`); }
    };
  } });
}

export const courseEditor = {
  perms: ['courses.view'],
  title: (ctx) => `Edit ${ctx.params.id}`,
  render(ctx) {
    const c = ctx.s.courses.find((x) => x.id === ctx.params.id);
    if (!c) return empty('Course not found');
    const T = ctx.local(`ce:${c.id}`, { tab: 'syllabus' });
    const editable = canEditCourse(ctx, c) && c.status !== 'archived';
    const live = c.status === 'published';
    const v = validateCourse(ctx.s, c);
    const enrolled = ctx.s.enrollments.filter((e) => e.courseId === c.id).length;
    const actions = [];
    if (c.status === 'draft' && editable) actions.push(btn('Submit for review', { act: 'move', cls: 'btn-primary', attrs: { 'data-to': 'review' }, disabled: !v.ok }));
    if (c.status === 'review' && ctx.can('courses.approve')) actions.push(btn('Approve', { act: 'move', cls: 'btn-primary', attrs: { 'data-to': 'approved' } }), btn('Send back', { act: 'move', attrs: { 'data-to': 'draft' } }));
    if (c.status === 'approved' && ctx.can('courses.publish')) actions.push(btn('Publish', { act: 'publish', cls: 'btn-primary', ic: 'upload' }));
    if (c.status === 'published' && ctx.can('courses.publish')) actions.push(btn('Archive', { act: 'archive', cls: 'btn-danger', ic: 'archive' }));
    if (c.status === 'archived' && ctx.can('courses.publish')) actions.push(btn('Restore to draft', { act: 'move', attrs: { 'data-to': 'draft' } }));
    if (ctx.can('courses.edit')) actions.push(btn('Duplicate', { act: 'dup', ic: 'copy' }));
    actions.push(btn('Preview', { href: `/course/${c.id}`, ic: 'eye' }));
    let body;
    if (T.tab === 'syllabus') body = syllabusEditor(ctx, c, editable, live);
    else if (T.tab === 'settings') body = settingsForm(ctx, c, editable);
    else if (T.tab === 'quality') {
      const f = moduleFunnel(ctx.s, c);
      body = `<div class="grid g2"><section class="panel"><div class="panel-head"><h2>Module completion</h2><span class="sub">${enrolled} enrolled learners</span></div>${f.length && enrolled ? hbars(f.map((m) => ({ label: m.title, value: m.pct, max: 100, display: `${m.pct}%`, color: m.pct < 40 ? 'var(--warn)' : 'var(--s1)' }))) : '<p class="small muted">No enrollments yet.</p>'}</section><section class="panel"><div class="panel-head"><h2>Learner feedback</h2></div><div class="stat-line"><div><b>${c.feedback.responses ? `★ ${c.feedback.rating}` : 'n/a'}</b><span>${c.feedback.responses} ratings</span></div><div><b>${(() => { const fb = ctx.s.sessions.filter((x) => x.courseId === c.id).flatMap((x) => x.feedback || []); return fb.length ? (fb.reduce((a, x) => a + x.rating, 0) / fb.length).toFixed(1) : 'n/a'; })()}</b><span>session rating</span></div></div><div class="list" style="margin-top:12px">${ctx.s.sessions.filter((x) => x.courseId === c.id).flatMap((x) => x.feedback || []).filter((x) => x.comment).slice(0, 6).map((x) => `<div class="item small">“${esc(x.comment)}” <span class="s">${x.rating}/5</span></div>`).join('') || '<p class="small muted">No written comments.</p>'}</div><p class="hint" style="margin-top:10px">Use this to plan the next revision: rework the module with the lowest completion first.</p></section></div>`;
    } else body = `<section class="panel"><div class="panel-head"><h2>Version history</h2></div>${c.versions.length ? timeline(c.versions.slice().reverse().map((x) => ({ title: `v${x.v}: ${x.note}`, sub: `${esc(displayName(ctx.s, x.by))} · ${fmtDateTime(x.at)}` }))) : '<p class="small muted">Not published yet.</p>'}</section><section class="panel"><div class="panel-head"><h2>Workflow history</h2></div>${(c.workflow || []).length ? timeline(c.workflow.slice().reverse().map((x) => ({ title: COURSE_STATES[x.state]?.[0] || x.state, sub: `${esc(displayName(ctx.s, x.by))} · ${fmtDateTime(x.at)}${x.note ? ` · ${esc(x.note)}` : ''}` }))) : '<p class="small muted">No history.</p>'}</section>`;
    return `<div class="page" style="${domainVar(c.domain)}">${pageHead({ title: c.title, crumb: [['Courses', '/ops/courses'], [c.id]], eyebrow: `${c.id} · ${esc(DOMAINS.find((d) => d.id === c.domain).short)} · v${c.version || 0}`, actions: actions.join('') })}
      <div class="row">${pill(...COURSE_STATES[c.status])}${live ? `<span class="small muted">${enrolled} learners see changes immediately. Edits are recorded as a new version note.</span>` : ''}${!editable && c.status !== 'archived' ? '<span class="small muted">Read only for your role or this course.</span>' : ''}</div>
      <div class="grid g-side"><div class="stack">${tabs([['syllabus', 'Syllabus'], ['settings', 'Settings and rules'], ['quality', 'Quality'], ['history', 'History']], T.tab, 'tab')}${body}</div>
        <aside class="stack"><section class="panel"><div class="panel-head"><h2>Review checklist</h2>${v.ok ? pill('Ready', 'p-ok') : pill(`${v.checks.filter((x) => !x.ok).length} to fix`, 'p-warn')}</div><ul class="checklist">${v.checks.map((x) => `<li class="${x.ok ? 'met' : ''}">${icon(x.ok ? 'check' : 'dot')}<span>${esc(x.label)}${x.detail ? `<br><span class="hint">${esc(x.detail)}</span>` : ''}</span></li>`).join('')}</ul></section>
        <section class="panel tight sunk small"><b>Workflow</b><p class="muted" style="margin-top:4px">Draft → In review (validation must pass) → Approved by the academic director → Published (now or on a scheduled date) → Archived (restorable). Every step is logged.</p></section></aside></div></div>`;
  },
  actions: {
    tab(el, e, ctx) { ctx.local(`ce:${ctx.params.id}`).tab = el.dataset.id; ctx.rerender(); },
    dup(el, e, ctx) { createDialog(ctx, ctx.s.courses.find((x) => x.id === ctx.params.id)); },
    move(el, e, ctx) {
      const to = el.dataset.to;
      const run = (note) => ctx.commit('course.move', (s) => { const c = s.courses.find((x) => x.id === ctx.params.id); moveCourse(s, c, to, ctx.me.id, note, new Date()); if (to === 'review') s.users.filter((u) => u.role === 'director').forEach((u) => ctx.notify(u.id, 'admin', 'Course submitted for review', c.title, `/ops/courses/${c.id}`)); if (to === 'approved' || (to === 'draft' && note)) ctx.notify(c.instructorId, 'admin', to === 'approved' ? 'Course approved' : 'Course sent back', note || c.title, `/ops/courses/${c.id}`); }, { ok: `Moved to ${COURSE_STATES[to][0]}`, audit: { action: `course.${to}`, entity: 'course', entityId: ctx.params.id, detail: note || '' } });
      if (to === 'draft' && ctx.s.courses.find((x) => x.id === ctx.params.id).status === 'review') ctx.modal({ title: 'Send back to draft', body: textarea({ id: 'sb', label: 'What should change?', req: true, rows: 3 }), foot: `<button class="btn btn-primary" id="sb-go" type="button">Send back</button>`, onMount: (m, close) => { m.querySelector('#sb-go').onclick = () => { if (run(m.querySelector('#sb').value) === true) close(); }; } });
      else run('');
    },
    publish(el, e, ctx) {
      const c = ctx.s.courses.find((x) => x.id === ctx.params.id);
      ctx.modal({ title: `Publish ${c.id}`, body: `${input({ id: 'pb-n', label: 'Version note', value: c.version ? 'Content update' : 'Initial publication', req: true })}${input({ id: 'pb-d', label: 'Available from', type: 'date', value: new Date().toISOString().slice(0, 10), hint: 'Learners can enroll from this date. Today publishes immediately.' })}`, foot: `<button class="btn btn-ghost" type="button" data-close>Cancel</button><button class="btn btn-primary" id="pb-go" type="button">Publish</button>`, onMount: (m, close) => {
        m.parentElement.querySelectorAll('[data-close]').forEach((b) => (b.onclick = close));
        m.querySelector('#pb-go').onclick = () => { const note = m.querySelector('#pb-n').value.trim(); if (note.length < 3) return ctx.toast('Add a version note.', { tone: 'bad' }); if (ctx.commit('course.publish', (s) => { const x = s.courses.find((y) => y.id === c.id); x.publishAt = m.querySelector('#pb-d').value; moveCourse(s, x, 'published', ctx.me.id, note, new Date()); }, { ok: `${c.id} published`, audit: { action: 'course.publish', entity: 'course', entityId: c.id, detail: note } }) === true) close(); };
      } });
    },
    archive(el, e, ctx) {
      const c = ctx.s.courses.find((x) => x.id === ctx.params.id);
      const n = ctx.s.enrollments.filter((e2) => e2.courseId === c.id && e2.status === 'active').length;
      ctx.confirm({ title: `Archive ${c.id}?`, body: `New enrollments stop and the course disappears from the catalog. ${n} active learner${n === 1 ? '' : 's'} keep their progress and records. You can restore it later.`, confirmLabel: 'Archive course', danger: true, typeToConfirm: c.id }).then((ok) => ok && ctx.commit('course.archive', (s) => moveCourse(s, s.courses.find((x) => x.id === c.id), 'archived', ctx.me.id, 'Archived', new Date()), { ok: 'Archived', audit: { action: 'course.archive', entity: 'course', entityId: c.id } }));
    },
    addModule(el, e, ctx) { edit(ctx, (c) => { c.modules.push({ id: `${c.id}-M${c.modules.length + 1}`, title: `Module ${c.modules.length + 1}`, lessons: [] }); }, 'Module added'); },
    addLesson(el, e, ctx) {
      const mi = Number(el.dataset.m);
      ctx.modal({ title: 'Add lesson', body: `${input({ id: 'l-t', label: 'Title', req: true })}<div class="form-grid">${select({ id: 'l-ty', label: 'Type', options: [['video', 'Video'], ['reading', 'Reading'], ['exercise', 'Coding exercise or lab'], ['quiz', 'Module check (quiz)']] })}${input({ id: 'l-m', label: 'Minutes', type: 'number', value: 20 })}</div>`, foot: `<button class="btn btn-primary" id="l-go" type="button">Add</button>`, onMount: (m, close) => { m.querySelector('#l-go').onclick = () => { const t = m.querySelector('#l-t').value.trim(); const mins = Number(m.querySelector('#l-m').value); if (t.length < 3) return ctx.toast('Lesson title is required.', { tone: 'bad' }); if (!(mins >= 3 && mins <= 240)) return ctx.toast('Minutes must be 3 to 240.', { tone: 'bad' }); if (edit(ctx, (c) => { c.modules[mi].lessons.push({ id: nextLessonId(c), title: t, type: m.querySelector('#l-ty').value, mins, module: mi }); }, 'Lesson added') === true) close(); }; } });
    },
    renameModule(el, e, ctx) { const mi = Number(el.dataset.m); const c = ctx.s.courses.find((x) => x.id === ctx.params.id); ctx.modal({ title: 'Rename module', body: input({ id: 'rm', label: 'Module title', value: c.modules[mi].title }), foot: `<button class="btn btn-primary" id="rm-go" type="button">Save</button>`, onMount: (m, close) => { m.querySelector('#rm-go').onclick = () => { const t = m.querySelector('#rm').value.trim(); if (t.length < 3) return; if (edit(ctx, (x) => { x.modules[mi].title = t; }, 'Renamed') === true) close(); }; } }); },
    moveLesson(el, e, ctx) { const [mi, li, dir] = [Number(el.dataset.m), Number(el.dataset.l), Number(el.dataset.dir)]; edit(ctx, (c) => { const ls = c.modules[mi].lessons; const j = li + dir; if (j < 0 || j >= ls.length) return; [ls[li], ls[j]] = [ls[j], ls[li]]; }, null); },
    delLesson(el, e, ctx) {
      const [mi, li] = [Number(el.dataset.m), Number(el.dataset.l)];
      const c = ctx.s.courses.find((x) => x.id === ctx.params.id); const l = c.modules[mi].lessons[li];
      const done = ctx.s.enrollments.filter((x) => x.courseId === c.id && x.done[l.id]).length;
      ctx.confirm({ title: `Remove "${l.title}"?`, body: done ? `${done} learner${done === 1 ? ' has' : 's have'} completed this lesson. Their completion record is kept for audit but no longer counts toward progress.` : 'No learner has completed it yet.', confirmLabel: 'Remove lesson', danger: true }).then((ok) => ok && edit(ctx, (x) => { x.modules[mi].lessons.splice(li, 1); }, 'Lesson removed'));
    },
    delModule(el, e, ctx) { const mi = Number(el.dataset.m); const c = ctx.s.courses.find((x) => x.id === ctx.params.id); if (c.modules[mi].lessons.length) return ctx.toast('Remove or move the lessons first.', { tone: 'bad' }); edit(ctx, (x) => { x.modules.splice(mi, 1); }, 'Module removed'); },
  },
  forms: {
    settings(form, d, ctx) {
      const errs = [];
      const hours = Number(d.hours);
      if (!(hours >= 4 && hours <= 400)) errs.push('Hours 4 to 400');
      const lp = Number(d.lessonsPct), ms = Number(d.minScore), ap = Number(d.attendancePct);
      if (![lp, ms, ap].every((x) => x >= 0 && x <= 100)) errs.push('Percentages must be 0 to 100');
      const prereqs = d.prereqs || [];
      if (prereqs.includes(ctx.params.id)) errs.push('A course cannot require itself');
      if (errs.length) return ctx.toast(errs.join('. '), { tone: 'bad' });
      edit(ctx, (c) => { Object.assign(c, { title: d.title.trim(), level: d.level, hours, prereqs, skills: d.skills.split(',').map((x) => x.trim()).filter(Boolean), outcomes: d.outcomes.split('\n').map((x) => x.trim()).filter(Boolean), instructorId: d.instructorId || c.instructorId, mentorIds: d.mentorIds || [], assessmentId: d.assessmentId || null, pass: { lessonsPct: lp, minScore: ms, projectRequired: !!d.projectRequired, attendancePct: ap, instructorApproval: !!d.instructorApproval } }); }, 'Settings saved');
    },
  },
};

function edit(ctx, fn, ok) {
  const c = ctx.s.courses.find((x) => x.id === ctx.params.id);
  if (!canEditCourse(ctx, c)) { ctx.toast('You cannot edit this course.', { tone: 'bad' }); return false; }
  return ctx.commit('course.edit', (s) => { const x = s.courses.find((y) => y.id === c.id); fn(x); x.modules.forEach((m, mi) => m.lessons.forEach((l) => (l.module = mi))); if (x.status === 'published') x.versions.push({ v: x.version, at: new Date().toISOString(), by: ctx.me.id, note: `Live edit: ${ok || 'reordered lessons'}` }); }, { ok: ok || undefined, audit: { action: 'course.edit', entity: 'course', entityId: c.id, detail: ok || 'reorder' } });
}

function syllabusEditor(ctx, c, editable, live) {
  return `<div class="stack">${c.modules.map((m, mi) => `<section class="panel"><div class="spread"><h3>${mi + 1}. ${esc(m.title)} <span class="mono small muted">${m.lessons.length} lessons · ${m.lessons.reduce((a, l) => a + l.mins, 0)} min</span></h3>${editable ? `<div class="row" style="--gap:4px">${btn('Rename', { act: 'renameModule', sm: true, cls: 'btn-quiet', attrs: { 'data-m': mi } })}${btn('Add lesson', { act: 'addLesson', sm: true, ic: 'plus', attrs: { 'data-m': mi } })}${!m.lessons.length ? btn('', { act: 'delModule', sm: true, cls: 'btn-quiet', ic: 'trash', title: 'Remove empty module', attrs: { 'data-m': mi } }) : ''}</div>` : ''}</div>
    ${m.lessons.length ? `<ol class="lesson-edit">${m.lessons.map((l, li) => `<li><span class="mono xs muted">${esc(l.id)}</span><span class="grow">${esc(l.title)}</span><span class="tag">${l.type}</span><span class="mono xs">${l.mins}m</span>${editable ? `<span class="row" style="--gap:2px">${btn('', { act: 'moveLesson', sm: true, cls: 'btn-quiet', ic: 'chevron', title: 'Move down', attrs: { 'data-m': mi, 'data-l': li, 'data-dir': 1 }, disabled: li === m.lessons.length - 1 })}${btn('', { act: 'moveLesson', sm: true, cls: 'btn-quiet flip', ic: 'chevron', title: 'Move up', attrs: { 'data-m': mi, 'data-l': li, 'data-dir': -1 }, disabled: li === 0 })}${btn('', { act: 'delLesson', sm: true, cls: 'btn-quiet', ic: 'trash', title: 'Remove lesson', attrs: { 'data-m': mi, 'data-l': li } })}</span>` : ''}</li>`).join('')}</ol>` : '<p class="small muted" style="margin-top:8px">No lessons yet.</p>'}</section>`).join('')}${editable ? btn('Add module', { act: 'addModule', ic: 'plus' }) : ''}</div>`;
}

function settingsForm(ctx, c, editable) {
  const instructors = ctx.s.users.filter((u) => u.role === 'instructor');
  const mentors = ctx.s.users.filter((u) => u.role === 'mentor');
  const dis = editable ? {} : { disabled: true };
  return `<form class="panel stack" data-form="settings" novalidate><h2>Course details</h2>
    ${input({ id: 'title', label: 'Title', value: c.title, a: dis })}
    <div class="form-grid">${select({ id: 'level', label: 'Level', value: c.level, options: ['Foundation', 'Intermediate', 'Advanced'], a: dis })}${input({ id: 'hours', label: 'Learning hours', type: 'number', value: c.hours, a: dis })}${select({ id: 'instructorId', label: 'Instructor', value: c.instructorId, options: instructors.map((u) => [u.id, u.name]), a: ctx.me.role === 'instructor' || !editable ? { disabled: true } : {} })}</div>
    <div class="field"><label for="mentorIds">Mentors</label><select class="select" id="mentorIds" name="mentorIds" multiple size="4" ${editable ? '' : 'disabled'}>${mentors.map((m) => `<option value="${m.id}" ${c.mentorIds.includes(m.id) ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select><span class="hint">Hold Ctrl or Cmd to select several.</span></div>
    <div class="field"><label for="prereqs">Prerequisite courses (unlock conditions)</label><select class="select" id="prereqs" name="prereqs" multiple size="5" ${editable ? '' : 'disabled'}>${ctx.s.courses.filter((x) => x.id !== c.id).map((x) => `<option value="${x.id}" ${c.prereqs.includes(x.id) ? 'selected' : ''}>${x.id} · ${esc(x.title)}</option>`).join('')}</select><span class="hint">Learners must finish every prerequisite before enrolling. Lessons inside the course unlock in order.</span></div>
    ${input({ id: 'skills', label: 'Skills (comma separated)', value: c.skills.join(', '), a: dis })}
    ${textarea({ id: 'outcomes', label: 'Learning outcomes (one per line)', value: c.outcomes.join('\n'), rows: 3, a: dis })}
    <h2 style="margin-top:6px">Assessment and certification rules</h2>
    ${select({ id: 'assessmentId', label: 'Course assessment', value: c.assessmentId || '', options: [['', 'None'], ...ASSESSMENTS.filter((a) => a.course === c.id || !a.course || a.domain === c.domain).map((a) => [a.id, a.title])], a: dis })}
    <div class="form-grid">${input({ id: 'lessonsPct', label: 'Lessons required (%)', type: 'number', value: c.pass.lessonsPct, a: dis })}${input({ id: 'minScore', label: 'Minimum assessment score (%)', type: 'number', value: c.pass.minScore, a: dis })}${input({ id: 'attendancePct', label: 'Minimum attendance (%)', type: 'number', value: c.pass.attendancePct, a: dis })}</div>
    ${check({ id: 'projectRequired', label: 'All assigned projects must be approved', checked: c.pass.projectRequired, a: dis })}${check({ id: 'instructorApproval', label: 'Instructor sign-off required (use for capstones)', checked: c.pass.instructorApproval, a: dis })}
    ${editable ? '<div class="row"><button class="btn btn-primary" type="submit">Save settings</button></div>' : ''}</form>`;
}
