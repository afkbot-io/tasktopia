import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppService } from "../src/server/app-service";
import { registerUser } from "../src/server/auth";
import { createTestDb, type Db } from "../src/server/db";
import * as layouts from "../src/server/world/active-block-layout";
import { BlockPlacementError } from "../src/server/world/block-layout-compiler";
import { requestErrorStatus } from "../src/server/routes";

describe("compact city capacity failures", { timeout: 30_000 }, () => {
  let db: Db;
  beforeEach(async () => { db = await createTestDb(); });
  afterEach(async () => { vi.restoreAllMocks(); await db?.close(); });

  it.each([
    [new BlockPlacementError("No dry connected rectangle"), "PLACEMENT_UNAVAILABLE"],
    [new layouts.CitySceneCapacityError("Scene limit"), "CAPACITY_EXCEEDED"],
  ])("rolls back the task and exposes %s as a domain error", async (failure, code) => {
    const countryId = (await registerUser(db, { email: "capacity@example.com", name: "Builder", password: "password123" })).user.countryId;
    await db.prepare("UPDATE countries SET seed=424242 WHERE id=?").run(countryId);
    const service = new AppService(db);
    const city = await service.createCity(countryId, { name: "Capacity city", idempotencyKey: "city" });
    const district = await service.createDistrict(countryId, { cityId: city.id, name: "District", activate: true, idempotencyKey: "district" });
    const before = await layouts.readActiveBlockLayout(db, city.id);
    const eventCount = await db.prepare("SELECT COUNT(*) AS count FROM events WHERE country_id=?").get(countryId);
    vi.spyOn(layouts, "synchronizeCityBlocks").mockRejectedValueOnce(failure);

    const error = await service.createTask(countryId, {
      cityId: city.id, districtId: district.id, title: "Cannot fit", estimate: 1, idempotencyKey: "exhausted-task",
    }).catch((value: unknown) => value);
    expect(error).toMatchObject({ code });
    expect(requestErrorStatus(error)).toBe(400);
    expect(await service.listTasks(countryId)).toEqual([]);
    expect(await layouts.readActiveBlockLayout(db, city.id)).toEqual(before);
    expect(await db.prepare("SELECT COUNT(*) AS count FROM events WHERE country_id=?").get(countryId)).toEqual(eventCount);
    expect(await db.prepare("SELECT 1 FROM idempotency WHERE country_id=? AND idempotency_key=?").get(countryId, "exhausted-task")).toBeUndefined();
  });
});
