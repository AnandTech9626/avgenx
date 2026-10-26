// Career preparation: placement readiness and workflow, jobs with eligibility rules,
// applications, interview preparation and mock interviews, portfolio and resume builder.
import { esc, fmtDate, fmtDateTime, fmtShort, relDays, uid, iso, addDays } from '../core/util.js';
import { icon } from '../core/icons.js';
import { pageHead, pill, btn, empty, tabs, table, kpi, bar, ring, select, input, textarea, toggle, stepper, timeline, avatar, hbars, domainVar, check } from '../core/ui.js';
import { readiness, jobEligibility, APP_LABEL, APP_STAGES, solvedProblems } from '../domain/career.js';
import { displayName } from '../domain/scope.js';
import { PROBLEMS } from '../data/problems.js';
import { DOMAINS } from '../data/catalog.js';

const me = (ctx) => ctx.s.students.find((x) => x.id === ctx.me.id);
const emp = (ctx, id) => ctx.s.employers.find((e) => e.id === id);
const STAGE_PILL = { applied: 'p-mute', shortlisted: 'p-info', interview: 'p-warn', offer: 'p-pencil', hired: 'p-ok', rejected: 'p-bad', withdrawn: 'p-mute' };
const WF = ['Skill assessment', 'Readiness gaps', 'Practice plan', 'Mock interviews', 'Portfolio', 'Eligibility', 'Applications', 'Interviews', 'Offer'];

function workflowStage(ctx, st, r) {
  const apps = ctx.s.applications.filter((a) => a.studentId === st.id);
  const mocks = ctx.s.mockInterviews.filter((m) => m.studentId === st.id && m.status === 'completed');
  if (apps.some((a) => ['offer', 'hired'].includes(a.stage))) return 8;
  if (apps.some((a) => a.stage === 'interview')) return 7;
  if (apps.length) return 6;
  if (st.portfolio.public && mocks.length) return 5;
  if (mocks.length) return 4;
  if (r.parts.find((p) => p.id === 'dsa').value > 0.3) return 3;
  if (ctx.s.attempts.some((a) => a.studentId === st.id && a.status === 'graded')) return 1;
  return 0;
}

function practicePlan(ctx, st, r) {
  const plan = [];
  for (const g of r.gaps.slice(0, 4)) {
    if (g.id === 'dsa') { const solved = new Set(solvedProblems(ctx.s, st.id).map((p) => p.id)); const next = PROBLEMS.filter((p) => !solved.has(p.id) && p.sets.includes('product') && p.diff !== 'Hard').slice(0, 3); plan.push({ t: 'Close the problem-solving gap', s: `Solve ${next.map((p) => p.title).join(', ')}. Each Medium adds 2 readiness points toward the 40-point target.`, href: `/lab/${next[0]?.id || ''}`, cta: 'Start practising' }); }
    if (g.id === 'assessments') plan.push({ t: 'Raise your assessment average', s: g.detail + '. Retake an assessment with attempts left after revising the weakest topics.', href: '/assessments', cta: 'Assessments' });
    if (g.id === 'projects') plan.push({ t: 'Get your projects approved', s: g.detail + '. Approved projects also feed your portfolio.', href: '/projects', cta: 'Projects' });
    if (g.id === 'portfolio') plan.push({ t: 'Complete your portfolio', s: g.detail + ': make it public, add two projects, a headline and a GitHub link.', href: '/portfolio', cta: 'Portfolio' });
    if (g.id === 'mock') plan.push({ t: 'Book a mock interview', s: g.detail + '. A mentor scores you on a five-point rubric.', href: '/interview', cta: 'Book mock' });
    if (g.id === 'attendance') plan.push({ t: 'Attend live classes', s: g.detail + '. Interviewers ask about what you built in class.', href: '/live', cta: 'Schedule' });
  }
  return plan;
}

