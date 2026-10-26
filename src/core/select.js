// Memoised selectors over the store. Derived data is recomputed only when the store revision
// changes, so dashboards never recompute expensive aggregates on every interaction.
import { getIdentity } from './session.js';
import { getState, getRev } from './store.js';
import { buildActivityIndex } from '../domain/activity.js';
import { evaluateAll } from '../domain/risk.js';
import { buildIndex } from '../domain/search.js';
import { userById } from '../domain/scope.js';
import { can as canRaw } from './rbac.js';

const cache = new Map();
function memo(key, fn) {
  const rev = getRev();
  const hit = cache.get(key);
  if (hit && hit.rev === rev) return hit.v;
  const v = fn();
  cache.set(key, { rev, v });
  return v;
}

/** Demo clock: the seed day with the current time of day, so seeded dates stay coherent. */
export function now() {
  const s = getState();
  const d = new Date(`${s.meta.clock}T00:00:00`);
  const t = new Date();
  d.setHours(t.getHours(), t.getMinutes(), t.getSeconds(), 0);
  return d;
}

export const activityIndex = () => memo('idx', () => buildActivityIndex(getState()));
export const riskAll = () => memo('risk', () => evaluateAll(getState(), activityIndex(), now()));

export function actor() {
  const s = getState();
  const who = getIdentity();
  const role = who?.role || 'student';
  const id = who?.lmsRef;
  const u = userById(s, id);
  return { role, id, orgId: u?.orgId || null, name: u?.name || who?.name || 'Unknown', user: u, account: who };
}
export const can = (perm) => { const a = actor(); return canRaw(a.role, perm, getState().settings.permOverrides); };
export const flag = (name) => !!getState().settings.flags[name];
export const searchIndex = () => { const a = actor(); return memo(`search:${a.role}:${a.id}`, () => buildIndex(getState(), a)); };
