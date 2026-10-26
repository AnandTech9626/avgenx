// Gamification and leaderboards. XP is DERIVED from verified learning facts (lessons, first
// accepted solutions, passed assessments, approved projects, attended classes, weekly goals),
// so repeating an action cannot inflate a score. Every entry carries the reason it was earned.
import { PROBLEMS } from '../data/problems.js';
import { iso, startOfDay, DAY, hash } from '../core/util.js';
import { lessonsOf } from './progress.js';

const PBY = Object.fromEntries(PROBLEMS.map((p) => [p.id, p]));

export function xpLedger(state, studentId, idx, now) {
  const x = state.settings.xp;
  const L = [];
  const lessonTitle = new Map();
  state.courses.forEach((c) => lessonsOf(c).forEach((l) => lessonTitle.set(l.id, `${c.id}: ${l.title}`)));
  state.enrollments.filter((e) => e.studentId === studentId).forEach((e) => Object.entries(e.done).forEach(([lid, at]) => L.push({ at, pts: x.lesson, kind: 'lesson', reason: `Completed lesson ${lessonTitle.get(lid) || lid}` })));
  const firstAccepted = new Map();
  state.submissions.filter((s) => s.studentId === studentId && s.status === 'Accepted').sort((a, b) => (a.at < b.at ? -1 : 1)).forEach((s) => { if (!firstAccepted.has(s.problemId)) firstAccepted.set(s.problemId, s); });
  for (const [pid, s] of firstAccepted) { const p = PBY[pid]; if (!p) continue; L.push({ at: s.at, pts: x[`solve${p.diff}`], kind: 'solve', reason: `First accepted solution: ${p.title} (${p.diff})` }); }
  const passed = new Map();
  state.attempts.filter((a) => a.studentId === studentId && a.passed).sort((a, b) => (a.submittedAt < b.submittedAt ? -1 : 1)).forEach((a) => { if (!passed.has(a.assessmentId)) passed.set(a.assessmentId, a); });
  for (const [aid, a] of passed) L.push({ at: a.submittedAt, pts: x.assessmentPass, kind: 'assessment', reason: `Passed ${aid} with ${a.pct}%` });
  state.projects.filter((p) => p.studentId === studentId && p.state === 'approved').forEach((p) => L.push({ at: p.approvedAt || p.history[p.history.length - 1]?.at, pts: x.projectApproved, kind: 'project', reason: `Project approved: ${p.assignmentId}` }));
  state.sessions.filter((s) => s.attendance?.[studentId]).forEach((s) => L.push({ at: s.start, pts: x.attendance, kind: 'attendance', reason: `Attended: ${s.title}` }));
  const goal = state.students.find((s) => s.id === studentId)?.weeklyGoalMins || 300;
  const m = idx.get(studentId) || new Map();
  const end = startOfDay(now);
  for (let w = 1; w <= 12; w++) {
    let mins = 0; const from = end - (w * 7) * DAY;
    for (let d = 0; d < 7; d++) mins += m.get(iso(from + d * DAY)) || 0;
    if (mins >= goal) L.push({ at: new Date(from + 6 * DAY).toISOString(), pts: x.weeklyGoal, kind: 'goal', reason: `Weekly goal met: ${mins} of ${goal} minutes (week of ${iso(from)})` });
  }
  L.sort((a, b) => (a.at < b.at ? 1 : -1));
  const total = L.reduce((a, e) => a + e.pts, 0);
  return { entries: L, total, level: Math.floor(Math.sqrt(total / 120)) + 1, nextAt: Math.pow(Math.floor(Math.sqrt(total / 120)) + 1, 2) * 120 };
}

