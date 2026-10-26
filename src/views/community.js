// Community and live learning: live classes, mentors and student success, discussions, study groups.
import { esc, fmtDate, fmtDateTime, fmtShort, fmtTime, relDays, uid, iso, addDays, startOfDay, DAY, daysBetween } from '../core/util.js';
import { icon } from '../core/icons.js';
import { pageHead, pill, btn, empty, tabs, table, kpi, bar, select, input, textarea, seg, avatar, timeline, chips, searchBox, hbars } from '../core/ui.js';
import { visibleStudents, visibleCohorts, displayName, canSeeThread, canReadMentorNote, teachingCourseIds } from '../domain/scope.js';
import { readiness } from '../domain/career.js';
import { progressOf } from '../domain/progress.js';
import { lastActive } from '../domain/activity.js';
import { riskTone, riskLabel } from './shared.js';
import { IV_LABEL, nextIvStates, advanceIntervention, RULES } from '../domain/risk.js';

// =================================================================== LIVE CLASSES
function sessionsInScope(ctx) {
  if (ctx.me.role === 'student') { const st = ctx.s.students.find((x) => x.id === ctx.me.id); return ctx.s.sessions.filter((x) => x.cohortId === st.cohortId); }
  if (ctx.me.role === 'instructor') return ctx.s.sessions.filter((x) => x.instructorId === ctx.me.id);
  const cohorts = new Set(visibleCohorts(ctx.s, ctx.me).map((c) => c.id));
  return ctx.s.sessions.filter((x) => cohorts.has(x.cohortId));
}
const S_PILL = { scheduled: ['Scheduled', 'p-info'], completed: ['Completed', 'p-ok'], cancelled: ['Cancelled', 'p-bad'] };

export const live = {
  perms: ['live.view'],
  title: () => 'Live Classes',
  render(ctx) {
    const F = ctx.local('live', { view: 'agenda', cohort: 'all', when: 'upcoming', week: 0 });
    let list = sessionsInScope(ctx);
    const cohorts = [...new Set(list.map((x) => x.cohortId))].map((id) => ctx.s.cohorts.find((c) => c.id === id));
    if (F.cohort !== 'all') list = list.filter((x) => x.cohortId === F.cohort);
    const nowIso = ctx.now.toISOString();
    const student = ctx.me.role === 'student';
    const manage = ctx.can('live.manage');
    let body;
    if (F.view === 'agenda') {
      const shown = list.filter((x) => (F.when === 'upcoming' ? x.start >= nowIso || x.status === 'scheduled' : x.start < nowIso)).sort((a, b) => (F.when === 'upcoming' ? (a.start < b.start ? -1 : 1) : a.start < b.start ? 1 : -1));
      body = shown.length ? `<div class="stack" style="--gap:10px">${shown.map((x) => sessionCard(ctx, x)).join('')}</div>` : empty(F.when === 'upcoming' ? 'No upcoming sessions' : 'No past sessions', '', { ic: 'calendar' });
    } else body = weekGrid(ctx, list, F.week);
    const instructors = ctx.s.users.filter((u) => u.role === 'instructor' && (ctx.me.role !== 'instructor' || u.id === ctx.me.id));
    const avail = manage ? `<section class="panel"><div class="panel-head"><h2>Instructor availability</h2><span class="sub">Next 14 days · teaching hours booked vs weekly capacity</span></div>${hbars(instructors.map((u) => { const h = ctx.s.sessions.filter((x) => x.instructorId === u.id && x.status === 'scheduled' && x.start >= nowIso && x.start <= addDays(ctx.now, 14).toISOString()).reduce((a, x) => a + x.mins / 60, 0); return { label: u.name, value: h, max: (u.capacity || 18) * 2 * 0.4, display: `${h.toFixed(1)}h`, color: h > (u.capacity || 18) * 2 * 0.3 ? 'var(--warn)' : 'var(--s1)' }; }))}<p class="hint" style="margin-top:8px">Scale assumes up to 40% of an instructor's capacity goes to live teaching; amber means above 30%.</p></section>` : '';
    const myLeaves = student ? ctx.s.leaveRequests.filter((l) => l.studentId === ctx.me.id) : [];
    return `<div class="page">${pageHead({ title: 'Live classes', lede: 'Cohort sessions, labs and clinics. Meeting links come from the video provider once connected; demo sessions are labelled.', actions: manage ? btn('Schedule session', { act: 'newSession', cls: 'btn-primary', ic: 'plus' }) : student ? btn('Request leave', { act: 'leave', ic: 'calendar' }) : '' })}
      ${myLeaves.length ? `<div class="row small">${myLeaves.map((l) => pill(`Leave ${fmtShort(l.from)} to ${fmtShort(l.to)}: ${l.status}`, l.status === 'approved' ? 'p-ok' : l.status === 'rejected' ? 'p-bad' : 'p-warn', true)).join('')}</div>` : ''}
      <div class="toolbar">${seg([['agenda', 'Agenda'], ['week', 'Week']], F.view, 'view', 'View')}${F.view === 'agenda' ? seg([['upcoming', 'Upcoming'], ['past', 'Past']], F.when, 'when', 'Time') : `<div class="row">${btn('', { act: 'week', ic: 'back', sm: true, title: 'Previous week', attrs: { 'data-id': F.week - 1 } })}<span class="small mono">${fmtShort(addDays(weekMonday(ctx.now), F.week * 7))} to ${fmtShort(addDays(weekMonday(ctx.now), F.week * 7 + 6))}</span>${btn('', { act: 'week', ic: 'arrow', sm: true, title: 'Next week', attrs: { 'data-id': F.week + 1 } })}</div>`}${cohorts.length > 1 ? select({ id: 'lv-c', label: 'Cohort', value: F.cohort, options: [['all', 'All cohorts'], ...cohorts.map((c) => [c.id, c.name])], a: { 'data-change': 'cohort' } }) : ''}</div>
      <div class="grid ${manage ? 'g-side' : ''}"><div>${body}</div>${avail}</div></div>`;
  },
  actions: {
    view(el, e, ctx) { ctx.local('live').view = el.dataset.id; ctx.rerender(); },
    when(el, e, ctx) { ctx.local('live').when = el.dataset.id; ctx.rerender(); },
    week(el, e, ctx) { ctx.local('live').week = Number(el.dataset.id); ctx.rerender(); },
    cohort(el, e, ctx) { ctx.local('live').cohort = el.value; ctx.rerender(); },
    leave(el, e, ctx) {
      ctx.modal({ title: 'Request leave', body: `<div class="form-grid">${input({ id: 'lv-f', label: 'From', type: 'date', value: iso(addDays(ctx.now, 1)) })}${input({ id: 'lv-t', label: 'To', type: 'date', value: iso(addDays(ctx.now, 2)) })}</div>${input({ id: 'lv-r', label: 'Reason', req: true, hint: 'Shared with your program manager. Keep personal details to what is necessary.' })}`, foot: `<button class="btn btn-primary" id="lv-go" type="button">Send request</button>`, onMount: (m, close) => { m.querySelector('#lv-go').onclick = () => {
        const f = m.querySelector('#lv-f').value, t = m.querySelector('#lv-t').value, r = m.querySelector('#lv-r').value.trim();
        if (!f || !t || t < f) return ctx.toast('The end date must be on or after the start date.', { tone: 'bad' });
        if (f < iso(ctx.now)) return ctx.toast('Leave must start today or later.', { tone: 'bad' });
        if (r.length < 5) return ctx.toast('Give a short reason.', { tone: 'bad' });
        const st = ctx.s.students.find((x) => x.id === ctx.me.id);
        if (ctx.commit('leave.request', (s) => { s.leaveRequests.push({ id: uid('LV'), studentId: st.id, from: f, to: t, reason: r, status: 'pending', at: new Date().toISOString() }); const pm = s.cohorts.find((c) => c.id === st.cohortId)?.pmId; if (pm) ctx.notify(pm, 'admin', 'Leave request', `${st.name}: ${f} to ${t}`, '/ops/attendance'); }, { ok: 'Leave requested' }) === true) close();
      }; } });
    },
    register(el, e, ctx) { const id = el.dataset.id; ctx.commit('session.register', (s) => { const x = s.sessions.find((y) => y.id === id); x.registered = x.registered.includes(ctx.me.id) ? x.registered.filter((r) => r !== ctx.me.id) : [...x.registered, ctx.me.id]; }, { ok: 'Registration updated' }); },
    join(el, e, ctx) { const x = ctx.s.sessions.find((y) => y.id === el.dataset.id); ctx.modal({ title: 'Join session', body: x.link ? `<p>Opening ${esc(x.link)}</p>` : `<div class="callout warn"><b>Demo session.</b> No external meeting exists for it. When the video provider is connected, this button opens the real meeting and attendance is imported automatically.</div>` }); },
    attendance(el, e, ctx) { attendanceSheet(ctx, el.dataset.id); },
    feedback(el, e, ctx) { feedbackForm(ctx, el.dataset.id); },
    newSession(el, e, ctx) { sessionForm(ctx, null); },
    reschedule(el, e, ctx) { sessionForm(ctx, ctx.s.sessions.find((x) => x.id === el.dataset.id)); },
    cancel(el, e, ctx) {
      const x = ctx.s.sessions.find((y) => y.id === el.dataset.id);
      ctx.modal({ title: 'Cancel session', body: `<p>${esc(x.title)} on ${fmtDateTime(x.start)}. ${x.registered.length} registered learners will be notified.</p>${textarea({ id: 'cx-reason', label: 'Cancellation notice', req: true, rows: 2 })}`, foot: `<button class="btn btn-ghost" type="button" data-close>Keep session</button><button class="btn btn-danger solid" type="button" id="cx-go">Cancel session</button>`, onMount: (m, close) => {
        m.parentElement.querySelectorAll('[data-close]').forEach((b) => (b.onclick = close));
        m.querySelector('#cx-go').onclick = () => { const r = m.querySelector('#cx-reason').value.trim(); if (r.length < 8) return ctx.toast('Write a short notice for learners (8+ characters).', { tone: 'bad' }); if (ctx.commit('session.cancel', (s) => { const y = s.sessions.find((z) => z.id === x.id); y.status = 'cancelled'; y.history.push({ at: new Date().toISOString(), by: ctx.me.id, note: `Cancelled: ${r}` }); y.registered.forEach((sid) => ctx.notify(sid, 'class', `Cancelled: ${y.title}`, r, '/live')); }, { ok: 'Session cancelled and learners notified', audit: { action: 'session.cancel', entity: 'session', entityId: x.id, detail: r } }) === true) close(); };
      } });
    },
  },
  forms: {
    session(form, d, ctx) {
      const errs = {};
      if ((d.title || '').trim().length < 4) errs.title = 'Required';
      const start = new Date(`${d.date}T${d.time}`);
      if (Number.isNaN(start.getTime())) errs.date = 'Pick a date and time';
      else if (start < ctx.now) errs.date = 'Must be in the future';
      const mins = Number(d.mins);
      if (!(mins >= 30 && mins <= 240)) errs.mins = '30 to 240 minutes';
      const course = ctx.s.courses.find((c) => c.id === d.courseId);
      const instructorId = course?.instructorId;
      if (!errs.date) { const end = start.getTime() + mins * 60000; const clash = ctx.s.sessions.find((x) => x.id !== d.id && x.instructorId === instructorId && x.status === 'scheduled' && new Date(x.start).getTime() < end && new Date(x.start).getTime() + x.mins * 60000 > start.getTime()); if (clash) errs.date = `Clashes with "${clash.title}" for ${displayName(ctx.s, instructorId)}`; }
      if (Object.keys(errs).length) return sessionForm(ctx, d.id ? ctx.s.sessions.find((x) => x.id === d.id) : null, d, errs);
      if (d.id) {
        ctx.commit('session.reschedule', (s) => { const x = s.sessions.find((y) => y.id === d.id); const old = x.start; Object.assign(x, { title: d.title.trim(), start: start.toISOString(), mins, mode: d.mode, room: d.mode === 'campus' ? d.room : null }); x.history.push({ at: new Date().toISOString(), by: ctx.me.id, note: `Rescheduled from ${fmtDateTime(old)} to ${fmtDateTime(start)}` }); x.registered.forEach((sid) => ctx.notify(sid, 'class', `Rescheduled: ${x.title}`, `Now ${fmtDateTime(start)}`, '/live')); }, { ok: 'Rescheduled and learners notified', audit: { action: 'session.reschedule', entity: 'session', entityId: d.id } });
      } else {
        const members = ctx.s.students.filter((s) => s.cohortId === d.cohortId && s.status === 'active');
        ctx.commit('session.create', (s) => { s.sessions.push({ id: uid('LS'), cohortId: d.cohortId, courseId: d.courseId, title: d.title.trim(), kind: d.kind, instructorId, start: start.toISOString(), mins, mode: d.mode, room: d.mode === 'campus' ? d.room : null, status: 'scheduled', registered: [], attendance: {}, recording: null, materials: [], feedback: [], history: [{ at: new Date().toISOString(), by: ctx.me.id, note: 'Scheduled' }] }); members.forEach((m) => ctx.notify(m.id, 'class', `New session: ${d.title.trim()}`, fmtDateTime(start), '/live')); }, { ok: `Scheduled. ${members.length} learners notified.`, audit: { action: 'session.create', entity: 'session', entityId: d.cohortId, detail: d.title } });
      }
      document.querySelector('#drawer [data-close]')?.click();
    },
  },
};

