import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApi, ApiError } from '../../src/services/api.js';
import { toCSV, esc, deepEqual, highlight } from '../../src/core/util.js';

const res = (status, body, headers = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => body, headers: { get: (k) => headers[k] } });

test('api client retries retryable statuses, then succeeds', async () => {
  let n = 0;
  const api = createApi({ fetchImpl: async () => (++n < 3 ? res(503, {}, { 'Retry-After': '0' }) : res(200, { ok: true })), retries: 3 });
  assert.deepEqual(await api.get('/x'), { ok: true });
  assert.equal(n, 3);
});

test('api client surfaces typed errors and does not retry 4xx', async () => {
  let n = 0;
  const api = createApi({ fetchImpl: async () => { n++; return res(403, { code: 'forbidden', message: 'No access' }); } });
  await assert.rejects(api.post('/x', { a: 1 }), (e) => e instanceof ApiError && e.status === 403 && e.code === 'forbidden');
  assert.equal(n, 1);
});

test('api client sends CSRF and idempotency headers on writes', async () => {
  let seen;
  const api = createApi({ fetchImpl: async (u, o) => { seen = o.headers; return res(200, {}); }, getCsrf: () => 'tok' });
  await api.patch('/x', { a: 1 }, { idempotencyKey: 'k1' });
  assert.equal(seen['X-CSRF-Token'], 'tok');
  assert.equal(seen['Idempotency-Key'], 'k1');
});

test('api client honours cancellation', async () => {
  const ctl = new AbortController();
  ctl.abort();
  const api = createApi({ fetchImpl: async () => res(200, {}) });
  await assert.rejects(api.get('/x', { signal: ctl.signal }), (e) => e.code === 'cancelled');
});

test('output escaping and CSV quoting', () => {
  assert.equal(esc('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(esc(`"'&`), '&quot;&#39;&amp;');
  assert.equal(toCSV([{ a: 'x,"y"' }], [{ label: 'A', value: (r) => r.a }]), 'A\n"x,""y"""');
  assert.ok(highlight('<b>SQL</b> joins', 'sql').includes('<mark class="hl">SQL</mark>'));
  assert.ok(!highlight('<b>SQL</b>', 'sql').includes('<b>'));
  assert.ok(deepEqual([1, [2, { a: 3 }]], [1, [2, { a: 3 }]]));
  assert.ok(!deepEqual([1, 2], [2, 1]));
});
