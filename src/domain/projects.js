// Assignment and project lifecycle as an explicit state machine.
// Draft → Published → Assigned → In Progress → Submitted → Under Review → Revision Requested → Approved
// (Draft and Published belong to the assignment; the rest to each learner's work item.)
import { daysBetween, iso } from '../core/util.js';

export const STATE_LABEL = { assigned: 'Assigned', in_progress: 'In progress', submitted: 'Submitted', under_review: 'Under review', revision: 'Revision requested', approved: 'Approved' };
export const STATE_PILL = { assigned: 'p-mute', in_progress: 'p-info', submitted: 'p-pencil', under_review: 'p-warn', revision: 'p-bad', approved: 'p-ok' };
export const ORDER = ['assigned', 'in_progress', 'submitted', 'under_review', 'revision', 'approved'];

/** event -> { from: [states], to, who: 'learner'|'reviewer' } */
export const TRANSITIONS = {
  start: { from: ['assigned'], to: 'in_progress', who: 'learner', label: 'Start work' },
  submit: { from: ['in_progress'], to: 'submitted', who: 'learner', label: 'Submit for review' },
  withdraw: { from: ['submitted'], to: 'in_progress', who: 'learner', label: 'Withdraw submission' },
  resubmit: { from: ['revision'], to: 'submitted', who: 'learner', label: 'Resubmit' },
  startReview: { from: ['submitted'], to: 'under_review', who: 'reviewer', label: 'Start review' },
  requestRevision: { from: ['under_review'], to: 'revision', who: 'reviewer', label: 'Request revision' },
  approve: { from: ['under_review'], to: 'approved', who: 'reviewer', label: 'Approve' },
};
export const allowedEvents = (project, who) => Object.entries(TRANSITIONS).filter(([, t]) => t.who === who && t.from.includes(project.state)).map(([k]) => k);

const REPO_RE = /^https:\/\/(github\.com|gitlab\.com|bitbucket\.org)\/[\w.-]+\/[\w.-]+\/?$/i;
const URL_RE = /^https:\/\/[^\s/$.?#].[^\s]*$/i;
export function validateSubmission({ repo, demo, note }) {
  const errors = {};
  if (!REPO_RE.test(String(repo || '').trim())) errors.repo = 'Use an https GitHub, GitLab or Bitbucket repository URL, like https://github.com/you/project.';
  if (demo && !URL_RE.test(String(demo).trim())) errors.demo = 'Demo links must start with https://';
  if (String(note || '').length > 1000) errors.note = 'Keep the note under 1,000 characters.';
  return errors;
}

export function validateScores(rubric, scores) {
  const errors = {};
  rubric.forEach((r) => {
    const v = scores[r.id];
    if (v === undefined || v === '' || Number.isNaN(Number(v))) errors[r.id] = 'Required';
    else if (Number(v) < 0 || Number(v) > r.max) errors[r.id] = `0 to ${r.max}`;
  });
  return errors;
}

/** Late penalty from the assignment's policy, applied to the rubric total at approval. */
export function latePenalty(assignment, project) {
  if (!project.submittedAt || !project.due) return { daysLate: 0, penaltyPct: 0 };
  const daysLate = Math.max(0, daysBetween(project.due, project.submittedAt));
  const over = Math.max(0, daysLate - (assignment.late?.graceDays || 0));
  return { daysLate, penaltyPct: over > 0 ? Math.min(50, over * (assignment.late?.penaltyPct || 0)) : 0 };
}
export function totalScore(assignment, project) {
  const max = assignment.rubric.reduce((a, r) => a + r.max, 0);
  const raw = assignment.rubric.reduce((a, r) => a + (Number(project.scores?.[r.id]) || 0), 0);
  const { penaltyPct } = latePenalty(assignment, project);
  const final = Math.round(raw * (1 - penaltyPct / 100) * 10) / 10;
  return { raw, max, final, pct: max ? Math.round((final / max) * 100) : 0, penaltyPct };
}

/**
 * Apply a transition with validation. Mutates project; returns the history entry.
 * payload: { repo, demo, note, scores, comment }
 */
export function transition(project, assignment, event, actorId, payload = {}, now = new Date()) {
  const t = TRANSITIONS[event];
  if (!t) throw new Error('Unknown action.');
  if (!t.from.includes(project.state)) throw new Error(`Cannot ${t.label.toLowerCase()} while the project is ${STATE_LABEL[project.state].toLowerCase()}.`);
  const at = new Date(now).toISOString();
  if (event === 'submit' || event === 'resubmit') {
    const errs = validateSubmission(payload);
    if (Object.keys(errs).length) { const e = new Error('Fix the highlighted fields.'); e.fields = errs; throw e; }
    project.repo = payload.repo.trim();
    project.demo = (payload.demo || '').trim();
    project.versions = [...(project.versions || []), { v: (project.versions?.length || 0) + 1, at, repo: project.repo, note: payload.note || (event === 'resubmit' ? 'Revision submitted' : 'Submitted') }];
    project.submittedAt = at;
  }
  if (event === 'requestRevision' && String(payload.comment || '').trim().length < 10) throw new Error('Explain what needs to change (at least 10 characters).');
  if (event === 'approve') {
    const errs = validateScores(assignment.rubric, payload.scores || {});
    if (Object.keys(errs).length) { const e = new Error('Score every rubric criterion within its range.'); e.fields = errs; throw e; }
    project.scores = Object.fromEntries(Object.entries(payload.scores).map(([k, v]) => [k, Number(v)]));
    project.approvedAt = at;
  }
  if (payload.comment) project.comments = [...(project.comments || []), { by: actorId, at, text: payload.comment.trim() }];
  const entry = { at, by: actorId, from: project.state, to: t.to, note: payload.comment || payload.note || t.label };
  project.history = [...(project.history || []), entry];
  project.state = t.to;
  return entry;
}

/** Create learner work items when an assignment is published for a course. */
export function publishAssignment(state, assignment, now = new Date()) {
  if (assignment.status === 'published') throw new Error('Already published.');
  if (!assignment.title?.trim() || assignment.rubric.length === 0) throw new Error('Add a title and at least one rubric criterion.');
  assignment.status = 'published';
  assignment.publishedAt = new Date(now).toISOString();
  const learners = state.enrollments.filter((e) => e.courseId === assignment.courseId);
  let n = 0;
  learners.forEach((e) => {
    const id = `PR-${e.studentId}-${assignment.id}`;
    if (state.projects.some((p) => p.id === id)) return;
    state.projects.push({ id, assignmentId: assignment.id, studentId: e.studentId, courseId: assignment.courseId, state: 'assigned', due: iso(new Date(new Date(now).getTime() + assignment.dueOffset * 864e5)), repo: '', demo: '', files: [], versions: [], history: [], scores: {}, comments: [], plagiarism: { status: 'not_configured' }, reviewerId: state.courses.find((c) => c.id === assignment.courseId)?.instructorId, submittedAt: null });
    n++;
  });
  return n;
}
