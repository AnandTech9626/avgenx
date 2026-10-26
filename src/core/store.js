// Application store: one state tree, explicit commits, audit trail, persistence.
// Browser storage is a development convenience for the standalone demo. It is per-browser,
// unencrypted and not shared between users; production persistence belongs to the API layer.
import { generateSeed, SCHEMA_VERSION } from '../data/seed.js';
import { uid, debounce } from './util.js';

const KEY = 'avgenx-platform-state-v3';
const UI_KEY = 'avgenx-platform-ui-v1';

const storage = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch { /* storage unavailable */ } },
};

export const DEFAULT_ACTING = { superadmin: 'U-SA1', ceo: 'U-CEO', admin: 'U-ADM', director: 'U-DIR', pm: 'U-PM1', instructor: 'U-I03', mentor: 'U-M05', ta: 'U-TA1', placement: 'U-PLC', student: 'S1001', corporate: 'U-CC1' };

let state = null;
let ui = null;
let persistOk = true;
let rev = 0; // increments on every commit; derived-data caches key on it
export const getRev = () => rev;
const listeners = new Set();

function loadState() {
  const raw = storage.get(KEY);
  if (raw) {
    try {
      const s = JSON.parse(raw);
      if (s?.meta?.version === SCHEMA_VERSION) return s;
    } catch { /* corrupted: fall through to a fresh seed */ }
  }
  return generateSeed(new Date());
}
function loadUI() {
  // Only display preferences live here. Identity and role never come from browser storage
  // (see core/session.js); stale keys from older builds are dropped.
  const base = { theme: null, nav: {}, recent: [], dismissed: {} };
  try { const { role, acting, ...rest } = JSON.parse(storage.get(UI_KEY)) || {}; return { ...base, ...rest }; } catch { return base; }
}

export function init() {
  state = loadState();
  ui = loadUI();
  persistNow();
  return { state, ui };
}

const persistNow = () => { persistOk = storage.set(KEY, JSON.stringify(state)); };
const persist = debounce(persistNow, 350);
const persistUI = debounce(() => storage.set(UI_KEY, JSON.stringify(ui)), 150);
export const flush = () => { persist.cancel(); persistNow(); };
export const isPersistent = () => persistOk;

export const getState = () => state;
export const getUI = () => ui;
export const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = (detail) => listeners.forEach((fn) => { try { fn(detail); } catch (e) { console.error('[store listener]', e); } });

/**
 * Mutate state through a named commit. `fn` receives the draft (the live state) and may
 * return a value. Throwing inside fn aborts the commit and restores the previous snapshot,
 * which gives optimistic updates a clean rollback path.
 * @param {string} label
 * @param {(s: object) => any} fn
 * @param {{audit?: {actorId:string, action:string, entity:string, entityId?:string, detail?:string, kind?:string}, silent?: boolean}} [opts]
 */
export function commit(label, fn, opts = {}) {
  const snapshot = JSON.stringify(state);
  let result;
  try {
    result = fn(state);
    if (opts.audit) audit(opts.audit);
  } catch (err) {
    state = JSON.parse(snapshot);
    throw err;
  }
  rev++;
  persist();
  if (!opts.silent) emit({ label });
  return result;
}

export function audit({ actorId, action, entity, entityId = '', detail = '', kind = 'admin' }) {
  state.audit.unshift({ id: uid('AU'), at: new Date().toISOString(), actorId, action, entity, entityId, detail, kind });
  const keepDays = state.settings.retention.auditDays;
  const cutoff = Date.now() - keepDays * 864e5;
  if (state.audit.length > 1500) state.audit = state.audit.filter((a) => new Date(a.at).getTime() > cutoff).slice(0, 1500);
}

export function notify(userId, cat, title, body, link) {
  state.notifications.unshift({ id: uid('N'), userId, cat, title, body, link, at: new Date().toISOString(), read: false });
}

export function setUI(patch, { silent = false } = {}) {
  ui = { ...ui, ...patch };
  persistUI();
  if (!silent) emit({ label: 'ui' });
}

export function resetDemo() {
  storage.del(KEY);
  state = generateSeed(new Date());
  rev++;
  persistNow();
  emit({ label: 'reset' });
}

export function exportJSON() { return JSON.stringify(state, null, 2); }
