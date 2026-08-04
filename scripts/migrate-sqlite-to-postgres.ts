import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { createDb, transaction, type Db } from "../src/server/db";

const TABLES = [
  "users", "countries", "country_members", "sessions", "mcp_tokens",
  "projects", "sprints", "tasks", "task_comments", "roads", "idempotency", "events",
  "cities_v3", "districts_v3", "tasks_v3", "task_comments_v3", "task_events_v7",
  "roads_v3", "world_features_v6",
] as const;

const JSON_COLUMNS = new Set([
  "scopes_json", "boundary_json", "district_json", "footprint_json", "response_json", "payload_json",
  "bounds_json", "cells_json", "lots_json", "access_json", "details_json",
]);

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const sourcePath = argument("--source");
const databaseUrl = argument("--database-url") ?? process.env.DATABASE_URL;
const dryRun = process.argv.includes("--dry-run");
const batchSize = Math.max(1, Math.min(5_000, Number(argument("--batch-size") ?? 500)));
if (!sourcePath || !databaseUrl) {
  throw new Error("Usage: npm run db:import-sqlite -- --source ./data/tasktopia.db --database-url postgres://... [--dry-run]");
}

const source = new DatabaseSync(resolve(sourcePath), { readOnly: true });
const target = await createDb(databaseUrl);

function sourceTableExists(table: string): boolean {
  return Boolean(source.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));
}

function sourceColumns(table: string): string[] {
  return (source.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>).map((column) => column.name);
}

async function targetColumns(db: Db, table: string): Promise<string[]> {
  const rows = await db.prepare(`SELECT column_name FROM information_schema.columns
    WHERE table_schema=current_schema() AND table_name=? ORDER BY ordinal_position`).all<{ column_name: string }>(table);
  return rows.map((row) => row.column_name);
}

function value(column: string, input: unknown): unknown {
  if (!JSON_COLUMNS.has(column) || typeof input !== "string") return input;
  try { return JSON.parse(input) as unknown; }
  catch { throw new Error(`Invalid JSON in ${column}`); }
}

try {
  const manifest: Array<{ table: string; columns: string[]; count: number }> = [];
  for (const table of TABLES) {
    if (!sourceTableExists(table)) continue;
    const targetSet = new Set(await targetColumns(target, table));
    const columns = sourceColumns(table).filter((column) => targetSet.has(column));
    const count = Number((source.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get() as { count: number }).count);
    manifest.push({ table, columns, count });
  }

  const nonEmpty: string[] = [];
  for (const item of manifest) {
    if (Number((await target.prepare(`SELECT COUNT(*) AS count FROM "${item.table}"`).get<{ count: number }>())?.count) > 0) nonEmpty.push(item.table);
  }
  if (nonEmpty.length > 0) throw new Error(`Target PostgreSQL database is not empty: ${nonEmpty.join(", ")}`);

  if (!dryRun) {
    await transaction(target, async () => {
      for (const item of manifest) {
        if (item.count === 0 || item.columns.length === 0) continue;
        const placeholders = item.columns.map(() => "?").join(",");
        const insert = target.prepare(`INSERT INTO "${item.table}" (${item.columns.map((column) => `"${column}"`).join(",")}) VALUES (${placeholders})`);
        for (let offset = 0; offset < item.count; offset += batchSize) {
          const rows = source.prepare(`SELECT ${item.columns.map((column) => `"${column}"`).join(",")} FROM "${item.table}" LIMIT ? OFFSET ?`).all(batchSize, offset) as Array<Record<string, unknown>>;
          for (const row of rows) await insert.run(...item.columns.map((column) => value(column, row[column])));
        }
      }
      for (const item of manifest) {
        const actual = Number((await target.prepare(`SELECT COUNT(*) AS count FROM "${item.table}"`).get<{ count: number }>())?.count);
        if (actual !== item.count) throw new Error(`Count mismatch for ${item.table}: SQLite=${item.count}, PostgreSQL=${actual}`);
      }
      // Older SQLite revisions may not yet contain the additive identity and
      // history backfills. Recreate them only after strict source-row checks.
      await target.exec(`INSERT INTO country_members (country_id,user_id,role,invited_by_user_id,created_at)
          SELECT id,user_id,'OWNER',user_id,created_at FROM countries ON CONFLICT DO NOTHING;
        UPDATE users SET active_country_id=(SELECT cm.country_id FROM country_members cm WHERE cm.user_id=users.id
          ORDER BY CASE cm.role WHEN 'OWNER' THEN 0 ELSE 1 END,cm.created_at LIMIT 1) WHERE active_country_id IS NULL;
        UPDATE mcp_tokens SET user_id=(SELECT c.user_id FROM countries c WHERE c.id=mcp_tokens.country_id) WHERE user_id IS NULL;
        INSERT INTO task_events_v7 (task_id,actor_user_id,actor_label,event_type,details_json,created_at)
          SELECT t.id,t.creator_user_id,COALESCE(u.name,'Система страны'),'CREATED','{}'::jsonb,t.created_at
          FROM tasks_v3 t LEFT JOIN users u ON u.id=t.creator_user_id
          WHERE NOT EXISTS (SELECT 1 FROM task_events_v7 e WHERE e.task_id=t.id AND e.event_type='CREATED');
        SELECT setval(pg_get_serial_sequence('events','id'), COALESCE((SELECT MAX(id) FROM events),1), EXISTS(SELECT 1 FROM events));
        SELECT setval(pg_get_serial_sequence('task_events_v7','id'), COALESCE((SELECT MAX(id) FROM task_events_v7),1), EXISTS(SELECT 1 FROM task_events_v7));
        SET CONSTRAINTS ALL IMMEDIATE;`);
    });
  }

  console.log(JSON.stringify({ dryRun, source: resolve(sourcePath), tables: manifest.map(({ table, count }) => ({ table, count })) }, null, 2));
} finally {
  source.close();
  await target.close();
}
