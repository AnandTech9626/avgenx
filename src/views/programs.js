// Explore programs: catalog, reusable domain landing template, course detail with enrollment.
import { esc, fmtDate, inr, relDays } from '../core/util.js';
import { icon } from '../core/icons.js';
import { pageHead, pill, bar, cover, btn, empty, chips, searchBox, select, domainVar, avatar, tag, swatch, table } from '../core/ui.js';
import { DOMAINS } from '../data/catalog.js';
import { progressOf, enrollmentFor, prerequisitesMet, lessonsOf, isUnlocked, enroll } from '../domain/progress.js';
import { eligibility } from '../domain/certification.js';
import { ASSESSMENTS } from '../data/questions.js';
import { displayName } from '../domain/scope.js';

const LEVELS = ['Foundation', 'Intermediate', 'Advanced'];
let qTimer;
const visibleCourses = (ctx) => ctx.s.courses.filter((c) => c.status === 'published' || ctx.can('courses.view'));
const isBookmarked = (ctx, id) => ctx.me.role === 'student' && ctx.s.students.find((x) => x.id === ctx.me.id)?.bookmarks.includes(id);

function courseCard(ctx, c) {
  const enr = ctx.me.role === 'student' ? enrollmentFor(ctx.s, ctx.me.id, c.id) : null;
  const p = enr ? progressOf(c, enr) : null;
  const n = ctx.s.enrollments.filter((e) => e.courseId === c.id).length;
  return `<a class="card" href="#/course/${c.id}">${cover(c, { corner: `${c.status !== 'published' ? pill(c.status === 'review' ? 'In review' : 'Draft', 'p-warn') : ''}${isBookmarked(ctx, c.id) ? `<span class="pill p-pencil plain">${icon('bookmark', 'style="width:12px;height:12px"')}Saved</span>` : ''}` })}
    <div class="card-body"><h3>${esc(c.title)}</h3><div class="meta"><span>${c.level}</span><span>${c.hours} hrs</span><span>${lessonsOf(c).length} lessons</span><span>★ ${c.feedback.rating}</span></div>
      <p>${esc(c.outcomes[0])}.</p>
      ${p ? `<div>${bar(p.pct)}<span class="hint">${p.pct}% complete</span></div>` : ''}
      <div class="card-foot"><span class="small muted">${c.prereqs.length ? `Needs ${c.prereqs.join(', ')}` : 'No prerequisites'}</span><span class="mono small muted">${n} learners</span></div></div></a>`;
}

export const catalog = {
  perms: ['programs.view'],
  title: () => 'Explore Programs',
  render(ctx) {
    const F = ctx.local('cat', { domain: 'all', level: 'all', q: '', saved: false });
    let list = visibleCourses(ctx);
    if (F.domain !== 'all') list = list.filter((c) => c.domain === F.domain);
    if (F.level !== 'all') list = list.filter((c) => c.level === F.level);
    if (F.saved) list = list.filter((c) => isBookmarked(ctx, c.id));
    if (F.q.trim()) { const q = F.q.toLowerCase(); list = list.filter((c) => `${c.id} ${c.title} ${c.skills.join(' ')} ${c.outcomes.join(' ')}`.toLowerCase().includes(q)); }
    const totalHours = visibleCourses(ctx).reduce((a, c) => a + c.hours, 0);
    return `<div class="page">
      ${pageHead({ title: 'Programs and learning paths', lede: `${DOMAINS.length} domains, ${visibleCourses(ctx).filter((c) => c.status === 'published').length} published courses and ${totalHours.toLocaleString('en-IN')} hours of instruction, each with projects, assessments and a career pathway.` })}
      <section aria-labelledby="h-dom"><h2 id="h-dom" class="sr-only">Domains</h2><div class="grid g-auto" style="--min:250px">${DOMAINS.map((d) => { const cs = ctx.s.courses.filter((c) => c.domain === d.id && c.status === 'published'); return `<a class="domain-card" href="#/programs/${d.id}" style="--cat:var(${d.color})"><span class="mono small" style="color:var(--cat)">${d.code} · ${cs.length} courses</span><b>${esc(d.name)}</b><span class="small muted">${esc(d.tagline)}</span><span class="small">${d.careers.slice(0, 2).map(esc).join(' · ')}</span></a>`; }).join('')}</div></section>
      <section class="stack" aria-labelledby="h-courses"><div class="spread"><h2 id="h-courses">All courses</h2><span class="muted small">${list.length} shown</span></div>
        <div class="toolbar">
          <div class="grow-field">${searchBox({ id: 'cat-q', value: F.q, placeholder: 'Search courses, skills, outcomes', a: { 'data-input': 'q' } })}</div>
          ${select({ id: 'cat-domain', label: 'Domain', value: F.domain, options: [['all', 'All domains'], ...DOMAINS.map((d) => [d.id, d.short])], a: { 'data-change': 'set', 'data-key': 'domain' } })}
          ${select({ id: 'cat-level', label: 'Level', value: F.level, options: [['all', 'All levels'], ...LEVELS.map((l) => [l, l])], a: { 'data-change': 'set', 'data-key': 'level' } })}
          ${ctx.me.role === 'student' ? `<label class="check" style="padding-bottom:8px"><input type="checkbox" data-change="saved" ${F.saved ? 'checked' : ''}><span>Saved only</span></label>` : ''}
        </div>
        ${list.length ? `<div class="grid g-auto">${list.map((c) => courseCard(ctx, c)).join('')}</div>` : empty('No courses match', 'Clear a filter or search for a skill like "SQL" or "React".', { ic: 'search', action: btn('Clear filters', { act: 'clear', sm: true }) })}
      </section></div>`;
  },
  actions: {
    q(el, e, ctx) { ctx.local('cat').q = el.value; clearTimeout(qTimer); qTimer = setTimeout(() => ctx.rerender(), 180); },
    set(el, e, ctx) { ctx.local('cat')[el.dataset.key] = el.value; ctx.rerender(); },
    saved(el, e, ctx) { ctx.local('cat').saved = el.checked; ctx.rerender(); },
    clear(el, e, ctx) { Object.assign(ctx.local('cat'), { domain: 'all', level: 'all', q: '', saved: false }); ctx.rerender(); },
  },
};

