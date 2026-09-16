import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import { registerRoutes } from "../src/server/routes";
import type { CountryOverviewDto } from "../src/shared/country-overview-contract";
import type { PlanetAtlasDto } from "../src/shared/planet-atlas-contract";
import type { CitySceneDto } from "../src/shared/city-scene-contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppService } from "../src/server/app-service";
import { registerUser } from "../src/server/auth";
import { createTestDb, type Db } from "../src/server/db";
import { blockSlotAirportPoint } from "../src/shared/airport-location";
import { blockSlots } from "../src/shared/block-templates";
import { readActiveBlockLayout } from "../src/server/world/active-block-layout";
import { transportSchedule } from "../src/shared/transport-schedule";
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

  it("publishes the same three-city domestic graph on CITY, COUNTRY and PLANET and reconnects after deletion",async()=>{
    const app=Fastify();await app.register(fastifyCookie);await registerRoutes(app,db,service);await app.ready();
    try {
    const login=await app.inject({method:"POST",url:"/api/auth/login",payload:{email:"airports@example.test",password:"password123"}});
    expect(login.statusCode).toBe(200);
    const setCookie=login.headers["set-cookie"]!;
    const cookie=(Array.isArray(setCookie)?setCookie[0]!:setCookie).split(";")[0]!;
    const get=async<T,>(url:string):Promise<T>=>{
      const response=await app.inject({method:"GET",url,headers:{cookie}});expect(response.statusCode).toBe(200);return response.json() as T;
    };
    const airports=await Promise.all(["Graph A","Graph B","Graph C"].map(name=>airportInCity(countryId,name,true)));
    const verify=async(active:typeof airports)=>{
      const overview=await get<CountryOverviewDto>(`/api/countries/${countryId}/overview`);
      const planet=projectPlanetAtlas(await get<PlanetAtlasDto>("/api/planet-atlas"));
      const identity=(a:string,b:string)=>transportSchedule("AIR",a,b).id;
      const expected=overview.connections.map(route=>identity(route.fromAirportId!,route.toAirportId!)).sort();
      expect(expected).toHaveLength(active.length-1);
      expect(planet.routes.filter(r=>r.fromCountryId===countryId&&r.toCountryId===countryId).map(r=>r.id).sort()).toEqual(expected);
      const fromScenes=new Set<string>();
      for(const airport of active){
        const scene=await get<CitySceneDto>(`/api/countries/${countryId}/cities/${airport.city.id}/scene`);
        for(const route of scene.airportConnections){
          const id=identity(route.from.taskId,route.to.taskId);expect(expected).toContain(id);fromScenes.add(id);
          expect([route.from.cityId,route.to.cityId]).toContain(airport.city.id);
        }
      }
      expect([...fromScenes].sort()).toEqual(expected);
    };
    await verify(airports);
    const middle=[...airports].sort((a,b)=>a.city.id.localeCompare(b.city.id))[1]!;
    await service.deleteTask(countryId,{taskId:middle.task.id,confirmTitle:middle.task.title,idempotencyKey:"graph-delete-middle"});
    await verify(airports.filter(a=>a!==middle));
    } finally {await app.close();}
  });

  it("shows the same authorized international flight at all scales and removes it on access revocation",async()=>{
    const local=await airportInCity(countryId,"Local international",true);
    const owner=(await registerUser(db,{email:"foreign-flight@example.test",name:"Foreign",password:"password123"})).user;
    const foreign=await airportInCity(owner.countryId,"Foreign international",true);
    const scene=()=>service.getCitySceneForUser(userId,countryId,local.city.id);
    expect((await scene()).airportConnections).toEqual([]);
    await db.prepare("INSERT INTO country_members(country_id,user_id,role,created_at) VALUES (?,?,'MEMBER',now())").run(owner.countryId,userId);
    const atlas=projectPlanetAtlas(await service.getPlanetAtlas(userId));
    const route=atlas.routes.find(r=>r.fromCountryId!==r.toCountryId)!;
    expect(route).toBeDefined();
    const city=await scene();
    expect(city.airportConnections).toHaveLength(2);
    const ids=[...new Set(city.airportConnections.map(r=>transportSchedule("AIR",r.from.taskId,r.to.taskId).id))];
    expect(ids).toEqual([route.id]);
    const endpoint=city.airportConnections.flatMap(r=>[r.from,r.to]).find(e=>e.taskId===foreign.task.id)!;
    expect(endpoint.point).not.toEqual(foreign.point);
    expect(city.airportConnections.flatMap(r=>[r.from,r.to]).find(e=>e.taskId===local.task.id)!.point).toEqual(local.point);
    const overview=await service.getCountryOverview(userId,countryId);
    expect(overview.connections.map(r=>transportSchedule("AIR",r.fromAirportId!,r.toAirportId!).id)).toEqual(ids);
    expect(overview.cities.some(c=>c.id===foreign.city.id)).toBe(false);
    const cards=(await service.getCityDevelopment(userId,countryId,local.city.id)).transport!;
    expect(cards.find(c=>c.kind==="AIR")!.routes[0]).toMatchObject({id:route.id,destinationName:"Foreign international"});
    await db.prepare("DELETE FROM country_members WHERE country_id=? AND user_id=?").run(owner.countryId,userId);
    expect((await scene()).airportConnections).toEqual([]);
    expect((await service.getCountryOverview(userId,countryId)).connections).toEqual([]);
    expect((await service.getCityDevelopment(userId,countryId,local.city.id)).transport!.find(c=>c.kind==="AIR")!.routes).toEqual([]);
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
