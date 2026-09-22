import {expect,test} from '@playwright/test';
import type {ChunkTaskDto} from '../../src/shared/contracts';
import type {CitySceneDto} from '../../src/shared/city-scene-contract';
import {materializeChunkPayload} from '../../src/shared/world-chunk-payload';
import {buildCityWalkNetwork} from '../../src/client/city-walk-network';
import {cityLifeSites,planCityLife} from '../../src/client/city-life';
import {planCityParking} from '../../src/client/city-parking';
const key=(c:{x:number;y:number})=>`${c.x},${c.y}`;
function geometry(scene:CitySceneDto){
 const chunks=scene.chunks.map(c=>materializeChunkPayload(c));
 const tasks=[...new Map([...chunks.flatMap(c=>c.tasks),...scene.completedDistrictSnapshots.flatMap(s=>s.tasks)].map(t=>[t.id,t])).values()];
 const roads=new Map(chunks.flatMap(c=>c.roads).map(c=>[key(c),c]));
 const surfaces=chunks.flatMap(c=>c.surfaces);
 const network=buildCityWalkNetwork({tasks,roads,surfaces,terrain:chunks.flatMap(c=>c.terrain),features:chunks.flatMap(c=>c.worldFeatures),decorations:chunks.flatMap(c=>c.decorations)});
 return {tasks,roads,surfaces,...network};
}

test('событие у завершённого дома прибывает, действует и завершается без записей задач',async({page},info)=>{
 test.setTimeout(75000);
 await page.request.post('/api/auth/login',{data:{email:'demo@tasktopia.local',password:'tasktopia-demo'}});
 const bootstrap=await (await page.request.get('/api/bootstrap')).json();
 const scene=await (await page.request.get(`/api/countries/${bootstrap.country.id}/cities/${bootstrap.initialCity.id}/scene`)).json() as CitySceneDto;
 const g=geometry(scene),sites=cityLifeSites(g.tasks,g.walkGraph,new Set([...g.blockedCells,...g.roads.keys()]));
 const candidates=g.tasks.filter(t=>t.status==='COMPLETED'&&t.stage===5).map(t=>t.id);
 let plan:ReturnType<typeof planCityLife>;
 for(let w=Math.floor(Date.now()/180000);w<Math.floor(Date.now()/180000)+12&&!plan;w++)plan=planCityLife(scene.city.id,sites,w*180000,candidates);
 expect(plan).toBeTruthy();const task=g.tasks.find(t=>t.id===plan!.taskId)!;
 const epoch=plan!.start-6000;
 await page.clock.install();
 await page.route('**/api/**',async route=>{const response=await route.fetch();await route.fulfill({response,headers:{...response.headers(),'cache-control':'no-store','x-tasktopia-server-time':String(epoch)}});});
 const writes:string[]=[],errors:string[]=[];page.on('request',r=>{if(r.method()!=='GET'&&new URL(r.url()).pathname.startsWith('/api/'))writes.push(r.url());});page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`/task/${task.taskNumber}?countryId=${bootstrap.country.id}&taskId=${task.id}`);
 await expect(page.locator('.world-canvas')).toHaveAttribute('data-loading','false',{timeout:45000});
 await page.getByRole('button',{name:'Закрыть',exact:true}).click();
 const world=page.locator('.world-canvas');await expect(world).toHaveAttribute('data-city-life-event',plan!.kind,{timeout:15000});
 await expect(world).toHaveAttribute('data-city-life-phase','ARRIVING');
 await page.clock.fastForward(10000);await expect(world).toHaveAttribute('data-city-life-phase','ACTIVITY');
 await page.screenshot({path:info.outputPath('completed-home-life.png')});
 await page.clock.fastForward(24000);await expect(world).toHaveAttribute('data-city-life-phase','LEAVING');
 await page.clock.fastForward(9000);await expect(world).toHaveAttribute('data-city-life-event','');
 expect(writes).toEqual([]);expect(errors).toEqual([]);
 await info.attach('life-evidence',{body:Buffer.from(JSON.stringify({kind:plan!.kind,taskId:task.id,route:plan!.route,writes,errors})),contentType:'application/json'});
});

test('машина заезжает на существующий мощёный участок парковки и возвращается на дорогу',async({page},info)=>{
 test.setTimeout(110000);
 await page.request.post('/api/auth/login',{data:{email:'demo@tasktopia.local',password:'tasktopia-demo'}});
 const bootstrap=await (await page.request.get('/api/bootstrap')).json();
 const scene=await (await page.request.get(`/api/countries/${bootstrap.country.id}/cities/${bootstrap.initialCity.id}/scene`)).json() as CitySceneDto;
 // Controlled visual family fixture: keep the real parcel, roads and paving.
 // The seed has no parking family; no database record or geometry is changed.
 const original=geometry(scene);let target:ChunkTaskDto|undefined;
 for(const task of original.tasks.filter(t=>t.visualKind==='PARK'&&t.status==='COMPLETED')) {
  if(planCityParking([{...task,visualAssetKey:'urban-parking'}],original.roads,original.surfaces,new Set()).length){target=task;break;}
 }
 expect(target).toBeTruthy();
 for(const task of [...scene.chunks.flatMap(c=>c.tasks),...scene.completedDistrictSnapshots.flatMap(s=>s.tasks)])if(task.id===target!.id)task.visualAssetKey='urban-parking';
 const g=geometry(scene),parking=planCityParking(g.tasks,g.roads,g.surfaces,g.blockedCells);expect(parking.length).toBeGreaterThan(0);
 await page.route('**/api/countries/*/cities/*/scene',r=>r.fulfill({json:scene}));
 const writes:string[]=[];page.on('request',r=>{if(r.method()!=='GET'&&new URL(r.url()).pathname.startsWith('/api/'))writes.push(r.url());});
 await page.goto(`/task/${target!.taskNumber}?countryId=${bootstrap.country.id}&taskId=${target!.id}`);
 const host=page.locator('.world-canvas');await expect(host).toHaveAttribute('data-loading','false',{timeout:45000});await page.getByRole('button',{name:'Закрыть',exact:true}).click();
 await expect.poll(async()=>Number(await host.getAttribute('data-parking-lots'))).toBeGreaterThan(0);
 await expect.poll(async()=>Number(await host.getAttribute('data-parked-cars')),{timeout:45000}).toBeGreaterThan(0);
 await page.screenshot({path:info.outputPath('parking-stop.png')});
 await expect.poll(async()=>Number(await host.getAttribute('data-parked-cars')),{timeout:25000}).toBe(0);
 expect(writes).toEqual([]);
 await info.attach('parking-evidence',{body:Buffer.from(JSON.stringify({parcel:target!.id,parking,writes,metrics:await host.evaluate(el=>({cars:el.dataset.cars,unsafe:el.dataset.mobilityUnsafe,parked:el.dataset.parkedCars}))})),contentType:'application/json'});
});
