import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppService } from "../src/server/app-service";
import { registerUser } from "../src/server/auth";
import { createTestDb, type Db } from "../src/server/db";
import { auditWorld } from "../src/server/world/world-audit";
import { readCityReport } from '../src/server/city-report-read';
import { districtDevelopmentSummary } from '../src/client/district-development';

describe("one task across sequential sprints", { timeout: 60_000 }, () => {
  let db: Db, service: AppService, countryId: string, cityId: string, first: string, second: string, third: string;
  beforeEach(async () => {
    db = await createTestDb(); service = new AppService(db);
    countryId = (await registerUser(db, { email: "sprint-chain@example.test", name: "Owner", password: "password123" })).user.countryId;
    await db.prepare("UPDATE countries SET seed=424242 WHERE id=?").run(countryId);
    cityId = (await service.createCity(countryId, { name: "One project", idempotencyKey: "city" })).id;
    first = (await service.createDistrict(countryId, { cityId, name: "First", activate: true, idempotencyKey: "first" })).id;
    second = (await service.createDistrict(countryId, { cityId, name: "Second", idempotencyKey: "second" })).id;
    third = (await service.createDistrict(countryId, { cityId, name: "Third", idempotencyKey: "third" })).id;
  });
  afterEach(async () => { await db?.close(); });

  it("preserves one identity and home parcel while closing carried-out sprint work", async () => {
    const task = await service.createTask(countryId, { cityId, districtId: first, title: "A long project", estimate: 3, idempotencyKey: "task" });
    await service.updateTaskStatus(countryId, { taskId: task.id, status: "STARTED", idempotencyKey: "start" });
    await service.updateTaskStatus(countryId, { taskId: task.id, status: "IN_PROGRESS", progress: 40, idempotencyKey: "work" });
    const command = { taskId: task.id, fromDistrictId: first, targetDistrictId: second, comment: "Continue remaining work", idempotencyKey: "continue-once" };
    const carried = await service.continueTask(countryId, command);
    expect(carried).toMatchObject({ id: task.id, taskNumber: task.taskNumber, districtId: first, currentDistrictId: second,
      origin: task.origin, footprint: task.footprint, accessPath: task.accessPath, status: "IN_PROGRESS", progress: 40 });
    expect((await service.listTasks(countryId)).map(t => t.id)).toEqual([task.id]);
    expect(await service.continueTask(countryId, command)).toEqual(carried);
    await service.completeDistrict(countryId, first, "close-first");
    await service.activateDistrict(countryId, second, "activate-second");
    await service.updateTaskStatus(countryId, { taskId: task.id, status: "TESTING", progress: 90, idempotencyKey: "test" });
    await service.updateTaskStatus(countryId, { taskId: task.id, status: "COMPLETED", idempotencyKey: "done" });
    const history = await service.listTaskSprints(countryId, task.id);
    expect(history.items.map(p => ({ districtId: p.districtId, outcome: p.outcome, exitProgress: p.exitProgress }))).toEqual([
      { districtId: first, outcome: "CARRIED", exitProgress: 40 }, { districtId: second, outcome: "COMPLETED", exitProgress: 100 },
    ]);
    expect((await service.getDistrictWorkload(countryId, first))).toMatchObject({ openSp: 0, completedSp: 0, carriedOutCount: 1 });
    expect((await service.getDistrictWorkload(countryId, second))).toMatchObject({ openSp: 0, completedSp: 3, carriedOutCount: 0 });
    const member=await db.prepare('SELECT user_id FROM country_members WHERE country_id=?').get<{user_id:string}>(countryId);
    const report=await readCityReport(db,member!.user_id,countryId,cityId,first,false,0,7);
    expect(report?.counts).toMatchObject({working:0,completed:0,carried:1});
    expect(report?.items[0]).toMatchObject({id:task.id,status:'IN_PROGRESS',progress:40,sprintOutcome:'CARRIED'});
    const firstPage=await service.listTaskPage(countryId,{districtId:first});
    expect(firstPage.items[0]).toMatchObject({id:task.id,status:'COMPLETED',sprintOutcome:'CARRIED',sprintProgress:40});
    expect(districtDevelopmentSummary('First',firstPage.items).line).toBe('0 / 1 готово · 0 в работе');
    const sites = (await service.listWorldFeatures(countryId)).filter(f => f.continuation);
    expect(sites).toHaveLength(1);
    expect(sites[0]).toMatchObject({ districtId: second, continuation: { taskId: task.id, taskNumber: task.taskNumber, outcome: "COMPLETED" } });
    expect(sites[0]!.accessPath.length).toBeGreaterThan(0);
    const main = new Set(task.footprint.map(p => `${p.x},${p.y}`));
    expect(sites[0]!.footprint.some(p => main.has(`${p.x},${p.y}`))).toBe(false);
    expect((await auditWorld(db, service, countryId)).violations).toEqual([]);
    await db.prepare('DELETE FROM countries WHERE id=?').run(countryId);
    expect(await service.listWorldFeatures(countryId)).toEqual([]);
    expect(await db.prepare('SELECT id FROM task_sprint_phases_v1').all()).toEqual([]);
  });

  it("keeps three sprint results stable across keyset pages and reconnects", async () => {
    let task=await service.createTask(countryId,{cityId,districtId:first,title:"Three sprints",estimate:6,idempotencyKey:"chain"});
    await service.updateTaskStatus(countryId,{taskId:task.id,status:"STARTED",idempotencyKey:"chain-start"});
    await service.updateTaskStatus(countryId,{taskId:task.id,status:"IN_PROGRESS",progress:40,idempotencyKey:"chain-work"});
    const original=structuredClone(task);
    const firstCommand={taskId:task.id,fromDistrictId:first,targetDistrictId:second,idempotencyKey:"chain-first"};
    await service.continueTask(countryId,firstCommand);
    await service.completeDistrict(countryId,first,"chain-close-first");
    await service.activateDistrict(countryId,second,"chain-activate-second");
    await service.updateTaskStatus(countryId,{taskId:task.id,status:"IN_PROGRESS",progress:70,idempotencyKey:"chain-more-work"});
    await service.continueTask(countryId,{taskId:task.id,fromDistrictId:second,targetDistrictId:third,idempotencyKey:"chain-second"});
    await service.completeDistrict(countryId,second,"chain-close-second");
    service=new AppService(db);
    task=await service.continueTask(countryId,firstCommand);
    expect(task).toMatchObject({id:original.id,taskNumber:original.taskNumber,currentDistrictId:third,origin:original.origin,accessPath:original.accessPath});
    const a=await service.listTaskSprints(countryId,task.id,{limit:1});
    const b=await service.listTaskSprints(countryId,task.id,{limit:1,cursor:a.nextCursor!});
    const c=await service.listTaskSprints(countryId,task.id,{limit:1,cursor:b.nextCursor!});
    expect([a,b,c].flatMap(page=>page.items.map(p=>[p.districtId,p.outcome,p.exitProgress]))).toEqual([
      [first,"CARRIED",40],[second,"CARRIED",70],[third,"OPEN",null],
    ]);
    expect(c.nextCursor).toBeNull();
    await expect(service.listTaskSprints(countryId,task.id,{cursor:"broken"})).rejects.toMatchObject({code:"INVALID_INPUT"});
    expect((await service.listTaskPage(countryId,{districtId:third})).items.map(t=>t.id)).toEqual([task.id]);
    expect((await service.listTaskPage(countryId,{cityId})).items.map(t=>t.id)).toEqual([task.id]);
    const sites=(await service.listWorldFeatures(countryId)).filter(f=>f.continuation);
    expect(sites.map(s=>s.continuation?.taskId)).toEqual([task.id,task.id]);
    expect(sites.map(s=>s.districtId).sort()).toEqual([second,third].sort());
    expect((await auditWorld(db,service,countryId)).violations).toEqual([]);
    await service.activateDistrict(countryId,third,'chain-activate-third');
    await expect(service.continueTask(countryId,{taskId:task.id,fromDistrictId:third,targetDistrictId:first,idempotencyKey:'chain-revisit'}))
      .rejects.toMatchObject({code:'DISTRICT_SEALED'});
    const siteGeometry=sites.map(site=>({id:site.id,origin:site.origin,footprint:site.footprint,accessPath:site.accessPath}));
    const country=await db.prepare('SELECT name FROM countries WHERE id=?').get<{name:string}>(countryId);
    await service.regenerateCountry(countryId,{confirmName:country!.name,idempotencyKey:'chain-rebuild'});
    expect((await service.listWorldFeatures(countryId)).filter(f=>f.continuation).map(site=>({id:site.id,origin:site.origin,footprint:site.footprint,accessPath:site.accessPath})))
      .toEqual(siteGeometry);
    const nextTask=await service.createTask(countryId,{cityId,districtId:third,title:'Next number',estimate:1,idempotencyKey:'chain-next-task'});
    expect(nextTask.taskNumber).toBe(original.taskNumber+1);
    await service.deleteTask(countryId,{taskId:task.id,confirmTitle:task.title,idempotencyKey:'chain-delete'});
    expect((await service.listWorldFeatures(countryId)).filter(f=>f.continuation).map(f=>f.continuation))
      .toEqual(expect.arrayContaining([expect.objectContaining({taskId:null,outcome:'REMOVED',taskNumber:original.taskNumber})]));
    expect((await auditWorld(db,service,countryId)).violations).toEqual([]);
  });

  it("rejects unsafe states and serializes concurrent handoffs without partial history", async () => {
    const task=await service.createTask(countryId,{cityId,districtId:first,title:"Concurrent work",estimate:1,idempotencyKey:"race"});
    const input={taskId:task.id,fromDistrictId:first,targetDistrictId:second,idempotencyKey:"race-planned"};
    await expect(service.continueTask(countryId,input)).rejects.toMatchObject({code:"INVALID_TRANSITION"});
    await service.updateTaskStatus(countryId,{taskId:task.id,status:"STARTED",idempotencyKey:"race-start"});
    await expect(service.continueTask(countryId,{...input,fromDistrictId:third,idempotencyKey:"race-stale"})).rejects.toMatchObject({code:"SPRINT_CONFLICT"});
    await expect(service.continueTask(countryId,{...input,targetDistrictId:first,idempotencyKey:"race-same"})).rejects.toMatchObject({code:"INVALID_INPUT"});
    const faultDb:Db={...db,close:()=>db.close(),exec:q=>db.exec(q),transaction:cb=>db.transaction(cb),prepare:q=>{
      const statement=db.prepare(q);return /INSERT INTO site_markers_v1/.test(q)?{...statement,run:async()=>{throw Error("site commit rejected");}}:statement;
    }};
    await expect(new AppService(faultDb).continueTask(countryId,{...input,idempotencyKey:"race-rollback"})).rejects.toThrow("site commit rejected");
    expect((await service.listTaskSprints(countryId,task.id)).items).toEqual([]);
    expect((await service.getTask(countryId,task.id)).currentDistrictId).toBeUndefined();
    const outcomes=await Promise.allSettled([
      service.continueTask(countryId,{...input,idempotencyKey:"race-second"}),
      new AppService(db).continueTask(countryId,{...input,targetDistrictId:third,idempotencyKey:"race-third"}),
    ]);
    expect(outcomes.filter(x=>x.status==='fulfilled')).toHaveLength(1);
    expect(outcomes.filter(x=>x.status==='rejected').map(x=>(x as PromiseRejectedResult).reason.code)).toEqual(["SPRINT_CONFLICT"]);
    expect((await service.listTaskSprints(countryId,task.id)).items).toHaveLength(2);
    expect((await service.listWorldFeatures(countryId)).filter(f=>f.continuation)).toHaveLength(1);
    await expect(service.transferTask(countryId,{taskId:task.id,targetDistrictId:third,idempotencyKey:"race-physical-move"})).rejects.toMatchObject({code:"TASK_HAS_CONTINUATIONS"});
    await expect(service.deleteDistrict(countryId,{districtId:first,confirmName:"First",idempotencyKey:"race-delete-home"})).rejects.toMatchObject({code:"DISTRICT_HAS_CONTINUATIONS"});
    // A rolling upgrade can briefly leave a pre-continuation writer alive.
    // Persistence must protect ownership even if that writer lacks new checks.
    await expect(db.prepare('UPDATE tasks_v3 SET district_id=? WHERE id=?').run(third,task.id))
      .rejects.toThrow('Continuation home district is immutable');
    await expect(db.prepare('DELETE FROM districts_v3 WHERE id=?').run(first))
      .rejects.toThrow('District participates in a task continuation');
    const current=(await service.getTask(countryId,task.id)).currentDistrictId!;
    await expect(db.prepare('DELETE FROM tasks_v3 WHERE district_id=?').run(first))
      .rejects.toThrow('Continuation deletion requires an explicit current task or city command');
    await expect(db.prepare('DELETE FROM districts_v3 WHERE id=?').run(current))
      .rejects.toThrow('District participates in a task continuation');
    const beforeOldWriter=await service.getTask(countryId,task.id);
    const districtBefore=await db.prepare('SELECT status FROM districts_v3 WHERE id=?').get(current);
    const placementsBefore=await db.prepare('SELECT * FROM task_placements_v1 WHERE task_id=?').all(task.id);
    await expect(db.transaction(async()=>{
      await db.exec("SET LOCAL tasktopia.sprint_continuations = '0'");
      await db.prepare("UPDATE tasks_v3 SET status='COMPLETED',progress=100 WHERE id=?").run(task.id);
      await db.prepare("UPDATE districts_v3 SET status='COMPLETED' WHERE id=?").run(current);
      await db.prepare('UPDATE task_placements_v1 SET construction_stage=5 WHERE task_id=?').run(task.id);
      await db.prepare('UPDATE countries SET world_version=world_version+1 WHERE id=?').run(countryId);
    })).rejects.toThrow('Continuation country requires a compatible writer');
    expect(await service.getTask(countryId,task.id)).toEqual(beforeOldWriter);
    expect(await db.prepare('SELECT status FROM districts_v3 WHERE id=?').get(current)).toEqual(districtBefore);
    expect(await db.prepare('SELECT * FROM task_placements_v1 WHERE task_id=?').all(task.id)).toEqual(placementsBefore);
    await service.deleteCity(countryId,{cityId,confirmName:'One project',idempotencyKey:'race-delete-project'});
    expect(await service.listTasks(countryId)).toEqual([]);
    expect((await service.listWorldFeatures(countryId)).filter(feature=>feature.continuation)[0]?.continuation)
      .toMatchObject({taskId:null,outcome:'REMOVED'});
  });
});
