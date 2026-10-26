// Executive and operational analytics, all computed from the underlying records.
// Inputs: state, activity index, risk results, and a { from, to } window. Pure functions.
import { iso, addDays, daysBetween, DAY, startOfDay, avg, sum, round } from '../core/util.js';
import { progressOf, lessonsOf } from './progress.js';
import { invoiceStatus, collectionsByMonth } from './fees.js';
import { lastActive, minutesBetween } from './activity.js';
import { ASSESSMENTS } from '../data/questions.js';

export function filterStudents(state, { domain = 'all', cohort = 'all' } = {}) {
  const cohorts = state.cohorts.filter((c) => (domain === 'all' || c.domain === domain) && (cohort === 'all' || c.id === cohort));
  const ids = new Set(cohorts.map((c) => c.id));
  return state.students.filter((s) => ids.has(s.cohortId));
}

const isActive = (idx, s, now, days = 14) => { const la = lastActive(idx, s.id); return !!la && daysBetween(la, now) < days && s.status === 'active'; };

export function execMetrics(state, idx, risk, now, { days = 90, domain = 'all', cohort = 'all' } = {}) {
  const students = filterStudents(state, { domain, cohort });
  const sids = new Set(students.map((s) => s.id));
  const from = addDays(now, -days), prevFrom = addDays(now, -2 * days);
  const enr = state.enrollments.filter((e) => sids.has(e.studentId));
  const newEnr = enr.filter((e) => e.enrolledAt > iso(from)).length;
  const prevEnr = enr.filter((e) => e.enrolledAt > iso(prevFrom) && e.enrolledAt <= iso(from)).length;

  const active = students.filter((s) => isActive(idx, s, now)).length;
  const activePrev = students.filter((s) => { const m = idx.get(s.id); if (!m) return false; for (const d of m.keys()) if (d > iso(addDays(now, -days - 14)) && d <= iso(addDays(now, -days))) return true; return false; }).length;

  const mature = enr.filter((e) => daysBetween(e.enrolledAt, now) >= 60);
  const completion = mature.length ? (mature.filter((e) => e.status === 'completed').length / mature.length) * 100 : 0;
  const maturePrev = enr.filter((e) => daysBetween(e.enrolledAt, addDays(now, -days)) >= 60);
  const completionPrev = maturePrev.length ? (maturePrev.filter((e) => { const c = state.courses.find((x) => x.id === e.courseId); const done = Object.values(e.done).filter((t) => t <= addDays(now, -days).toISOString()).length; return done === lessonsOf(c).length; }).length / maturePrev.length) * 100 : 0;

  const mins = students.reduce((a, s) => a + minutesBetween(idx, s.id, from, now), 0);
  const weeks = days / 7;
  const engagement = active ? mins / Math.max(1, students.filter((s) => s.status === 'active').length) / weeks : 0;
  const minsPrev = students.reduce((a, s) => a + minutesBetween(idx, s.id, prevFrom, from), 0);
  const engagementPrev = minsPrev / Math.max(1, students.filter((s) => s.status === 'active').length) / weeks;

  // Retention per cohort: still enrolled (not withdrawn or paused) and active in the last 21 days.
  const cohorts = state.cohorts.filter((c) => students.some((s) => s.cohortId === c.id));
  const retention = cohorts.map((c) => {
    const m = students.filter((s) => s.cohortId === c.id);
    const retained = m.filter((s) => s.status === 'active' && isActive(idx, s, now, 21)).length;
    return { id: c.id, name: c.name, domain: c.domain, size: m.length, retained, pct: m.length ? (retained / m.length) * 100 : 0, capacity: c.capacity };
  });

  // Instructor utilisation: scheduled teaching + review load vs weekly capacity.
  const sessionsIn = state.sessions.filter((s) => s.status !== 'cancelled' && s.start >= from.toISOString() && s.start <= addDays(now, 14).toISOString());
  const instructors = state.users.filter((u) => u.role === 'instructor').map((u) => {
    const teach = sessionsIn.filter((s) => s.instructorId === u.id).reduce((a, s) => a + s.mins / 60, 0);
    const reviews = state.projects.filter((p) => p.reviewerId === u.id && ['submitted', 'under_review'].includes(p.state)).length;
    const prep = teach * 1.5;
    const hours = teach + prep + reviews * 0.75;
    const capacity = (u.capacity || 18) * ((days + 14) / 7);
    return { id: u.id, name: u.name, teach: round(teach), reviews, hours: round(hours), capacity: round(capacity), pct: round((hours / capacity) * 100) };
  });

  const popularity = state.courses.filter((c) => c.status === 'published').map((c) => {
    const e = enr.filter((x) => x.courseId === c.id);
    const avgProg = e.length ? avg(e, (x) => progressOf(c, x).pct) : 0;
    return { id: c.id, title: c.title, domain: c.domain, enrollments: e.length, recent: e.filter((x) => x.enrolledAt > iso(from)).length, avgProgress: round(avgProg), rating: c.feedback.rating };
  }).sort((a, b) => b.enrollments - a.enrollments);

  const atts = state.attempts.filter((a) => sids.has(a.studentId) && a.status === 'graded' && a.submittedAt >= from.toISOString());
  const assessmentPerf = groupAssess(atts);

  const riskIn = risk.filter((r) => sids.has(r.studentId));
  const riskDist = { high: riskIn.filter((r) => r.level === 'high').length, medium: riskIn.filter((r) => r.level === 'medium').length, low: riskIn.filter((r) => r.level === 'low').length, none: riskIn.filter((r) => r.level === 'none').length };

  const apps = state.applications.filter((a) => sids.has(a.studentId));
  const pipeline = ['applied', 'shortlisted', 'interview', 'offer', 'hired', 'rejected'].map((st) => ({ stage: st, n: apps.filter((a) => a.stage === st).length, reached: apps.filter((a) => a.history.some((h) => h.stage === st)).length }));

  const invs = state.invoices.filter((i) => sids.has(i.studentId));
  const collected = sum(invs.flatMap((i) => i.installments.filter((x) => x.paidAt && x.paidAt > iso(from))), (x) => x.amount);
  const collectedPrev = sum(invs.flatMap((i) => i.installments.filter((x) => x.paidAt && x.paidAt > iso(prevFrom) && x.paidAt <= iso(from))), (x) => x.amount);
  const refunds = sum(state.refunds.filter((r) => sids.has(r.studentId) && r.status === 'approved' && (r.decidedAt || r.at) > from.toISOString()), (r) => r.amount);
  const outstanding = sum(invs, (i) => invoiceStatus(i, now).outstanding);
  const overdue = sum(invs, (i) => invoiceStatus(i, now).overdueAmt);

  const corporate = state.orgs.map((o) => {
    const m = state.students.filter((s) => s.orgId === o.id);
    const e = state.enrollments.filter((x) => m.some((s) => s.id === x.studentId));
    const mand = e.filter((x) => o.mandatory.includes(x.courseId));
    return { id: o.id, name: o.name, seats: o.seats, used: m.length, active: m.filter((s) => isActive(idx, s, now)).length, avgProgress: round(avg(e, (x) => progressOf(state.courses.find((c) => c.id === x.courseId), x).pct)), mandatoryDone: mand.filter((x) => x.status === 'completed').length, mandatoryTotal: mand.length };
  });

  const byDomain = [...new Set(state.cohorts.map((c) => c.domain))].map((d) => {
    const ss = state.students.filter((s) => state.cohorts.find((c) => c.id === s.cohortId)?.domain === d);
    const ee = state.enrollments.filter((e) => ss.some((s) => s.id === e.studentId));
    return { domain: d, learners: ss.length, active: ss.filter((s) => isActive(idx, s, now)).length, avgProgress: round(avg(ee, (x) => progressOf(state.courses.find((c) => c.id === x.courseId), x).pct)), revenue: sum(state.invoices.filter((i) => ss.some((s) => s.id === i.studentId)).flatMap((i) => i.installments.filter((x) => x.paidAt)), (x) => x.amount) };
  });

  return {
    window: { from: iso(from), to: iso(now), days },
    learners: students.length, active, activePrev, newEnr, prevEnr, completion: round(completion), completionPrev: round(completionPrev),
    engagement: Math.round(engagement), engagementPrev: Math.round(engagementPrev), retention, instructors, popularity, assessmentPerf,
    riskDist, pipeline, collected, collectedPrev, refunds, outstanding, overdue, corporate, byDomain,
    weekly: weeklyActive(idx, students, now, Math.min(26, Math.max(8, Math.round(days / 7)))),
    monthlyEnrollments: monthlyEnrollments(enr, now, 12),
    collections: collectionsByMonth(state, 12, now),
  };
}

