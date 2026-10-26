// Explainable at-risk rules. Every flag carries its evidence and a recommended intervention.
// Thresholds live in settings.risk so academic staff can tune them. A predictive model can be
// plugged in later through riskModel (see services/integrations.js); it can add signals but
// staff always decide on interventions.
import { iso, daysBetween, addDays } from '../core/util.js';
import { lastActive, minutesBetween } from './activity.js';
import { prerequisitesMet, progressOf } from './progress.js';
import { attendancePct } from './certification.js';

export const RULES = {
  inactive: { label: 'Stopped progressing', severity: 3, action: 'Mentor call within 48 hours; agree a small restart goal.' },
  failedAttempts: { label: 'Repeated assessment failures', severity: 2, action: 'Targeted revision plan and a doubt-clearing session before the next attempt.' },
  overdue: { label: 'Missed assignments', severity: 2, action: 'Review blockers; set new interim deadlines with the instructor.' },
  engagementDrop: { label: 'Declining engagement', severity: 2, action: 'Check workload and schedule; offer flexible study slots.' },
  attendance: { label: 'Low class attendance', severity: 1, action: 'Share recordings; check for timing conflicts with work.' },
  prereq: { label: 'Incomplete prerequisite skills', severity: 1, action: 'Assign the prerequisite course\'s core lessons or a diagnostic.' },
  progressGap: { label: 'Behind cohort schedule', severity: 2, action: 'Agree a catch-up plan with weekly checkpoints.' },
};

export function evaluateStudent(state, idx, student, now) {
  const cfg = state.settings.risk;
  const flags = [];
  const la = lastActive(idx, student.id);
  const idle = la ? daysBetween(la, now) : 999;
  if (idle >= cfg.inactiveDays) flags.push({ rule: 'inactive', evidence: la ? `No learning activity for ${idle} days (last: ${la}).` : 'No learning activity recorded.', weight: idle >= cfg.inactiveDays * 2 ? 4 : 3 });

  const byAssess = new Map();
  state.attempts.filter((a) => a.studentId === student.id && a.status === 'graded').forEach((a) => byAssess.set(a.assessmentId, [...(byAssess.get(a.assessmentId) || []), a]));
  for (const [aid, list] of byAssess) {
    const fails = list.filter((a) => !a.passed).length;
    if (fails >= cfg.failedAttempts && !list.some((a) => a.passed)) flags.push({ rule: 'failedAttempts', evidence: `${fails} failed attempts on ${aid} with no pass (best ${Math.max(...list.map((a) => a.pct))}%).`, weight: 2 });
  }

  const overdue = state.projects.filter((p) => p.studentId === student.id && ['assigned', 'in_progress', 'revision'].includes(p.state) && p.due && p.due < iso(now));
  if (overdue.length >= cfg.overdueProjects) flags.push({ rule: 'overdue', evidence: `${overdue.length} projects past due: ${overdue.slice(0, 3).map((p) => p.assignmentId.replace(/^AS-|^CAP-/, '')).join(', ')}.`, weight: 2 });

  const recent = minutesBetween(idx, student.id, addDays(now, -13), now);
  const prior = minutesBetween(idx, student.id, addDays(now, -27), addDays(now, -14));
  if (prior >= 60 && recent < prior * (1 - cfg.engagementDropPct / 100)) flags.push({ rule: 'engagementDrop', evidence: `Learning time fell from ${prior} to ${recent} minutes over consecutive 14-day windows (${Math.round((1 - recent / prior) * 100)}% drop).`, weight: 2 });

  const enrolls = state.enrollments.filter((e) => e.studentId === student.id);
  const att = enrolls.map((e) => attendancePct(state, student.id, e.courseId)).filter((x) => x !== null);
  const held = state.sessions.filter((s) => s.status === 'completed' && s.attendance && student.id in s.attendance).length;
  if (att.length && held >= 3) { const a = Math.round(att.reduce((x, y) => x + y, 0) / att.length); if (a < cfg.attendancePct) flags.push({ rule: 'attendance', evidence: `Attended ${a}% of ${held} live sessions (threshold ${cfg.attendancePct}%).`, weight: 1 }); }

  const gaps = enrolls.map((e) => {
    const c = state.courses.find((x) => x.id === e.courseId);
    const pre = prerequisitesMet(state, student.id, c);
    return !pre.met && progressOf(c, e).pct < 100 ? `${c.id} (needs ${pre.missing.join(', ')})` : null;
  }).filter(Boolean);
  if (gaps.length) flags.push({ rule: 'prereq', evidence: `Working on ${gaps.join('; ')} before finishing the prerequisite.`, weight: 1 });

  const cohort = state.cohorts.find((c) => c.id === student.cohortId);
  if (cohort) {
    const elapsed = Math.max(0, Math.min(1, daysBetween(cohort.start, now) / (cohort.weeks * 7)));
    const pathCourses = cohort.path.map((id) => state.courses.find((c) => c.id === id)).filter((c) => c?.status === 'published');
    const total = pathCourses.reduce((a, c) => a + c.modules.reduce((n, m) => n + m.lessons.length, 0), 0);
    const done = pathCourses.reduce((a, c) => { const e = enrolls.find((x) => x.courseId === c.id); return a + (e ? Object.keys(e.done).length : 0); }, 0);
    const actual = total ? done / total : 0;
    if (elapsed > 0.15 && (elapsed - actual) * 100 >= cfg.progressGapPct) flags.push({ rule: 'progressGap', evidence: `${Math.round(actual * 100)}% of the program done vs ${Math.round(elapsed * 100)}% of the schedule elapsed.`, weight: 2 });
  }

  const score = flags.reduce((a, f) => a + f.weight, 0);
  const level = score >= 5 || flags.some((f) => f.weight >= 4) ? 'high' : score >= 2 ? 'medium' : score > 0 ? 'low' : 'none';
  return { studentId: student.id, flags, score, level, idle };
}

export function evaluateAll(state, idx, now, students = state.students) {
  return students.filter((s) => s.status === 'active').map((s) => evaluateStudent(state, idx, s, now));
}

export const IV_STATES = ['flagged', 'notified', 'planned', 'followup', 'resolved', 'escalated'];
export const IV_LABEL = { flagged: 'Flagged', notified: 'Mentor notified', planned: 'Plan agreed', followup: 'Follow-up held', resolved: 'Resolved', escalated: 'Escalated' };
const IV_NEXT = { flagged: ['notified'], notified: ['planned', 'escalated'], planned: ['followup', 'escalated'], followup: ['resolved', 'escalated', 'planned'], escalated: ['planned', 'resolved'], resolved: [] };
export const nextIvStates = (s) => IV_NEXT[s] || [];

export function advanceIntervention(iv, to, by, note, now = new Date()) {
  if (!nextIvStates(iv.state).includes(to)) throw new Error(`Cannot move from ${IV_LABEL[iv.state]} to ${IV_LABEL[to]}.`);
  if (['planned', 'resolved', 'escalated'].includes(to) && String(note || '').trim().length < 10) throw new Error('Record the plan, outcome or escalation reason (at least 10 characters).');
  if (to === 'planned') iv.plan = note.trim();
  if (to === 'resolved' || to === 'escalated') iv.outcome = note.trim();
  iv.history.push({ at: new Date(now).toISOString(), by, state: to, note: note || IV_LABEL[to] });
  iv.state = to;
  return iv;
}