function weekMonday(now) { const d = new Date(startOfDay(now)); return new Date(d.getTime() - ((d.getDay() + 6) % 7) * DAY); }
function weekGrid(ctx, list, w) {
  const mon = addDays(weekMonday(ctx.now), w * 7);
  const days = Array.from({ length: 7 }, (_, i) => addDays(mon, i));
  return `<div class="week-grid" role="grid" aria-label="Week calendar">${days.map((d) => { const items = list.filter((x) => iso(x.start) === iso(d)).sort((a, b) => (a.start < b.start ? -1 : 1)); return `<div class="wk-day ${iso(d) === iso(ctx.now) ? 'today' : ''}" role="gridcell"><div class="wk-h"><span class="eyebrow">${d.toLocaleDateString('en-GB', { weekday: 'short' })}</span><b>${d.getDate()}</b></div>${items.map((x) => `<button type="button" class="wk-ev ${x.status}" data-act="${x.status === 'completed' && ctx.can('attendance.mark') ? 'attendance' : 'join'}" data-id="${x.id}"><span class="mono xs">${fmtTime(x.start)}</span><span class="xs">${esc(x.title)}</span></button>`).join('') || '<span class="xs muted">No sessions</span>'}</div>`; }).join('')}</div>`;
}

function sessionCard(ctx, x) {
  const c = ctx.s.courses.find((y) => y.id === x.courseId);
  const student = ctx.me.role === 'student';
  const reg = x.registered.includes(ctx.me.id);
  const past = x.start < ctx.now.toISOString();
  const att = Object.values(x.attendance || {});
  const fb = x.feedback || [];
  const myFb = fb.find((f) => f.studentId === ctx.me.id);
  const mine = ctx.me.role === 'student' ? x.attendance?.[ctx.me.id] : undefined;
  const manage = ctx.can('live.manage') && (ctx.me.role !== 'instructor' || x.instructorId === ctx.me.id);
  return `<article class="panel session ${x.status}"><div class="row nowrap" style="--gap:14px;align-items:flex-start"><div class="date-chip"><b>${new Date(x.start).getDate()}</b><span>${new Date(x.start).toLocaleDateString('en-GB', { month: 'short' })}</span></div>
    <div class="grow min0 stack" style="--gap:6px"><div class="spread"><b>${esc(x.title)}</b>${pill(...S_PILL[x.status])}</div>
      <div class="meta"><span>${fmtTime(x.start)} · ${x.mins} min</span><span>${esc(x.kind)}</span><span>${c.id}</span><span>${x.mode === 'online' ? 'Online (demo session)' : esc(x.room)}</span><span>${esc(displayName(ctx.s, x.instructorId))}</span><span>${x.registered.length} registered</span></div>
      ${x.history?.length ? `<div class="xs muted">${esc(x.history[x.history.length - 1].note)}</div>` : ''}
      ${past && x.status === 'completed' ? `<div class="small">${student ? (mine === true ? pill('You attended', 'p-ok', true) : mine === false ? pill('Marked absent', 'p-bad', true) : '') : `Attendance ${att.filter(Boolean).length}/${att.length}`}${fb.length ? ` · rating ${(fb.reduce((a, f) => a + f.rating, 0) / fb.length).toFixed(1)}/5 from ${fb.length}` : ''}${x.recording ? ` · <span class="muted">${esc(x.recording)}</span>` : ''}</div>` : ''}
      ${x.materials?.length ? `<div class="xs muted">Materials: ${x.materials.map(esc).join(', ')}</div>` : ''}
      <div class="row">${x.status === 'scheduled' && student ? btn(reg ? 'Registered · cancel' : 'Register', { act: 'register', sm: true, cls: reg ? 'btn-ghost' : 'btn-primary', attrs: { 'data-id': x.id } }) + (reg ? btn('Join', { act: 'join', sm: true, ic: 'video', attrs: { 'data-id': x.id } }) : '') : ''}
        ${x.status === 'completed' && student && mine && !myFb ? btn('Rate this session', { act: 'feedback', sm: true, attrs: { 'data-id': x.id } }) : ''}${myFb ? `<span class="xs muted">You rated ${myFb.rating}/5</span>` : ''}
        ${manage && x.status === 'scheduled' ? btn('Reschedule', { act: 'reschedule', sm: true, attrs: { 'data-id': x.id } }) + btn('Cancel', { act: 'cancel', sm: true, cls: 'btn-danger', attrs: { 'data-id': x.id } }) : ''}
        ${ctx.can('attendance.mark') && (past || x.status === 'completed') && x.status !== 'cancelled' && (ctx.me.role !== 'instructor' || x.instructorId === ctx.me.id) ? btn('Attendance', { act: 'attendance', sm: true, ic: 'checkSq', attrs: { 'data-id': x.id } }) : ''}
        ${manage && x.status === 'completed' ? btn('Post-class assignment', { href: '/projects', sm: true, cls: 'btn-quiet' }) : ''}</div></div></div></article>`;
}