export const domain = {
  perms: ['programs.view'],
  title: (ctx) => DOMAINS.find((d) => d.id === ctx.params.domain)?.name || 'Domain',
  render(ctx) {
    const d = DOMAINS.find((x) => x.id === ctx.params.domain);
    if (!d) return empty('Domain not found', '', { ic: 'compass' });
    const courses = visibleCourses(ctx).filter((c) => c.domain === d.id).sort((a, b) => LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level));
    const staff = ctx.s.users.filter((u) => ['instructor', 'mentor'].includes(u.role) && u.domains.includes(d.id));
    const showcase = ctx.s.projects.filter((p) => p.state === 'approved' && courses.some((c) => c.id === p.courseId)).slice(0, 4);
    const jobs = ctx.s.jobs.filter((j) => j.domain === d.id && j.status === 'open');
    const assessments = ASSESSMENTS.filter((a) => a.domain === d.id);
    return `<div class="page" style="--cat:var(${d.color})">
      <section class="domain-hero">
        <div class="min0"><nav class="crumbs" aria-label="Breadcrumb"><a href="#/programs">Programs</a><span aria-hidden="true">/</span><span aria-current="page">${esc(d.short)}</span></nav>
          <div class="mono small" style="color:var(--cat)">${d.code} DOMAIN</div><h1>${esc(d.name)}</h1><p class="lede">${esc(d.tagline)} ${esc(d.about)}</p>
          <div class="row" style="margin-top:12px">${courses[0] ? btn('Start with ' + courses[0].id, { href: `/course/${courses[0].id}`, cls: 'btn-primary', ic: 'arrow' }) : ''}${btn('Compare courses', { href: '/programs', cls: 'btn-ghost' })}</div></div>
        <div class="domain-facts"><div><b>${courses.length}</b><span>courses</span></div><div><b>${courses.reduce((a, c) => a + c.hours, 0)}</b><span>hours</span></div><div><b>${staff.length}</b><span>faculty and mentors</span></div><div><b>${jobs.length}</b><span>open roles (sample)</span></div></div>
      </section>
      <section class="panel" aria-labelledby="h-rm"><div class="panel-head"><h2 id="h-rm">Learning roadmap</h2><span class="sub">Foundation to advanced; arrows show prerequisites</span></div>
        <div class="rm-lanes">${LEVELS.map((lv) => `<div class="rm-lane"><div class="eyebrow">${lv}</div>${courses.filter((c) => c.level === lv).map((c) => `<a class="rm-node" href="#/course/${c.id}" style="${domainVar(c.domain)}"><span class="mono small">${c.id}</span><b>${esc(c.title)}</b><span class="small muted">${c.hours} hrs${c.prereqs.length ? ` · after ${c.prereqs.join(', ')}` : ''}</span></a>`).join('') || '<span class="small muted">No courses at this level</span>'}</div>`).join(`<div class="rm-arrow" aria-hidden="true">${icon('arrow')}</div>`)}</div></section>
      <div class="grid g-main">
        <div class="stack">
          <section aria-labelledby="h-col"><div class="panel-head"><h2 id="h-col">Course collection</h2></div><div class="grid g-auto" style="--min:240px">${courses.map((c) => courseCard(ctx, c)).join('')}</div></section>
          <section class="panel" aria-labelledby="h-pf"><div class="panel-head"><h2 id="h-pf">Project portfolio</h2><span class="sub">What learners build</span></div>
            <div class="list">${d.projects.map((p, i) => `<div class="item"><span class="mono small" style="color:var(--cat)">P${i + 1}</span><span class="grow t">${esc(p)}</span></div>`).join('')}</div>
            ${showcase.length ? `<div class="eyebrow" style="margin:14px 0 6px">Recently approved learner work</div><div class="list">${showcase.map((p) => `<div class="item">${avatar(displayName(ctx.s, p.studentId), 'sm')}<span class="grow min0"><span class="t small">${esc(ctx.s.assignments.find((a) => a.id === p.assignmentId)?.title || '')}</span><br><span class="s">${esc(displayName(ctx.s, p.studentId))} · ${p.courseId}</span></span>${pill('Approved', 'p-ok')}</div>`).join('')}</div>` : ''}</section>
        </div>
        <div class="stack">
          <section class="panel" aria-labelledby="h-pre"><div class="panel-head"><h2 id="h-pre">Skill prerequisites</h2></div><ul class="ticks">${d.prereqs.map((p) => `<li>${icon('check')}${esc(p)}</li>`).join('')}</ul></section>
          <section class="panel" aria-labelledby="h-af"><div class="panel-head"><h2 id="h-af">Assessment framework</h2></div><p class="small">${esc(d.framework)}</p>${assessments.length ? `<div class="list" style="margin-top:10px">${assessments.map((a) => `<div class="item"><span class="grow min0"><span class="t small">${esc(a.title)}</span><br><span class="s">${a.kind} · ${a.pick} questions · ${a.minutes} min · pass ${a.passPct}%${a.negative ? ` · −${a.negative * 100}% wrong` : ''}</span></span></div>`).join('')}</div>` : ''}</section>
          <section class="panel" aria-labelledby="h-car"><div class="panel-head"><h2 id="h-car">Career pathway</h2><a class="more" href="#/jobs">Jobs</a></div><ol class="career">${d.careers.map((c) => `<li>${esc(c)}</li>`).join('')}</ol><p class="hint" style="margin-top:8px">Roles are typical outcomes for this domain. The institute does not guarantee employment.</p></section>
          <section class="panel" aria-labelledby="h-men"><div class="panel-head"><h2 id="h-men">Mentors and instructors</h2></div><div class="list">${staff.map((u) => `<div class="item">${avatar(u.name, 'sm')}<span class="grow min0"><span class="t small">${esc(u.name)}</span><br><span class="s">${u.role === 'mentor' ? 'Mentor' : 'Instructor'}${u.slots ? ` · office hours ${u.slots.join(', ')}` : ''}</span></span></div>`).join('')}</div></section>
        </div>
      </div></div>`;
  },
};

