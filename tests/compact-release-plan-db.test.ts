import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { createTestDb, transaction } from "../src/server/db";
import { registerUser } from "../src/server/auth";
import { AppService } from "../src/server/app-service";
import { readActiveBlockLayout } from "../src/server/world/active-block-layout";
import { readCountryRoads } from "../src/server/world/intercity-road-store";

function releaseQuery() {
  const shell = readFileSync(new URL("../deploy/compact-release-preflight.sh", import.meta.url), "utf8");
  return shell.match(/compact_release_query "(SELECT\n[\s\S]*?);"/)![1]!;
}

it("executes the real read-only release query against v2/v3 and malformed stored plans", async () => {
  const db = await createTestDb();
  try {
    const { user } = await registerUser(db, { email: "plan-preflight@example.test", password: "test-password", name: "Preflight" });
    await db.prepare("UPDATE countries SET seed=424242 WHERE id=?").run(user.countryId);
    const service = new AppService(db);
    const city = await service.createCity(user.countryId, { name: "Preflight", idempotencyKey: "city" });
    const district = await service.createDistrict(user.countryId, { cityId: city.id, name: "Sprint", activate: true, idempotencyKey: "district" });
    await service.createTask(user.countryId, { cityId: city.id, districtId: district.id, title: "House", estimate: 1, idempotencyKey: "task" });
    const block = (await readActiveBlockLayout(db, city.id))!.blocks[0]!;
    const query = releaseQuery();
    const count = async () => Number(Object.values((await db.prepare(query).get())!)[0]);
    expect(await count()).toBe(0);
    const withoutPlan = { ...block.parameters }; delete withoutPlan.sitePlan;
    for (const sitePlan of [null, {}, { version: 1, parcels: [] }, { version: 1, parcels: "invalid" }, { version: "1", parcels: [{}] }, { version: 1, parcels: [{}] }]) {
      await db.prepare("UPDATE city_blocks_v1 SET parameters_json=?::jsonb WHERE id=?")
        .run(JSON.stringify({ ...withoutPlan, sitePlan }), block.id);
      expect(await count()).toBe(1);
    }
    const parcel = { x: 3, y: 3, width: 6, height: 6, clearance: 1, kind: "BUILDING", family: "compact-apartment-v1" };
    for (const invalid of [
      { ...parcel, x: "3" }, { ...parcel, y: -1 }, { ...parcel, width: 0 }, { ...parcel, height: 1.5 },
      { ...parcel, clearance: 2 }, { ...parcel, kind: "UNKNOWN" }, { ...parcel, family: null },
      { ...parcel, kind: "PARK" }, { ...parcel, width: block.width },
    ]) {
      await db.prepare("UPDATE city_blocks_v1 SET parameters_json=?::jsonb WHERE id=?")
        .run(JSON.stringify({ ...withoutPlan, sitePlan: { version: 1, parcels: [invalid] } }), block.id);
      expect(await count(), JSON.stringify(invalid)).toBe(1);
    }
    await db.prepare("UPDATE city_blocks_v1 SET parameters_json=?::jsonb WHERE id=?")
      .run(JSON.stringify({ ...withoutPlan, sitePlan: { version: 1,
        parcels: [{ x: 3, y: 3, width: 6, height: 6, clearance: 0, kind: "PARK" }] } }), block.id);
    expect(await count()).toBe(0); // A valid non-building parcel has no family; clearance0 is supported.
    await db.prepare("UPDATE city_blocks_v1 SET template_version=2,parameters_json=?::jsonb WHERE id=?")
      .run(JSON.stringify(block.parameters), block.id);
    expect(await count()).toBe(1);
    await db.prepare("UPDATE city_blocks_v1 SET parameters_json=?::jsonb WHERE id=?").run(JSON.stringify(withoutPlan), block.id);
    expect(await count()).toBe(0);
  } finally { await db.close(); }
});

