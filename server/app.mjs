// HTTP server: serves the login page or the LMS depending on the session, and the auth and
// account-administration API. Built on node:http to keep the deployment to one small process.
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync, brotliCompressSync } from 'node:zlib';
import { can } from '../src/core/rbac.js';
import * as A from './auth.mjs';
import { buildRegister } from './register.mjs';
import aiHandler from './ai-proxy.mjs';

const MAX_BODY = 16 * 1024;

export function createApp({ db, excel = null, rememberMe = true, distDir = 'dist', env = process.env.NODE_ENV || 'development', secureCookies = env === 'production', trustProxy = false, mailer = null, log = console }) {
  const production = env === 'production';
  const cookieName = secureCookies ? '__Host-avgenx_sid' : 'avgenx_sid';
  const pages = loadPages(distDir);

  // ---------------------------------------------------------------- helpers
  const ipOf = (req) => (trustProxy && req.headers['x-forwarded-for'] ? String(req.headers['x-forwarded-for']).split(',')[0].trim() : req.socket.remoteAddress) || 'unknown';
  const originOf = (req) => `${trustProxy && req.headers['x-forwarded-proto'] ? req.headers['x-forwarded-proto'] : secureCookies ? 'https' : 'http'}://${req.headers.host}`;
  const cookies = (req) => Object.fromEntries(String(req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((p) => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
  const sessionCookie = (token, maxAge) => `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict${secureCookies ? '; Secure' : ''}${maxAge ? `; Max-Age=${Math.floor(maxAge)}` : ''}`;
  const clearCookie = () => `${cookieName}=; Path=/; HttpOnly; SameSite=Strict${secureCookies ? '; Secure' : ''}; Max-Age=0`;
  const base = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', 'Cross-Origin-Opener-Policy': 'same-origin', ...(secureCookies ? { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' } : {}) };
  const json = (res, status, body, extra = {}) => { res.writeHead(status, { ...base, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra }); res.end(JSON.stringify(body)); };
  const fail = (res, e) => {
    if (e instanceof A.AuthError) return json(res, e.status, { code: e.code, message: e.message, ...(e.fields ? { fields: e.fields } : {}) });
    log.error('[server]', e);
    return json(res, 500, { code: 'server_error', message: 'Something went wrong on the server.' });
  };
  async function body(req) {
    if (!/^application\/json\b/.test(req.headers['content-type'] || '')) throw new A.AuthError(415, 'invalid_request', 'Send JSON.');
    let size = 0; const chunks = [];
    for await (const c of req) { size += c.length; if (size > MAX_BODY) throw new A.AuthError(413, 'invalid_request', 'Request too large.'); chunks.push(c); }
    try { const v = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); if (!v || typeof v !== 'object' || Array.isArray(v)) throw 0; return v; } catch { throw new A.AuthError(400, 'invalid_request', 'Body must be a JSON object.'); }
  }
  const sessionOf = (req) => A.resolveSession(db, cookies(req)[cookieName]);
  /** Cross-site request forgery: same-origin check for every write, plus the session's token. */
  function assertSameOrigin(req) {
    const o = req.headers.origin;
    if (o ? o !== originOf(req) : req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site'])) throw new A.AuthError(403, 'forbidden', 'Cross-site request blocked.');
  }
  function requireSession(req, { allowRestricted = false, write = false } = {}) {
    const s = sessionOf(req);
    if (!s) throw new A.AuthError(401, 'unauthenticated', 'Sign in to continue.');
    if (s.restricted && !allowRestricted) throw new A.AuthError(403, 'password_change_required', 'Change your password to continue.');
    if (write) { assertSameOrigin(req); if (!A.safeEqual(req.headers['x-csrf-token'] || '', s.csrf)) throw new A.AuthError(403, 'csrf', 'Your session token is missing or out of date. Reload the page.'); }
    return s;
  }
  function requirePerm(req, perm, opts) {
    const s = requireSession(req, opts);
    if (!can(s.role, perm)) throw new A.AuthError(403, 'forbidden', 'Your role does not allow this.');
    return s;
  }
  const actorOf = (s) => s.account;
  const excelInfo = () => (excel ? { kind: 'excel', file: excel.path.split(/[\\/]/).pop(), ...excel.status(), path: undefined } : { kind: 'database' });
  /** While accounts.xlsx is in charge, who exists and with which roles is edited in the file. */
  const excelManaged = () => { if (excel) throw new A.AuthError(409, 'managed_by_excel', `Accounts are managed in ${excel.path.split(/[\\/]/).pop()} on the server. Add, edit or disable people there and save the file.`); };
  const linkFor = (req, token) => `${originOf(req)}/reset#token=${token}`;
  function page(res, name, req) {
    const p = pages[name];
    if (!p) { res.writeHead(503, { ...base, 'Content-Type': 'text/plain' }); res.end('The app has not been built. Run npm run build.'); return; }
    // Pages are compressed once at start-up (about 900 KB becomes about 200 KB), so many people
    // loading the app at the same time cost little bandwidth and no CPU per request.
    const accept = String(req?.headers['accept-encoding'] || '');
    const [enc, body] = /\bbr\b/.test(accept) ? ['br', p.br] : /\bgzip\b/.test(accept) ? ['gzip', p.gz] : [null, p.html];
    res.writeHead(200, { ...base, 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': p.csp, Vary: 'Accept-Encoding, Cookie', ...(enc ? { 'Content-Encoding': enc } : {}), 'Content-Length': body.length });
    res.end(req?.method === 'HEAD' ? undefined : body);
  }

  // ---------------------------------------------------------------- routes
  const routes = [
    ['GET', /^\/(index\.html)?$/, (req, res) => { const s = sessionOf(req); page(res, s && !s.restricted ? 'app' : 'login', req); }],
    ['GET', /^\/reset$/, (req, res) => page(res, 'login', req)],
    ['GET', /^\/healthz$/, (req, res) => json(res, 200, { ok: true })],

    ['GET', /^\/api\/auth\/config$/, (req, res) => json(res, 200, { resetByEmail: !!mailer, devOutbox: !mailer && !production, passwordsInFile: !!excel, rememberMe })],

    ['POST', /^\/api\/auth\/login$/, async (req, res) => {
      assertSameOrigin(req);
      const b = await body(req);
      if (excel) await excel.maybeSync('sign-in'); // the file decides who may sign in
      const r = await A.login(db, { role: b.role, identifier: b.identifier, password: b.password, remember: rememberMe && b.remember === true, ip: ipOf(req), userAgent: req.headers['user-agent'] });
      json(res, 200, { next: r.mustChangePassword ? 'change-password' : 'app' }, { 'Set-Cookie': sessionCookie(r.token, r.maxAge) });
    }],
    ['GET', /^\/api\/auth\/me$/, (req, res) => {
      const s = sessionOf(req);
      if (!s) return json(res, 401, { code: 'unauthenticated', message: 'Sign in to continue.' });
      const a = s.account;
      json(res, 200, { user: { userId: a.user_id, name: a.name, email: a.email, role: s.role, roles: A.rolesOf(db, a.id), lmsRef: a.lms_ref }, restricted: !!s.restricted, csrf: s.csrf, features: { passwordsInFile: !!excel, ai: !!process.env.ANTHROPIC_API_KEY } });
    }],
    ['POST', /^\/api\/auth\/logout$/, async (req, res) => {
      assertSameOrigin(req);
      const s = sessionOf(req);
      if (s) { if (!A.safeEqual(req.headers['x-csrf-token'] || '', s.csrf)) throw new A.AuthError(403, 'csrf', 'Reload the page and try again.'); A.logout(db, s, ipOf(req)); }
      json(res, 200, { ok: true }, { 'Set-Cookie': clearCookie() });
    }],
    ['POST', /^\/api\/auth\/change-password$/, async (req, res) => {
      const s = requireSession(req, { allowRestricted: true, write: true });
      const b = await body(req);
      const r = await A.changePassword(db, { session: s, current: b.current, next: b.next, ip: ipOf(req), userAgent: req.headers['user-agent'] });
      const file = excel ? await excel.recordPassword(s.account.user_id, b.next) : null;
      json(res, 200, { ok: true, file }, { 'Set-Cookie': sessionCookie(r.token) });
    }],
    ['POST', /^\/api\/auth\/forgot$/, async (req, res) => {
      assertSameOrigin(req);
      const b = await body(req);
      const r = A.requestReset(db, { identifier: b.identifier, ip: ipOf(req) });
      if (r && mailer) await mailer.send({ to: r.account.email, subject: 'Reset your AVGENX Academy password', text: `Use this link within 30 minutes to set a new password:\n${linkFor(req, r.token)}\n\nIf you did not ask for this, ignore this email.` });
      else if (r && !production) log.log(`\n[dev outbox] Password reset link for ${r.account.user_id} (valid 30 minutes):\n  ${linkFor(req, r.token)}\n`);
      json(res, 202, { message: mailer ? 'If an active account matches, a reset link is on its way to the registered email.' : production ? 'Password reset by email is not set up yet. Contact your institute administrator to reset your password.' : 'Development mode: if an active account matches, the reset link was written to the server console.' });
    }],
    ['POST', /^\/api\/auth\/reset$/, async (req, res) => {
      assertSameOrigin(req);
      const b = await body(req);
      const r = await A.completeReset(db, { token: b.token, password: b.password, ip: ipOf(req) });
      if (excel) await excel.recordPassword(r.userId, b.password);
      json(res, 200, { ok: true, userId: r.userId }, { 'Set-Cookie': clearCookie() });
    }],

    ['GET', /^\/api\/admin\/accounts$/, (req, res) => {
      requirePerm(req, 'accounts.manage');
      json(res, 200, { accounts: db.prepare('SELECT * FROM accounts ORDER BY created_at DESC').all().map((a) => A.publicAccount(db, a)), source: excelInfo() });
    }],
    ['POST', /^\/api\/admin\/accounts\/sync$/, async (req, res) => {
      const s = requirePerm(req, 'accounts.manage', { write: true });
      if (!excel) throw new A.AuthError(409, 'conflict', 'Accounts are not managed by an Excel file on this server.');
      await excel.sync(`requested by ${s.account.user_id}`);
      json(res, 200, { source: excelInfo() });
    }],
    ['POST', /^\/api\/admin\/accounts$/, async (req, res) => {
      const s = requirePerm(req, 'accounts.manage', { write: true });
      excelManaged();
      const b = await body(req);
      const r = await A.createAccount(db, { actor: actorOf(s), session: s, input: b, credential: b.credential, ip: ipOf(req) });
      json(res, 201, { account: r.account, ...(r.temporaryPassword ? { temporaryPassword: r.temporaryPassword } : {}), ...(r.inviteToken ? { inviteLink: linkFor(req, r.inviteToken) } : {}) });
    }],
    ['PATCH', /^\/api\/admin\/accounts\/([\w-]{36})$/, async (req, res, m) => {
      const s = requirePerm(req, 'accounts.manage', { write: true });
      excelManaged();
      json(res, 200, { account: A.updateAccount(db, { actor: actorOf(s), session: s, id: m[1], input: await body(req), ip: ipOf(req) }) });
    }],
    ['POST', /^\/api\/admin\/accounts\/([\w-]{36})\/reset-password$/, async (req, res, m) => {
      const s = requirePerm(req, 'accounts.manage', { write: true });
      const b = await body(req);
      const r = await A.adminResetPassword(db, { actor: actorOf(s), session: s, id: m[1], mode: b.mode, ip: ipOf(req) });
      if (excel && r.temporaryPassword) await excel.recordPassword(A.getAccount(db, m[1]).user_id, r.temporaryPassword);
      json(res, 200, r.temporaryPassword ? { temporaryPassword: r.temporaryPassword } : { resetLink: linkFor(req, r.resetToken) });
    }],
    ['POST', /^\/api\/admin\/accounts\/([\w-]{36})\/revoke-sessions$/, async (req, res, m) => {
      const s = requirePerm(req, 'accounts.manage', { write: true });
      json(res, 200, A.revokeSessions(db, { actor: actorOf(s), session: s, id: m[1], ip: ipOf(req) }));
    }],
    ['GET', /^\/api\/admin\/accounts\.xlsx$/, async (req, res) => {
      const s = requirePerm(req, 'accounts.manage');
      const { buffer, count } = await buildRegister(db, { exportedBy: s.account.user_id });
      A.audit(db, { actor: s.account, action: 'register.export', detail: `${count} accounts`, ip: ipOf(req) });
      res.writeHead(200, { ...base, 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="avgenx-account-register-${new Date().toISOString().slice(0, 10)}.xlsx"`, 'Cache-Control': 'no-store' });
      res.end(buffer);
    }],
    ['GET', /^\/api\/admin\/audit$/, (req, res) => {
      requirePerm(req, 'accounts.manage');
      json(res, 200, { events: db.prepare('SELECT at, actor_user actor, action, target_user target, detail, ip FROM auth_audit ORDER BY id DESC LIMIT 300').all() });
    }],

    ['POST', /^\/api\/ai$/, async (req, res) => {
      requirePerm(req, 'ai.use', { write: true });
      const raw = JSON.stringify(await body(req));
      const r = await aiHandler(new Request(`${originOf(req)}/api/ai`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: raw }));
      res.writeHead(r.status, { ...base, 'Content-Type': r.headers.get('content-type') || 'application/json', 'Cache-Control': 'no-store' });
      if (r.body) for await (const chunk of r.body) res.write(chunk);
      res.end();
    }],
  ];

  return createServer(async (req, res) => {
    const path = (req.url || '/').split('?')[0];
    try {
      const hits = routes.filter(([, re]) => re.test(path));
      if (!hits.length) { if (path.startsWith('/api/')) return json(res, 404, { code: 'not_found', message: 'Not found.' }); res.writeHead(302, { ...base, Location: '/' }); return res.end(); }
      const r = hits.find(([m]) => m === req.method || (m === 'GET' && req.method === 'HEAD'));
      if (!r) return json(res, 405, { code: 'method_not_allowed', message: 'Method not allowed.' }, { Allow: hits.map(([m]) => m).join(', ') });
      await r[2](req, res, path.match(r[1]));
    } catch (e) { if (!res.headersSent) fail(res, e); else res.end(); }
  });
}

function loadPages(dir) {
  const meta = existsSync(join(dir, 'pages.json')) ? JSON.parse(readFileSync(join(dir, 'pages.json'), 'utf8')) : {};
  const out = {};
  for (const name of ['app', 'login']) {
    const file = join(dir, `${name}.html`);
    if (existsSync(file)) { const html = readFileSync(file); out[name] = { html, gz: gzipSync(html, { level: 9 }), br: brotliCompressSync(html), csp: meta[name]?.csp || "default-src 'self'" }; }
  }
  return out;
}
