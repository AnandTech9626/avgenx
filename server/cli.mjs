// Account administration from the command line (local, trusted operator only).
//
//   npm run accounts -- seed-dev        create the development test accounts (refuses in production)
//   npm run accounts -- purge-test      delete every development test account
//   npm run accounts -- create-admin --name "Full Name" --email you@institute.example [--user-id ID]
//   npm run accounts -- list
//
// Temporary passwords are printed once to this terminal and never written to disk.
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { openDb } from './db.mjs';
import { existsSync } from 'node:fs';
import { resolve as resolveP } from 'node:path';
import { createAccount, publicAccount, audit, roleLabel, tempPassword } from './auth.mjs';
import { newWorkbook } from './excel-accounts.mjs';

export const DEV_ACCOUNTS = [
  { role: 'superadmin', name: 'Test Super Administrator', lmsRef: 'U-SA1' },
  { role: 'admin', name: 'Test Institute Administrator', lmsRef: 'U-ADM' },
  { role: 'instructor', name: 'Test Instructor', lmsRef: 'U-I03' },
  { role: 'mentor', name: 'Test Mentor', lmsRef: 'U-M05' },
  { role: 'placement', name: 'Test Placement Officer', lmsRef: 'U-PLC' },
  { role: 'student', name: 'Test Student One', lmsRef: 'S1001' },
  { role: 'student', name: 'Test Student Two', lmsRef: 'S1002' },
  { role: 'corporate', name: 'Test Corporate Client', lmsRef: 'U-CC1' },
];

/** Starter rows for init-excel: replace them with your real people. */
export const EXCEL_SAMPLE = [
  { userId: 'AVX-ADMIN', name: 'Institute Super Admin', email: 'superadmin@avgenx.example', roles: 'Super Administrator', lmsRef: 'U-SA1' },
  { userId: 'AVX-OPS', name: 'Institute Administrator', email: 'admin@avgenx.example', roles: 'Institute Administrator', lmsRef: 'U-ADM' },
  { userId: 'AVX-INS01', name: 'Instructor One', email: 'instructor1@avgenx.example', roles: 'Instructor', lmsRef: 'U-I03' },
  { userId: 'AVX-MEN01', name: 'Mentor One', email: 'mentor1@avgenx.example', roles: 'Mentor', lmsRef: 'U-M05' },
  { userId: 'AVX-PLC01', name: 'Placement Officer', email: 'placement@avgenx.example', roles: 'Placement Officer', lmsRef: 'U-PLC' },
  { userId: 'AVX-STU001', name: 'Student One', email: 'student1@avgenx.example', roles: 'Student', lmsRef: 'S1001' },
  { userId: 'AVX-STU002', name: 'Student Two', email: 'student2@avgenx.example', roles: 'Student', lmsRef: 'S1002' },
  { userId: 'AVX-CORP01', name: 'Corporate Client', email: 'client@avgenx.example', roles: 'Corporate Training Client', lmsRef: 'U-CC1' },
];

/** Creates the development accounts. Returns [{ userId, role, password }]. */
export async function seedDev(db) {
  const out = [];
  for (const [i, d] of DEV_ACCOUNTS.entries()) {
    const email = `test.${d.role}${d.role === 'student' ? i - 4 : ''}@dev.avgenx.invalid`; // .invalid can never receive mail
    const r = await createAccount(db, { actor: null, session: null, input: { name: d.name, email, roles: [d.role], lmsRef: d.lmsRef }, credential: 'temporary', ip: 'cli', isTest: true });
    out.push({ userId: r.account.userId, role: d.role, name: d.name, password: r.temporaryPassword });
  }
  return out;
}

function arg(name) { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : undefined; }

