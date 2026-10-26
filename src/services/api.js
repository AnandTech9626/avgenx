// Production API client (used when the platform runs against the backend described in
// docs/API.md). The standalone demo reads and writes the local store instead; this client is
// the integration seam and is covered by unit tests.
//
// Features: JSON in/out, CSRF header from a cookie, idempotency keys for writes, retries with
// exponential backoff + jitter on network errors and 429/502/503/504, request cancellation,
// per-request timeout, and typed errors the UI can branch on.

export class ApiError extends Error {
  constructor(status, code, message, details) { super(message); this.status = status; this.code = code; this.details = details; }
}

const RETRYABLE = new Set([429, 502, 503, 504]);
const sleep = (ms, signal) => new Promise((res, rej) => { const t = setTimeout(res, ms); signal?.addEventListener('abort', () => { clearTimeout(t); rej(new ApiError(0, 'cancelled', 'Request cancelled')); }); });

export function createApi({ baseUrl = '/api', fetchImpl = globalThis.fetch, retries = 3, timeoutMs = 15000, getCsrf = () => (typeof document !== 'undefined' ? document.cookie.match(/(?:^|; )csrf=([^;]+)/)?.[1] : '') } = {}) {
  async function request(method, path, { body, signal, idempotencyKey, query } = {}) {
    const url = `${baseUrl}${path}${query ? `?${new URLSearchParams(query)}` : ''}`;
    const write = method !== 'GET';
    const key = write ? idempotencyKey || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}` : undefined;
    let attempt = 0;
    for (;;) {
      const ctl = new AbortController();
      const onAbort = () => ctl.abort();
      signal?.addEventListener('abort', onAbort);
      const timer = setTimeout(() => ctl.abort(), timeoutMs);
      try {
        if (signal?.aborted) throw new ApiError(0, 'cancelled', 'Request cancelled');
        const res = await fetchImpl(url, { method, credentials: 'include', signal: ctl.signal, headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(write ? { 'X-CSRF-Token': getCsrf() || '', 'Idempotency-Key': key } : {}) }, body: body ? JSON.stringify(body) : undefined });
        if (res.ok) return res.status === 204 ? null : await res.json();
        let payload = {};
        try { payload = await res.json(); } catch { /* non-JSON error body */ }
        if (RETRYABLE.has(res.status) && attempt < retries) { attempt++; const ra = Number(res.headers?.get?.('Retry-After')); await sleep(ra ? ra * 1000 : backoff(attempt), signal); continue; }
        throw new ApiError(res.status, payload.code || httpCode(res.status), payload.message || `Request failed (${res.status})`, payload.details ?? payload.fields);
      } catch (err) {
        if (err instanceof ApiError) throw err;
        if (signal?.aborted) throw new ApiError(0, 'cancelled', 'Request cancelled');
        if (attempt < retries) { attempt++; await sleep(backoff(attempt), signal); continue; }
        throw new ApiError(0, ctl.signal.aborted ? 'timeout' : 'network', ctl.signal.aborted ? 'The server took too long to respond.' : 'Could not reach the server. Check your connection.');
      } finally { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); }
    }
  }
  return {
    get: (p, o) => request('GET', p, o),
    post: (p, body, o) => request('POST', p, { ...o, body }),
    patch: (p, body, o) => request('PATCH', p, { ...o, body }),
    del: (p, o) => request('DELETE', p, o),
  };
}
export const backoff = (n) => Math.min(8000, 300 * 2 ** (n - 1)) + Math.floor(Math.random() * 120);
const httpCode = (s) => ({ 400: 'invalid_request', 401: 'unauthenticated', 403: 'forbidden', 404: 'not_found', 409: 'conflict', 422: 'validation_failed', 429: 'rate_limited' }[s] || (s >= 500 ? 'server_error' : 'error'));
