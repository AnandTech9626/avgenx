// Calls to the AVGENX server's authentication API, plus a per-tab note store for harmless UI
// hints (last role picked, "you signed out", the preview's chosen role). Nothing here stores
// passwords, tokens or anything used for authorisation: the session lives in an HttpOnly cookie.

/** JSON request to the auth API. Resolves { ok, status, data }; rejects only on network failure. */
export async function authFetch(path, body, csrf) {
  const r = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin',
    headers: { Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(csrf ? { 'X-CSRF-Token': csrf } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = {};
  try { data = await r.json(); } catch { /* empty body */ }
  return { ok: r.ok, status: r.status, data };
}

export const fetchMe = () => authFetch('/api/auth/me');

export const tabNote = {
  get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { sessionStorage.setItem(k, v); } catch { /* storage unavailable */ } },
  del(k) { try { sessionStorage.removeItem(k); } catch { /* storage unavailable */ } },
};
