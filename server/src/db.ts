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
  // 2: training sign-off, stations, translations, checklists, notifications, object storage
  `
  ALTER TABLE users ADD COLUMN language TEXT NOT NULL DEFAULT 'en';
  ALTER TABLE sops ADD COLUMN owner_user_id TEXT;
  ALTER TABLE media ADD COLUMN storage TEXT NOT NULL DEFAULT 'local';
  ALTER TABLE jobs ADD COLUMN result_file TEXT;

  CREATE TABLE acknowledgments (
    id TEXT PRIMARY KEY,
    sop_id TEXT NOT NULL REFERENCES sops(id) ON DELETE CASCADE,
    revision_id TEXT,
    version TEXT NOT NULL,
    user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    person_key TEXT NOT NULL,
    person_name TEXT NOT NULL,
    employee_id TEXT NOT NULL DEFAULT '',
    method TEXT NOT NULL,
    recorded_by TEXT,
    station_id TEXT,
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
  CREATE INDEX ack_sop ON acknowledgments(sop_id, version);
  CREATE INDEX ack_person ON acknowledgments(person_key);

  CREATE TABLE stations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    area TEXT NOT NULL DEFAULT '',
    token TEXT NOT NULL UNIQUE,
    sop_ids TEXT NOT NULL DEFAULT '[]',
    public_access INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE translations (
    id TEXT PRIMARY KEY,
    sop_id TEXT NOT NULL REFERENCES sops(id) ON DELETE CASCADE,
    language TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    strings TEXT NOT NULL DEFAULT '{}',
    source_hash TEXT NOT NULL,
    source_version TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'machine',
    updated_by TEXT,
    updated_at TEXT NOT NULL,
    UNIQUE (sop_id, language, source_hash)
  );
  CREATE INDEX translations_sop ON translations(sop_id, language, updated_at);

  CREATE TABLE checklist_runs (
    id TEXT PRIMARY KEY,
    token TEXT NOT NULL UNIQUE,
    sop_id TEXT NOT NULL REFERENCES sops(id) ON DELETE CASCADE,
    version TEXT NOT NULL,
    station_id TEXT,
    user_id TEXT,
    performer_name TEXT NOT NULL,
    employee_id TEXT NOT NULL DEFAULT '',
    language TEXT NOT NULL DEFAULT 'en',
    fields TEXT NOT NULL DEFAULT '{}',
    results TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'in_progress',
    fail_count INTEGER NOT NULL DEFAULT 0,
    signature TEXT NOT NULL DEFAULT '',
    snapshot TEXT NOT NULL,
    started_at TEXT NOT NULL,
    completed_at TEXT
  );
  CREATE INDEX runs_sop ON checklist_runs(sop_id, started_at);

  CREATE TABLE notifications (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    dedupe_key TEXT NOT NULL UNIQUE,
    sop_id TEXT,
    recipients TEXT NOT NULL,
    subject TEXT NOT NULL,
    status TEXT NOT NULL,
    error TEXT,
    created_at TEXT NOT NULL
  );
  `,
  // 3: corrective actions, quizzes, scheduled checklists, teams/roster, view tracking
  `
  ALTER TABLE users ADD COLUMN team_id TEXT;
  ALTER TABLE stations ADD COLUMN supervisor_user_id TEXT;
  ALTER TABLE checklist_runs ADD COLUMN last_activity_at TEXT;

  CREATE TABLE teams (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category_ids TEXT NOT NULL DEFAULT '[]',
    sop_ids TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL
  );

  CREATE TABLE people (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    employee_id TEXT NOT NULL DEFAULT '',
    team_id TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );

  CREATE TABLE actions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'open',
    priority TEXT NOT NULL DEFAULT 'normal',
    sop_id TEXT,
    station_id TEXT,
    run_id TEXT,
    step_id TEXT,
    reported_by TEXT NOT NULL DEFAULT '',
    media_ids TEXT NOT NULL DEFAULT '[]',
    assignee_id TEXT,
    due_date TEXT,
    resolution TEXT NOT NULL DEFAULT '',
    resolved_by TEXT,
    resolved_at TEXT,
    created_by TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX actions_run_step ON actions(run_id, step_id) WHERE run_id IS NOT NULL;
  CREATE INDEX actions_status ON actions(status, due_date);

  CREATE TABLE schedules (
    id TEXT PRIMARY KEY,
    sop_id TEXT NOT NULL REFERENCES sops(id) ON DELETE CASCADE,
    station_ids TEXT NOT NULL DEFAULT '[]',
    frequency TEXT NOT NULL,
    days TEXT NOT NULL DEFAULT '[1,2,3,4,5]',
    shift_ids TEXT NOT NULL DEFAULT '[]',
    active INTEGER NOT NULL DEFAULT 1,
    created_by TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE sop_views (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sop_id TEXT NOT NULL,
    viewer_key TEXT NOT NULL,
    floor INTEGER NOT NULL DEFAULT 0,
    station_id TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX views_sop ON sop_views(sop_id, created_at);

  CREATE TABLE quiz_attempts (
    id TEXT PRIMARY KEY,
    sop_id TEXT NOT NULL,
    version TEXT NOT NULL,
    person_key TEXT NOT NULL,
    correct INTEGER NOT NULL,
    total INTEGER NOT NULL,
    passed INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX quiz_sop ON quiz_attempts(sop_id, created_at);
  `,
  // 4: editable markup on images
  `
  ALTER TABLE media ADD COLUMN markup TEXT;
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