export const placement = {
  perms: ['career.self'],
  flag: 'placement',
  title: () => 'Placement Center',
  render(ctx) {
    const st = me(ctx);
    const r = readiness(ctx.s, st);
    const stage = workflowStage(ctx, st, r);
    const apps = ctx.s.applications.filter((a) => a.studentId === st.id);
    const plan = practicePlan(ctx, st, r);
    return `<div class="page">${pageHead({ title: 'Placement Center', lede: 'Readiness is a transparent, weighted guide for your preparation. It does not predict or guarantee a job offer.' })}
      <section class="panel"><div class="panel-head"><h2>Your placement journey</h2><span class="sub">Step ${stage + 1} of ${WF.length}</span></div>${stepper(WF, stage)}</section>
      <div class="grid g-main"><section class="panel"><div class="panel-head"><h2>Readiness breakdown</h2><span class="sub">Weights set by the placement office</span></div>
        <div class="row nowrap" style="--gap:20px;margin-bottom:14px">${ring(r.score, String(r.score), 96)}<div><b style="font-size:1.1rem">${r.level}</b><p class="small muted">75+ Ready · 55 to 74 Nearly ready · below 55 Building. Jobs set their own minimum.</p></div></div>
        <div class="stack" style="--gap:12px">${r.parts.map((p) => `<div><div class="spread small"><b>${esc(p.label.split(' (')[0])}</b><span class="mono">${p.value === null ? 'n/a' : `${Math.round(p.value * 100)}%`} × weight ${p.weight}</span></div>${bar(p.value === null ? 0 : p.value * 100, p.value !== null && p.value < 0.4 ? 'warn' : '')}<span class="hint">${esc(p.detail)}</span></div>`).join('')}</div></section>
        <div class="stack"><section class="panel"><div class="panel-head"><h2>Personalised practice plan</h2></div>${plan.length ? `<div class="list">${plan.map((x) => `<div class="item" style="align-items:flex-start"><span class="grow min0"><span class="t">${esc(x.t)}</span><br><span class="s">${esc(x.s)}</span></span>${btn(x.cta, { href: x.href, sm: true })}</div>`).join('')}</div>` : empty('No major gaps', 'Keep applying and practising.', { ic: 'check' })}</section>
        <section class="panel"><div class="panel-head"><h2>My applications</h2><a class="more" href="#/jobs">Find roles</a></div>${apps.length ? `<div class="list">${apps.map((a) => { const j = ctx.s.jobs.find((x) => x.id === a.jobId); return `<a class="item" href="#/jobs?job=${j.id}"><span class="grow min0"><span class="t small">${esc(j.title)}</span><br><span class="s">${esc(emp(ctx, j.employerId).name)} · updated ${fmtShort(a.history[a.history.length - 1].at)}</span></span>${pill(APP_LABEL[a.stage], STAGE_PILL[a.stage])}</a>`; }).join('')}</div>` : empty('No applications yet', 'Check eligible roles on Jobs and Internships.', { ic: 'brief' })}</section></div></div></div>`;
  },
};

