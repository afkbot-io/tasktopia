import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createTestDb, transaction, type Db } from "../src/server/db";
import { registerUser } from "../src/server/auth";
import { compileBlockLayout } from "../src/server/world/block-layout-compiler";
import { persistReadyBlockLayout, activateBlockLayout } from "../src/server/world/block-layout-store";
import { planIntercityRoads } from "../src/server/world/intercity-road-planner";
import { readCountryRoads, synchronizeCountryRoads } from "../src/server/world/intercity-road-store";

describe("canonical country road snapshots", () => {
  let db: Db, countryId: string;
  const dryPlanner: typeof planIntercityRoads = input => planIntercityRoads({ ...input, isBuildable: () => true });
  beforeEach(async () => {
    db = await createTestDb();
    countryId = (await registerUser(db, { email: "road-store@example.com", name: "Road store", password: "password123" })).user.countryId;
    await db.prepare("UPDATE countries SET seed=424242 WHERE id=?").run(countryId);
  });
  afterEach(async () => { await db?.close(); });
  async function city(x: number) {
    const id = randomUUID(), districtId = randomUUID(), taskId = randomUUID();
    const layout = compileBlockLayout({ countryId, cityId: id, seed: 424242, revision: 1, origin: { x, y: 0 },
      districts: [{ id: districtId, archetype: "MIXED_URBAN", sequence: 0,
        tasks: [{ id: taskId, taskNumber: x + 1, buildingFamily: "compact-apartment-v1", facadeVariant: "south", constructionStage: 5 }] }] });
    await db.prepare(`INSERT INTO cities_v3(id,country_id,name,status,center_x,center_y,bounds_json,style_id,created_at)
      VALUES(?,?,'Road city','ACTIVE',?,0,?::jsonb,'compact-cartoon',now())`).run(id, countryId, x, JSON.stringify(layout.bounds));
    await db.prepare(`INSERT INTO districts_v3(id,city_id,name,status,growth_direction,color,created_at)
      VALUES(?,?,'Road district','PLANNED','E','#fff',now())`).run(districtId, id);
    await db.prepare(`INSERT INTO tasks_v3(id,task_number,city_id,district_id,title,estimate,building_type,platform_type,visual_kind,visual_asset_key,created_at,updated_at)
      VALUES(?,?,?,?,'Road task',1,'compact-apartment-v1','GRASS','BUILDING','compact-apartment-v1',now(),now())`).run(taskId, x + 1, id, districtId);
    await persistReadyBlockLayout(db, layout, new Date().toISOString());
    await activateBlockLayout(db, layout.id, new Date().toISOString());
    return id;
  }
  it("persists real routes, reuses unchanged topology without invoking the planner, and appends without moving roads", async () => {
    await city(0); await city(96);
    const first = await synchronizeCountryRoads(db, countryId, dryPlanner);
    expect(first.plan.routes).toHaveLength(1);
    expect(await readCountryRoads(db, countryId)).toEqual(first);
    const same = await synchronizeCountryRoads(db, countryId, () => { throw new Error("Unchanged topology must not replan"); });
    expect(same).toEqual(first);
    await city(192);
    const next = await synchronizeCountryRoads(db, countryId, dryPlanner);
    expect(next.revision).toBe(first.revision + 1);
    expect(next.plan.routes).toHaveLength(2);
    expect(next.plan.routes).toEqual(expect.arrayContaining(first.plan.routes));
    expect(next.plan.components).toHaveLength(1);
  });
  it("rolls back a snapshot with its caller and removes only routes incident to an explicitly deleted city", async () => {
    const a = await city(0), b = await city(96); await city(192);
    const first = await synchronizeCountryRoads(db, countryId, dryPlanner);
    await expect(transaction(db, async () => {
      await db.prepare("DELETE FROM cities_v3 WHERE id=?").run(a);
      await synchronizeCountryRoads(db, countryId, dryPlanner);
      throw new Error("rollback fixture");
    })).rejects.toThrow("rollback fixture");
    expect(await readCountryRoads(db, countryId)).toEqual(first);
    await db.prepare("DELETE FROM cities_v3 WHERE id=?").run(b);
    const next = await synchronizeCountryRoads(db, countryId, dryPlanner);
    expect(next.plan.routes.every(route => route.fromCityId !== b && route.toCityId !== b)).toBe(true);
    const retained = first.plan.routes.filter(route => route.fromCityId !== b && route.toCityId !== b);
    expect(next.plan.routes).toEqual(expect.arrayContaining(retained));
    expect(next.plan.components).toHaveLength(1);
  });
  it("isolates countries and never serves a route from a missing country", async () => {
    await city(0); await city(96);
    await synchronizeCountryRoads(db, countryId, dryPlanner);
    expect(await readCountryRoads(db, "unrelated")).toBeUndefined();
    await expect(synchronizeCountryRoads(db, "unrelated", dryPlanner)).rejects.toThrow(/country/i);
  });
});
