import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

  it("creates a planned district and advances a sprite building through five stages", async () => {
    const city = await service.createCity(countryId, { name: "Southport", idempotencyKey: "c1" });
    const district = await service.createDistrict(countryId, { cityId: city.id, name: "Core", archetype: "MIXED_URBAN", activate: true, idempotencyKey: "d1" });
    expect(district.cells.length).toBeGreaterThan(250);
    expect(connected(district.cells)).toBe(true);
    expect(district.lots.length).toBeGreaterThanOrEqual(3);
    let task = await service.createTask(countryId, { cityId: city.id, title: "Build cafe", estimate: 2, buildingHint: "commercial-corner-cafe", idempotencyKey: "t1" });
    expect(task.stage).toBe(1);
    const taskChunk = await service.chunkForCell(task.origin);
    expect((await service.getChunk(countryId, taskChunk.chunkX, taskChunk.chunkY)).tasks.find((item) => item.id === task.id)?.stage).toBe(1);
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

  it("enforces district SP capacity and status transitions", async () => {
    const city = await service.createCity(countryId, { name: "Capacity City", idempotencyKey: "capacity-city" });
    await service.createDistrict(countryId, { cityId: city.id, name: "Short Sprint", capacitySp: 3, activate: true, idempotencyKey: "capacity-district" });
    const task = await service.createTask(countryId, { cityId: city.id, title: "Three point task", estimate: 3, idempotencyKey: "capacity-task" });
    await expect(service.createTask(countryId, { cityId: city.id, title: "Overflow task", estimate: 1, idempotencyKey: "capacity-overflow" }))
      .rejects.toThrowError(/вместимость 3 SP/);
    await expect(service.updateTaskStatus(countryId, { taskId: task.id, status: "TESTING", idempotencyKey: "skip-stage" }))
      .rejects.toThrowError(/пропускать стадии/);
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
  });

  it("connects a second city to the existing national road component", async () => {
    const cities = await Promise.all(Array.from({ length: 2 }, (_, index) => service.createCity(countryId, { name: `City ${index}`, idempotencyKey: `city-${index}` })));
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
      for (const cell of feature.footprint) expect(roads.some((road) => cellKey(road) === cellKey(cell))).toBe(false);
    }
  }, 15_000);

  it("keeps committed tasks fixed when spatial growth is needed", async () => {
    await db.prepare("UPDATE countries SET seed = 424242 WHERE id = ?").run(countryId);
    const city = await service.createCity(countryId, { name: "Growth City", idempotencyKey: "growth-city" });
    await service.createDistrict(countryId, { cityId: city.id, name: "Growth", capacitySp: 26, activate: true, idempotencyKey: "growth-district" });
    const first = await service.createTask(countryId, { cityId: city.id, title: "First parking", estimate: 1, buildingHint: "commercial-parking-lot", idempotencyKey: "growth-task-0" });
    const committed = JSON.stringify(first.footprint);
    for (let index = 1; index < 25; index += 1) {
      await service.createTask(countryId, { cityId: city.id, title: `Parking ${index}`, estimate: 1, buildingHint: "commercial-parking-lot", idempotencyKey: `growth-task-${index}` });
    }
    const district = (await service.listDistricts(countryId, city.id))[0]!;
    expect(district.cells.length).toBeGreaterThan(300);
    expect(JSON.stringify((await service.getTask(countryId, first.id)).footprint)).toBe(committed);
    const roadKeys = new Set((await db.prepare("SELECT x, y FROM roads_v3 WHERE country_id = ?").all(countryId) as Array<{ x: number; y: number }>).map(cellKey));
    for (const task of await service.listTasks(countryId)) for (const cell of task.footprint) expect(roadKeys.has(cellKey(cell))).toBe(false);
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
