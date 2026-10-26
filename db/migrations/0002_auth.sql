-- AVGENX Academy: server-verified sign-in (PostgreSQL port of server/db.mjs).
-- The running server uses SQLite (one process, one file). Apply this when moving the account
-- store to PostgreSQL for multi-instance hosting; the columns map one to one.

BEGIN;

ALTER TABLE users
  ADD COLUMN password_hash        text,                          -- argon2id; NULL until an invitation is accepted
  ADD COLUMN must_change_password boolean NOT NULL DEFAULT true,
  ADD COLUMN lms_ref              text,                          -- linked learning profile
  ADD COLUMN is_test              boolean NOT NULL DEFAULT false,-- development seed; never allowed in production
  ADD COLUMN created_by           text REFERENCES users(id),
  ADD COLUMN password_changed_at  timestamptz,
  ADD COLUMN last_login_at        timestamptz;

-- An account may hold several roles; sign-in picks one, which must be listed here.
CREATE TABLE user_roles (
  user_id    text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       role_id NOT NULL,
  granted_by text REFERENCES users(id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role)
);

-- Sessions: the cookie holds a random token; only its SHA-256 is stored.
ALTER TABLE sessions
  ADD COLUMN token_hash   text UNIQUE,
  ADD COLUMN role         role_id,
  ADD COLUMN csrf         text,
  ADD COLUMN restricted   boolean NOT NULL DEFAULT false,         -- must change password first
  ADD COLUMN remember     boolean NOT NULL DEFAULT false,
  ADD COLUMN last_seen_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX sessions_user ON sessions (user_id);

CREATE TABLE login_attempts (
  key text NOT NULL,                                               -- 'id:<identifier>' or 'ip:<address>'
  at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX login_attempts_key ON login_attempts (key, at);

CREATE TABLE password_tokens (                                     -- reset and invitation links
  token_hash text PRIMARY KEY,                                     -- SHA-256 of the emailed token
  user_id    text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose    text NOT NULL CHECK (purpose IN ('reset','invite')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,                                          -- single use
  created_by text REFERENCES users(id)
);

-- Sign-in and account events go to audit_log (append-only, from 0001) with kind = 'security'.

COMMIT;
