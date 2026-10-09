import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import postgres from 'postgres';
import {createDb} from '../src/server/db';
import {registerUser,createCountry} from '../src/server/auth';
import {AppService} from '../src/server/app-service';
import {readActiveBlockLayout} from '../src/server/world/active-block-layout';
import type {PersonalPlanetGeography} from '../src/shared/planet-geography';
/** Isolated local QA data only. Never target an application database. */
const url=process.env.TEST_DATABASE_URL;assert.ok(url,'TEST_DATABASE_URL is required');
const targetDatabase=new URL(url);assert.ok(['127.0.0.1','localhost'].includes(targetDatabase.hostname));
assert.equal(targetDatabase.port,'55433');assert.equal(targetDatabase.pathname,'/tasktopia_test');
await mkdir('.builder/transport-rework-2026-10-09',{recursive:true});
const schema='transport_qa_'+randomUUID().replaceAll('-','');const admin=postgres(url,{max:1,onnotice:()=>{}});await admin.unsafe(`CREATE SCHEMA "${schema}"`);await admin.end();
const db=await createDb(url,{schema}),service=new AppService(db);
try{
 const {user}=await registerUser(db,{email:'transport-qa@example.test',name:'Транспортная проверка',password:'tasktopia-transport-qa'});
 const scopes=[await createCountry(db,user.id,'Материк',{version:1,kind:'EAST_COAST',coastX:128}),await createCountry(db,user.id,'Остров',{version:1,kind:'EAST_COAST',coastX:128})];
 const sites=[];
 for(let index=0;index<3;index++){
  const countryId=scopes[index===2?1:0]!;await db.prepare('UPDATE countries SET seed=123 WHERE id=?').run(countryId);
  const city=await service.createCity(countryId,{name:['Приморск','Сосново','Островной'][index]!,idempotencyKey:`city-${index}`});
  const district=await service.createDistrict(countryId,{cityId:city.id,name:'Район 1',activate:false,idempotencyKey:`district-${index}-0`});
  await service.createTask(countryId,{cityId:city.id,districtId:district.id,title:'Застройка 1',estimate:1,idempotencyKey:`task-${index}-0`});
  sites.push({countryId,city,districtId:district.id,terminals:[] as {id:string;role:string|undefined}[]});
 }
 await service.getPlanetAtlas(user.id);
 const geo=(await db.prepare('SELECT geography_json FROM personal_planet_geography_v1 WHERE user_id=?').get<{geography_json:PersonalPlanetGeography}>(user.id))!.geography_json;
 const oldCountries=geo.countries;geo.countries={};geo.coastCells=[];geo.coastOwners={};
 for(const [index,countryId] of scopes.entries()){
  const q0=10+index*22,r0=10,cells=Array.from({length:64},(_,i)=>({q:q0+i%8,r:r0+Math.floor(i/8),id:`land-${index}-${i}`,terrain:'grass' as const}));
  const coast=Array.from({length:100},(_,i)=>({q:q0-1+i%10,r:r0-1+Math.floor(i/10),id:`coast-${index}-${i}`,terrain:'coast' as const})).filter(c=>c.q===q0-1||c.q===q0+8||c.r===r0-1||c.r===r0+8);
  const cities=Object.fromEntries(sites.filter(s=>s.countryId===countryId).map((site,i)=>[site.city.id,{sourceCenter:site.city.center,point:{x:(q0+3)*geo.hexRadius*2,y:(r0+2+i*3)*geo.hexRadius*2}}]));
  geo.countries[countryId]={...oldCountries[countryId]!,countryId,sector:0,continent:index,cells,center:{x:(q0+4)*geo.hexRadius*2,y:(r0+4)*geo.hexRadius*2},cities} as PersonalPlanetGeography['countries'][string];
  geo.coastCells.push(...coast);for(const cell of coast)geo.coastOwners[cell.id]=[countryId];
 }
 await db.prepare('UPDATE personal_planet_geography_v1 SET geography_json=?::jsonb WHERE user_id=?').run(JSON.stringify(geo),user.id);
 for(const [index,site] of sites.entries()){
  const {countryId,city}=site;let districtId=site.districtId;
  await service.createTask(countryId,{cityId:city.id,districtId,title:'Морской порт',estimate:1,buildingHint:'compact-port-v1',idempotencyKey:`port-${index}`});
  for(let i=1;i<12;i++){
   const district=await service.createDistrict(countryId,{cityId:city.id,name:`Район ${i+1}`,activate:false,idempotencyKey:`district-${index}-${i}`});districtId=district.id;
   await service.createTask(countryId,{cityId:city.id,districtId,title:`Застройка ${i+1}`,estimate:1,idempotencyKey:`task-${index}-${i}`});
  }
  for(let i=0;i<36;i++){
   const layout=(await readActiveBlockLayout(db,city.id))!;
   if(['AIRPORT','RAILWAY','PORT'].every(role=>layout.placements.some(p=>p.serviceRole===role)))break;
   await service.createTask(countryId,{cityId:city.id,districtId,title:`Терминал ${i}`,estimate:1,idempotencyKey:`terminal-${index}-${i}`});
  }
  const layout=(await readActiveBlockLayout(db,city.id))!,terminals=layout.placements.filter(p=>['AIRPORT','RAILWAY','PORT'].includes(p.serviceRole??''));
  for(const placement of terminals){let task=await service.getTask(countryId,placement.taskId);await service.activateDistrict(countryId,task.districtId,`activate-${task.id}`);
   const order=['PLANNING','STARTED','IN_PROGRESS','TESTING','COMPLETED'] as const;
   for(const status of order.slice(order.indexOf(task.status)+1))task=await service.updateTaskStatus(countryId,{taskId:task.id,status,comment:'Локальная проверка транспорта',idempotencyKey:`stage-${task.id}-${status}`});
  }
  site.terminals=terminals.map(p=>({id:p.taskId,role:p.serviceRole}));console.log(JSON.stringify({city:city.name,terminals:site.terminals}));
 }
 // Allocate the reserved roles in their actual districts. A caller cannot
 // assume all three terminals share the last district created above.
 for(const site of sites)for(const role of ['AIRPORT','RAILWAY']){
  let layout=(await readActiveBlockLayout(db,site.city.id))!;
  let placement=layout.placements.find(p=>p.serviceRole===role);
  const block=layout.blocks.find(b=>Object.values(b.parameters.slotRoles??{}).includes(role));
  assert.ok(block,`Missing reservation for ${role}`);
  const districtId=layout.districtLayouts.find(d=>d.id===block.districtLayoutId)!.districtId;
  for(let i=0;!placement&&i<24;i++){
   await service.createTask(site.countryId,{cityId:site.city.id,districtId,title:`Открываем ${role} ${i}`,estimate:1,idempotencyKey:`open-${site.city.id}-${role}-${i}`});
   layout=(await readActiveBlockLayout(db,site.city.id))!;placement=layout.placements.find(p=>p.serviceRole===role);
  }
  assert.ok(placement,`No task for ${role}`);
  let task=await service.getTask(site.countryId,placement.taskId);await service.activateDistrict(site.countryId,task.districtId,`activate-${task.id}`);
  const order=['PLANNING','STARTED','IN_PROGRESS','TESTING','COMPLETED'] as const;
  for(const status of order.slice(order.indexOf(task.status)+1))task=await service.updateTaskStatus(site.countryId,{taskId:task.id,status,comment:'Транспорт открыт для проверки',idempotencyKey:`stage-${task.id}-${status}`});
  if(!site.terminals.some(terminal=>terminal.id===task.id))site.terminals.push({id:task.id,role});
 }
 const atlas=await service.getPlanetAtlas(user.id);for(const site of sites){const scene=await service.getCitySceneForUser(user.id,site.countryId,site.city.id);console.log(JSON.stringify({city:site.city.name,airfields:scene.airports?.map(s=>({stage:s.stage,ready:!!s.plan})),air:scene.airportConnections.length,rail:scene.railConnections?.length,sea:scene.seaConnections?.length}));}
 const target=new URL(url);target.searchParams.set('options',`-csearch_path=${schema}`);await writeFile('.builder/transport-rework-2026-10-09/functional-db-url',target.toString(),{mode:0o600});
 await writeFile('.builder/transport-rework-2026-10-09/functional-fixture.json',JSON.stringify({schema,userId:user.id,sites,railRoutes:atlas.railRoutes?.length,seaRoutes:atlas.seaRoutes?.length},null,2));
}finally{await db.close();}