export const jobs = {
  perms: ['career.self', 'placement.view'],
  flag: 'placement',
  title: () => 'Jobs and Internships',
  render(ctx) {
    const F = ctx.local('jobsF', { domain: 'all', kind: 'all', eligible: false });
    const student = ctx.me.role === 'student';
    const st = student ? me(ctx) : null;
    const r = st ? readiness(ctx.s, st) : null;
    const sel = ctx.query.job;
    let list = ctx.s.jobs.filter((j) => (F.domain === 'all' || j.domain === F.domain) && (F.kind === 'all' || j.kind === F.kind));
    if (student && F.eligible) list = list.filter((j) => jobEligibility(ctx.s, st, j, r).eligible);
    list.sort((a, b) => (a.status === b.status ? (a.deadline < b.deadline ? -1 : 1) : a.status === 'open' ? -1 : 1));
    return `<div class="page">${pageHead({ title: 'Jobs and internships', lede: 'Sample listings from fictional employers for this demo. Eligibility rules are shown for every role.' })}
      <div class="toolbar">${select({ id: 'jf-d', label: 'Domain', value: F.domain, options: [['all', 'All'], ...DOMAINS.map((d) => [d.id, d.short])], a: { 'data-change': 'f', 'data-key': 'domain' } })}${select({ id: 'jf-k', label: 'Type', value: F.kind, options: [['all', 'All'], ['job', 'Jobs'], ['internship', 'Internships']], a: { 'data-change': 'f', 'data-key': 'kind' } })}${student ? `<label class="check" style="padding-bottom:8px"><input type="checkbox" data-change="elig" ${F.eligible ? 'checked' : ''}><span>Only roles I am eligible for</span></label>` : ''}</div>
      <div class="grid g-auto" style="--min:320px">${list.map((j) => { const e = emp(ctx, j.employerId); const el = st ? jobEligibility(ctx.s, st, j, r) : null; const app = st ? ctx.s.applications.find((a) => a.jobId === j.id && a.studentId === st.id) : null; const n = ctx.s.applications.filter((a) => a.jobId === j.id).length; return `<article class="panel stack ${sel === j.id ? 'selected' : ''}" id="job-${j.id}" style="--gap:8px;${domainVar(j.domain)}"><div class="spread"><span class="mono small" style="color:var(--cat)">${j.kind === 'internship' ? 'INTERNSHIP' : 'JOB'} · ${esc(DOMAINS.find((d) => d.id === j.domain).short)}</span>${j.status === 'open' ? pill(`Closes ${relDays(j.deadline, ctx.now)}`, 'p-info', true) : pill('Closed', 'p-mute')}</div><h3>${esc(j.title)}</h3><div class="meta"><span>${esc(e.name)}</span><span>${esc(j.location)} · ${j.mode}</span><span>min readiness ${j.minReadiness}</span>${!student ? `<span>${n} applicants</span>` : ''}</div><div class="chips">${j.skills.map((s) => `<span class="chip">${esc(s)}</span>`).join('')}</div>
        ${st ? (app ? `<div class="row">${pill(APP_LABEL[app.stage], STAGE_PILL[app.stage])}${['applied', 'shortlisted'].includes(app.stage) ? btn('Withdraw', { act: 'withdraw', sm: true, cls: 'btn-quiet', attrs: { 'data-id': app.id } }) : ''}</div>${timeline(app.history.map((h) => ({ title: APP_LABEL[h.stage], sub: `${fmtDate(h.at)}${h.note ? ` · ${esc(h.note)}` : ''}`, cls: h.stage === 'rejected' ? 'fail' : 'done' })))}` : el.eligible ? `<div class="row">${btn('Apply', { act: 'apply', cls: 'btn-primary', sm: true, attrs: { 'data-id': j.id } })}<span class="small muted">You meet every rule.</span></div>` : `<div class="callout small"><b>Not eligible yet:</b> ${el.reasons.map(esc).join('; ')}.</div>`) : ''}
        <p class="xs muted">Demo listing; fictional employer.</p></article>`; }).join('') || empty('No roles match', 'Clear a filter.')}</div></div>`;
  },
  mount(root, ctx) { if (ctx.query.job) root.querySelector(`#job-${ctx.query.job}`)?.scrollIntoView({ block: 'center' }); },
  actions: {
    f(el, e, ctx) { ctx.local('jobsF')[el.dataset.key] = el.value; ctx.rerender(); },
    elig(el, e, ctx) { ctx.local('jobsF').eligible = el.checked; ctx.rerender(); },
    apply(el, e, ctx) {
      const j = ctx.s.jobs.find((x) => x.id === el.dataset.id);
      const st = me(ctx);
      const resumes = st.career.resumes;
      ctx.modal({ title: `Apply: ${j.title}`, body: `<p class="small">${esc(emp(ctx, j.employerId).name)} receives your portfolio link and the resume version you choose. The placement office tracks the application.</p>${resumes.length ? select({ id: 'ap-resume', label: 'Resume version', options: resumes.map((r) => [r.id, `${r.name} · saved ${fmtShort(r.at)}`]) }) : '<div class="callout warn small">You have no saved resume yet. The application will use your portfolio only. Build a resume in Portfolio first for a stronger application.</div>'}${check({ id: 'ap-consent', label: 'I consent to sharing my portfolio and resume with this employer.' })}`, foot: `<button class="btn btn-ghost" type="button" data-close>Cancel</button><button class="btn btn-primary" type="button" id="ap-go">Submit application</button>`, onMount: (m, close) => {
        m.parentElement.querySelectorAll('[data-close]').forEach((b) => (b.onclick = close));
        m.querySelector('#ap-go').onclick = () => {
          if (!m.querySelector('#ap-consent').checked) return ctx.toast('Tick the consent box to share your details.', { tone: 'bad' });
          const r = readiness(ctx.s, st);
          const el2 = jobEligibility(ctx.s, st, j, r);
          if (!el2.eligible) return ctx.toast(el2.reasons.join('; '), { tone: 'bad' });
          ctx.commit('job.apply', (s) => { s.applications.push({ id: uid('AP'), jobId: j.id, studentId: st.id, stage: 'applied', resumeId: m.querySelector('#ap-resume')?.value || null, history: [{ at: new Date().toISOString(), stage: 'applied', by: st.id }], offer: null }); s.users.filter((u) => u.role === 'placement').forEach((u) => ctx.notify(u.id, 'placement', 'New application', `${st.name} applied to ${j.title}`, '/ops/placements')); }, { ok: 'Application submitted', audit: { action: 'application.create', entity: 'application', entityId: j.id, kind: 'data' } }) === true && close();
        };
      } });
    },
    withdraw(el, e, ctx) { ctx.confirm({ title: 'Withdraw this application?', body: 'The employer and placement office will see it as withdrawn.', confirmLabel: 'Withdraw', danger: true }).then((ok) => ok && ctx.commit('job.withdraw', (s) => { const a = s.applications.find((x) => x.id === el.dataset.id); a.stage = 'withdrawn'; a.history.push({ at: new Date().toISOString(), stage: 'withdrawn', by: ctx.me.id }); }, { ok: 'Application withdrawn' })); },
  },
};

