import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateSeed } from '../../src/data/seed.js';
import { PROBLEMS } from '../../src/data/problems.js';
import { QUESTIONS, ASSESSMENTS } from '../../src/data/questions.js';
import { deepEqual } from '../../src/core/util.js';
import { can, navFor, ROLES, PERMISSIONS } from '../../src/core/rbac.js';
import { visibleStudents, canReadMentorNote, canSeeThread } from '../../src/domain/scope.js';
import { progressOf, completeLesson, canComplete, lessonsOf, enroll, isUnlocked, lessonRequirement } from '../../src/domain/progress.js';
import { drawQuestions, gradeQuestion, scoreAttempt, startAttempt, submitAttempt, applyManualGrade, attemptStatus } from '../../src/domain/assessment.js';
import { transition, allowedEvents, validateSubmission, latePenalty, publishAssignment } from '../../src/domain/projects.js';
import { eligibility, issueCertificate, revokeCertificate } from '../../src/domain/certification.js';
import { buildActivityIndex, streak } from '../../src/domain/activity.js';
import { evaluateAll, advanceIntervention } from '../../src/domain/risk.js';
import { readiness, jobEligibility, moveApplication } from '../../src/domain/career.js';
import { xpLedger, leaderboard, weeklyContest } from '../../src/domain/motivation.js';
import { recordPayment, applyAdjustment, requestRefund, decideRefund, invoiceStatus } from '../../src/domain/fees.js';
import { execMetrics, execSummary } from '../../src/domain/analytics.js';
import { buildIndex, search } from '../../src/domain/search.js';

const NOW = new Date('2026-10-24T10:00:00');
const fresh = () => generateSeed(NOW);

test('seed meets the dataset requirements', () => {
  const s = fresh();
  assert.ok(s.domains.length >= 8, 'domains');
  assert.ok(s.courses.length >= 24, 'courses');
  assert.ok(s.cohorts.length >= 8, 'cohorts');
  assert.ok(s.users.filter((u) => ['instructor', 'mentor'].includes(u.role)).length >= 20, 'instructors + mentors');
  assert.ok(s.students.length >= 100, 'students');
  assert.ok(PROBLEMS.length >= 50, 'problems');
  assert.ok(s.assignments.length >= 30, 'assignments');
  assert.ok(s.sessions.length >= 20, 'sessions');
  assert.ok(s.orgs.length >= 3 && s.jobs.length >= 10);
  assert.equal(JSON.stringify(generateSeed(NOW)), JSON.stringify(s), 'deterministic for same day and seed');
});

test('every reference solution passes its own tests', () => {
  for (const p of PROBLEMS) {
    // eslint-disable-next-line no-new-func
    const fn = new Function(`${p.solution}\nreturn ${p.fn};`)();
    p.tests.forEach(([args, expected], i) => {
      const got = fn(...JSON.parse(JSON.stringify(args)));
      assert.ok(deepEqual(got, expected), `${p.id} test ${i}: got ${JSON.stringify(got)} expected ${JSON.stringify(expected)}`);
    });
  }
});

test('assessment banks reference real questions and problems', () => {
  for (const a of ASSESSMENTS) for (const id of a.bank) assert.ok(QUESTIONS.find((q) => q.id === id), `${a.id} -> ${id}`);
  for (const q of QUESTIONS.filter((x) => x.type === 'code')) assert.ok(PROBLEMS.find((p) => p.id === q.problem), q.id);
});

test('RBAC: navigation and permissions differ by role', () => {
  for (const r of ROLES) assert.ok(navFor(r.id, {}).length >= 1, r.id);
  assert.equal(can('student', 'fees.view'), false);
  assert.equal(can('admin', 'fees.view'), true);
  assert.equal(can('student', 'fees.view', { student: { 'fees.view': true } }), true, 'override grants');
  assert.equal(can('superadmin', 'roles.manage', { superadmin: { 'roles.manage': false } }), true, 'locked permission cannot be removed');
  for (const p of Object.values(PERMISSIONS)) for (const r of p.roles) assert.ok(ROLES.find((x) => x.id === r), r);
});

