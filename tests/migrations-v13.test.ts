import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createTestDb, transaction, type Db } from "../src/server/db";
import { registerUser } from "../src/server/auth";

describe("PostgreSQL migrations", () => {
  let db: Db;

  beforeEach(async () => { db = await createTestDb(); });
  afterEach(async () => { await db.close(); });

  it("records immutable migration checksums", async () => {
    const rows = await db.prepare("SELECT name, checksum FROM schema_migrations ORDER BY name").all<{ name: string; checksum: string }>();
    expect(rows.map((row) => row.name)).toEqual(["0001_initial.sql", "0002_backfill_spatial.sql", "0003_feature_ownership.sql", "0004_ai_work_model.sql"]);
    expect(rows.every((row) => /^[a-f0-9]{64}$/.test(row.checksum))).toBe(true);
  });

  it("adds AI planning fields and cascading task defects with safe defaults", async () => {
    const columns = await db.prepare(`SELECT column_name FROM information_schema.columns
      WHERE table_name IN ('countries','cities_v3','districts_v3','tasks_v3')`).all<{ column_name: string }>();
    const names = new Set(columns.map((column) => column.column_name));
    for (const name of ["product_context", "acceptance_criteria", "deadline", "work_item_type", "system_analysis", "implementation_plan"]) {
      expect(names.has(name), name).toBe(true);
    }
    expect(await db.prepare("SELECT to_regclass('task_defects_v18') AS table_name").get()).toMatchObject({ table_name: "task_defects_v18" });
  });

  it("maintains chunk membership through JSONB triggers", async () => {
    const registered = await registerUser(db, { email: "migration@tasktopia.local", name: "Migration", password: "migration-password" });
    const countryId = registered.user.countryId;
    const cityId = randomUUID();
    const districtId = randomUUID();
    const taskId = randomUUID();
    const timestamp = new Date().toISOString();
    await db.prepare(`INSERT INTO cities_v3
      (id,country_id,name,status,center_x,center_y,bounds_json,style_id,created_at)
      VALUES (?,?,'Migration city','ACTIVE',0,0,?::jsonb,'test',?)`)
      .run(cityId, countryId, JSON.stringify({ minX: -128, minY: -128, maxX: 255, maxY: 255 }), timestamp);
    await db.prepare(`INSERT INTO districts_v3
      (id,city_id,name,status,cells_json,lots_json,growth_direction,color,created_at)
      VALUES (?,?,'Migration district','ACTIVE',?::jsonb,'[]'::jsonb,'E','#fff',?)`)
      .run(districtId, cityId, JSON.stringify([{ x: -65, y: -1 }]), timestamp);
    await db.prepare(`INSERT INTO tasks_v3
      (id,city_id,district_id,title,estimate,building_type,platform_type,origin_x,origin_y,footprint_json,access_json,created_at,updated_at)
      VALUES (?,?,?,'Migration task',1,'house-small','GRASS',-65,-1,?::jsonb,?::jsonb,?,?)`)
      .run(taskId, cityId, districtId, JSON.stringify([{ x: -65, y: -1 }]), JSON.stringify([{ x: -1, y: -1 }]), timestamp, timestamp);

    const memberships = () => db.prepare(`SELECT chunk_x, chunk_y FROM world_chunk_entities_v11
      WHERE entity_kind='TASK' AND entity_id=? ORDER BY chunk_x,chunk_y`).all<{ chunk_x: number; chunk_y: number }>(taskId);
    expect(await memberships()).toEqual([{ chunk_x: -2, chunk_y: -1 }, { chunk_x: -1, chunk_y: -1 }]);
    await db.prepare("UPDATE tasks_v3 SET footprint_json=?::jsonb,access_json=?::jsonb WHERE id=?")
      .run(JSON.stringify([{ x: 128, y: 128 }]), JSON.stringify([{ x: 129, y: 128 }]), taskId);
    expect(await memberships()).toEqual([{ chunk_x: 2, chunk_y: 2 }]);
    await db.prepare("DELETE FROM tasks_v3 WHERE id=?").run(taskId);
    expect(await memberships()).toEqual([]);
  });

  it("rolls back every statement in a failed transaction", async () => {
    await expect(transaction(db, async () => {
      await db.prepare("INSERT INTO users (id,email,name,password_hash,created_at) VALUES (?,?,'A','x',?)")
        .run(randomUUID(), "rollback@tasktopia.local", new Date().toISOString());
      throw new Error("rollback");
    })).rejects.toThrow("rollback");
    expect(await db.prepare("SELECT 1 FROM users WHERE email=?").get("rollback@tasktopia.local")).toBeUndefined();
  });
});
