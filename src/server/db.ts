import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type Db = DatabaseSync;

const schema = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS countries (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  seed INTEGER NOT NULL,
  world_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS countries_owner_idx ON countries(user_id);

CREATE TABLE IF NOT EXISTS country_members (
  country_id TEXT NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('OWNER', 'MEMBER')),
  invited_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (country_id, user_id)
);

CREATE INDEX IF NOT EXISTS country_members_user_idx ON country_members(user_id, country_id);

CREATE TABLE IF NOT EXISTS mcp_tokens (
  id TEXT PRIMARY KEY,
  country_id TEXT NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  token_prefix TEXT NOT NULL,
  scopes_json TEXT NOT NULL,
  expires_at TEXT,
  last_used_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  country_id TEXT NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  city_q INTEGER NOT NULL,
  city_r INTEGER NOT NULL,
  boundary_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sprints (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  goal TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'PLANNED',
  capacity_sp INTEGER NOT NULL DEFAULT 14,
  district_json TEXT NOT NULL,
  color TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS one_active_sprint_per_project
  ON sprints(project_id) WHERE status = 'ACTIVE';

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sprint_id TEXT NOT NULL REFERENCES sprints(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  estimate INTEGER NOT NULL,
  priority TEXT NOT NULL DEFAULT 'NORMAL',
  status TEXT NOT NULL DEFAULT 'PLANNING',
  progress INTEGER NOT NULL DEFAULT 0,
  due_at TEXT,
  building_type TEXT NOT NULL,
  platform_type TEXT NOT NULL,
  origin_q INTEGER NOT NULL,
  origin_r INTEGER NOT NULL,
  footprint_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS task_comments (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS roads (
  country_id TEXT NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
  q INTEGER NOT NULL,
  r INTEGER NOT NULL,
  mask INTEGER NOT NULL DEFAULT 0,
  structure TEXT NOT NULL DEFAULT 'ROAD',
  PRIMARY KEY (country_id, q, r)
);

CREATE TABLE IF NOT EXISTS idempotency (
  country_id TEXT NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
  operation TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (country_id, operation, idempotency_key)
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  country_id TEXT NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  world_version INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS projects_country_idx ON projects(country_id);
CREATE INDEX IF NOT EXISTS sprints_project_idx ON sprints(project_id);
CREATE INDEX IF NOT EXISTS tasks_sprint_idx ON tasks(sprint_id);
CREATE INDEX IF NOT EXISTS events_country_idx ON events(country_id, id);

-- Square-world V3 tables are additive. Legacy hex tables remain untouched so
-- local data can be inspected or exported instead of being destructively
-- reinterpreted as square coordinates.
CREATE TABLE IF NOT EXISTS cities_v3 (
  id TEXT PRIMARY KEY,
  country_id TEXT NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  center_x INTEGER NOT NULL,
  center_y INTEGER NOT NULL,
  bounds_json TEXT NOT NULL,
  style_id TEXT NOT NULL,
  morphology TEXT NOT NULL DEFAULT 'BALANCED',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS districts_v3 (
  id TEXT PRIMARY KEY,
  city_id TEXT NOT NULL REFERENCES cities_v3(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  goal TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'PLANNED',
  capacity_sp INTEGER NOT NULL DEFAULT 14,
  cells_json TEXT NOT NULL,
  lots_json TEXT NOT NULL,
  growth_direction TEXT NOT NULL,
  archetype TEXT NOT NULL DEFAULT 'MIXED_URBAN',
  color TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS one_active_district_per_city_v3
  ON districts_v3(city_id) WHERE status = 'ACTIVE';

CREATE TABLE IF NOT EXISTS tasks_v3 (
  id TEXT PRIMARY KEY,
  city_id TEXT NOT NULL REFERENCES cities_v3(id) ON DELETE CASCADE,
  district_id TEXT NOT NULL REFERENCES districts_v3(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  estimate INTEGER NOT NULL,
  priority TEXT NOT NULL DEFAULT 'NORMAL',
  status TEXT NOT NULL DEFAULT 'PLANNING',
  progress INTEGER NOT NULL DEFAULT 0,
  due_at TEXT,
  building_type TEXT NOT NULL,
  platform_type TEXT NOT NULL,
  origin_x INTEGER NOT NULL,
  origin_y INTEGER NOT NULL,
  footprint_json TEXT NOT NULL,
  entrance_x INTEGER,
  entrance_y INTEGER,
  access_json TEXT NOT NULL DEFAULT '[]',
  access_kind TEXT NOT NULL DEFAULT 'PATH',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS task_comments_v3 (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks_v3(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS task_events_v7 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL REFERENCES tasks_v3(id) ON DELETE CASCADE,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  actor_label TEXT NOT NULL,
  event_type TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS task_events_v7_task_idx ON task_events_v7(task_id, id);

CREATE TABLE IF NOT EXISTS roads_v3 (
  country_id TEXT NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  mask INTEGER NOT NULL DEFAULT 0,
  structure TEXT NOT NULL DEFAULT 'ROAD',
  road_class TEXT NOT NULL DEFAULT 'LOCAL',
  PRIMARY KEY (country_id, x, y)
);

CREATE TABLE IF NOT EXISTS world_features_v6 (
  id TEXT PRIMARY KEY,
  country_id TEXT NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
  city_id TEXT REFERENCES cities_v3(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  asset_kind TEXT NOT NULL,
  asset_key TEXT NOT NULL,
  origin_x INTEGER NOT NULL,
  origin_y INTEGER NOT NULL,
  footprint_json TEXT NOT NULL,
  orientation TEXT NOT NULL,
  access_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS cities_v3_country_idx ON cities_v3(country_id);
CREATE INDEX IF NOT EXISTS districts_v3_city_idx ON districts_v3(city_id);
CREATE INDEX IF NOT EXISTS tasks_v3_district_idx ON tasks_v3(district_id);
CREATE INDEX IF NOT EXISTS roads_v3_country_position_idx ON roads_v3(country_id, x, y);
CREATE INDEX IF NOT EXISTS world_features_v6_country_position_idx ON world_features_v6(country_id, origin_x, origin_y);
`;

function ensureColumn(db: Db, table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((item) => item.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function ensureMultiCountryOwners(db: Db): void {
  const indexes = db.prepare("PRAGMA index_list(countries)").all() as Array<{ name: string; unique: number; origin: string }>;
  const hasLegacyOwnerConstraint = indexes.some((index) => index.unique === 1 && index.origin === "u");
  if (!hasLegacyOwnerConstraint) return;
  db.exec(`
    PRAGMA foreign_keys = OFF;
    BEGIN IMMEDIATE;
    CREATE TABLE countries_multi_v7 (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      seed INTEGER NOT NULL,
      world_version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
    INSERT INTO countries_multi_v7 (id, user_id, name, seed, world_version, created_at)
      SELECT id, user_id, name, seed, world_version, created_at FROM countries;
    DROP TABLE countries;
    ALTER TABLE countries_multi_v7 RENAME TO countries;
    CREATE INDEX countries_owner_idx ON countries(user_id);
    COMMIT;
    PRAGMA foreign_keys = ON;
  `);
  const violations = db.prepare("PRAGMA foreign_key_check").all();
  if (violations.length > 0) throw new Error("Multi-country migration failed foreign-key validation");
}

export function createDb(path: string): Db {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(schema);
  ensureMultiCountryOwners(db);
  // Local MVP databases predate V6. These additive migrations preserve tasks
  // and comments while allowing the world geometry to be regenerated safely.
  ensureColumn(db, "cities_v3", "morphology", "TEXT NOT NULL DEFAULT 'BALANCED'");
  ensureColumn(db, "districts_v3", "archetype", "TEXT NOT NULL DEFAULT 'MIXED_URBAN'");
  ensureColumn(db, "tasks_v3", "entrance_x", "INTEGER");
  ensureColumn(db, "tasks_v3", "entrance_y", "INTEGER");
  ensureColumn(db, "tasks_v3", "access_json", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, "tasks_v3", "access_kind", "TEXT NOT NULL DEFAULT 'PATH'");
  ensureColumn(db, "users", "active_country_id", "TEXT");
  ensureColumn(db, "tasks_v3", "creator_user_id", "TEXT");
  ensureColumn(db, "tasks_v3", "assignee_user_id", "TEXT");
  ensureColumn(db, "mcp_tokens", "user_id", "TEXT");
  db.exec(`
    INSERT OR IGNORE INTO country_members (country_id, user_id, role, invited_by_user_id, created_at)
      SELECT id, user_id, 'OWNER', user_id, created_at FROM countries;
    UPDATE users SET active_country_id = (
      SELECT cm.country_id FROM country_members cm
      WHERE cm.user_id = users.id
      ORDER BY CASE cm.role WHEN 'OWNER' THEN 0 ELSE 1 END, cm.created_at
      LIMIT 1
    ) WHERE active_country_id IS NULL;
    UPDATE mcp_tokens SET user_id = (
      SELECT c.user_id FROM countries c WHERE c.id = mcp_tokens.country_id
    ) WHERE user_id IS NULL;
    INSERT INTO task_events_v7 (task_id, actor_user_id, actor_label, event_type, details_json, created_at)
      SELECT t.id, t.creator_user_id, COALESCE(u.name, 'Система страны'), 'CREATED', '{}', t.created_at
      FROM tasks_v3 t
      LEFT JOIN users u ON u.id = t.creator_user_id
      WHERE NOT EXISTS (
        SELECT 1 FROM task_events_v7 event WHERE event.task_id = t.id AND event.event_type = 'CREATED'
      );
  `);
  return db;
}

export function transaction<T>(db: Db, callback: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = callback();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function now(): string {
  return new Date().toISOString();
}
