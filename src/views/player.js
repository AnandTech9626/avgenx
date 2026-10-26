// Lesson player: video, reading, exercise and module-check lessons with validated completion.
import { esc, fmtDateTime } from '../core/util.js';
import { icon } from '../core/icons.js';
import { pill, bar, btn, empty, domainVar, textarea } from '../core/ui.js';
import { lessonsOf, findLesson, enrollmentFor, progressOf, isUnlocked, lessonRequirement, lessonQuiz, completeLesson, canComplete } from '../domain/progress.js';
import { setCopilotContext } from './copilot.js';
import { DOMAINS } from '../data/catalog.js';

/** Sample lesson body built from the course's own outcomes and skills (clearly marked as sample content). */
function lessonBody(c, l) {
  const d = DOMAINS.find((x) => x.id === c.domain);
  const skill = c.skills[l.module % c.skills.length];
  return `<div class="reading">
    <p class="small muted">Sample lesson content generated from the course outline. Replace it with your CMS content; the player, progress and notes work the same.</p>
    <h2>${esc(l.title)}</h2>
    <p>This lesson belongs to <b>${esc(c.modules[l.module].title)}</b> in ${esc(c.title)}. It builds the ${esc(skill)} skills you need for the course outcome: <i>${esc(c.outcomes[l.module % c.outcomes.length].toLowerCase())}</i>.</p>
    <div class="callout"><b>Key idea.</b> Work through one small, concrete example of ${esc(l.title.toLowerCase())} before reading about edge cases. Engineers who explain a concept with an example remember it far longer.</div>
    <h3>What to focus on</h3>
    <ul><li>Name the problem ${esc(l.title.toLowerCase())} solves, in one sentence.</li><li>Trace one example by hand, writing down every intermediate state.</li><li>List two ways it fails in production and how you would detect each.</li></ul>
    <h3>Try it</h3>
    <p>Open the Coding Lab or your editor and reproduce the example from this lesson without looking. Then change one input and predict the output before running it. Use the copilot to check your reasoning, not to write the code for you.</p>
    <p class="small muted">Domain: ${esc(d.name)} · Estimated time: ${l.mins} minutes</p></div>`;
}

