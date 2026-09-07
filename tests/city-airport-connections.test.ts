import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppService } from "../src/server/app-service";
import { registerUser } from "../src/server/auth";
import { createTestDb, type Db } from "../src/server/db";
import { blockSlotAirportPoint } from "../src/shared/airport-location";
import { blockSlots } from "../src/shared/block-templates";
import { readActiveBlockLayout } from "../src/server/world/active-block-layout";
import { projectPlanetAtlas } from "../src/shared/planet-atlas";

describe("task-backed cross-city airport scene connections", { timeout: 30_000 }, () => {
  let db: Db;
  let service: AppService;
  let countryId: string;
  let userId: string;
  beforeEach(async () => {
    db = await createTestDb();
    service = new AppService(db);
    const registration = await registerUser(db, { email: "airports@example.test", name: "Airports", password: "password123" });
    countryId = registration.user.countryId;
    userId = registration.user.id;
    await db.prepare("UPDATE countries SET seed=? WHERE id=?").run(424242, countryId);
  });
  afterEach(async () => await db?.close());

  async function airportInCity(scope: string, name: string, finished: boolean) {
    const city = await service.createCity(scope, { name, idempotencyKey: `${name}-city` });
    let districtId = "";
    for (let i = 0; i < 3; i++) {
      const district = await service.createDistrict(scope, { cityId: city.id, name: `${name}-${i}`, activate: false, idempotencyKey: `${name}-district-${i}` });
      districtId = district.id;
      await service.createTask(scope, { cityId: city.id, districtId, title: `Building ${i}`, estimate: 1, idempotencyKey: `${name}-task-${i}` });
    }
    await service.activateDistrict(scope, districtId, `${name}-activate`);
    let task = await service.createTask(scope, { cityId: city.id, districtId, title: "Regional airport", estimate: 1, idempotencyKey: `${name}-airport` });
    expect(task.serviceRole).toBe("AIRPORT");
    for (const status of ["STARTED", "IN_PROGRESS", "TESTING", ...(finished ? ["COMPLETED"] : [])] as const) {
      task = await service.updateTaskStatus(scope, { taskId: task.id, status: status as typeof task.status, comment: "Airport progress", idempotencyKey: `${name}-${status}` });
    }
    const layout = (await readActiveBlockLayout(db, city.id))!;
    const placement = layout.placements.find(p => p.taskId === task.id)!;
    const slot = blockSlots(layout.blocks.find(b => b.id === placement.blockId)!).find(s => s.key === placement.slotKey)!;
    return { city, task, point: blockSlotAirportPoint(slot) };
  }

  it("connects one completed airport per city, excludes unfinished and other-country endpoints, and changes scene identity", async () => {
    const first = await airportInCity(countryId, "Departure", true);
    const unfinished = await airportInCity(countryId, "Arrival", false);
    const before = await service.getCityScene(countryId, first.city.id);
    expect(before.airportConnections).toEqual([]);
    const otherCountry = (await registerUser(db, { email: "other-airports@example.test", name: "Other", password: "password123" })).user.countryId;
    const outside = await airportInCity(otherCountry, "Private airport", true);
    expect((await service.getCityScene(countryId, first.city.id)).airportConnections).toEqual([]);
    await expect(service.getCityScene(countryId, outside.city.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await service.updateTaskStatus(countryId, { taskId: unfinished.task.id, status: "COMPLETED", comment: "Ready", idempotencyKey: "Arrival-ready" });
    const completionEvent = (await service.listEvents(countryId)).findLast(event => event.type === "task.status_changed");
    expect(completionEvent?.payload).toMatchObject({ taskId: unfinished.task.id, serviceRole: "AIRPORT", stage: 5, groundChanged: false });
    const after = await service.getCityScene(countryId, first.city.id);
    expect(after.schemaVersion).toBe(4);
    expect(after.sceneRevision).not.toBe(before.sceneRevision);
    expect(after.airportConnections).toHaveLength(2);
    expect(after.airportConnections).toContainEqual({
      id: `${first.task.id}:${unfinished.task.id}`,
      from: { taskId: first.task.id, cityId: first.city.id, point: first.point },
      to: { taskId: unfinished.task.id, cityId: unfinished.city.id, point: unfinished.point },
    });
    expect(after.airportConnections.some(c => [c.from.taskId, c.to.taskId].includes(outside.task.id))).toBe(false);
    expect((await service.getCityScene(countryId, unfinished.city.id)).airportConnections).toEqual(after.airportConnections);
    await service.deleteTask(countryId, { taskId: unfinished.task.id, confirmTitle: unfinished.task.title, idempotencyKey: "Arrival-demolish" });
    const removed = await service.getCityScene(countryId, first.city.id);
    expect(removed.sceneRevision).not.toBe(after.sceneRevision);
    expect(removed.airportConnections).toEqual([]);
    expect((await service.getCityScene(countryId, unfinished.city.id)).airportConnections).toEqual([]);
  });

  it("keeps routes closed through allowed airport rework and rejects reopening a completed airport at every map level", async () => {
    const departure = await airportInCity(countryId, "Rework departure", true);
    const arrival = await airportInCity(countryId, "Rework arrival", false);
    const readViews = async () => {
      const city = await service.getCityScene(countryId, departure.city.id);
      const overview = await service.getCountryOverview(userId, countryId);
      const atlas = await service.getPlanetAtlas(userId);
      return { city, overview, atlas, projected: projectPlanetAtlas(atlas) };
    };
    const expectEndpoints = (views: Awaited<ReturnType<typeof readViews>>, completed: boolean) => {
      const expectedIds = [departure.task.id, ...(completed ? [arrival.task.id] : [])].sort();
      expect(views.overview.cities.flatMap(city => city.miniature.airports.map(airport => airport.taskId)).sort()).toEqual(expectedIds);
      const planetAirports = views.atlas.countries.find(country => country.id === countryId)!.cities.flatMap(city => city.airports);
      expect(planetAirports.map(airport => airport.taskId).sort()).toEqual(expectedIds);
      expect(planetAirports.find(airport => airport.taskId === departure.task.id)?.center).toEqual(departure.point);
      if (!completed) {
        expect(views.city.airportConnections).toEqual([]);
        expect(views.overview.connections).toEqual([]);
        expect(views.projected.routes).toEqual([]);
      } else {
        expect(planetAirports.find(airport => airport.taskId === arrival.task.id)?.center).toEqual(arrival.point);
        expect(views.city.airportConnections).toHaveLength(2);
        expect(views.city.airportConnections).toContainEqual({
          id: `${departure.task.id}:${arrival.task.id}`,
          from: { taskId: departure.task.id, cityId: departure.city.id, point: departure.point },
          to: { taskId: arrival.task.id, cityId: arrival.city.id, point: arrival.point },
        });
        expect(views.overview.connections).toHaveLength(1);
        expect(new Set(views.overview.connections.flatMap(route => [route.fromCityId, route.toCityId])))
          .toEqual(new Set([departure.city.id, arrival.city.id]));
        expect(views.projected.routes.length).toBeGreaterThan(0);
        for (const route of views.projected.routes) {
          expect(expectedIds).toContain(route.fromAirportId);
          expect(expectedIds).toContain(route.toAirportId);
          expect(route.fromAirportId).not.toBe(route.toAirportId);
        }
      }
    };

    expectEndpoints(await readViews(), false); // stage 4: acceptance is not completion
    const rework = await service.updateTaskStatus(countryId, {
      taskId: arrival.task.id, status: "IN_PROGRESS", comment: "Correct the unfinished runway", idempotencyKey: "arrival-rework",
    });
    expect(rework).toMatchObject({ stage: 3, serviceRole: "AIRPORT", origin: arrival.task.origin });
    expectEndpoints(await readViews(), false);
    const testing = await service.updateTaskStatus(countryId, {
      taskId: arrival.task.id, status: "TESTING", comment: "Ready for another acceptance pass", idempotencyKey: "arrival-retest",
    });
    expect(testing.stage).toBe(4);
    expectEndpoints(await readViews(), false);
    await service.updateTaskStatus(countryId, {
      taskId: arrival.task.id, status: "COMPLETED", comment: "Runway accepted", idempotencyKey: "arrival-rework-complete",
    });
    const ready = await readViews();
    expectEndpoints(ready, true);
    const eventCount = (await service.listEvents(countryId)).length;

    // COMPLETED -> TESTING is not an allowed lifecycle transition. Do not fake
    // a reopened airport through direct SQL merely to exercise route removal.
    await expect(service.updateTaskStatus(countryId, {
      taskId: arrival.task.id, status: "TESTING", comment: "Cannot reopen completed work", idempotencyKey: "arrival-invalid-reopen",
    })).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    expect(await service.getTask(countryId, arrival.task.id)).toMatchObject({ stage: 5, status: "COMPLETED" });
    const unchanged = await readViews();
    expectEndpoints(unchanged, true);
    expect(unchanged.city.sceneRevision).toBe(ready.city.sceneRevision);
    expect(unchanged.city.airportConnections).toEqual(ready.city.airportConnections);
    expect(unchanged.overview.revision).toBe(ready.overview.revision);
    expect(unchanged.overview.connections).toEqual(ready.overview.connections);
    expect(unchanged.atlas.revision).toBe(ready.atlas.revision);
    expect(unchanged.projected.routes).toEqual(ready.projected.routes);
    expect((await service.listEvents(countryId)).length).toBe(eventCount);
  });
});
