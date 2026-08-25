import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppService, DomainError } from "../src/server/app-service";
import { registerUser } from "../src/server/auth";
import { createTestDb, type Db } from "../src/server/db";
import type { RealtimeEvent } from "../src/shared/contracts";
import { boundsOf, expandRect, intersects } from "../src/server/world/grid";

describe("country atlas read model", () => {
  let db: Db;
  let service: AppService;
  let countryId: string;

  beforeEach(async () => {
    db = await createTestDb();
    service = new AppService(db);
    countryId = (await registerUser(db, {
      email: "atlas@example.com", name: "Atlas", password: "password123",
    })).user.countryId;
  });

  afterEach(async () => await db.close());

  it("publishes real districts and task buildings in compact atlas coordinates", async () => {
    const city = await service.createCity(countryId, { name: "Riverside", idempotencyKey: "atlas-city" });
    const districts = [];
    for (let index = 0; index < 3; index += 1) {
      districts.push(await service.createDistrict(countryId, {
        cityId: city.id,
        name: `District ${index + 1}`,
        activate: index === 0,
        idempotencyKey: `atlas-district-${index}`,
      }));
    }
    const tasks = [await service.createTask(countryId, {
      cityId: city.id,
      districtId: districts[0]!.id,
      title: "Atlas building",
      estimate: 3,
      idempotencyKey: "atlas-building",
    })];

    const atlas = await service.getCountryAtlas(countryId);
    const sourceFeatures = (await service.listWorldFeatures(countryId)).filter((feature) => feature.cityId === city.id);
    const airports = sourceFeatures.filter((feature) => feature.kind === "AIRPORT" && feature.assetKind === "AREA");

    expect(atlas).toMatchObject({ schemaVersion: 5, cities: [{ id: city.id, name: "Riverside" }] });
    expect(Number.isInteger(atlas.terrainSeed)).toBe(true);
    expect(atlas.cities[0]!.districts).toHaveLength(3);
    for (const district of atlas.cities[0]!.districts) {
      expect(district.sourceBounds.minX).toBeLessThanOrEqual(district.sourceCenter.x);
      expect(district.sourceBounds.maxX).toBeGreaterThanOrEqual(district.sourceCenter.x);
      expect(district.sourceBounds.minY).toBeLessThanOrEqual(district.sourceCenter.y);
      expect(district.sourceBounds.maxY).toBeGreaterThanOrEqual(district.sourceCenter.y);
    }
    expect(atlas.cities[0]!.buildings.map((building) => building.id).sort()).toEqual(tasks.map((task) => task.id).sort());
    expect(atlas.cities[0]!.roads.length).toBeGreaterThan(0);
    expect(atlas.cities[0]!.surfaces.length).toBeGreaterThan(0);
    expect(new Set(atlas.cities[0]!.roads.map((road) => `${road.atlasCell.x}:${road.atlasCell.y}`)).size)
      .toBe(atlas.cities[0]!.roads.length);
    expect(new Set(atlas.cities[0]!.surfaces.map((surface) => `${surface.atlasCell.x}:${surface.atlasCell.y}:${surface.kind}`)).size)
      .toBe(atlas.cities[0]!.surfaces.length);
    expect("macroTerrain" in atlas).toBe(false);
    expect(atlas.cities[0]!.cutoutMask.length).toBeGreaterThan(atlas.cities[0]!.atlasMask.length);
    expect("cutoutTerrain" in atlas.cities[0]!).toBe(false);
    expect(atlas.cities[0]!.districts.flatMap((district) => district.displayCells)).toHaveLength(atlas.cities[0]!.cutoutMask.length);
    expect(atlas.cities[0]!.features.map((feature) => feature.id).sort()).toEqual(sourceFeatures.map((feature) => feature.id).sort());
    expect(airports).toHaveLength(1);
    expect(airports[0]!.assetKey).toMatch(/^city-airport-terminal-[1-5]$/);
    expect(airports[0]!.accessPath.length).toBeGreaterThan(4);
    const airportRoads = new Set((await db.prepare("SELECT x, y FROM roads_v3 WHERE country_id = ?").all(countryId) as Array<{ x: number; y: number }>)
      .map((road) => `${road.x}:${road.y}`));
    expect(airports[0]!.accessPath.every((cell) => airportRoads.has(`${cell.x}:${cell.y}`))).toBe(true);
    expect(airports[0]!.footprint.every((cell) => !airportRoads.has(`${cell.x}:${cell.y}`))).toBe(true);
    expect(atlas.cities[0]!.features).toContainEqual(expect.objectContaining({ id: airports[0]!.id, kind: "AIRPORT" }));
    for (const building of atlas.cities[0]!.buildings) {
      expect(building.atlasFootprint).not.toHaveLength(0);
      expect(atlas.cities[0]!.atlasMask).toContainEqual(building.atlasOrigin);
    }
    const statusEvent: RealtimeEvent = {
      id: 99,
      countryId,
      type: "task.status_changed",
      worldVersion: atlas.worldVersion + 1,
      payload: { taskId: tasks[0]!.id, status: "IN_PROGRESS", progress: 60, stage: 3, groundChanged: false },
      createdAt: "2026-08-24T00:00:00.000Z",
    };
    // A newer unrelated event can advance the general world-version fence
    // before a delayed visual event reaches this replica. Atlas invalidation
    // must still apply the delayed event when its snapshot is older.
    service.acceptExternalEvent({
      ...statusEvent,
      id: 98,
      worldVersion: statusEvent.worldVersion + 1,
      type: "task.comment_added",
      payload: { taskId: tasks[0]!.id },
    });
    service.acceptExternalEvent(statusEvent);
    const patched = await service.getCountryAtlas(countryId);
    expect(patched.worldVersion).toBe(statusEvent.worldVersion);
    expect(patched.cities[0]!.buildings[0]).toMatchObject({ progress: 60, stage: 3, status: "IN_PROGRESS" });
    expect(patched.cities[0]!.districts.find((district) => district.id === tasks[0]!.districtId)!.progress).toBe(60);

    const listCities = vi.spyOn(service, "listCities");
    service.acceptExternalEvent({ ...statusEvent, id: 100, worldVersion: statusEvent.worldVersion + 2, type: "task.comment_added", payload: { taskId: tasks[0]!.id } });
    await service.getCountryAtlas(countryId);
    expect(listCities).not.toHaveBeenCalled();
    service.acceptExternalEvent({ ...statusEvent, id: 101, worldVersion: statusEvent.worldVersion + 3, type: "district.renamed", payload: { districtId: districts[0]!.id } });
    await service.getCountryAtlas(countryId);
    expect(listCities).toHaveBeenCalled();
    expect((await service.listCities(countryId))[0]!.center).toEqual(city.center);
  }, 30_000);

  it("transactionally relocates a legacy airport whose occupied site cannot accept an access road", async () => {
    const city = await service.createCity(countryId, { name: "Legacy airport city", idempotencyKey: "legacy-airport-city" });
    const airport = (await service.listWorldFeatures(countryId))
      .find((feature) => feature.kind === "AIRPORT" && feature.cityId === city.id && feature.assetKind === "AREA")!;
    const legacyOrigin = { x: city.center.x - 22, y: city.center.y - 11 };
    const delta = { x: legacyOrigin.x - airport.origin.x, y: legacyOrigin.y - airport.origin.y };
    const legacyFootprint = airport.footprint.map((cell) => ({ x: cell.x + delta.x, y: cell.y + delta.y }));
    await db.prepare("UPDATE world_features_v6 SET origin_x = ?, origin_y = ?, footprint_json = ?, access_json = ? WHERE id = ?").run(
      legacyOrigin.x, legacyOrigin.y, JSON.stringify(legacyFootprint), JSON.stringify([]), airport.id,
    );
    type AirportRoadWriter = {
      addRoadPath: (countryId: string, seed: number, path: Array<{ x: number; y: number }>, roadClass: "LOCAL", snapshot?: unknown) => Promise<void>;
    };
    const roadWriter = service as unknown as AirportRoadWriter;
    const addRoadPath = roadWriter.addRoadPath.bind(roadWriter);
    vi.spyOn(roadWriter, "addRoadPath").mockImplementation(async (...args) => {
      const start = args[2][0]!;
      if (Math.abs(start.x - city.center.x) + Math.abs(start.y - city.center.y) < 48) {
        throw new DomainError("ROUTE_BLOCKED", "legacy airport site is occupied");
      }
      await addRoadPath(...args);
    });

    expect(await service.upgradeCityAirports()).toBe(1);

    const relocated = (await service.listWorldFeatures(countryId))
      .find((feature) => feature.kind === "AIRPORT" && feature.cityId === city.id && feature.assetKind === "AREA")!;
    expect(relocated.id).not.toBe(airport.id);
    expect(relocated.accessPath.length).toBeGreaterThan(4);
    expect(intersects(expandRect(city.bounds, 4), boundsOf(relocated.footprint))).toBe(false);
  }, 30_000);
});
