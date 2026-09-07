import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { AppService } from "../src/server/app-service";
import { registerUser } from "../src/server/auth";
import { createTestDb } from "../src/server/db";
import { TASK_PARK_VARIANTS } from "../src/shared/task-park-catalog";

it("upgrades the populated26 park constraint without changing tasks or spatial rows", async () => {
  const db = await createTestDb();
  try {
    const service = new AppService(db);
    const { countryId } = (await registerUser(db, { email: "park-upgrade@example.test", name: "Upgrade", password: "password123" })).user;
    await db.prepare("UPDATE countries SET seed=424242 WHERE id=?").run(countryId);
    const city = await service.createCity(countryId, { name: "Existing town", idempotencyKey: "city" });
    const district = await service.createDistrict(countryId, { cityId: city.id, name: "Existing sprint", activate: true, idempotencyKey: "district" });
    const park = await service.createTask(countryId, { cityId: city.id, districtId: district.id, title: "Existing park", estimate: 1, parkVariant: "urban-formal", idempotencyKey: "park" });
    // Migration27 changes only this check: replay its exact populated26 input
    // boundary in the disposable schema, not a production schema downgrade.
    await db.exec(`ALTER TABLE tasks_v3 DROP CONSTRAINT tasks_v3_park_asset_check;
      ALTER TABLE tasks_v3 ADD CONSTRAINT tasks_v3_park_asset_check CHECK (
        (visual_kind='BUILDING' AND visual_asset_key=building_type) OR
        (visual_kind='PARK' AND visual_asset_key IN ('urban-formal','urban-community','urban-central','urban-botanical','urban-amusement','urban-park')))`);
    await expect(db.prepare("UPDATE tasks_v3 SET visual_asset_key='urban-lake' WHERE id=?").run(park.id)).rejects.toMatchObject({ code: "23514" });
    const beforeTask = await service.getTask(countryId, park.id);
    const beforeBlocks = await db.prepare("SELECT * FROM city_blocks_v1 ORDER BY id").all();
    const beforeRoads = await db.prepare("SELECT * FROM road_networks_v1 ORDER BY id").all();
    await db.exec(await readFile(new URL("../migrations/postgres/0027_task_public_spaces.sql", import.meta.url), "utf8"));
    expect(await new AppService(db).getTask(countryId, park.id)).toEqual(beforeTask);
    expect(await db.prepare("SELECT * FROM city_blocks_v1 ORDER BY id").all()).toEqual(beforeBlocks);
    expect(await db.prepare("SELECT * FROM road_networks_v1 ORDER BY id").all()).toEqual(beforeRoads);
    for (const variant of TASK_PARK_VARIANTS) await db.prepare("UPDATE tasks_v3 SET visual_asset_key=? WHERE id=?").run(variant, park.id);
    await expect(db.prepare("UPDATE tasks_v3 SET visual_asset_key='unknown' WHERE id=?").run(park.id)).rejects.toMatchObject({ code: "23514" });
    await expect(db.prepare("UPDATE tasks_v3 SET visual_asset_key=NULL WHERE id=?").run(park.id)).rejects.toMatchObject({ code: "23514" });
    await expect(db.prepare("UPDATE tasks_v3 SET visual_kind='BUILDING' WHERE id=?").run(park.id)).rejects.toMatchObject({ code: "23514" });
  } finally { await db.close(); }
}, 30_000);
