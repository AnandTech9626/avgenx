// Excel account list. When accounts.xlsx exists, it decides who may sign in:
//   * every valid row is an account (created or updated to match the row),
//   * an account whose row is missing, invalid or marked Disabled cannot sign in,
//   * the server re-reads the file when it changes and before every sign-in.
// The file stays on the server and is never served to browsers. Sign-in is checked against the
// Argon2id hash in the database. By the institute's choice, the Password column mirrors each
// person's current password: the server writes it there whenever it changes (first sign-in, own
// change, reset). Typing a new value into the cell resets that person's password (they must then
// choose a new one at sign-in).
import ExcelJS from 'exceljs';
import { statSync, existsSync, renameSync, unwatchFile, watchFile, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { ROLES } from '../src/core/rbac.js';
import * as A from './auth.mjs';
import { tx } from './db.mjs';

export const SHEET = 'Accounts';
export const COLUMNS = [
  { key: 'userId', header: 'User ID', width: 16, note: 'Required. Letters, digits, dots, dashes or underscores. Unique.' },
  { key: 'name', header: 'Full name', width: 26, note: 'Required.' },
  { key: 'email', header: 'Email', width: 32, note: 'Required. Unique.' },
  { key: 'roles', header: 'Role', width: 28, note: 'One role, or several separated by commas. See the Roles sheet.' },
  { key: 'status', header: 'Status', width: 11, note: 'Active or Disabled.' },
  { key: 'lmsRef', header: 'Linked profile', width: 15, note: 'Optional sample-data profile, for example S1001.' },
  { key: 'password', header: 'Password', width: 26, note: 'Current password, kept up to date by the server. Leave empty for a new person and the server fills one in. Type a new value (10+ characters) to reset it.' },
  { key: 'result', header: 'Sync result', width: 46, note: 'Written by the server. Do not edit.' },
];
const MIN_TEMP = 10;

const norm = (s) => String(s || '').trim().toLowerCase().replace(/[^a-z]/g, '');
const ROLE_LOOKUP = new Map(ROLES.flatMap((r) => [[norm(r.id), r.id], [norm(r.label), r.id], [norm(r.short), r.id]]));
ROLE_LOOKUP.set('ceo', 'ceo'); ROLE_LOOKUP.set('executivedirector', 'ceo'); ROLE_LOOKUP.set('ta', 'ta'); ROLE_LOOKUP.set('corporate', 'corporate');
export const parseRoles = (text) => String(text || '').split(/[,;/\n]+/).map((x) => x.trim()).filter(Boolean).map((x) => ROLE_LOOKUP.get(norm(x)) || `?${x}`);
const cellText = (c) => (c?.text ?? '').toString().trim();

/** Build a fresh workbook with the right columns, dropdowns and help sheets. */
export function newWorkbook(rows = []) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'AVGENX Academy';
  const ws = wb.addWorksheet(SHEET, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width }));
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF14213D' } };
  COLUMNS.forEach((c, i) => { ws.getRow(1).getCell(i + 1).note = c.note; });
  for (const r of rows) ws.addRow(r);
  for (let i = 2; i <= 500; i++) {
    ws.getCell(`D${i}`).dataValidation = { type: 'list', allowBlank: true, formulae: ['Roles!$A$2:$A$12'], showErrorMessage: false };
    ws.getCell(`E${i}`).dataValidation = { type: 'list', allowBlank: true, formulae: ['"Active,Disabled"'], showErrorMessage: true, errorTitle: 'Status', error: 'Choose Active or Disabled.' };
  }
  const roles = wb.addWorksheet('Roles');
  roles.columns = [{ header: 'Role (type exactly as shown)', width: 34 }, { header: 'Opens on', width: 26 }];
  roles.getRow(1).font = { bold: true };
  ROLES.forEach((r) => roles.addRow([r.label, r.home]));
  const help = wb.addWorksheet('How to use');
  help.columns = [{ width: 120 }];
  [
    'AVGENX Academy account list',
    'Only people listed on the Accounts sheet with Status = Active can sign in. Save the file and the server applies it within a few seconds.',
    'Add a person: add a row with User ID, Full name, Email, Role and Status Active. Leave Password empty and the server writes one in (close the file in Excel first so the server can write to it).',
    'The person signs in with the role, the User ID and that password, then must choose their own. The server writes their new password into the Password column, and again whenever they change it.',
    'Remove access: delete the row or set Status to Disabled. They are signed out immediately.',
    'Reset a password: type a new password (at least 10 characters) in their Password cell and save. They must choose their own at their next sign-in.',
    'Several roles: separate them with commas, for example "Instructor, Mentor".',
    'Keep this file private: it shows everyone\'s current password. It lives on the server and is never sent to browsers. If the server cannot write while the file is open in Excel, it writes as soon as the file is closed.',
  ].forEach((t, i) => { const row = help.addRow([t]); row.alignment = { wrapText: true }; if (!i) row.font = { bold: true, size: 13 }; });
  return wb;
}