function sessionForm(ctx, x, d = {}, errs = {}) {
  const cohorts = visibleCohorts(ctx.s, ctx.me);
  const v = { id: x?.id || '', title: d.title ?? x?.title ?? '', cohortId: d.cohortId ?? x?.cohortId ?? cohorts[0]?.id, courseId: d.courseId ?? x?.courseId, date: d.date ?? (x ? iso(x.start) : iso(addDays(ctx.now, 3))), time: d.time ?? (x ? fmtTime(x.start) : '18:30'), mins: d.mins ?? x?.mins ?? 90, mode: d.mode ?? x?.mode ?? 'online', room: d.room ?? x?.room ?? '', kind: d.kind ?? x?.kind ?? 'Live class' };
  const cohort = ctx.s.cohorts.find((c) => c.id === v.cohortId);
  const courses = ctx.me.role === 'instructor' ? cohort.path.filter((id) => teachingCourseIds(ctx.s, ctx.me).includes(id)) : cohort.path;
  ctx.openPanel(() => ({ title: x ? 'Reschedule session' : 'Schedule session', sub: x ? 'Registered learners are notified of the change' : 'Every active learner in the cohort is notified', body: `<form data-form="session" class="stack" novalidate><input type="hidden" name="id" value="${esc(v.id)}">
    ${x ? '' : select({ id: 'cohortId', label: 'Cohort', value: v.cohortId, options: cohorts.map((c) => [c.id, c.name]) })}
    ${x ? `<input type="hidden" name="cohortId" value="${esc(v.cohortId)}"><input type="hidden" name="courseId" value="${esc(v.courseId)}">` : select({ id: 'courseId', label: 'Course', value: v.courseId, options: (courses.length ? courses : cohort.path).map((id) => [id, `${id} · ${ctx.s.courses.find((c) => c.id === id).title}`]) })}
    ${input({ id: 'title', label: 'Title', value: v.title, req: true, error: errs.title })}
    ${x ? '' : select({ id: 'kind', label: 'Type', value: v.kind, options: ['Live class', 'Lab clinic', 'Doubt clearing', 'Guest lecture', 'Capstone demo'] })}
    <div class="form-grid">${input({ id: 'date', label: 'Date', type: 'date', value: v.date, error: errs.date })}${input({ id: 'time', label: 'Start time', type: 'time', value: v.time })}${input({ id: 'mins', label: 'Minutes', type: 'number', value: v.mins, error: errs.mins })}</div>
    <div class="form-grid">${select({ id: 'mode', label: 'Mode', value: v.mode, options: [['online', 'Online'], ['campus', 'On campus']] })}${input({ id: 'room', label: 'Room (campus)', value: v.room })}</div>
    <p class="hint">Instructor clashes are checked automatically. Online sessions get a meeting link from the video provider when it is connected.</p>
    <div class="row"><button class="btn btn-primary" type="submit">${x ? 'Save new time' : 'Schedule'}</button></div></form>` }));
}

function attendanceSheet(ctx, id) {
  const x = ctx.s.sessions.find((y) => y.id === id);
  const members = ctx.s.students.filter((s) => s.cohortId === x.cohortId && s.status !== 'withdrawn');
  ctx.modal({ title: `Attendance: ${x.title}`, wide: true, body: `<p class="small muted">${fmtDateTime(x.start)} · ${members.length} learners. Importing from the meeting provider needs the video integration; mark manually here.</p><div class="row">${btn('All present', { act: '', sm: true, attrs: { 'data-all': '1' } })}${btn('Clear', { sm: true, attrs: { 'data-all': '0' } })}</div><div class="att-grid">${members.map((s) => `<label class="check"><input type="checkbox" data-sid="${s.id}" ${x.attendance?.[s.id] ? 'checked' : ''}><span>${esc(s.name)}</span></label>`).join('')}</div>`, foot: `<button class="btn btn-ghost" type="button" data-close>Cancel</button><button class="btn btn-primary" id="att-save" type="button">Save attendance</button>`, onMount: (m, close) => {
    m.parentElement.querySelectorAll('[data-close]').forEach((b) => (b.onclick = close));
    m.querySelectorAll('[data-all]').forEach((b) => (b.onclick = (e) => { e.preventDefault(); m.querySelectorAll('[data-sid]').forEach((c) => (c.checked = b.dataset.all === '1')); }));
    m.querySelector('#att-save').onclick = () => { const map = Object.fromEntries([...m.querySelectorAll('[data-sid]')].map((c) => [c.dataset.sid, c.checked])); if (ctx.commit('attendance.mark', (s) => { const y = s.sessions.find((z) => z.id === id); y.attendance = map; if (y.status === 'scheduled' && y.start < new Date().toISOString()) y.status = 'completed'; }, { ok: `Saved: ${Object.values(map).filter(Boolean).length} present`, audit: { action: 'attendance.mark', entity: 'session', entityId: id, detail: `${Object.values(map).filter(Boolean).length}/${members.length} present` } }) === true) close(); };
  } });
}

function feedbackForm(ctx, id) {
  ctx.modal({ title: 'Rate this session', body: `<fieldset class="rating" style="border:0;padding:0"><legend class="small">How useful was it?</legend><div class="row">${[1, 2, 3, 4, 5].map((n) => `<label class="chip"><input type="radio" name="rt" value="${n}" class="sr-only"><span>${n} ★</span></label>`).join('')}</div></fieldset>${textarea({ id: 'fb-c', label: 'Comment (optional)', rows: 2 })}`, foot: `<button class="btn btn-primary" id="fb-go" type="button">Send feedback</button>`, onMount: (m, close) => {
    m.querySelectorAll('input[name=rt]').forEach((r) => r.addEventListener('change', () => m.querySelectorAll('.rating .chip').forEach((c) => c.setAttribute('aria-pressed', c.querySelector('input').checked))));
    m.querySelector('#fb-go').onclick = () => { const r = m.querySelector('input[name=rt]:checked'); if (!r) return ctx.toast('Choose a rating from 1 to 5.', { tone: 'bad' }); if (ctx.commit('session.feedback', (s) => { s.sessions.find((y) => y.id === id).feedback.push({ studentId: ctx.me.id, rating: Number(r.value), comment: m.querySelector('#fb-c').value }); }, { ok: 'Thanks for the feedback' }) === true) close(); };
  } });
}

