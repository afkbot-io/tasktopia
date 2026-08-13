import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppService } from "../src/server/app-service";
import { registerUser } from "../src/server/auth";
import { createTestDb, type Db } from "../src/server/db";

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

    expect(atlas).toMatchObject({ schemaVersion: 1, cities: [{ id: city.id, name: "Riverside" }] });
    expect(atlas.cities[0]!.districts).toHaveLength(3);
    expect(atlas.cities[0]!.buildings.map((building) => building.id).sort()).toEqual(tasks.map((task) => task.id).sort());
    expect(atlas.cities[0]!.roads.length).toBeGreaterThan(0);
    expect(atlas.cities[0]!.surfaces.length).toBeGreaterThan(0);
    expect(atlas.macroTerrain.length).toBeGreaterThan(0);
    expect(atlas.cities[0]!.cutoutMask.length).toBeGreaterThan(atlas.cities[0]!.atlasMask.length);
    expect(atlas.cities[0]!.cutoutTerrain).toHaveLength(atlas.cities[0]!.cutoutMask.length);
    expect(atlas.cities[0]!.districts.flatMap((district) => district.displayCells)).toHaveLength(atlas.cities[0]!.cutoutMask.length);
    expect(atlas.cities[0]!.features.map((feature) => feature.id).sort()).toEqual(sourceFeatures.map((feature) => feature.id).sort());
    for (const building of atlas.cities[0]!.buildings) {
      expect(building.atlasFootprint).not.toHaveLength(0);
      expect(atlas.cities[0]!.atlasMask).toContainEqual(building.atlasOrigin);
    }
    expect((await service.listCities(countryId))[0]!.center).toEqual(city.center);
  }, 30_000);
});
