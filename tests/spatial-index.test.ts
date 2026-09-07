import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerUser } from "../src/server/auth";
import { AppService } from "../src/server/app-service";
import { createTestDb, transaction, type Db } from "../src/server/db";
import { compileBlockLayout } from "../src/server/world/block-layout-compiler";
import { activateBlockLayout, persistReadyBlockLayout } from "../src/server/world/block-layout-store";

describe("canonical block spatial read model", () => {
  let db: Db;

  beforeEach(async () => { db = await createTestDb(); });
  afterEach(async () => await db.close());

  it("tracks negative chunk boundaries and replacement layouts without stale task memberships", async () => {
    const account = await registerUser(db, { email: "spatial@example.test", name: "Spatial Owner", password: "safe-password-123" });
    const countryId = account.user.countryId;
    const cityId = randomUUID(), districtId = randomUUID(), taskId = randomUUID();
    const createdAt = new Date().toISOString();
    await db.prepare(`INSERT INTO cities_v3
      (id,country_id,name,status,center_x,center_y,bounds_json,style_id,created_at)
      VALUES (?,?,'Negative City','ACTIVE',-72,-8,'{}'::jsonb,'block-v1',?)`)
      .run(cityId, countryId, createdAt);
    await db.prepare(`INSERT INTO districts_v3
      (id,city_id,name,status,growth_direction,archetype,color,created_at)
      VALUES (?,?,'Negative District','ACTIVE','E','MIXED_URBAN','#fff',?)`)
      .run(districtId, cityId, createdAt);
    await db.prepare(`INSERT INTO tasks_v3
      (id,task_number,city_id,district_id,title,estimate,building_type,platform_type,visual_kind,visual_asset_key,created_at,updated_at)
      VALUES (?,1,?,?,'Indexed task',1,'compact-apartment-v1','STONE','BUILDING','compact-apartment-v1',?,?)`)
      .run(taskId, cityId, districtId, createdAt, createdAt);

    // This storage/query fixture deliberately chooses negative chunk edges;
    // terrain site selection has separate compiler and runtime coverage.
    const publish = async (origin: { x: number; y: number }, revision: number) => {
      const layout = compileBlockLayout({
        // NW packing deliberately straddles both negative chunk boundaries.
        countryId, cityId, seed: 0, revision, origin,
        districts: [{ id: districtId, sequence: 0, archetype: "MIXED_URBAN", tasks: [{
          id: taskId, taskNumber: 1, buildingFamily: "compact-apartment-v1", facadeVariant: "south", constructionStage: 1,
        }] }],
      });
      await transaction(db, async () => {
        await db.prepare("DELETE FROM city_layouts_v1 WHERE city_id=?").run(cityId);
        await persistReadyBlockLayout(db, layout, createdAt);
        await activateBlockLayout(db, layout.id, createdAt);
        await db.prepare("UPDATE cities_v3 SET center_x=?,center_y=?,bounds_json=?::jsonb WHERE id=?")
          .run(origin.x, origin.y, JSON.stringify(layout.bounds), cityId);
        await db.prepare("UPDATE countries SET world_version=world_version+1 WHERE id=?").run(countryId);
        // Match the atomic invalidation performed by canonical mutations.
        await db.prepare("DELETE FROM world_chunk_payloads_v1 WHERE country_id=?").run(countryId);
      });
    };
    await publish({ x: -72, y: -8 }, 1);
    const reader = new AppService(db);
    const negativeChunks = [{ x: -2, y: -1 }, { x: -1, y: -1 }, { x: -2, y: 0 }, { x: -1, y: 0 }];
    for (const coordinate of negativeChunks) {
      const chunk = await reader.getChunk(countryId, coordinate.x, coordinate.y);
      expect(chunk.tasks.find(task => task.id === taskId)?.origin).toEqual({ x: -68, y: -4 });
      expect(chunk.districts.some(district => district.id === districtId)).toBe(true);
    }
    expect((await reader.getChunk(countryId, 2, 2)).tasks).toEqual([]);

    await publish({ x: 128, y: 128 }, 2);

    for (const coordinate of negativeChunks) {
      const chunk = await reader.getChunk(countryId, coordinate.x, coordinate.y);
      expect(chunk.tasks.some(task => task.id === taskId)).toBe(false);
      expect(chunk.districts.some(district => district.id === districtId)).toBe(false);
    }
    expect((await reader.getChunk(countryId, 2, 2)).tasks.find(task => task.id === taskId)?.origin)
      .toEqual({ x: 132, y: 132 });
    expect(await db.prepare("SELECT COUNT(*)::integer AS count FROM task_placements_v1 WHERE task_id=?").get(taskId))
      .toEqual({ count: 1 });

    await transaction(db, async () => {
      await db.prepare("DELETE FROM tasks_v3 WHERE id=?").run(taskId);
      await db.prepare("UPDATE countries SET world_version=world_version+1 WHERE id=?").run(countryId);
      await db.prepare("DELETE FROM world_chunk_payloads_v1 WHERE country_id=?").run(countryId);
    });
    expect(await db.prepare("SELECT 1 FROM task_placements_v1 WHERE task_id=?").get(taskId)).toBeUndefined();
    expect((await reader.getChunk(countryId, 2, 2)).tasks).toEqual([]);
  });
});
