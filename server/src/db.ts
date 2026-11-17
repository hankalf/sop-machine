import Database from 'better-sqlite3';
import { config } from './config';

export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

const migrations: string[] = [
  // 1: initial schema
  `
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin','editor','viewer')),
    password_hash TEXT NOT NULL,
    disabled INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    last_login_at TEXT
  );

  CREATE TABLE templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    design TEXT NOT NULL,
    is_default INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    code TEXT NOT NULL,
    color TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    template_id TEXT REFERENCES templates(id) ON DELETE SET NULL,
    sort_order INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE sops (
    id TEXT PRIMARY KEY,
    number TEXT NOT NULL,
    title TEXT NOT NULL,
    category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
    template_id TEXT REFERENCES templates(id) ON DELETE SET NULL,
    status TEXT NOT NULL,
    version TEXT NOT NULL,
    owner TEXT NOT NULL DEFAULT '',
    approver TEXT NOT NULL DEFAULT '',
    effective_date TEXT,
    review_date TEXT,
    tags TEXT NOT NULL DEFAULT '[]',
    content TEXT NOT NULL,
    search_text TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'manual',
    published_revision_id TEXT,
    published_version TEXT,
    created_by TEXT,
    updated_by TEXT,
    approved_by TEXT,
    approved_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX sops_category ON sops(category_id);
  CREATE INDEX sops_updated ON sops(updated_at);

  CREATE TABLE revisions (
    id TEXT PRIMARY KEY,
    sop_id TEXT NOT NULL REFERENCES sops(id) ON DELETE CASCADE,
    version TEXT NOT NULL,
    summary TEXT NOT NULL,
    snapshot TEXT NOT NULL,
    created_by TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX revisions_sop ON revisions(sop_id, created_at);

  CREATE TABLE media (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    mime TEXT NOT NULL,
    ext TEXT NOT NULL,
    original_name TEXT NOT NULL,
    size INTEGER NOT NULL,
    width INTEGER,
    height INTEGER,
    duration REAL,
    parent_id TEXT,
    processing INTEGER NOT NULL DEFAULT 0,
    created_by TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE jobs (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    status TEXT NOT NULL,
    progress INTEGER NOT NULL DEFAULT 0,
    message TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL DEFAULT '',
    input TEXT NOT NULL,
    result_sop_id TEXT,
    error TEXT,
    created_by TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  `,
];

function migrate() {
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
  const row = db.prepare('SELECT version FROM schema_version').get() as { version: number } | undefined;
  let current = row?.version ?? 0;
  if (!row) db.prepare('INSERT INTO schema_version (version) VALUES (0)').run();
  while (current < migrations.length) {
    const sql = migrations[current];
    db.transaction(() => {
      db.exec(sql);
      db.prepare('UPDATE schema_version SET version = ?').run(current + 1);
    })();
    current += 1;
  }
}

migrate();

export function getMeta(key: string): string | null {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setMeta(key: string, value: string) {
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
    key,
    value,
  );
}
