// Course lifecycle: Draft → In review → Approved → Published (→ Archived, reversible).
// Validation must pass before review; approval needs the academic-approval permission.
import { lessonsOf } from './progress.js';

export const COURSE_STATES = { draft: ['Draft', 'p-mute'], review: ['In review', 'p-warn'], approved: ['Approved', 'p-info'], published: ['Published', 'p-ok'], archived: ['Archived', 'p-bad'] };

export function validateCourse(state, c) {
  const lessons = lessonsOf(c);
  const mins = lessons.reduce((a, l) => a + l.mins, 0);
  const checks = [
    { id: 'title', label: 'Title and code set', ok: c.title?.trim().length >= 5 && /^[A-Z]{3}\d{3}$/.test(c.id) },
    { id: 'outcomes', label: 'At least two learning outcomes', ok: (c.outcomes || []).filter((o) => o.trim()).length >= 2 },
    { id: 'modules', label: 'At least two modules, each with two or more lessons', ok: c.modules.length >= 2 && c.modules.every((m) => m.lessons.length >= 2) },
    { id: 'assess', label: 'An assessment or a module check per course', ok: !!c.assessmentId || lessons.some((l) => l.type === 'quiz') },
    { id: 'instructor', label: 'Instructor assigned', ok: !!state.users.find((u) => u.id === c.instructorId) },
    { id: 'mentor', label: 'At least one mentor assigned', ok: (c.mentorIds || []).length >= 1 },
    { id: 'hours', label: 'Learning-hour estimate covers lesson time', ok: c.hours * 60 >= mins, detail: `${c.hours} h declared vs ${Math.round(mins / 60)} h of lessons` },
    { id: 'prereq', label: 'Prerequisites exist and do not loop back to this course', ok: c.prereqs.every((p) => { const pc = state.courses.find((x) => x.id === p); return pc && !pc.prereqs.includes(c.id) && p !== c.id; }) },
  ];
  return { checks, ok: checks.every((x) => x.ok) };
}

const NEXT = { draft: ['review'], review: ['approved', 'draft'], approved: ['published', 'draft'], published: ['archived'], archived: ['draft'] };
export function canMove(from, to) { return (NEXT[from] || []).includes(to); }

export function moveCourse(state, c, to, by, note = '', now = new Date()) {
  if (!canMove(c.status, to)) throw new Error(`A ${c.status} course cannot move to ${to}.`);
  if (to === 'review') { const v = validateCourse(state, c); if (!v.ok) throw new Error(`Fix before review: ${v.checks.filter((x) => !x.ok).map((x) => x.label.toLowerCase()).join('; ')}.`); }
  if (to === 'draft' && c.status === 'review' && String(note).trim().length < 10) throw new Error('Explain what needs to change (at least 10 characters).');
  const at = new Date(now).toISOString();
  if (to === 'published') {
    c.version = (c.version || 0) + 1;
    c.versions = [...(c.versions || []), { v: c.version, at, by, note: note || 'Published' }];
    c.publishAt = c.publishAt && c.publishAt > at.slice(0, 10) ? c.publishAt : at.slice(0, 10);
  }
  c.workflow = [...(c.workflow || []), { at, by, state: to, note: note || '' }];
  c.status = to;
  return c;
}

export function newCourse({ id, title, domain, level, hours, instructorId }) {
  return { id, title, domain, level, hours: Number(hours), prereqs: [], skills: [], outcomes: ['', ''], modules: [{ id: `${id}-M1`, title: 'Module 1', lessons: [] }], status: 'draft', version: 0, instructorId, mentorIds: [], assessmentId: null, pass: { lessonsPct: 100, minScore: 60, projectRequired: true, attendancePct: 75, instructorApproval: false }, publishAt: null, versions: [], workflow: [], feedback: { rating: 0, responses: 0 } };
}

/** Renumber lesson ids for a course after structural edits, preserving existing ids. */
export function nextLessonId(c) {
  const nums = lessonsOf(c).map((l) => Number(l.id.split('-L')[1]) || 0);
  return `${c.id}-L${Math.max(0, ...nums) + 1}`;
}
