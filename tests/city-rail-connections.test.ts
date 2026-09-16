import { afterEach,expect,it } from "vitest";
import { createTestDb,type Db } from "../src/server/db";
import { registerUser } from "../src/server/auth";
import { AppService } from "../src/server/app-service";
import { readActiveBlockLayout } from "../src/server/world/active-block-layout";
import { buildPlanetRailways } from "../src/shared/planet-surface-transport";
import { projectPlanetAtlas } from "../src/shared/planet-atlas";
import { countryRailways } from "../src/shared/country-railways";
let db:Db|undefined;
afterEach(async()=>{await db?.close();});
async function stationInCity(service:AppService,scope:string,name:string){
    const city=await service.createCity(scope,{name,idempotencyKey:name});
    for(let i=0;i<12;i++){
      const d=await service.createDistrict(scope,{cityId:city.id,name:`${name}-${i}`,activate:false,idempotencyKey:`${name}-d-${i}`});
      await service.createTask(scope,{cityId:city.id,districtId:d.id,title:`${name}-${i}`,estimate:1,idempotencyKey:`${name}-t-${i}`});
    }
    const layout=(await readActiveBlockLayout(db!,city.id))!;
    const placement=layout.placements.find(p=>p.serviceRole==="RAILWAY");
    const block=layout.blocks.find(b=>Object.values(b.parameters.slotRoles??{}).includes("RAILWAY"))!;
    const districtId=layout.districtLayouts.find(d=>d.id===block.districtLayoutId)!.districtId;
    const task=placement ? await service.getTask(scope,placement.taskId) : await service.createTask(scope,{cityId:city.id,districtId,title:`${name} station`,estimate:1,idempotencyKey:`${name}-station`});
    expect(task.serviceRole).toBe("RAILWAY");
    await service.activateDistrict(scope,districtId,`${name}-activate`);
    for(const status of ["STARTED","IN_PROGRESS","TESTING"] as const)await service.updateTaskStatus(scope,{taskId:task.id,status,comment:"Build",idempotencyKey:`${name}-${status}`});
    return {city,task};
  }
it("uses the same ready domestic railway graph in personal CITY, COUNTRY and PLANET, and removes deleted endpoints",async()=>{
  db=await createTestDb();const service=new AppService(db);
  const {user}=await registerUser(db,{email:"rail-network@example.test",name:"Rail",password:"password123"});
  const scope=user.countryId;await db.prepare("UPDATE countries SET seed=? WHERE id=?").run(424242,scope);

  const first=await stationInCity(service,scope,"First"),second=await stationInCity(service,scope,"Second");
  const scene=()=>service.getCitySceneForUser(user.id,scope,first.city.id);
  expect((await scene()).railConnections).toEqual([]);
  await service.updateTaskStatus(scope,{taskId:first.task.id,status:"COMPLETED",comment:"Ready",idempotencyKey:"ready-first"});
  const alone=await scene();expect(alone.railConnections).toEqual([]);
  expect((await service.getCityDevelopment(user.id,scope,first.city.id)).transport?.find(n=>n.kind==="RAIL")).toMatchObject({state:"NO_CONNECTION",routes:[]});
  await service.updateTaskStatus(scope,{taskId:second.task.id,status:"COMPLETED",comment:"Ready",idempotencyKey:"ready-second"});
  const connected=await scene();expect(connected.railConnections).toHaveLength(1);
  expect(connected.sceneRevision).not.toBe(alone.sceneRevision);
  const ids=connected.railConnections!.map(r=>r.id).sort();
  const railCard=(await service.getCityDevelopment(user.id,scope,first.city.id)).transport!.find(n=>n.kind==="RAIL")!;
  expect(railCard.state).toBe("CONNECTED");
  expect(railCard.routes.map(r=>r.id)).toEqual(ids);
  expect(railCard.routes[0]).toMatchObject({destinationCityId:second.city.id,destinationName:"Second",travelMs:90000,dwellMs:12000});
  const overview=await service.getCountryOverview(user.id,scope);
  const planet=projectPlanetAtlas(await service.getPlanetAtlas(user.id));
  expect(countryRailways(overview).map(r=>r.id).sort()).toEqual(ids);
  expect(buildPlanetRailways(planet).map(r=>r.id).sort()).toEqual(ids);
  expect((await service.getCitySceneForUser(user.id,scope,second.city.id)).railConnections).toEqual(connected.railConnections);
  const other=(await registerUser(db,{email:"private-rail@example.test",name:"Other",password:"password123"})).user;
  await expect(service.getCitySceneForUser(other.id,scope,first.city.id)).rejects.toMatchObject({code:"FORBIDDEN"});
  await service.deleteTask(scope,{taskId:second.task.id,confirmTitle:second.task.title,idempotencyKey:"delete-second"});
  expect((await scene()).railConnections).toEqual([]);
  expect((await service.getCityDevelopment(user.id,scope,first.city.id)).transport?.find(n=>n.kind==="RAIL")).toMatchObject({state:"NO_CONNECTION",routes:[]});
  expect(countryRailways(await service.getCountryOverview(user.id,scope))).toEqual([]);
  expect(buildPlanetRailways(projectPlanetAtlas(await service.getPlanetAtlas(user.id)))).toEqual([]);
},60000);

