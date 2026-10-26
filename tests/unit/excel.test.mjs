// accounts.xlsx decides who can sign in.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { openDb } from '../../server/db.mjs';
import { createApp } from '../../server/app.mjs';
import { createExcelSource, newWorkbook, SHEET } from '../../server/excel-accounts.mjs';
import { createAccount } from '../../server/auth.mjs';

const dir = mkdtempSync(join(tmpdir(), 'avgenx-xlsx-'));
const xlsx = join(dir, 'accounts.xlsx');
const quiet = { log() {}, error() {} };
let db, excel, server, B;
let bump = 0;

async function readSheet() {
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(xlsx);
  const ws = wb.getWorksheet(SHEET);
  const rows = {};
  ws.eachRow((r, n) => { if (n > 1) rows[r.getCell(1).text] = { password: r.getCell(7).text, result: r.getCell(8).text, row: r }; });
  return { wb, ws, rows };
}
/** Edit the workbook like a person would in Excel, then save. */
async function edit(fn) {
  const s = await readSheet();
  fn(s);
  await s.wb.xlsx.writeFile(xlsx);
  const t = new Date(Date.now() + ++bump * 2000); utimesSync(xlsx, t, t); // make sure the change is visible
}
async function login(role, identifier, password) {
  const r = await fetch(`${B}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ role, identifier, password }) });
  return { status: r.status, body: await r.json(), cookie: r.headers.get('set-cookie')?.split(';')[0] };
}
async function session(role, id, temp, next) {
  const l = await login(role, id, temp);
  const me = await (await fetch(`${B}/api/auth/me`, { headers: { cookie: l.cookie } })).json();
  const ch = await fetch(`${B}/api/auth/change-password`, { method: 'POST', headers: { 'content-type': 'application/json', origin: B, cookie: l.cookie, 'x-csrf-token': me.csrf }, body: JSON.stringify({ current: temp, next }) });
  assert.equal(ch.status, 200);
  const cookie = ch.headers.get('set-cookie').split(';')[0];
  const me2 = await (await fetch(`${B}/api/auth/me`, { headers: { cookie } })).json();
  return { cookie, csrf: me2.csrf };
}

before(async () => {
  await newWorkbook([
    { userId: 'AVX-ADMIN', name: 'Asha Admin', email: 'asha@example.com', roles: 'Super Administrator', status: 'Active', password: 'Admin-temp-pass-1' },
    { userId: 'AVX-STU001', name: 'Ravi Student', email: 'ravi@example.com', roles: 'Student', status: 'Active', lmsRef: 'S1001', password: 'Ravi-temp-pass-22' },
    { userId: 'AVX-STU002', name: 'Meera Student', email: 'meera@example.com', roles: 'student', status: 'Active' },
    { userId: 'AVX-BAD', name: 'Bad Row', email: 'bad@example.com', roles: 'Wizard', status: 'Active', password: 'Whatever-123' },
  ]).xlsx.writeFile(xlsx);
  db = openDb(join(dir, 'x.db'));
  // An account that exists in the database but is not in the file.
  await createAccount(db, { input: { name: 'Old Account', email: 'old@example.com', userId: 'OLD-1', roles: ['student'] }, credential: 'temporary' });
  excel = createExcelSource(db, { path: xlsx, log: quiet });
  await excel.sync('test start');
  server = createApp({ db, excel, distDir: join(dir, 'nodist'), log: quiet }).listen(0);
  B = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { excel.stop(); await new Promise((r) => server.close(r)); db.close(); rmSync(dir, { recursive: true, force: true }); });

test('people in the file can sign in with the role and temporary password from the file', async () => {
  const r = await login('student', 'AVX-STU001', 'Ravi-temp-pass-22');
  assert.equal(r.status, 200); assert.equal(r.body.next, 'change-password');
  assert.equal((await login('superadmin', 'avx-stu001', 'Ravi-temp-pass-22')).body.code, 'role_not_assigned');
  const row = db.prepare('SELECT password_hash, must_change_password FROM accounts WHERE user_id = ?').get('AVX-STU001');
  assert.match(row.password_hash, /^\$argon2id\$/); assert.equal(row.must_change_password, 1);
});

test('anyone not in the file, or on an invalid row, cannot sign in', async () => {
  const old = db.prepare('SELECT status FROM accounts WHERE user_id = ?').get('OLD-1');
  assert.equal(old.status, 'disabled');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM accounts WHERE user_id = ?').get('AVX-BAD').n, 0);
  const { rows } = await readSheet();
  assert.match(rows['AVX-BAD'].result, /^Not imported: Unknown role "Wizard"/);
  assert.match(rows['AVX-STU001'].result, /^OK/);
});

test('an empty password cell gets a generated temporary password written into the file', async () => {
  const { rows } = await readSheet();
  const pw = rows['AVX-STU002'].password;
  assert.ok(pw.length >= 20, 'generated password written back');
  assert.equal((await login('student', 'AVX-STU002', pw)).status, 200);
});

test('when the person sets their own password, the new password is written into the file automatically', async () => {
  await session('student', 'AVX-STU001', 'Ravi-temp-pass-22', 'Harbor-lamp-quiet-77');
  let { rows } = await readSheet();
  assert.equal(rows['AVX-STU001'].password, 'Harbor-lamp-quiet-77', 'file shows the new password right away');
  assert.equal(rows['AVX-STU001'].result, 'OK: active');
  await excel.sync('test'); // re-reading the file does not treat the mirrored value as a reset
  assert.equal((await login('student', 'AVX-STU001', 'Harbor-lamp-quiet-77')).body.next, 'app');
  assert.equal((await login('student', 'AVX-STU001', 'Ravi-temp-pass-22')).status, 401);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM excel_pending_passwords').get().n, 0);
  // Changing it again from the Preferences page updates the file again.
  const l = await login('student', 'AVX-STU001', 'Harbor-lamp-quiet-77');
  const me = await (await fetch(`${B}/api/auth/me`, { headers: { cookie: l.cookie } })).json();
  assert.equal(me.features.passwordsInFile, true);
  const ch = await fetch(`${B}/api/auth/change-password`, { method: 'POST', headers: { 'content-type': 'application/json', origin: B, cookie: l.cookie, 'x-csrf-token': me.csrf }, body: JSON.stringify({ current: 'Harbor-lamp-quiet-77', next: 'Granite-moss-river-31' }) });
  assert.equal(ch.status, 200);
  ({ rows } = await readSheet());
  assert.equal(rows['AVX-STU001'].password, 'Granite-moss-river-31');
  assert.equal((await login('student', 'AVX-STU001', 'Granite-moss-river-31')).body.next, 'app');
});

test('a password queued while the file could not be written wins over the stale value in the file', async () => {
  // Simulate: the person changed their password while Excel had the file open, so it is still queued.
  const hash = db.prepare("SELECT password_hash FROM accounts WHERE user_id = 'AVX-STU001'").get().password_hash;
  db.prepare("INSERT INTO excel_pending_passwords (user_id, password, at) VALUES ('AVX-STU001', 'Granite-moss-river-31', ?)").run(new Date().toISOString());
  await edit(({ rows }) => { rows['AVX-STU001'].row.getCell(7).value = 'Old-stale-value-123'; }); // e.g. an older copy saved over it
  await excel.sync('test');
  const { rows } = await readSheet();
  assert.equal(rows['AVX-STU001'].password, 'Granite-moss-river-31');
  assert.equal(db.prepare("SELECT password_hash FROM accounts WHERE user_id = 'AVX-STU001'").get().password_hash, hash, 'not reset to the stale value');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM excel_pending_passwords').get().n, 0);
});

test('setting Status to Disabled or deleting the row ends access immediately, at the next sign-in or save', async () => {
  const s = await session('student', 'AVX-STU002', (await readSheet()).rows['AVX-STU002'].password, 'Copper-field-noon-88');
  await edit(({ rows }) => { rows['AVX-STU002'].row.getCell(5).value = 'Disabled'; });
  const r = await login('student', 'AVX-STU002', 'Copper-field-noon-88'); // sign-in re-reads the changed file first
  assert.equal(r.status, 403); assert.equal(r.body.code, 'account_disabled');
  assert.equal((await fetch(`${B}/api/auth/me`, { headers: { cookie: s.cookie } })).status, 401, 'live session ended');
  await edit(({ ws, rows }) => { ws.spliceRows(rows['AVX-STU001'].row.number, 1); });
  assert.equal((await login('student', 'AVX-STU001', 'Granite-moss-river-31')).status, 403);
});

test('typing a new password in the file resets it once; the person must then choose their own', async () => {
  await edit(({ rows }) => { rows['AVX-STU002'].row.getCell(5).value = 'Active'; rows['AVX-STU002'].row.getCell(7).value = 'Fresh-reset-pass-9'; });
  const r = await login('student', 'AVX-STU002', 'Fresh-reset-pass-9');
  assert.equal(r.status, 200); assert.equal(r.body.next, 'change-password');
  assert.equal((await login('student', 'AVX-STU002', 'Copper-field-noon-88')).status, 401);
});

test('in Excel mode the console cannot add or edit people, but can sync, reset and export', async () => {
  const a = await session('superadmin', 'AVX-ADMIN', 'Admin-temp-pass-1', 'Silver-kite-dawn-55');
  const h = { 'content-type': 'application/json', origin: B, cookie: a.cookie, 'x-csrf-token': a.csrf };
  const list = await (await fetch(`${B}/api/admin/accounts`, { headers: { cookie: a.cookie } })).json();
  assert.equal(list.source.kind, 'excel'); assert.equal(list.source.file, 'accounts.xlsx'); assert.ok(list.source.errors.some((e) => /Wizard/.test(e)));
  const create = await fetch(`${B}/api/admin/accounts`, { method: 'POST', headers: h, body: JSON.stringify({ name: 'X Y', email: 'xy@example.com', roles: ['student'], credential: 'temporary' }) });
  assert.equal(create.status, 409); assert.equal((await create.json()).code, 'managed_by_excel');
  const id = list.accounts.find((x) => x.userId === 'AVX-STU002').id;
  assert.equal((await fetch(`${B}/api/admin/accounts/${id}`, { method: 'PATCH', headers: h, body: JSON.stringify({ status: 'disabled' }) })).status, 409);
  assert.equal((await fetch(`${B}/api/admin/accounts/sync`, { method: 'POST', headers: h, body: '{}' })).status, 200);
  assert.equal((await fetch(`${B}/api/admin/accounts/${id}/revoke-sessions`, { method: 'POST', headers: h, body: '{}' })).status, 200);
  const reset = await (await fetch(`${B}/api/admin/accounts/${id}/reset-password`, { method: 'POST', headers: h, body: JSON.stringify({ mode: 'temporary' }) })).json();
  assert.equal((await readSheet()).rows['AVX-STU002'].password, reset.temporaryPassword, 'console reset is written into the file');
  await edit(({ rows }) => { rows['AVX-STU002'].row.getCell(7).value = 'Fresh-reset-pass-9'; }); // keep the later steps using a known value
  const student = await login('student', 'AVX-STU002', 'Fresh-reset-pass-9');
  const sm = await (await fetch(`${B}/api/auth/me`, { headers: { cookie: student.cookie } })).json();
  assert.equal((await fetch(`${B}/api/admin/accounts/sync`, { method: 'POST', headers: { ...h, cookie: student.cookie, 'x-csrf-token': sm.csrf }, body: '{}' })).status, 403);
});

test('changing a role in the file applies at the next sync', async () => {
  await edit(({ rows }) => { rows['AVX-STU002'].row.getCell(4).value = 'Student, Mentor'; });
  await excel.sync('test');
  assert.deepEqual(db.prepare("SELECT role FROM account_roles r JOIN accounts a ON a.id = r.account_id WHERE a.user_id = 'AVX-STU002' ORDER BY role").all().map((x) => x.role), ['mentor', 'student']);
  const actions = db.prepare("SELECT action FROM auth_audit WHERE ip = 'accounts.xlsx'").all().map((x) => x.action);
  for (const a of ['account.create', 'account.disable', 'account.enable', 'account.roles', 'password.excel_set']) assert.ok(actions.includes(a), a);
});

test('if the file is open in Excel (locked), the new password is queued and written as soon as it is closed', async () => {
  const { renameSync } = await import('node:fs');
  const dir2 = mkdtempSync(join(tmpdir(), 'avgenx-xlsx-lock-'));
  const path2 = join(dir2, 'accounts.xlsx');
  await newWorkbook([{ userId: 'LOCK-1', name: 'Lock Tester', email: 'lock@example.com', roles: 'Student', status: 'Active', password: 'Lock-temp-pass-1' }]).xlsx.writeFile(path2);
  const db2 = openDb(join(dir2, 'l.db'));
  let locked = false;
  const lockErr = () => Object.assign(new Error('resource busy or locked'), { code: 'EBUSY' });
  const src = createExcelSource(db2, { path: path2, log: quiet, retryMs: 200, rename: (a, b) => { if (locked) throw lockErr(); renameSync(a, b); } });
  await src.sync('start');
  const id = db2.prepare("SELECT id FROM accounts WHERE user_id = 'LOCK-1'").get().id;
  db2.prepare('UPDATE accounts SET must_change_password = 0 WHERE id = ?').run(id);

  locked = true; // the file is now open in Excel
  assert.equal(await src.recordPassword('LOCK-1', 'Brand-new-choice-42'), 'queued');
  assert.equal(src.status().pending, 1);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(path2);
  assert.equal(wb.getWorksheet(SHEET).getRow(2).getCell(7).text, 'Lock-temp-pass-1', 'file not touched while locked');

  locked = false; // Excel closed
  for (let i = 0; i < 40 && src.status().pending; i++) await new Promise((r) => setTimeout(r, 100));
  assert.equal(src.status().pending, 0, 'written by the automatic retry');
  const wb2 = new ExcelJS.Workbook(); await wb2.xlsx.readFile(path2);
  assert.equal(wb2.getWorksheet(SHEET).getRow(2).getCell(7).text, 'Brand-new-choice-42');
  assert.equal(await src.recordPassword('LOCK-1', 'Second-choice-pass-77'), 'written');
  src.stop(); db2.close(); rmSync(dir2, { recursive: true, force: true });
});