// =================================================================== MENTORS
const REQ_PILL = { open: ['Waiting', 'p-warn'], scheduled: ['Scheduled', 'p-info'], resolved: ['Resolved', 'p-ok'], escalated: ['Escalated', 'p-bad'] };
export const mentors = {
  perms: ['mentor.request', 'mentor.workspace'],
  title: () => 'Mentors',
  render(ctx) { return ctx.me.role === 'student' ? studentMentor(ctx) : mentorWorkspace(ctx); },
  actions: {
    tab(el, e, ctx) { ctx.local('mw').tab = el.dataset.id; ctx.rerender(); },
    pickMentor(el, e, ctx) { ctx.local('mw').mentor = el.value; ctx.rerender(); },
    schedule(el, e, ctx) {
      const r = ctx.s.mentorRequests.find((x) => x.id === el.dataset.id);
      const m = ctx.s.users.find((u) => u.id === r.mentorId);
      ctx.modal({ title: 'Schedule help session', body: `<p class="small">${esc(displayName(ctx.s, r.studentId))}: ${esc(r.topic)}</p>${select({ id: 'sl', label: 'Slot', options: nextSlots(ctx, m).map((s) => [s, fmtDateTime(s)]) })}${textarea({ id: 'sl-msg', label: 'Message to learner', rows: 2, value: 'Booked. Bring the code or question you are stuck on.' })}`, foot: `<button class="btn btn-primary" id="sl-go" type="button">Schedule</button>`, onMount: (mm, close) => { mm.querySelector('#sl-go').onclick = () => { if (ctx.commit('mentor.schedule', (s) => { const x = s.mentorRequests.find((y) => y.id === r.id); x.status = 'scheduled'; x.slot = mm.querySelector('#sl').value; x.messages.push({ by: ctx.me.id, at: new Date().toISOString(), text: mm.querySelector('#sl-msg').value }); ctx.notify(x.studentId, 'mentor', 'Mentor session scheduled', fmtDateTime(x.slot), '/mentors'); }, { ok: 'Scheduled and learner notified' }) === true) close(); }; } });
    },
    resolve(el, e, ctx) {
      const r = ctx.s.mentorRequests.find((x) => x.id === el.dataset.id);
      ctx.modal({ title: 'Resolve request', body: `${textarea({ id: 'rs', label: 'Summary and next steps for the learner', req: true, rows: 3 })}`, foot: `<button class="btn btn-primary" id="rs-go" type="button">Mark resolved</button>`, onMount: (m, close) => { m.querySelector('#rs-go').onclick = () => { const t = m.querySelector('#rs').value.trim(); if (t.length < 10) return ctx.toast('Write a short summary (10+ characters).', { tone: 'bad' }); if (ctx.commit('mentor.resolve', (s) => { const x = s.mentorRequests.find((y) => y.id === r.id); x.status = 'resolved'; x.messages.push({ by: ctx.me.id, at: new Date().toISOString(), text: t }); ctx.notify(x.studentId, 'mentor', 'Your mentor responded', t.slice(0, 80), '/mentors'); }, { ok: 'Resolved' }) === true) close(); }; } });
    },
    escalate(el, e, ctx) {
      ctx.modal({ title: 'Escalate to the academic director', body: textarea({ id: 'es', label: 'Why does this need escalation?', req: true, rows: 3 }), foot: `<button class="btn btn-danger solid" id="es-go" type="button">Escalate</button>`, onMount: (m, close) => { m.querySelector('#es-go').onclick = () => { const t = m.querySelector('#es').value.trim(); if (t.length < 10) return ctx.toast('Explain the reason (10+ characters).', { tone: 'bad' }); if (ctx.commit('mentor.escalate', (s) => { const x = s.mentorRequests.find((y) => y.id === el.dataset.id); x.status = 'escalated'; x.messages.push({ by: ctx.me.id, at: new Date().toISOString(), text: `Escalated: ${t}` }); s.users.filter((u) => u.role === 'director').forEach((u) => ctx.notify(u.id, 'admin', 'Mentor escalation', `${displayName(s, x.studentId)}: ${t.slice(0, 60)}`, '/mentors')); }, { ok: 'Escalated', audit: { action: 'mentor.escalate', entity: 'request', entityId: el.dataset.id, detail: t } }) === true) close(); }; } });
    },
    note(el, e, ctx) { noteForm(ctx, el.dataset.id); },
    rate(el, e, ctx) {
      ctx.modal({ title: 'Rate the help you got', body: `${select({ id: 'rr', label: 'Rating', options: [[5, '5 · Excellent'], [4, '4 · Helpful'], [3, '3 · Okay'], [2, '2 · Not much help'], [1, '1 · Unhelpful']] })}${textarea({ id: 'rr-t', label: 'Comment', rows: 2 })}`, foot: `<button class="btn btn-primary" id="rr-go" type="button">Send</button>`, onMount: (m, close) => { m.querySelector('#rr-go').onclick = () => { if (ctx.commit('mentor.rate', (s) => { s.mentorRequests.find((y) => y.id === el.dataset.id).feedback = { rating: Number(m.querySelector('#rr').value), text: m.querySelector('#rr-t').value }; }, { ok: 'Thanks' }) === true) close(); }; } });
    },
    ivMove(el, e, ctx) { ivDialog(ctx, el.dataset.id, el.dataset.to); },
  },
  forms: {
    help(form, d, ctx) {
      const st = ctx.s.students.find((x) => x.id === ctx.me.id);
      if ((d.topic || '').trim().length < 5) return ctx.toast('Give your request a short title (5+ characters).', { tone: 'bad' });
      if ((d.detail || '').trim().length < 20) return ctx.toast('Describe what you tried (20+ characters) so your mentor can prepare.', { tone: 'bad' });
      ctx.commit('mentor.request', (s) => { s.mentorRequests.push({ id: uid('MR'), studentId: st.id, mentorId: st.mentorId, kind: d.kind, topic: d.topic.trim(), detail: d.detail.trim(), slot: null, preferred: d.slot || null, status: 'open', createdAt: new Date().toISOString(), messages: [], feedback: null }); ctx.notify(st.mentorId, 'mentor', 'New help request', `${st.name}: ${d.topic.trim()}`, '/mentors'); }, { ok: 'Request sent. Your mentor will pick a slot.' });
      form.reset();
    },
  },
};

function nextSlots(ctx, m) {
  const map = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 0 };
  const out = [];
  for (let d = 1; d <= 10; d++) { const day = addDays(ctx.now, d); (m?.slots || ['Mon 18:00']).forEach((s) => { const [dn, t] = s.split(' '); if (map[dn] === day.getDay()) { const [h, mi] = t.split(':'); const x = new Date(day); x.setHours(+h, +mi, 0, 0); out.push(x.toISOString()); } }); }
  return out.slice(0, 6);
}