test('tenant isolation: corporate clients only see their own org', () => {
  const s = fresh();
  const nw = visibleStudents(s, { role: 'corporate', id: 'U-CC1', orgId: 'ORG-NW' });
  assert.ok(nw.length > 0);
  assert.ok(nw.every((x) => x.orgId === 'ORG-NW'));
  const hf = visibleStudents(s, { role: 'corporate', id: 'U-CC2', orgId: 'ORG-HF' });
  assert.equal(nw.filter((x) => hf.includes(x)).length, 0);
  const index = buildIndex(s, { role: 'corporate', id: 'U-CC1', orgId: 'ORG-NW' });
  const other = s.students.find((x) => x.orgId === 'ORG-HF');
  assert.equal(search(index, other.name, 'student').length, 0, 'search respects tenant boundary');
});

test('privacy: students never read mentor notes; cohort channels are private', () => {
  const s = fresh();
  const note = s.mentorNotes[0];
  assert.equal(canReadMentorNote({ role: 'student', id: note.studentId }, note), false);
  assert.equal(canReadMentorNote({ role: 'mentor', id: note.mentorId }, note), true);
  assert.equal(canReadMentorNote({ role: 'mentor', id: 'U-OTHER' }, note), false);
  const t = s.threads.find((x) => x.scope.type === 'cohort');
  const insider = s.students.find((x) => x.cohortId === t.scope.id);
  const outsider = s.students.find((x) => x.cohortId !== t.scope.id);
  assert.equal(canSeeThread(s, { role: 'student', id: insider.id }, t), true);
  assert.equal(canSeeThread(s, { role: 'student', id: outsider.id }, t), false);
});

test('progress only advances through valid lesson completion', () => {
  const s = fresh();
  const e = s.enrollments.find((x) => x.studentId === 'S1001' && x.status === 'active');
  const c = s.courses.find((x) => x.id === e.courseId);
  const lessons = lessonsOf(c);
  const next = lessons.find((l) => !e.done[l.id]);
  const later = lessons[lessons.length - 1];
  if (later.id !== next.id) assert.match(canComplete(s, 'S1001', c.id, later.id), /earlier lessons/);
  assert.match(canComplete(s, 'S9999', c.id, next.id), /not enrolled/);
  const req = lessonRequirement(c, next);
  const before = progressOf(c, e).done;
  if (req.kind === 'view') { completeLesson(s, 'S1001', c.id, next.id, {}, NOW); assert.equal(progressOf(c, e).done, before + 1); }
  if (req.kind === 'quiz') { assert.throws(() => completeLesson(s, 'S1001', c.id, next.id, { quizScore: 1 }, NOW)); completeLesson(s, 'S1001', c.id, next.id, { quizScore: 3 }, NOW); }
  assert.throws(() => completeLesson(s, 'S1001', c.id, lessons[0].id, {}, NOW), /already complete/);
});

test('enrollment enforces prerequisites', () => {
  const s = fresh();
  const st = s.students.find((x) => x.cohortId === 'C-SEC-A');
  assert.throws(() => enroll(s, st.id, 'ARC301', NOW), /prerequisites/);
  assert.throws(() => enroll(s, st.id, 'UXD101', NOW), /published/);
});

