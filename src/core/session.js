// Who is signed in. In the server build this comes only from GET /api/auth/me on each page load
// (the role is the one the server verified at sign-in); nothing in browser storage can change it.
// In the preview build it is the role picked on the preview screen, held for this tab only.
import { DEFAULT_ACTING } from './store.js';
import { authFetch, tabNote } from '../services/auth.js';

let identity = null; // { mode, role, lmsRef, userId, name, email, csrf, features }

export const PREVIEW = typeof __PREVIEW__ !== 'undefined' && __PREVIEW__;
export const getIdentity = () => identity;
export function setIdentity(v) { identity = Object.freeze({ ...v, lmsRef: v.lmsRef || DEFAULT_ACTING[v.role] }); }
export const csrfToken = () => identity?.csrf || '';

const PREVIEW_KEY = 'avgenx-preview-identity';
export function readPreview() {
  try { const v = JSON.parse(tabNote.get(PREVIEW_KEY)); return v && typeof v.role === 'string' ? v : null; } catch { return null; }
}
export const savePreview = (v) => tabNote.set(PREVIEW_KEY, JSON.stringify(v));
export const clearPreview = () => tabNote.del(PREVIEW_KEY);

/** Sign out: the server deletes the session; the preview simply forgets the choice. */
export async function signOut() {
  if (identity?.mode === 'server') {
    try { await authFetch('/api/auth/logout', {}, csrfToken()); } catch { /* the cookie is cleared server side when reachable */ }
    tabNote.set('avgenx-signed-out', '1');
    location.replace('/');
  } else { clearPreview(); location.reload(); }
}
