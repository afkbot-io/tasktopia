import { afterEach,expect,it } from "vitest";
import { createTestDb,type Db } from "../src/server/db";
import { blockSlots } from "../src/shared/block-templates";
import { registerUser } from "../src/server/auth";
import { AppService } from "../src/server/app-service";
import { readActiveBlockLayout,blockBoundsIntersect } from "../src/server/world/active-block-layout";
import { cityRailwayReservations, countryRailwayReservations } from "../src/server/world/city-railway-store";
let db:Db|undefined;
afterEach(async()=>{await db?.close();});
it("freezes the corridor before city growth and only changes train readiness with the station stage",async()=>{
  db=await createTestDb();
  const service=new AppService(db);
  const {user}=await registerUser(db,{email:"rail-store@example.test",name:"Rail",password:"password123"});
  const country=user.countryId;
  await db.prepare("UPDATE countries SET seed=? WHERE id=?").run(424242,country);
  const city=await service.createCity(country,{name:"Rail city",idempotencyKey:"rail-city"});
  let station:Awaited<ReturnType<typeof service.createTask>>|undefined;
  let districtId="";
  for(let i=0;i<12&&!station;i++){
    const district=await service.createDistrict(country,{cityId:city.id,name:`District ${i}`,activate:false,idempotencyKey:`district-${i}`});
    districtId=district.id;
    const task=await service.createTask(country,{cityId:city.id,districtId,title:`Building ${i}`,estimate:1,idempotencyKey:`building-${i}`});
    if(task.serviceRole==="RAILWAY")station=task;
  }
  if(!station){
    const pending=(await readActiveBlockLayout(db,city.id))!;
    const block=pending.blocks.find(b=>Object.values(b.parameters.slotRoles??{}).includes("RAILWAY"))!;
    expect(block).toBeDefined();
    districtId=pending.districtLayouts.find(d=>d.id===block.districtLayoutId)!.districtId;
    station=await service.createTask(country,{cityId:city.id,districtId,title:"Rail station",estimate:1,idempotencyKey:"station"});
  }
  expect(station.serviceRole).toBe("RAILWAY");
  await service.activateDistrict(country,districtId,"activate-station-district");
  const before=await service.getCityScene(country,city.id);
  expect(before.railway).toBeTruthy();
  expect(before.railway!.running).toBe(false);
  const frozen=({stage: _stage,running:_running,...geometry}:NonNullable<typeof before.railway>)=>{void _stage;void _running;return geometry;};
  const layout=(await readActiveBlockLayout(db,city.id))!, oldBlocks=new Set(layout.blocks.map(b=>b.id));
  for(const status of ["STARTED","IN_PROGRESS","TESTING","COMPLETED"] as const){
    await service.updateTaskStatus(country,{taskId:station!.id,status,comment:"Station progress",idempotencyKey:`stage-${status}`});
    const scene=await service.getCityScene(country,city.id);
    expect(frozen(scene.railway!)).toEqual(frozen(before.railway!));
    expect(scene.railway!.running).toBe(status==="COMPLETED");
  }
  // Rehearse upgrade of a legacy city: no corridor row existed before this version.
  await db.prepare("DELETE FROM city_railway_corridors_v1 WHERE layout_id=?").run(layout.id);
  const legacy=await new AppService(db).getCityScene(country,city.id);
  expect(frozen(legacy.railway!)).toEqual(frozen(before.railway!));
  const neighbour=await service.createCity(country,{name:"Neighbour",idempotencyKey:"neighbour"});
  const imported=await db.prepare("SELECT geometry_json FROM city_railway_corridors_v1 WHERE layout_id=?")
    .get<{geometry_json:NonNullable<typeof before.railway>}>(layout.id);
  expect(frozen(imported!.geometry_json)).toEqual(frozen(before.railway!));
  expect(cityRailwayReservations(before.railway!).some(rect=>blockBoundsIntersect(rect,neighbour.bounds))).toBe(false);
  for(let i=0;i<24;i++)await service.createTask(country,{cityId:city.id,districtId,title:`Growth ${i}`,estimate:3,idempotencyKey:`growth-${i}`});
  const after=(await readActiveBlockLayout(db,city.id))!;
  const added=after.blocks.filter(b=>!oldBlocks.has(b.id));expect(added.length).toBeGreaterThan(0);
  const reserved=cityRailwayReservations(before.railway!);
  expect(await countryRailwayReservations(db,country,after.id)).toEqual([]);
  expect(await countryRailwayReservations(db,country)).toEqual(reserved);
  for(const block of added)expect(reserved.some(rect=>blockBoundsIntersect(rect,{minX:block.origin.x,minY:block.origin.y,maxX:block.origin.x+block.width,maxY:block.origin.y+block.height}))).toBe(false);
  expect(frozen((await service.getCityScene(country,city.id)).railway!)).toEqual(frozen(before.railway!));
  const destination=await service.createDistrict(country,{cityId:city.id,name:"Moved station",activate:false,idempotencyKey:"move-district"});
  const moved=await service.transferTask(country,{taskId:station!.id,targetDistrictId:destination.id,idempotencyKey:"move-station"});
  expect(moved.serviceRole).toBe("RAILWAY");
  const transferred=await service.getCityScene(country,city.id);
  expect(transferred.railway!.from).toEqual(before.railway!.from);
  expect(transferred.railway!.to).toEqual(before.railway!.to);
  expect(transferred.railway!.platform).toEqual(before.railway!.platform);
  expect(moved.accessPath).toContainEqual(transferred.railway!.access[0]);
  expect(transferred.railway!.access).not.toEqual(before.railway!.access);
  const transferredLayout=(await readActiveBlockLayout(db,city.id))!;
  const occupied=transferredLayout.blocks.flatMap(block=>blockSlots(block).flatMap(slot=>slot.footprint));
  for(const point of transferred.railway!.access){
    expect(occupied.some(p=>p.x===point.x&&p.y===point.y)).toBe(false);
  }
  expect((await new AppService(db).getCityScene(country,city.id)).railway!.access).toEqual(transferred.railway!.access);
  await service.deleteTask(country,{taskId:station!.id,confirmTitle:station!.title,idempotencyKey:"delete-station"});
  const removed=await service.getCityScene(country,city.id);
  expect(removed.railway!.running).toBe(false);
  expect(frozen(removed.railway!)).toEqual(frozen(transferred.railway!));
  expect(await db.prepare("SELECT COUNT(*)::integer AS count FROM city_railway_corridors_v1 WHERE layout_id=?").get(after.id)).toEqual({count:1});
},30000);