export function createExcelSource(db, { path, log = console, pollMs = 1500, retryMs = 3000, rename = renameSync } = {}) {
  let lastMtime = 0;
  let running = null;
  let state = { path, lastSync: null, rows: 0, active: 0, errors: [], writeBlocked: false };
  let warnedLock = false;
  let retryTimer = null;

  const mtime = () => { try { return statSync(path).mtimeMs; } catch { return 0; } };

  async function readRows() {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(path);
    const ws = wb.getWorksheet(SHEET) || wb.worksheets[0];
    if (!ws) throw new Error('The workbook has no sheets.');
    const header = ws.getRow(1);
    const col = {};
    const MATCH = { userId: /user\s*id|^id$|login/, name: /name/, email: /e-?mail/, roles: /role/, status: /status/, lmsRef: /profile/, password: /password/, result: /sync|result/ };
    header.eachCell((c, i) => {
      const h = cellText(c).toLowerCase();
      const key = Object.keys(MATCH).find((k) => !col[k] && MATCH[k].test(h) && !(k === 'name' && /user/.test(h)));
      if (key) col[key] = i;
    });
    if (!col.result) { col.result = Math.max(...Object.values(col), 0) + 1; header.getCell(col.result).value = 'Sync result'; }
    for (const k of ['userId', 'name', 'email', 'roles']) if (!col[k]) throw new Error(`Column "${COLUMNS.find((c) => c.key === k).header}" is missing from the ${SHEET} sheet.`);
    const rows = [];
    ws.eachRow((row, n) => {
      if (n === 1) return;
      const v = (k) => (col[k] ? cellText(row.getCell(col[k])) : '');
      if (!['userId', 'name', 'email', 'roles'].some((k) => v(k))) return;
      rows.push({ n, row, userId: v('userId'), name: v('name'), email: v('email'), rolesText: v('roles'), statusText: v('status') || 'Active', lmsRef: v('lmsRef'), password: v('password') });
    });
    return { wb, ws, col, rows };
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function write(wb) {
    const tmp = `${path}.saving-${process.pid}.xlsx`;
    try {
      await wb.xlsx.writeFile(tmp);
      // Windows can hold a file for a moment (antivirus, sync tools); try a few times before giving up.
      for (let i = 0; ; i++) {
        try { rename(tmp, path); break; } catch (e) { if (i >= 3 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) throw e; await sleep(150 * (i + 1)); }
      }
      lastMtime = mtime();
      if (state.writeBlocked) log.log('[accounts.xlsx] The file is writable again; pending updates were saved.');
      state.writeBlocked = false; warnedLock = false;
      return true;
    } catch (e) {
      try { rmSync(tmp, { force: true }); } catch { /* nothing to clean */ }
      state.writeBlocked = true;
      if (!warnedLock) { log.log(`[accounts.xlsx] Could not save ${path} (${e.code || e.message}). It is probably open in Excel: close it and the server saves the pending changes within a few seconds.`); warnedLock = true; }
      return false;
    }
  }
  const pendingCount = () => db.prepare('SELECT COUNT(*) n FROM excel_pending_passwords').get().n;
  /** Keep retrying while passwords are waiting to be written (for example until Excel is closed). */
  function scheduleRetry() {
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => { lastMtime = -1; maybeSync('retry write').catch(() => {}); }, retryMs);
    retryTimer.unref?.();
  }

  async function sync({ reason = 'change' } = {}) {
    if (!existsSync(path)) { state.errors = [`${path} not found`]; return state; }
    const mt = mtime();
    let parsed;
    try { parsed = await readRows(); } catch (e) {
      state.errors = [`Could not read the file: ${e.message}`];
      log.log(`[accounts.xlsx] ${state.errors[0]} Sign-ins keep using the last good version.`);
      return state;
    }
    const { wb, ws, col, rows } = parsed;

    // Passwords changed in the app that still have to be written into the file.
    const pending = new Map(db.prepare('SELECT user_id, password FROM excel_pending_passwords').all().map((p) => [p.user_id.toLowerCase(), p.password]));

    // 1. Validate each row.
    const seenId = new Map(); const seenEmail = new Map();
    for (const r of rows) {
      const roles = parseRoles(r.rolesText);
      const status = /^disab|^inact|^no$|^blocked/i.test(r.statusText) ? 'disabled' : /^activ|^yes$|^enab/i.test(r.statusText) ? 'active' : null;
      const { clean, fields } = A.validateAccount({ userId: r.userId, name: r.name, email: r.email, roles: roles.filter((x) => !x.startsWith('?')), lmsRef: r.lmsRef || undefined, status: status || 'active' });
      const errs = [];
      if (!r.userId) errs.push('User ID is required');
      if (roles.some((x) => x.startsWith('?'))) errs.push(`Unknown role "${roles.find((x) => x.startsWith('?')).slice(1)}"`);
      if (!status) errs.push('Status must be Active or Disabled');
      for (const m of Object.values(fields)) errs.push(m.replace(/\.$/, ''));
      if (r.password && r.password.length < MIN_TEMP && !pending.has(r.userId.toLowerCase())) errs.push(`Password must be at least ${MIN_TEMP} characters`);
      r.clean = { ...clean, userId: r.userId, status: status || 'disabled' };
      r.errs = errs;
      const idKey = r.userId.toLowerCase(), emKey = (clean.email || r.email).toLowerCase();
      if (seenId.has(idKey)) { r.errs.push('Duplicate User ID'); seenId.get(idKey).errs.push('Duplicate User ID'); } else seenId.set(idKey, r);
      if (emKey && seenEmail.has(emKey)) { r.errs.push('Duplicate email'); seenEmail.get(emKey).errs.push('Duplicate email'); } else if (emKey) seenEmail.set(emKey, r);
    }
    // Emails used by an account that is not this row's user.
    for (const r of rows.filter((x) => !x.errs.length)) {
      const other = db.prepare('SELECT user_id FROM accounts WHERE email = ? AND user_id <> ?').get(r.clean.email, r.userId);
      if (other && seenId.has(other.user_id.toLowerCase())) continue; // that account's row changes its email in this same sync
      if (other) r.errs.push(`Email already used by ${other.user_id}`);
    }

    // 2. Work out password actions (hashing is async, so it happens before the transaction).
    let writeNeeded = false;
    const generated = [];
    for (const r of rows.filter((x) => !x.errs.length)) {
      const acct = db.prepare('SELECT * FROM accounts WHERE user_id = ?').get(r.userId);
      r.acct = acct;
      const pend = pending.get(r.userId.toLowerCase());
      if (pend !== undefined && acct) { if (r.password !== pend) { r.mirror = pend; writeNeeded = true; } else r.mirrored = true; continue; }
      if (r.password) {
        // The cell matches what the server last applied or wrote: nothing to do. Anything else is a reset typed by an administrator.
        const already = acct?.seed_pw_hash && (await A.verifyPassword(acct.seed_pw_hash, r.password));
        if (!already) { r.setHash = await A.hashPassword(r.password); r.setSeed = r.setHash; }
      } else if (acct?.password_hash && !acct.must_change_password) {
        // Cell emptied by hand for someone who already has a password: leave their password alone and note it.
        r.noMirror = true;
      } else if (!acct || !acct.password_hash) {
        r.gen = A.tempPassword(); generated.push(r); writeNeeded = true;
      }
    }

    // 3. Write generated passwords, cleared cells and results back to the file first. A generated
    //    password only takes effect if it was written, so nobody is left with an unknown password.
    const resultText = (r) => (r.errs.length ? `Not imported: ${r.errs.join('; ')}` : r.clean.status === 'disabled' ? 'OK: disabled, cannot sign in' : r.gen ? 'OK: password created; must be changed at first sign-in' : r.setHash ? 'OK: password reset from this file; must be changed at next sign-in' : r.noMirror ? 'OK: active (password set by the person; not shown here)' : r.acct?.must_change_password ? 'OK: active; must change password at next sign-in' : 'OK: active');
    for (const r of rows) {
      const want = resultText(r);
      if (cellText(r.row.getCell(col.result)) !== want) { r.row.getCell(col.result).value = want; writeNeeded = true; }
      if (r.gen && col.password) r.row.getCell(col.password).value = r.gen;
      if (r.mirror !== undefined && col.password) r.row.getCell(col.password).value = r.mirror;
    }
    if (!col.password) for (const r of generated) delete r.gen;
    const wrote = writeNeeded ? await write(wb) : true;
    if (!wrote) for (const r of generated) delete r.gen; // never set a password nobody can read
    if (wrote) for (const r of rows) if (r.mirror !== undefined || r.mirrored) db.prepare('DELETE FROM excel_pending_passwords WHERE user_id = ?').run(r.userId);
    for (const r of generated) if (r.gen) { r.setHash = await A.hashPassword(r.gen); r.setSeed = r.setHash; }
    if (!writeNeeded) lastMtime = mt;
    if (!wrote) { lastMtime = mt; scheduleRetry(); }
    if (wrote) for (const r of rows) if (r.mirror !== undefined) log.log(`[accounts.xlsx] Wrote the new password for ${r.userId} into the file.`);

    // 4. Apply to the database.
    const now = new Date().toISOString();
    const valid = rows.filter((r) => !r.errs.length);
    const listed = new Set(valid.map((r) => r.userId.toLowerCase()));
    tx(db, () => {
      for (const r of valid) {
        const c = r.clean;
        let a = db.prepare('SELECT * FROM accounts WHERE user_id = ?').get(r.userId);
        if (!a) {
          const id = randomUUID();
          db.prepare('INSERT INTO accounts (id, user_id, email, name, password_hash, seed_pw_hash, status, must_change_password, lms_ref, is_test, created_at, created_by, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
            .run(id, r.userId, c.email, c.name, r.setHash || null, r.setSeed || null, c.status, 1, c.lmsRef || null, 0, now, null, now);
          for (const role of c.roles) db.prepare('INSERT INTO account_roles (account_id, role, granted_by, granted_at) VALUES (?,?,?,?)').run(id, role, null, now);
          A.audit(db, { action: 'account.create', target: { id, user_id: r.userId }, detail: `from accounts.xlsx row ${r.n}; roles=${c.roles.join(',')}; status=${c.status}`, ip: 'accounts.xlsx' });
          continue;
        }
        const before = A.rolesOf(db, a.id);
        if (a.name !== c.name || a.email !== c.email || (a.lms_ref || null) !== (c.lmsRef || null)) {
          db.prepare('UPDATE accounts SET name = ?, email = ?, lms_ref = ?, updated_at = ? WHERE id = ?').run(c.name, c.email, c.lmsRef || null, now, a.id);
          A.audit(db, { action: 'account.update', target: a, detail: `from accounts.xlsx row ${r.n}`, ip: 'accounts.xlsx' });
        }
        if (before.join(',') !== [...c.roles].sort().join(',')) {
          db.prepare('DELETE FROM account_roles WHERE account_id = ?').run(a.id);
          for (const role of c.roles) db.prepare('INSERT INTO account_roles (account_id, role, granted_by, granted_at) VALUES (?,?,?,?)').run(a.id, role, null, now);
          const removed = before.filter((x) => !c.roles.includes(x));
          if (removed.length) db.prepare(`DELETE FROM sessions WHERE account_id = ? AND role IN (${removed.map(() => '?').join(',')})`).run(a.id, ...removed);
          A.audit(db, { action: 'account.roles', target: a, detail: `${before.join(',')} -> ${c.roles.join(',')} (accounts.xlsx)`, ip: 'accounts.xlsx' });
        }
        if (a.status !== c.status) {
          db.prepare('UPDATE accounts SET status = ?, updated_at = ? WHERE id = ?').run(c.status, now, a.id);
          if (c.status === 'disabled') db.prepare('DELETE FROM sessions WHERE account_id = ?').run(a.id);
          A.audit(db, { action: c.status === 'disabled' ? 'account.disable' : 'account.enable', target: a, detail: 'accounts.xlsx', ip: 'accounts.xlsx' });
        }
        if (r.setHash) {
          db.prepare('UPDATE accounts SET password_hash = ?, seed_pw_hash = ?, must_change_password = 1, updated_at = ? WHERE id = ?').run(r.setHash, r.setSeed, now, a.id);
          db.prepare('DELETE FROM sessions WHERE account_id = ?').run(a.id);
          A.audit(db, { action: 'password.excel_set', target: a, detail: 'temporary password from accounts.xlsx; sessions revoked', ip: 'accounts.xlsx' });
        }
      }
      // Anyone not listed (or listed on an invalid row) may not sign in.
      for (const a of db.prepare("SELECT * FROM accounts WHERE status = 'active'").all()) {
        if (listed.has(a.user_id.toLowerCase())) continue;
        db.prepare("UPDATE accounts SET status = 'disabled', updated_at = ? WHERE id = ?").run(now, a.id);
        db.prepare('DELETE FROM sessions WHERE account_id = ?').run(a.id);
        A.audit(db, { action: 'account.disable', target: a, detail: 'not on an active, valid row of accounts.xlsx', ip: 'accounts.xlsx' });
      }
    });

    // A password queued for someone no longer listed is dropped: they cannot sign in anyway.
    for (const p of db.prepare('SELECT user_id FROM excel_pending_passwords').all()) if (!listed.has(p.user_id.toLowerCase())) db.prepare('DELETE FROM excel_pending_passwords WHERE user_id = ?').run(p.user_id);
    if (pendingCount()) scheduleRetry();
    state = { pending: pendingCount(), path, lastSync: now, rows: rows.length, active: valid.filter((r) => r.clean.status === 'active').length, errors: rows.filter((r) => r.errs.length).map((r) => `Row ${r.n}: ${r.errs.join('; ')}`), writeBlocked: state.writeBlocked && !wrote };
    log.log(`[accounts.xlsx] Synced (${reason}): ${state.active} active, ${rows.length - valid.length} rows with problems${generated.some((r) => r.gen) ? `, ${generated.filter((r) => r.gen).length} temporary passwords written to the file` : ''}.`);
    for (const e of state.errors) log.log(`[accounts.xlsx]   ${e}`);
    return state;
  }

  /** Sync if the file changed since the last sync. Concurrent callers share one run. */
  async function maybeSync(reason) {
    if (running) return running;
    if (mtime() === lastMtime) return state;
    running = sync({ reason }).finally(() => { running = null; });
    return running;
  }

  return {
    path,
    status: () => ({ ...state, pending: pendingCount() }),
    async sync(reason = 'manual') { if (running) await running.catch(() => {}); lastMtime = -1; return maybeSync(reason); },
    /**
     * Mirror a password that changed in the app (own change, first sign-in, reset) into the file.
     * It is queued in the database first, so it is written even if the file is open right now.
     */
    async recordPassword(userId, password) {
      db.prepare('INSERT INTO excel_pending_passwords (user_id, password, at) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET password = excluded.password, at = excluded.at').run(userId, password, new Date().toISOString());
      db.prepare('UPDATE accounts SET seed_pw_hash = password_hash WHERE user_id = ?').run(userId); // the new value is "already applied"
      try { await this.sync('password changed'); } catch (e) { log.error(e); }
      const queued = !!db.prepare('SELECT 1 FROM excel_pending_passwords WHERE user_id = ?').get(userId);
      if (queued) { log.log(`[accounts.xlsx] New password for ${userId} is queued; it will be written when the file can be saved.`); scheduleRetry(); }
      return queued ? 'queued' : 'written';
    },
    maybeSync,
    start() { watchFile(path, { interval: pollMs }, () => { maybeSync('file saved').catch((e) => log.error(e)); }); return this; },
    stop() { unwatchFile(path); clearTimeout(retryTimer); },
  };
}