export default {
  perms: ['programs.view'],
  title: (ctx) => { const c = ctx.s.courses.find((x) => x.id === ctx.params.id); return findLesson(c || { modules: [] }, ctx.params.lesson)?.title || 'Lesson'; },
  render(ctx) {
    const c = ctx.s.courses.find((x) => x.id === ctx.params.id);
    if (!c) return empty('Course not found');
    const l = findLesson(c, ctx.params.lesson);
    if (!l) return empty('Lesson not found');
    const student = ctx.me.role === 'student';
    const enr = student ? enrollmentFor(ctx.s, ctx.me.id, c.id) : null;
    const lessons = lessonsOf(c);
    const i = lessons.findIndex((x) => x.id === l.id);
    const prev = lessons[i - 1], next = lessons[i + 1];
    const done = !!enr?.done[l.id];
    const unlocked = !student || (enr && isUnlocked(c, enr, l.id));
    const p = enr ? progressOf(c, enr) : null;
    const req = lessonRequirement(c, l);
    const L = ctx.local(`lesson:${l.id}`, { quiz: {}, checked: false, score: null, watched: false });
    setCopilotContext(() => `Lesson "${l.title}" (${l.type}) in ${c.id} ${c.title}, module "${c.modules[l.module].title}". Course outcomes: ${c.outcomes.join('; ')}.`);

    if (student && !enr) return `<div class="page">${empty('Enroll to start this course', 'Lessons are available to enrolled learners.', { ic: 'lock', action: btn('Go to course page', { href: `/course/${c.id}`, cls: 'btn-primary', sm: true }) })}</div>`;
    if (!unlocked) return `<div class="page">${empty('This lesson is locked', 'Lessons unlock in order. Finish the earlier lessons first.', { ic: 'lock', action: btn(`Go to ${p.next?.title || 'course'}`, { href: p.next ? `/course/${c.id}/learn/${p.next.id}` : `/course/${c.id}`, cls: 'btn-primary', sm: true }) })}</div>`;

    let main = '';
    if (l.type === 'video') main = `<div class="stage" role="img" aria-label="Video lesson placeholder"><div class="stage-top"><span class="mono">${c.id} · M${l.module + 1}</span><span class="mono">${l.mins}:00</span></div><button type="button" class="stage-play" data-act="watch" aria-label="${L.watched ? 'Marked as watched' : 'Play lesson video'}">${icon(L.watched ? 'check' : 'play')}</button><div class="stage-bot"><span class="small">${L.watched ? 'Marked as watched.' : 'Video hosting connects through your video provider. This demo shows the transcript below.'}</span></div></div>${lessonBody(c, l)}`;
    else if (l.type === 'reading') main = lessonBody(c, l);
    else if (req.kind === 'quiz') {
      const qs = lessonQuiz(c, l);
      main = `<div class="stack"><p class="muted">Module check: answer at least 2 of 3 correctly to complete this lesson. You can retry; questions stay the same so you can learn from feedback.</p>${qs.map((q, qi) => `<fieldset class="q"><legend><span class="mono small muted">Q${qi + 1} · ${q.type === 'multi' ? 'Select all that apply' : 'Choose one'}</span><br>${esc(q.text)}</legend>${q.options.map((o, oi) => { const sel = q.type === 'multi' ? (L.quiz[q.id] || []).includes(oi) : L.quiz[q.id] === oi; const right = q.type === 'multi' ? q.answer.includes(oi) : q.answer === oi; return `<label class="opt ${L.checked ? (right ? 'right' : sel ? 'wrong' : '') : ''}"><input type="${q.type === 'multi' ? 'checkbox' : 'radio'}" name="lq-${q.id}" ${sel ? 'checked' : ''} data-change="quizPick" data-q="${q.id}" data-o="${oi}" data-multi="${q.type === 'multi'}" ${done ? 'disabled' : ''}><span>${esc(o)}</span></label>`; }).join('')}${L.checked ? `<p class="small muted">${esc(q.explain || '')}</p>` : ''}</fieldset>`).join('')}
        ${L.score !== null ? `<div class="callout ${L.score >= 2 ? 'ok' : 'bad'}" role="status"><b>${L.score} of ${qs.length} correct.</b> ${L.score >= 2 ? 'You can complete this lesson.' : 'Review the explanations and try again.'}</div>` : ''}
        ${done ? '' : `<div class="row">${btn('Check answers', { act: 'checkQuiz', cls: 'btn-ghost' })}</div>`}</div>`;
    } else if (req.kind === 'problem') {
      const accepted = ctx.s.submissions.some((x) => x.studentId === ctx.me.id && x.problemId === req.problemId && x.status === 'Accepted');
      main = `<div class="stack">${lessonBody(c, l)}<div class="callout ${accepted ? 'ok' : 'info'}"><b>Exercise:</b> ${esc(req.label)}. ${accepted ? 'Accepted. You can complete this lesson.' : 'Open the Coding Lab, solve it, then come back.'}</div><div class="row">${btn(accepted ? 'Open in Coding Lab' : 'Solve in Coding Lab', { href: `/lab/${req.problemId}?from=${encodeURIComponent(`/course/${c.id}/learn/${l.id}`)}`, cls: accepted ? 'btn-ghost' : 'btn-primary', ic: 'code' })}</div></div>`;
    } else if (req.kind === 'reflection') {
      main = `<div class="stack">${lessonBody(c, l)}<div class="callout info"><b>Lab exercise.</b> Complete the hands-on lab in your environment, then write what you did and what you learned. Mentors read reflections during reviews.</div>${done ? `<div class="panel sunk"><div class="eyebrow">Your reflection</div><p>${esc(enr.reflections?.[l.id] || '')}</p></div>` : textarea({ id: 'reflection', label: 'Lab reflection', value: L.reflection || '', rows: 4, hint: 'At least 40 characters. Mention one thing that broke and how you fixed it.', a: { 'data-input': 'reflect' } })}</div>`;
    }

    const notes = (ctx.s.prefs[ctx.me.id]?.notes || {})[l.id] || '';
    const err = student && !done ? canComplete(ctx.s, ctx.me.id, c.id, l.id, { quizScore: L.score, reflection: L.reflection }) : null;
    const completeBtn = !student ? `<span class="small muted">${icon('eye', 'style="width:14px;height:14px;vertical-align:-2px"')} Staff preview: completion is recorded only for enrolled learners.</span>` : done ? `${pill('Completed ' + fmtDateTime(enr.done[l.id]), 'p-ok')}${next ? btn('Next lesson', { href: `/course/${c.id}/learn/${next.id}`, cls: 'btn-primary', ic: 'arrow' }) : btn('Back to course', { href: `/course/${c.id}`, cls: 'btn-primary' })}` : `${btn(next ? 'Mark complete and continue' : 'Mark complete', { act: 'complete', cls: 'btn-primary', ic: 'check', disabled: !!err && !(l.type === 'video' || l.type === 'reading') })}${err && !(l.type === 'video' || l.type === 'reading') ? `<span class="small muted">${esc(err)}</span>` : ''}`;

    return `<div class="page player-page" style="${domainVar(c.domain)}">
      <nav class="crumbs" aria-label="Breadcrumb"><a href="#/programs">Programs</a><span aria-hidden="true">/</span><a href="#/course/${c.id}">${c.id}</a><span aria-hidden="true">/</span><span>Module ${l.module + 1}</span><span aria-hidden="true">/</span><span aria-current="page">${esc(l.title)}</span></nav>
      <div class="player">
        <section class="panel stack" aria-labelledby="page-title" style="--gap:18px">
          <div class="spread"><div><div class="eyebrow">${esc(l.type)} · ${l.mins} min · lesson ${i + 1} of ${lessons.length}</div><h1 id="page-title" style="font-size:1.55rem;margin-top:4px">${esc(l.title)}</h1></div>${student ? (done ? pill('Completed', 'p-ok') : pill('In progress', 'p-mute')) : pill('Preview', 'p-info')}</div>
          <div class="small muted">${icon('info', 'style="width:14px;height:14px;vertical-align:-2px"')} Completion rule: ${esc(req.label)}.</div>
          ${main}
          ${student ? `<div class="field"><label for="lesson-notes">My notes <span class="hint">(private, saved automatically)</span></label><textarea class="textarea" id="lesson-notes" rows="3" data-input="note" placeholder="Write a takeaway or a question for your mentor">${esc(notes)}</textarea></div>` : ''}
          <div class="spread lesson-actions">${btn('Previous', { href: prev ? `/course/${c.id}/learn/${prev.id}` : `/course/${c.id}`, ic: 'back' })}<div class="row">${completeBtn}</div></div>
        </section>
        <aside class="panel outline" aria-label="Course outline">
          <div><a href="#/course/${c.id}" class="mono small" style="text-decoration:none;color:var(--cat)">${c.id}</a><h2 style="font-size:1rem;margin-top:2px">${esc(c.title)}</h2></div>
          ${p ? `<div><div class="spread small"><span class="mono">${p.done}/${p.total} lessons</span><b class="mono">${p.pct}%</b></div>${bar(p.pct)}</div>` : ''}
          ${c.modules.map((m, mi) => `<div><h3 class="ol-h">${mi + 1}. ${esc(m.title)}</h3><ul class="ol">${m.lessons.map((x) => { const dn = enr?.done[x.id]; const open = !student || isUnlocked(c, enr, x.id); return `<li>${open ? `<a href="#/course/${c.id}/learn/${x.id}" ${x.id === l.id ? 'aria-current="page"' : ''}>` : '<span class="locked">'}<span class="ol-chk ${dn ? 'on' : ''}">${dn ? icon('check') : !open ? icon('lock') : ''}</span><span class="grow">${esc(x.title)}</span><span class="mono xs muted">${x.mins}m</span>${open ? '</a>' : '</span>'}</li>`; }).join('')}</ul></div>`).join('')}
        </aside>
      </div></div>`;
  },
  unmount() { setCopilotContext(null); },
  onStoreChange(ctx, d) { return d.label !== 'lesson.note'; },
  actions: {
    watch(el, e, ctx) { ctx.local(`lesson:${ctx.params.lesson}`).watched = true; ctx.rerender(); },
    quizPick(el, e, ctx) {
      const L = ctx.local(`lesson:${ctx.params.lesson}`);
      const q = el.dataset.q, o = Number(el.dataset.o);
      if (el.dataset.multi === 'true') { const cur = new Set(L.quiz[q] || []); el.checked ? cur.add(o) : cur.delete(o); L.quiz[q] = [...cur]; } else L.quiz[q] = o;
      L.checked = false; L.score = null;
    },
    checkQuiz(el, e, ctx) {
      const c = ctx.s.courses.find((x) => x.id === ctx.params.id); const l = findLesson(c, ctx.params.lesson);
      const L = ctx.local(`lesson:${l.id}`);
      const qs = lessonQuiz(c, l);
      L.score = qs.filter((q) => (q.type === 'multi' ? [...(L.quiz[q.id] || [])].sort().join() === [...q.answer].sort().join() : L.quiz[q.id] === q.answer)).length;
      L.checked = true; ctx.rerender();
    },
    reflect(el, e, ctx) { ctx.local(`lesson:${ctx.params.lesson}`).reflection = el.value; const btnEl = document.querySelector('[data-act="complete"]'); if (btnEl) btnEl.disabled = el.value.trim().length < 40; },
    note(el, e, ctx) {
      clearTimeout(noteTimer);
      noteTimer = setTimeout(() => ctx.commit('lesson.note', (s) => { const p = (s.prefs[ctx.me.id] ||= {}); (p.notes ||= {})[ctx.params.lesson] = el.value; }), 400);
    },
    complete(el, e, ctx) {
      const c = ctx.s.courses.find((x) => x.id === ctx.params.id); const l = findLesson(c, ctx.params.lesson);
      const L = ctx.local(`lesson:${l.id}`);
      const lessons = lessonsOf(c); const next = lessons[lessons.findIndex((x) => x.id === l.id) + 1];
      let progress;
      const ok = ctx.commit('lesson.complete', (s) => { progress = completeLesson(s, ctx.me.id, c.id, l.id, { quizScore: L.score, reflection: L.reflection }, new Date()); if (progress.pct === 100) ctx.notify(ctx.me.id, 'certificate', `You finished every lesson in ${c.id}`, 'Check the certificate requirements to see what is left.', '/certificates'); });
      if (ok === true) { ctx.toast(progress.pct === 100 ? `Course lessons complete. Check your certificate status.` : `Lesson complete · ${progress.pct}% of ${c.id}`); if (next) ctx.nav(`/course/${c.id}/learn/${next.id}`); }
    },
  },
};
let noteTimer;
