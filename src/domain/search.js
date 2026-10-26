// Unified, permission-aware search. The index is built per actor so results never include
// records the actor cannot open (other tenants, other learners, private channels).
import { PROBLEMS } from '../data/problems.js';
import { DOMAINS } from '../data/catalog.js';
import { navFor, can } from '../core/rbac.js';
import { visibleStudents, canSeeThread, teachingCourseIds } from './scope.js';
import { lessonsOf } from './progress.js';

export const CATEGORIES = [
  ['all', 'All'], ['page', 'Pages'], ['course', 'Courses'], ['lesson', 'Lessons'], ['problem', 'Problems'], ['person', 'People'],
  ['project', 'Projects'], ['thread', 'Discussions'], ['job', 'Jobs'], ['student', 'Students'],
];

export function buildIndex(state, actor) {
  const ov = state.settings.permOverrides;
  const C = (p) => can(actor.role, p, ov);
  const out = [];
  const push = (type, id, title, sub, link, extra = '') => out.push({ type, id, title, sub, link, hay: `${title} ${sub} ${extra}`.toLowerCase() });
  navFor(actor.role, ov).forEach((g) => g.items.forEach((i) => push('page', i.path, i.label, g.group, i.path)));
  DOMAINS.forEach((d) => push('page', `domain-${d.id}`, d.name, 'Domain', `/programs/${d.id}`, d.tagline));
  const courseVisible = (c) => c.status === 'published' || C('courses.view');
  state.courses.filter(courseVisible).forEach((c) => {
    push('course', c.id, `${c.id} · ${c.title}`, `${DOMAINS.find((d) => d.id === c.domain).short} · ${c.level}${c.status !== 'published' ? ` · ${c.status}` : ''}`, `/course/${c.id}`, c.skills.join(' '));
    lessonsOf(c).forEach((l) => push('lesson', l.id, l.title, `${c.id} · ${l.type}`, `/course/${c.id}/learn/${l.id}`));
  });
  if (C('lab.use') || C('arena.use')) PROBLEMS.forEach((p) => push('problem', p.id, p.title, `${p.diff} · ${p.topics.join(', ')}`, `/lab/${p.id}`, p.topics.join(' ')));
  state.users.filter((u) => ['instructor', 'mentor'].includes(u.role)).forEach((u) => push('person', u.id, u.name, `${u.role === 'mentor' ? 'Mentor' : 'Instructor'} · ${u.domains.map((d) => DOMAINS.find((x) => x.id === d)?.short).join(', ')}`, u.role === 'mentor' ? '/mentors' : `/ops/faculty`, u.domains.join(' ')));
  if (actor.role === 'student') {
    state.projects.filter((p) => p.studentId === actor.id).forEach((p) => { const a = state.assignments.find((x) => x.id === p.assignmentId); push('project', p.id, a?.title || p.assignmentId, `Your project · ${p.state.replace('_', ' ')}`, `/projects/${p.id}`); });
  } else if (C('projects.review') || C('projects.manage')) {
    const mine = new Set(teachingCourseIds(state, actor));
    state.assignments.filter((a) => mine.has(a.courseId)).forEach((a) => push('project', a.id, a.title, `${a.courseId} · ${a.kind} · ${a.status}`, `/projects?assignment=${a.id}`));
  }
  state.threads.filter((t) => canSeeThread(state, actor, t)).forEach((t) => push('thread', t.id, t.title, `${t.kind} · ${t.scope.type === 'course' ? t.scope.id : 'cohort channel'}`, `/discussions/${t.id}`, t.body + ' ' + t.tags.join(' ')));
  if (C('career.self') || C('placement.view')) state.jobs.forEach((j) => push('job', j.id, j.title, `${state.employers.find((e) => e.id === j.employerId)?.name} · ${j.kind} · ${j.location}`, `/jobs?job=${j.id}`, j.skills.join(' ')));
  if (C('students.view') || actor.role === 'corporate') visibleStudents(state, actor).forEach((s) => push('student', s.id, s.name, `${s.learnerId} · ${state.cohorts.find((c) => c.id === s.cohortId)?.name || ''}`, `/ops/students/${s.id}`, s.email + ' ' + s.city));
  return out;
}

export function search(index, q, cat = 'all', limit = 40) {
  const terms = String(q || '').toLowerCase().trim().split(/\s+/).filter(Boolean);
  const pool = cat === 'all' ? index : index.filter((x) => x.type === cat);
  if (!terms.length) return [];
  return pool
    .map((x) => {
      let s = 0;
      for (const t of terms) {
        if (!x.hay.includes(t)) return null;
        const title = x.title.toLowerCase();
        s += title.startsWith(t) ? 6 : title.includes(t) ? 4 : 1;
      }
      if (x.type === 'page') s += 1;
      return { ...x, score: s };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .slice(0, limit);
}