test('assessment: weighted draw, negative marking, manual grading', () => {
  const a = ASSESSMENTS.find((x) => x.id === 'as-dsa-t1');
  const ids = drawQuestions(a, QUESTIONS, 42);
  assert.equal(ids.length, a.pick);
  const qs = ids.map((id) => QUESTIONS.find((q) => q.id === id));
  for (const d of [1, 2, 3]) assert.equal(qs.filter((q) => q.diff === d).length, a.mix[d]);
  assert.deepEqual(drawQuestions(a, QUESTIONS, 42), ids, 'stable for a seed');
  const mcq = QUESTIONS.find((q) => q.id === 'q-p1');
  assert.equal(gradeQuestion(a, mcq, 1).marks, 1);
  assert.equal(gradeQuestion(a, mcq, 0).marks, -0.25);
  assert.equal(gradeQuestion(a, mcq, undefined).marks, 0);
  const sql = QUESTIONS.find((q) => q.id === 'q-d3');
  const sqlA = ASSESSMENTS.find((x) => x.id === 'as-sql');
  assert.equal(gradeQuestion(sqlA, sql, 'SELECT department_id, COUNT(*) FROM employees GROUP BY department_id ORDER BY COUNT(*) DESC').status, 'correct');
  assert.equal(gradeQuestion(sqlA, sql, 'select * from employees').status, 'pending');

  const s = fresh();
  const st = s.students[5];
  const att = startAttempt(s, st, sqlA, QUESTIONS, NOW);
  att.questionIds.forEach((id) => { const q = QUESTIONS.find((x) => x.id === id); att.answers[id] = q.type === 'mcq' ? q.answer : q.type === 'sql' ? 'select 1' : undefined; });
  const r = submitAttempt(s, att, sqlA, QUESTIONS, NOW);
  assert.ok(r.pending >= 1);
  assert.equal(att.status, 'needs_grading');
  assert.throws(() => submitAttempt(s, att, sqlA, QUESTIONS, NOW), /already submitted/);
  const pend = r.per.filter((p) => p.status === 'pending');
  pend.forEach((p) => applyManualGrade(s, att, sqlA, QUESTIONS, p.id, p.max, 'ok', 'U-I05'));
  assert.equal(att.status, 'graded');
  assert.throws(() => applyManualGrade(s, att, sqlA, QUESTIONS, pend[0].id, 99, '', 'U-I05'), /between/);
  const used = attemptStatus(s, st.id, sqlA).used;
  for (let k = used; k < sqlA.attempts; k++) { const x = startAttempt(s, st, sqlA, QUESTIONS, NOW); submitAttempt(s, x, sqlA, QUESTIONS, NOW); }
  assert.throws(() => startAttempt(s, st, sqlA, QUESTIONS, NOW), /No attempts left/);
});

test('project lifecycle enforces transitions, validation and history', () => {
  const s = fresh();
  const p = s.projects.find((x) => x.state === 'in_progress');
  const a = s.assignments.find((x) => x.id === p.assignmentId);
  assert.deepEqual(allowedEvents(p, 'learner'), ['submit']);
  assert.throws(() => transition(p, a, 'approve', 'U-I01', {}), /Cannot approve/);
  assert.ok(validateSubmission({ repo: 'not a url' }).repo);
  assert.throws(() => transition(p, a, 'submit', p.studentId, { repo: 'ftp://x' }), /Fix the highlighted/);
  transition(p, a, 'submit', p.studentId, { repo: 'https://github.com/demo/project' }, NOW);
  transition(p, a, 'startReview', 'U-I01', {}, NOW);
  assert.throws(() => transition(p, a, 'requestRevision', 'U-I01', { comment: 'no' }), /at least 10/);
  transition(p, a, 'requestRevision', 'U-I01', { comment: 'Please add tests for edge cases.' }, NOW);
  transition(p, a, 'resubmit', p.studentId, { repo: 'https://github.com/demo/project' }, NOW);
  transition(p, a, 'startReview', 'U-I01', {}, NOW);
  assert.throws(() => transition(p, a, 'approve', 'U-I01', { scores: { func: 999 } }), /rubric/);
  transition(p, a, 'approve', 'U-I01', { scores: Object.fromEntries(a.rubric.map((r) => [r.id, r.max])) }, NOW);
  assert.equal(p.state, 'approved');
  assert.equal(p.versions.length >= 2, true);
  assert.ok(p.history.length >= 6);
  assert.equal(latePenalty(a, { submittedAt: '2026-10-10', due: '2026-10-01' }).penaltyPct, 70 > 50 ? 50 : 70);
});

test('publishing an assignment creates work items for enrolled learners', () => {
  const s = fresh();
  const a = { id: 'AS-NEW', courseId: 'WEB201', title: 'New lab', kind: 'assignment', brief: 'x', dueOffset: 7, rubric: [{ id: 'func', label: 'F', max: 10 }], late: { graceDays: 0, penaltyPct: 0 }, status: 'draft' };
  s.assignments.push(a);
  const n = publishAssignment(s, a, NOW);
  assert.equal(n, s.enrollments.filter((e) => e.courseId === 'WEB201').length);
  assert.throws(() => publishAssignment(s, a, NOW), /Already/);
});

