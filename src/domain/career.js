// Placement readiness (transparent weighted criteria) and job eligibility rules.
// Readiness is guidance for preparation, not a prediction or guarantee of employment.
import { PROBLEMS } from '../data/problems.js';
import { attendancePct } from './certification.js';

const DIFF_PTS = { Easy: 1, Medium: 2, Hard: 3 };
export const READINESS_PARTS = {
  dsa: 'Problem solving (accepted problems, weighted by difficulty; target 40 points)',
  assessments: 'Assessment performance (average best score)',
  projects: 'Projects approved out of assigned',
  portfolio: 'Portfolio completeness (public, 2+ projects, headline, GitHub)',
  mock: 'Mock interviews (average rating, at least one completed)',
  attendance: 'Live class attendance',
};

export function solvedProblems(state, studentId) {
  const ids = new Set(state.submissions.filter((s) => s.studentId === studentId && s.status === 'Accepted').map((s) => s.problemId));
  return PROBLEMS.filter((p) => ids.has(p.id));
}

export function readiness(state, student) {
  const w = state.settings.readiness;
  const solved = solvedProblems(state, student.id);
  const dsaPts = solved.reduce((a, p) => a + DIFF_PTS[p.diff], 0);
  const best = new Map();
  state.attempts.filter((a) => a.studentId === student.id && a.status === 'graded').forEach((a) => best.set(a.assessmentId, Math.max(best.get(a.assessmentId) || 0, a.pct)));
  const bestVals = [...best.values()];
  const projs = state.projects.filter((p) => p.studentId === student.id);
  const approved = projs.filter((p) => p.state === 'approved').length;
  const pf = student.portfolio;
  const portfolio = [pf.public, (pf.projectIds?.length || 0) >= 2, !!student.career.headline, !!student.career.links.github].filter(Boolean).length / 4;
  const mocks = state.mockInterviews.filter((m) => m.studentId === student.id && m.status === 'completed');
  const att = state.enrollments.filter((e) => e.studentId === student.id).map((e) => attendancePct(state, student.id, e.courseId)).filter((x) => x !== null);
  const parts = [
    { id: 'dsa', value: Math.min(1, dsaPts / 40), detail: `${solved.length} problems solved, ${dsaPts} of 40 points` },
    { id: 'assessments', value: bestVals.length ? bestVals.reduce((a, b) => a + b, 0) / bestVals.length / 100 : 0, detail: bestVals.length ? `Average best score ${Math.round(bestVals.reduce((a, b) => a + b, 0) / bestVals.length)}% across ${bestVals.length}` : 'No graded assessments yet' },
    { id: 'projects', value: projs.length ? approved / projs.length : 0, detail: `${approved} of ${projs.length} approved` },
    { id: 'portfolio', value: portfolio, detail: `${Math.round(portfolio * 4)} of 4 items in place` },
    { id: 'mock', value: mocks.length ? mocks.reduce((a, m) => a + m.score, 0) / mocks.length / 5 : 0, detail: mocks.length ? `${mocks.length} completed, average ${(mocks.reduce((a, m) => a + m.score, 0) / mocks.length).toFixed(1)} of 5` : 'No mock interview yet' },
    { id: 'attendance', value: att.length ? att.reduce((a, b) => a + b, 0) / att.length / 100 : null, detail: att.length ? `${Math.round(att.reduce((a, b) => a + b, 0) / att.length)}% attended` : 'No sessions held yet (excluded)' },
  ].map((p) => ({ ...p, label: READINESS_PARTS[p.id], weight: w[p.id] }));
  const counted = parts.filter((p) => p.value !== null);
  const wsum = counted.reduce((a, p) => a + p.weight, 0) || 1;
  const score = Math.round((counted.reduce((a, p) => a + p.weight * p.value, 0) / wsum) * 100);
  const gaps = counted.map((p) => ({ ...p, gap: p.weight * (1 - p.value) })).filter((p) => p.gap > 0.5).sort((a, b) => b.gap - a.gap);
  return { score, parts, gaps, level: score >= 75 ? 'Ready' : score >= 55 ? 'Nearly ready' : 'Building', dsaPts, solved: solved.length };
}

/** Job eligibility: open, readiness threshold, domain match, active status. Returns reasons. */
export function jobEligibility(state, student, job, ready = readiness(state, student)) {
  const reasons = [];
  if (job.status !== 'open') reasons.push('Applications are closed');
  if (student.status !== 'active') reasons.push('Only active learners can apply');
  if (ready.score < job.minReadiness) reasons.push(`Readiness ${ready.score} is below the required ${job.minReadiness}`);
  const cohort = state.cohorts.find((c) => c.id === student.cohortId);
  const domains = new Set([cohort?.domain, ...state.enrollments.filter((e) => e.studentId === student.id).map((e) => state.courses.find((c) => c.id === e.courseId)?.domain)]);
  if (!domains.has(job.domain) && !(job.domain === 'prog')) reasons.push('Program track does not match this role');
  return { eligible: reasons.length === 0, reasons };
}

export const APP_STAGES = ['applied', 'shortlisted', 'interview', 'offer', 'hired'];
export const APP_LABEL = { applied: 'Applied', shortlisted: 'Shortlisted', interview: 'Interviewing', offer: 'Offer', hired: 'Hired', rejected: 'Not selected', withdrawn: 'Withdrawn' };
export function moveApplication(app, to, by, note, now = new Date()) {
  const i = APP_STAGES.indexOf(app.stage), j = APP_STAGES.indexOf(to);
  if (['rejected', 'withdrawn', 'hired'].includes(app.stage)) throw new Error('This application is closed.');
  if (!['rejected', 'withdrawn'].includes(to) && j !== i + 1) throw new Error('Move one stage at a time.');
  if (to === 'offer' && String(note || '').trim().length < 5) throw new Error('Record the offer details (role, start date) before moving to offer.');
  app.history.push({ at: new Date(now).toISOString(), stage: to, by, note: note || '' });
  app.stage = to;
  if (to === 'offer') app.offer = { recordedAt: new Date(now).toISOString(), note };
  return app;
}
