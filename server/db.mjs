// Persistent account store (SQLite through Node's built-in node:sqlite).
// This is the authoritative record of who can sign in and with which roles. The browser never
// holds roles, passwords or tokens; it only receives an HttpOnly session cookie.
//
// SQLite keeps the deployment to one process and one file. For multi-instance hosting, move these
// tables to PostgreSQL (db/migrations/0002_auth.sql has the same schema).
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const { DatabaseSync } = await import('node:sqlite');

const MIGRATIONS = [
  `CREATE TABLE accounts (
     id            TEXT PRIMARY KEY,                 -- internal id
     user_id       TEXT NOT NULL UNIQUE COLLATE NOCASE,
     email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
     name          TEXT NOT NULL,
     password_hash TEXT,                             -- argon2id; NULL until an invitation is accepted
     status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
     must_change_password INTEGER NOT NULL DEFAULT 1,
     lms_ref       TEXT,                             -- linked LMS profile (sample data) for this account
     is_test       INTEGER NOT NULL DEFAULT 0,       -- created by the local development seed
     created_at    TEXT NOT NULL,
     created_by    TEXT,
     updated_at    TEXT NOT NULL,
     last_login_at TEXT,
     password_changed_at TEXT
   )`,
  `CREATE TABLE account_roles (
     account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
     role       TEXT NOT NULL,
     granted_by TEXT,
     granted_at TEXT NOT NULL,
     PRIMARY KEY (account_id, role)
   )`,
  `CREATE TABLE sessions (
     token_hash  TEXT PRIMARY KEY,                    -- sha256 of the cookie value; the raw token is never stored
     account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
     role        TEXT NOT NULL,                       -- the role chosen and verified at sign-in
     csrf        TEXT NOT NULL,
     restricted  INTEGER NOT NULL DEFAULT 0,          -- 1 = may only change password or sign out
     remember    INTEGER NOT NULL DEFAULT 0,
     created_at  TEXT NOT NULL,
     last_seen_at TEXT NOT NULL,
     expires_at  TEXT NOT NULL,
     ip          TEXT,
     user_agent  TEXT
   )`,
  `CREATE INDEX sessions_account ON sessions(account_id)`,
  `CREATE TABLE login_attempts (
     key TEXT NOT NULL,                               -- 'id:<identifier>' or 'ip:<address>'
     at  INTEGER NOT NULL
   )`,
  `CREATE INDEX login_attempts_key ON login_attempts(key, at)`,
  `CREATE TABLE password_tokens (
     token_hash TEXT PRIMARY KEY,
     account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
     purpose    TEXT NOT NULL CHECK (purpose IN ('reset','invite')),
     created_at TEXT NOT NULL,
     expires_at TEXT NOT NULL,
     used_at    TEXT,
     created_by TEXT
   )`,
  `CREATE TABLE auth_audit (
     id         INTEGER PRIMARY KEY AUTOINCREMENT,
     at         TEXT NOT NULL,
     actor_id   TEXT,                                 -- account id of who did it (NULL for anonymous)
     actor_user TEXT,
     action     TEXT NOT NULL,
     target_id  TEXT,
     target_user TEXT,
     detail     TEXT,
     ip         TEXT
   )`,
  `CREATE TRIGGER auth_audit_no_update BEFORE UPDATE ON auth_audit BEGIN SELECT RAISE(ABORT, 'auth_audit is append-only'); END`,
  `CREATE TRIGGER auth_audit_no_delete BEFORE DELETE ON auth_audit BEGIN SELECT RAISE(ABORT, 'auth_audit is append-only'); END`,
  // Excel account list: hash of the temporary password last applied from the file, so a value left
  // in the file is applied once (never re-applied after the person chooses their own password).
  `ALTER TABLE accounts ADD COLUMN seed_pw_hash TEXT`,
  // Passwords waiting to be written into accounts.xlsx (for example while the file is open in
  // Excel). Kept until written so the file never shows an out-of-date password. Same sensitivity
  // as the file itself, by the institute's choice to keep passwords in the file.
  `CREATE TABLE excel_pending_passwords (user_id TEXT PRIMARY KEY COLLATE NOCASE, password TEXT NOT NULL, at TEXT NOT NULL)`,
];

export function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (v INTEGER NOT NULL)');
  const row = db.prepare('SELECT v FROM schema_version').get();
  let v = row ? row.v : 0;
  if (!row) db.prepare('INSERT INTO schema_version (v) VALUES (0)').run();
  if (v < MIGRATIONS.length) {
    db.exec('BEGIN');
    try {
      for (; v < MIGRATIONS.length; v++) db.exec(MIGRATIONS[v]);
      db.prepare('UPDATE schema_version SET v = ?').run(v);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }
  return db;
}

/** Run fn inside a transaction; rolls back on throw. */
export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}