async function main() {
  const cmd = process.argv[2];
  const production = (process.env.NODE_ENV || 'development') === 'production';
  const db = openDb(process.env.DB_PATH || 'data/avgenx.db');
  if (cmd === 'seed-dev') {
    if (production) { console.error('Refusing: development test accounts are never created when NODE_ENV=production.'); process.exit(1); }
    const existing = db.prepare('SELECT COUNT(*) n FROM accounts WHERE is_test = 1').get().n;
    if (existing) { console.error(`There are already ${existing} development test accounts. Run "npm run accounts -- purge-test" first to create a fresh set.`); process.exit(1); }
    const rows = await seedDev(db);
    console.log('\nDevelopment test accounts created. These passwords are shown once and are not stored anywhere in plain text.');
    console.log('Each account must choose a new password at first sign-in. Never use these accounts in a public deployment.\n');
    console.table(rows.map((r) => ({ 'Sign in as': roleLabel(r.role), 'User ID': r.userId, 'Temporary password': r.password })));
  } else if (cmd === 'purge-test') {
    const rows = db.prepare('SELECT * FROM accounts WHERE is_test = 1').all();
    for (const a of rows) { db.prepare('DELETE FROM accounts WHERE id = ?').run(a.id); audit(db, { action: 'account.delete', target: a, detail: 'development test account purged from CLI', ip: 'cli' }); }
    console.log(`Removed ${rows.length} development test account(s).`);
  } else if (cmd === 'create-admin') {
    const name = arg('name'); const email = arg('email');
    if (!name || !email) { console.error('Usage: npm run accounts -- create-admin --name "Full Name" --email you@institute.example [--user-id ID]'); process.exit(1); }
    try {
      const r = await createAccount(db, { actor: null, session: null, input: { name, email, userId: arg('user-id'), roles: ['superadmin'] }, credential: 'temporary', ip: 'cli' });
      console.log(`\nSuper administrator created.\n  User ID: ${r.account.userId}\n  Temporary password (shown once): ${r.temporaryPassword}\nSign in with the role "Super Administrator"; you will be asked to choose a new password.\n`);
    } catch (e) { console.error(e.message, e.fields || ''); process.exit(1); }
  } else if (cmd === 'init-excel') {
    const path = resolveP(process.env.ACCOUNTS_XLSX || 'accounts.xlsx');
    if (existsSync(path) && !process.argv.includes('--force')) { console.error(`${path} already exists. Edit it, or pass --force to replace it.`); process.exit(1); }
    const sample = !process.argv.includes('--empty');
    const rows = sample ? EXCEL_SAMPLE.map((r) => ({ ...r, status: 'Active', password: tempPassword() })) : [];
    await newWorkbook(rows).xlsx.writeFile(path);
    console.log(`\nCreated ${path}${sample ? ` with ${rows.length} starter accounts and temporary passwords` : ''}.`);
    console.log('Start the server (npm start). Only people listed in this file as Active can sign in.');
    console.log('Each temporary password must be changed at first sign-in, and the server then clears it from the file.\n');
  } else if (cmd === 'backup') {
    // Consistent copy of the database (safe while the server runs) plus accounts.xlsx.
    const { mkdirSync, copyFileSync } = await import('node:fs');
    const outDir = resolveP(arg('dir') || 'backups');
    mkdirSync(outDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const dbOut = resolveP(outDir, `avgenx-${stamp}.db`);
    db.exec(`VACUUM INTO '${dbOut.replace(/'/g, "''")}'`);
    const xlsx = resolveP(process.env.ACCOUNTS_XLSX || 'accounts.xlsx');
    if (existsSync(xlsx)) copyFileSync(xlsx, resolveP(outDir, `accounts-${stamp}.xlsx`));
    console.log(`Backup written to ${outDir} (avgenx-${stamp}.db${existsSync(xlsx) ? ` and accounts-${stamp}.xlsx` : ''}).`);
  } else if (cmd === 'list') {
    console.table(db.prepare('SELECT * FROM accounts ORDER BY created_at').all().map((a) => publicAccount(db, a)).map((a) => ({ 'User ID': a.userId, Name: a.name, Roles: a.roles.join(','), Status: a.status, Test: a.isTest ? 'yes' : '' })));
  } else {
    console.log('Commands: init-excel, seed-dev, purge-test, create-admin, backup, list');
  }
  db.close();
}

// Run only when executed directly (works with Windows paths too), not when imported by tests.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
