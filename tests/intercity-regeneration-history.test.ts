import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppService } from "../src/server/app-service";
import { registerUser } from "../src/server/auth";
import { createTestDb, type Db } from "../src/server/db";
import { readActiveBlockLayout } from "../src/server/world/active-block-layout";
import { readCountryRoads } from "../src/server/world/intercity-road-store";
import { auditWorld } from "../src/server/world/world-audit";
import { decodeOrthogonalRoadRuns } from "../src/shared/semantic-road";
import { intercityRoadCorridors } from "../src/shared/intercity-roads";

describe("release regeneration with roads and permanent task history", { timeout: 60_000 }, () => {
  let db: Db, service: AppService, countryId: string, userId: string;
  let cityIds: string[];

  beforeEach(async () => {
    db = await createTestDb();
    service = new AppService(db);
    const user = (await registerUser(db, {
      email: "release-history@example.test", name: "Release history", password: "password123",
    })).user;
    countryId = user.countryId; userId = user.id;
    await db.prepare("UPDATE countries SET seed=1 WHERE id=?").run(countryId);
    const a = await service.createCity(countryId, { name: "History Alpha", idempotencyKey: "city-a" });
    const b = await service.createCity(countryId, { name: "History Beta", idempotencyKey: "city-b" });
    cityIds = [a.id, b.id];
    const first = await service.createDistrict(countryId, {
      cityId: a.id, name: "Original sprint", activate: true, idempotencyKey: "sprint-a",
    });
    const next = await service.createDistrict(countryId, {
      cityId: a.id, name: "Next sprint", idempotencyKey: "sprint-next",
    });
    const other = await service.createDistrict(countryId, {
      cityId: b.id, name: "Other city sprint", activate: true, idempotencyKey: "sprint-b",
    });
    const moved = await service.createTask(countryId, {
      cityId: a.id, districtId: first.id, title: "Moved work with history", estimate: 1,
      visualKind: "BUILDING", idempotencyKey: "moved-task",
    });
    await service.addTaskComment(countryId, {
      taskId: moved.id, body: "This belongs to the durable task, not the old building.", idempotencyKey: "comment",
    });
    const deleted = await service.createTask(countryId, {
      cityId: a.id, districtId: first.id, title: "Deleted work", estimate: 1,
      visualKind: "BUILDING", idempotencyKey: "deleted-task",
    });
    await service.createTask(countryId, {
      cityId: b.id, districtId: other.id, title: "Connected city work", estimate: 1,
      visualKind: "BUILDING", idempotencyKey: "other-task",
    });
    await service.transferTask(countryId, {
      taskId: moved.id, targetDistrictId: next.id, idempotencyKey: "transfer",
    });
    await service.deleteTask(countryId, {
      taskId: deleted.id, confirmTitle: deleted.title, idempotencyKey: "demolish",
    });
    expect((await readCountryRoads(db, countryId))!.plan.routes).toHaveLength(1);
  });
  afterEach(async () => { await db?.close(); });

  async function durableTasks() {
    const tasks = await service.listTasks(countryId);
    return Promise.all(tasks.map(async task => {
      const full = await service.getTask(countryId, task.id);
      return {
        id: full.id, taskNumber: full.taskNumber, title: full.title,
        description: full.description, cityId: full.cityId, districtId: full.districtId,
        estimate: full.estimate, status: full.status, progress: full.progress,
        comments: full.comments, events: full.events, documents: full.documents,
        checklist: full.checklist, defects: full.defects,
      };
    }));
  }

  it("creates ordinary, backlog and park tasks beside a retained station approach", async () => {
    const roads=(await readCountryRoads(db,countryId))!.plan.routes;
    const layout=(await readActiveBlockLayout(db,cityIds[0]!))!;
    const point=decodeOrthogonalRoadRuns(roads[0]!.geometry)[0]!;
    await db.prepare("INSERT INTO city_railway_corridors_v1(layout_id,geometry_json) VALUES(?,?::jsonb)").run(layout.id,JSON.stringify({
      stationId:"historic-station",axis:"horizontal",from:{x:-1000,y:-1000},to:{x:1000,y:-1000},
      platform:{x:point.x,y:-1000},access:[{x:point.x,y:point.y+3}],stage:5,running:false,
    }));
    const district=await service.createDistrict(countryId,{cityId:cityIds[1]!,name:"New work",activate:false,idempotencyKey:"new-work"});
    for(const mode of ["ordinary","backlog","park"] as const){
      const task=await service.createTask(countryId,{cityId:cityIds[1]!,
        ...(mode==="backlog"?{}:{districtId:district.id}),title:mode,estimate:1,
        ...(mode==="park"?{visualKind:"PARK" as const,parkVariant:"urban-formal"}:{}),idempotencyKey:`approach-${mode}`});
      const saved=await service.getTask(countryId,task.id);
      expect(saved.title).toBe(mode);
      if(mode==="park")expect(saved.visualKind).toBe("PARK");
    }
    expect((await readCountryRoads(db,countryId))!.plan.routes).toEqual(expect.arrayContaining(roads));
    expect((await auditWorld(db,service,countryId)).violations.filter(v=>v.code==='COUNTRY_ROADS_INVALID')).toEqual([]);
    await db.prepare("UPDATE city_railway_corridors_v1 SET geometry_json=jsonb_set(jsonb_set(geometry_json,'{from,y}',?::jsonb),'{to,y}',?::jsonb) WHERE layout_id=?")
      .run(JSON.stringify(point.y),JSON.stringify(point.y),layout.id);
    expect((await auditWorld(db,service,countryId)).violations.some(v=>v.code==="COUNTRY_ROADS_INVALID")).toBe(true);
  });

  it("keeps MOVE/RUIN geometry and task content through replay and serves one new canonical road model", async () => {
    const before = await durableTasks();
    const markers = await service.listWorldFeatures(countryId);
    expect(markers.map(marker => marker.siteMarker?.kind).sort()).toEqual(["RELOCATED", "RUINED"]);
    const country = await service.getCountry(countryId);
    const command = { confirmName: country.name, idempotencyKey: "release-rebuild" };
    const result = await service.regenerateCountry(countryId, command);
    const snapshot = await readCountryRoads(db, countryId);
    expect(snapshot).toBeDefined();
    const fresh = new AppService(db);
    expect(await fresh.listWorldFeatures(countryId)).toEqual(markers);
    expect(await durableTasks()).toEqual(before);
    expect((await auditWorld(db, fresh, countryId)).violations).toEqual([]);
    const overview = await fresh.getCountryOverview(userId, countryId);
    const projected = new Set(overview.groundRoads.routes.map(route => route.id));
    const unavailable = new Set(overview.groundRoads.unavailable.map(route => route.routeId));
    for (const route of snapshot!.plan.routes) expect(projected.has(route.id) || unavailable.has(route.id)).toBe(true);
    for (const cityId of cityIds) {
      const scene = await fresh.getCityScene(countryId, cityId);
      const resident = {
        minX: Math.min(...scene.chunks.map(chunk => chunk.chunkX)) * scene.chunkSize,
        minY: Math.min(...scene.chunks.map(chunk => chunk.chunkY)) * scene.chunkSize,
        maxX: (Math.max(...scene.chunks.map(chunk => chunk.chunkX)) + 1) * scene.chunkSize - 1,
        maxY: (Math.max(...scene.chunks.map(chunk => chunk.chunkY)) + 1) * scene.chunkSize - 1,
      };
      expect(scene.intercityRoads).toEqual(snapshot!.plan.routes.filter(route => route.fromCityId === cityId || route.toCityId === cityId
        || intercityRoadCorridors([route], 0).some(road => road.minX <= resident.maxX && road.maxX >= resident.minX
          && road.minY <= resident.maxY && road.maxY >= resident.minY)));
    }
    const layouts = await Promise.all(cityIds.map(cityId => readActiveBlockLayout(db, cityId)));
    expect(await service.regenerateCountry(countryId, command)).toEqual(result);
    expect(await readCountryRoads(db, countryId)).toEqual(snapshot);
    expect(await Promise.all(cityIds.map(cityId => readActiveBlockLayout(db, cityId)))).toEqual(layouts);
    expect(await fresh.listWorldFeatures(countryId)).toEqual(markers);
  });

  it("rolls back every rebuilt city and the removed road snapshot if final network publication fails", async () => {
    const before = await durableTasks();
    const markers = await service.listWorldFeatures(countryId);
    const roads = await readCountryRoads(db, countryId);
    const layouts = await Promise.all(cityIds.map(cityId => readActiveBlockLayout(db, cityId)));
    const events = await service.listEvents(countryId);
    const faultDb: Db = {
      ...db, close: () => db.close(), exec: query => db.exec(query), transaction: callback => db.transaction(callback),
      prepare: query => {
        const statement = db.prepare(query);
        return /INSERT INTO country_road_snapshots_v1/.test(query)
          ? { ...statement, run: async () => { throw new Error("release network publication fault"); } }
          : statement;
      },
    };
    await expect(new AppService(faultDb).regenerateCountry(countryId, {
      confirmName: (await service.getCountry(countryId)).name, idempotencyKey: "failed-rebuild",
    })).rejects.toThrow("release network publication fault");
    expect(await readCountryRoads(db, countryId)).toEqual(roads);
    expect(await Promise.all(cityIds.map(cityId => readActiveBlockLayout(db, cityId)))).toEqual(layouts);
    expect(await new AppService(db).listWorldFeatures(countryId)).toEqual(markers);
    expect(await durableTasks()).toEqual(before);
    expect(await service.listEvents(countryId)).toEqual(events);
    expect((await auditWorld(db, new AppService(db), countryId)).violations).toEqual([]);
  });
});
