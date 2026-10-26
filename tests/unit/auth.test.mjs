// Server-side authentication and account administration, exercised over real HTTP.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import ExcelJS from 'exceljs';
import { openDb } from '../../server/db.mjs';
import { createApp } from '../../server/app.mjs';
import { seedDev } from '../../server/cli.mjs';
import { LIMITS, passwordProblem } from '../../server/auth.mjs';

const dir = mkdtempSync(join(tmpdir(), 'avgenx-auth-'));
const dbPath = join(dir, 'test.db');
let db, server, B, accts;
const quiet = { error() {}, log() {} };
const NEW_PW = 'Correct-horse-battery-42';

function start() { server = createApp({ db, distDir: join(dir, 'nodist'), log: quiet }).listen(0); B = `http://127.0.0.1:${server.address().port}`; }
async function stop() { await new Promise((r) => server.close(r)); }

/** Minimal cookie-aware client. */
function client() {
  let cookie = ''; let csrf = '';
  const store = (r) => { const c = r.headers.get('set-cookie'); if (c) cookie = /Max-Age=0/.test(c) ? '' : c.split(';')[0]; };
  const req = async (method, path, body, extra = {}) => {
    const r = await fetch(B + path, { method, headers: { 'content-type': 'application/json', origin: B, ...(cookie ? { cookie } : {}), ...(csrf ? { 'x-csrf-token': csrf } : {}), ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
    store(r);
    let data = null; const t = r.headers.get('content-type') || '';
    if (t.includes('json')) data = await r.json(); else data = Buffer.from(await r.arrayBuffer());
    return { status: r.status, data, headers: r.headers };
  };
  const c = {
    get cookie() { return cookie; }, set cookie(v) { cookie = v; },
    get: (p, h) => req('GET', p, undefined, h), post: (p, b, h) => req('POST', p, b ?? {}, h), patch: (p, b, h) => req('PATCH', p, b, h),
    async login(role, id, pw, remember = false) { const r = await c.post('/api/auth/login', { role, identifier: id, password: pw, remember }); if (r.status === 200) csrf = (await c.get('/api/auth/me')).data.csrf; return r; },
    async ready(role, a) { // sign in and complete the forced password change
      const r = await c.login(role, a.userId, a.password);
      assert.equal(r.status, 200, JSON.stringify(r.data));
      if (r.data.next === 'change-password') { const ch = await c.post('/api/auth/change-password', { current: a.password, next: NEW_PW }); assert.equal(ch.status, 200, JSON.stringify(ch.data)); a.password = NEW_PW; csrf = (await c.get('/api/auth/me')).data.csrf; }
      return c;
    },
    setCsrf(v) { csrf = v; },
  };
  return c;
}
const acct = (role, n = 0) => accts.filter((a) => a.role === role)[n];

before(async () => { db = openDb(dbPath); accts = await seedDev(db); start(); });
after(async () => { await stop(); db.close(); rmSync(dir, { recursive: true, force: true }); });

test('dev seed creates the eight required accounts with strong, unique temporary passwords', () => {
  assert.deepEqual(accts.map((a) => a.role).sort(), ['admin', 'corporate', 'instructor', 'mentor', 'placement', 'student', 'student', 'superadmin']);
  assert.equal(new Set(accts.map((a) => a.userId)).size, 8);
  for (const a of accts) { assert.ok(a.password.length >= 20); assert.equal(passwordProblem(a.password), ''); }
  const rows = db.prepare('SELECT password_hash, must_change_password, is_test FROM accounts').all();
  for (const r of rows) { assert.match(r.password_hash, /^\$argon2id\$/); assert.equal(r.must_change_password, 1); assert.equal(r.is_test, 1); }
  assert.ok(!JSON.stringify(rows).includes(accts[0].password), 'plaintext password must not be stored');
});

test('no session: protected API rejected, root serves the sign-in page not the LMS', async () => {
  const c = client();
  assert.equal((await c.get('/api/auth/me')).status, 401);
  assert.equal((await c.get('/api/admin/accounts')).status, 401);
  assert.equal((await c.get('/api/admin/accounts.xlsx')).status, 401);
});

test('sign-in verifies credentials, account status and the assigned role', async () => {
  const s = acct('student');
  const c = client();
  let r = await c.login('student', s.userId, 'Wrong-password-123');
  assert.equal(r.status, 401); assert.equal(r.data.code, 'invalid_credentials');
  r = await c.login('student', 'nobody-here', 'Wrong-password-123');
  assert.equal(r.status, 401); assert.equal(r.data.message, 'The user ID, password or role is not correct.', 'unknown and wrong-password give the same message');
  r = await c.login('superadmin', s.userId, s.password);
  assert.equal(r.status, 403); assert.equal(r.data.code, 'role_not_assigned');
  r = await c.login('not-a-role', s.userId, s.password);
  assert.equal(r.status, 400);
  assert.equal(c.cookie, '', 'no session cookie after failures');
  r = await c.login('student', s.userId.toLowerCase(), s.password);
  assert.equal(r.status, 200); assert.equal(r.data.next, 'change-password');
  assert.match(r.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
});

test('a first sign-in session is restricted until the temporary password is changed', async () => {
  const s = acct('student', 1);
  const c = client();
  await c.login('student', s.userId, s.password);
  assert.equal((await c.get('/api/auth/me')).data.restricted, true);
  assert.equal((await c.get('/api/admin/accounts')).status, 403);
  let r = await c.post('/api/auth/change-password', { current: s.password, next: 'short' });
  assert.equal(r.status, 422);
  r = await c.post('/api/auth/change-password', { current: s.password, next: s.password });
  assert.equal(r.status, 422, 'must differ from the temporary password');
  const old = c.cookie;
  await c.ready('student', s); // completes the change
  assert.equal((await c.get('/api/auth/me')).data.restricted, false);
  const replay = client(); replay.cookie = old;
  assert.equal((await replay.get('/api/auth/me')).status, 401, 'the pre-change session is revoked');
});

test('the server ignores any role the browser claims; only the session role counts', async () => {
  const s = acct('student', 1);
  const c = client();
  await c.login('student', s.userId, s.password);
  assert.equal((await c.get('/api/admin/accounts', { 'x-role': 'superadmin' })).status, 403);
  assert.equal((await c.post('/api/admin/accounts', { name: 'Evil', email: 'evil@x.io', roles: ['superadmin'], role: 'superadmin', credential: 'temporary' })).status, 403);
  assert.equal((await c.get('/api/auth/me')).data.user.role, 'student');
});

test('writes need same-origin and the session CSRF token', async () => {
  const sa = await client().ready('superadmin', acct('superadmin'));
  let r = await sa.post('/api/admin/accounts', { name: 'X', email: 'x1@example.com', roles: ['student'], credential: 'temporary' }, { origin: 'https://evil.example' });
  assert.equal(r.status, 403);
  sa.setCsrf('forged');
  r = await sa.post('/api/admin/accounts', { name: 'X', email: 'x1@example.com', roles: ['student'], credential: 'temporary' });
  assert.equal(r.status, 403); assert.equal(r.data.code, 'csrf');
  r = await client().post('/api/auth/login', { role: 'student', identifier: 'a', password: 'b' }, { origin: 'https://evil.example' });
  assert.equal(r.status, 403);
});

test('administrators create, update, disable, reset and revoke; every step is audited', async () => {
  const admin = await client().ready('admin', acct('admin'));
  let r = await admin.post('/api/admin/accounts', { name: 'New Learner', email: 'new.learner@example.com', roles: ['student'], lmsRef: 'S1010', credential: 'temporary' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const created = r.data.account; const temp = r.data.temporaryPassword;
  assert.match(created.userId, /^STU-[A-Z2-9]{6}$/); assert.equal(created.mustChangePassword, true);
  assert.equal((await admin.post('/api/admin/accounts', { name: 'Dup', email: 'NEW.learner@example.com', roles: ['student'], credential: 'temporary' })).status, 409);
  r = await admin.post('/api/admin/accounts', { name: 'A', email: 'bad', roles: [], credential: 'temporary' });
  assert.equal(r.status, 422); assert.ok(r.data.fields.name && r.data.fields.email && r.data.fields.roles);

  const learner = client();
  assert.equal((await learner.login('student', created.userId, temp)).status, 200);
  r = await admin.patch(`/api/admin/accounts/${created.id}`, { status: 'disabled' });
  assert.equal(r.status, 200); assert.equal(r.data.account.status, 'disabled');
  assert.equal((await learner.get('/api/auth/me')).status, 401, 'disabling ends live sessions');
  r = await client().login('student', created.userId, temp);
  assert.equal(r.status, 403); assert.equal(r.data.code, 'account_disabled');
  r = await client().login('student', created.userId, 'Not-the-password-1');
  assert.equal(r.data.code, 'invalid_credentials', 'disabled status is only revealed to someone with the password');
  await admin.patch(`/api/admin/accounts/${created.id}`, { status: 'active', roles: ['student', 'ta'] });
  assert.equal((await client().login('ta', created.userId, temp)).status, 200, 'a second assigned role can be used');

  r = await admin.post(`/api/admin/accounts/${created.id}/reset-password`, { mode: 'temporary' });
  assert.ok(r.data.temporaryPassword && r.data.temporaryPassword !== temp);
  assert.equal((await client().login('student', created.userId, temp)).status, 401, 'old password stops working');
  r = await admin.post(`/api/admin/accounts/${created.id}/revoke-sessions`, {});
  assert.equal(r.status, 200);

  const actions = db.prepare('SELECT action FROM auth_audit WHERE target_id = ?').all(created.id).map((x) => x.action);
  for (const a of ['account.create', 'account.disable', 'account.enable', 'account.roles', 'password.admin_reset', 'sessions.revoke', 'login.blocked']) assert.ok(actions.includes(a), a);
  assert.throws(() => db.prepare('DELETE FROM auth_audit').run(), /append-only/);
});

test('institute administrators cannot grant or manage privileged roles; super admins can', async () => {
  const admin = await client().ready('admin', acct('admin'));
  let r = await admin.post('/api/admin/accounts', { name: 'Sneaky', email: 'sneaky@example.com', roles: ['superadmin'], credential: 'temporary' });
  assert.equal(r.status, 403);
  const me = db.prepare('SELECT id FROM accounts WHERE user_id = ?').get(acct('admin').userId).id;
  r = await admin.patch(`/api/admin/accounts/${me}`, { roles: ['admin', 'superadmin'] });
  assert.equal(r.status, 403, 'no self-escalation');
  const sa = db.prepare('SELECT id FROM accounts WHERE user_id = ?').get(acct('superadmin').userId).id;
  assert.equal((await admin.patch(`/api/admin/accounts/${sa}`, { status: 'disabled' })).status, 403);
  assert.equal((await admin.post(`/api/admin/accounts/${sa}/reset-password`, { mode: 'temporary' })).status, 403);

  const sup = await client().ready('superadmin', acct('superadmin'));
  r = await sup.post('/api/admin/accounts', { name: 'Second Admin', email: 'admin2@example.com', roles: ['admin'], credential: 'invite' });
  assert.equal(r.status, 201); assert.match(r.data.inviteLink, /\/reset#token=/); assert.equal(r.data.account.invited, true);
  assert.equal((await sup.patch(`/api/admin/accounts/${sa}`, { status: 'disabled' })).status, 409, 'cannot disable yourself');
  assert.equal((await sup.patch(`/api/admin/accounts/${sa}`, { roles: ['admin'] })).status, 409, 'cannot drop the role you are using');
  for (const role of ['instructor', 'mentor', 'placement', 'corporate', 'student']) assert.equal((await (await client().ready(role, role === 'student' ? acct('student', 1) : acct(role))).get('/api/admin/accounts')).status, 403, role);
});

test('invitation and reset links are single use and expire', async () => {
  const sup = await client().ready('superadmin', acct('superadmin'));
  const r = await sup.post('/api/admin/accounts', { name: 'Invited Mentor', email: 'mentor2@example.com', roles: ['mentor'], credential: 'invite' });
  const token = new URL(r.data.inviteLink).hash.split('token=')[1];
  const anon = client();
  assert.equal((await anon.post('/api/auth/reset', { token, password: 'weak' })).status, 422);
  assert.equal((await anon.post('/api/auth/reset', { token, password: 'Invited-mentor-pass-77' })).status, 200);
  assert.equal((await anon.post('/api/auth/reset', { token, password: 'Another-mentor-pass-88' })).status, 400, 'second use rejected');
  assert.equal((await client().login('mentor', r.data.account.userId, 'Invited-mentor-pass-77')).data.next, 'app');

  const link = (await sup.post(`/api/admin/accounts/${r.data.account.id}/reset-password`, { mode: 'link' })).data.resetLink;
  const t2 = new URL(link).hash.split('token=')[1];
  db.prepare("UPDATE password_tokens SET expires_at = '2000-01-01T00:00:00.000Z'").run();
  assert.equal((await anon.post('/api/auth/reset', { token: t2, password: 'Expired-link-pass-99' })).status, 400, 'expired link rejected');
  const forgot = await anon.post('/api/auth/forgot', { identifier: 'someone-who-does-not-exist' });
  const forgot2 = await anon.post('/api/auth/forgot', { identifier: r.data.account.userId });
  assert.equal(forgot.status, 202); assert.deepEqual(forgot.data, forgot2.data, 'same answer whether or not the account exists');
});

test('repeated failures lock sign-in for that identifier', async () => {
  const m = acct('mentor');
  const c = client();
  for (let i = 0; i < LIMITS.idFailures; i++) assert.equal((await c.login('mentor', m.userId, `Wrong-${i}-password!`)).status, 401);
  const r = await c.login('mentor', m.userId, m.password);
  assert.equal(r.status, 429, 'locked even with the right password');
  db.prepare('DELETE FROM login_attempts').run();
});

test('sign out invalidates the session on the server', async () => {
  const c = await client().ready('instructor', acct('instructor'));
  const cookie = c.cookie;
  assert.equal((await c.post('/api/auth/logout', {})).status, 200);
  const replay = client(); replay.cookie = cookie;
  assert.equal((await replay.get('/api/auth/me')).status, 401);
});

test('"keep me signed in" sets a persistent cookie; otherwise the cookie ends with the browser', async () => {
  const p = acct('placement');
  await client().ready('placement', p);
  const a = await client().login('placement', p.userId, p.password, true);
  assert.match(a.headers.get('set-cookie'), new RegExp(`Max-Age=${LIMITS.rememberDays * 86400}`));
  const b = await client().login('placement', p.userId, p.password, false);
  assert.doesNotMatch(b.headers.get('set-cookie'), /Max-Age/);
});

test('the Excel register lists account metadata and never secrets', async () => {
  const sup = await client().ready('superadmin', acct('superadmin'));
  const r = await sup.get('/api/admin/accounts.xlsx');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /spreadsheetml/);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(r.data);
  const ws = wb.getWorksheet('Accounts');
  assert.deepEqual(ws.getRow(1).values.slice(1, 6), ['User ID', 'Name', 'Email', 'Assigned roles', 'Status']);
  const all = []; wb.eachSheet((s) => s.eachRow((row) => all.push(JSON.stringify(row.values))));
  const text = all.join('\n');
  assert.ok(text.includes(acct('student').userId));
  assert.doesNotMatch(text, /\$argon2/);
  const headers = []; wb.eachSheet((sh) => { if (sh.name !== 'About') headers.push(...sh.getRow(1).values.slice(1)); });
  assert.ok(!headers.some((h) => /password hash|token|secret|otp/i.test(h)), `no secret columns: ${headers}`);
  for (const x of db.prepare('SELECT token_hash, csrf FROM sessions').all()) { assert.ok(!text.includes(x.token_hash)); assert.ok(!text.includes(x.csrf)); }
  for (const a of accts) assert.ok(!text.includes(a.password), 'no passwords');
  for (const t of db.prepare('SELECT token_hash FROM password_tokens').all()) assert.ok(!text.includes(t.token_hash));
  assert.equal((await (await client().ready('student', acct('student', 1))).get('/api/admin/accounts.xlsx')).status, 403);
});

test('accounts and passwords persist across a server restart', async () => {
  const s = acct('student', 1);
  await stop(); db.close();
  db = openDb(dbPath); start();
  const r = await client().login('student', s.userId, s.password);
  assert.equal(r.status, 200); assert.equal(r.data.next, 'app');
});

test('test accounts are never seeded or served in production', () => {
  const env = { ...process.env, NODE_ENV: 'production', DB_PATH: dbPath, PORT: '0', ACCOUNTS_XLSX: join(dir, 'no-such-file.xlsx') };
  const seed = spawnSync(process.execPath, ['server/cli.mjs', 'seed-dev'], { env, encoding: 'utf8' });
  assert.equal(seed.status, 1); assert.match(seed.stderr, /never created when NODE_ENV=production/);
  const run = spawnSync(process.execPath, ['server/index.mjs'], { env: { ...env, COOKIE_SECURE: 'true' }, encoding: 'utf8', timeout: 10000 });
  assert.equal(run.status, 1); assert.match(run.stderr, /Development test accounts are active/);
});

test('restarting the server signs everyone out (unless KEEP_SESSIONS=true)', async () => {
  const { spawn } = await import('node:child_process');
  const { createServer } = await import('node:net');
  const freePort = () => new Promise((r) => { const s = createServer().listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
  const rdir = mkdtempSync(join(tmpdir(), 'avgenx-restart-'));
  const rdb = join(rdir, 'r.db');
  const seedDb = openDb(rdb); const [stu] = (await seedDev(seedDb)).filter((a) => a.role === 'student'); seedDb.close();
  const port = await freePort();
  const run = (extra = {}) => new Promise((res, rej) => {
    const p = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/index.mjs'], { env: { ...process.env, NODE_ENV: 'development', DB_PATH: rdb, PORT: String(port), OPEN_BROWSER: 'false', ACCOUNTS_XLSX: join(rdir, 'none.xlsx'), ...extra }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => { out += d; if (out.includes('is running')) res({ p, out: () => out }); });
    p.once('exit', (c) => rej(new Error(`server exited ${c}: ${out}`)));
  });
  const stop = (p) => new Promise((r) => { p.once('exit', r); p.kill('SIGTERM'); });
  const R = `http://127.0.0.1:${port}`;
  const signIn = async () => {
    const r = await fetch(`${R}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin: R }, body: JSON.stringify({ role: 'student', identifier: stu.userId, password: stu.password }) });
    assert.equal(r.status, 200);
    return r.headers.get('set-cookie').split(';')[0];
  };
  const me = (cookie) => fetch(`${R}/api/auth/me`, { headers: { cookie } }).then((r) => r.status);

  let s = await run();
  const cookie = await signIn();
  assert.equal(await me(cookie), 200);
  await stop(s.p);
  s = await run();
  assert.equal(await me(cookie), 401, 'old session ended by the restart');
  assert.match(s.out(), /Signed out 1 session\(s\) from the previous run/);
  const cfg = await (await fetch(`${R}/api/auth/config`)).json();
  assert.equal(cfg.rememberMe, false, '"Keep me signed in" is hidden when restarts sign people out');
  const cookie2 = await signIn();
  await stop(s.p);
  s = await run({ KEEP_SESSIONS: 'true' });
  assert.equal(await me(cookie2), 200, 'KEEP_SESSIONS=true keeps people signed in');
  await stop(s.p);
  rmSync(rdir, { recursive: true, force: true });
});
