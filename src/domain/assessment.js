// Assessment engine: randomised difficulty-weighted draws, auto and manual grading,
// negative marking, attempt limits, accommodations and question analytics.
import { rng, hash } from '../core/util.js';

export const allQuestions = (state, QUESTIONS) => [...QUESTIONS, ...(state.customQuestions || [])];

/** Draw question ids for an attempt. Deterministic for a given seed so a resumed attempt is stable. */
export function drawQuestions(assessment, questions, seed) {
  const R = rng(seed);
  const pool = assessment.bank.map((id) => questions.find((q) => q.id === id)).filter(Boolean);
  const pick = Math.min(assessment.pick, pool.length);
  let chosen = [];
  if (assessment.mix) {
    for (const d of [1, 2, 3]) chosen.push(...R.shuffle(pool.filter((q) => q.diff === d)).slice(0, assessment.mix[d] || 0));
  } else {
    // Ensure every difficulty present in the bank appears at least once, then fill randomly.
    for (const d of [1, 2, 3]) { const lvl = pool.filter((q) => q.diff === d); if (lvl.length && chosen.length < pick) chosen.push(R.pick(lvl)); }
  }
  const rest = R.shuffle(pool.filter((q) => !chosen.includes(q)));
  while (chosen.length < pick && rest.length) chosen.push(rest.shift());
  chosen = chosen.slice(0, pick);
  // Present easy to hard, shuffled within each level.
  return [1, 2, 3].flatMap((d) => R.shuffle(chosen.filter((q) => q.diff === d))).map((q) => q.id);
}

export const marksFor = (assessment, q) => assessment.weights?.[q.diff] ?? q.diff;
const norm = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').replace(/;\s*$/, '').trim();

/**
 * Grade one question. Returns { marks, max, status: 'correct'|'wrong'|'partial'|'blank'|'pending', feedback }.
 * Code answers carry a pre-computed { passed, total } result from the sandboxed judge.
 */
export function gradeQuestion(assessment, q, ans) {
  const max = marksFor(assessment, q);
  const neg = assessment.negative || 0;
  const blank = ans === undefined || ans === null || ans === '' || (Array.isArray(ans) && !ans.length) || (q.type === 'code' && !ans?.code?.trim());
  if (blank) return { marks: 0, max, status: 'blank', feedback: 'Not answered.' };
  switch (q.type) {
    case 'mcq': {
      const ok = Number(ans) === q.answer;
      return { marks: ok ? max : -neg * max, max, status: ok ? 'correct' : 'wrong', feedback: q.explain || '' };
    }
    case 'multi': {
      const a = [...ans].map(Number).sort().join(','), b = [...q.answer].sort().join(',');
      const ok = a === b;
      return { marks: ok ? max : -neg * max, max, status: ok ? 'correct' : 'wrong', feedback: q.explain || '' };
    }
    case 'short':
    case 'sql': {
      if (q.manual) return { marks: 0, max, status: 'pending', feedback: 'Awaiting instructor grading against the rubric.' };
      const ok = (q.accept || []).some((p) => new RegExp(p, 'i').test(norm(ans)));
      return ok ? { marks: max, max, status: 'correct', feedback: q.explain || '' } : { marks: 0, max, status: 'pending', feedback: 'Did not match an accepted pattern; sent to an instructor for manual review.' };
    }
    case 'code': {
      const r = ans.result || { passed: 0, total: 1 };
      const marks = Math.round((max * r.passed) / Math.max(1, r.total) * 100) / 100;
      return { marks, max, status: r.passed === r.total ? 'correct' : r.passed ? 'partial' : 'wrong', feedback: `${r.passed} of ${r.total} hidden tests passed.` };
    }
    default: return { marks: 0, max, status: 'pending', feedback: '' };
  }
}

/** Score a whole attempt, applying manual grades where present. Total never drops below zero. */
export function scoreAttempt(assessment, questions, attempt) {
  const per = attempt.questionIds.map((id) => {
    const q = questions.find((x) => x.id === id);
    const g = gradeQuestion(assessment, q, attempt.answers[id]);
    const m = attempt.manual?.[id];
    if (m && g.status === 'pending') return { id, ...g, marks: m.marks, status: m.marks >= g.max ? 'correct' : m.marks > 0 ? 'partial' : 'wrong', feedback: m.note || 'Graded by instructor.', gradedBy: m.by };
    return { id, ...g };
  });
  const max = per.reduce((a, x) => a + x.max, 0);
  const raw = per.reduce((a, x) => a + x.marks, 0);
  const score = Math.max(0, Math.round(raw * 100) / 100);
  const pending = per.filter((x) => x.status === 'pending').length;
  const pct = max ? Math.round((score / max) * 1000) / 10 : 0;
  return { per, score, max, pct, pending, passed: pending ? null : pct >= assessment.passPct };
}