test('certificates cannot be issued before requirements are met', () => {
  const s = fresh();
  const e = s.enrollments.find((x) => x.status === 'active');
  assert.throws(() => issueCertificate(s, e.studentId, e.courseId, 'U-DIR', NOW), /Not eligible/);
  const ok = s.enrollments.find((x) => x.status === 'completed' && eligibility(s, x.studentId, x.courseId).eligible && !eligibility(s, x.studentId, x.courseId).issued);
  if (ok) { const c = issueCertificate(s, ok.studentId, ok.courseId, 'U-DIR', NOW); assert.equal(c.status, 'issued'); assert.throws(() => issueCertificate(s, ok.studentId, ok.courseId, 'U-DIR', NOW), /already exists/); }
  const cert = s.certificates.find((c) => c.status === 'issued');
  assert.throws(() => revokeCertificate(s, cert.id, 'no', 'U-DIR'), /reason/);
  revokeCertificate(s, cert.id, 'Academic integrity review outcome', 'U-DIR');
  assert.equal(cert.status, 'revoked');
});

test('risk rules flag inactive learners with evidence; interventions follow the workflow', () => {
  const s = fresh();
  const idx = buildActivityIndex(s);
  const res = evaluateAll(s, idx, NOW);
  const aditya = res.find((r) => s.students.find((x) => x.id === r.studentId).name === 'Aditya Varma');
  assert.ok(aditya.flags.some((f) => f.rule === 'inactive'));
  assert.match(aditya.flags.find((f) => f.rule === 'inactive').evidence, /No learning activity/);
  const riya = res.find((r) => r.studentId === 'S1001');
  assert.ok(!riya.flags.some((f) => f.rule === 'inactive'));
  const iv = s.interventions[0];
  assert.throws(() => advanceIntervention(iv, 'resolved', 'U-M01', 'x'));
  advanceIntervention(iv, 'planned', 'U-M01', 'Two sessions a week for a month', NOW);
  assert.equal(iv.state, 'planned');
  assert.ok(streak(idx, 'S1001', NOW) >= 1);
});

test('readiness is a transparent weighted score; eligibility explains itself', () => {
  const s = fresh();
  const st = s.students[0];
  const r = readiness(s, st);
  assert.ok(r.score >= 0 && r.score <= 100);
  assert.equal(r.parts.length, 6);
  const job = { ...s.jobs[0], minReadiness: 101 };
  const el = jobEligibility(s, st, job, r);
  assert.equal(el.eligible, false);
  assert.match(el.reasons.join(' '), /below the required/);
  const app = { stage: 'applied', history: [] };
  assert.throws(() => moveApplication(app, 'offer', 'U-PLC', ''), /one stage/);
  moveApplication(app, 'shortlisted', 'U-PLC');
});

test('XP is derived and cannot be inflated by repeated submissions', () => {
  const s = fresh();
  const idx = buildActivityIndex(s);
  const before = xpLedger(s, 'S1001', idx, NOW).total;
  const acc = s.submissions.find((x) => x.studentId === 'S1001' && x.status === 'Accepted');
  for (let i = 0; i < 5; i++) s.submissions.push({ ...acc, id: `dup${i}`, at: NOW.toISOString() });
  assert.equal(xpLedger(s, 'S1001', idx, NOW).total, before);
  const lb = leaderboard(s, s.students, NOW, { days: 0 });
  assert.ok(lb.length > 10);
  assert.ok(lb[0].pts >= lb[1].pts);
  assert.match(lb[0].explain, /first-try bonus/);
  assert.equal(weeklyContest(NOW).problems.length >= 3, true);
});

test('fees: offline recording, adjustments and refunds are validated', () => {
  const s = fresh();
  const inv = s.invoices.find((i) => i.installments.some((x) => !x.paidAt));
  const n = inv.installments.find((x) => !x.paidAt).n;
  assert.throws(() => recordPayment(inv, n, { ref: 'ABC123', mode: 'Card (gateway)' }, NOW), /payment provider/);
  assert.throws(() => recordPayment(inv, n, { ref: '1', mode: 'NEFT' }, NOW), /reference/);
  recordPayment(inv, n, { ref: 'NEFT20261024', mode: 'NEFT', date: '2026-10-23' }, NOW);
  assert.throws(() => recordPayment(inv, n, { ref: 'NEFT20261024', mode: 'NEFT' }, NOW), /already paid/);
  const fresh2 = s.invoices.find((i) => i.installments.every((x) => !x.paidAt)) || s.invoices[s.invoices.length - 1];
  const before = fresh2.total;
  if (fresh2.installments.every((x) => !x.paidAt)) { applyAdjustment(fresh2, { scholarshipPct: 20 }); assert.ok(fresh2.total < before); assert.equal(fresh2.installments.reduce((a, x) => a + x.amount, 0), fresh2.total); }
  const paidInv = s.invoices.find((i) => invoiceStatus(i, NOW).paid > 10000);
  assert.throws(() => requestRefund(s, paidInv.studentId, 10 ** 9, 'too much money'), /cannot exceed/);
  const r = requestRefund(s, paidInv.studentId, 1000, 'Course change request', NOW);
  decideRefund(s, r.id, true, 'U-ADM', NOW);
  assert.equal(r.status, 'approved');
});