export const course = {
  perms: ['programs.view'],
  title: (ctx) => ctx.s.courses.find((c) => c.id === ctx.params.id)?.title || 'Course',
  render(ctx) {
    const c = ctx.s.courses.find((x) => x.id === ctx.params.id);
    if (!c || (c.status !== 'published' && !ctx.can('courses.view'))) return empty('Course not found', 'It may be unpublished or archived.', { ic: 'layers' });
    const d = DOMAINS.find((x) => x.id === c.domain);
    const student = ctx.me.role === 'student';
    const enr = student ? enrollmentFor(ctx.s, ctx.me.id, c.id) : null;
    const p = enr ? progressOf(c, enr) : null;
    const pre = student ? prerequisitesMet(ctx.s, ctx.me.id, c) : { met: true, missing: [] };
    const el = enr ? eligibility(ctx.s, ctx.me.id, c.id) : null;
    const assess = ASSESSMENTS.find((a) => a.id === c.assessmentId);
    const learners = ctx.s.enrollments.filter((e) => e.courseId === c.id);
    const sessions = ctx.s.sessions.filter((x) => x.courseId === c.id && x.status === 'scheduled').slice(0, 3);
    const projectsA = ctx.s.assignments.filter((a) => a.courseId === c.id && a.status === 'published');
    let cta = '';
    if (student) {
      if (c.status !== 'published') cta = pill('Not open for enrollment', 'p-warn');
      else if (enr) cta = p.next ? btn(p.done ? `Continue: ${p.next.title}` : 'Start course', { href: `/course/${c.id}/learn/${p.next.id}`, cls: 'btn-primary', ic: 'play' }) : btn('Review course', { href: `/course/${c.id}/learn/${lessonsOf(c)[0].id}`, ic: 'book' });
      else cta = pre.met ? btn('Enroll', { act: 'enroll', cls: 'btn-primary', ic: 'plus' }) : `<span class="small muted">Complete ${pre.missing.join(', ')} to enroll</span>${btn('Enroll', { cls: 'btn-primary', disabled: true })}`;
      cta += btn(isBookmarked(ctx, c.id) ? 'Saved' : 'Save', { act: 'bookmark', ic: 'bookmark', cls: 'btn-ghost', attrs: { 'aria-pressed': String(!!isBookmarked(ctx, c.id)) } });
    } else if (ctx.can('courses.view')) cta = btn('Open in course builder', { href: `/ops/courses/${c.id}`, ic: 'edit' }) + btn('Preview lessons', { href: `/course/${c.id}/learn/${lessonsOf(c)[0].id}`, ic: 'eye' });
    else cta = btn('Preview lessons', { href: `/course/${c.id}/learn/${lessonsOf(c)[0].id}`, ic: 'eye' });
    return `<div class="page" style="${domainVar(c.domain)}">
      <div class="course-hero">
        ${cover(c, { corner: c.status !== 'published' ? pill(c.status, 'p-warn') : '' })}
        <div class="min0 stack" style="--gap:10px"><nav class="crumbs" aria-label="Breadcrumb"><a href="#/programs">Programs</a><span aria-hidden="true">/</span><a href="#/programs/${d.id}">${esc(d.short)}</a><span aria-hidden="true">/</span><span aria-current="page">${c.id}</span></nav>
          <h1>${esc(c.title)}</h1>
          <div class="meta"><span>${c.level}</span><span>${c.hours} hours</span><span>${lessonsOf(c).length} lessons</span><span>v${c.version}</span><span>★ ${c.feedback.rating} (${c.feedback.responses} ratings)</span><span>${learners.length} learners</span></div>
          <div class="row">${cta}</div>
          ${p ? `<div style="max-width:420px">${bar(p.pct, '', 'Course progress')}<span class="hint">${p.done} of ${p.total} lessons · ${p.pct}%</span></div>` : ''}
        </div>
      </div>
      <div class="grid g-main">
        <div class="stack">
          <section class="panel" aria-labelledby="h-out"><div class="panel-head"><h2 id="h-out">What you will be able to do</h2></div><ul class="ticks">${c.outcomes.map((o) => `<li>${icon('check')}${esc(o)}</li>`).join('')}</ul><div class="chips" style="margin-top:12px">${c.skills.map((s) => `<span class="chip">${esc(s)}</span>`).join('')}</div></section>
          <section class="panel" aria-labelledby="h-syl"><div class="panel-head"><h2 id="h-syl">Syllabus</h2><span class="sub">${student && enr ? 'Lessons unlock in order' : `${c.modules.length} modules`}</span></div>
            ${c.modules.map((m, mi) => `<div class="syl-mod"><h3>${mi + 1}. ${esc(m.title)} <span class="mono small muted">${m.lessons.reduce((a, l) => a + l.mins, 0)} min</span></h3><ul class="syl">${m.lessons.map((l) => { const done = enr?.done[l.id]; const open = !student || (enr && isUnlocked(c, enr, l.id)); return `<li class="${done ? 'done' : ''}">${open ? `<a href="#/course/${c.id}/learn/${l.id}">` : '<span class="locked">'}<span class="syl-ic">${icon(done ? 'check' : !open ? 'lock' : l.type === 'video' ? 'video' : l.type === 'quiz' ? 'exam' : l.type === 'exercise' ? 'code' : 'book')}</span><span class="grow">${esc(l.title)}</span><span class="mono small muted">${l.type} · ${l.mins}m</span>${open ? '</a>' : '</span>'}</li>`; }).join('')}</ul></div>`).join('')}
          </section>
        </div>
        <div class="stack">
          ${student && !pre.met ? `<div class="callout warn"><b>Prerequisites missing.</b> Finish ${pre.missing.map((x) => `<a href="#/course/${x}">${x}</a>`).join(', ')} first. This keeps the course pace fair for everyone.</div>` : ''}
          <section class="panel" aria-labelledby="h-cert"><div class="panel-head"><h2 id="h-cert">Certificate requirements</h2>${el ? (el.issued ? pill('Issued', 'p-ok') : el.eligible ? pill('Eligible', 'p-info') : pill('In progress', 'p-mute')) : ''}</div>
            <ul class="checklist">${(el ? el.checks : reqList(c)).map((k) => `<li class="${k.met ? 'met' : ''}">${icon(k.met ? 'check' : 'dot')}<span class="grow">${esc(k.label)}${k.detail ? `<br><span class="hint">${esc(k.detail)}</span>` : ''}</span></li>`).join('')}</ul></section>
          <section class="panel" aria-labelledby="h-team"><div class="panel-head"><h2 id="h-team">Teaching team</h2></div><div class="list">${[c.instructorId, ...c.mentorIds].map((id, i) => `<div class="item">${avatar(displayName(ctx.s, id), 'sm')}<span class="grow min0"><span class="t small">${esc(displayName(ctx.s, id))}</span><br><span class="s">${i === 0 ? 'Instructor' : 'Mentor'}</span></span></div>`).join('')}</div></section>
          ${assess ? `<section class="panel" aria-labelledby="h-as"><div class="panel-head"><h2 id="h-as">Assessment</h2><a class="more" href="#/assessments/${assess.id}">Open</a></div><p class="small"><b>${esc(assess.title)}</b><br><span class="muted">${assess.pick} questions · ${assess.minutes} minutes · ${assess.attempts} attempt${assess.attempts > 1 ? 's' : ''} · pass at ${assess.passPct}%</span></p></section>` : ''}
          ${projectsA.length ? `<section class="panel" aria-labelledby="h-pj"><div class="panel-head"><h2 id="h-pj">Projects</h2></div><div class="list">${projectsA.map((a) => `<div class="item">${icon('folder')}<span class="grow min0"><span class="t small">${esc(a.title)}</span><br><span class="s">${a.kind} · due ${a.dueOffset} days after assignment · late: ${a.late.graceDays}-day grace, then ${a.late.penaltyPct}%/day</span></span></div>`).join('')}</div></section>` : ''}
          ${sessions.length ? `<section class="panel" aria-labelledby="h-ls"><div class="panel-head"><h2 id="h-ls">Upcoming live sessions</h2><a class="more" href="#/live">Schedule</a></div><div class="list">${sessions.map((x) => `<div class="item"><div class="date-chip"><b>${new Date(x.start).getDate()}</b><span>${new Date(x.start).toLocaleDateString('en-GB', { month: 'short' })}</span></div><span class="grow min0"><span class="t small">${esc(x.title)}</span><br><span class="s">${relDays(x.start, ctx.now)} · ${x.mode}</span></span></div>`).join('')}</div></section>` : ''}
          <section class="panel tight sunk small"><dl class="dl"><dt>Status</dt><dd>${esc(c.status)}${c.publishAt ? ` since ${fmtDate(c.publishAt)}` : ''}</dd><dt>Version</dt><dd>v${c.version}: ${esc(c.versions[c.versions.length - 1]?.note || '')}</dd><dt>Prerequisites</dt><dd>${c.prereqs.length ? c.prereqs.map((x) => `<a href="#/course/${x}">${x}</a>`).join(', ') : 'None'}</dd></dl></section>
        </div>
      </div></div>`;
  },
  actions: {
    enroll(el, e, ctx) {
      const c = ctx.s.courses.find((x) => x.id === ctx.params.id);
      ctx.commit('enroll', (s) => { enroll(s, ctx.me.id, c.id, ctx.now); ctx.notify(ctx.me.id, 'announcement', `Enrolled in ${c.id}`, `Welcome to ${c.title}. Your first lesson is unlocked.`, `/course/${c.id}`); }, { ok: `Enrolled in ${c.id}`, audit: { action: 'enrollment.create', entity: 'enrollment', entityId: `${ctx.me.id}:${c.id}`, detail: `Self-enrolled in ${c.id}`, kind: 'data' } });
    },
    bookmark(el, e, ctx) {
      ctx.commit('bookmark', (s) => { const st = s.students.find((x) => x.id === ctx.me.id); const id = ctx.params.id; st.bookmarks = st.bookmarks.includes(id) ? st.bookmarks.filter((b) => b !== id) : [...st.bookmarks, id]; });
    },
  },
};