it("keeps international rail IDs across views and removes inaccessible or deleted foreign stations",async()=>{
  db=await createTestDb();const service=new AppService(db);
  const {user}=await registerUser(db,{email:"international-rail@example.test",name:"Local",password:"password123"});
  const {user:owner}=await registerUser(db,{email:"foreign-rail@example.test",name:"Foreign",password:"password123"});
  for(const scope of [user.countryId,owner.countryId])await db.prepare("UPDATE countries SET seed=? WHERE id=?").run(424242,scope);
  const local=await stationInCity(service,user.countryId,"Local station"),foreign=await stationInCity(service,owner.countryId,"Foreign station");
  for(const [scope,stop] of [[user.countryId,local],[owner.countryId,foreign]] as const)
    await service.updateTaskStatus(scope,{taskId:stop.task.id,status:"COMPLETED",comment:"Ready",idempotencyKey:`ready-${stop.task.id}`});
  const scene=()=>service.getCitySceneForUser(user.id,user.countryId,local.city.id);
  expect((await scene()).railConnections).toEqual([]);
  const grant=()=>db!.prepare("INSERT INTO country_members(country_id,user_id,role,created_at) VALUES (?,?,'MEMBER',now())").run(owner.countryId,user.id);
  await grant();
  // Controlled persisted geography: adjacent dry countries. Domain tasks and
  // memberships remain real; random account IDs cannot make this test an island.
  await service.getPlanetAtlas(user.id);
  const {geography_json:geography}= (await db.prepare("SELECT geography_json FROM personal_planet_geography_v1 WHERE user_id=?")
    .get<{geography_json:import("../src/shared/planet-geography").PersonalPlanetGeography}>(user.id))!;
  geography.coastCells=[];geography.coastOwners={};
  for(const [index,stop,scope] of [[0,local,user.countryId],[1,foreign,owner.countryId]] as const){
    const record=geography.countries[scope]!;record.continent=0;record.sector=0;
    record.cells=Array.from({length:16},(_,i)=>({id:`rail-land-${index}-${i}`,q:4+index*4+i%4,r:4+Math.floor(i/4),terrain:"grass"}));
    record.center={x:(6+index*4)*2*geography.hexRadius,y:6*2*geography.hexRadius};
    record.cities[stop.city.id]!.point=record.center;
  }
  await db.prepare("UPDATE personal_planet_geography_v1 SET geography_json=?::jsonb WHERE user_id=?").run(JSON.stringify(geography),user.id);
  const verify=async()=>{
    const routes=buildPlanetRailways(projectPlanetAtlas(await service.getPlanetAtlas(user.id)));
    expect(routes).toHaveLength(1);
    const ids=routes.map(r=>r.id);
    expect((await scene()).railConnections!.map(r=>r.id)).toEqual(ids);
    const overview=await service.getCountryOverview(user.id,user.countryId);
    expect(overview.cities.map(c=>c.id)).toEqual([local.city.id]);
    const drawn=countryRailways(overview);expect(drawn.map(r=>r.id)).toEqual(ids);
    expect(drawn[0]!.progressRange).toBeDefined();
    const card=(await service.getCityDevelopment(user.id,user.countryId,local.city.id)).transport!.find(c=>c.kind==="RAIL")!;
    expect(card.routes[0]).toMatchObject({id:ids[0],destinationName:"Foreign station"});
  };
  await verify();
  await db.prepare("DELETE FROM country_members WHERE country_id=? AND user_id=?").run(owner.countryId,user.id);
  expect((await scene()).railConnections).toEqual([]);
  expect(countryRailways(await service.getCountryOverview(user.id,user.countryId))).toEqual([]);
  expect((await service.getCityDevelopment(user.id,user.countryId,local.city.id)).transport!.find(c=>c.kind==="RAIL")!.routes).toEqual([]);
  await grant();await verify();
  await service.deleteTask(owner.countryId,{taskId:foreign.task.id,confirmTitle:foreign.task.title,idempotencyKey:"foreign-demolition"});
  expect((await scene()).railConnections).toEqual([]);
  expect(countryRailways(await service.getCountryOverview(user.id,user.countryId))).toEqual([]);
  expect(buildPlanetRailways(projectPlanetAtlas(await service.getPlanetAtlas(user.id)))).toEqual([]);
},60000);
