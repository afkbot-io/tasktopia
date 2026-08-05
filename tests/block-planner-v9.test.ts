import { afterEach, describe, expect, it } from "vitest";
import { AppService } from "../src/server/app-service";
import { registerUser } from "../src/server/auth";
import { createTestDb, type Db } from "../src/server/db";
import { planBlockDistrict } from "../src/server/world/block-planner";
import { ROAD_WIDTH } from "../src/server/world/city-generation";
import { boundsOf, cellKey, contains, rectangleFootprint } from "../src/server/world/grid";
import { stampRoadCorridor } from "../src/server/world/road-geometry";

describe("V9 block city generation", () => {
  let db: Db | undefined;

  afterEach(async () => await db?.close());

  it("plans nine dense primary slots around shared paths with one frontage road", () => {
    const origin = { x: 20, y: 30 };
    const cells = rectangleFootprint(origin, 42, 28);
    const plan = planBlockDistrict({
      districtId: "district",
      origin,
      width: 42,
      height: 28,
      cells,
      archetype: "NEW_BUILD",
    });
    const primary = plan.lots.filter((lot) => lot.role === "PRIMARY");
    const support = plan.lots.filter((lot) => lot.role === "SUPPORT");
    const roadCells = stampRoadCorridor(plan.main, "LOCAL", ROAD_WIDTH);
    expect(plan.pattern).toBe("DENSE_SUPERBLOCK_3X3");
    expect(plan.branches).toEqual([]);
    expect(primary).toHaveLength(9);
    expect(support).toHaveLength(3);
    expect(new Set(primary.map((lot) => lot.rowIndex))).toEqual(new Set([0, 1, 2]));
    expect(primary.every((lot) => lot.sharedAccess && lot.sharedAccess.length > 0)).toBe(true);
    expect(roadCells.length / cells.length).toBeLessThan(0.2);
  });

  it("varies private frontage and leaves front homes for individual entrance paths", () => {
    const origin = { x: 20, y: 30 };
    const cells = rectangleFootprint(origin, 42, 28);
    const first = planBlockDistrict({ districtId: "private-a", origin, width: 42, height: 28, cells, archetype: "PRIVATE", groupOffset: 0 });
    const mirrored = planBlockDistrict({ districtId: "private-b", origin, width: 42, height: 28, cells, archetype: "PRIVATE", groupOffset: 1 });
    expect(first.main[0]!.y).toBeGreaterThan(mirrored.main[0]!.y);
    expect(first.lots.filter((lot) => lot.rowIndex === 2).every((lot) => lot.sharedAccess?.length === 0)).toBe(true);
    expect(mirrored.lots.every((lot) => lot.frontageSide === "N")).toBe(true);
  });

  it("fills a 3x3 high-rise group automatically without changing its road network", async () => {
    db = await createTestDb();
    const registered = await registerUser(db, {
      email: "block-v9@tasktopia.local",
      name: "Block V9",
      password: "block-v9-password",
    });
    await db.prepare("UPDATE countries SET seed = 909090 WHERE id = ?").run(registered.user.countryId);
    const service = new AppService(db);
    const city = await service.createCity(registered.user.countryId, { name: "Квартальный", morphology: "DENSE_CORE", idempotencyKey: "city" });
    const district = await service.createDistrict(registered.user.countryId, {
                      cityId: city.id,
                      name: "Новые высотки",
                      archetype: "NEW_BUILD",
                      capacitySp: 26,
                      activate: true,
                      idempotencyKey: "district",
                    });
    const beforeBounds = boundsOf(district.cells);
    const countRoads = async () => {
      const rows = await db!.prepare("SELECT x, y FROM roads_v3 WHERE country_id = ?").all<{ x: number; y: number }>(registered.user.countryId);
      return rows.filter((road) => contains(beforeBounds, road)).length;
    };
    const roadsBefore = await countRoads();
    const estimates = [2, 3, 2, 3, 6, 2, 3, 2, 3] as const;
    for (let index = 0; index < estimates.length; index += 1) {
      await service.createTask(registered.user.countryId, {
                                        cityId: city.id,
                                        districtId: district.id,
                                        title: `Жилой корпус ${index + 1}`,
                                        description: "Новый жилой корпус единого квартала.",
                                        estimate: estimates[index]!,
                                        idempotencyKey: `task-${index}`,
                                      });
    }

    const updated = (await service.listDistricts(registered.user.countryId, city.id))[0]!;
    const occupied = updated.lots.filter((lot) => lot.role === "PRIMARY" && lot.taskId);
    expect(occupied).toHaveLength(9);
    expect(new Set(occupied.map((lot) => lot.groupId)).size).toBe(1);
    expect(boundsOf(updated.cells)).toEqual(beforeBounds);
    expect(await countRoads()).toBe(roadsBefore);
    for (const rowIndex of [0, 1, 2]) {
      const row = occupied.filter((lot) => lot.rowIndex === rowIndex).sort((left, right) => (left.slotIndex ?? 0) - (right.slotIndex ?? 0));
      expect(row).toHaveLength(3);
      expect(row[0]!.origin.x + row[0]!.width).toBe(row[1]!.origin.x);
      expect(row[1]!.origin.x + row[1]!.width).toBe(row[2]!.origin.x);
      const alignment = row[0]!.frontageSide === "N"
        ? row.map((lot) => lot.origin.y)
        : row.map((lot) => lot.origin.y + lot.height);
      expect(new Set(alignment).size).toBe(1);
    }
    const tasks = await service.listTasks(registered.user.countryId, district.id);
    expect(tasks).toHaveLength(9);
    expect(new Set(tasks.map((task) => task.buildingType.startsWith("highrise-") || task.buildingType.startsWith("house-") ? "residential" : task.buildingType))).toEqual(new Set(["residential"]));
    expect(new Set(tasks.flatMap((task) => task.footprint.map(cellKey))).size).toBe(tasks.reduce((sum, task) => sum + task.footprint.length, 0));
  });

  it("uses spare civic strip slots before growing a non-residential district", async () => {
    db = await createTestDb();
    const registered = await registerUser(db, {
      email: "civic-block-v9@tasktopia.local",
      name: "Civic Block V9",
      password: "civic-block-password",
    });
    await db.prepare("UPDATE countries SET seed = 1 WHERE id = ?").run(registered.user.countryId);
    const service = new AppService(db);
    const city = await service.createCity(registered.user.countryId, { name: "Гражданский", idempotencyKey: "city" });
    const district = await service.createDistrict(registered.user.countryId, {
                      cityId: city.id, name: "Общественный центр", archetype: "CIVIC", capacitySp: 10, activate: true, idempotencyKey: "district",
                    });
    const beforeBounds = boundsOf(district.cells);
    for (let index = 0; index < 5; index += 1) {
      await service.createTask(registered.user.countryId, {
                                        cityId: city.id, districtId: district.id, title: `Общественная парковка ${index + 1}`,
                                        estimate: 1, buildingHint: "commercial-parking-lot", idempotencyKey: `task-${index}`,
                                      });
    }
    const updated = (await service.listDistricts(registered.user.countryId, city.id))[0]!;
    expect(boundsOf(updated.cells)).toEqual(beforeBounds);
    expect(updated.lots.filter((lot) => lot.taskId)).toHaveLength(5);
    expect(updated.lots.some((lot) => lot.role === "PRIMARY" && lot.taskId)).toBe(true);
  });
});