function reqList(c) {
  const r = c.pass;
  return [{ label: `Complete ${r.lessonsPct}% of lessons`, met: false }, ...(c.assessmentId ? [{ label: `Score at least ${r.minScore}% on the course assessment`, met: false }] : []), ...(r.projectRequired ? [{ label: 'Required projects approved', met: false }] : []), { label: `Attend at least ${r.attendancePct}% of live sessions`, met: false }, ...(r.instructorApproval ? [{ label: 'Instructor sign-off', met: false }] : [])];
}

/** My learning paths: the learner's cohort path plus enrolled courses outside it. */
export const paths = {
  perms: ['learn.self'],
  title: () => 'My Learning Paths',
  render(ctx) {
    const st = ctx.s.students.find((x) => x.id === ctx.me.id);
    const cohort = ctx.s.cohorts.find((c) => c.id === st.cohortId);
    const enr = ctx.s.enrollments.filter((e) => e.studentId === st.id);
    const outside = enr.filter((e) => !cohort.path.includes(e.courseId));
    const saved = st.bookmarks.map((id) => ctx.s.courses.find((c) => c.id === id)).filter(Boolean);
    const row = (cid) => { const c = ctx.s.courses.find((x) => x.id === cid); const e = enr.find((x) => x.courseId === cid); const p = e ? progressOf(c, e) : null; const pre = prerequisitesMet(ctx.s, st.id, c); return { c, e, p, pre }; };
    const rows = cohort.path.map(row);
    const totalL = rows.reduce((a, r) => a + lessonsOf(r.c).length, 0), doneL = rows.reduce((a, r) => a + (r.p?.done || 0), 0);
    return `<div class="page">${pageHead({ title: 'My learning paths', lede: `Your program path, ${esc(cohort.name)}, runs ${cohort.weeks} weeks from ${fmtDate(cohort.start)} to ${fmtDate(cohort.end)}.` })}
      <section class="panel"><div class="panel-head"><h2>Program path</h2><span class="sub">${doneL} of ${totalL} lessons · ${Math.round((doneL / Math.max(1, totalL)) * 100)}%</span></div>${bar((doneL / Math.max(1, totalL)) * 100, 'thick')}
        <ol class="roadmap" style="margin-top:16px">${rows.map((r, i) => `<li class="${!r.e ? 'locked' : r.p.pct === 100 ? 'done' : 'now'}" style="${domainVar(r.c.domain)}"><span class="rm-dot">${r.e && r.p.pct === 100 ? icon('check') : !r.e ? icon('lock') : i + 1}</span><a class="rm-body" href="#/course/${r.c.id}"><span class="mono small">${r.c.id} · ${r.c.level} · ${r.c.hours} hrs</span><b>${esc(r.c.title)}</b><span class="small muted">${r.e ? `${r.p.done}/${r.p.total} lessons${r.p.next ? ` · next: ${esc(r.p.next.title)}` : ' · complete'}` : r.c.status !== 'published' ? 'Not yet published' : r.pre.met ? 'Opens on schedule; you can enroll early from the course page' : `Unlocks after ${r.pre.missing.join(', ')}`}</span>${r.e ? bar(r.p.pct) : ''}</a></li>`).join('')}</ol></section>
      <div class="grid g2"><section class="panel"><div class="panel-head"><h2>Other courses you are taking</h2></div>${outside.length ? `<div class="list">${outside.map((e) => { const r = row(e.courseId); return `<a class="item" href="#/course/${r.c.id}">${swatch(r.c)}<span class="grow min0"><span class="t">${esc(r.c.title)}</span><br><span class="s">${r.p.pct}% complete</span></span></a>`; }).join('')}</div>` : empty('Only your program path', 'Enroll in electives from Explore Programs.', { ic: 'compass', action: btn('Explore', { href: '/programs', sm: true }) })}</section>
      <section class="panel"><div class="panel-head"><h2>Saved courses</h2></div>${saved.length ? `<div class="list">${saved.map((c) => `<a class="item" href="#/course/${c.id}">${swatch(c)}<span class="grow min0"><span class="t">${esc(c.title)}</span><br><span class="s">${c.level} · ${c.hours} hrs</span></span>${icon('arrow')}</a>`).join('')}</div>` : empty('Nothing saved yet', 'Use Save on any course page to keep it here.', { ic: 'bookmark' })}</section></div></div>`;
  },
};
