// Authentication and account rules. Every check here runs on the server; nothing the browser
// sends (role, user id, permissions) is trusted without being verified against the database.
import argon2 from 'argon2';
import { randomBytes, randomInt, createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { ROLES, can, PRIVILEGED_ROLES } from '../src/core/rbac.js';
import { tx } from './db.mjs';

export const ROLE_IDS = ROLES.map((r) => r.id);
export const roleLabel = (id) => ROLES.find((r) => r.id === id)?.label || id;

const HASH_OPTS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 }; // OWASP baseline for argon2id
export const LIMITS = {
  sessionHours: 12,            // without "keep me signed in"
  sessionIdleHours: Number(process.env.SESSION_IDLE_MINUTES || 480) / 60, // shorten on shared lab computers
  rememberDays: 14,            // with "keep me signed in"
  restrictedMinutes: 15,       // a session that must change its password first
  idFailures: 5,               // failed sign-ins per identifier ...
  // Per IP address. An institute's students usually share one public IP, so this is high enough
  // that a busy lab cannot lock everyone out; the per-identifier limit stops password guessing.
  ipFailures: Number(process.env.LOGIN_IP_LIMIT || 200),
  windowMinutes: 15,           // ... within this window
  resetMinutes: 30,            // self-service reset link lifetime
  adminLinkHours: 24,          // reset link issued by an administrator
  inviteHours: 72,             // invitation link lifetime
  forgotPerHour: 5,
};

export class AuthError extends Error {
  constructor(status, code, message, fields) { super(message); this.status = status; this.code = code; this.fields = fields; }
}

const iso = (d = new Date()) => d.toISOString();
const addMs = (ms) => iso(new Date(Date.now() + ms));
export const sha256 = (s) => createHash('sha256').update(s).digest('hex');
export const newToken = () => randomBytes(32).toString('base64url');
export const safeEqual = (a, b) => { const x = Buffer.from(String(a)); const y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };

// ------------------------------------------------------------------ passwords
export const hashPassword = (pw) => argon2.hash(pw, HASH_OPTS);
let dummyHash;
/** Verify, spending the same work whether or not the account exists. */
export async function verifyPassword(hash, pw) {
  dummyHash ||= await hashPassword(randomBytes(16).toString('hex'));
  try { const ok = await argon2.verify(hash || dummyHash, pw); return !!hash && ok; } catch { return false; }
}

const COMMON = ['password', 'passw0rd', '123456', 'qwerty', 'letmein', 'welcome', 'admin', 'avgenx', 'academy', 'iloveyou', 'abc123', 'changeme'];
/** Returns an error message, or '' when the password is acceptable. */
export function passwordProblem(pw, { userId = '', email = '' } = {}) {
  if (typeof pw !== 'string' || pw.length < 12) return 'Use at least 12 characters.';
  if (pw.length > 128) return 'Use 128 characters or fewer.';
  const low = pw.toLowerCase();
  if (userId && low.includes(userId.toLowerCase())) return 'Do not include your user ID.';
  const local = email.split('@')[0]?.toLowerCase();
  if (local && local.length > 2 && low.includes(local)) return 'Do not include your email name.';
  if (COMMON.some((w) => low.includes(w))) return 'Avoid common words such as "password" or the institute name.';
  if (/^(.)\1+$/.test(pw)) return 'Avoid repeating one character.';
  if (new Set(pw).size < 6) return 'Use a wider mix of characters.';
  return '';
}

const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const SYMBOLS = '!@#%*+=?';
/** Random temporary password: four groups of five plus a symbol, about 115 bits. */
export function tempPassword() {
  const group = () => Array.from({ length: 5 }, () => ALPHA[randomInt(ALPHA.length)]).join('');
  for (;;) {
    const pw = `${group()}-${group()}-${group()}-${group()}${SYMBOLS[randomInt(SYMBOLS.length)]}`;
    if (/[a-z]/.test(pw) && /[A-Z]/.test(pw) && /\d/.test(pw)) return pw;
  }
}