const BEHAVIOURAL = ['Tell me about a time you disagreed with a teammate on a technical decision.', 'Describe a bug you could not reproduce at first. How did you find it?', 'Tell me about a deadline you missed. What did you change afterwards?', 'Describe feedback that changed how you write code.', 'Walk me through a project you are proud of and your exact contribution.'];
const DESIGN = ['Design a URL shortener handling 10,000 writes per second.', 'Design the notification service for this LMS (email, SMS, in-app).', 'Design a leaderboard that updates in near real time for 100,000 learners.', 'Design an online judge that runs untrusted code safely.'];

export const interview = {
  perms: ['career.self'],
  flag: 'placement',
  title: () => 'Interview Preparation',
  render(ctx) {
    const st = me(ctx);
    const mocks = ctx.s.mockInterviews.filter((m) => m.studentId === st.id).sort((a, b) => (a.at < b.at ? 1 : -1));
    const r = readiness(ctx.s, st);
    const dsa = r.parts.find((p) => p.id === 'dsa');
    const sysProg = ctx.s.enrollments.find((e) => e.studentId === st.id && e.courseId === 'ARC301');
    return `<div class="page">${pageHead({ title: 'Interview preparation', lede: 'Technical, behavioural and system design practice, plus mock interviews with mentors.', actions: btn('Book a mock interview', { act: 'book', cls: 'btn-primary', ic: 'calendar' }) })}
      <div class="kpis">${kpi({ label: 'DSA readiness', value: `${Math.round(dsa.value * 100)}%`, foot: dsa.detail })}${kpi({ label: 'System design readiness', value: sysProg ? `${Math.round((Object.keys(sysProg.done).length / 9) * 100)}%` : 'Not started', foot: sysProg ? 'ARC301 lessons completed' : 'Enroll in ARC301 for structured practice' })}${kpi({ label: 'Mock interviews', value: mocks.filter((m) => m.status === 'completed').length, foot: `${mocks.filter((m) => m.status === 'scheduled').length} scheduled` })}${kpi({ label: 'Average mock score', value: mocks.filter((m) => m.score).length ? (mocks.filter((m) => m.score).reduce((a, m) => a + m.score, 0) / mocks.filter((m) => m.score).length).toFixed(1) + ' / 5' : 'n/a' })}</div>
      <div class="grid g3">
        <section class="panel"><div class="panel-head"><h2>Technical (DSA)</h2>${btn('Arena', { href: '/arena', sm: true, cls: 'btn-quiet' })}</div><p class="small muted">Product-company style problems, timed. Explain your approach out loud before coding.</p><div class="list" style="margin-top:8px">${PROBLEMS.filter((p) => p.sets.includes('product')).slice(0, 5).map((p) => `<a class="item" href="#/lab/${p.id}"><span class="grow t small">${esc(p.title)}</span><span class="xs diff-${p.diff.toLowerCase()}">${p.diff}</span></a>`).join('')}</div></section>
        <section class="panel"><div class="panel-head"><h2>Behavioural</h2></div><p class="small muted">Answer with Situation, Task, Action, Result in under two minutes.</p><ol class="prompts">${BEHAVIOURAL.map((q) => `<li>${esc(q)}</li>`).join('')}</ol></section>
        <section class="panel"><div class="panel-head"><h2>System design</h2></div><p class="small muted">Start with requirements and numbers, then components, then trade-offs.</p><ol class="prompts">${DESIGN.map((q) => `<li>${esc(q)}</li>`).join('')}</ol></section>
      </div>
      <section class="panel flush"><div class="panel-head" style="padding:18px 20px 0"><h2>Mock interviews</h2></div>${table([
        { key: 'k', label: 'Type', render: (m) => `<b>${esc(m.kind)}</b>` },
        { key: 'a', label: 'When', render: (m) => `${fmtDateTime(m.at)}<div class="sub">${relDays(m.at, ctx.now)}</div>` },
        { key: 'i', label: 'Interviewer', render: (m) => esc(displayName(ctx.s, m.interviewerId)) },
        { key: 's', label: 'Status', render: (m) => (m.status === 'scheduled' ? pill('Scheduled', 'p-info') : `${pill(`${m.score}/5`, m.score >= 4 ? 'p-ok' : m.score >= 3 ? 'p-warn' : 'p-bad', true)}`) },
        { key: 'f', label: 'Feedback', render: (m) => esc(m.feedback || '') },
        { key: 'x', label: '', r: true, render: (m) => (m.status === 'scheduled' ? btn('Cancel', { act: 'cancelMock', sm: true, cls: 'btn-quiet', attrs: { 'data-id': m.id } }) : '') },
      ], mocks, { empty: 'No mock interviews yet. Book one with a mentor.' })}</section></div>`;
  },
  actions: {
    book(el, e, ctx) {
      const st = me(ctx);
      const mentors = ctx.s.users.filter((u) => u.role === 'mentor');
      const days = [1, 2, 3, 5, 7].map((d) => addDays(ctx.now, d));
      ctx.modal({ title: 'Book a mock interview', body: `${select({ id: 'mk-kind', label: 'Type', options: ['Technical (DSA)', 'Behavioural', 'System design'] })}${select({ id: 'mk-mentor', label: 'Interviewer', value: st.mentorId, options: mentors.map((m) => [m.id, `${m.name} · ${m.domains.map((d) => DOMAINS.find((x) => x.id === d).short).join(', ')}`]) })}${select({ id: 'mk-slot', label: 'Slot', options: days.flatMap((d) => [17, 19].map((h) => { const x = new Date(d); x.setHours(h, 0, 0, 0); return [x.toISOString(), `${fmtDateTime(x)}`]; })) })}<p class="hint">The demo books immediately. With a calendar integration the invite would go to both calendars.</p>`, foot: `<button class="btn btn-ghost" type="button" data-close>Cancel</button><button class="btn btn-primary" id="mk-go" type="button">Book</button>`, onMount: (m, close) => {
        m.parentElement.querySelectorAll('[data-close]').forEach((b) => (b.onclick = close));
        m.querySelector('#mk-go').onclick = () => {
          const at = m.querySelector('#mk-slot').value, iv = m.querySelector('#mk-mentor').value;
          if (ctx.s.mockInterviews.some((x) => x.interviewerId === iv && x.at === at && x.status === 'scheduled')) return ctx.toast('That interviewer is already booked for this slot. Pick another.', { tone: 'bad' });
          ctx.commit('mock.book', (s) => { s.mockInterviews.push({ id: uid('MI'), studentId: st.id, kind: m.querySelector('#mk-kind').value, at, interviewerId: iv, status: 'scheduled', score: null, feedback: '' }); ctx.notify(iv, 'mentor', 'Mock interview booked', `${st.name} · ${fmtDateTime(at)}`, '/mentors'); }, { ok: 'Mock interview booked' }) === true && close();
        };
      } });
    },
    cancelMock(el, e, ctx) { ctx.confirm({ title: 'Cancel this mock interview?', body: 'Your interviewer will be notified.', confirmLabel: 'Cancel interview', danger: true }).then((ok) => ok && ctx.commit('mock.cancel', (s) => { const m = s.mockInterviews.find((x) => x.id === el.dataset.id); m.status = 'cancelled'; ctx.notify(m.interviewerId, 'mentor', 'Mock interview cancelled', displayName(s, m.studentId), '/mentors'); }, { ok: 'Cancelled' })); },
  },
};

