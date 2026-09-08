import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppService } from "../src/server/app-service";
import { createTestDb, type Db } from "../src/server/db";
import { registerUser } from "../src/server/auth";
import { readActiveBlockLayout } from "../src/server/world/active-block-layout";
import { auditWorld } from "../src/server/world/world-audit";
import { compactBuildingShapeFamily, COMPACT_BUILDING_SHAPES } from "../src/shared/compact-building-families";

describe("compact block runtime cutover", { timeout: 60_000 }, () => {
  let db: Db; let service: AppService; let countryId: string;
  beforeEach(async () => {
    db = await createTestDb(); service = new AppService(db);
    countryId = (await registerUser(db, { email: "compact@example.com", name: "Builder", password: "password123" })).user.countryId;
    await db.prepare("UPDATE countries SET seed=424242 WHERE id=?").run(countryId);
  });
  afterEach(async () => { await db?.close(); });
  it("places tasks in semantic blocks and serves their real geometry without legacy spatial tables", async () => {
    const city = await service.createCity(countryId, { name: "Compact City", idempotencyKey: "city" });
    const district = await service.createDistrict(countryId, { cityId: city.id, name: "First District", activate: true, idempotencyKey: "district" });
    const task = await service.createTask(countryId, { cityId: city.id, districtId: district.id, title: "First building", estimate: 1, idempotencyKey: "task" });
    const shape = COMPACT_BUILDING_SHAPES[compactBuildingShapeFamily(task.buildingType)!];
    expect(shape).toBeDefined();
    expect(task.footprint).toHaveLength(shape.width * shape.height);
    expect(new Set(task.footprint.map(cell => cell.x)).size).toBe(shape.width);
    const layout = (await readActiveBlockLayout(db, city.id))!;
    expect(layout.placements).toHaveLength(1);
    expect(layout.blocks).toHaveLength(1);
    const chunk = await service.getChunk(countryId, Math.floor(task.origin.x/64), Math.floor(task.origin.y/64));
    expect(chunk.tasks.find(t => t.id === task.id)?.origin).toEqual(task.origin);
    expect(chunk.roads.length).toBeGreaterThan(0);
    expect(await db.prepare("SELECT to_regclass('roads_v3') AS old").get()).toEqual({ old: null });
    expect(await db.prepare("SELECT to_regclass('world_features_v6') AS old").get()).toEqual({ old: null });
    const next = await service.updateTaskStatus(countryId, { taskId: task.id, status: "STARTED", idempotencyKey: "start" });
    expect(next.origin).toEqual(task.origin);
    expect((await readActiveBlockLayout(db, city.id))!.placements[0]!.constructionStage).toBe(2);
  });
  it("grows adjacent blocks without moving tasks, reserves parks, and safely regenerates task geometry", async () => {
    const city=await service.createCity(countryId,{name:"Growing city",idempotencyKey:"growth-city"});
    const district=await service.createDistrict(countryId,{cityId:city.id,name:"First district",activate:true,idempotencyKey:"growth-district"});
    const first=await service.createTask(countryId,{cityId:city.id,districtId:district.id,title:"First house",estimate:2,idempotencyKey:"house0"});
    for(let i=1;i<30;i++) await service.createTask(countryId,{cityId:city.id,districtId:district.id,title:`Building ${i}`,estimate:2,idempotencyKey:`house${i}`});
    const park=await service.createTask(countryId,{cityId:city.id,districtId:district.id,title:"Public park",visualKind:"PARK",estimate:1,idempotencyKey:"park"});
    expect((await service.getTask(countryId,first.id)).origin).toEqual(first.origin);
    expect(park.visualKind).toBe("PARK");
    const layout=(await readActiveBlockLayout(db,city.id))!;
    expect(layout.blocks.length).toBeGreaterThan(1);
    expect(layout.placements).toHaveLength(31);
    expect((await auditWorld(db,service,countryId)).violations).toEqual([]);
    expect((await service.searchTasks(countryId,String(first.taskNumber)))[0]!.origin).toEqual(first.origin);
    const before=(await service.listTasks(countryId)).map(t=>[t.id,t.taskNumber,t.status]);
    const country=await db.prepare("SELECT name FROM countries WHERE id=?").get<{name:string}>(countryId);
    await service.regenerateCountry(countryId,{confirmName:country!.name,idempotencyKey:"regen"});
    expect((await service.listTasks(countryId)).map(t=>[t.id,t.taskNumber,t.status])).toEqual(before);
    expect((await auditWorld(db,service,countryId)).violations).toEqual([]);
  });

  it("persists separated sprint streets across reload, stage updates and abandoned district history", async () => {
    const city = await service.createCity(countryId, { name: "Separate sprint streets", idempotencyKey: "street-city" });
    const firstDistrict = await service.createDistrict(countryId, { cityId: city.id, name: "First street district", activate: true, idempotencyKey: "street-d1" });
    const first = await service.createTask(countryId, { cityId: city.id, districtId: firstDistrict.id, title: "Permanent street address", estimate: 1, idempotencyKey: "street-t1" });
    const secondDistrict = await service.createDistrict(countryId, { cityId: city.id, name: "Second street district", activate: false, idempotencyKey: "street-d2" });
    await service.activateDistrict(countryId, secondDistrict.id, "street-activate-d2");
    const second = await service.createTask(countryId, { cityId: city.id, districtId: secondDistrict.id, title: "Across the median", estimate: 1, idempotencyKey: "street-t2" });
    const before = (await readActiveBlockLayout(db, city.id))!;
    expect(before.blocks.some(block => block.parameters.districtSeparator)).toBe(true);
    const separators = before.blocks.map(block => [block.id, block.parameters.districtSeparator]);
    const fresh = new AppService(db);
    expect((await fresh.getTask(countryId, first.id)).origin).toEqual(first.origin);
    await fresh.updateTaskStatus(countryId, { taskId: second.id, status: "STARTED", idempotencyKey: "street-start" });
    expect((await readActiveBlockLayout(db, city.id))!.blocks.map(block => [block.id, block.parameters.districtSeparator])).toEqual(separators);
    await fresh.deleteDistrict(countryId, { districtId: firstDistrict.id, confirmName: firstDistrict.name, idempotencyKey: "street-abandon" });
    const after = (await readActiveBlockLayout(db, city.id))!;
    expect(after.blocks.map(block => [block.id, block.parameters.districtSeparator])).toEqual(separators);
    expect(after.siteMarkers).toContainEqual(expect.objectContaining({ kind: "RUINED" }));
    expect(after.roadNetwork).toEqual(before.roadNetwork);
    expect((await auditWorld(db, fresh, countryId)).violations).toEqual([]);
  });
});
