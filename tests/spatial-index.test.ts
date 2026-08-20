import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerUser } from "../src/server/auth";
import { AppService } from "../src/server/app-service";
import { createTestDb, type Db } from "../src/server/db";

describe("world chunk spatial read model", () => {
  let db: Db;

  beforeEach(async () => { db = await createTestDb(); });
  afterEach(async () => await db.close());

  it("tracks negative coordinates and geometry updates without stale memberships", async () => {
    const account = await registerUser(db, { email: "spatial@example.test", name: "Spatial Owner", password: "safe-password-123" });
    const countryId = account.user.countryId;
    const cityId = randomUUID();
    const districtId = randomUUID();
    const taskId = randomUUID();
    const createdAt = new Date().toISOString();
    await db.prepare(`INSERT INTO cities_v3
      (id, country_id, name, description, status, center_x, center_y, bounds_json, style_id, morphology, created_at)
      VALUES (?, ?, 'Negative City', '', 'ACTIVE', -64, -64, ?, 'default', 'BALANCED', ?)`)
                              .run(cityId, countryId, JSON.stringify({ minX: -128, minY: -128, maxX: 127, maxY: 127 }), createdAt);
    await db.prepare(`INSERT INTO districts_v3
      (id, city_id, name, goal, status, capacity_sp, cells_json, lots_json, growth_direction, archetype, color, created_at)
      VALUES (?, ?, 'Negative District', '', 'ACTIVE', 14, ?, '[]', 'E', 'MIXED_URBAN', '#fff', ?)`)
                              .run(districtId, cityId, JSON.stringify([{ x: -65, y: -1 }, { x: -64, y: 0 }]), createdAt);
    await db.prepare(`INSERT INTO tasks_v3
      (id, task_number, city_id, district_id, title, estimate, building_type, platform_type, origin_x, origin_y, footprint_json, access_json, created_at, updated_at)
      VALUES (?, 1, ?, ?, 'Indexed task', 1, 'house-small-blue', 'YARD', -65, -1, ?, ?, ?, ?)`)
                              .run(taskId, cityId, districtId, JSON.stringify([{ x: -65, y: -1 }]), JSON.stringify([{ x: -64, y: -1 }]), createdAt, createdAt);

    const memberships = async () => await db.prepare(`SELECT chunk_x, chunk_y FROM world_chunk_entities_v11
      WHERE entity_kind = 'TASK' AND entity_id = ? ORDER BY chunk_x, chunk_y`).all(taskId);
    expect(await memberships()).toEqual([{ chunk_x: -2, chunk_y: -1 }, { chunk_x: -1, chunk_y: -1 }]);
    expect(await db.prepare(`SELECT chunk_x, chunk_y, cells_json FROM world_chunk_district_cells_v1
      WHERE district_id = ? ORDER BY chunk_x, chunk_y`).all(districtId)).toEqual([
      { chunk_x: -2, chunk_y: -1, cells_json: [{ x: -65, y: -1 }] },
      { chunk_x: -1, chunk_y: 0, cells_json: [{ x: -64, y: 0 }] },
    ]);

    await db.prepare("UPDATE tasks_v3 SET origin_x = 128, origin_y = 128, footprint_json = ?, access_json = ? WHERE id = ?")
                              .run(JSON.stringify([{ x: 128, y: 128 }]), JSON.stringify([{ x: 129, y: 128 }]), taskId);
    expect(await memberships()).toEqual([{ chunk_x: 2, chunk_y: 2 }]);
    expect((await new AppService(db).getChunk(countryId, 2, 2)).tasks.map((task) => task.id)).toContain(taskId);

    await db.prepare("UPDATE districts_v3 SET cells_json = ? WHERE id = ?")
      .run(JSON.stringify([{ x: 128, y: 128 }]), districtId);
    expect(await db.prepare(`SELECT chunk_x, chunk_y FROM world_chunk_district_cells_v1
      WHERE district_id = ?`).all(districtId)).toEqual([{ chunk_x: 2, chunk_y: 2 }]);

    await db.prepare("DELETE FROM tasks_v3 WHERE id = ?").run(taskId);
    expect(await memberships()).toEqual([]);
  });
});