export const portfolio = {
  perms: ['career.self'],
  title: () => 'Portfolio',
  render(ctx) {
    const st = me(ctx);
    const approved = ctx.s.projects.filter((p) => p.studentId === st.id && p.state === 'approved');
    const certs = ctx.s.certificates.filter((c) => c.studentId === st.id && c.status === 'issued');
    const T = ctx.local('pfT', { tab: 'profile' });
    const pub = `#/p/${st.portfolio.slug}`;
    let body;
    if (T.tab === 'profile') body = `<form class="panel stack" data-form="profile" novalidate><h2>Profile</h2>
      ${toggle({ id: 'public', label: st.portfolio.public ? 'Public: recruiters with the link can view it' : 'Private: only you and staff can view it', checked: st.portfolio.public })}
      ${input({ id: 'headline', label: 'Headline', value: st.career.headline })}
      ${textarea({ id: 'bio', label: 'About', value: st.portfolio.bio, rows: 3, hint: 'Two or three sentences about what you build and what you want next.' })}
      <div class="form-grid">${input({ id: 'github', label: 'GitHub profile', value: st.career.links.github, a: { placeholder: 'https://github.com/you' }, error: ctx.local('pfE', {}).github })}${input({ id: 'linkedin', label: 'LinkedIn', value: st.career.links.linkedin, a: { placeholder: 'https://www.linkedin.com/in/you' }, error: ctx.local('pfE', {}).linkedin })}</div>
      <fieldset class="stack" style="--gap:6px;border:0;padding:0;margin:0"><legend class="lbl small" style="font-weight:600">Projects to show (approved only)</legend>${approved.length ? approved.map((p) => check({ id: `pj-${p.id}`, label: esc(ctx.s.assignments.find((a) => a.id === p.assignmentId)?.title || p.id), checked: st.portfolio.projectIds.includes(p.id), a: { name: `pj-${p.id}` } })).join('') : '<p class="small muted">No approved projects yet.</p>'}</fieldset>
      <fieldset class="stack" style="--gap:6px;border:0;padding:0;margin:0"><legend class="lbl small" style="font-weight:600">Certificates to show</legend>${certs.length ? certs.map((c) => check({ id: `ct-${c.id}`, label: `${esc(c.courseId)} · ${esc(c.id)}`, checked: st.portfolio.certIds.includes(c.id), a: { name: `ct-${c.id}` } })).join('') : '<p class="small muted">No certificates yet.</p>'}</fieldset>
      <div class="row"><button class="btn btn-primary" type="submit">Save portfolio</button>${btn('Preview public page', { href: `/p/${st.portfolio.slug}`, ic: 'eye' })}</div></form>`;
    else body = resumeTab(ctx, st, approved);
    return `<div class="page">${pageHead({ title: 'Portfolio and resume', lede: `Your public page lives at <span class="mono">${esc(pub)}</span> when it is public.` })}${tabs([['profile', 'Portfolio'], ['resume', 'Resume builder', st.career.resumes.length]], T.tab, 'tab')}${body}</div>`;
  },
  actions: {
    tab(el, e, ctx) { ctx.local('pfT').tab = el.dataset.id; ctx.rerender(); },
    primary(el, e, ctx) { ctx.commit('resume.primary', (s) => { const st = s.students.find((x) => x.id === ctx.me.id); st.career.resumes.forEach((r) => (r.primary = r.id === el.dataset.id)); }, { ok: 'Primary resume updated' }); },
    delResume(el, e, ctx) { ctx.confirm({ title: 'Delete this resume version?', body: 'Applications that already used it keep their copy.', confirmLabel: 'Delete', danger: true }).then((ok) => ok && ctx.commit('resume.delete', (s) => { const st = s.students.find((x) => x.id === ctx.me.id); st.career.resumes = st.career.resumes.filter((r) => r.id !== el.dataset.id); }, { ok: 'Deleted' })); },
    loadResume(el, e, ctx) { const st = me(ctx); const r = st.career.resumes.find((x) => x.id === el.dataset.id); ctx.local('resDraft', {}).d = { ...r.data }; ctx.rerender(); },
  },
  forms: {
    profile(form, d, ctx) {
      const errs = {};
      if (d.github && !/^https:\/\/(www\.)?github\.com\/[\w-]+\/?$/.test(d.github)) errs.github = 'Use https://github.com/username';
      if (d.linkedin && !/^https:\/\/(www\.)?linkedin\.com\/in\/[\w-]+\/?$/.test(d.linkedin)) errs.linkedin = 'Use https://www.linkedin.com/in/name';
      ctx.local('pfE', {}).github = errs.github; ctx.local('pfE').linkedin = errs.linkedin;
      if (Object.keys(errs).length) return ctx.rerender();
      ctx.commit('portfolio.save', (s) => { const st = s.students.find((x) => x.id === ctx.me.id); st.portfolio.public = !!d.public; st.portfolio.bio = d.bio; st.career.headline = d.headline; st.career.links = { github: d.github, linkedin: d.linkedin }; st.portfolio.projectIds = Object.keys(d).filter((k) => k.startsWith('pj-') && d[k]).map((k) => k.slice(3)); st.portfolio.certIds = Object.keys(d).filter((k) => k.startsWith('ct-') && d[k]).map((k) => k.slice(3)); }, { ok: 'Portfolio saved', audit: { action: 'portfolio.update', entity: 'portfolio', entityId: ctx.me.id, detail: d.public ? 'Visibility: public' : 'Visibility: private', kind: 'data' } });
    },
    resume(form, d, ctx) {
      if (!d.rname?.trim()) return ctx.toast('Name this version, for example "Backend roles v2".', { tone: 'bad' });
      ctx.commit('resume.save', (s) => { const st = s.students.find((x) => x.id === ctx.me.id); st.career.resumes.push({ id: uid('RV'), name: d.rname.trim(), at: new Date().toISOString(), primary: !st.career.resumes.length, data: { summary: d.summary, skills: d.skills, education: d.education, experience: d.experience } }); }, { ok: 'Resume version saved' });
      ctx.local('resDraft', {}).d = null;
    },
  },
};

