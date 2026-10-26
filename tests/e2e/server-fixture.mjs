// Test fixture, run as a child process by auth.spec.mjs: opens a throwaway database, seeds the
// development accounts, starts the real server on a free port, and prints one JSON line
// { port, accounts } on stdout. Never used outside tests.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../server/db.mjs';
import { createApp } from '../../server/app.mjs';
import { seedDev } from '../../server/cli.mjs';

const dir = mkdtempSync(join(tmpdir(), 'avgenx-e2e-'));
const db = openDb(join(dir, 'e2e.db'));
const accounts = await seedDev(db);
const server = createApp({ db, distDir: 'dist', log: { error: (...a) => console.error(...a), log() {} } }).listen(0, '127.0.0.1', () => {
  process.stdout.write(`${JSON.stringify({ port: server.address().port, accounts })}\n`);
});
const stop = () => server.close(() => { db.close(); rmSync(dir, { recursive: true, force: true }); process.exit(0); });
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
process.stdin.on('end', stop); // parent went away
process.stdin.resume();
