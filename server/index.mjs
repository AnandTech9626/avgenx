// Start the AVGENX Academy server.
//   npm start            (after npm run build)
// Environment: see .env.example. Data is stored in DB_PATH (default data/avgenx.db).
import { spawn } from 'node:child_process';
import { openDb } from './db.mjs';
import { createApp } from './app.mjs';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createExcelSource } from './excel-accounts.mjs';

const env = process.env.NODE_ENV || 'development';
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
console.log(`AVGENX Academy server v${version}`);
const production = env === 'production';
const port = Number(process.env.PORT || 8080);
const host = process.env.HOST || (production ? '0.0.0.0' : '127.0.0.1');
const secureCookies = process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : production;
const db = openDb(process.env.DB_PATH || 'data/avgenx.db');

// Every start begins at the sign-in page: sessions from the previous run are ended.
// Set KEEP_SESSIONS=true to keep people signed in across restarts instead.
const keepSessions = process.env.KEEP_SESSIONS === 'true';
if (!keepSessions) {
  const ended = db.prepare('DELETE FROM sessions').run().changes;
  if (ended) { db.prepare('INSERT INTO auth_audit (at, action, detail, ip) VALUES (?,?,?,?)').run(new Date().toISOString(), 'sessions.restart', `${ended} session(s) ended because the server restarted`, 'server'); console.log(`Signed out ${ended} session(s) from the previous run; everyone signs in again.`); }
}

// Excel account list: when accounts.xlsx exists, only the people on it can sign in.
const xlsxPath = resolve(process.env.ACCOUNTS_XLSX || 'accounts.xlsx');
let excel = null;
if (existsSync(xlsxPath)) {
  excel = createExcelSource(db, { path: xlsxPath });
  await excel.sync('server start');
  excel.start();
  console.log(`Accounts come from ${xlsxPath}. Only people listed there as Active can sign in; saving the file applies changes.`);
} else {
  console.log(`No ${xlsxPath}: accounts are managed in the app (Administration, Accounts and Sign-in). Run "npm run accounts -- init-excel" to manage them in Excel instead.`);
}

if (production) {
  const problems = [];
  if (!secureCookies) problems.push('COOKIE_SECURE must not be false in production (serve over HTTPS).');
  const tests = db.prepare("SELECT user_id FROM accounts WHERE is_test = 1 AND status = 'active'").all();
  if (tests.length) problems.push(`Development test accounts are active (${tests.map((t) => t.user_id).join(', ')}). Remove them with "npm run accounts -- purge-test" before running in production.`);
  if (!db.prepare("SELECT 1 FROM accounts a JOIN account_roles r ON r.account_id = a.id WHERE r.role = 'superadmin' AND a.status = 'active'").get()) problems.push('No active super administrator. Create one with "npm run accounts -- create-admin".');
  if (problems.length) { console.error(`Refusing to start in production:\n- ${problems.join('\n- ')}`); process.exit(1); }
}

const server = createApp({ db, excel, rememberMe: keepSessions, env, secureCookies, trustProxy: process.env.TRUST_PROXY === 'true' });
server.listen(port, host, () => {
  const url = `http://${host === '0.0.0.0' || host === '::' ? 'localhost' : host}:${port}`;
  console.log(`AVGENX Academy (${env}) is running. Open ${url} in your browser (keep this window open; Ctrl+C stops it).`);
  if (!production) console.log('Development mode: password reset links are written to this console instead of being emailed.');
  if (!production && process.env.OPEN_BROWSER !== 'false') openBrowser(url);
});

/** Development convenience: open the default browser (set OPEN_BROWSER=false to skip). */
function openBrowser(url) {
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true, windowsHide: true });
    child.on('error', () => console.log(`Open ${url} in your browser.`));
    child.unref();
  } catch { console.log(`Open ${url} in your browser.`); }
}
const stop = () => { excel?.stop(); server.close(() => { db.close(); process.exit(0); }); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
