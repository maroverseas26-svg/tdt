-- Todaytec CRM — auth store (Cloudflare D1 "tdt")
-- Accounts and password hashes live here, never in Supabase or the frontend bundle.

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,               -- app user id, e.g. "u-hoang" / "u-<ms>"
  email         TEXT NOT NULL,                  -- lower-cased, used for login lookup
  active        INTEGER NOT NULL DEFAULT 1,
  deleted       INTEGER NOT NULL DEFAULT 0,     -- soft-delete tombstone (app keeps _deleted:true)
  profile       TEXT NOT NULL DEFAULT '{}',     -- the app's user record as JSON (never contains a password)
  pw_hash       TEXT,                           -- pbkdf2-sha256$<iterations>$<salt b64>$<hash b64>
  pw_updated_at TEXT,
  updated_at    TEXT NOT NULL
);
-- Not UNIQUE: legacy data has duplicate emails; login picks the newest active account.
CREATE INDEX IF NOT EXISTS users_email ON users (email);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,                  -- sha256 of the cookie value
  user_id    TEXT NOT NULL,
  expires_at INTEGER NOT NULL,                  -- unix seconds
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id);

CREATE TABLE IF NOT EXISTS password_resets (
  token_hash TEXT PRIMARY KEY,                  -- sha256 of the emailed token
  user_id    TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used       INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS login_failures (
  email TEXT NOT NULL,
  ts    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS login_failures_email ON login_failures (email, ts);