function studentMentor(ctx) {
  const st = ctx.s.students.find((x) => x.id === ctx.me.id);
  const m = ctx.s.users.find((u) => u.id === st.mentorId);
  const reqs = ctx.s.mentorRequests.filter((r) => r.studentId === st.id).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return `<div class="page">${pageHead({ title: 'Mentors and help', lede: 'Ask for help with a doubt, a code review, or career guidance. Your mentor schedules a slot from their office hours.' })}
    <div class="grid g-main"><div class="stack"><form class="panel stack" data-form="help" novalidate><h2>Request help</h2>
      <div class="form-grid">${select({ id: 'kind', label: 'Type', options: [['doubt', 'Doubt'], ['code-review', 'Code review'], ['career', 'Career guidance'], ['1:1', 'One-to-one check-in']] })}${select({ id: 'slot', label: 'Preferred slot', options: [['', 'Any time'], ...nextSlots(ctx, m).map((s) => [s, fmtDateTime(s)])] })}</div>
      ${input({ id: 'topic', label: 'Title', req: true, a: { placeholder: 'Stuck on BFS visiting nodes twice' } })}
      ${textarea({ id: 'detail', label: 'What did you try?', req: true, rows: 3, hint: 'Share links to the lesson, problem or repository. Do not paste passwords or keys.' })}
      <div class="row"><button class="btn btn-primary" type="submit">Send request</button></div></form>
      <section class="panel"><div class="panel-head"><h2>My requests</h2></div>${reqs.length ? `<div class="list">${reqs.map((r) => `<div class="item" style="align-items:flex-start"><span class="grow min0"><span class="t">${esc(r.topic)}</span><br><span class="s">${esc(r.kind)} · sent ${fmtShort(r.createdAt)}${r.slot ? ` · session ${fmtDateTime(r.slot)}` : ''}</span>${r.messages.length ? `<div class="small" style="margin-top:6px"><b>${esc(displayName(ctx.s, r.messages[r.messages.length - 1].by))}:</b> ${esc(r.messages[r.messages.length - 1].text)}</div>` : ''}</span><div class="stack" style="--gap:6px;align-items:flex-end">${pill(...REQ_PILL[r.status])}${r.status === 'resolved' && !r.feedback ? btn('Rate', { act: 'rate', sm: true, attrs: { 'data-id': r.id } }) : r.feedback ? `<span class="xs muted">You rated ${r.feedback.rating}/5</span>` : ''}</div></div>`).join('')}</div>` : empty('No requests yet', '', { ic: 'chat' })}</section></div>
    <section class="panel stack"><h2>Your mentor</h2><div class="row nowrap">${avatar(m.name, 'lg')}<div><b>${esc(m.name)}</b><div class="small muted">${m.domains.map((d) => esc(d)).join(', ')} · office hours ${m.slots.join(', ')}</div></div></div><p class="small muted">Private notes your mentor keeps about your progress are visible only to mentors and academic leadership, never to other learners.</p></section></div></div>`;
}

function mentorWorkspace(ctx) {
  const W = ctx.local('mw', { tab: 'learners', mentor: ctx.me.role === 'mentor' ? ctx.me.id : 'all' });
  const mentorsList = ctx.s.users.filter((u) => u.role === 'mentor');
  const mid = ctx.me.role === 'mentor' ? ctx.me.id : W.mentor;
  const learners = ctx.s.students.filter((s) => (mid === 'all' ? true : s.mentorId === mid) && s.status !== 'withdrawn');
  const reqs = ctx.s.mentorRequests.filter((r) => mid === 'all' || r.mentorId === mid);
  const risk = new Map(ctx.risk().map((r) => [r.studentId, r]));
  const ivs = ctx.s.interventions.filter((iv) => learners.some((s) => s.id === iv.studentId));
  const followups = [...reqs.filter((r) => r.status === 'scheduled'), ...ivs.filter((iv) => ['planned', 'followup', 'notified'].includes(iv.state))];
  let body;
  if (W.tab === 'learners') body = `<section class="panel flush">${table([
    { key: 'n', label: 'Learner', sort: (s) => s.name, render: (s) => `<a href="#/dashboard?student=${s.id}" style="font-weight:600;text-decoration:none">${esc(s.name)}</a><div class="sub">${esc(ctx.s.cohorts.find((c) => c.id === s.cohortId)?.name || '')}</div>` },
    { key: 'p', label: 'Progress', render: (s) => { const e = ctx.s.enrollments.filter((x) => x.studentId === s.id && x.status === 'active'); const c = e[0] ? ctx.s.courses.find((y) => y.id === e[0].courseId) : null; const p = c ? progressOf(c, e[0]) : null; return p ? `${bar(p.pct)}<span class="sub">${c.id} ${p.pct}%</span>` : '<span class="muted">All complete</span>'; } },
    { key: 'r', label: 'Risk', sort: (s) => ({ high: 3, medium: 2, low: 1, none: 0 }[risk.get(s.id)?.level || 'none']), render: (s) => pill(riskLabel[risk.get(s.id)?.level || 'none'], riskTone[risk.get(s.id)?.level || 'none']) },
    { key: 'a', label: 'Last active', sort: (s) => lastActive(ctx.idx(), s.id) || '', render: (s) => { const la = lastActive(ctx.idx(), s.id); return la ? relDays(la, ctx.now) : 'never'; } },
    { key: 'rd', label: 'Readiness', r: true, sort: (s) => readiness(ctx.s, s).score, render: (s) => readiness(ctx.s, s).score },
    { key: 'x', label: '', r: true, render: (s) => (ctx.can('mentor.notes') ? btn('Notes', { act: 'note', sm: true, attrs: { 'data-id': s.id } }) : '') },
  ], learners, { sortKey: W.sort || 'r', sortDir: W.dir || 'desc', sortAct: 'mwSort', empty: 'No assigned learners.' })}</section>`;
  else if (W.tab === 'queue') body = `<div class="stack" style="--gap:10px">${reqs.filter((r) => ['open', 'scheduled', 'escalated'].includes(r.status)).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)).map((r) => `<article class="panel"><div class="spread"><div class="min0"><b>${esc(r.topic)}</b><div class="small muted">${esc(displayName(ctx.s, r.studentId))} · ${esc(r.kind)} · ${relDays(r.createdAt, ctx.now)}${r.preferred ? ` · prefers ${fmtDateTime(r.preferred)}` : ''}${r.slot ? ` · booked ${fmtDateTime(r.slot)}` : ''}</div></div>${pill(...REQ_PILL[r.status])}</div><p class="small" style="margin-top:6px">${esc(r.detail || '')}</p><div class="row" style="margin-top:8px">${r.status === 'open' ? btn('Schedule', { act: 'schedule', sm: true, cls: 'btn-primary', attrs: { 'data-id': r.id } }) : ''}${btn('Resolve', { act: 'resolve', sm: true, attrs: { 'data-id': r.id } })}${r.status !== 'escalated' ? btn('Escalate', { act: 'escalate', sm: true, cls: 'btn-quiet', attrs: { 'data-id': r.id } }) : ''}${r.kind === 'code-review' ? `<span class="xs muted">Code review: open the learner's project or repository link from their profile.</span>` : ''}</div></article>`).join('') || empty('Queue is clear', '', { ic: 'check' })}</div>`;
  else if (W.tab === 'plans') body = `<div class="stack" style="--gap:10px">${ivs.map((iv) => { const st = ctx.s.students.find((s) => s.id === iv.studentId); return `<article class="panel"><div class="spread"><b>${esc(st.name)}</b>${pill(IV_LABEL[iv.state], iv.state === 'resolved' ? 'p-ok' : iv.state === 'escalated' ? 'p-bad' : 'p-warn')}</div>${iv.plan ? `<p class="small"><b>Plan:</b> ${esc(iv.plan)}</p>` : ''}${timeline(iv.history.slice(-3).map((h) => ({ title: IV_LABEL[h.state], sub: `${esc(displayName(ctx.s, h.by))} · ${fmtShort(h.at)} · ${esc(h.note)}` })))}<div class="row">${nextIvStates(iv.state).map((to) => btn(IV_LABEL[to], { act: 'ivMove', sm: true, cls: to === 'escalated' ? 'btn-danger' : 'btn-ghost', attrs: { 'data-id': iv.id, 'data-to': to } })).join('')}</div></article>`; }).join('') || empty('No intervention plans', 'Plans appear when a learner is flagged by the risk rules.', { ic: 'pulse' })}</div>`;
  else {
    const rows = mentorsList.map((m) => { const n = ctx.s.students.filter((s) => s.mentorId === m.id && s.status === 'active').length; const open = ctx.s.mentorRequests.filter((r) => r.mentorId === m.id && r.status === 'open').length; const done = ctx.s.mentorRequests.filter((r) => r.mentorId === m.id && r.status === 'resolved'); const rated = done.filter((r) => r.feedback); return { m, n, open, done: done.length, rating: rated.length ? rated.reduce((a, r) => a + r.feedback.rating, 0) / rated.length : null }; });
    body = `<section class="panel flush">${table([{ key: 'm', label: 'Mentor', render: (r) => `<b>${esc(r.m.name)}</b>` }, { key: 'n', label: 'Learners vs capacity', render: (r) => `${bar((r.n / r.m.capacity) * 100, r.n > r.m.capacity ? 'bad' : r.n > r.m.capacity * 0.85 ? 'warn' : '')}<span class="sub">${r.n} of ${r.m.capacity}</span>` }, { key: 'o', label: 'Open requests', r: true, render: (r) => r.open }, { key: 'd', label: 'Resolved', r: true, render: (r) => r.done }, { key: 'rt', label: 'Avg rating', r: true, render: (r) => (r.rating ? r.rating.toFixed(1) : 'n/a') }], rows)}</section>`;
  }
  const open = reqs.filter((r) => r.status === 'open').length;
  return `<div class="page">${pageHead({ title: 'Mentor workspace', lede: 'Assigned learners, help queue, intervention plans and follow-ups.', actions: ctx.me.role !== 'mentor' ? select({ id: 'mw-m', value: W.mentor, options: [['all', 'All mentors'], ...mentorsList.map((m) => [m.id, m.name])], a: { 'data-change': 'pickMentor', 'aria-label': 'Mentor' } }) : '' })}
    <div class="kpis">${kpi({ label: 'Assigned learners', value: learners.length })}${kpi({ label: 'Open requests', value: open, alert: open > 3 })}${kpi({ label: 'Follow-ups due', value: followups.length })}${kpi({ label: 'High-risk learners', value: learners.filter((s) => risk.get(s.id)?.level === 'high').length, alert: learners.some((s) => risk.get(s.id)?.level === 'high') })}</div>
    ${tabs([['learners', 'Learners', learners.length], ['queue', 'Help queue', open], ['plans', 'Action plans', ivs.length], ['load', 'Workload']], W.tab, 'tab')}${body}</div>`;
}
mentors.actions.mwSort = (el, e, ctx) => { const W = ctx.local('mw'); W.dir = W.sort === el.dataset.id && W.dir === 'desc' ? 'asc' : 'desc'; W.sort = el.dataset.id; ctx.rerender(); };

