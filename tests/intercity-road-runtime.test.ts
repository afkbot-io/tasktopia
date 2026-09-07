import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type Db } from "../src/server/db";
import { registerUser } from "../src/server/auth";
import { AppService } from "../src/server/app-service";
import { readCountryRoads } from "../src/server/world/intercity-road-store";
import { readActiveBlockLayout } from "../src/server/world/active-block-layout";
import { decodeOrthogonalRoadRuns } from "../src/shared/semantic-road";
import { intercityRoadCorridors } from "../src/shared/intercity-roads";
import { isBuildableTerrain, terrainAt } from "../src/shared/world-terrain";
import { expandRoadRuns } from "../src/shared/world-cell-runs";
import { auditWorld } from "../src/server/world/world-audit";

describe("intercity roads through actual city mutations", { timeout: 60_000 }, () => {
  let db: Db, service: AppService, countryId: string, userId: string;
  beforeEach(async () => {
    db = await createTestDb(); service = new AppService(db);
    const user = (await registerUser(db, { email: "road-runtime@example.com", name: "Road runtime", password: "password123" })).user;
    countryId = user.countryId; userId = user.id;
    // This real seed has a dry corridor between the first two generated sites.
    await db.prepare("UPDATE countries SET seed=1 WHERE id=?").run(countryId);
  });
  afterEach(async () => { await db?.close(); });
  it("waits for actual blocks, serves a dry exit in CITY, reserves its corridor during growth and preserves it on reload", async () => {
    const a = await service.createCity(countryId, { name: "Road Alpha", idempotencyKey: "a" });
    const b = await service.createCity(countryId, { name: "Road Beta", idempotencyKey: "b" });
    expect((await readCountryRoads(db, countryId))!.plan.routes).toEqual([]);
    const districtA = await service.createDistrict(countryId, { cityId: a.id, name: "Alpha sprint", activate: true, idempotencyKey: "ad" });
    const districtB = await service.createDistrict(countryId, { cityId: b.id, name: "Beta sprint", activate: true, idempotencyKey: "bd" });
    const first = await service.createTask(countryId, { cityId: a.id, districtId: districtA.id, title: "Alpha house", estimate: 1, idempotencyKey: "at" });
    await service.createTask(countryId, { cityId: b.id, districtId: districtB.id, title: "Beta house", estimate: 1, idempotencyKey: "bt" });
    const accepted = (await readCountryRoads(db, countryId))!;
    expect(accepted.plan.routes, JSON.stringify(accepted.plan)).toHaveLength(1);
    expect(await db.prepare("SELECT payload_json->>'groundRoadTopologyChanged' AS changed FROM events WHERE country_id=? ORDER BY id DESC LIMIT 1").get(countryId)).toEqual({ changed: "true" });
    for (const route of accepted.plan.routes) for (const point of decodeOrthogonalRoadRuns(route.geometry)) {
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        expect(isBuildableTerrain(terrainAt(1, point.x + dx, point.y + dy).terrain)).toBe(true);
      }
    }
    const scene = await service.getCityScene(countryId, a.id);
    expect(scene.intercityRoads).toEqual(accepted.plan.routes);
    const overview = await service.getCountryOverview(userId, countryId);
    expect(overview.groundRoads.routes.map(route => route.id), JSON.stringify(overview.groundRoads.unavailable))
      .toEqual(accepted.plan.routes.map(route => route.id));
    expect(overview.connections).toEqual([]); // Ground links never invent airports/flights.
    const sceneRoads = new Set(scene.chunks.flatMap(chunk => expandRoadRuns(chunk.roadRuns).map(road => `${road.x}:${road.y}`)));
    const path = decodeOrthogonalRoadRuns(accepted.plan.routes[0]!.geometry);
    const endpoints = [path[0]!, path.at(-1)!];
    expect(endpoints.some(p => sceneRoads.has(`${p.x}:${p.y}`))).toBe(true);
    await service.updateTaskStatus(countryId, { taskId: first.id, status: "STARTED", idempotencyKey: "stage" });
    expect(await readCountryRoads(db, countryId)).toEqual(accepted);
    expect(await db.prepare("SELECT payload_json->>'groundRoadTopologyChanged' AS changed FROM events WHERE country_id=? ORDER BY id DESC LIMIT 1").get(countryId)).toEqual({ changed: null });
    for (let i = 0; i < 35; i++) await service.createTask(countryId, { cityId: a.id, districtId: districtA.id, title: `Growth ${i}`, estimate: 1, idempotencyKey: `g${i}` });
    const grown = (await readCountryRoads(db, countryId))!;
    expect(grown.plan.routes).toEqual(accepted.plan.routes);
    const layout = (await readActiveBlockLayout(db, a.id))!;
    expect(layout.blocks.length).toBeGreaterThan(1);
    for (const block of layout.blocks) for (const road of intercityRoadCorridors(grown.plan.routes)) {
      const intersectsInterior = block.origin.x + 3 <= road.maxX && block.origin.x + block.width - 3 >= road.minX
        && block.origin.y + 3 <= road.maxY && block.origin.y + block.height - 3 >= road.minY;
      expect(intersectsInterior).toBe(false);
    }
    expect((await new AppService(db).getCityScene(countryId, a.id)).intercityRoads).toEqual(accepted.plan.routes);
    expect((await service.getTask(countryId, first.id)).origin).toEqual(first.origin);
    expect((await auditWorld(db, service, countryId)).violations).toEqual([]);
  });
  it("fails closed without mutating a missing derived snapshot on a read", async () => {
    const city = await service.createCity(countryId, { name: "Missing road snapshot", idempotencyKey: "missing-city" });
    const district = await service.createDistrict(countryId, { cityId: city.id, name: "Missing snapshot sprint", activate: true, idempotencyKey: "missing-district" });
    await service.createTask(countryId, { cityId: city.id, districtId: district.id, title: "Standing house", estimate: 1, idempotencyKey: "missing-task" });
    await db.prepare("DELETE FROM country_road_snapshots_v1 WHERE country_id=?").run(countryId);
    const fresh = new AppService(db);
    await expect(fresh.getCityScene(countryId, city.id)).rejects.toMatchObject({ code: "WORLD_REGENERATION_REQUIRED" });
    await expect(fresh.getCountryOverview(userId, countryId)).rejects.toMatchObject({ code: "WORLD_REGENERATION_REQUIRED" });
    expect(await readCountryRoads(db, countryId)).toBeUndefined();
    expect((await auditWorld(db, fresh, countryId)).violations).toContainEqual({ code: "COUNTRY_ROADS_REGENERATION_REQUIRED", message: countryId });
  });
});