// ------------------------------------------------------------------ audit
export function audit(db, { actor = null, action, target = null, detail = '', ip = null }) {
  db.prepare('INSERT INTO auth_audit (at, actor_id, actor_user, action, target_id, target_user, detail, ip) VALUES (?,?,?,?,?,?,?,?)')
    .run(iso(), actor?.id || null, actor?.user_id || null, action, target?.id || null, target?.user_id || null, String(detail).slice(0, 500), ip);
}

// ------------------------------------------------------------------ rate limiting
export function rateLimited(db, keys, limits) {
  const since = Date.now() - LIMITS.windowMinutes * 60000;
  db.prepare('DELETE FROM login_attempts WHERE at < ?').run(since - 3600000);
  return keys.some((k, i) => db.prepare('SELECT COUNT(*) n FROM login_attempts WHERE key = ? AND at >= ?').get(k, since).n >= limits[i]);
}
const recordFailure = (db, keys) => keys.forEach((k) => db.prepare('INSERT INTO login_attempts (key, at) VALUES (?, ?)').run(k, Date.now()));

// ------------------------------------------------------------------ accounts
export const getAccount = (db, id) => db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
export const rolesOf = (db, id) => db.prepare('SELECT role FROM account_roles WHERE account_id = ? ORDER BY role').all(id).map((r) => r.role);
const findByIdentifier = (db, ident) => db.prepare('SELECT * FROM accounts WHERE user_id = ? OR email = ?').get(ident, ident);

export function publicAccount(db, a) {
  return { id: a.id, userId: a.user_id, name: a.name, email: a.email, roles: rolesOf(db, a.id), status: a.status, mustChangePassword: !!a.must_change_password, lmsRef: a.lms_ref, isTest: !!a.is_test, createdAt: a.created_at, createdBy: a.created_by ? db.prepare('SELECT user_id FROM accounts WHERE id = ?').get(a.created_by)?.user_id || null : null, lastLoginAt: a.last_login_at, invited: !a.password_hash, activeSessions: db.prepare('SELECT COUNT(*) n FROM sessions WHERE account_id = ? AND expires_at > ?').get(a.id, iso()).n };
}

const PREFIX = { superadmin: 'SAD', ceo: 'EXE', admin: 'ADM', director: 'DIR', pm: 'PGM', instructor: 'INS', mentor: 'MEN', ta: 'TAS', placement: 'PLC', student: 'STU', corporate: 'CRP' };
const ID_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function newUserId(db, role) {
  for (;;) {
    const id = `${PREFIX[role] || 'USR'}-${Array.from({ length: 6 }, () => ID_CHARS[randomInt(ID_CHARS.length)]).join('')}`;
    if (!db.prepare('SELECT 1 FROM accounts WHERE user_id = ?').get(id)) return id;
  }
}

const EMAIL = /^[^@\s]{1,64}@[^@\s]+\.[^@\s]{2,}$/;
const USER_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{2,31}$/;
const LMS_REF = /^[A-Za-z0-9-]{2,16}$/;

/** Validate account fields. Returns { clean, fields } where fields holds per-field errors. */
export function validateAccount(input, { partial = false } = {}) {
  const fields = {}; const clean = {};
  if (!partial || input.name !== undefined) { const n = String(input.name ?? '').trim(); if (n.length < 2 || n.length > 80) fields.name = 'Enter a name between 2 and 80 characters.'; else clean.name = n; }
  if (!partial || input.email !== undefined) { const e = String(input.email ?? '').trim().toLowerCase(); if (!EMAIL.test(e) || e.length > 254) fields.email = 'Enter a valid email address.'; else clean.email = e; }
  if (input.userId !== undefined && input.userId !== '') { const u = String(input.userId).trim(); if (!USER_ID.test(u)) fields.userId = 'Use 3 to 32 letters, digits, dots, dashes or underscores.'; else clean.userId = u; }
  if (!partial || input.roles !== undefined) {
    const r = Array.isArray(input.roles) ? [...new Set(input.roles)] : [];
    if (!r.length) fields.roles = 'Assign at least one role.';
    else if (r.some((x) => !ROLE_IDS.includes(x))) fields.roles = 'Unknown role.';
    else clean.roles = r;
  }
  if (input.status !== undefined) { if (!['active', 'disabled'].includes(input.status)) fields.status = 'Status must be active or disabled.'; else clean.status = input.status; }
  if (input.lmsRef !== undefined && input.lmsRef !== null && input.lmsRef !== '') { const l = String(input.lmsRef).trim(); if (!LMS_REF.test(l)) fields.lmsRef = 'Invalid profile reference.'; else clean.lmsRef = l; }
  return { clean, fields };
}