function resumeTab(ctx, st, approved) {
  const draft = ctx.local('resDraft', { d: null }).d || { summary: `${st.career.headline}. ${st.portfolio.bio || ''}`.trim(), skills: [...new Set(ctx.s.enrollments.filter((e) => e.studentId === st.id).flatMap((e) => ctx.s.courses.find((c) => c.id === e.courseId).skills))].join(', '), education: 'B.Tech / B.E. (add your degree)\nAVGENX Academy: ' + (ctx.s.cohorts.find((c) => c.id === st.cohortId)?.name || ''), experience: '' };
  return `<div class="grid g-main"><form class="panel stack" data-form="resume" novalidate><h2>Build a resume version</h2><p class="small muted">Projects and certificates are pulled from your verified records, so recruiters can trust them.</p>
    ${textarea({ id: 'summary', label: 'Summary', value: draft.summary, rows: 3 })}
    ${textarea({ id: 'skills', label: 'Skills', value: draft.skills, rows: 2 })}
    ${textarea({ id: 'experience', label: 'Experience', value: draft.experience, rows: 3, hint: 'Internships, freelance or work experience.' })}
    ${textarea({ id: 'education', label: 'Education', value: draft.education, rows: 2 })}
    <div class="panel sunk small"><b>Verified projects (${approved.length})</b><ul style="padding-left:18px;margin-top:6px">${approved.map((p) => `<li>${esc(ctx.s.assignments.find((a) => a.id === p.assignmentId)?.title)}${p.repo ? ` · <span class="mono xs">${esc(p.repo.replace('https://', ''))}</span>` : ''}</li>`).join('') || '<li>None yet</li>'}</ul></div>
    <div class="row">${input({ id: 'rname', label: 'Version name', value: '', a: { placeholder: 'Backend roles v1' } })}<button class="btn btn-primary" type="submit" style="align-self:flex-end">Save version</button></div></form>
    <section class="panel"><div class="panel-head"><h2>Versions</h2></div>${st.career.resumes.length ? `<div class="list">${st.career.resumes.slice().reverse().map((r) => `<div class="item"><span class="grow min0"><span class="t small">${esc(r.name)} ${r.primary ? pill('Primary', 'p-ok', true) : ''}</span><br><span class="s">Saved ${fmtDateTime(r.at)}</span></span><div class="row" style="--gap:4px">${btn('Load', { act: 'loadResume', sm: true, cls: 'btn-quiet', attrs: { 'data-id': r.id } })}${r.primary ? '' : btn('Make primary', { act: 'primary', sm: true, cls: 'btn-quiet', attrs: { 'data-id': r.id } })}${btn('', { act: 'delResume', sm: true, cls: 'btn-quiet', ic: 'trash', title: 'Delete version', attrs: { 'data-id': r.id } })}</div></div>`).join('')}</div>` : empty('No versions yet', 'Save your first version to apply with it.', { ic: 'log' })}<p class="hint" style="margin-top:10px">PDF export needs the PDF integration; recruiters can use your public portfolio link today.</p></section></div>`;
}

