import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { registerUser } from "../src/server/auth";
import { createTestDb, type Db } from "../src/server/db";
import { compileBlockLayout } from "../src/server/world/block-layout-compiler";
import { activateBlockLayout, persistReadyBlockLayout } from "../src/server/world/block-layout-store";

describe("block-v1 layout compiler", () => {
  const input = {
    countryId: "country-1",
    cityId: "city-1",
    district: { id: "district-1", archetype: "MIXED_URBAN" },
    seed: 1742,
    revision: 1,
    tasks: [
      { id: "task-b", buildingFamily: "residential", facadeVariant: "north", constructionStage: 3 as const },
      { id: "task-a", buildingFamily: "civic", facadeVariant: "north", constructionStage: 5 as const },
    ],
  };

  it("compiles the same semantic block and checksum regardless of task input order", () => {
    const first = compileBlockLayout(input);
    const second = compileBlockLayout({ ...input, tasks: [...input.tasks].reverse() });

    expect(second).toEqual(first);
    expect(first.generatorVersion).toBe("block-v1");
    expect(first.status).toBe("READY");
    expect(first.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(first.roadNetwork.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(first.blocks).toHaveLength(1);
    expect(first.blocks[0]).toMatchObject({
      templateKey: "mixed-urban-grid",
      templateVersion: 1,
      variant: "north",
      width: 32,
      height: 32,
    });
    expect(first.placements.map((placement) => [placement.taskId, placement.slotKey])).toEqual([
      ["task-a", "lot-0"],
      ["task-b", "lot-1"],
    ]);
  });

  it("rejects an invalid construction stage before creating a layout", () => {
    expect(() => compileBlockLayout({
      ...input,
      tasks: [{ ...input.tasks[0]!, constructionStage: 6 as 5 }],
    })).toThrow(/stage/i);
  });
});

describe("block-v1 layout persistence", () => {
  let db: Db;
  beforeEach(async () => { db = await createTestDb(); });
  afterEach(async () => { await db.close(); });

  it("persists a ready layout idempotently and activates it transactionally", async () => {
    const registered = await registerUser(db, {
      email: "block-v1-store@tasktopia.local",
      name: "Block store",
      password: "store-password",
    });
    const cityId = randomUUID();
    const districtId = randomUUID();
    const taskId = randomUUID();
    const timestamp = new Date().toISOString();
    await db.prepare(`INSERT INTO cities_v3
      (id,country_id,name,status,center_x,center_y,bounds_json,style_id,created_at)
      VALUES (?,?,'Stored block city','ACTIVE',0,0,?::jsonb,'block-v1',?)`)
      .run(cityId, registered.user.countryId,
        JSON.stringify({ minX: 0, minY: 0, maxX: 31, maxY: 31 }), timestamp);
    await db.prepare(`INSERT INTO districts_v3
      (id,city_id,name,status,cells_json,lots_json,growth_direction,color,created_at)
      VALUES (?,?,'Stored district','ACTIVE','[]'::jsonb,'[]'::jsonb,'E','#fff',?)`)
      .run(districtId, cityId, timestamp);
    await db.prepare(`INSERT INTO tasks_v3
      (id,task_number,city_id,district_id,title,estimate,building_type,platform_type,origin_x,origin_y,
       footprint_json,access_json,created_at,updated_at)
      VALUES (?,1,?,?,'Stored task',1,'house-small','GRASS',0,0,'[]'::jsonb,'[]'::jsonb,?,?)`)
      .run(taskId, cityId, districtId, timestamp, timestamp);

    const layout = compileBlockLayout({
      countryId: registered.user.countryId,
      cityId,
      district: { id: districtId, archetype: "MIXED_URBAN" },
      seed: 44,
      revision: 1,
      tasks: [{
        id: taskId,
        buildingFamily: "residential",
        facadeVariant: "north",
        constructionStage: 2,
      }],
    });
    await Promise.all([
      persistReadyBlockLayout(db, layout, timestamp),
      persistReadyBlockLayout(db, layout, timestamp),
    ]);
    expect(await db.prepare("SELECT COUNT(*)::integer AS count FROM city_layouts_v1 WHERE city_id=?").get(cityId))
      .toEqual({ count: 1 });
    expect(await db.prepare("SELECT status,checksum FROM city_layouts_v1 WHERE id=?").get(layout.id))
      .toEqual({ status: "READY", checksum: layout.checksum });

    await activateBlockLayout(db, layout.id, timestamp);
    await activateBlockLayout(db, layout.id, timestamp);
    expect(await db.prepare("SELECT status,activated_at FROM city_layouts_v1 WHERE id=?").get(layout.id))
      .toEqual({ status: "ACTIVE", activated_at: timestamp });

    const replacement = compileBlockLayout({
      countryId: registered.user.countryId,
      cityId,
      district: { id: districtId, archetype: "MIXED_URBAN" },
      seed: 45,
      revision: 2,
      tasks: [{
        id: taskId,
        buildingFamily: "residential",
        facadeVariant: "north",
        constructionStage: 2,
      }],
    });
    await persistReadyBlockLayout(db, replacement, timestamp);
    expect(await db.prepare("SELECT COUNT(*)::integer AS count FROM task_placements_v1 WHERE task_id=?").get(taskId))
      .toEqual({ count: 2 });
    await activateBlockLayout(db, replacement.id, timestamp);
    expect(await db.prepare("SELECT revision,status FROM city_layouts_v1 WHERE city_id=? ORDER BY revision").all(cityId))
      .toEqual([{ revision: 1, status: "SUPERSEDED" }, { revision: 2, status: "ACTIVE" }]);
  });
});