it("requires canonical reader-ready snapshots for every developed country, not for empty worlds", async () => {
  const db = await createTestDb();
  try {
    const count = () => transaction(db, async () => {
      await db.exec("SET TRANSACTION READ ONLY");
      return Number(Object.values((await db.prepare(releaseQuery()).get())!)[0]);
    });
    const { user } = await registerUser(db, { email: "roads-preflight@example.test", password: "test-password", name: "Roads" });
    expect(await count()).toBe(0);
    await db.prepare("UPDATE countries SET seed=1 WHERE id=?").run(user.countryId);
    const service = new AppService(db);
    const cities = [];
    // These are real default sites. Creating both empty cities first preserves
    // the known dry intercity route; no fixture geometry or planner bypass.
    for (const name of ["City A", "City B"]) cities.push(await service.createCity(user.countryId, { name, idempotencyKey: `city-${name}` }));
    for (const city of cities) {
      const district = await service.createDistrict(user.countryId, { cityId: city.id, name: "Sprint", activate: true, idempotencyKey: `district-${city.id}` });
      await service.createTask(user.countryId, { cityId: city.id, districtId: district.id, title: "House", estimate: 1, idempotencyKey: `task-${city.id}` });
    }
    const stored = (await readCountryRoads(db, user.countryId))!;
    expect(stored.plan.routes).toHaveLength(1);
    expect(await count(), JSON.stringify(stored.plan)).toBe(0);
    const setPlan = (plan: unknown) => db.prepare("UPDATE country_road_snapshots_v1 SET plan_json=?::jsonb WHERE country_id=?")
      .run(JSON.stringify(plan), user.countryId);
    const route = stored.plan.routes[0]!;
    const badPlans = [
      {}, { ...stored.plan, countryId: "other-country" }, { ...stored.plan, seed: 2 },
      { ...stored.plan, seed: "1" }, { ...stored.plan, routes: null }, { ...stored.plan, routes: {} },
      { ...stored.plan, unreachable: {} }, { ...stored.plan, components: null }, { ...stored.plan, metrics: [] },
      { ...stored.plan, metrics: { ...stored.plan.metrics, visited: "1" } },
      { ...stored.plan, components: [[null]] }, { ...stored.plan, components: ["not-an-array"] },
      { ...stored.plan, unreachable: [{ fromCityId: cities[0]!.id, toCityId: cities[1]!.id, reason: "INVENTED" }] },
      { ...stored.plan, routes: [null] }, { ...stored.plan, routes: [{ ...route, widthCells: 4 }] },
      { ...stored.plan, routes: Array.from({ length: 101 }, () => route) },
      { ...stored.plan, routes: [{ ...route, fromNodeId: "" }] },
      { ...stored.plan, routes: [{ ...route, geometry: { start: { x: 1.5, y: 1 }, runs: [{ direction: "E", length: 2 }] } }] },
      { ...stored.plan, routes: [{ ...route, geometry: { ...route.geometry, runs: [] } }] },
      { ...stored.plan, routes: [{ ...route, geometry: { ...route.geometry, runs: [{ direction: "NE", length: 2 }] } }] },
      { ...stored.plan, routes: [{ ...route, geometry: { ...route.geometry, runs: [{ direction: "E", length: 0 }] } }] },
      { ...stored.plan, routes: [{ ...route, geometry: { ...route.geometry, runs: [{ direction: "E", length: "2" }] } }] },
      { ...stored.plan, routes: [{ ...route, geometry: { ...route.geometry, runs: [{ direction: "E", length: Number.MAX_SAFE_INTEGER + 1 }] } }] },
      { ...stored.plan, routes: [{ ...route, geometry: { ...route.geometry, start: { x: Number.MAX_SAFE_INTEGER + 1, y: 1 } } }] },
    ];
    for (const plan of badPlans) {
      await setPlan(plan);
      expect(await count(), JSON.stringify(plan)).toBe(1);
    }
    // This preflight checks the reader contract, not universal connectivity.
    await setPlan({ ...stored.plan, routes: [], components: cities.map(city => [city.id]),
      unreachable: [{ fromCityId: cities[0]!.id, toCityId: cities[1]!.id, reason: "ROUTE_BUDGET" }] });
    expect(await count()).toBe(0);
    await setPlan(stored.plan);

    const { user: other } = await registerUser(db, { email: "other-preflight@example.test", password: "test-password", name: "Other" });
    expect(await count()).toBe(0); // A separate empty country is allowed.
    const otherCity = await service.createCity(other.countryId, { name: "Other", idempotencyKey: "other-city" });
    const otherDistrict = await service.createDistrict(other.countryId, { cityId: otherCity.id, name: "Sprint", activate: true, idempotencyKey: "other-district" });
    await service.createTask(other.countryId, { cityId: otherCity.id, districtId: otherDistrict.id, title: "Other house", estimate: 1, idempotencyKey: "other-task" });
    expect((await readCountryRoads(db, other.countryId))!.plan.routes).toEqual([]);
    expect(await count()).toBe(0); // A developed one-city country needs a valid empty plan.
    await db.prepare("DELETE FROM country_road_snapshots_v1 WHERE country_id=?").run(other.countryId);
    expect(await count()).toBe(1); // First country's ready snapshot cannot mask another missing one.
  } finally { await db.close(); }
});
