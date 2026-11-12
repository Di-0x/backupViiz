import { createRequire } from 'node:module';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const path = process.env.DATABASE_PATH ?? './data/backupviiz.db';
if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });

// require() évite que le bundler retire le préfixe `node:` (sqlite n'est reconnu que préfixé).
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
export const db: DatabaseSyncType = new DatabaseSync(path);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT,                       -- scrypt, NULL si compte passkey-only
  webauthn_user_id TEXT NOT NULL,           -- base64url, handle WebAuthn
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id_hash TEXT PRIMARY KEY,                 -- sha256 du token cookie
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,              -- epoch ms
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS passkeys (
  id TEXT PRIMARY KEY,                      -- credentialID base64url
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_key BLOB NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT,                          -- JSON array
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT
);
CREATE TABLE IF NOT EXISTS webauthn_challenges (
  id TEXT PRIMARY KEY,                      -- random, renvoyé en cookie httpOnly court
  challenge TEXT NOT NULL,
  user_id TEXT,
  purpose TEXT NOT NULL,                    -- 'register' | 'login'
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS strategies (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  doc TEXT NOT NULL,                        -- JSON StrategyDoc
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_strategies_user ON strategies(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_exp ON sessions(expires_at);
`);
