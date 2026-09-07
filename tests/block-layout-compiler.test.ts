import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { registerUser } from "../src/server/auth";
import { createTestDb, type Db } from "../src/server/db";
import { compileBlockLayout } from "../src/server/world/block-layout-compiler";
import { activateBlockLayout, persistReadyBlockLayout } from "../src/server/world/block-layout-store";
import { blockSurfacePlanForKind } from "../src/shared/block-surface";

describe("block-v1 layout compiler", () => {
  const tasks = [
    { id: "task-b", taskNumber: 2, buildingFamily: "residential", facadeVariant: "south", constructionStage: 3 as const },
    { id: "task-a", taskNumber: 1, buildingFamily: "civic", facadeVariant: "south", constructionStage: 5 as const },
  ];
  const input = {
    countryId: "country-1",
    cityId: "city-1",
    seed: 1742,
    revision: 1,
    districts: [{ id: "district-1", archetype: "MIXED_URBAN", sequence: 0, tasks }],
  };

  it("compiles the same semantic block and checksum regardless of task input order", () => {
    const first = compileBlockLayout(input);
    const second = compileBlockLayout({ ...input, districts: [{ ...input.districts[0]!, tasks: [...tasks].reverse() }] });

    expect(second).toEqual(first);
    expect(first.generatorVersion).toBe("block-v1");
    expect(first.status).toBe("READY");
    expect(first.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(first.roadNetwork.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(first.blocks).toHaveLength(1);
    expect(first.blocks[0]).toMatchObject({
      templateKey: "residential-court",
      templateVersion: 3,
      variant: "south",
      width: 32,
      height: 32,
      parameters: { sitePlan: { version: 1, parcels: expect.any(Array) } },
    });
    expect(first.placements.map((placement) => [placement.taskId, placement.slotKey])).toEqual([
      ["task-a", "slot-0"],
      ["task-b", "slot-1"],
    ]);
  });

  it("rejects an invalid construction stage before creating a layout", () => {
    expect(() => compileBlockLayout({
      ...input,
      districts: [{ ...input.districts[0]!, tasks: [{ ...tasks[0]!, constructionStage: 6 as 5 }] }],
    })).toThrow(/stage/i);
  });

  it("keeps an explicitly requested family when terrain requires a smaller fallback block", () => {
    const layout = compileBlockLayout({ ...input, canPlaceBlock: bounds =>
      bounds.maxX - bounds.minX === 20 && bounds.maxY - bounds.minY === 20,
    districts: [{ ...input.districts[0]!, tasks: [{ ...tasks[0]!, requestedFamily: "compact-row-v1" }] }] });
    expect(layout.blocks).toHaveLength(1);
    expect(layout.blocks[0]).toMatchObject({ templateKey: "residential-single", width: 16, height: 16,
      parameters: { firstFamily: "compact-row-v1" } });
    expect(layout.placements[0]).toMatchObject({ buildingFamily: "compact-row-v1" });
    const replay = compileBlockLayout({ ...input, revision: 2, previous: layout,
      districts: [{ ...input.districts[0]!, tasks: [{ ...tasks[0]!, requestedFamily: "compact-row-v1", constructionStage: 5 }] }] });
    expect(replay.blocks[0]!.parameters.sitePlan).toEqual(layout.blocks[0]!.parameters.sitePlan);
    expect(replay.placements[0]).toEqual({ ...layout.placements[0], constructionStage: 5 });
  });

  it("reserves water only for WATER blocks and keeps all current ordinary blocks on lawn", () => {
    expect(blockSurfacePlanForKind("WATER")).toMatchObject({ kind: "WATER", tileKey: "block-water", cellPx: 4 });
    for (const kind of ["RESIDENTIAL", "CIVIC", "PARK", "INDUSTRIAL", "TRANSPORT"] as const) {
      expect(blockSurfacePlanForKind(kind), kind).toMatchObject({ kind: "LAWN", tileKey: "block-lawn", cellPx: 4 });
    }
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
      (id,city_id,name,status,growth_direction,color,created_at)
      VALUES (?,?,'Stored district','ACTIVE','E','#fff',?)`)
      .run(districtId, cityId, timestamp);
    await db.prepare(`INSERT INTO tasks_v3
      (id,task_number,city_id,district_id,title,estimate,building_type,platform_type,visual_kind,visual_asset_key,created_at,updated_at)
      VALUES (?,1,?,?,'Stored task',1,'compact-apartment-v1','GRASS','BUILDING','compact-apartment-v1',?,?)`)
      .run(taskId, cityId, districtId, timestamp, timestamp);

    const layout = compileBlockLayout({
      countryId: registered.user.countryId,
      cityId,
      seed: 44,
      revision: 1,
      districts: [{ id: districtId, archetype: "MIXED_URBAN", sequence: 0, tasks: [{
        id: taskId,
        taskNumber: 1,
        buildingFamily: "residential",
        facadeVariant: "north",
        constructionStage: 2,
      }] }],
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
      seed: 45,
      revision: 2,
      districts: [{ id: districtId, archetype: "MIXED_URBAN", sequence: 0, tasks: [{
        id: taskId,
        taskNumber: 1,
        buildingFamily: "residential",
        facadeVariant: "north",
        constructionStage: 2,
      }] }],
    });
    await persistReadyBlockLayout(db, replacement, timestamp);
    expect(await db.prepare("SELECT COUNT(*)::integer AS count FROM task_placements_v1 WHERE task_id=?").get(taskId))
      .toEqual({ count: 2 });
    await activateBlockLayout(db, replacement.id, timestamp);
    expect(await db.prepare("SELECT revision,status FROM city_layouts_v1 WHERE city_id=? ORDER BY revision").all(cityId))
      .toEqual([{ revision: 1, status: "SUPERSEDED" }, { revision: 2, status: "ACTIVE" }]);
  });
});