export const publicPortfolio = {
  title: (ctx) => ctx.s.students.find((x) => x.portfolio.slug === ctx.params.slug)?.name || 'Portfolio',
  render(ctx) {
    const st = ctx.s.students.find((x) => x.portfolio.slug === ctx.params.slug);
    const isOwner = st && ctx.me.id === st.id;
    if (!st || (!st.portfolio.public && !isOwner && !ctx.can('students.view'))) return `<div class="page">${empty('This portfolio is private', 'The learner has not made it public.', { ic: 'lock' })}</div>`;
    const projects = st.portfolio.projectIds.map((id) => ctx.s.projects.find((p) => p.id === id)).filter((p) => p?.state === 'approved');
    const certs = st.portfolio.certIds.map((id) => ctx.s.certificates.find((c) => c.id === id)).filter((c) => c?.status === 'issued');
    const skills = [...new Set(projects.flatMap((p) => ctx.s.courses.find((c) => c.id === p.courseId).skills))];
    return `<div class="page portfolio-public">${!st.portfolio.public ? '<div class="callout warn small">Preview. This portfolio is private; only you and staff can see it.</div>' : ''}
      <header class="pf-hero"><span class="avatar lg pencil">${esc(st.name.split(' ').map((w) => w[0]).join(''))}</span><div class="min0"><h1>${esc(st.name)}</h1><p class="lede">${esc(st.career.headline)}</p><div class="row small">${st.career.links.github ? `<a href="${esc(st.career.links.github)}" target="_blank" rel="noopener noreferrer">${icon('git', 'style="width:14px;height:14px;vertical-align:-2px"')} GitHub</a>` : ''}${st.career.links.linkedin ? `<a href="${esc(st.career.links.linkedin)}" target="_blank" rel="noopener noreferrer">LinkedIn</a>` : ''}<span class="muted">${esc(st.city)}</span></div></div></header>
      ${st.portfolio.bio ? `<p style="max-width:68ch">${esc(st.portfolio.bio)}</p>` : ''}
      ${skills.length ? `<div class="chips">${skills.map((s) => `<span class="chip">${esc(s)}</span>`).join('')}</div>` : ''}
      <section class="stack"><h2>Projects</h2>${projects.length ? `<div class="grid g-auto" style="--min:300px">${projects.map((p) => { const a = ctx.s.assignments.find((x) => x.id === p.assignmentId); const c = ctx.s.courses.find((x) => x.id === p.courseId); const sc = a.rubric.reduce((t, r) => t + (p.scores[r.id] || 0), 0); return `<article class="panel stack" style="--gap:8px;${domainVar(c.domain)}"><span class="mono small" style="color:var(--cat)">${c.id} · ${a.kind}</span><h3>${esc(a.title)}</h3><p class="small muted">${esc(a.brief)}</p><div class="chips">${c.skills.slice(0, 4).map((s) => `<span class="chip">${esc(s)}</span>`).join('')}</div><div class="row small">${p.repo ? `<a href="${esc(p.repo)}" target="_blank" rel="noopener noreferrer">Repository</a>` : ''}${p.demo ? `<a href="${esc(p.demo)}" target="_blank" rel="noopener noreferrer">Live demo</a>` : ''}<span class="muted">Reviewer score ${sc}/100</span></div>${p.comments?.length ? `<blockquote class="small">“${esc(p.comments[p.comments.length - 1].text)}” <span class="muted">· ${esc(displayName(ctx.s, p.comments[p.comments.length - 1].by))}, mentor feedback</span></blockquote>` : ''}</article>`; }).join('')}</div>` : '<p class="muted small">No projects selected.</p>'}</section>
      ${certs.length ? `<section class="stack"><h2>Certificates</h2><div class="list">${certs.map((c) => `<a class="item" href="#/verify/${c.id}">${icon('cert')}<span class="grow min0"><span class="t">${esc(ctx.s.courses.find((x) => x.id === c.courseId).title)}</span><br><span class="s mono">${esc(c.id)} · verify</span></span></a>`).join('')}</div></section>` : ''}
      <p class="xs muted">Demo learner profile generated for this prototype.</p></div>`;
  },
};
