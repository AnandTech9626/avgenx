// Shared view-model builders used by several screens (dashboard, student profile, mentor workspace).
import { progressOf, lessonsOf } from '../domain/progress.js';
import { readiness, solvedProblems } from '../domain/career.js';
import { xpLedger, badges } from '../domain/motivation.js';
import { streak, dailySeries, weeklySeries, velocity, lastActive, weekStart, minutesBetween } from '../domain/activity.js';
import { PROBLEMS } from '../data/problems.js';
import { DOMAINS } from '../data/catalog.js';
import { iso, addDays, daysBetween } from '../core/util.js';
import { attemptStatus } from '../domain/assessment.js';
import { ASSESSMENTS } from '../data/questions.js';

export function studentSummary(ctx, sid) {
  const s = ctx.s;
  const st = s.students.find((x) => x.id === sid);
  if (!st) return null;
  const idx = ctx.idx();
  const now = ctx.now;
  const cohort = s.cohorts.find((c) => c.id === st.cohortId);
  const enr = s.enrollments.filter((e) => e.studentId === sid).map((e) => { const c = s.courses.find((x) => x.id === e.courseId); return { e, c, p: progressOf(c, e) }; });
  const solved = solvedProblems(s, sid);
  const subs = s.submissions.filter((x) => x.studentId === sid);
  const ready = readiness(s, st);
  const ledger = xpLedger(s, sid, idx, now);
  const str = streak(idx, sid, now);
  const wk = minutesBetween(idx, sid, weekStart(now), now);
  const risk = ctx.risk().find((r) => r.studentId === sid) || { flags: [], level: 'none' };
  // Domain mastery: lessons done (50%) + best assessment (30%) + solved problems in that domain's topics (20%).
  const mastery = DOMAINS.map((d) => {
    const list = enr.filter((x) => x.c.domain === d.id);
    if (!list.length) return null;
    const lessonPct = list.reduce((a, x) => a + x.p.pct, 0) / list.length;
    const as = ASSESSMENTS.filter((a) => a.domain === d.id).map((a) => attemptStatus(s, sid, a).best?.pct).filter((v) => v !== undefined && v !== null);
    const asPct = as.length ? as.reduce((a, b) => a + b, 0) / as.length : null;
    const solvePct = d.id === 'prog' || d.id === 'web' ? Math.min(100, (solved.length / 25) * 100) : null;
    const parts = [[lessonPct, 0.5], [asPct, 0.3], [solvePct, 0.2]].filter(([v]) => v !== null);
    const w = parts.reduce((a, [, x]) => a + x, 0);
    return { domain: d, value: Math.round(parts.reduce((a, [v, x]) => a + v * x, 0) / w), basis: `${Math.round(lessonPct)}% lessons${asPct !== null ? `, ${Math.round(asPct)}% assessments` : ''}${solvePct !== null ? `, ${solved.length} problems` : ''}` };
  }).filter(Boolean);
  const projects = s.projects.filter((p) => p.studentId === sid);
  const sessions = s.sessions.filter((x) => x.cohortId === st.cohortId && x.status === 'scheduled' && x.start >= now.toISOString()).sort((a, b) => (a.start < b.start ? -1 : 1));
  const deadlines = projects.filter((p) => ['assigned', 'in_progress', 'revision'].includes(p.state)).sort((a, b) => (a.due < b.due ? -1 : 1));
  return { st, cohort, enr, solved, subs, ready, ledger, streak: str, weekMins: wk, risk, mastery, projects, sessions, deadlines, idx, lastActive: lastActive(idx, sid) };
}

/** Next best activity, in priority order, with a reason. */
export function nextBest(ctx, sum) {
  const now = iso(ctx.now);
  const rev = sum.projects.find((p) => p.state === 'revision');
  if (rev) return { title: `Address revision feedback on ${rev.assignmentId.replace(/^AS-|^CAP-/, '')}`, why: 'A reviewer requested changes; resubmitting keeps your certificate on track.', href: `/projects/${rev.id}`, ic: 'folder' };
  const overdue = sum.deadlines.find((p) => p.due < now);
  if (overdue) return { title: `Finish overdue project ${overdue.assignmentId.replace(/^AS-|^CAP-/, '')}`, why: `It was due ${overdue.due}. Late penalties grow each day after the grace period.`, href: `/projects/${overdue.id}`, ic: 'alert' };
  const active = sum.enr.filter((x) => x.p.pct < 100 && x.c.status === 'published').sort((a, b) => b.p.pct - a.p.pct)[0];
  if (active?.p.next) return { title: `${active.c.id}: ${active.p.next.title}`, why: `Next lesson in your most advanced course (${active.p.pct}% complete). About ${active.p.next.mins} minutes.`, href: `/course/${active.c.id}/learn/${active.p.next.id}`, ic: 'play' };
  const unsolved = PROBLEMS.find((p) => !sum.solved.includes(p) && p.diff !== 'Hard');
  return { title: `Practise: ${unsolved?.title || 'a new problem'}`, why: 'All your lessons are complete. Keep your problem-solving sharp.', href: `/lab/${unsolved?.id || ''}`, ic: 'code' };
}

export const riskTone = { high: 'p-bad', medium: 'p-warn', low: 'p-info', none: 'p-ok' };
export const riskLabel = { high: 'High risk', medium: 'Medium risk', low: 'Low risk', none: 'On track' };
export const courseTotalLessons = (c) => lessonsOf(c).length;
export { dailySeries, weeklySeries, velocity, daysBetween, addDays };
