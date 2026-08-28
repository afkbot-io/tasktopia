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
    expect(rows.map((row) => row.name)).toEqual([
      "0001_initial.sql", "0002_backfill_spatial.sql", "0003_feature_ownership.sql", "0004_ai_work_model.sql",
      "0005_incident_response.sql", "0006_task_extras.sql", "0007_ai_fields.sql", "0008_starter_city.sql",
      "0009_country_archive.sql", "0010_task_linked_landmarks.sql", "0011_task_documents_checklist.sql",
      "0012_staged_green_areas.sql", "0013_task_visual_kind.sql", "0014_published_chunk_payloads.sql",
      "0015_published_chunk_retention.sql",
      "0016_chunk_local_district_cells.sql",
      "0017_world_generation_jobs.sql",
      "0018_compact_spatial_indexes.sql",
      "0019_seeded_area_decor.sql",
      "0020_country_overview_snapshots.sql",
      "0021_web_push.sql",
    ]);
    expect(rows.every((row) => /^[a-f0-9]{64}$/.test(row.checksum))).toBe(true);
  });

  it("stores owned subscriptions and idempotent event deliveries", async () => {
    expect(await db.prepare("SELECT to_regclass('push_subscriptions_v1') AS table_name").get())
      .toMatchObject({ table_name: "push_subscriptions_v1" });
    expect(await db.prepare("SELECT to_regclass('push_deliveries_v1') AS table_name").get())
      .toMatchObject({ table_name: "push_deliveries_v1" });
    const indexes = await db.prepare(`SELECT indexname FROM pg_indexes
      WHERE schemaname = current_schema() AND tablename IN ('push_subscriptions_v1', 'push_deliveries_v1')`)
      .all<{ indexname: string }>();
    expect(indexes.map((entry) => entry.indexname)).toEqual(expect.arrayContaining([
      "push_subscriptions_v1_endpoint_uidx",
      "push_deliveries_v1_event_subscription_uidx",
      "push_deliveries_v1_claim_idx",
    ]));
  });

  it("stores one replaceable semantic country overview snapshot per viewer and country", async () => {
    expect(await db.prepare("SELECT to_regclass('country_overview_snapshots_v1') AS table_name").get())
      .toMatchObject({ table_name: "country_overview_snapshots_v1" });
    const columns = await db.prepare(`SELECT column_name FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'country_overview_snapshots_v1' ORDER BY column_name`)
      .all<{ column_name: string }>();
    expect(columns.map((column) => column.column_name)).toEqual(expect.arrayContaining([
      "country_id", "payload_json", "planet_revision", "schema_version", "user_id",
    ]));
  });

  it("forbids durable rows for seed-derived park interiors", async () => {
    const constraint = await db.prepare(`SELECT pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conrelid = 'world_features_v6'::regclass
        AND conname = 'world_features_v6_no_derived_park_decor'`).get<{ definition: string }>();
    expect(constraint?.definition).toContain("kind <> 'PARK_DECOR'");
  });

  it("creates a durable idempotent queue for isolated world generation", async () => {
    expect(await db.prepare("SELECT to_regclass('world_generation_jobs_v1') AS table_name").get())
      .toMatchObject({ table_name: "world_generation_jobs_v1" });
    const indexes = await db.prepare(`SELECT indexname FROM pg_indexes
      WHERE schemaname = current_schema() AND tablename = 'world_generation_jobs_v1'`).all<{ indexname: string }>();
    expect(indexes.map((index) => index.indexname)).toEqual(expect.arrayContaining([
      "world_generation_jobs_v1_claim_idx", "world_generation_jobs_v1_country_idx",
    ]));
  });

  it("stores disposable published chunk payloads separately from canonical world state", async () => {
    expect(await db.prepare("SELECT to_regclass('world_chunk_payloads_v1') AS table_name").get())
      .toMatchObject({ table_name: "world_chunk_payloads_v1" });
    const columns = await db.prepare(`SELECT column_name FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'world_chunk_payloads_v1' ORDER BY column_name`)
      .all<{ column_name: string }>();
    expect(columns.map((column) => column.column_name)).toEqual(expect.arrayContaining([
      "content_hash", "country_id", "chunk_x", "chunk_y", "lod", "payload_json",
    ]));
    const indexes = await db.prepare(`SELECT indexname FROM pg_indexes
      WHERE schemaname = current_schema() AND tablename = 'world_chunk_payloads_v1'`).all<{ indexname: string }>();
    expect(indexes.map((index) => index.indexname)).toContain("world_chunk_payloads_v1_published_idx");
  });

  it("projects district geometry into bounded chunk-local rows", async () => {
    const registered = await registerUser(db, { email: "district-projection@tasktopia.local", name: "Projection", password: "migration-password" });
    const cityId = randomUUID();
    const districtId = randomUUID();
    const timestamp = new Date().toISOString();
    await db.prepare(`INSERT INTO cities_v3
      (id,country_id,name,status,center_x,center_y,bounds_json,style_id,created_at)
      VALUES (?,?,'Projection city','ACTIVE',0,0,?::jsonb,'test',?)`)
      .run(cityId, registered.user.countryId, JSON.stringify({ minX: -64, minY: -64, maxX: 127, maxY: 127 }), timestamp);
    const cells = Array.from({ length: 64 * 64 + 2 }, (_, index) => ({ x: index % 64, y: Math.floor(index / 64) }));
    await db.prepare(`INSERT INTO districts_v3
      (id,city_id,name,status,cells_json,lots_json,growth_direction,color,created_at)
      VALUES (?,?,'Projected district','ACTIVE',?::jsonb,'[]'::jsonb,'E','#fff',?)`)
      .run(districtId, cityId, JSON.stringify(cells), timestamp);

    const rows = await db.prepare(`SELECT chunk_x, chunk_y, jsonb_array_length(cells_json) AS cell_count
      FROM world_chunk_district_cells_v1 WHERE district_id = ? ORDER BY chunk_y, chunk_x`).all(districtId);
    expect(rows).toEqual([
      { chunk_x: 0, chunk_y: 0, cell_count: 4096 },
      { chunk_x: 0, chunk_y: 1, cell_count: 2 },
    ]);
    expect(await db.prepare(`SELECT MAX(jsonb_array_length(cells_json)) AS max_cells
      FROM world_chunk_district_cells_v1 WHERE district_id = ?`).get(districtId)).toEqual({ max_cells: 4096 });
    expect(await db.prepare(`SELECT MAX(jsonb_array_length(cell_runs_json)) AS max_runs
      FROM world_chunk_district_cells_v1 WHERE district_id = ?`).get(districtId)).toEqual({ max_runs: 64 });
    expect(await db.prepare(`SELECT COUNT(*)::integer AS mismatches
      FROM world_chunk_district_cells_v1 projection
      WHERE projection.district_id = ?
        AND (SELECT COUNT(*) FROM jsonb_array_elements(projection.cells_json)) <>
            (SELECT COALESCE(SUM((run->'end'->>'x')::integer - (run->'start'->>'x')::integer + 1), 0)
             FROM jsonb_array_elements(projection.cell_runs_json) AS run)`).get(districtId))
      .toEqual({ mismatches: 0 });
    const exactParity = async () => await db.prepare(`WITH legacy AS (
        SELECT projection.district_id, projection.chunk_x, projection.chunk_y,
          (cell->>'x')::integer AS x, (cell->>'y')::integer AS y
        FROM world_chunk_district_cells_v1 projection
        CROSS JOIN LATERAL jsonb_array_elements(projection.cells_json) cell
        WHERE projection.district_id = ?
      ), compact AS (
        SELECT projection.district_id, projection.chunk_x, projection.chunk_y,
          generated_x AS x, (run->'start'->>'y')::integer AS y
        FROM world_chunk_district_cells_v1 projection
        CROSS JOIN LATERAL jsonb_array_elements(projection.cell_runs_json) run
        CROSS JOIN LATERAL generate_series(
          (run->'start'->>'x')::integer,
          (run->'end'->>'x')::integer
        ) generated_x
        WHERE projection.district_id = ?
      ), differences AS (
        (SELECT * FROM legacy EXCEPT SELECT * FROM compact)
        UNION ALL
        (SELECT * FROM compact EXCEPT SELECT * FROM legacy)
      )
      SELECT COUNT(*)::integer AS mismatches FROM differences`).get(districtId, districtId);
    expect(await exactParity()).toEqual({ mismatches: 0 });
    await db.prepare(`UPDATE world_chunk_district_cells_v1 SET cell_runs_json = jsonb_set(
      cell_runs_json, '{0,start,x}', to_jsonb(((cell_runs_json->0->'start'->>'x')::integer + 1)))
      WHERE district_id = ? AND chunk_x = 0 AND chunk_y = 0`).run(districtId);
    expect(await exactParity()).not.toEqual({ mismatches: 0 });
    await db.prepare("UPDATE districts_v3 SET cells_json=cells_json WHERE id=?").run(districtId);
    expect(await exactParity()).toEqual({ mismatches: 0 });
    expect(await db.prepare(`SELECT COUNT(*)::integer AS legacy_rows FROM world_chunk_entities_v11
      WHERE entity_kind='DISTRICT' AND entity_id=?`).get(districtId))
      .toEqual({ legacy_rows: 2 });

    await db.prepare("UPDATE districts_v3 SET cells_json=?::jsonb WHERE id=?")
      .run(JSON.stringify([{ x: -1, y: -1 }]), districtId);
    expect(await db.prepare(`SELECT chunk_x, chunk_y, cells_json FROM world_chunk_district_cells_v1
      WHERE district_id=?`).all(districtId)).toEqual([{ chunk_x: -1, chunk_y: -1, cells_json: [{ x: -1, y: -1 }] }]);
    await db.prepare("DELETE FROM districts_v3 WHERE id=?").run(districtId);
    expect(await db.prepare("SELECT 1 FROM world_chunk_district_cells_v1 WHERE district_id=?").all(districtId)).toEqual([]);
  });

  it("creates a singleton country archive and stores tags as jsonb", async () => {
    const registered = await registerUser(db, { email: "archive-migration@tasktopia.local", name: "Archive", password: "migration-password" });
    const archive = await db.prepare("SELECT id FROM country_archives_v1 WHERE country_id = ?").get<{ id: string }>(registered.user.countryId);
    expect(archive?.id).toBeTruthy();
    const column = await db.prepare(`SELECT data_type FROM information_schema.columns
      WHERE table_name = 'country_archive_records_v1' AND column_name = 'tags_json'`).get<{ data_type: string }>();
    expect(column?.data_type).toBe("jsonb");
    expect(await db.prepare("SELECT to_regclass('city_reference_cards_v1') AS table_name").get()).toMatchObject({ table_name: null });
  });

  it("adds AI planning fields and cascading task defects with safe defaults", async () => {
    const columns = await db.prepare(`SELECT column_name FROM information_schema.columns
      WHERE table_name IN ('countries','cities_v3','districts_v3','tasks_v3')`).all<{ column_name: string }>();
    const names = new Set(columns.map((column) => column.column_name));
    for (const name of ["product_context", "acceptance_criteria", "deadline", "work_item_type", "system_analysis", "implementation_plan"]) {
      expect(names.has(name), name).toBe(true);
    }
    expect(await db.prepare("SELECT to_regclass('task_defects_v18') AS table_name").get()).toMatchObject({ table_name: "task_defects_v18" });
    const statuses = await db.prepare(`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
      WHERE conrelid = 'task_defects_v18'::regclass AND contype = 'c'`).all<{ definition: string }>();
    expect(statuses.some((constraint) => constraint.definition.includes("IN_PROGRESS") && constraint.definition.includes("VERIFYING"))).toBe(true);
    expect(await db.prepare("SELECT to_regclass('task_documents_v1') AS table_name").get()).toMatchObject({ table_name: "task_documents_v1" });
    expect(await db.prepare("SELECT to_regclass('task_checklist_items_v1') AS table_name").get()).toMatchObject({ table_name: "task_checklist_items_v1" });
  });

  it("constrains task-owned parks to registered visual variants", async () => {
    const columns = await db.prepare(`SELECT column_name FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'tasks_v3'
        AND column_name IN ('visual_kind', 'visual_asset_key') ORDER BY column_name`)
      .all<{ column_name: string }>();
    expect(columns.map((column) => column.column_name)).toEqual(["visual_asset_key", "visual_kind"]);
    const constraints = await db.prepare(`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
      WHERE conrelid = 'tasks_v3'::regclass AND conname = 'tasks_v3_park_asset_check'`)
      .all<{ definition: string }>();
    expect(constraints[0]?.definition).toContain("urban-formal");
    expect(constraints[0]?.definition).toContain("visual_asset_key = building_type");
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
      (id,task_number,city_id,district_id,title,estimate,building_type,platform_type,origin_x,origin_y,footprint_json,access_json,created_at,updated_at)
      VALUES (?,1,?,?,'Migration task',1,'house-small','GRASS',-65,-1,?::jsonb,?::jsonb,?,?)`)
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