export function attemptsFor(state, studentId, assessmentId) {
  return state.attempts.filter((a) => a.studentId === studentId && a.assessmentId === assessmentId).sort((a, b) => (a.startedAt < b.startedAt ? -1 : 1));
}
export function attemptStatus(state, studentId, assessment) {
  const list = attemptsFor(state, studentId, assessment.id);
  const open = list.find((a) => a.status === 'in_progress');
  const used = list.filter((a) => a.status !== 'in_progress').length;
  const best = list.filter((a) => a.status !== 'in_progress').reduce((b, a) => (a.pct > (b?.pct ?? -1) ? a : b), null);
  return { list, open, used, left: Math.max(0, assessment.attempts - used), best, passed: list.some((a) => a.passed) };
}

/** Time allowed in ms including accommodations (extra time %). */
export function timeAllowedMs(assessment, student) {
  const extra = student?.accommodation?.extraTimePct || 0;
  return Math.round(assessment.minutes * 60000 * (1 + extra / 100));
}

export function startAttempt(state, student, assessment, questions, now = new Date()) {
  const st = attemptStatus(state, student.id, assessment);
  if (st.open) return st.open;
  if (st.left <= 0) throw new Error('No attempts left for this assessment.');
  const seed = hash(`${student.id}:${assessment.id}:${st.used}`);
  const a = { id: `AT-${student.id}-${assessment.id}-${st.used + 1}`, studentId: student.id, assessmentId: assessment.id, startedAt: new Date(now).toISOString(), deadline: new Date(new Date(now).getTime() + timeAllowedMs(assessment, student)).toISOString(), submittedAt: null, questionIds: drawQuestions(assessment, questions, seed), answers: {}, flagged: [], status: 'in_progress', manual: {} };
  state.attempts.push(a);
  return a;
}

export function submitAttempt(state, attempt, assessment, questions, now = new Date(), { auto = false } = {}) {
  if (attempt.status !== 'in_progress') throw new Error('This attempt was already submitted.');
  const r = scoreAttempt(assessment, questions, attempt);
  Object.assign(attempt, { submittedAt: new Date(now).toISOString(), status: r.pending ? 'needs_grading' : 'graded', pct: r.pct, score: r.score, max: r.max, passed: r.passed, perQuestion: r.per.map((p) => ({ id: p.id, status: p.status, marks: p.marks, max: p.max })), autoSubmitted: auto });
  return r;
}

export function applyManualGrade(state, attempt, assessment, questions, qid, marks, note, by) {
  const q = questions.find((x) => x.id === qid);
  const max = marksFor(assessment, q);
  if (!(marks >= 0 && marks <= max)) throw new Error(`Marks must be between 0 and ${max}.`);
  attempt.manual = { ...(attempt.manual || {}), [qid]: { marks: Number(marks), note, by, at: new Date().toISOString() } };
  const r = scoreAttempt(assessment, questions, attempt);
  Object.assign(attempt, { status: r.pending ? 'needs_grading' : 'graded', pct: r.pct, score: r.score, max: r.max, passed: r.passed, perQuestion: r.per.map((p) => ({ id: p.id, status: p.status, marks: p.marks, max: p.max })) });
  return r;
}

/** Question-level analytics across submitted attempts that recorded per-question results. */
export function questionAnalytics(state, assessment) {
  const rows = new Map();
  state.attempts.filter((a) => a.assessmentId === assessment.id && a.perQuestion?.length).forEach((a) => a.perQuestion.forEach((p) => {
    const r = rows.get(p.id) || { id: p.id, n: 0, correct: 0, partial: 0, blank: 0, marks: 0, max: 0 };
    r.n++; if (p.status === 'correct') r.correct++; if (p.status === 'partial') r.partial++; if (p.status === 'blank') r.blank++;
    r.marks += Math.max(0, p.marks); r.max += p.max;
    rows.set(p.id, r);
  }));
  return [...rows.values()].map((r) => ({ ...r, facility: r.n ? Math.round((r.correct / r.n) * 100) : 0, avgPct: r.max ? Math.round((r.marks / r.max) * 100) : 0 }));
}
