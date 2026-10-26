// Small, dependency-free helpers shared by every layer. Pure functions only.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
/** Escape any value for safe interpolation into HTML text or attribute values. */
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

/** Deterministic PRNG (mulberry32). Same seed, same sequence: the demo dataset is reproducible. */
export function rng(seed) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.int = (min, max) => Math.floor(next() * (max - min + 1)) + min;
  next.pick = (arr) => arr[Math.floor(next() * arr.length)];
  next.chance = (p) => next() < p;
  next.shuffle = (arr) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  };
  next.sample = (arr, n) => next.shuffle(arr).slice(0, n);
  return next;
}
/** Stable 32-bit string hash (FNV-1a). */
export function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

export const DAY = 864e5;
export const iso = (d) => new Date(d).toISOString().slice(0, 10);
export const addDays = (d, n) => new Date(new Date(d).getTime() + n * DAY);
export const daysBetween = (a, b) => Math.round((startOfDay(b) - startOfDay(a)) / DAY);
export const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); };
export function fmtDate(d, opts = { day: 'numeric', month: 'short', year: 'numeric' }) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-GB', opts);
}
export const fmtShort = (d) => fmtDate(d, { day: 'numeric', month: 'short' });
export const fmtTime = (d) => new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
export const fmtDateTime = (d) => `${fmtShort(d)}, ${fmtTime(d)}`;
export function relDays(d, now) {
  const n = daysBetween(now, d);
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}
export const fmtMins = (m) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${Math.round(m % 60)}m` : ''}` : `${Math.round(m)}m`);
export const inr = (n) => '₹' + Math.round(n).toLocaleString('en-IN');
export const inrL = (n) => (Math.abs(n) >= 1e5 ? `₹${(n / 1e5).toFixed(1)} L` : inr(n));
export const pct = (n, d = 1) => `${(Number.isFinite(n) ? n : 0).toFixed(d)}%`;
export const num = (n) => Math.round(n).toLocaleString('en-IN');

export const sum = (arr, f = (x) => x) => arr.reduce((a, x) => a + (Number(f(x)) || 0), 0);
export const avg = (arr, f = (x) => x) => (arr.length ? sum(arr, f) / arr.length : 0);
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const round = (v, d = 1) => Math.round(v * 10 ** d) / 10 ** d;
export function groupBy(arr, f) {
  const m = new Map();
  for (const x of arr) { const k = f(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); }
  return m;
}
export const uniq = (arr) => [...new Set(arr)];
export const byKey = (arr, k = 'id') => Object.fromEntries(arr.map((x) => [x[k], x]));
export function sortBy(arr, f, dir = 'asc') {
  const m = dir === 'desc' ? -1 : 1;
  return arr.slice().sort((a, b) => { const x = f(a), y = f(b); return x < y ? -m : x > y ? m : 0; });
}
export const initials = (name) => String(name).split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
export const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

let uidCounter = 0;
/** Collision-safe id for records created in the browser session. */
export const uid = (p = 'id') => `${p}_${Date.now().toString(36)}${(uidCounter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function debounce(fn, ms = 200) {
  let t;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.cancel = () => clearTimeout(t);
  return d;
}

/** Deep equality for plain JSON-like values (used by the code judge). */
export function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-6;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => deepEqual(a[k], b[k]));
}

/** Highlight query terms inside already-escaped text. */
export function highlight(text, q) {
  const safe = esc(text);
  const terms = String(q || '').trim().split(/\s+/).filter((t) => t.length > 1).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!terms.length) return safe;
  return safe.replace(new RegExp(`(${terms.map((t) => esc(t)).join('|')})`, 'gi'), '<mark class="hl">$1</mark>');
}

export const csvCell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export const toCSV = (rows, cols) => [cols.map((c) => csvCell(c.label)).join(','), ...rows.map((r) => cols.map((c) => csvCell(c.value(r))).join(','))].join('\n');
