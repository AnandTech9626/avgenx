// Load test: many people using the site at the same moment, each with their own account.
//   node scripts/load-test.mjs [users=100] [rounds=2]
// Starts the real server (its own process, throwaway database), then every simulated person at
// once: opens the sign-in page, signs in with their own ID and role, loads the app, checks the
// server says they are themselves, and keeps checking while other people sign in and out.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { openDb } from '../server/db.mjs';
import { hashPassword } from '../server/auth.mjs';

const USERS = Number(process.argv[2] || 100);
const ROUNDS = Number(process.argv[3] || 2);
const PASSWORD = 'Load-test-river-4821';
const ROLES = ['student', 'student', 'student', 'mentor', 'instructor', 'ta', 'placement', 'corporate'];

const dir = mkdtempSync(join(tmpdir(), 'avgenx-load-'));
const db = openDb(join(dir, 'load.db'));
const hash = await hashPassword(PASSWORD);
const people = [];
const now = new Date().toISOString();
for (let i = 1; i <= USERS; i++) {
  const role = ROLES[i % ROLES.length];
  const id = randomUUID(); const userId = `LOAD-${String(i).padStart(3, '0')}`;
  db.prepare('INSERT INTO accounts (id, user_id, email, name, password_hash, status, must_change_password, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)').run(id, userId, `load${i}@example.com`, `Load User ${i}`, hash, 'active', 0, now, now);
  db.prepare('INSERT INTO account_roles (account_id, role, granted_at) VALUES (?,?,?)').run(id, role, now);
  people.push({ userId, role });
}
db.close();

const port = await new Promise((r) => { const s = createServer().listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/index.mjs'], { env: { ...process.env, NODE_ENV: 'development', DB_PATH: join(dir, 'load.db'), PORT: String(port), OPEN_BROWSER: 'false', ACCOUNTS_XLSX: join(dir, 'none.xlsx') }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((res, rej) => { let out = ''; server.stdout.on('data', (d) => { out += d; if (out.includes('is running')) res(); }); server.once('exit', (c) => rej(new Error(`server exited ${c}`))); });
const B = `http://127.0.0.1:${port}`;

const times = {}; const problems = [];
const timed = async (step, fn) => { const t = performance.now(); try { return await fn(); } finally { (times[step] ||= []).push(performance.now() - t); } };

async function person(p, round) {
  const login = await timed('open sign-in page', () => fetch(`${B}/`, { headers: { 'accept-encoding': 'br, gzip' } }).then(async (r) => ({ html: await r.text(), enc: r.headers.get('content-encoding') })));
  if (!login.html.includes('<div id="app">')) problems.push(`${p.userId}: sign-in page missing`);
  const r = await timed('sign in', () => fetch(`${B}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ role: p.role, identifier: p.userId, password: PASSWORD }) }));
  if (r.status !== 200) { problems.push(`${p.userId}: sign-in returned ${r.status}`); return; }
  const cookie = r.headers.get('set-cookie').split(';')[0];
  const app = await timed('load the app', () => fetch(`${B}/`, { headers: { cookie, 'accept-encoding': 'br, gzip' } }).then(async (x) => ({ len: (await x.text()).length, enc: x.headers.get('content-encoding') })));
  if (app.len < 500000) problems.push(`${p.userId}: got the sign-in page instead of the app`);
  for (let i = 0; i < 3; i++) {
    const me = await timed('check identity', () => fetch(`${B}/api/auth/me`, { headers: { cookie } }).then((x) => x.json()));
    if (me.user?.userId !== p.userId || me.user?.role !== p.role) problems.push(`${p.userId}: server answered as ${me.user?.userId}/${me.user?.role}`);
  }
  // A third of the people sign out; everyone else must be unaffected.
  if ((Number(p.userId.slice(5)) + round) % 3 === 0) {
    const meCsrf = (await fetch(`${B}/api/auth/me`, { headers: { cookie } }).then((x) => x.json())).csrf;
    await timed('sign out', () => fetch(`${B}/api/auth/logout`, { method: 'POST', headers: { 'content-type': 'application/json', origin: B, cookie, 'x-csrf-token': meCsrf }, body: '{}' }));
    const after = await fetch(`${B}/api/auth/me`, { headers: { cookie } });
    if (after.status !== 401) problems.push(`${p.userId}: still signed in after signing out`);
  } else {
    await new Promise((res) => setTimeout(res, 50));
    const again = await fetch(`${B}/api/auth/me`, { headers: { cookie } }).then((x) => x.json());
    if (again.user?.userId !== p.userId) problems.push(`${p.userId}: lost their session while others signed out`);
  }
  return { loginEnc: login.enc, appEnc: app.enc };
}

const pct = (a, q) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
let enc;
const started = performance.now();
for (let round = 1; round <= ROUNDS; round++) {
  const t = performance.now();
  const res = await Promise.all(people.map((p) => person(p, round)));
  enc ||= res.find(Boolean);
  console.log(`Round ${round}: ${USERS} people at the same time, finished in ${((performance.now() - t) / 1000).toFixed(1)} s`);
}
console.log(`\nPages sent compressed: sign-in page ${enc?.loginEnc || 'no'}, app ${enc?.appEnc || 'no'}`);
console.log('Step                  p50 ms   p95 ms   max ms   requests');
for (const [step, a] of Object.entries(times)) console.log(`${step.padEnd(20)} ${pct(a, 0.5).toFixed(0).padStart(7)} ${pct(a, 0.95).toFixed(0).padStart(8)} ${Math.max(...a).toFixed(0).padStart(8)} ${String(a.length).padStart(10)}`);
console.log(`\nTotal ${((performance.now() - started) / 1000).toFixed(1)} s. Wrong-person answers, failed sign-ins or lost sessions: ${problems.length}`);
if (problems.length) console.log(problems.slice(0, 20).join('\n'));
server.kill('SIGTERM');
await new Promise((r) => server.once('exit', r));
rmSync(dir, { recursive: true, force: true });
process.exit(problems.length ? 1 : 0);
