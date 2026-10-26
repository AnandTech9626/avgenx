// Course progress rules. Progress changes ONLY through completeLesson(), which validates
// enrollment, prerequisites, unlock order and the lesson's own completion evidence.
import { PROBLEMS } from '../data/problems.js';
import { QUESTIONS } from '../data/questions.js';
import { hash, iso } from '../core/util.js';

export const lessonsOf = (course) => course.modules.flatMap((m) => m.lessons);
export const findLesson = (course, lessonId) => lessonsOf(course).find((l) => l.id === lessonId);

export function enrollmentFor(state, studentId, courseId) {
  return state.enrollments.find((e) => e.studentId === studentId && e.courseId === courseId) || null;
}

export function progressOf(course, enr) {
  const lessons = lessonsOf(course);
  const doneIds = enr ? Object.keys(enr.done) : [];
  const done = lessons.filter((l) => doneIds.includes(l.id)).length;
  const next = lessons.find((l) => !enr?.done[l.id]) || null;
  const times = doneIds.map((id) => enr.done[id]).sort();
  return { done, total: lessons.length, pct: lessons.length ? Math.round((done / lessons.length) * 100) : 0, next, lastAt: times[times.length - 1] || null, mins: lessons.filter((l) => enr?.done[l.id]).reduce((a, l) => a + l.mins, 0) };
}

/** Course-level prerequisites: each prerequisite course must be completed (all lessons). */
export function prerequisitesMet(state, studentId, course) {
  const missing = course.prereqs.filter((pid) => {
    const pc = state.courses.find((c) => c.id === pid);
    const e = enrollmentFor(state, studentId, pid);
    return !pc || !e || progressOf(pc, e).pct < 100;
  });
  return { met: missing.length === 0, missing };
}

/** Lessons unlock in order: a lesson is open when every earlier lesson is done. */
export function isUnlocked(course, enr, lessonId) {
  const lessons = lessonsOf(course);
  const i = lessons.findIndex((l) => l.id === lessonId);
  if (i < 0 || !enr) return false;
  return lessons.slice(0, i).every((l) => enr.done[l.id]);
}

/** Evidence each lesson type needs before it can be completed. */
const SKILL_PROBLEMS = { prog: ['two-sum', 'valid-parentheses', 'binary-search', 'max-subarray', 'merge-intervals', 'climbing-stairs', 'number-of-islands', 'coin-change', 'course-schedule', 'lis', 'kth-largest', 'house-robber'], web: ['reverse-string', 'valid-palindrome', 'fizzbuzz', 'longest-common-prefix', 'reverse-words', 'string-compression', 'group-anagrams', 'top-k-frequent'], data: ['contains-duplicate', 'array-intersection', 'top-k-frequent', 'merge-sorted', 'majority-element'] };
export function exerciseProblem(course, lesson) {
  const list = SKILL_PROBLEMS[course.domain] || SKILL_PROBLEMS.prog;
  const id = list[hash(lesson.id) % list.length];
  return PROBLEMS.find((p) => p.id === id);
}
export function lessonQuiz(course, lesson) {
  const bank = QUESTIONS.filter((q) => q.domain === course.domain && ['mcq', 'multi'].includes(q.type));
  const h = hash(lesson.id);
  const picked = [];
  for (let k = 0; picked.length < Math.min(3, bank.length); k++) { const q = bank[(h + k * 7) % bank.length]; if (!picked.includes(q)) picked.push(q); }
  return picked;
}
export function lessonRequirement(course, lesson) {
  if (lesson.type === 'quiz') return { kind: 'quiz', label: 'Score at least 2 of 3 on the module check' };
  if (lesson.type === 'exercise') {
    const p = ['prog', 'web', 'data'].includes(course.domain) ? exerciseProblem(course, lesson) : null;
    return p ? { kind: 'problem', problemId: p.id, label: `Get "${p.title}" accepted in the Coding Lab` } : { kind: 'reflection', label: 'Write a lab reflection of at least 40 characters' };
  }
  return { kind: 'view', label: lesson.type === 'video' ? 'Watch the lesson, then mark it complete' : 'Read the lesson, then mark it complete' };
}

/** Pure validation; returns null when OK or a human-readable reason. */
export function canComplete(state, studentId, courseId, lessonId, evidence = {}) {
  const course = state.courses.find((c) => c.id === courseId);
  if (!course) return 'Course not found.';
  const enr = enrollmentFor(state, studentId, courseId);
  if (!enr) return 'You are not enrolled in this course.';
  const lesson = findLesson(course, lessonId);
  if (!lesson) return 'Lesson not found.';
  if (enr.done[lessonId]) return 'Lesson is already complete.';
  if (!isUnlocked(course, enr, lessonId)) return 'Finish the earlier lessons first.';
  const req = lessonRequirement(course, lesson);
  if (req.kind === 'quiz' && !(evidence.quizScore >= 2)) return 'Score at least 2 of 3 on the module check to complete it.';
  if (req.kind === 'problem' && !state.submissions.some((s) => s.studentId === studentId && s.problemId === req.problemId && s.status === 'Accepted')) return `Solve "${req.label.match(/"(.+)"/)[1]}" in the Coding Lab first.`;
  if (req.kind === 'reflection' && String(evidence.reflection || '').trim().length < 40) return 'Write at least 40 characters about what you did in the lab.';
  return null;
}

export function completeLesson(state, studentId, courseId, lessonId, evidence = {}, now = new Date()) {
  const err = canComplete(state, studentId, courseId, lessonId, evidence);
  if (err) throw new Error(err);
  const course = state.courses.find((c) => c.id === courseId);
  const enr = enrollmentFor(state, studentId, courseId);
  enr.done[lessonId] = new Date(now).toISOString();
  if (evidence.reflection) (enr.reflections ||= {})[lessonId] = evidence.reflection;
  const p = progressOf(course, enr);
  if (p.pct === 100) enr.status = 'completed';
  return p;
}

/** Enroll a student, enforcing course prerequisites and publication status. */
export function enroll(state, studentId, courseId, now = new Date(), { override = false } = {}) {
  const course = state.courses.find((c) => c.id === courseId);
  if (!course || course.status !== 'published') throw new Error('Only published courses accept enrollments.');
  if (enrollmentFor(state, studentId, courseId)) throw new Error('Already enrolled.');
  const pre = prerequisitesMet(state, studentId, course);
  if (!pre.met && !override) throw new Error(`Complete the prerequisites first: ${pre.missing.join(', ')}.`);
  const e = { id: `E-${studentId}-${courseId}`, studentId, courseId, enrolledAt: iso(now), done: {}, status: 'active', approvedBy: null };
  state.enrollments.push(e);
  return e;
}
