import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { AppService, DomainError } from "../src/server/app-service";
import { createMcpToken, hashToken, registerUser } from "../src/server/auth";
import { createTestDb, transaction, type Db } from "../src/server/db";
import { GRID_DIRECTIONS, boundsOf, cellKey, connected, manhattan } from "../src/server/world/grid";
import { isWater, terrainAt } from "../src/server/world/terrain";

describe("Tasktopia square-world application service", () => {
  let db: Db;
  let service: AppService;
  let countryId: string;

  beforeEach(async () => {
    db = await createTestDb();
    service = new AppService(db);
    countryId = (await registerUser(db, { email: "test@example.com", name: "Tester", password: "password123" })).user.countryId;
  });

  afterEach(async () => await db.close());

  it("creates an idempotent city with reciprocal square-road masks", async () => {
    await db.prepare("UPDATE countries SET seed = ? WHERE id = ?").run(424_242, countryId);
    const input = { name: "Northpoint", idempotencyKey: "city-key" };
    const first = await service.createCity(countryId, input);
    const second = await service.createCity(countryId, input);
    expect(second.id).toBe(first.id);
    expect(first.bounds.maxX - first.bounds.minX + 1).toBe(100);
    const cityRoads = await db.prepare("SELECT x, y FROM roads_v3 WHERE country_id = ? AND x BETWEEN ? AND ? AND y BETWEEN ? AND ?")
                      .all(countryId, first.bounds.minX, first.bounds.maxX, first.bounds.minY, first.bounds.maxY) as Array<{ x: number; y: number }>;
    const spanX = Math.max(...cityRoads.map((road) => road.x)) - Math.min(...cityRoads.map((road) => road.x)) + 1;
    const spanY = Math.max(...cityRoads.map((road) => road.y)) - Math.min(...cityRoads.map((road) => road.y)) + 1;
    expect(Math.max(spanX, spanY)).toBeLessThan(70);
    const worldRoadExtent = await db.prepare("SELECT MIN(x) AS min_x FROM roads_v3 WHERE country_id = ?").get(countryId) as { min_x: number };
    expect(Number(worldRoadExtent.min_x)).toBeLessThanOrEqual(first.bounds.minX - 54);
    const roadMap = new Map((await service.getChunk(countryId, 0, 0)).roads.map((road) => [cellKey(road), road]));
    for (const road of roadMap.values()) {
      for (const direction of GRID_DIRECTIONS) {
        if (!(road.mask & direction.bit)) continue;
        const next = roadMap.get(cellKey({ x: road.x + direction.x, y: road.y + direction.y }));
        if (next) expect(next.mask & direction.opposite).not.toBe(0);
      }
    }
  });

  it("renames a city, district, and task with idempotent realtime events", async () => {
    const emitted: string[] = [];
    service = new AppService(db, (event) => emitted.push(event.type));
    const city = await service.createCity(countryId, { name: "Old City", idempotencyKey: "rename-city-create" });
    const district = await service.createDistrict(countryId, { cityId: city.id, name: "Old District", activate: true, idempotencyKey: "rename-district-create" });
    const task = await service.createTask(countryId, { cityId: city.id, districtId: district.id, title: "Old Task", estimate: 1, idempotencyKey: "rename-task-create" });

    const renamedCity = await service.renameCity(countryId, { cityId: city.id, name: "New City", idempotencyKey: "rename-city" });
    const renamedDistrict = await service.renameDistrict(countryId, { districtId: district.id, name: "New District", idempotencyKey: "rename-district" });
    const renamedTask = await service.renameTask(countryId, { taskId: task.id, title: "New Task", actor: "Tester", idempotencyKey: "rename-task" });

    expect(renamedCity.name).toBe("New City");
    expect(renamedDistrict.name).toBe("New District");
    expect(renamedTask.title).toBe("New Task");
    expect(renamedTask.events?.at(-1)).toMatchObject({ type: "TITLE_CHANGED", actor: "Tester", details: { from: "Old Task", to: "New Task" } });
    expect(emitted.slice(-3)).toEqual(["city.renamed", "district.renamed", "task.renamed"]);
    expect(await service.renameTask(countryId, { taskId: task.id, title: "New Task", actor: "Tester", idempotencyKey: "rename-task" })).toEqual(renamedTask);
  });

  it("atomically regenerates spatial data while preserving task identity and history", async () => {
    await service.updateCountryProfile(countryId, { goal: "Release safely", productContext: "AI delivery", idempotencyKey: "regen-country-profile" });
    const deadline = "2026-12-20T12:00:00.000Z";
    const city = await service.createCity(countryId, { name: "Renewable City", goal: "Ship epic", acceptanceCriteria: "Users can finish", deadline, idempotencyKey: "regen-city" });
    const district = await service.createDistrict(countryId, { cityId: city.id, name: "Renewable District", description: "Two-week iteration", deadline, archetype: "PRIVATE", activate: true, idempotencyKey: "regen-district" });
    const task = await service.createTask(countryId, {
      cityId: city.id, districtId: district.id, title: "Preserved work", description: "Keep this", workItemType: "HOTFIX",
      acceptanceCriteria: "Regression is covered", systemAnalysis: "Impact is bounded", architecture: "Patch service boundary",
      designSystem: "Use existing tokens", implementationPlan: "Test, patch, verify", estimate: 1, dueAt: deadline,
      buildingHint: "house-cottage", idempotencyKey: "regen-task",
    });
    // Green areas appear together with the first streets of the first complex.
    const greenFeatures = await service.listWorldFeatures(countryId);
    expect(greenFeatures.some((feature) => feature.kind === "PARK" || feature.kind === "GROVE")).toBe(true);
    expect(greenFeatures.some((feature) => feature.kind === "PARK_DECOR")).toBe(true);
    expect(greenFeatures.filter((feature) => feature.cityId === city.id && feature.kind === "LANDMARK")).toEqual([]);
    const defect = await service.createTaskDefect(countryId, {
      taskId: task.id, title: "Broken path", reproductionSteps: "Open the map", actualResult: "Path breaks", expectedResult: "Path stays whole",
      idempotencyKey: "regen-defect",
    });
    await expect(service.updateTaskDefect(countryId, { defectId: defect.id, reproductionSteps: "   ", idempotencyKey: "regen-defect-empty-steps" }))
      .rejects.toThrowError(/не могут быть пустыми/);
    await service.updateTaskDefect(countryId, { defectId: defect.id, status: "FIXED", idempotencyKey: "regen-defect-fixed" });
    await service.updateTaskStatus(countryId, { taskId: task.id, status: "STARTED", comment: "History survives", actor: "Tester", idempotencyKey: "regen-start" });
    const seedBefore = Number((await db.prepare("SELECT seed FROM countries WHERE id = ?").get(countryId) as { seed: number }).seed);
    const geometryBefore = JSON.stringify({ city: (await service.listCities(countryId))[0]?.center, district: (await service.listDistricts(countryId))[0]?.cells, task: (await service.listTasks(countryId))[0]?.origin });

    const result = await service.regenerateCountry(countryId, { confirmName: "Tester: страна", idempotencyKey: "regenerate-world" });
    expect(await service.regenerateCountry(countryId, { confirmName: "Tester: страна", idempotencyKey: "regenerate-world" })).toEqual(result);
    expect(result).toMatchObject({ regenerated: true, countryId, cities: 1, districts: 1, tasks: 1 });
    expect(result.seed).not.toBe(seedBefore);
    expect((await service.listCities(countryId))[0]?.id).toBe(city.id);
    expect((await service.listDistricts(countryId))[0]?.id).toBe(district.id);
    const preserved = await service.getTask(countryId, task.id);
    expect(await service.getCountry(countryId)).toMatchObject({ goal: "Release safely", productContext: "AI delivery" });
    expect((await service.listCities(countryId))[0]).toMatchObject({ id: city.id, goal: "Ship epic", acceptanceCriteria: "Users can finish", deadline });
    expect((await service.listDistricts(countryId))[0]).toMatchObject({ id: district.id, description: "Two-week iteration", deadline });
    expect(preserved).toMatchObject({
      id: task.id, title: "Preserved work", description: "Keep this", workItemType: "HOTFIX", acceptanceCriteria: "Regression is covered",
      systemAnalysis: "Impact is bounded", architecture: "Patch service boundary", designSystem: "Use existing tokens",
      implementationPlan: "Test, patch, verify", dueAt: deadline, status: "STARTED",
    });
    expect(preserved.defects).toContainEqual(expect.objectContaining({ id: defect.id, status: "FIXED", expectedResult: "Path stays whole", fixedAt: expect.any(String) }));
    expect(preserved.comments?.map((comment) => comment.body)).toContain("History survives");
    expect(preserved.events?.some((event) => event.type === "STATUS_CHANGED")).toBe(true);
    const geometryAfter = JSON.stringify({ city: (await service.listCities(countryId))[0]?.center, district: (await service.listDistricts(countryId))[0]?.cells, task: (await service.listTasks(countryId))[0]?.origin });
    expect(geometryAfter).not.toBe(geometryBefore);
    expect(await db.prepare("SELECT 1 FROM countries WHERE name LIKE 'regeneration-%'").get()).toBeUndefined();
    expect((await service.listEvents(countryId)).filter((event) => event.type === "country.regenerated")).toHaveLength(1);
  }, 30_000);

  it("creates a planned district and advances a sprite building through five stages", async () => {
    const city = await service.createCity(countryId, { name: "Southport", idempotencyKey: "c1" });
    const district = await service.createDistrict(countryId, { cityId: city.id, name: "Core", archetype: "MIXED_URBAN", activate: true, idempotencyKey: "d1" });
    expect(district.cells.length).toBeGreaterThan(250);
    expect(connected(district.cells)).toBe(true);
    // V10: a fresh district is pure territory. Streets and lots appear only
    // together with the first complex grown by the first task.
    expect(district.lots).toEqual([]);
    let task = await service.createTask(countryId, { cityId: city.id, title: "Build cafe", estimate: 2, buildingHint: "commercial-corner-cafe", idempotencyKey: "t1" });
    expect(task.stage).toBe(1);
    expect((await service.listDistricts(countryId, city.id)).find((item) => item.id === district.id)?.lots.length).toBeGreaterThanOrEqual(3);
    const taskChunk = await service.chunkForCell(task.origin);
    expect((await service.getChunk(countryId, taskChunk.chunkX, taskChunk.chunkY)).tasks.find((item) => item.id === task.id)?.stage).toBe(1);
    const overview = await service.getChunk(countryId, taskChunk.chunkX, taskChunk.chunkY, "OVERVIEW");
    expect(overview.tasks.find((item) => item.id === task.id)).not.toHaveProperty("descriptionPreview");
    // V10: a building may front directly onto the sidewalk without a footpath,
    // so the overview exposes the pedestrian layer as SIDEWALK or PATH cells.
    expect(overview.surfaces.some((surface) => surface.kind === "PATH" || surface.kind === "SIDEWALK")).toBe(true);
    expect(overview.worldFeatures).toEqual([]);
    for (const [index, status] of ["STARTED", "IN_PROGRESS", "TESTING", "COMPLETED"].entries()) {
      task = await service.updateTaskStatus(countryId, { taskId: task.id, status: status as typeof task.status, comment: `stage ${index}`, idempotencyKey: `status-${index}` });
      if (index === 0) {
        expect((await service.getChunk(countryId, taskChunk.chunkX, taskChunk.chunkY)).tasks.find((item) => item.id === task.id)?.stage).toBe(2);
      }
    }
    expect(task.stage).toBe(5);
    expect(task.progress).toBe(100);
    expect(task.comments).toHaveLength(4);
    const statusEvent = (await service.listEvents(countryId)).findLast((event) => event.type === "task.status_changed");
    expect(statusEvent?.payload.affectedBounds).toEqual(boundsOf(task.footprint));
    expect((await service.completeDistrict(countryId, district.id, "complete-core")).status).toBe("COMPLETED");
    await expect(service.activateDistrict(countryId, district.id, "reactivate-core")).rejects.toThrowError(/нельзя снова активировать/);
    await expect(service.createTask(countryId, { cityId: city.id, districtId: district.id, title: "Late task", estimate: 1, idempotencyKey: "late-task" }))
      .rejects.toThrowError(/завершённый район/);
  });

  it("constructs a city-unique landmark only as a task-linked five-stage building", async () => {
    const city = await service.createCity(countryId, { name: "Landmark City", idempotencyKey: "landmark-city" });
    const district = await service.createDistrict(countryId, {
      cityId: city.id, name: "Civic Sprint", archetype: "CIVIC", activate: true, idempotencyKey: "landmark-district",
    });

    expect((await service.listWorldFeatures(countryId)).filter((feature) => feature.cityId === city.id && feature.kind === "LANDMARK"))
      .toEqual([]);

    let task = await service.createTask(countryId, {
      cityId: city.id, districtId: district.id, title: "Build the city observatory", estimate: 6,
      buildingHint: "landmark-observatory", idempotencyKey: "landmark-task",
    });
    expect(task).toMatchObject({ buildingType: "landmark-observatory", stage: 1, status: "PLANNING" });
    const chunk = await service.chunkForCell(task.origin);
    expect((await service.getChunk(countryId, chunk.chunkX, chunk.chunkY)).tasks.find((item) => item.id === task.id))
      .toMatchObject({ buildingType: "landmark-observatory", stage: 1 });
    expect((await service.listWorldFeatures(countryId)).filter((feature) => feature.cityId === city.id && feature.kind === "LANDMARK"))
      .toEqual([]);

    for (const [index, status] of ["STARTED", "IN_PROGRESS", "TESTING", "COMPLETED"].entries()) {
      task = await service.updateTaskStatus(countryId, {
        taskId: task.id, status: status as typeof task.status, comment: `landmark stage ${index + 2}`,
        idempotencyKey: `landmark-status-${index}`,
      });
    }
    expect(task).toMatchObject({ buildingType: "landmark-observatory", stage: 5, status: "COMPLETED", progress: 100 });
    await expect(service.createTask(countryId, {
      cityId: city.id, districtId: district.id, title: "Build a second city landmark", estimate: 6,
      buildingHint: "landmark-monument", idempotencyKey: "second-landmark-task",
    })).rejects.toThrowError(/Лимит этого типа здания уже достигнут/);
  });

  it("enforces service-role uniqueness from the data catalog", async () => {
    const city = await service.createCity(countryId, { name: "Services", idempotencyKey: "services-city" });
    const district = await service.createDistrict(countryId, { cityId: city.id, name: "Safety", capacitySp: 14, activate: true, idempotencyKey: "services-district" });
    await service.createTask(countryId, { cityId: city.id, districtId: district.id, title: "Compact fire station", estimate: 3, buildingHint: "civic-fire-station-compact", idempotencyKey: "fire-one" });
    await expect(service.createTask(countryId, { cityId: city.id, districtId: district.id, title: "Second fire station", estimate: 6, buildingHint: "civic-fire-station", idempotencyKey: "fire-two" }))
      .rejects.toThrowError(/Лимит этого типа здания/);
  });

  it("rejects reused idempotency keys and invalid building hints", async () => {
    await service.createCity(countryId, { name: "Alpha", idempotencyKey: "same" });
    await expect(service.createCity(countryId, { name: "Beta", idempotencyKey: "same" })).rejects.toThrowError(DomainError);
    const city = (await service.listCities(countryId))[0]!;
    await service.createDistrict(countryId, { cityId: city.id, name: "Active", activate: true, idempotencyKey: "district" });
    await expect(service.createTask(countryId, { cityId: city.id, title: "Unknown", estimate: 1, buildingHint: "missing-building", idempotencyKey: "bad-building" }))
      .rejects.toThrowError(/не подходит оценке|не существует/);
  });

  it("rejects an explicit residential massing that conflicts with the district", async () => {
    const city = await service.createCity(countryId, { name: "Zoned City", morphology: "DENSE_CORE", idempotencyKey: "zoned-city" });
    const dense = await service.createDistrict(countryId, { cityId: city.id, name: "Новые высотки", archetype: "NEW_BUILD", activate: true, idempotencyKey: "zoned-district" });
    await expect(service.createTask(countryId, {
                      cityId: city.id, districtId: dense.id, title: "Частный дом внутри высоток", estimate: 2,
                      buildingHint: "house-cottage", idempotencyKey: "zoned-conflict",
                    })).rejects.toThrowError(/несовместим/);
  });

  it("treats district SP capacity as an advisory target and still enforces status transitions", async () => {
    const city = await service.createCity(countryId, { name: "Capacity City", idempotencyKey: "capacity-city" });
    await service.createDistrict(countryId, { cityId: city.id, name: "Short Sprint", capacitySp: 3, activate: true, idempotencyKey: "capacity-district" });
    const task = await service.createTask(countryId, { cityId: city.id, title: "Three point task", estimate: 3, idempotencyKey: "capacity-task" });
    const overflow = await service.createTask(countryId, { cityId: city.id, title: "Overflow task", estimate: 1, idempotencyKey: "capacity-overflow" });
    expect(overflow.districtId).toBe(task.districtId);
    expect(await service.getDistrictWorkload(countryId, task.districtId)).toMatchObject({
      targetSp: 3, plannedSp: 4, openSp: 4, taskCount: 2, overTargetBySp: 1,
    });
    await expect(service.updateTaskStatus(countryId, { taskId: task.id, status: "TESTING", idempotencyKey: "skip-stage" }))
      .rejects.toThrowError(/пропускать стадии/);
  });

  it("repairs linked defects without rolling back a task in testing and blocks premature completion", async () => {
    const city = await service.createCity(countryId, { name: "Incident City", idempotencyKey: "incident-city" });
    const district = await service.createDistrict(countryId, { cityId: city.id, name: "Release verification", activate: true, idempotencyKey: "incident-district" });
    let task = await service.createTask(countryId, {
      cityId: city.id, districtId: district.id, title: "Payment hotfix", workItemType: "HOTFIX", estimate: 2, idempotencyKey: "incident-task",
    });
    for (const [status, progress] of [["STARTED", 0], ["IN_PROGRESS", 60], ["TESTING", 90]] as const) {
      task = await service.updateTaskStatus(countryId, { taskId: task.id, status, progress, comment: `Enter ${status}`, idempotencyKey: `incident-${status}` });
    }
    const defect = await service.createTaskDefect(countryId, {
      taskId: task.id, title: "Duplicate charge", reproductionSteps: "Retry a timed out payment", actualResult: "Charged twice",
      expectedResult: "One idempotent charge", idempotencyKey: "incident-defect",
    });
    for (const status of ["IN_PROGRESS", "VERIFYING"] as const) {
      await service.updateTaskDefect(countryId, { defectId: defect.id, status, idempotencyKey: `incident-defect-${status}` });
      expect(await service.getTask(countryId, task.id)).toMatchObject({ status: "TESTING", progress: 90 });
    }
    const taskChunk = await service.chunkForCell(task.origin);
    expect((await service.getChunk(countryId, taskChunk.chunkX, taskChunk.chunkY)).tasks.find((item) => item.id === task.id)).toMatchObject({
      workItemType: "HOTFIX", defectSummary: { open: 0, inProgress: 0, verifying: 1, active: 1 },
    });
    expect((await service.getChunk(countryId, taskChunk.chunkX, taskChunk.chunkY, "OVERVIEW")).tasks.find((item) => item.id === task.id))
      .not.toHaveProperty("defectSummary");
    expect((await service.listPlanTasks(countryId, district.id)).find((item) => item.id === task.id))
      .toMatchObject({ activeDefectCount: 1 });
    await expect(service.updateTaskStatus(countryId, { taskId: task.id, status: "COMPLETED", progress: 100, idempotencyKey: "incident-complete-too-early" }))
      .rejects.toThrowError(/неисправленн/);
    await service.updateTaskDefect(countryId, { defectId: defect.id, status: "FIXED", idempotencyKey: "incident-defect-fixed" });
    expect(await service.updateTaskStatus(countryId, { taskId: task.id, status: "COMPLETED", progress: 100, idempotencyKey: "incident-complete" }))
      .toMatchObject({ status: "COMPLETED", progress: 100 });
    await expect(service.updateTaskDefect(countryId, { defectId: defect.id, status: "IN_PROGRESS", idempotencyKey: "incident-invalid-restart" }))
      .rejects.toThrowError(/переход/);
    expect(await service.updateTaskDefect(countryId, { defectId: defect.id, status: "OPEN", idempotencyKey: "incident-reopen" }))
      .toMatchObject({ status: "OPEN", fixedAt: null });
  });

  it("deletes tasks, districts and cities safely while keeping retries idempotent", async () => {
    const city = await service.createCity(countryId, { name: "Lifecycle City", idempotencyKey: "lifecycle-city" });
    const active = await service.createDistrict(countryId, { cityId: city.id, name: "Active District", activate: true, idempotencyKey: "lifecycle-active" });
    const next = await service.createDistrict(countryId, { cityId: city.id, name: "Next District", idempotencyKey: "lifecycle-next" });
    const task = await service.createTask(countryId, { cityId: city.id, districtId: active.id, title: "Disposable Task", estimate: 1, idempotencyKey: "lifecycle-task" });
    await service.updateTaskStatus(countryId, { taskId: task.id, status: "STARTED", comment: "Creates dependent history", idempotencyKey: "lifecycle-start" });
    const areaId = randomUUID();
    const decorId = randomUUID();
    const featureCell = active.cells[0]!;
    await db.prepare(`INSERT INTO world_features_v6
      (id,country_id,city_id,district_id,parent_feature_id,kind,asset_kind,asset_key,origin_x,origin_y,footprint_json,orientation,access_json,created_at)
      VALUES (?,?,?,?,?,'PARK','AREA','urban-park',?,?,?::jsonb,'S','[]'::jsonb,?)`)
      .run(areaId, countryId, city.id, active.id, null, featureCell.x, featureCell.y, JSON.stringify([featureCell]), new Date().toISOString());
    await db.prepare(`INSERT INTO world_features_v6
      (id,country_id,city_id,district_id,parent_feature_id,kind,asset_kind,asset_key,origin_x,origin_y,footprint_json,orientation,access_json,created_at)
      VALUES (?,?,?,?,?,'PARK_DECOR','PROP','bench-horizontal',?,?,?::jsonb,'S','[]'::jsonb,?)`)
      .run(decorId, countryId, city.id, active.id, areaId, featureCell.x, featureCell.y, JSON.stringify([featureCell]), new Date().toISOString());
    const ownedFeatures = await db.prepare("SELECT id FROM world_features_v6 WHERE district_id = ?").all(active.id);
    expect(ownedFeatures.map((row) => row.id)).toEqual(expect.arrayContaining([areaId, decorId]));

    await expect(service.deleteTask(countryId, { taskId: task.id, confirmTitle: "wrong", idempotencyKey: "delete-task-wrong" }))
      .rejects.toThrowError(/точное текущее название/);
    const deletedTask = await service.deleteTask(countryId, { taskId: task.id, confirmTitle: task.title, idempotencyKey: "delete-task" });
    expect(await service.deleteTask(countryId, { taskId: task.id, confirmTitle: task.title, idempotencyKey: "delete-task" })).toEqual(deletedTask);
    expect((await service.listTasks(countryId)).some((item) => item.id === task.id)).toBe(false);
    expect(await db.prepare("SELECT 1 FROM task_comments_v3 WHERE task_id = ?").get(task.id)).toBeUndefined();
    expect(await db.prepare("SELECT 1 FROM task_events_v7 WHERE task_id = ?").get(task.id)).toBeUndefined();
    const freed = (await service.listDistricts(countryId, city.id)).find((item) => item.id === active.id)!.lots;
    expect(freed.some((lot) => lot.taskId === task.id)).toBe(false);

    const deletedDistrict = await service.deleteDistrict(countryId, { districtId: active.id, confirmName: active.name, idempotencyKey: "delete-district" });
    expect(deletedDistrict.activatedDistrictId).toBe(next.id);
    expect((await service.listDistricts(countryId, city.id)).find((item) => item.id === next.id)?.status).toBe("ACTIVE");
    // Abandonment keeps the urban fabric: the district row stays as ABANDONED,
    // parks remain, and the demolished task became a ruin plot.
    expect((await service.listDistricts(countryId, city.id)).find((item) => item.id === active.id)).toMatchObject({ status: "ABANDONED", cells: [], lots: [] });
    const remainingFeatures = await db.prepare("SELECT kind FROM world_features_v6 WHERE district_id = ?").all(active.id);
    expect(remainingFeatures.map((row) => String(row.kind))).toEqual(expect.arrayContaining(["PARK", "PARK_DECOR", "RUIN"]));
    expect(await db.prepare("SELECT 1 FROM world_chunk_entities_v11 WHERE entity_kind = 'FEATURE' AND entity_id = ANY(?::text[])").get(ownedFeatures.map((row) => String(row.id)))).not.toBeUndefined();
    const deletionEvent = (await service.listEvents(countryId)).findLast((event) => event.type === "district.deleted");
    const affected = deletionEvent?.payload.affectedBounds as { minX: number; minY: number; maxX: number; maxY: number };
    expect(affected.minX).toBeLessThanOrEqual(boundsOf(next.cells).minX);
    expect(affected.maxX).toBeGreaterThanOrEqual(boundsOf(next.cells).maxX);

    const roadsBeforeDelete = Number((await db.prepare("SELECT COUNT(*) AS count FROM roads_v3 WHERE country_id = ? AND x BETWEEN ? AND ? AND y BETWEEN ? AND ?").get(countryId, city.bounds.minX, city.bounds.maxX, city.bounds.minY, city.bounds.maxY) as { count: number }).count);
    const deletedCity = await service.deleteCity(countryId, { cityId: city.id, confirmName: city.name, idempotencyKey: "delete-city" });
    expect(deletedCity).toMatchObject({ cityId: city.id, districtsDeleted: 2, tasksDeleted: 0 });
    expect(deletedCity.roadsDeleted).toBeGreaterThan(0);
    expect(deletedCity.roadsDeleted).toBeLessThanOrEqual(roadsBeforeDelete);
    expect(await service.listCities(countryId)).toEqual([]);
  });

  it("keeps destructive operations isolated and exact-confirmed", async () => {
    const city = await service.createCity(countryId, { name: "Protected City", idempotencyKey: "protected-city" });
    const district = await service.createDistrict(countryId, { cityId: city.id, name: "Protected District", activate: true, idempotencyKey: "protected-district" });
    const other = await registerUser(db, { email: "delete-other@example.com", name: "Other", password: "password123" });
    await expect(service.deleteCity(countryId, { cityId: city.id, confirmName: "wrong", idempotencyKey: "wrong-city-confirm" })).rejects.toThrowError(/точное текущее название/);
    await expect(service.deleteDistrict(countryId, { districtId: district.id, confirmName: "wrong", idempotencyKey: "wrong-district-confirm" })).rejects.toThrowError(/точное текущее название/);
    await expect(service.deleteCity(other.user.countryId, { cityId: city.id, confirmName: city.name, idempotencyKey: "foreign-city-delete" })).rejects.toThrowError(/не найден/);
    await expect(service.deleteDistrict(other.user.countryId, { districtId: district.id, confirmName: district.name, idempotencyKey: "foreign-district-delete" })).rejects.toThrowError(/не найден/);
    expect((await service.listDistricts(countryId, city.id)).some((item) => item.id === district.id)).toBe(true);
  });

  it("keeps future-district tasks in planning until the district becomes active", async () => {
    const city = await service.createCity(countryId, { name: "Future City", idempotencyKey: "future-city" });
    const future = await service.createDistrict(countryId, { cityId: city.id, name: "Future Sprint", activate: false, idempotencyKey: "future-district" });
    const task = await service.createTask(countryId, { cityId: city.id, districtId: future.id, title: "Future house", estimate: 1, idempotencyKey: "future-task" });
    await expect(service.updateTaskStatus(countryId, { taskId: task.id, status: "STARTED", idempotencyKey: "future-start-early" }))
      .rejects.toThrowError(/до активации/);
    await service.activateDistrict(countryId, future.id, "future-activate");
    expect((await service.updateTaskStatus(countryId, { taskId: task.id, status: "STARTED", idempotencyKey: "future-start" })).status).toBe("STARTED");
  });

  it("isolates tasks between countries", async () => {
    const city = await service.createCity(countryId, { name: "Private City", idempotencyKey: "private-city" });
    await service.createDistrict(countryId, { cityId: city.id, name: "Private District", activate: true, idempotencyKey: "private-district" });
    const task = await service.createTask(countryId, { cityId: city.id, title: "Private Task", estimate: 1, idempotencyKey: "private-task" });
    const other = await registerUser(db, { email: "other@example.com", name: "Other", password: "password123" });
    await expect(service.getTask(other.user.countryId, task.id)).rejects.toThrowError(/не найдена/);
  });

  it("stores only an MCP token hash", async () => {
    const token = await createMcpToken(db, countryId, "Test token");
    const row = await db.prepare("SELECT token_hash FROM mcp_tokens WHERE id = ?").get(token.id) as { token_hash: string };
    expect(row.token_hash).toBe(hashToken(token.token));
    expect(row.token_hash).not.toContain(token.token);
  });

  it("publishes realtime events only after the outer transaction commits", async () => {
    const events: string[] = [];
    const transactionalService = new AppService(db, (event) => events.push(event.type));

    await expect(transaction(db, async () => {
      await transactionalService.createCity(countryId, { name: "Rolled back city", idempotencyKey: "rollback-city" });
      expect(events).toEqual([]);
      throw new Error("force outer rollback");
    })).rejects.toThrowError(/force outer rollback/);
    expect(events).toEqual([]);
    expect((await transactionalService.listCities(countryId)).some((city) => city.name === "Rolled back city")).toBe(false);

    await transaction(db, async () => {
      await transactionalService.createCity(countryId, { name: "Committed city", idempotencyKey: "commit-city" });
      expect(events).toEqual([]);
    });
    expect(events).toEqual(["city.created"]);
  }, 15_000);

  it("connects a second city to the existing national road component", async () => {
    const cities = [];
    for (let index = 0; index < 2; index += 1) {
      cities.push(await service.createCity(countryId, { name: `City ${index}`, idempotencyKey: `city-${index}` }));
    }
    expect(cities).toHaveLength(2);
    expect(new Set(cities.map((city) => `${city.center.x},${city.center.y}`)).size).toBe(2);
    const roads = await db.prepare("SELECT x, y FROM roads_v3 WHERE country_id = ?").all(countryId) as Array<{ x: number; y: number }>;
    expect(connected(roads)).toBe(true);
    for (const city of cities) expect(Math.min(...roads.map((road) => manhattan(road, city.center)))).toBeLessThanOrEqual(2);
    const bridges = await db.prepare("SELECT x, y FROM roads_v3 WHERE country_id = ? AND structure = 'BRIDGE'").all(countryId) as Array<{ x: number; y: number }>;
    const seed = Number((await db.prepare("SELECT seed FROM countries WHERE id = ?").get(countryId) as { seed: number }).seed);
    for (const bridge of bridges) expect(isWater(terrainAt(seed, bridge.x, bridge.y).terrain)).toBe(true);
    const features = await service.listWorldFeatures(countryId);
    expect(features.filter((feature) => feature.kind === "CITY_SIGN").length).toBeGreaterThan(0);
    expect(features.filter((feature) => feature.kind === "BUS_STOP").length).toBeGreaterThan(0);
    for (const feature of features) {
      // A boom barrier intentionally spans the archive driveway at the fence
      // line. All other world features must remain outside drivable cells.
      if (feature.assetKey === "archive-security-barrier") continue;
      for (const cell of feature.footprint) {
        expect(roads.some((road) => cellKey(road) === cellKey(cell)), `${feature.assetKey} overlaps road at ${cellKey(cell)}`).toBe(false);
      }
    }
  }, 15_000);

  it("anchors a new city to a real road in a legacy world without highway classes", async () => {
    await db.prepare("UPDATE countries SET seed = ? WHERE id = ?").run(424_242, countryId);
    const first = await service.createCity(countryId, { name: "Legacy city", idempotencyKey: "legacy-anchor-first" });
    await db.prepare("UPDATE roads_v3 SET road_class = 'LOCAL' WHERE country_id = ?").run(countryId);
    await db.prepare("DELETE FROM roads_v3 WHERE country_id = ? AND x = ? AND y = ?").run(countryId, first.center.x, first.center.y);
    service = new AppService(db);

    const second = await service.createCity(countryId, { name: "Connected city", idempotencyKey: "legacy-anchor-second" });

    const roads = await db.prepare("SELECT x, y FROM roads_v3 WHERE country_id = ?").all(countryId) as Array<{ x: number; y: number }>;
    expect(connected(roads)).toBe(true);
    expect(Math.min(...roads.map((road) => manhattan(road, second.center)))).toBeLessThanOrEqual(2);
  }, 15_000);

  it("expands a city envelope to fit eight non-overlapping districts", async () => {
    // Regression: the nearest endpoint was enclosed by reservation halos for
    // this production-valid seed. District creation must try another safe
    // road/endpoint pair instead of failing the whole city growth operation.
    await db.prepare("UPDATE countries SET seed = ? WHERE id = ?").run(1901333332, countryId);
    const city = await service.createCity(countryId, { name: "District City", idempotencyKey: "district-city" });
    for (let index = 0; index < 8; index += 1) {
      await service.createDistrict(countryId, { cityId: city.id, name: `District ${index}`, capacitySp: 14, activate: index === 0, idempotencyKey: `district-eight-${index}` });
    }
    const districts = await service.listDistricts(countryId, city.id);
    const expandedCity = (await service.listCities(countryId)).find((candidate) => candidate.id === city.id)!;
    const occupied = new Set<string>();
    expect(districts).toHaveLength(8);
    for (const district of districts) for (const cell of district.cells) {
      expect(cell.x).toBeGreaterThanOrEqual(expandedCity.bounds.minX);
      expect(cell.x).toBeLessThanOrEqual(expandedCity.bounds.maxX);
      expect(cell.y).toBeGreaterThanOrEqual(expandedCity.bounds.minY);
      expect(cell.y).toBeLessThanOrEqual(expandedCity.bounds.maxY);
      expect(occupied.has(cellKey(cell))).toBe(false);
      occupied.add(cellKey(cell));
    }
  }, 15_000);
});