/**
 * Who may manage whom. Only a session whose verified role holds accounts.manage can manage
 * accounts at all. A super administrator can manage everyone; an institute administrator cannot
 * grant, remove or manage the privileged roles (super admin, institute admin, CEO).
 */
export function assertCanManage(session, targetRoles = [], newRoles = []) {
  if (!can(session.role, 'accounts.manage')) throw new AuthError(403, 'forbidden', 'Your role cannot manage accounts.');
  if (session.role === 'superadmin') return;
  const touched = [...targetRoles, ...newRoles];
  if (touched.some((r) => PRIVILEGED_ROLES.includes(r))) throw new AuthError(403, 'forbidden', 'Only a super administrator can manage super administrator, institute administrator or CEO accounts.');
}

export async function createAccount(db, { actor, session, input, credential = 'temporary', ip, isTest = false }) {
  const { clean, fields } = validateAccount(input);
  if (Object.keys(fields).length) throw new AuthError(422, 'validation_failed', 'Check the highlighted fields.', fields);
  if (session) assertCanManage(session, [], clean.roles);
  if (db.prepare('SELECT 1 FROM accounts WHERE email = ?').get(clean.email)) throw new AuthError(409, 'conflict', 'An account with this email already exists.', { email: 'Already in use.' });
  const userId = clean.userId || newUserId(db, clean.roles[0]);
  if (db.prepare('SELECT 1 FROM accounts WHERE user_id = ?').get(userId)) throw new AuthError(409, 'conflict', 'That user ID is taken.', { userId: 'Already in use.' });
  if (!['temporary', 'invite'].includes(credential)) throw new AuthError(400, 'invalid_request', 'Choose a temporary password or an invitation link.');
  const temp = credential === 'temporary' ? tempPassword() : null;
  const hash = temp ? await hashPassword(temp) : null;
  const id = randomUUID(); const now = iso();
  let token = null;
  tx(db, () => {
    db.prepare('INSERT INTO accounts (id, user_id, email, name, password_hash, status, must_change_password, lms_ref, is_test, created_at, created_by, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(id, userId, clean.email, clean.name, hash, clean.status || 'active', 1, clean.lmsRef || null, isTest ? 1 : 0, now, actor?.id || null, now);
    for (const r of clean.roles) db.prepare('INSERT INTO account_roles (account_id, role, granted_by, granted_at) VALUES (?,?,?,?)').run(id, r, actor?.id || null, now);
    if (!temp) token = issueToken(db, id, 'invite', LIMITS.inviteHours * 3600000, actor?.id);
    audit(db, { actor, action: 'account.create', target: { id, user_id: userId }, detail: `roles=${clean.roles.join(',')}; status=${clean.status || 'active'}; credential=${credential}${isTest ? '; development test account' : ''}`, ip });
  });
  return { account: publicAccount(db, getAccount(db, id)), temporaryPassword: temp, inviteToken: token };
}

export function updateAccount(db, { actor, session, id, input, ip }) {
  const target = getAccount(db, id);
  if (!target) throw new AuthError(404, 'not_found', 'Account not found.');
  const { clean, fields } = validateAccount(input, { partial: true });
  if (Object.keys(fields).length) throw new AuthError(422, 'validation_failed', 'Check the highlighted fields.', fields);
  const before = rolesOf(db, id);
  assertCanManage(session, before, clean.roles || []);
  if (id === actor.id) {
    if (clean.status === 'disabled') throw new AuthError(409, 'conflict', 'You cannot disable your own account.');
    if (clean.roles && !clean.roles.includes(session.role)) throw new AuthError(409, 'conflict', 'You cannot remove the role you are signed in with.');
  }
  const losingSuper = before.includes('superadmin') && ((clean.roles && !clean.roles.includes('superadmin')) || clean.status === 'disabled');
  if (losingSuper && db.prepare("SELECT COUNT(*) n FROM accounts a JOIN account_roles r ON r.account_id = a.id WHERE r.role = 'superadmin' AND a.status = 'active' AND a.id <> ?").get(id).n === 0) throw new AuthError(409, 'conflict', 'At least one active super administrator must remain.');
  if (clean.email && clean.email !== target.email && db.prepare('SELECT 1 FROM accounts WHERE email = ? AND id <> ?').get(clean.email, id)) throw new AuthError(409, 'conflict', 'An account with this email already exists.', { email: 'Already in use.' });
  const now = iso();
  tx(db, () => {
    const sets = []; const vals = [];
    for (const [k, col] of [['name', 'name'], ['email', 'email'], ['status', 'status'], ['lmsRef', 'lms_ref']]) if (clean[k] !== undefined) { sets.push(`${col} = ?`); vals.push(clean[k]); }
    if (sets.length) db.prepare(`UPDATE accounts SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`).run(...vals, now, id);
    if (clean.roles) {
      db.prepare('DELETE FROM account_roles WHERE account_id = ?').run(id);
      for (const r of clean.roles) db.prepare('INSERT INTO account_roles (account_id, role, granted_by, granted_at) VALUES (?,?,?,?)').run(id, r, actor.id, now);
      const removed = before.filter((r) => !clean.roles.includes(r));
      if (removed.length) db.prepare(`DELETE FROM sessions WHERE account_id = ? AND role IN (${removed.map(() => '?').join(',')})`).run(id, ...removed);
      if (removed.length || clean.roles.some((r) => !before.includes(r))) audit(db, { actor, action: 'account.roles', target, detail: `${before.join(',')} -> ${clean.roles.join(',')}`, ip });
    }
    if (clean.status && clean.status !== target.status) {
      if (clean.status === 'disabled') db.prepare('DELETE FROM sessions WHERE account_id = ?').run(id);
      audit(db, { actor, action: clean.status === 'disabled' ? 'account.disable' : 'account.enable', target, ip });
    }
    const changed = ['name', 'email', 'lmsRef'].filter((k) => clean[k] !== undefined && clean[k] !== { name: target.name, email: target.email, lmsRef: target.lms_ref }[k]);
    if (changed.length) audit(db, { actor, action: 'account.update', target, detail: `fields=${changed.join(',')}`, ip });
  });
  return publicAccount(db, getAccount(db, id));
}

export async function adminResetPassword(db, { actor, session, id, mode, ip }) {
  const target = getAccount(db, id);
  if (!target) throw new AuthError(404, 'not_found', 'Account not found.');
  assertCanManage(session, rolesOf(db, id));
  if (!['temporary', 'link'].includes(mode)) throw new AuthError(400, 'invalid_request', 'Choose a temporary password or a reset link.');
  if (mode === 'temporary') {
    const temp = tempPassword(); const hash = await hashPassword(temp);
    tx(db, () => {
      db.prepare('UPDATE accounts SET password_hash = ?, must_change_password = 1, updated_at = ? WHERE id = ?').run(hash, iso(), id);
      db.prepare('DELETE FROM sessions WHERE account_id = ?').run(id);
      db.prepare('UPDATE password_tokens SET used_at = ? WHERE account_id = ? AND used_at IS NULL').run(iso(), id);
      audit(db, { actor, action: 'password.admin_reset', target, detail: 'temporary password issued; sessions revoked', ip });
    });
    return { temporaryPassword: temp };
  }
  const token = tx(db, () => { const t = issueToken(db, id, 'reset', LIMITS.adminLinkHours * 3600000, actor.id); audit(db, { actor, action: 'password.reset_link', target, detail: `link valid ${LIMITS.adminLinkHours}h`, ip }); return t; });
  return { resetToken: token };
}

export function revokeSessions(db, { actor, session, id, ip }) {
  const target = getAccount(db, id);
  if (!target) throw new AuthError(404, 'not_found', 'Account not found.');
  assertCanManage(session, rolesOf(db, id));
  const n = db.prepare('DELETE FROM sessions WHERE account_id = ?').run(id).changes;
  audit(db, { actor, action: 'sessions.revoke', target, detail: `${n} session(s)`, ip });
  return { revoked: n };
}

// ------------------------------------------------------------------ password tokens
function issueToken(db, accountId, purpose, ttlMs, createdBy = null) {
  db.prepare('UPDATE password_tokens SET used_at = ? WHERE account_id = ? AND used_at IS NULL').run(iso(), accountId); // one live token at a time
  const token = newToken();
  db.prepare('INSERT INTO password_tokens (token_hash, account_id, purpose, created_at, expires_at, created_by) VALUES (?,?,?,?,?,?)').run(sha256(token), accountId, purpose, iso(), addMs(ttlMs), createdBy);
  return token;
}

/** Self-service: returns a token to deliver, or null. Never reveals whether the account exists. */
export function requestReset(db, { identifier, ip }) {
  const ident = String(identifier || '').trim().slice(0, 254);
  if (rateLimited(db, [`forgot:${ip}`], [LIMITS.forgotPerHour])) throw new AuthError(429, 'rate_limited', 'Too many requests. Wait a while and try again.');
  recordFailure(db, [`forgot:${ip}`]);
  if (!ident) return null;
  const a = findByIdentifier(db, ident);
  if (!a || a.status !== 'active') { audit(db, { action: 'password.forgot', detail: 'no active account matched', ip }); return null; }
  const token = tx(db, () => { const t = issueToken(db, a.id, 'reset', LIMITS.resetMinutes * 60000); audit(db, { actor: a, action: 'password.forgot', target: a, detail: 'reset link issued', ip }); return t; });
  return { token, account: a };
}

export async function completeReset(db, { token, password, ip }) {
  const row = typeof token === 'string' && token.length < 100 ? db.prepare('SELECT * FROM password_tokens WHERE token_hash = ?').get(sha256(token)) : null;
  if (!row || row.used_at || row.expires_at <= iso()) throw new AuthError(400, 'invalid_token', 'This link is invalid or has expired. Ask for a new one.');
  const a = getAccount(db, row.account_id);
  if (!a || a.status !== 'active') throw new AuthError(400, 'invalid_token', 'This link is invalid or has expired. Ask for a new one.');
  const problem = passwordProblem(password, { userId: a.user_id, email: a.email });
  if (problem) throw new AuthError(422, 'weak_password', problem, { password: problem });
  const hash = await hashPassword(password);
  tx(db, () => {
    const claimed = db.prepare('UPDATE password_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL').run(iso(), row.token_hash).changes;
    if (!claimed) throw new AuthError(400, 'invalid_token', 'This link is invalid or has expired. Ask for a new one.');
    db.prepare('UPDATE accounts SET password_hash = ?, must_change_password = 0, password_changed_at = ?, updated_at = ? WHERE id = ?').run(hash, iso(), iso(), a.id);
    db.prepare('DELETE FROM sessions WHERE account_id = ?').run(a.id);
    audit(db, { actor: a, action: row.purpose === 'invite' ? 'invite.accept' : 'password.reset', target: a, detail: 'password set; all sessions revoked', ip });
  });
  return { userId: a.user_id };
}

// ------------------------------------------------------------------ sessions
export async function login(db, { role, identifier, password, remember, ip, userAgent }) {
  const ident = String(identifier || '').trim();
  if (!ROLE_IDS.includes(role) || !ident || ident.length > 254 || typeof password !== 'string' || !password || password.length > 256) throw new AuthError(400, 'invalid_request', 'Select a role and enter your user ID and password.');
  const keys = [`id:${ident.toLowerCase()}`, `ip:${ip}`];
  if (rateLimited(db, keys, [LIMITS.idFailures, LIMITS.ipFailures])) {
    audit(db, { action: 'login.locked', detail: `identifier=${ident.slice(0, 64)}`, ip });
    throw new AuthError(429, 'rate_limited', `Too many sign-in attempts. Wait ${LIMITS.windowMinutes} minutes and try again.`);
  }
  const a = findByIdentifier(db, ident);
  const ok = await verifyPassword(a?.password_hash, password);
  const generic = new AuthError(401, 'invalid_credentials', 'The user ID, password or role is not correct.');
  if (!ok) { recordFailure(db, keys); audit(db, { action: 'login.failed', target: a || null, detail: a ? 'wrong password' : 'unknown identifier', ip }); throw generic; }
  // Only someone who knows the password learns these more specific outcomes.
  if (a.status !== 'active') { audit(db, { action: 'login.blocked', target: a, detail: 'account disabled', ip }); throw new AuthError(403, 'account_disabled', 'This account is disabled. Contact your institute administrator.'); }
  if (!rolesOf(db, a.id).includes(role)) { recordFailure(db, keys); audit(db, { action: 'login.failed', target: a, detail: `role not assigned: ${role}`, ip }); throw new AuthError(403, 'role_not_assigned', 'This account is not authorised for the selected role.'); }
  db.prepare('DELETE FROM login_attempts WHERE key = ?').run(keys[0]);
  const restricted = !!a.must_change_password;
  const token = newToken();
  const ttl = restricted ? LIMITS.restrictedMinutes * 60000 : remember ? LIMITS.rememberDays * 86400000 : LIMITS.sessionHours * 3600000;
  const now = iso();
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
  db.prepare('INSERT INTO sessions (token_hash, account_id, role, csrf, restricted, remember, created_at, last_seen_at, expires_at, ip, user_agent) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(sha256(token), a.id, role, newToken(), restricted ? 1 : 0, remember && !restricted ? 1 : 0, now, now, addMs(ttl), ip, String(userAgent || '').slice(0, 200));
  db.prepare('UPDATE accounts SET last_login_at = ? WHERE id = ?').run(now, a.id);
  audit(db, { actor: a, action: 'login.success', target: a, detail: `role=${role}${restricted ? '; password change required' : ''}${remember ? '; remembered' : ''}`, ip });
  return { token, maxAge: remember && !restricted ? ttl / 1000 : null, mustChangePassword: restricted };
}

/** Resolve a cookie token to a live session, re-checking the account and role every time. */
export function resolveSession(db, token) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
  const s = db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(sha256(token));
  if (!s) return null;
  const now = new Date();
  const idleLimit = (s.remember ? LIMITS.rememberDays * 24 : LIMITS.sessionIdleHours) * 3600000;
  if (s.expires_at <= iso(now) || now - new Date(s.last_seen_at) > idleLimit) { db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(s.token_hash); return null; }
  const a = getAccount(db, s.account_id);
  if (!a || a.status !== 'active' || !rolesOf(db, a.id).includes(s.role)) { db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(s.token_hash); return null; }
  if (now - new Date(s.last_seen_at) > 60000) db.prepare('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?').run(iso(now), s.token_hash);
  return { ...s, account: a };
}

export function logout(db, session, ip) {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(session.token_hash);
  audit(db, { actor: session.account, action: 'logout', target: session.account, ip });
}

export async function changePassword(db, { session, current, next, ip, userAgent }) {
  const a = session.account;
  if (!(await verifyPassword(a.password_hash, String(current || '')))) throw new AuthError(400, 'invalid_credentials', 'Your current password is not correct.', { current: 'Not correct.' });
  const problem = passwordProblem(next, { userId: a.user_id, email: a.email });
  if (problem) throw new AuthError(422, 'weak_password', problem, { next: problem });
  if (await verifyPassword(a.password_hash, next)) throw new AuthError(422, 'weak_password', 'Choose a password you have not used for this account.', { next: 'Same as the current password.' });
  const hash = await hashPassword(next);
  const token = newToken(); const now = iso();
  tx(db, () => {
    db.prepare('UPDATE accounts SET password_hash = ?, must_change_password = 0, password_changed_at = ?, updated_at = ? WHERE id = ?').run(hash, now, now, a.id);
    db.prepare('DELETE FROM sessions WHERE account_id = ?').run(a.id); // sign out everywhere else, then rotate this session
    db.prepare('INSERT INTO sessions (token_hash, account_id, role, csrf, restricted, remember, created_at, last_seen_at, expires_at, ip, user_agent) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run(sha256(token), a.id, session.role, newToken(), 0, 0, now, now, addMs(LIMITS.sessionHours * 3600000), ip, String(userAgent || '').slice(0, 200));
    audit(db, { actor: a, action: 'password.change', target: a, detail: 'other sessions revoked', ip });
  });
  return { token };
}
