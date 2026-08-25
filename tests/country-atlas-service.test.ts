import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppService } from "../src/server/app-service";
import { registerUser } from "../src/server/auth";
import { createTestDb, type Db } from "../src/server/db";
import type { RealtimeEvent } from "../src/shared/contracts";

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
});