function noteForm(ctx, sid) {
  const st = ctx.s.students.find((s) => s.id === sid);
  const render = () => { const notes = ctx.s.mentorNotes.filter((n) => n.studentId === sid && canReadMentorNote(ctx.me, n)).sort((a, b) => (a.at < b.at ? 1 : -1)); return { title: `Private notes: ${st.name}`, sub: 'Visible to the mentor, the academic director and super admins only', body: `<form class="stack" id="note-form">${textarea({ id: 'nt', label: 'New note', rows: 3 })}<div class="row"><button class="btn btn-primary btn-sm" type="submit">Save note</button></div></form><div class="list">${notes.map((n) => `<div class="item" style="align-items:flex-start"><span class="grow min0 small">${esc(n.text)}<br><span class="s">${esc(displayName(ctx.s, n.mentorId))} · ${fmtDateTime(n.at)}</span></span></div>`).join('') || '<p class="small muted">No notes yet.</p>'}</div>` }; };
  ctx.openPanel(render);
  const wire = () => { const f = document.querySelector('#note-form'); if (f) f.onsubmit = (e) => { e.preventDefault(); const t = f.querySelector('#nt').value.trim(); if (t.length < 3) return; ctx.commit('mentor.note', (s) => { s.mentorNotes.push({ id: uid('MN'), studentId: sid, mentorId: ctx.me.id, at: new Date().toISOString(), text: t, private: true }); }, { ok: 'Note saved', audit: { action: 'mentor.note', entity: 'student', entityId: sid, detail: 'Private note added', kind: 'data' } }); setTimeout(wire, 50); }; };
  wire();
}

export function ivDialog(ctx, id, to) {
  const needs = ['planned', 'resolved', 'escalated'].includes(to);
  ctx.modal({ title: `Move to: ${IV_LABEL[to]}`, body: needs ? textarea({ id: 'iv-n', label: to === 'planned' ? 'Intervention plan agreed with the learner' : to === 'resolved' ? 'Outcome (what changed?)' : 'Escalation reason', req: true, rows: 3 }) : `<p>Record that this step happened. It is logged with your name and the time.</p>${textarea({ id: 'iv-n', label: 'Note (optional)', rows: 2 })}`, foot: `<button class="btn btn-primary" id="iv-go" type="button">Save</button>`, onMount: (m, close) => { m.querySelector('#iv-go').onclick = () => { const note = m.querySelector('#iv-n').value; if (ctx.commit('iv.move', (s) => { const iv = s.interventions.find((x) => x.id === id); advanceIntervention(iv, to, ctx.me.id, note, new Date()); if (to === 'escalated') s.users.filter((u) => u.role === 'director').forEach((u) => ctx.notify(u.id, 'admin', 'Intervention escalated', displayName(s, iv.studentId), '/ops/risk')); }, { ok: `Moved to ${IV_LABEL[to]}`, audit: { action: 'intervention.advance', entity: 'intervention', entityId: id, detail: `${to}: ${note}`.slice(0, 120) } }) === true) close(); }; } });
}

