import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
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
      "0022_block_v1_shadow_layouts.sql",
      "0023_compact_block_cutover.sql",
      "0024_dense_slot_planning.sql",
      "0025_task_history_read_index.sql",
      "0026_permanent_task_sites.sql",
      "0027_task_public_spaces.sql",
      "0028_civic_service_role.sql",
      "0029_country_road_snapshots.sql",
    ]);
    expect(rows.every((row) => /^[a-f0-9]{64}$/.test(row.checksum))).toBe(true);
  });

  it("cuts over populated legacy geometry without deleting product tasks or their history", async () => {
    // The extra schema lives only in this transaction. A failing migration
    // rolls back its creation, and a passing one drops it before commit.
    const schema = `cutover_${randomUUID().replaceAll("-", "")}`;
    const directory = join(process.cwd(), "migrations/postgres");
    const historical = (await readdir(directory)).filter(name => /^\d+.*\.sql$/.test(name) && name < "0023_").sort();
    await transaction(db, async () => {
      await db.exec(`CREATE SCHEMA "${schema}"`);
      await db.exec(`SET LOCAL search_path TO "${schema}"`);
      for (const name of historical) await db.exec(await readFile(join(directory, name), "utf8"));
      const { user } = await registerUser(db, { email: "cutover@tasktopia.local", name: "Cutover", password: "migration-password" });
      const cityId = randomUUID(), districtId = randomUUID(), taskId = randomUUID();
      const timestamp = new Date().toISOString();
      await db.prepare(`INSERT INTO cities_v3(id,country_id,name,status,center_x,center_y,bounds_json,style_id,created_at)
        VALUES (?,?,'Preserved city','ACTIVE',0,0,'{"minX":0,"minY":0,"maxX":64,"maxY":64}'::jsonb,'old',?)`)
        .run(cityId, user.countryId, timestamp);
      await db.prepare(`INSERT INTO districts_v3(id,city_id,name,status,cells_json,lots_json,growth_direction,color,created_at)
        VALUES (?,?,'Preserved district','ACTIVE','[{"x":0,"y":0}]'::jsonb,'[]'::jsonb,'E','#fff',?)`)
        .run(districtId, cityId, timestamp);
      await db.prepare(`INSERT INTO tasks_v3(id,task_number,city_id,district_id,title,description,estimate,status,progress,
        building_type,platform_type,origin_x,origin_y,footprint_json,visual_kind,visual_asset_key,work_item_type,created_at,updated_at)
        VALUES (?,17,?,?,'Preserved incident','Keep the business context',3,'TESTING',90,'house-cottage','YARD',0,0,
        '[{"x":0,"y":0}]'::jsonb,'BUILDING','house-cottage','HOTFIX',?,?)`)
        .run(taskId, cityId, districtId, timestamp, timestamp);
      await db.prepare("INSERT INTO task_comments_v3(id,task_id,body,actor,created_at) VALUES (?,?,'Keep comment','Tester',?)")
        .run(randomUUID(), taskId, timestamp);
      await db.prepare("INSERT INTO task_events_v7(task_id,actor_label,event_type,details_json,created_at) VALUES (?,'Tester','STATUS_CHANGED','{}'::jsonb,?)")
        .run(taskId, timestamp);
      await db.prepare("INSERT INTO task_defects_v18(id,task_id,title,status,created_at,updated_at) VALUES (?,?,'Keep defect','VERIFYING',?,?)")
        .run(randomUUID(), taskId, timestamp, timestamp);
      await db.prepare("INSERT INTO roads_v3(country_id,x,y) VALUES (?,4,4)").run(user.countryId);
      const before = await db.prepare("SELECT seed,world_version::integer AS world_version FROM countries WHERE id=?").get<{ seed: number; world_version: number }>(user.countryId);

      await db.exec(await readFile(join(directory, "0023_compact_block_cutover.sql"), "utf8"));

      expect(await db.prepare(`SELECT id,task_number,city_id,district_id,title,description,status,progress,work_item_type,
        building_type,visual_asset_key FROM tasks_v3 WHERE id=?`).get(taskId)).toEqual({
        id: taskId, task_number: 17, city_id: cityId, district_id: districtId, title: "Preserved incident",
        description: "Keep the business context", status: "TESTING", progress: 90, work_item_type: "HOTFIX",
        building_type: "compact-apartment-v1", visual_asset_key: "compact-apartment-v1",
      });
      expect(await db.prepare("SELECT body FROM task_comments_v3 WHERE task_id=?").get(taskId)).toEqual({ body: "Keep comment" });
      expect(await db.prepare("SELECT event_type FROM task_events_v7 WHERE task_id=?").get(taskId)).toEqual({ event_type: "STATUS_CHANGED" });
      expect(await db.prepare("SELECT title,status FROM task_defects_v18 WHERE task_id=?").get(taskId)).toEqual({ title: "Keep defect", status: "VERIFYING" });
      expect(await db.prepare("SELECT seed,world_version::integer AS world_version FROM countries WHERE id=?").get(user.countryId))
        .toEqual({ seed: before!.seed, world_version: Number(before!.world_version) + 1 });
      expect(await db.prepare("SELECT to_regclass('roads_v3') AS table_name").get()).toEqual({ table_name: null });
      expect(await db.prepare("SELECT id FROM cities_v3 WHERE id=?").get(cityId)).toEqual({ id: cityId });
      expect(await db.prepare("SELECT id FROM districts_v3 WHERE id=?").get(districtId)).toEqual({ id: districtId });
      await db.exec(await readFile(join(directory, "0024_dense_slot_planning.sql"), "utf8"));
      expect(await db.prepare("SELECT visual_auto,requested_building_family,status,progress FROM tasks_v3 WHERE id=?").get(taskId))
        .toEqual({ visual_auto: true, requested_building_family: null, status: "TESTING", progress: 90 });
      expect(await db.prepare("SELECT seed,world_version::integer AS world_version FROM countries WHERE id=?").get(user.countryId))
        .toEqual({ seed: before!.seed, world_version: Number(before!.world_version) + 2 });
      await db.exec("SET CONSTRAINTS ALL IMMEDIATE");
      await db.exec(`DROP SCHEMA "${schema}" CASCADE`);
    });
  });

  it("stores block-v1 layouts, semantic roads, and exclusive slot occupancy", async () => {
    const registered = await registerUser(db, {
      email: "block-v1-migration@tasktopia.local",
      name: "Block v1",
      password: "migration-password",
    });
    const cityId = randomUUID();
    const districtId = randomUUID();
    const layoutId = randomUUID();
    const districtLayoutId = randomUUID();
    const blockId = randomUUID();
    const networkId = randomUUID();
    const timestamp = new Date().toISOString();
    await db.prepare(`INSERT INTO cities_v3
      (id,country_id,name,status,center_x,center_y,bounds_json,style_id,created_at)
      VALUES (?,?,'Block city','ACTIVE',0,0,?::jsonb,'block-v1',?)`)
      .run(cityId, registered.user.countryId, JSON.stringify({ minX: 0, minY: 0, maxX: 31, maxY: 31 }), timestamp);
    await db.prepare(`INSERT INTO districts_v3
      (id,city_id,name,status,growth_direction,color,created_at)
      VALUES (?,?,'Block district','ACTIVE','E','#fff',?)`)
      .run(districtId, cityId, timestamp);
    await db.prepare(`INSERT INTO city_layouts_v1
      (id,country_id,city_id,generator_version,seed,revision,status,bounds_json,checksum,created_at,updated_at)
      VALUES (?,?,?,'block-v1',17,1,'GENERATING',?::jsonb,NULL,?,?)`)
      .run(layoutId, registered.user.countryId, cityId, JSON.stringify({ minX: 0, minY: 0, maxX: 31, maxY: 31 }), timestamp, timestamp);
    await db.prepare("UPDATE city_layouts_v1 SET status='VALIDATING' WHERE id=?").run(layoutId);
    await db.prepare("UPDATE city_layouts_v1 SET status='READY',checksum=repeat('a',64) WHERE id=?").run(layoutId);
    await db.prepare("UPDATE city_layouts_v1 SET status='ACTIVE', activated_at=? WHERE id=?").run(timestamp, layoutId);
    await expect(db.prepare(`INSERT INTO city_layouts_v1
      (id,country_id,city_id,generator_version,seed,revision,status,bounds_json,checksum,created_at,updated_at,activated_at)
      VALUES (?,?,?,'block-v1',18,2,'ACTIVE',?::jsonb,repeat('b',64),?,?,?)`)
      .run(randomUUID(), registered.user.countryId, cityId,
        JSON.stringify({ minX: 0, minY: 0, maxX: 31, maxY: 31 }), timestamp, timestamp, timestamp))
      .rejects.toThrow();
    await expect(db.prepare("UPDATE city_layouts_v1 SET status='GENERATING' WHERE id=?").run(layoutId))
      .rejects.toThrow();

    await db.prepare(`INSERT INTO district_layouts_v1
      (id,layout_id,district_id,sequence,archetype,bounds_json,created_at)
      VALUES (?,?,?,0,'MIXED_URBAN',?::jsonb,?)`)
      .run(districtLayoutId, layoutId, districtId,
        JSON.stringify({ minX: 0, minY: 0, maxX: 31, maxY: 31 }), timestamp);
    await db.prepare(`INSERT INTO city_blocks_v1
      (id,layout_id,district_layout_id,sequence,kind,template_key,template_version,variant,seed,
       origin_x,origin_y,width,height,parameters_json,summary_json,created_at)
      VALUES (?,?,?,0,'RESIDENTIAL','residential-grid',1,'north',17,0,0,16,16,'{}'::jsonb,'{}'::jsonb,?)`)
      .run(blockId, layoutId, districtLayoutId, timestamp);
    await db.prepare(`INSERT INTO road_networks_v1
      (id,layout_id,schema_version,nodes_json,segments_json,checksum,created_at)
      VALUES (?,?,1,?::jsonb,?::jsonb,repeat('c',64),?)`)
      .run(networkId, layoutId,
        JSON.stringify([{ id: "west", x: 0, y: 8 }, { id: "east", x: 15, y: 8 }]),
        JSON.stringify([{ id: "main", fromNodeId: "west", toNodeId: "east", widthCells: 3,
          runs: [{ direction: "E", length: 15 }] }]),
        timestamp);

    await db.prepare(`INSERT INTO task_placements_v1
      (task_id,layout_id,block_id,slot_key,building_family,facade_variant,construction_stage,created_at,updated_at)
      SELECT id,?,?,?,'residential','north',1,?,? FROM tasks_v3 LIMIT 0`)
      .run(layoutId, blockId, "lot-0", timestamp, timestamp);
    await db.prepare(`INSERT INTO site_markers_v1
      (id,layout_id,block_id,slot_key,kind,snapshot_json,asset_variant,created_at,updated_at)
      VALUES (?,?,?,?,'RUINED','{}'::jsonb,'residential-ruin',?,?)`)
      .run(randomUUID(), layoutId, blockId, "lot-0", timestamp, timestamp);

    const taskId = randomUUID();
    await db.prepare(`INSERT INTO tasks_v3
      (id,task_number,city_id,district_id,title,estimate,building_type,platform_type,visual_kind,visual_asset_key,created_at,updated_at)
      VALUES (?,1,?,?,'Block task',1,'compact-apartment-v1','STONE','BUILDING','compact-apartment-v1',?,?)`)
      .run(taskId, cityId, districtId, timestamp, timestamp);
    await expect(db.prepare(`INSERT INTO task_placements_v1
      (task_id,layout_id,block_id,slot_key,building_family,facade_variant,construction_stage,created_at,updated_at)
      VALUES (?,?,?,?,'residential','north',1,?,?)`)
      .run(taskId, layoutId, blockId, "lot-0", timestamp, timestamp)).rejects.toThrow();
    const relocatedMarkerId = randomUUID();
    await db.prepare(`INSERT INTO site_markers_v1
      (id,layout_id,block_id,slot_key,kind,target_task_id,snapshot_json,asset_variant,created_at,updated_at)
      VALUES (?,?,?,'lot-1','RELOCATED',?,'{}'::jsonb,'residential-relocated',?,?)`)
      .run(relocatedMarkerId, layoutId, blockId, taskId, timestamp, timestamp);
    await db.prepare("DELETE FROM tasks_v3 WHERE id=?").run(taskId);
    expect(await db.prepare("SELECT kind,target_task_id FROM site_markers_v1 WHERE id=?").get(relocatedMarkerId))
      .toEqual({ kind: "RELOCATED", target_task_id: null });
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

  it("removes the legacy feature table instead of persisting seed-derived park interiors", async () => {
    expect(await db.prepare("SELECT to_regclass('world_features_v6') AS table_name").get())
      .toEqual({ table_name: null });
    expect(await db.prepare("SELECT to_regclass('site_markers_v1') AS table_name").get())
      .toEqual({ table_name: "site_markers_v1" });
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

  it("stores district bounds and template rectangles without expanded cell arrays", async () => {
    const columns = await db.prepare(`SELECT table_name,column_name FROM information_schema.columns
      WHERE table_schema=current_schema() AND table_name IN ('districts_v3','tasks_v3','city_blocks_v1')`)
      .all<{ table_name: string; column_name: string }>();
    const names = (table: string) => columns.filter(column => column.table_name === table).map(column => column.column_name);
    expect(names("districts_v3")).toContain("spatial_bounds_json");
    expect(names("districts_v3")).not.toContain("cells_json");
    expect(names("districts_v3")).not.toContain("lots_json");
    for (const removed of ["origin_x","origin_y","footprint_json","access_json","entrance_x","entrance_y"]) {
      expect(names("tasks_v3")).not.toContain(removed);
    }
    expect(names("city_blocks_v1")).toEqual(expect.arrayContaining(["origin_x","origin_y","width","height","template_key"]));
    expect(await db.prepare("SELECT to_regclass('world_chunk_district_cells_v1') AS table_name").get()).toEqual({ table_name: null });
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

  it("removes obsolete spatial tables and their geometry triggers", async () => {
    for (const table of ["roads_v3","world_features_v6","world_chunk_entities_v11","world_chunk_district_cells_v1"]) {
      expect(await db.prepare("SELECT to_regclass(?) AS table_name").get(table), table).toEqual({ table_name: null });
    }
    const triggers = await db.prepare(`SELECT tgname FROM pg_trigger
      WHERE NOT tgisinternal AND tgrelid IN ('tasks_v3'::regclass,'districts_v3'::regclass)`).all<{ tgname: string }>();
    expect(triggers.every(trigger => !/chunk|spatial|footprint/.test(trigger.tgname))).toBe(true);
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
