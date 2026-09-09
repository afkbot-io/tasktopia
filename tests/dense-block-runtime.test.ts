import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppService } from "../src/server/app-service";
import { registerUser } from "../src/server/auth";
import { createTestDb, type Db } from "../src/server/db";
import { blockTaskGeometry, readActiveBlockLayout, synchronizeCityBlocks } from "../src/server/world/active-block-layout";
import { getBuilding } from "../src/shared/catalog";
import { auditWorld } from "../src/server/world/world-audit";
import { synchronizeCountryRoads } from "../src/server/world/intercity-road-store";
import type { TaskDto } from "../src/shared/contracts";
import { requestErrorStatus } from "../src/server/routes";
import { blockSlots } from "../src/shared/block-templates";

describe("persisted dense slot planning", { timeout: 60_000 }, () => {
  let db: Db; let service: AppService; let countryId: string;
  beforeEach(async () => {
    db = await createTestDb(); service = new AppService(db);
    countryId = (await registerUser(db, { email: "dense-runtime@test.local", name: "Dense runtime", password: "password123" })).user.countryId;
    await db.prepare("UPDATE countries SET seed=9 WHERE id=?").run(countryId);
  });
  afterEach(async () => { await db?.close(); });

  it("persists AUTO parks, mixed family footprints, reservations and stages across reader/rebuild boundaries", async () => {
    const city = await service.createCity(countryId, { name: "Dense city", idempotencyKey: "city" });
    const district = await service.createDistrict(countryId, { cityId: city.id, name: "Dense district", activate: true, idempotencyKey: "district" });
    const created: TaskDto[] = [];
    // AUTO consumes real park reservations too. Larger V3 shapes can leave
    // more park parcels than homes; do not assume a 1:1 task/building ratio.
    // Keep a finite fixture budget and the exact 20-building assertion below.
    while (created.filter(t => t.visualKind === "BUILDING").length < 20 && created.length < 80) {
      const number = created.length + 1;
      created.push(await service.createTask(countryId, { cityId: city.id, districtId: district.id,
        title: `Работа ${number}`, estimate: 1, idempotencyKey: `task-${number}` }));
    }
    const buildings = created.filter(t => t.visualKind === "BUILDING");
    expect(buildings).toHaveLength(20);
    expect(created.some(t => t.visualKind === "PARK")).toBe(true);
    expect(new Set(buildings.map(t => t.buildingType)).size).toBeGreaterThanOrEqual(2);
    for (const task of buildings) {
      const shape = getBuilding(task.buildingType).footprint;
      expect(shape).toBeDefined(); expect(task.footprint).toHaveLength(shape.width * shape.height);
    }
    for (const [index, role] of [[8, "EDUCATION"], [11, "MEDICAL"], [15, "FIRE"], [19, "POLICE"]] as const) {
      expect(buildings[index]!.serviceRole).toBe(role);
    }
    const before = (await readActiveBlockLayout(db, city.id))!;
    const geometry = blockTaskGeometry(before);
    expect(before.placements).toHaveLength(created.length);
    for (const task of created) {
      expect(geometry.get(task.id)!.origin).toEqual(task.origin);
      const stored = await db.prepare("SELECT visual_kind,visual_auto,building_type FROM tasks_v3 WHERE id=?").get(task.id);
      expect(stored).toEqual({ visual_kind: task.visualKind, visual_auto: true, building_type: task.buildingType });
      expect((await new AppService(db).getTask(countryId, task.id)).serviceRole).toBe(task.serviceRole);
    }
    const started = await service.updateTaskStatus(countryId, { taskId: buildings[8]!.id, status: "STARTED", idempotencyKey: "school-start" });
    expect(started.serviceRole).toBe("EDUCATION"); expect(started.origin).toEqual(buildings[8]!.origin);
    const saved = (await readActiveBlockLayout(db, city.id))!;
    const synchronized = await synchronizeCityBlocks(db, countryId, city.id);
    expect(synchronized.placements).toEqual(saved.placements);
    expect(synchronized.blocks.map(b => ({ id: b.id, origin: b.origin, parameters: b.parameters })))
      .toEqual(saved.blocks.map(b => ({ id: b.id, origin: b.origin, parameters: b.parameters })));
    // An explicit cutover may replan derived parcels; it must retain the task
    // and infrastructure identities, then reproduce that same rebuilt plan.
    const rebuilt = await synchronizeCityBlocks(db, countryId, city.id, true);
    const identities = (layout: typeof rebuilt) => layout.placements.map(p => ({
      taskId: p.taskId, constructionStage: p.constructionStage, serviceRole: p.serviceRole,
      ...(p.serviceRole ? { buildingFamily: p.buildingFamily } : {}),
    }));
    expect(identities(rebuilt)).toEqual(identities(saved));
    expect((await readActiveBlockLayout(db, city.id))!.placements).toEqual(rebuilt.placements);
    const replay = await synchronizeCityBlocks(db, countryId, city.id, true);
    expect(replay.placements).toEqual(rebuilt.placements);
    expect(replay.blocks).toEqual(rebuilt.blocks);
    // Low-level reset defers country routing until all cities are rebuilt,
    // just as AppService.regenerateCountry does in its transaction.
    await synchronizeCountryRoads(db, countryId);
    expect((await auditWorld(db, new AppService(db), countryId)).violations).toEqual([]);
  });

  it("honors persisted explicit family intent while a compatible current slot is available", async () => {
    const city = await service.createCity(countryId, { name: "Explicit city", idempotencyKey: "city" });
    const district = await service.createDistrict(countryId, { cityId: city.id, name: "Explicit district", activate: true, idempotencyKey: "district" });
    const first = await service.createTask(countryId, { cityId: city.id, districtId: district.id, title: "Явный дом", estimate: 1,
      buildingHint: "compact-apartment-v1", idempotencyKey: "requested" });
    expect(await db.prepare("SELECT visual_auto,requested_building_family FROM tasks_v3 WHERE id=?").get(first.id))
      .toEqual({ visual_auto: false, requested_building_family: "compact-apartment-v1" });
    expect(first.buildingType).toBe("compact-apartment-v1");
    const regenerated = await synchronizeCityBlocks(db, countryId, city.id, true);
    expect(regenerated.placements[0]!.buildingFamily).toBe("compact-apartment-v1");
    expect(blockTaskGeometry(regenerated).get(first.id)!.footprint).toHaveLength(36);
  });

  it("rebuilds interleaved district tasks in durable numeric order without changing infrastructure identity", async () => {
    const city = await service.createCity(countryId, { name: "Interleaved city", idempotencyKey: "city" });
    const districts = [];
    for (let n = 0; n < 3; n++) districts.push(await service.createDistrict(countryId, {
      cityId: city.id, name: `Район ${n}`, activate: n === 0, idempotencyKey: `district-${n}`,
    }));
    for (let n = 1; n <= 45; n++) await service.createTask(countryId, {
      cityId: city.id, districtId: districts[(n - 1) % 3]!.id, title: `Корпус ${n}`,
      estimate: 1, visualKind: "BUILDING", idempotencyKey: `interleaved-${n}`,
    });
    const before = (await readActiveBlockLayout(db, city.id))!;
    expect(before.placements.filter(p => p.serviceRole === "RAILWAY")).toHaveLength(1);
    expect(before.placements.filter(p => p.serviceRole === "AIRPORT")).toHaveLength(1);
    const tasks = await service.listTasks(countryId);
    const synchronized = await synchronizeCityBlocks(db, countryId, city.id);
    expect(synchronized.placements).toEqual(before.placements);
    expect([...synchronized.blocks].sort((a, b) => a.id.localeCompare(b.id)))
      .toEqual([...before.blocks].sort((a, b) => a.id.localeCompare(b.id)));
    const rebuilt = await synchronizeCityBlocks(db, countryId, city.id, true);
    const roles = (layout: typeof rebuilt) => layout.placements.map(p => ({
      taskId: p.taskId, constructionStage: p.constructionStage, serviceRole: p.serviceRole,
      ...(p.serviceRole ? { buildingFamily: p.buildingFamily } : {}),
    }));
    expect(roles(rebuilt)).toEqual(roles(before));
    const identity = (task: TaskDto) => ({ id: task.id, taskNumber: task.taskNumber, title: task.title,
      cityId: task.cityId, districtId: task.districtId, status: task.status, serviceRole: task.serviceRole });
    expect((await new AppService(db).listTasks(countryId)).map(identity)).toEqual(tasks.map(identity));
    const replay = await synchronizeCityBlocks(db, countryId, city.id, true);
    expect(replay.placements).toEqual(rebuilt.placements);
    expect(replay.blocks).toEqual(rebuilt.blocks);
    expect(replay.roadNetwork).toEqual(rebuilt.roadNetwork);
  });

  it("rolls back a conflicting family hint instead of bypassing the reserved ninth-building school", async () => {
    const city = await service.createCity(countryId, { name: "Reserved city", idempotencyKey: "city" });
    const district = await service.createDistrict(countryId, { cityId: city.id, name: "Reserved district", activate: true, idempotencyKey: "district" });
    for (let n = 1; n <= 8; n++) await service.createTask(countryId, { cityId: city.id, districtId: district.id, title: `Корпус ${n}`,
      estimate: 1, visualKind: "BUILDING", idempotencyKey: `explicit-${n}` });
    const before = await readActiveBlockLayout(db, city.id);
    const reserved = before!.blocks.flatMap(block => blockSlots(block).map(slot => ({ block, slot })))
      .find(({ slot }) => slot.serviceRole === "EDUCATION")!;
    expect(reserved).toBeDefined();
    const incompatible = ["compact-apartment-v1", "compact-row-v1", "compact-wide-v1"]
      .find(family => getBuilding(family).footprint.width * getBuilding(family).footprint.height !== reserved.slot.footprint.length)!;
    expect(incompatible).toBeDefined();
    const error = await service.createTask(countryId, { cityId: city.id, districtId: district.id, title: "Несовместимый корпус", estimate: 1,
      buildingHint: incompatible, idempotencyKey: "conflicting-hint" }).catch((error: unknown) => error);
    expect(error).toMatchObject({ code: "INFRASTRUCTURE_RESERVATION_CONFLICT", message: expect.stringContaining("зарезервирован под инфраструктуру") });
    expect(requestErrorStatus(error)).toBe(400);
    expect(await service.listTasks(countryId)).toHaveLength(8);
    expect(await readActiveBlockLayout(db, city.id)).toEqual(before);
    const school = await service.createTask(countryId, { cityId: city.id, districtId: district.id, title: "Новый корпус", estimate: 1,
      visualKind: "BUILDING", idempotencyKey: "school" });
    expect(school.serviceRole).toBe("EDUCATION"); expect(school.footprint).toEqual(reserved.slot.footprint);
  });
});