// =================================================================== DISCUSSIONS
const KIND = { doubt: ['Doubt', 'p-warn'], discussion: ['Discussion', 'p-info'], 'code-review': ['Code review', 'p-accent'], announcement: ['Announcement', 'p-pencil'] };
const blockedBy = (ctx) => new Set(ctx.s.prefs[ctx.me.id]?.blocked || []);
export const discussions = {
  perms: ['community.post', 'community.moderate'],
  flag: 'community',
  title: () => 'Discussions',
  render(ctx) {
    const F = ctx.local('disc', { scope: 'all', kind: 'all', q: '', tab: 'threads' });
    const blocked = blockedBy(ctx);
    let list = ctx.s.threads.filter((t) => canSeeThread(ctx.s, ctx.me, t) && !blocked.has(t.authorId));
    const myCourses = ctx.me.role === 'student' ? ctx.s.enrollments.filter((e) => e.studentId === ctx.me.id).map((e) => e.courseId) : null;
    if (F.scope === 'mine' && myCourses) list = list.filter((t) => t.scope.type === 'cohort' || myCourses.includes(t.scope.id));
    if (F.scope === 'cohort') list = list.filter((t) => t.scope.type === 'cohort');
    if (F.kind !== 'all') list = list.filter((t) => t.kind === F.kind);
    if (F.q) list = list.filter((t) => `${t.title} ${t.body} ${t.tags.join(' ')} ${t.replies.map((r) => r.body).join(' ')}`.toLowerCase().includes(F.q.toLowerCase()));
    list.sort((a, b) => (a.kind === 'announcement') - (b.kind === 'announcement') || (a.at < b.at ? 1 : -1));
    list = [...list.filter((t) => t.kind === 'announcement'), ...list.filter((t) => t.kind !== 'announcement')];
    const reported = ctx.s.threads.filter((t) => t.reports.length && t.status !== 'hidden');
    const mod = ctx.can('community.moderate');
    const body = F.tab === 'mod' && mod ? `<div class="stack" style="--gap:10px">${reported.map((t) => `<article class="panel"><div class="spread"><b>${esc(t.title)}</b>${pill(`${t.reports.length} report${t.reports.length > 1 ? 's' : ''}`, 'p-bad')}</div>${t.reports.map((r) => `<p class="small">${esc(displayName(ctx.s, r.by))}: ${esc(r.reason)} · ${fmtShort(r.at)}</p>`).join('')}<div class="row">${btn('Open thread', { href: `/discussions/${t.id}`, sm: true })}${btn('Hide thread', { act: 'mod', sm: true, cls: 'btn-danger', attrs: { 'data-id': t.id, 'data-op': 'hide' } })}${btn('Dismiss reports', { act: 'mod', sm: true, attrs: { 'data-id': t.id, 'data-op': 'dismiss' } })}</div></article>`).join('') || empty('No open reports', '', { ic: 'check' })}</div>`
      : `<div class="stack" style="--gap:10px">${list.map((t) => threadRow(ctx, t)).join('') || empty('No threads match', 'Start one with New thread.', { ic: 'chat' })}</div>`;
    return `<div class="page">${pageHead({ title: 'Discussions', lede: 'Course forums, cohort channels, doubt threads and peer code review. Cohort channels are private to their members.', actions: ctx.can('community.post') ? btn('New thread', { act: 'newThread', cls: 'btn-primary', ic: 'plus' }) : '' })}
      ${mod ? tabs([['threads', 'Threads'], ['mod', 'Moderation', reported.length]], F.tab, 'tab') : ''}
      ${F.tab !== 'mod' ? `<div class="toolbar"><div class="grow-field">${searchBox({ id: 'dq', value: F.q, placeholder: 'Search discussions and replies', a: { 'data-input': 'q' } })}</div>${select({ id: 'ds', label: 'Scope', value: F.scope, options: [['all', 'Everything I can see'], ...(myCourses ? [['mine', 'My courses and cohort']] : []), ['cohort', 'Cohort channels']], a: { 'data-change': 'f', 'data-key': 'scope' } })}${select({ id: 'dk', label: 'Type', value: F.kind, options: [['all', 'All'], ...Object.entries(KIND).map(([k, v]) => [k, v[0]])], a: { 'data-change': 'f', 'data-key': 'kind' } })}</div>` : ''}${body}
      <p class="hint">Direct messages connect through your chat integration (for example Slack or Teams); they are not stored in this prototype.</p></div>`;
  },
  actions: {
    tab(el, e, ctx) { ctx.local('disc').tab = el.dataset.id; ctx.rerender(); },
    f(el, e, ctx) { ctx.local('disc')[el.dataset.key] = el.value; ctx.rerender(); },
    q(el, e, ctx) { ctx.local('disc').q = el.value; clearTimeout(dT); dT = setTimeout(() => ctx.rerender(), 180); },
    newThread(el, e, ctx) { threadForm(ctx); },
    mod(el, e, ctx) { moderate(ctx, el.dataset.id, el.dataset.op); },
  },
  forms: {
    thread(form, d, ctx) {
      if ((d.title || '').trim().length < 6 || (d.body || '').trim().length < 15) return ctx.toast('Add a clear title (6+ characters) and details (15+ characters).', { tone: 'bad' });
      const [type, id] = d.scope.split(':');
      const t = { id: uid('TH'), scope: { type, id }, kind: d.kind, title: d.title.trim(), body: d.body.trim(), tags: d.tags.split(',').map((x) => x.trim()).filter(Boolean), authorId: ctx.me.id, at: new Date().toISOString(), replies: [], status: 'open', reports: [], upvotes: 0 };
      ctx.commit('thread.create', (s) => { s.threads.unshift(t); if (t.kind === 'announcement' && type === 'course') s.enrollments.filter((e) => e.courseId === id).forEach((e) => ctx.notify(e.studentId, 'announcement', t.title, t.body.slice(0, 80), `/discussions/${t.id}`)); }, { ok: 'Thread posted' });
      document.querySelector('#drawer [data-close]')?.click();
      ctx.nav(`/discussions/${t.id}`);
    },
  },
};
let dT;
function threadRow(ctx, t) {
  const scope = t.scope.type === 'course' ? t.scope.id : 'Cohort channel';
  return `<a class="panel thread-row" href="#/discussions/${t.id}"><div class="row nowrap" style="--gap:12px;align-items:flex-start"><div class="votes"><b>${t.upvotes}</b><span class="xs muted">votes</span></div><div class="grow min0"><div class="row" style="--gap:6px">${pill(...KIND[t.kind])}${t.status === 'resolved' || t.replies.some((r) => r.accepted) ? pill('Answered', 'p-ok') : ''}${t.status === 'locked' ? pill('Locked', 'p-mute') : ''}${t.status === 'hidden' ? pill('Hidden', 'p-bad') : ''}<span class="mono xs muted">${esc(scope)}</span></div><b style="display:block;margin-top:4px">${esc(t.title)}</b><span class="small muted">${esc(t.body.slice(0, 140))}</span><div class="xs muted" style="margin-top:4px">${esc(displayName(ctx.s, t.authorId))} · ${relDays(t.at, ctx.now)} · ${t.replies.length} repl${t.replies.length === 1 ? 'y' : 'ies'}</div></div></div></a>`;
}

function threadForm(ctx) {
  const opts = [];
  if (ctx.me.role === 'student') {
    const st = ctx.s.students.find((x) => x.id === ctx.me.id);
    ctx.s.enrollments.filter((e) => e.studentId === st.id).forEach((e) => opts.push([`course:${e.courseId}`, `${e.courseId} forum`]));
    opts.push([`cohort:${st.cohortId}`, 'My cohort channel (private)']);
  } else {
    teachingCourseIds(ctx.s, ctx.me).forEach((id) => opts.push([`course:${id}`, `${id} forum`]));
    visibleCohorts(ctx.s, ctx.me).slice(0, 12).forEach((c) => opts.push([`cohort:${c.id}`, `${c.name} channel`]));
  }
  ctx.openPanel(() => ({ title: 'New thread', body: `<form data-form="thread" class="stack" novalidate>${select({ id: 'scope', label: 'Where', options: opts })}${select({ id: 'kind', label: 'Type', options: [['doubt', 'Doubt'], ['discussion', 'Discussion'], ['code-review', 'Code review request'], ...(ctx.me.role !== 'student' ? [['announcement', 'Announcement (notifies enrolled learners)']] : [])] })}${input({ id: 'title', label: 'Title', req: true })}${textarea({ id: 'body', label: 'Details', req: true, rows: 5, hint: 'For code, paste the smallest snippet that shows the problem. Never post credentials.' })}${input({ id: 'tags', label: 'Tags (comma separated)' })}<div class="row"><button class="btn btn-primary" type="submit">Post</button></div></form>` }));
}

function moderate(ctx, id, op) {
  const labels = { hide: 'Thread hidden', dismiss: 'Reports dismissed', lock: 'Thread locked', unlock: 'Thread unlocked', resolve: 'Marked resolved', unhide: 'Thread restored' };
  ctx.commit('thread.mod', (s) => { const t = s.threads.find((x) => x.id === id); if (op === 'hide') t.status = 'hidden'; if (op === 'unhide') t.status = 'open'; if (op === 'dismiss') t.reports = []; if (op === 'lock') t.status = 'locked'; if (op === 'unlock') t.status = 'open'; if (op === 'resolve') t.status = 'resolved'; }, { ok: labels[op], audit: { action: `moderation.${op}`, entity: 'thread', entityId: id } });
}

