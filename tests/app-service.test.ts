import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppService, DomainError } from "../src/server/app-service";
import { createMcpToken, hashToken, registerUser } from "../src/server/auth";
import { createTestDb, transaction, type Db } from "../src/server/db";
import { getBuilding } from "../src/shared/catalog";
import { GRID_DIRECTIONS, boundsOf, cellKey, connected } from "../src/server/world/grid";
import { readActiveBlockLayout } from "../src/server/world/active-block-layout";
import { rasterizeBlockRoads } from "../src/server/world/block-layout-compiler";
import { materializeChunkPayload } from "../src/shared/world-chunk-payload";

describe("Tasktopia compact-block application service", { timeout: 20_000 }, () => {
  let db: Db;
  let service: AppService;
  let countryId: string;

  beforeEach(async () => {
    db = await createTestDb();
    service = new AppService(db);
    countryId = (await registerUser(db, { email: "test@example.com", name: "Tester", password: "password123" })).user.countryId;
    // Application-service contracts need a reproducible world fixture. Tests
    // that exercise a particular terrain seed override this value explicitly.
    await db.prepare("UPDATE countries SET seed = ? WHERE id = ?").run(424_242, countryId);
  });

  afterEach(async () => await db?.close());

  it.each([false, true])("rebuilds pre-lighting cached chunks without regenerating the world (batch=%s)", async (batch) => {
    const before = await service.getChunkPayload(countryId, 7, 9, "DETAIL");
    const obsolete = JSON.parse(JSON.stringify(before));
    delete obsolete.decorationContext.lightingVersion;
    delete obsolete.decorationContext.surfaceHaloRuns;
    await db.prepare("UPDATE world_chunk_payloads_v1 SET payload_json = ? WHERE country_id = ? AND chunk_x = 7 AND chunk_y = 9 AND lod = 'DETAIL'")
      .run(JSON.stringify(obsolete), countryId);
    const reader = new AppService(db);
    const after = batch ? (await reader.getViewportPayloads(countryId, 7, 9, 7, 9, "DETAIL"))[0]!
      : await reader.getChunkPayload(countryId, 7, 9, "DETAIL");
    expect(after.decorationContext.lightingVersion).toBe(1);
    expect(Array.isArray(after.decorationContext.surfaceHaloRuns)).toBe(true);
    expect(after.publishedVersion).toBe(before.publishedVersion);
    expect(after.tasks).toEqual(before.tasks);
  });

  it("creates an idempotent city with reciprocal square-road masks", async () => {
    await db.prepare("UPDATE countries SET seed = ? WHERE id = ?").run(424_242, countryId);
    const input = { name: "Northpoint", idempotencyKey: "city-key" };
    const first = await service.createCity(countryId, input);
    const second = await service.createCity(countryId, input);
    expect(second.id).toBe(first.id);
    const layout = await readActiveBlockLayout(db, first.id);
    expect(layout).toBeDefined();
    expect(layout!.blocks).toEqual([]);
    const roads = rasterizeBlockRoads(layout!.roadNetwork);
    expect(roads.length).toBeGreaterThan(0);
    expect(connected(roads)).toBe(true);
    const roadMap = new Map(roads.map((road) => [cellKey(road), road]));
    for (const road of roadMap.values()) {
      for (const direction of GRID_DIRECTIONS) {
        if (!(road.mask & direction.bit)) continue;
        const next = roadMap.get(cellKey({ x: road.x + direction.x, y: road.y + direction.y }));
        if (next) expect(next.mask & direction.opposite).not.toBe(0);
      }
    }
  });

  it("does not serve a warm L1 chunk after another app replica invalidates its projection", async () => {
    const city = await service.createCity(countryId, { name: "Replica City", idempotencyKey: "replica-city" });
    const district = await service.createDistrict(countryId, {
      cityId: city.id, name: "Replica District", activate: true, idempotencyKey: "replica-district",
    });
    const task = await service.createTask(countryId, {
      cityId: city.id, districtId: district.id, title: "Replica task", estimate: 1, idempotencyKey: "replica-task",
    });
    const coordinate = service.chunkForCell(task.origin);
    const replica = new AppService(db);
    const before = await replica.getChunkPayload(countryId, coordinate.chunkX, coordinate.chunkY, "DETAIL");

    await service.updateTaskStatus(countryId, {
      taskId: task.id, status: "STARTED", idempotencyKey: "replica-task-start",
    });
    const after = await replica.getChunkPayload(countryId, coordinate.chunkX, coordinate.chunkY, "DETAIL");

    expect(after.publishedVersion).toBeGreaterThan(before.publishedVersion);
    expect(after.contentHash).not.toBe(before.contentHash);
    expect(after.tasks.find((candidate) => candidate.id === task.id)).toMatchObject({ status: "STARTED", stage: 2 });
  }, 20_000);

  it("invalidates warm geometry caches when an external runtime delivers the committed event", async () => {
    let externalEvent: import("../src/shared/contracts").RealtimeEvent | undefined;
    const writer = new AppService(db, (event) => { externalEvent = event; });
    const city = await writer.createCity(countryId, { name: "First replica city", idempotencyKey: "replica-geometry-1" });
    const reader = new AppService(db);
    const firstScene = await reader.getCityScene(countryId, city.id);
    const firstRoadCount = new Set(firstScene.chunks.flatMap(chunk => materializeChunkPayload(chunk).roads.map(cellKey))).size;

    const district = await writer.createDistrict(countryId, { cityId: city.id, name: "New block", activate: true, idempotencyKey: "replica-geometry-district" });
    const task = await writer.createTask(countryId, { cityId: city.id, districtId: district.id, title: "New building", estimate: 1, idempotencyKey: "replica-geometry-task" });
    expect(externalEvent).toBeDefined();

    reader.acceptExternalEvent(externalEvent!);

    const secondScene = await reader.getCityScene(countryId, city.id);
    expect(new Set(secondScene.chunks.flatMap(chunk => materializeChunkPayload(chunk).roads.map(cellKey))).size).toBeGreaterThan(firstRoadCount);
    expect(secondScene.chunks.flatMap(chunk => chunk.tasks).some(candidate => candidate.id === task.id)).toBe(true);
  }, 20_000);

  it("batch-reads published viewport chunks instead of issuing one L2 lookup per coordinate", async () => {
    let publishedPayloadReads = 0;
    let publishedPayloadWrites = 0;
    let publishedRetentionRuns = 0;
    const spatialReads = { cities: 0, tasks: 0, layouts: 0 };
    const countedDb: Db = {
      prepare: (query) => {
        const statement = db.prepare(query);
        const count = () => {
          if (query.includes("SELECT payload_json") && query.includes("FROM world_chunk_payloads_v1")) publishedPayloadReads += 1;
          if (query.includes("INSERT INTO world_chunk_payloads_v1")) publishedPayloadWrites += 1;
          if (query.includes("WITH stale AS")) publishedRetentionRuns += 1;
          if (query.includes("SELECT * FROM cities_v3 WHERE country_id") && query.includes("bounds_json")) spatialReads.cities += 1;
          if (query.includes("FROM tasks_v3 t JOIN task_placements_v1")) spatialReads.tasks += 1;
          if (query.includes("SELECT * FROM city_layouts_v1")) spatialReads.layouts += 1;
        };
        return {
          all: async (...parameters) => { count(); return statement.all(...parameters); },
          get: async (...parameters) => { count(); return statement.get(...parameters); },
          run: async (...parameters) => { count(); return statement.run(...parameters); },
        };
      },
      exec: (query) => db.exec(query),
      close: async () => undefined,
      transaction: (callback) => db.transaction(callback),
    };
    const batchService = new AppService(countedDb);

    const chunks = await batchService.getViewportPayloads(countryId, 100, 100, 104, 103, "DETAIL");

    expect(chunks).toHaveLength(20);
    expect(publishedPayloadReads).toBe(1);
    expect(publishedPayloadWrites).toBe(1);
    expect(publishedRetentionRuns).toBe(1);
    expect(spatialReads.cities).toBeLessThanOrEqual(3);
    expect(spatialReads.tasks).toBe(1);
    expect(spatialReads.layouts).toBe(0); // Empty remote viewport does not read a city layout.
  });

  it("plans one task from a bounded command snapshot without whole-country spatial reads", async () => {
    const city = await service.createCity(countryId, { name: "Bounded city", idempotencyKey: "bounded-city" });
    const district = await service.createDistrict(countryId, {
      cityId: city.id, name: "Bounded district", activate: true, idempotencyKey: "bounded-district",
    });
    const unboundedReads: string[] = [];
    const countedDb: Db = {
      prepare: (query) => {
        const statement = db.prepare(query);
        const count = () => {
          if (/FROM cities_v3 WHERE country_id = \? ORDER BY/.test(query)
            || /FROM districts_v3 d JOIN cities_v3 c[^]*WHERE c\.country_id = \? ORDER BY/.test(query)
            || /FROM tasks_v3 t JOIN cities_v3 c[^]*WHERE c\.country_id = \? ORDER BY/.test(query)
            || /FROM city_layouts_v1 WHERE country_id\s*=\s*\?\s*$/.test(query.trim())) unboundedReads.push(query);
        };
        return {
          all: async (...parameters) => { count(); return statement.all(...parameters); },
          get: async (...parameters) => { count(); return statement.get(...parameters); },
          run: async (...parameters) => { count(); return statement.run(...parameters); },
        };
      },
      exec: (query) => db.exec(query), close: async () => undefined,
      transaction: (callback) => db.transaction(callback),
    };

    await new AppService(countedDb).createTask(countryId, {
      cityId: city.id, districtId: district.id, title: "Bounded placement", estimate: 1, idempotencyKey: "bounded-task",
    });

    expect(unboundedReads).toEqual([]);
  }, 20_000);

  it("uses optional Redis as a versioned cache while PostgreSQL remains canonical", async () => {
    const shared = new Map<string, import("../src/shared/contracts").ChunkPayloadDto>();
    const cache = {
      getChunk: async (key: string) => shared.get(key),
      setChunk: async (key: string, payload: import("../src/shared/contracts").ChunkPayloadDto) => { shared.set(key, payload); },
      close: async () => undefined,
    };
    const publisher = new AppService(db, undefined, "data/uploads", undefined, cache);
    const first = await publisher.getChunkPayload(countryId, 7, 9, "OVERVIEW");
    await vi.waitFor(() => expect(shared.size).toBe(1));
    await db.prepare("DELETE FROM world_chunk_payloads_v1 WHERE country_id=?").run(countryId);
    let spatialReads = 0;
    const countedDb: Db = {
      prepare: (query) => {
        const statement = db.prepare(query);
        const count = () => { if (/FROM (?:city_layouts_v1|road_networks_v1|task_placements_v1)/.test(query)
          || query.includes("FROM tasks_v3 t JOIN task_placements_v1")) spatialReads += 1; };
        return {
          all: async (...parameters) => { count(); return statement.all(...parameters); },
          get: async (...parameters) => { count(); return statement.get(...parameters); },
          run: async (...parameters) => { count(); return statement.run(...parameters); },
        };
      },
      exec: (query) => db.exec(query), close: async () => undefined,
      transaction: (callback) => db.transaction(callback),
    };
    const reader = new AppService(countedDb, undefined, "data/uploads", undefined, cache);

    const second = await reader.getChunkPayload(countryId, 7, 9, "OVERVIEW");

    expect(second).toEqual(first);
    expect(spatialReads).toBe(0);
  });

  it("rejects a shared singleflight payload when the canonical world advances during its build", async () => {
    let calls = 0;
    const cache = {
      getChunk: async () => undefined,
      setChunk: async () => undefined,
      getOrBuildChunk: async (_key: string, build: () => Promise<import("../src/shared/contracts").ChunkPayloadDto>) => {
        const payload = await build();
        calls += 1;
        if (calls === 1) {
          await transaction(db, async () => {
            await db.prepare("UPDATE countries SET world_version = world_version + 1 WHERE id = ?").run(countryId);
            await db.prepare("DELETE FROM world_chunk_payloads_v1 WHERE country_id = ?").run(countryId);
          });
          return { payload, built: false };
        }
        return { payload, built: true };
      },
      close: async () => undefined,
    };
    const reader = new AppService(db, undefined, "data/uploads", undefined, cache);

    const result = await reader.getViewportPayloads(countryId, 4, 4, 4, 4, "OVERVIEW");

    expect(calls).toBe(2);
    expect(result[0]?.publishedVersion).toBe(2);
  });

  it("rebuilds against the current world version when publication loses a mutation race", async () => {
    type ChunkPublisher = {
      publishChunkPayload(country: string, payload: import("../src/shared/contracts").ChunkPayloadDto): Promise<boolean>;
    };
    const publisher = service as unknown as ChunkPublisher;
    const publish = publisher.publishChunkPayload.bind(service);
    let raced = false;
    vi.spyOn(publisher, "publishChunkPayload").mockImplementation(async (...args) => {
      if (!raced) {
        raced = true;
        await db.prepare("UPDATE countries SET world_version = world_version + 1 WHERE id = ?").run(countryId);
        return false;
      }
      return await publish(...args);
    });

    const payload = await service.getChunkPayload(countryId, 100, 100, "OVERVIEW");
    const country = await db.prepare("SELECT world_version FROM countries WHERE id = ?").get<{ world_version: number }>(countryId);
    expect(raced).toBe(true);
    expect(payload.publishedVersion).toBe(Number(country?.world_version));
  });

  it("renames a city, district, and task with idempotent realtime events", async () => {
    const emitted: string[] = [];
    service = new AppService(db, (event) => emitted.push(event.type));
    await db.prepare("UPDATE countries SET seed = ? WHERE id = ?").run(424_242, countryId);
    const city = await service.createCity(countryId, { name: "Old City", idempotencyKey: "rename-city-create" });
    const renamedCity = await service.renameCity(countryId, { cityId: city.id, name: "New City", idempotencyKey: "rename-city" });
    const district = await service.createDistrict(countryId, { cityId: city.id, name: "Old District", activate: true, idempotencyKey: "rename-district-create" });
    const task = await service.createTask(countryId, { cityId: city.id, districtId: district.id, title: "Old Task", estimate: 1, idempotencyKey: "rename-task-create" });
    const renamedDistrict = await service.renameDistrict(countryId, { districtId: district.id, name: "New District", idempotencyKey: "rename-district" });
    const renamedTask = await service.renameTask(countryId, { taskId: task.id, title: "New Task", actor: "Tester", idempotencyKey: "rename-task" });

    expect(renamedCity.name).toBe("New City");
    expect(renamedDistrict.name).toBe("New District");
    expect(renamedTask.title).toBe("New Task");
    expect(renamedTask.events?.at(-1)).toMatchObject({ type: "TITLE_CHANGED", actor: "Tester", details: { from: "Old Task", to: "New Task" } });
    expect(emitted.filter((type) => type.endsWith(".renamed"))).toEqual(["city.renamed", "district.renamed", "task.renamed"]);
    const renameEvent = (await service.listEvents(countryId)).findLast((event) => event.type === "city.renamed");
    const affected = renameEvent?.payload.affectedBounds as { minX: number; minY: number; maxX: number; maxY: number };
    expect(affected).toMatchObject(city.bounds);
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
      buildingHint: "compact-apartment-v1", idempotencyKey: "regen-task",
    });
    expect(await service.listWorldFeatures(countryId)).toEqual([]);
    const defect = await service.createTaskDefect(countryId, {
      taskId: task.id, title: "Broken path", reproductionSteps: "Open the map", actualResult: "Path breaks", expectedResult: "Path stays whole",
      idempotencyKey: "regen-defect",
    });
    await expect(service.updateTaskDefect(countryId, { defectId: defect.id, reproductionSteps: "   ", idempotencyKey: "regen-defect-empty-steps" }))
      .rejects.toThrowError(/не могут быть пустыми/);
    await service.updateTaskDefect(countryId, { defectId: defect.id, status: "FIXED", idempotencyKey: "regen-defect-fixed" });
    await service.updateTaskStatus(countryId, { taskId: task.id, status: "STARTED", comment: "History survives", actor: "Tester", idempotencyKey: "regen-start" });
    // Simulate a pre-migration production row. Regeneration must not resolve
    // the removed key through the active catalog; it re-picks a current
    // compact family while preserving the task, seed and history.
    await db.prepare("UPDATE tasks_v3 SET building_type = ?, visual_asset_key = ?, platform_type = ? WHERE id = ?")
      .run("house-cottage", "house-cottage", "YARD", task.id);
    const seedBefore = Number((await db.prepare("SELECT seed FROM countries WHERE id = ?").get(countryId) as { seed: number }).seed);
    const layoutBefore = await readActiveBlockLayout(db, city.id);
    const geometryBefore = JSON.stringify({ city: (await service.listCities(countryId))[0]?.center, district: (await service.listDistricts(countryId))[0]?.cells, task: (await service.listTasks(countryId))[0]?.origin });

    const result = await service.regenerateCountry(countryId, { confirmName: "Tester: страна", idempotencyKey: "regenerate-world" });
    expect(await service.regenerateCountry(countryId, { confirmName: "Tester: страна", idempotencyKey: "regenerate-world" })).toEqual(result);
    expect(result).toMatchObject({ regenerated: true, countryId, cities: 1, districts: 1, tasks: 1 });
    expect(result.seed).toBe(seedBefore);
    expect((await readActiveBlockLayout(db, city.id))!.revision).toBeGreaterThan(layoutBefore!.revision);
    expect((await service.listCities(countryId))[0]?.id).toBe(city.id);
    expect((await service.listDistricts(countryId))[0]?.id).toBe(district.id);
    expect(connected((await service.listDistricts(countryId))[0]!.cells)).toBe(true);
    const preserved = await service.getTask(countryId, task.id);
    expect(preserved.buildingType).not.toBe("house-cottage");
    expect(() => getBuilding(preserved.buildingType)).not.toThrow();
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
    expect(geometryAfter).toBe(geometryBefore);
    expect(await db.prepare("SELECT 1 FROM countries WHERE name LIKE 'regeneration-%'").get()).toBeUndefined();
    expect((await service.listEvents(countryId)).filter((event) => event.type === "country.regenerated")).toHaveLength(1);
  }, 30_000);

  it("creates a planned district and advances a sprite building through five stages", async () => {
    await db.prepare("UPDATE countries SET seed = ? WHERE id = ?").run(424_242, countryId);
    const city = await service.createCity(countryId, { name: "Southport", idempotencyKey: "c1" });
    const district = await service.createDistrict(countryId, { cityId: city.id, name: "Core", archetype: "MIXED_URBAN", activate: true, idempotencyKey: "d1" });
    expect(district.cells).toEqual([]);
    expect(district.lots).toEqual([]);
    let task = await service.createTask(countryId, { cityId: city.id, title: "Build mixed-use tower", estimate: 2, buildingHint: "compact-apartment-v1", idempotencyKey: "t1" });
    expect(task.stage).toBe(1);
    const planned = await readActiveBlockLayout(db, city.id);
    expect(planned!.blocks.length).toBeGreaterThan(0);
    expect(task.footprint).toHaveLength(36);
    const taskChunk = await service.chunkForCell(task.origin);
    expect((await service.getChunk(countryId, taskChunk.chunkX, taskChunk.chunkY)).tasks.find((item) => item.id === task.id)?.stage).toBe(1);
    const overview = await service.getChunk(countryId, taskChunk.chunkX, taskChunk.chunkY, "OVERVIEW");
    expect(overview.tasks.find((item) => item.id === task.id)).not.toHaveProperty("descriptionPreview");
    // Pedestrian geometry is derived from the same block template as the task.
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
    const eventCity = (await service.listCities(countryId)).find((candidate) => candidate.id === city.id)!;
    expect(statusEvent?.payload.building).toMatchObject({
      id: task.id,
      taskNumber: task.taskNumber,
      title: "Build mixed-use tower",
      status: "COMPLETED",
      progress: 100,
      stage: 5,
      origin: task.origin,
      country: { id: countryId, name: "Tester: страна" },
      city: { id: city.id, name: "Southport", center: eventCity.center, bounds: eventCity.bounds },
      district: { id: district.id, name: "Core" },
    });
    const affected = statusEvent?.payload.affectedBounds as ReturnType<typeof boundsOf>;
    const buildingBounds = boundsOf(task.footprint);
    expect(affected.minX).toBeLessThanOrEqual(buildingBounds.minX);
    expect(affected.minY).toBeLessThanOrEqual(buildingBounds.minY);
    expect(affected.maxX).toBeGreaterThanOrEqual(buildingBounds.maxX);
    expect(affected.maxY).toBeGreaterThanOrEqual(buildingBounds.maxY);
    expect((await service.completeDistrict(countryId, district.id, "complete-core")).status).toBe("COMPLETED");
    const completedScene = await service.getCityScene(countryId, city.id);
    expect(completedScene.completedDistrictSnapshots).toContainEqual(expect.objectContaining({
      districtId: district.id,
      revision: expect.stringMatching(/^[a-f0-9]{64}$/),
      tasks: [expect.objectContaining({
        id: task.id,
        districtId: district.id,
        title: task.title,
        progress: 100,
        buildingType: task.buildingType,
        origin: task.origin,
        footprint: task.footprint,
      })],
    }));
    expect(completedScene.chunks.flatMap((chunk) => chunk.tasks).some((candidate) => candidate.id === task.id)).toBe(false);
    await expect(service.activateDistrict(countryId, district.id, "reactivate-core")).rejects.toThrowError(/нельзя снова активировать/);
    await expect(service.createTask(countryId, { cityId: city.id, districtId: district.id, title: "Late task", estimate: 1, idempotencyKey: "late-task" }))
      .rejects.toThrowError(/завершённый.*район/);
  });

  it("creates a numbered task park with the same five-stage lifecycle", async () => {
    const city = await service.createCity(countryId, { name: "Park City", idempotencyKey: "park-city" });
    const district = await service.createDistrict(countryId, {
      cityId: city.id, name: "Green Sprint", archetype: "NEW_BUILD", activate: true, idempotencyKey: "park-district",
    });
    let park = await service.createTask(countryId, {
      cityId: city.id, districtId: district.id, title: "Построить центральный парк", estimate: 3,
      visualKind: "PARK", parkVariant: "urban-formal", idempotencyKey: "park-task",
    });
    expect(park.visualKind).toBe("PARK");
    expect(park.visualAssetKey).toBe("urban-formal");
    expect(park.taskNumber).toBeGreaterThan(0);
    expect(park.stage).toBe(1);
    for (const [index, status] of ["STARTED", "IN_PROGRESS", "TESTING", "COMPLETED"].entries()) {
      park = await service.updateTaskStatus(countryId, {
        taskId: park.id, status: status as typeof park.status, idempotencyKey: `park-stage-${index}`,
      });
      expect(park.stage).toBe(index + 2);
    }
    const chunkCell = service.chunkForCell(park.origin);
    const chunkPark = (await service.getChunk(countryId, chunkCell.chunkX, chunkCell.chunkY)).tasks.find((task) => task.id === park.id);
    expect(chunkPark).toMatchObject({ taskNumber: park.taskNumber, visualKind: "PARK", visualAssetKey: "urban-formal", stage: 5 });
    expect((await service.listWorldFeatures(countryId)).some((feature) => feature.assetKey === "urban-formal")).toBe(false);
  }, 20_000);

  it("uses the planned AUTO slot even when task prose mentions a park", async () => {
    const city = await service.createCity(countryId, { name: "Inferred Park City", idempotencyKey: "inferred-park-city" });
    const district = await service.createDistrict(countryId, {
      cityId: city.id, name: "Green Sprint", archetype: "NEW_BUILD", activate: true, idempotencyKey: "inferred-park-district",
    });
    const park = await service.createTask(countryId, {
      cityId: city.id, districtId: district.id, title: "Разбить городской сквер", description: "Разработать генератор: рядом парк, сад отдыха, бульвар и парковка.", estimate: 3,
      idempotencyKey: "inferred-park-task",
    });
    expect(park).toMatchObject({ visualKind: "BUILDING", stage: 1 });
    expect(await db.prepare("SELECT visual_auto FROM tasks_v3 WHERE id=?").get(park.id)).toMatchObject({ visual_auto: true });
  }, 20_000);

  it("does not misclassify a parking task as a park", async () => {
    await db.prepare("UPDATE countries SET seed = ? WHERE id = ?").run(1_996_730_220, countryId);
    const city = await service.createCity(countryId, { name: "Parking City", idempotencyKey: "parking-city" });
    const district = await service.createDistrict(countryId, {
      cityId: city.id, name: "Commercial Sprint", archetype: "COMMERCIAL", activate: true, idempotencyKey: "parking-district",
    });
    const parking = await service.createTask(countryId, {
      cityId: city.id, districtId: district.id, title: "Открыть парковку западного входа", estimate: 1,
      idempotencyKey: "parking-task",
    });
    expect(parking).toMatchObject({
      visualKind: "BUILDING",
    });
    expect(getBuilding(parking.buildingType)?.category).toBe("HOUSE");
  }, 20_000);

  it("rejects reused idempotency keys and invalid building hints", async () => {
    await service.createCity(countryId, { name: "Alpha", idempotencyKey: "same" });
    await expect(service.createCity(countryId, { name: "Beta", idempotencyKey: "same" })).rejects.toThrowError(DomainError);
    const city = (await service.listCities(countryId))[0]!;
    await service.createDistrict(countryId, { cityId: city.id, name: "Active", activate: true, idempotencyKey: "district" });
    await expect(service.createTask(countryId, { cityId: city.id, title: "Unknown", estimate: 1, buildingHint: "missing-building", idempotencyKey: "bad-building" }))
      .rejects.toThrowError(/семейство здания/);
  });

  it("treats district SP capacity as an advisory target and still enforces status transitions", async () => {
    const city = await service.createCity(countryId, {
      name: "Capacity City",
      morphology: "BALANCED",
      idempotencyKey: "capacity-city",
    });
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
    await db.prepare("UPDATE countries SET seed = ? WHERE id = ?").run(1_908_133_256, countryId);
    const city = await service.createCity(countryId, { name: "Lifecycle City", idempotencyKey: "lifecycle-city" });
    const active = await service.createDistrict(countryId, { cityId: city.id, name: "Active District", activate: true, idempotencyKey: "lifecycle-active" });
    const next = await service.createDistrict(countryId, { cityId: city.id, name: "Next District", idempotencyKey: "lifecycle-next" });
    const task = await service.createTask(countryId, { cityId: city.id, districtId: active.id, title: "Disposable Task", estimate: 1, idempotencyKey: "lifecycle-task" });
    await service.updateTaskStatus(countryId, { taskId: task.id, status: "STARTED", comment: "Creates dependent history", idempotencyKey: "lifecycle-start" });
    await expect(service.deleteTask(countryId, { taskId: task.id, confirmTitle: "wrong", idempotencyKey: "delete-task-wrong" }))
      .rejects.toThrowError(/точное.*название/);
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
    // Removed tasks leave a canonical ruined-site marker, not a legacy world feature.
    expect((await service.listDistricts(countryId, city.id)).find((item) => item.id === active.id))
      .toMatchObject({ status: "ABANDONED" });
    const remainingMarkers = await db.prepare("SELECT kind FROM site_markers_v1 WHERE layout_id IN (SELECT id FROM city_layouts_v1 WHERE city_id=?)").all(city.id);
    expect(remainingMarkers).toContainEqual(expect.objectContaining({ kind: "RUINED" }));
    const deletionEvent = (await service.listEvents(countryId)).findLast((event) => event.type === "district.deleted");
    const affected = deletionEvent?.payload.affectedBounds as { minX: number; minY: number; maxX: number; maxY: number };
    expect(affected.minX).toBeLessThanOrEqual(task.origin.x);
    expect(affected.maxX).toBeGreaterThanOrEqual(task.origin.x);

    const beforeDelete = await readActiveBlockLayout(db, city.id);
    const roadsBeforeDelete = rasterizeBlockRoads(beforeDelete!.roadNetwork).length;
    const deletedCity = await service.deleteCity(countryId, { cityId: city.id, confirmName: city.name, idempotencyKey: "delete-city" });
    expect(deletedCity).toMatchObject({ cityId: city.id, districtsDeleted: 2, tasksDeleted: 0 });
    expect(deletedCity.roadsDeleted).toBeGreaterThan(0);
    expect(deletedCity.roadsDeleted).toBeLessThanOrEqual(roadsBeforeDelete);
    expect(await service.listCities(countryId)).toEqual([]);
  }, 20_000);

  it("keeps destructive operations isolated and exact-confirmed", async () => {
    const city = await service.createCity(countryId, { name: "Protected City", idempotencyKey: "protected-city" });
    const district = await service.createDistrict(countryId, { cityId: city.id, name: "Protected District", activate: true, idempotencyKey: "protected-district" });
    const other = await registerUser(db, { email: "delete-other@example.com", name: "Other", password: "password123" });
    await expect(service.deleteCity(countryId, { cityId: city.id, confirmName: "wrong", idempotencyKey: "wrong-city-confirm" })).rejects.toThrowError(/точное.*название/);
    await expect(service.deleteDistrict(countryId, { districtId: district.id, confirmName: "wrong", idempotencyKey: "wrong-district-confirm" })).rejects.toThrowError(/точное.*название/);
    await expect(service.deleteCity(other.user.countryId, { cityId: city.id, confirmName: city.name, idempotencyKey: "foreign-city-delete" })).rejects.toThrowError(/не найден/);
    await expect(service.deleteDistrict(other.user.countryId, { districtId: district.id, confirmName: district.name, idempotencyKey: "foreign-district-delete" })).rejects.toThrowError(/не найден/);
    expect((await service.listDistricts(countryId, city.id)).some((item) => item.id === district.id)).toBe(true);
  }, 20_000);

  it("invalidates both districts when active ownership switches", async () => {
    await db.prepare("UPDATE countries SET seed = ? WHERE id = ?").run(424_242, countryId);
    const city = await service.createCity(countryId, { name: "Switch City", idempotencyKey: "switch-city" });
    const previous = await service.createDistrict(countryId, {
      cityId: city.id, name: "Previous Active", activate: true, idempotencyKey: "switch-previous",
    });
    const next = await service.createDistrict(countryId, {
      cityId: city.id, name: "Next Active", activate: false, idempotencyKey: "switch-next",
    });

    await service.activateDistrict(countryId, next.id, "switch-activate");

    const event = (await service.listEvents(countryId)).findLast((item) => item.type === "district.activated");
    const affected = event?.payload.affectedBounds as { minX: number; minY: number; maxX: number; maxY: number };
    expect([...previous.cells, ...next.cells].every((cell) => (
      cell.x >= affected.minX && cell.x <= affected.maxX && cell.y >= affected.minY && cell.y <= affected.maxY
    ))).toBe(true);
  }, 20_000);

  it("keeps future-district tasks in planning until the district becomes active", async () => {
    const city = await service.createCity(countryId, { name: "Future City", idempotencyKey: "future-city" });
    const future = await service.createDistrict(countryId, { cityId: city.id, name: "Future Sprint", activate: false, idempotencyKey: "future-district" });
    const task = await service.createTask(countryId, { cityId: city.id, districtId: future.id, title: "Future house", estimate: 1, idempotencyKey: "future-task" });
    await expect(service.updateTaskStatus(countryId, { taskId: task.id, status: "STARTED", idempotencyKey: "future-start-early" }))
      .rejects.toThrowError(/до активации/);
    await service.activateDistrict(countryId, future.id, "future-activate");
    expect((await service.updateTaskStatus(countryId, { taskId: task.id, status: "STARTED", idempotencyKey: "future-start" })).status).toBe("STARTED");
  }, 20_000);

  it("isolates tasks between countries", async () => {
    const city = await service.createCity(countryId, { name: "Private City", idempotencyKey: "private-city" });
    await service.createDistrict(countryId, { cityId: city.id, name: "Private District", activate: true, idempotencyKey: "private-district" });
    const task = await service.createTask(countryId, { cityId: city.id, title: "Private Task", estimate: 1, idempotencyKey: "private-task" });
    const other = await registerUser(db, { email: "other@example.com", name: "Other", password: "password123" });
    await expect(service.getTask(other.user.countryId, task.id)).rejects.toThrowError(/не найдена/);
  }, 20_000);

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
  }, 60_000);
});