test('executive metrics are derived from records and change when data changes', () => {
  const s = fresh();
  const idx = buildActivityIndex(s);
  const risk = evaluateAll(s, idx, NOW);
  const m = execMetrics(s, idx, risk, NOW, { days: 90 });
  assert.equal(m.learners, s.students.length);
  assert.ok(m.active > 0 && m.active <= m.learners);
  assert.ok(execSummary(m).length >= 2);
  const before = m.collected;
  const inv = s.invoices.find((i) => i.installments.some((x) => !x.paidAt));
  recordPayment(inv, inv.installments.find((x) => !x.paidAt).n, { ref: 'TESTREF1', mode: 'NEFT', date: '2026-10-24' }, NOW);
  const m2 = execMetrics(s, buildActivityIndex(s), risk, NOW, { days: 90 });
  assert.ok(m2.collected > before, 'collections reflect a newly recorded payment');
  const dom = execMetrics(s, idx, risk, NOW, { days: 90, domain: 'sap' });
  assert.ok(dom.learners < m.learners);
});

import { validateCourse, moveCourse, newCourse } from '../../src/domain/courses.js';
test('course workflow: validation gates review; approval and publishing version the course', () => {
  const s = fresh();
  const c = newCourse({ id: 'WEB401', title: 'Web Performance Engineering', domain: 'web', level: 'Advanced', hours: 30, instructorId: 'U-I03' });
  s.courses.push(c);
  assert.equal(validateCourse(s, c).ok, false);
  assert.throws(() => moveCourse(s, c, 'review', 'U-I03'), /Fix before review/);
  assert.throws(() => moveCourse(s, c, 'published', 'U-DIR'), /cannot move/);
  c.outcomes = ['Measure Core Web Vitals', 'Fix render-blocking resources'];
  c.mentorIds = ['U-M01'];
  c.modules = [{ id: 'WEB401-M1', title: 'Measure', lessons: [{ id: 'WEB401-L1', title: 'Lab tools', type: 'video', mins: 20, module: 0 }, { id: 'WEB401-L2', title: 'Check', type: 'quiz', mins: 15, module: 0 }] }, { id: 'WEB401-M2', title: 'Fix', lessons: [{ id: 'WEB401-L3', title: 'Images', type: 'reading', mins: 20, module: 1 }, { id: 'WEB401-L4', title: 'Fonts', type: 'reading', mins: 20, module: 1 }] }];
  assert.equal(validateCourse(s, c).ok, true);
  moveCourse(s, c, 'review', 'U-I03');
  assert.throws(() => moveCourse(s, c, 'draft', 'U-DIR', 'no'), /Explain/);
  moveCourse(s, c, 'approved', 'U-DIR');
  moveCourse(s, c, 'published', 'U-DIR', 'Initial publication');
  assert.equal(c.version, 1);
  assert.equal(c.workflow.length, 3);
  moveCourse(s, c, 'archived', 'U-DIR');
  moveCourse(s, c, 'draft', 'U-DIR');
  assert.equal(c.status, 'draft');
});

test('search never returns student records to a student', () => {
  const s = fresh();
  const idx = buildIndex(s, { role: 'student', id: 'S1001' });
  assert.equal(search(idx, 'Aditya', 'all').filter((r) => r.type === 'student').length, 0);
  assert.ok(search(idx, 'two sum').some((r) => r.type === 'problem'));
  const staff = buildIndex(s, { role: 'admin', id: 'U-ADM' });
  assert.ok(search(staff, 'Aditya').some((r) => r.type === 'student'));
});
