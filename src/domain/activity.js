// Learning activity derived from real events (lesson completions, code submissions,
// assessment attempts, attended classes). No separate "activity" numbers are stored,
// so dashboards cannot drift from the records they summarise.
import { iso, addDays, DAY, startOfDay } from '../core/util.js';
import { lessonsOf } from './progress.js';

/** Build studentId -> Map(dayISO -> minutes). */
export function buildActivityIndex(state) {
  const idx = new Map();
  const add = (sid, when, mins) => {
    if (!when) return;
    const d = iso(when);
    if (!idx.has(sid)) idx.set(sid, new Map());
    const m = idx.get(sid);
    m.set(d, (m.get(d) || 0) + mins);
  };
  const lessonMins = new Map();
  state.courses.forEach((c) => lessonsOf(c).forEach((l) => lessonMins.set(l.id, l.mins)));
  state.enrollments.forEach((e) => Object.entries(e.done).forEach(([lid, t]) => add(e.studentId, t, lessonMins.get(lid) || 15)));
  state.submissions.forEach((s) => s.status !== 'Solution viewed' && add(s.studentId, s.at, 12));
  state.attempts.forEach((a) => a.submittedAt && add(a.studentId, a.submittedAt, 20));
  state.sessions.forEach((s) => Object.entries(s.attendance || {}).forEach(([sid, ok]) => ok && add(sid, s.start, s.mins)));
  return idx;
}

export function dailySeries(idx, studentIds, days, now) {
  const end = startOfDay(now);
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = iso(end - i * DAY);
    let m = 0;
    for (const sid of studentIds) m += idx.get(sid)?.get(d) || 0;
    out.push({ date: d, mins: m });
  }
  return out;
}

export function weeklySeries(idx, studentIds, weeks, now) {
  const daily = dailySeries(idx, studentIds, weeks * 7, now);
  const out = [];
  for (let w = 0; w < weeks; w++) {
    const slice = daily.slice(w * 7, w * 7 + 7);
    out.push({ week: slice[0].date, mins: slice.reduce((a, x) => a + x.mins, 0) });
  }
  return out;
}

export function lastActive(idx, sid) {
  const m = idx.get(sid);
  if (!m || !m.size) return null;
  let best = null;
  for (const d of m.keys()) if (!best || d > best) best = d;
  return best;
}

/** Consecutive days with any activity, ending today or yesterday. */
export function streak(idx, sid, now) {
  const m = idx.get(sid);
  if (!m) return 0;
  let n = 0;
  let d = startOfDay(now);
  if (!m.get(iso(d))) d -= DAY; // today not started yet: count from yesterday
  while (m.get(iso(d))) { n++; d -= DAY; }
  return n;
}

export function minutesBetween(idx, sid, from, to) {
  const m = idx.get(sid);
  if (!m) return 0;
  let t = 0;
  for (const [d, v] of m) if (d >= iso(from) && d <= iso(to)) t += v;
  return t;
}

/** Weekly lessons completed (velocity) for the last n weeks, oldest first. */
export function velocity(state, sid, weeks, now) {
  const out = Array(weeks).fill(0);
  const end = startOfDay(now) + DAY;
  state.enrollments.filter((e) => e.studentId === sid).forEach((e) => Object.values(e.done).forEach((t) => {
    const ago = Math.floor((end - new Date(t).getTime()) / (7 * DAY));
    if (ago >= 0 && ago < weeks) out[weeks - 1 - ago]++;
  }));
  return out;
}
export const weekStart = (now) => { const d = new Date(startOfDay(now)); const dow = (d.getDay() + 6) % 7; return addDays(d, -dow); };