function groupAssess(atts) {
  const m = new Map();
  atts.forEach((a) => m.set(a.assessmentId, [...(m.get(a.assessmentId) || []), a]));
  return [...m.entries()].map(([id, l]) => ({ id, attempts: l.length, avg: round(avg(l, (a) => a.pct)), passRate: round((l.filter((a) => a.passed).length / l.length) * 100) })).sort((a, b) => a.passRate - b.passRate);
}

function weeklyActive(idx, students, now, weeks) {
  const end = startOfDay(now);
  const out = [];
  for (let w = weeks - 1; w >= 0; w--) {
    const to = end - w * 7 * DAY, from = to - 6 * DAY;
    let act = 0, mins = 0;
    students.forEach((s) => { const m = idx.get(s.id); if (!m) return; let any = false; for (let d = from; d <= to; d += DAY) { const v = m.get(iso(d)) || 0; if (v) { any = true; mins += v; } } if (any) act++; });
    out.push({ week: iso(from), active: act, mins });
  }
  return out;
}

function monthlyEnrollments(enr, now, months) {
  const d = new Date(now);
  return Array.from({ length: months }, (_, k) => {
    const m = new Date(d.getFullYear(), d.getMonth() - (months - 1 - k), 1);
    const key = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`;
    return { key, label: m.toLocaleDateString('en-GB', { month: 'short' }), n: enr.filter((e) => e.enrolledAt.slice(0, 7) === key).length };
  });
}

const chg = (a, b) => (b ? ((a - b) / b) * 100 : null);
/** Deterministic executive summary: what changed, why, and what needs attention. */
export function execSummary(m) {
  const out = [];
  const ae = chg(m.active, m.activePrev);
  if (ae !== null) out.push({ tone: ae >= 0 ? 'ok' : 'warn', text: `Active learners ${ae >= 0 ? 'rose' : 'fell'} ${Math.abs(ae).toFixed(0)}% versus the previous ${m.window.days} days (${m.activePrev} to ${m.active}).` });
  const en = chg(m.newEnr, m.prevEnr);
  if (en !== null) out.push({ tone: en >= 0 ? 'ok' : 'warn', text: `New enrollments: ${m.newEnr} this period against ${m.prevEnr} before (${en >= 0 ? '+' : ''}${en.toFixed(0)}%).` });
  const low = m.retention.filter((r) => r.pct < 75 && r.size >= 3).sort((a, b) => a.pct - b.pct)[0];
  if (low) out.push({ tone: 'bad', text: `${low.name} retention is ${low.pct.toFixed(0)}% (${low.retained} of ${low.size} learners active in the last 21 days); the lowest of any cohort.` });
  if (m.riskDist.high) out.push({ tone: 'bad', text: `${m.riskDist.high} learners are high risk and ${m.riskDist.medium} medium risk under the current rules. Review the at-risk queue.` });
  const worst = m.assessmentPerf.filter((a) => a.attempts >= 3)[0];
  if (worst && worst.passRate < 70) out.push({ tone: 'warn', text: `${ASSESSMENTS.find((a) => a.id === worst.id)?.title || worst.id} has the lowest pass rate (${worst.passRate}% over ${worst.attempts} attempts in this window); consider reviewing its question bank.` });
  const hot = m.instructors.filter((i) => i.pct > 85);
  if (hot.length) out.push({ tone: 'warn', text: `${hot.length} instructor${hot.length > 1 ? 's are' : ' is'} above 85% of capacity: ${hot.map((h) => h.name).join(', ')}.` });
  if (m.overdue > 0) out.push({ tone: 'warn', text: `Overdue fees total ₹${Math.round(m.overdue).toLocaleString('en-IN')}; outstanding balance ₹${Math.round(m.outstanding).toLocaleString('en-IN')}.` });
  return out;
}

/** Module drop-off: where learners stall (share of enrolled learners who completed each module). */
export function moduleFunnel(state, course) {
  const e = state.enrollments.filter((x) => x.courseId === course.id);
  return course.modules.map((m) => ({ id: m.id, title: m.title, pct: e.length ? round((e.filter((x) => m.lessons.every((l) => x.done[l.id])).length / e.length) * 100) : 0 }));
}
