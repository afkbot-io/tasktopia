import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppService } from "../src/server/app-service";
import { registerUser } from "../src/server/auth";
import { createTestDb, type Db } from "../src/server/db";
import { readActiveBlockLayout, synchronizeCityBlocks } from "../src/server/world/active-block-layout";
import type { TaskDto } from "../src/shared/contracts";

describe("permanent task sites and atomic sprint transfer", { timeout: 30_000 }, () => {
  let db: Db; let service: AppService; let countryId: string; let cityId: string; let districts: string[];
  beforeEach(async () => {
    db = await createTestDb(); service = new AppService(db);
    countryId = (await registerUser(db, { email: "permanent-sites@example.test", name: "Permanent sites", password: "password123" })).user.countryId;
    await db.prepare("UPDATE countries SET seed=? WHERE id=?").run(424242, countryId);
    cityId = (await service.createCity(countryId, { name: "Sprint project", idempotencyKey: "city" })).id;
    districts = [];
    for (let index = 0; index < 3; index++) districts.push((await service.createDistrict(countryId, {
      cityId, name: `Sprint ${index}`, activate: index === 0, idempotencyKey: `sprint-${index}`,
    })).id);
  });
  afterEach(async () => { await db?.close(); });
  const create = (district = districts[0]!, key = "first") => service.createTask(countryId, {
    cityId, districtId: district, title: `Work ${key}`, estimate: 1, visualKind: "BUILDING", idempotencyKey: `task-${key}`,
  });

  it("keeps a deleted site occupied through geometry rebuild, city deletion and later construction", async () => {
    const task = await create();
    await service.deleteTask(countryId, { taskId: task.id, confirmTitle: task.title, idempotencyKey: "demolish" });
    const first = (await service.listWorldFeatures(countryId)).find(feature => feature.kind === "RUIN")!;
    expect(first.siteMarker).toMatchObject({ kind: "RUINED", permanent: true, targetTaskId: null,
      snapshot: { taskNumber: task.taskNumber, title: task.title, buildingFamily: task.buildingType, lastStage: 1 } });
    expect(first.footprint).toEqual(task.footprint);
    await synchronizeCityBlocks(db, countryId, cityId, true);
    expect((await new AppService(db).listWorldFeatures(countryId)).find(feature => feature.id === first.id)).toEqual(first);
    const another = await new AppService(db).createTask(countryId, {
      cityId, districtId: districts[0]!, title: "New work", estimate: 1, visualKind: "BUILDING", idempotencyKey: "new-after-ruin",
    });
    const historicalCells = new Set(first.footprint.map(cell => `${cell.x}:${cell.y}`));
    expect(another.footprint.some(cell => historicalCells.has(`${cell.x}:${cell.y}`))).toBe(false);
    await service.deleteCity(countryId, { cityId, confirmName: "Sprint project", idempotencyKey: "remove-city" });
    expect(await service.listCities(countryId)).toEqual([]);
    expect((await new AppService(db).listWorldFeatures(countryId)).find(feature => feature.id === first.id)).toEqual(first);
    await expect(db.prepare("DELETE FROM site_markers_v1 WHERE id=?").run(first.id)).rejects.toThrow(/permanent/i);
    await expect(db.prepare("UPDATE site_markers_v1 SET snapshot_json='{}'::jsonb WHERE id=?").run(first.id)).rejects.toThrow(/immutable/i);
    await expect(db.prepare("UPDATE site_markers_v1 SET geometry_json='{}'::jsonb WHERE id=?").run(first.id)).rejects.toThrow(/immutable/i);
    await expect(db.prepare("UPDATE site_markers_v1 SET id=? WHERE id=?").run(crypto.randomUUID(),first.id)).rejects.toThrow(/immutable/i);
    const replacement = await new AppService(db).createCity(countryId,{name:"Later project",idempotencyKey:"later-project"});
    expect(first.footprint.some(c=>c.x>=replacement.bounds.minX&&c.x<=replacement.bounds.maxX&&c.y>=replacement.bounds.minY&&c.y<=replacement.bounds.maxY)).toBe(false);
    await db.prepare("DELETE FROM countries WHERE id=?").run(countryId);
    expect(await db.prepare("SELECT id FROM site_markers_v1 WHERE id=?").get(first.id)).toBeUndefined();
  });

  it("moves the same task twice while every former site points directly to the current task and never becomes vacant", async () => {
    let task = await create();
    task = await service.addTaskComment(countryId, { taskId: task.id, body: "History stays on the same task", idempotencyKey: "comment" });
    const original = structuredClone(task);
    const moved = await service.transferTask(countryId, { taskId: task.id, targetDistrictId: districts[1]!, idempotencyKey: "move-once" });
    expect(moved).toMatchObject({ id: task.id, taskNumber: task.taskNumber, cityId, districtId: districts[1],
      status: task.status, progress: task.progress, stage: task.stage, buildingType: task.buildingType, visualKind: task.visualKind });
    expect(moved.origin).not.toEqual(task.origin);
    expect(moved.comments).toEqual(task.comments);
    expect(await service.transferTask(countryId, { taskId: task.id, targetDistrictId: districts[1]!, idempotencyKey: "move-once" })).toEqual(moved);
    const twice = await service.transferTask(countryId, { taskId: task.id, targetDistrictId: districts[2]!, idempotencyKey: "move-twice" });
    expect(await service.transferTask(countryId, { taskId: task.id, targetDistrictId: districts[1]!, idempotencyKey: "move-once" })).toEqual(twice);
    const markers = await service.listWorldFeatures(countryId);
    expect(markers).toHaveLength(2);
    expect(markers.map(marker => marker.siteMarker?.targetTaskId)).toEqual([task.id, task.id]);
    for (const marker of markers) expect(marker.siteMarker).toMatchObject({ kind: "RELOCATED", permanent: true,
      snapshot: { title: task.title, taskNumber: task.taskNumber } });
    expect(markers.map(marker => marker.origin)).toEqual(expect.arrayContaining([original.origin, moved.origin]));
    expect((await service.listTasks(countryId)).map(task => task.id)).toEqual([task.id]);
    const layout = (await readActiveBlockLayout(db, cityId))!;
    expect(layout.placements).toHaveLength(1); expect(layout.siteMarkers).toHaveLength(2);
    await service.deleteTask(countryId, { taskId: twice.id, confirmTitle: twice.title, idempotencyKey: "delete-moved" });
    const historical = await new AppService(db).listWorldFeatures(countryId);
    await expect(service.transferTask(countryId, { taskId: task.id, targetDistrictId: districts[1]!, idempotencyKey: "move-once" }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await service.listWorldFeatures(countryId)).toEqual(historical);
    expect(historical).toHaveLength(3);
    expect(historical.every(marker => marker.siteMarker?.targetTaskId === null)).toBe(true);
    expect(historical.filter(marker => marker.siteMarker?.kind === "RELOCATED")).toHaveLength(2);
    expect(historical.filter(marker => marker.siteMarker?.kind === "RUINED")).toHaveLength(1);
    const unknown = historical[0]!.siteMarker!.snapshot;
    expect(Object.keys(unknown).sort()).toEqual(["buildingFamily", "lastStage", "recordedAt", "taskNumber", "title"]);
  });

  it("rolls back task ownership, history and the old-site marker if destination placement cannot commit", async () => {
    const task = await create();
    const before = await readActiveBlockLayout(db, cityId);
    const events = await service.listEvents(countryId);
    const faultDb: Db = { ...db, close: () => db.close(), exec: query => db.exec(query), transaction: callback => db.transaction(callback),
      prepare: query => {
        const statement = db.prepare(query);
        return /INSERT INTO task_placements_v1/.test(query)
          ? { ...statement, run: async () => { throw new Error("destination allocation rejected"); } }
          : statement;
      },
    };
    await expect(new AppService(faultDb).transferTask(countryId, {
      taskId: task.id, targetDistrictId: districts[1]!, idempotencyKey: "failed-transfer",
    })).rejects.toThrow("destination allocation rejected");
    expect(await service.getTask(countryId, task.id)).toEqual(task);
    expect(await readActiveBlockLayout(db, cityId)).toEqual(before);
    expect(await service.listWorldFeatures(countryId)).toEqual([]);
    expect(await service.listEvents(countryId)).toEqual(events);
  });

  it("preserves the airport role on the same task without activating its permanent former site", async () => {
    await create(districts[0], "a"); await create(districts[1], "b"); await create(districts[2], "c");
    const airport = await create(districts[2], "airport");
    expect(airport.serviceRole).toBe("AIRPORT");
    const moved: TaskDto = await service.transferTask(countryId, {
      taskId: airport.id, targetDistrictId: districts[0]!, idempotencyKey: "airport-move",
    });
    expect(moved.serviceRole).toBe("AIRPORT");
    const layout = (await readActiveBlockLayout(db, cityId))!;
    expect(layout.placements.filter(placement => placement.serviceRole === "AIRPORT")).toHaveLength(1);
    expect(layout.siteMarkers).toHaveLength(1);
    expect(layout.siteMarkers[0]).toMatchObject({ kind: "RELOCATED", targetTaskId: airport.id });
    const rebuilt = await synchronizeCityBlocks(db, countryId, cityId, true);
    expect(rebuilt.placements.filter(placement => placement.serviceRole === "AIRPORT").map(placement => placement.taskId)).toEqual([airport.id]);
  });

  it("does not consume the next-task infrastructure reservation when moving an ordinary existing task", async () => {
    const ordinary = await create(districts[0], "ordinary");
    await create(districts[1], "second");
    await create(districts[2], "third");
    expect(ordinary.serviceRole).toBeUndefined();
    const moved = await service.transferTask(countryId, { taskId: ordinary.id, targetDistrictId: districts[2]!, idempotencyKey: "move-ordinary" });
    expect(moved.serviceRole).toBeUndefined();
    expect((await create(districts[2], "real-next-task")).serviceRole).toBe("AIRPORT");
  });
});