export function badges(state, studentId, ledger, streakDays) {
  const solves = ledger.entries.filter((e) => e.kind === 'solve');
  const hard = solves.filter((e) => e.reason.includes('(Hard)')).length;
  const goals = ledger.entries.filter((e) => e.kind === 'goal').length;
  const st = state.students.find((s) => s.id === studentId);
  const courseDone = state.enrollments.filter((e) => e.studentId === studentId && e.status === 'completed').length;
  const capstone = state.projects.some((p) => p.studentId === studentId && p.state === 'approved' && p.assignmentId.startsWith('CAP-'));
  const helper = state.threads.some((t) => t.replies.some((r) => r.authorId === studentId && r.accepted));
  const B = (id, label, earned, how, progress) => ({ id, label, earned, how, progress });
  return [
    B('first-ac', 'First accepted', solves.length >= 1, 'Get any problem accepted in the Coding Lab or Practice Arena.', `${Math.min(1, solves.length)}/1`),
    B('ten', 'Ten solved', solves.length >= 10, 'First accepted solutions on 10 different problems.', `${Math.min(10, solves.length)}/10`),
    B('twentyfive', 'Twenty-five solved', solves.length >= 25, 'First accepted solutions on 25 different problems.', `${Math.min(25, solves.length)}/25`),
    B('hard', 'Hard hitter', hard >= 3, 'Solve 3 Hard problems.', `${Math.min(3, hard)}/3`),
    B('streak7', 'Seven-day streak', streakDays >= 7, 'Learn on 7 consecutive days.', `${Math.min(7, streakDays)}/7`),
    B('consistent', 'Consistency', goals >= 4, 'Meet your weekly minutes goal in 4 of the last 12 weeks.', `${Math.min(4, goals)}/4`),
    B('course', 'Course finisher', courseDone >= 1, 'Complete every lesson in a course.', `${Math.min(1, courseDone)}/1`),
    B('capstone', 'Capstone approved', capstone, 'Have a capstone project approved by a reviewer.', capstone ? '1/1' : '0/1'),
    B('portfolio', 'Portfolio live', !!st?.portfolio.public, 'Publish your portfolio for recruiters.', st?.portfolio.public ? '1/1' : '0/1'),
    B('helper', 'Helpful peer', helper, 'Have one of your discussion replies accepted as the answer.', helper ? '1/1' : '0/1'),
  ];
}

/**
 * Practice leaderboard with explainable scoring:
 * points = Σ first-accepted problems in window × difficulty points, + first-try bonus
 * (accepted with no earlier failed submission on that problem). Tie-break: earlier last solve.
 */
export function leaderboard(state, students, now, { days = state.settings.leaderboard.contestWindowDays, problemIds = null } = {}) {
  const cfg = state.settings.leaderboard;
  const from = days ? new Date(startOfDay(now) - (days - 1) * DAY).toISOString() : '0';
  const allowed = problemIds ? new Set(problemIds) : null;
  const ids = new Set(students.map((s) => s.id));
  const subs = state.submissions.filter((s) => ids.has(s.studentId) && s.at >= from && (!allowed || allowed.has(s.problemId))).sort((a, b) => (a.at < b.at ? -1 : 1));
  const rows = new Map();
  for (const s of subs) {
    const r = rows.get(s.studentId) || { studentId: s.studentId, pts: 0, solved: new Set(), failed: new Set(), easy: 0, medium: 0, hard: 0, firstTry: 0, last: null };
    if (s.status === 'Accepted' && !r.solved.has(s.problemId)) {
      const p = PBY[s.problemId]; if (!p) continue;
      const k = p.diff.toLowerCase();
      r.solved.add(s.problemId); r[k]++; r.pts += cfg[k]; r.last = s.at;
      if (!r.failed.has(s.problemId)) { r.firstTry++; r.pts += cfg.firstTryBonus; }
    } else if (s.status !== 'Accepted') r.failed.add(s.problemId);
    rows.set(s.studentId, r);
  }
  return [...rows.values()].filter((r) => r.solved.size).sort((a, b) => b.pts - a.pts || (a.last < b.last ? -1 : 1)).map((r, i) => ({ ...r, rank: i + 1, solvedCount: r.solved.size, explain: `${r.easy}×${cfg.easy} + ${r.medium}×${cfg.medium} + ${r.hard}×${cfg.hard} + ${r.firstTry}×${cfg.firstTryBonus} first-try bonus` }));
}

/** Weekly contest: four problems chosen deterministically from the ISO week; window Monday to Sunday. */
export function weeklyContest(now) {
  const d = new Date(startOfDay(now));
  const monday = new Date(d.getTime() - ((d.getDay() + 6) % 7) * DAY);
  const key = iso(monday);
  const h = hash(`contest:${key}`);
  const by = (diff) => PROBLEMS.filter((p) => p.diff === diff);
  const pick = (arr, k) => arr[(h + k * 13) % arr.length];
  const problems = [pick(by('Easy'), 1), pick(by('Medium'), 2), pick(by('Medium'), 5), pick(by('Hard'), 3)].filter((p, i, a) => a.indexOf(p) === i);
  return { id: `WK-${key}`, title: `Weekly contest · week of ${monday.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`, start: monday.toISOString(), end: new Date(monday.getTime() + 7 * DAY - 1).toISOString(), problems: problems.map((p) => p.id), minutes: 90 };
}
export function dailyChallenge(now) {
  const pool = PROBLEMS.filter((p) => p.diff !== 'Hard');
  return pool[hash(`daily:${iso(now)}`) % pool.length];
}
