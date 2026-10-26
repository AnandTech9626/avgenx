// Data-access scoping: which records an actor may see. This mirrors what the API must enforce
// server-side (row-level security / tenant filters). Views never filter by role themselves;
// they ask these functions.

/** @typedef {{ role: string, id: string, orgId?: string }} Actor */

export function userById(state, id) {
  return state.students.find((s) => s.id === id) || state.users.find((u) => u.id === id) || null;
}
export const displayName = (state, id) => userById(state, id)?.name || (id === 'system' ? 'System' : 'Unknown user');

/** Students visible to an actor. Corporate clients are tenant-isolated to their org. */
export function visibleStudents(state, actor) {
  const all = state.students;
  switch (actor.role) {
    case 'student': return all.filter((s) => s.id === actor.id);
    case 'corporate': return all.filter((s) => s.orgId && s.orgId === actor.orgId);
    case 'mentor': return all.filter((s) => s.mentorId === actor.id);
    case 'instructor':
    case 'ta': {
      const mine = new Set(teachingCourseIds(state, actor));
      const ids = new Set(state.enrollments.filter((e) => mine.has(e.courseId)).map((e) => e.studentId));
      return all.filter((s) => ids.has(s.id));
    }
    default: return all;
  }
}
export const canSeeStudent = (state, actor, studentId) => visibleStudents(state, actor).some((s) => s.id === studentId);

export function teachingCourseIds(state, actor) {
  if (actor.role === 'instructor') return state.courses.filter((c) => c.instructorId === actor.id).map((c) => c.id);
  if (actor.role === 'ta') {
    const me = state.users.find((u) => u.id === actor.id);
    return state.courses.filter((c) => me?.domains?.includes(c.domain)).map((c) => c.id);
  }
  if (actor.role === 'mentor') return state.courses.filter((c) => c.mentorIds.includes(actor.id)).map((c) => c.id);
  return state.courses.map((c) => c.id);
}

/** Orgs visible: corporate sees only its own tenant. */
export function visibleOrgs(state, actor) {
  if (actor.role === 'corporate') return state.orgs.filter((o) => o.id === actor.orgId);
  return state.orgs;
}

/** Cohorts visible: private corporate cohorts are hidden from other tenants and from students outside them. */
export function visibleCohorts(state, actor) {
  if (actor.role === 'corporate') return state.cohorts.filter((c) => c.orgId === actor.orgId);
  if (actor.role === 'student') { const me = state.students.find((s) => s.id === actor.id); return state.cohorts.filter((c) => c.id === me?.cohortId); }
  return state.cohorts;
}

/** Discussion threads visible: cohort channels are private to members and staff. */
export function canSeeThread(state, actor, t) {
  if (t.status === 'hidden' && !['instructor', 'ta', 'director', 'admin', 'superadmin'].includes(actor.role)) return false;
  if (t.scope.type !== 'cohort') return true;
  if (actor.role === 'student') return state.students.find((s) => s.id === actor.id)?.cohortId === t.scope.id;
  if (actor.role === 'corporate') return state.cohorts.find((c) => c.id === t.scope.id)?.orgId === actor.orgId;
  return true;
}

/** Private mentor notes: only the owning mentor, the academic director and super admins. Never students. */
export function canReadMentorNote(actor, note) {
  if (['director', 'superadmin'].includes(actor.role)) return true;
  return actor.role === 'mentor' && note.mentorId === actor.id;
}
