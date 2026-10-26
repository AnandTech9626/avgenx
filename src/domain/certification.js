// Certificate eligibility. A certificate is issued only when every configured requirement is met;
// the checklist explains each one so learners and staff see exactly what is missing.
import { progressOf, enrollmentFor } from './progress.js';
import { hash } from '../core/util.js';

export function attendancePct(state, studentId, courseId) {
  const held = state.sessions.filter((s) => s.courseId === courseId && s.status === 'completed' && s.attendance && studentId in s.attendance);
  if (!held.length) return null; // no sessions held: requirement treated as not applicable
  return Math.round((held.filter((s) => s.attendance[studentId]).length / held.length) * 100);
}

export function eligibility(state, studentId, courseId) {
  const course = state.courses.find((c) => c.id === courseId);
  const enr = enrollmentFor(state, studentId, courseId);
  const p = enr ? progressOf(course, enr) : { pct: 0, done: 0, total: 0 };
  const rules = course.pass;
  const checks = [];
  checks.push({ id: 'lessons', label: `Complete ${rules.lessonsPct}% of lessons`, met: p.pct >= rules.lessonsPct, detail: `${p.done} of ${p.total} lessons (${p.pct}%)` });
  if (course.assessmentId) {
    const best = state.attempts.filter((a) => a.studentId === studentId && a.assessmentId === course.assessmentId && a.status === 'graded').reduce((m, a) => Math.max(m, a.pct ?? 0), -1);
    checks.push({ id: 'assessment', label: `Score at least ${rules.minScore}% on the course assessment`, met: best >= rules.minScore, detail: best < 0 ? 'No graded attempt yet' : `Best graded score ${best}%` });
  }
  if (rules.projectRequired) {
    const projs = state.projects.filter((x) => x.studentId === studentId && x.courseId === courseId);
    const approved = projs.filter((x) => x.state === 'approved').length;
    checks.push({ id: 'project', label: 'Required projects approved', met: projs.length > 0 && approved === projs.length, detail: projs.length ? `${approved} of ${projs.length} approved` : 'No project assigned yet' });
  }
  const att = attendancePct(state, studentId, courseId);
  checks.push({ id: 'attendance', label: `Attend at least ${rules.attendancePct}% of live sessions`, met: att === null || att >= rules.attendancePct, detail: att === null ? 'No live sessions held for this course' : `${att}% attended` });
  if (rules.instructorApproval) checks.push({ id: 'approval', label: 'Instructor sign-off', met: !!enr?.approvedBy, detail: enr?.approvedBy ? 'Signed off' : 'Waiting for instructor sign-off' });
  const issued = state.certificates.find((c) => c.studentId === studentId && c.courseId === courseId && c.status === 'issued');
  return { course, checks, eligible: checks.every((c) => c.met), issued, progress: p };
}

export const certId = (courseId, studentId) => `AVX-CRT-${courseId}-${studentId.slice(1)}`;
export const verifyCode = (id) => (hash(id) % 1e6).toString().padStart(6, '0');

export function issueCertificate(state, studentId, courseId, by, now = new Date()) {
  const el = eligibility(state, studentId, courseId);
  if (el.issued) throw new Error('A valid certificate already exists for this course.');
  if (!el.eligible) throw new Error(`Not eligible yet: ${el.checks.filter((c) => !c.met).map((c) => c.label.toLowerCase()).join('; ')}.`);
  const prev = state.certificates.find((c) => c.studentId === studentId && c.courseId === courseId);
  const id = prev ? `${certId(courseId, studentId)}-R${state.certificates.filter((c) => c.id.startsWith(certId(courseId, studentId))).length}` : certId(courseId, studentId);
  const cert = { id, studentId, courseId, issuedAt: new Date(now).toISOString(), issuedBy: by, status: 'issued' };
  state.certificates.push(cert);
  return cert;
}

export function revokeCertificate(state, id, reason, by, now = new Date()) {
  const c = state.certificates.find((x) => x.id === id);
  if (!c) throw new Error('Certificate not found.');
  if (c.status === 'revoked') throw new Error('Already revoked.');
  if (String(reason || '').trim().length < 8) throw new Error('Give a reason of at least 8 characters; it is shown on the public verification page.');
  Object.assign(c, { status: 'revoked', revokedReason: reason.trim(), revokedAt: new Date(now).toISOString(), revokedBy: by });
  return c;
}