export const thread = {
  perms: ['community.post', 'community.moderate'],
  flag: 'community',
  title: (ctx) => ctx.s.threads.find((t) => t.id === ctx.params.id)?.title || 'Thread',
  render(ctx) {
    const t = ctx.s.threads.find((x) => x.id === ctx.params.id);
    if (!t || !canSeeThread(ctx.s, ctx.me, t)) return empty('Thread not available', 'It may be in a private channel you are not part of, or hidden by a moderator.', { ic: 'lock' });
    const mod = ctx.can('community.moderate');
    const owner = t.authorId === ctx.me.id;
    const blocked = blockedBy(ctx);
    const voted = (ctx.s.prefs[ctx.me.id]?.votes || []).includes(t.id);
    return `<div class="page" style="max-width:920px">${pageHead({ title: t.title, crumb: [['Discussions', '/discussions'], [t.scope.type === 'course' ? t.scope.id : 'Cohort channel']], lede: `${pill(...KIND[t.kind])} ${esc(displayName(ctx.s, t.authorId))} · ${fmtDateTime(t.at)}` })}
      <article class="panel stack" style="--gap:10px"><p style="white-space:pre-wrap">${esc(t.body)}</p><div class="chips">${t.tags.map((x) => `<span class="chip">${esc(x)}</span>`).join('')}</div>
        <div class="row">${btn(`${voted ? 'Upvoted' : 'Upvote'} · ${t.upvotes}`, { act: 'vote', sm: true, ic: 'thumbUp', attrs: { 'aria-pressed': String(voted) } })}${!owner ? btn('Report', { act: 'report', sm: true, cls: 'btn-quiet', ic: 'flag' }) : ''}${!owner && ctx.me.role === 'student' && !t.authorId.startsWith('U-') ? btn('Block author', { act: 'block', sm: true, cls: 'btn-quiet', attrs: { 'data-id': t.authorId } }) : ''}
        ${mod ? `<span class="grow"></span>${btn(t.status === 'locked' ? 'Unlock' : 'Lock', { act: 'mod', sm: true, attrs: { 'data-op': t.status === 'locked' ? 'unlock' : 'lock' } })}${btn(t.status === 'hidden' ? 'Restore' : 'Hide', { act: 'mod', sm: true, cls: 'btn-danger', attrs: { 'data-op': t.status === 'hidden' ? 'unhide' : 'hide' } })}` : ''}${(owner || mod) && t.status === 'open' ? btn('Mark resolved', { act: 'mod', sm: true, attrs: { 'data-op': 'resolve' } }) : ''}</div></article>
      <section class="stack" style="--gap:10px"><h2>${t.replies.length} repl${t.replies.length === 1 ? 'y' : 'ies'}</h2>${t.replies.filter((r) => !blocked.has(r.authorId)).map((r) => `<article class="panel reply ${r.accepted ? 'accepted' : ''}"><div class="row nowrap" style="align-items:flex-start">${avatar(displayName(ctx.s, r.authorId), 'sm')}<div class="grow min0"><div class="small"><b>${esc(displayName(ctx.s, r.authorId))}</b> <span class="muted">· ${fmtDateTime(r.at)}</span>${r.accepted ? ` ${pill('Accepted answer', 'p-ok')}` : ''}</div><p style="margin-top:4px;white-space:pre-wrap">${esc(r.body)}</p></div>${(owner || mod) && t.kind === 'doubt' && !r.accepted ? btn('Accept', { act: 'accept', sm: true, cls: 'btn-quiet', ic: 'check', attrs: { 'data-id': r.id } }) : ''}</div></article>`).join('')}
        ${t.status === 'locked' || t.status === 'hidden' ? '<div class="callout small">This thread is locked. New replies are disabled.</div>' : ctx.can('community.post') ? `<form class="panel stack" data-form="reply" style="--gap:8px">${textarea({ id: 'reply', label: 'Your reply', rows: 3 })}<div class="row"><button class="btn btn-primary btn-sm" type="submit">Reply</button></div></form>` : ''}</section></div>`;
  },
  actions: {
    vote(el, e, ctx) { ctx.commit('thread.vote', (s) => { const p = (s.prefs[ctx.me.id] ||= {}); p.votes ||= []; const t = s.threads.find((x) => x.id === ctx.params.id); if (p.votes.includes(t.id)) { p.votes = p.votes.filter((v) => v !== t.id); t.upvotes--; } else { p.votes.push(t.id); t.upvotes++; } }); },
    report(el, e, ctx) { ctx.modal({ title: 'Report this thread', body: select({ id: 'rp', label: 'Reason', options: ['Spam or advertising', 'Harassment or abuse', 'Off-topic', 'Shares answers to graded work', 'Other'] }), foot: `<button class="btn btn-danger solid" id="rp-go" type="button">Report</button>`, onMount: (m, close) => { m.querySelector('#rp-go').onclick = () => { if (ctx.commit('thread.report', (s) => { s.threads.find((x) => x.id === ctx.params.id).reports.push({ by: ctx.me.id, reason: m.querySelector('#rp').value, at: new Date().toISOString() }); }, { ok: 'Reported to moderators' }) === true) close(); }; } }); },
    block(el, e, ctx) { ctx.confirm({ title: 'Block this author?', body: 'You will no longer see their threads or replies. They are not notified. You can unblock in Preferences.', confirmLabel: 'Block' }).then((ok) => ok && ctx.commit('user.block', (s) => { const p = (s.prefs[ctx.me.id] ||= {}); p.blocked = [...new Set([...(p.blocked || []), el.dataset.id])]; }, { ok: 'Blocked' }) && ctx.nav('/discussions')); },
    mod(el, e, ctx) { moderate(ctx, ctx.params.id, el.dataset.op); },
    accept(el, e, ctx) { ctx.commit('thread.accept', (s) => { const t = s.threads.find((x) => x.id === ctx.params.id); t.replies.forEach((r) => (r.accepted = r.id === el.dataset.id)); t.status = 'resolved'; const r = t.replies.find((x) => x.id === el.dataset.id); ctx.notify(r.authorId, 'announcement', 'Your reply was accepted', t.title, `/discussions/${t.id}`); }, { ok: 'Answer accepted' }); },
  },
  forms: {
    reply(form, d, ctx) {
      if ((d.reply || '').trim().length < 2) return;
      ctx.commit('thread.reply', (s) => { const t = s.threads.find((x) => x.id === ctx.params.id); if (t.status === 'locked') throw new Error('This thread is locked.'); t.replies.push({ id: uid('RP'), authorId: ctx.me.id, at: new Date().toISOString(), body: d.reply.trim(), accepted: false }); if (t.authorId !== ctx.me.id) ctx.notify(t.authorId, 'mentor', 'New reply to your thread', t.title, `/discussions/${t.id}`); }, { ok: 'Reply posted' });
    },
  },
};

// =================================================================== STUDY GROUPS
export const groups = {
  perms: ['community.post'],
  flag: 'community',
  title: () => 'Study Groups',
  render(ctx) {
    const st = ctx.s.students.find((x) => x.id === ctx.me.id);
    const visible = ctx.s.groups.filter((g) => !st?.orgId || g.members.some((m) => ctx.s.students.find((x) => x.id === m)?.orgId === st.orgId));
    return `<div class="page">${pageHead({ title: 'Study groups', lede: 'Small peer groups for regular practice and project collaboration.', actions: ctx.me.role === 'student' ? btn('Start a group', { act: 'newGroup', cls: 'btn-primary', ic: 'plus' }) : '' })}
      <div class="grid g-auto" style="--min:300px">${visible.map((g) => { const member = g.members.includes(ctx.me.id); return `<section class="panel stack" style="--gap:8px"><div class="spread"><b>${esc(g.name)}</b>${member ? pill('Member', 'p-ok') : ''}</div><p class="small muted">${esc(g.topic)}</p><div class="meta"><span>${esc(g.schedule)}</span><span>${g.members.length} members</span><span>Owner ${esc(displayName(ctx.s, g.ownerId))}</span></div><div class="avatars">${g.members.slice(0, 7).map((m) => avatar(displayName(ctx.s, m), 'sm')).join('')}</div>${ctx.me.role === 'student' ? `<div class="row">${member ? (g.ownerId === ctx.me.id ? '<span class="xs muted">You own this group</span>' : btn('Leave', { act: 'leave', sm: true, attrs: { 'data-id': g.id } })) : btn(g.members.length >= 12 ? 'Full' : 'Join', { act: 'join', sm: true, cls: 'btn-primary', disabled: g.members.length >= 12, attrs: { 'data-id': g.id } })}</div>` : ''}</section>`; }).join('')}</div></div>`;
  },
  actions: {
    join(el, e, ctx) { ctx.commit('group.join', (s) => { const g = s.groups.find((x) => x.id === el.dataset.id); if (g.members.length >= 12) throw new Error('This group is full (12 members).'); g.members.push(ctx.me.id); ctx.notify(g.ownerId, 'announcement', 'New member in your study group', displayName(s, ctx.me.id), '/groups'); }, { ok: 'Joined' }); },
    leave(el, e, ctx) { ctx.commit('group.leave', (s) => { const g = s.groups.find((x) => x.id === el.dataset.id); g.members = g.members.filter((m) => m !== ctx.me.id); }, { ok: 'Left the group' }); },
    newGroup(el, e, ctx) { ctx.modal({ title: 'Start a study group', body: `${input({ id: 'g-n', label: 'Name', req: true })}${input({ id: 'g-t', label: 'What will you do together?', req: true })}${input({ id: 'g-s', label: 'When do you meet?', value: 'Sat 10:00' })}`, foot: `<button class="btn btn-primary" id="g-go" type="button">Create</button>`, onMount: (m, close) => { m.querySelector('#g-go').onclick = () => { const n = m.querySelector('#g-n').value.trim(), t = m.querySelector('#g-t').value.trim(); if (n.length < 3 || t.length < 5) return ctx.toast('Add a name and a short purpose.', { tone: 'bad' }); if (ctx.commit('group.create', (s) => { s.groups.unshift({ id: uid('G'), name: n, topic: t, schedule: m.querySelector('#g-s').value, ownerId: ctx.me.id, members: [ctx.me.id], domain: 'prog' }); }, { ok: 'Group created' }) === true) close(); }; } }); },
  },
};
