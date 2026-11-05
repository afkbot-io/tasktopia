import {expect,test} from '@playwright/test';
import type {ChunkTaskDto} from '../../src/shared/contracts';
import type {CitySceneDto} from '../../src/shared/city-scene-contract';
import {materializeChunkPayload} from '../../src/shared/world-chunk-payload';
import {buildCityWalkNetwork} from '../../src/client/city-walk-network';
import {cityLifeSites,type CityLifePlan} from '../../src/client/city-life';
import { installSceneClock } from './city-scene-clock';
import { pauseInstalledClock } from './city-clock-control';
import {planCityParking} from '../../src/client/city-parking';
// Framebuffer readback for trace thumbnails starves a software renderer. Keep
// DOM/source traces and the explicit visual captures, as in city-mobility.
test.use({trace:{mode:'retain-on-failure',screenshots:false,snapshots:true,sources:true}});
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
 test.setTimeout(75000);await installSceneClock(page);
 await page.addInitScript(()=>localStorage.setItem('tasktopia:world-preferences:v2',JSON.stringify({quality:'NORMAL',cityLife:false,sound:false})));
 await page.request.post('/api/auth/login',{data:{email:'demo@tasktopia.local',password:'tasktopia-demo'}});
 const bootstrap=await (await page.request.get('/api/bootstrap')).json();
 const scene=await (await page.request.get(`/api/countries/${bootstrap.country.id}/cities/${bootstrap.initialCity.id}/scene`)).json() as CitySceneDto;
 const g=geometry(scene),sites=cityLifeSites(g.tasks,g.walkGraph,new Set([...g.blockedCells,...g.roads.keys()]));
 const task=g.tasks.find(task=>!task.serviceRole&&sites.some(site=>site.taskId===task.id))??g.tasks.find(task=>sites.some(site=>site.taskId===task.id))!;
 expect(task).toBeTruthy();
 const epoch=Math.floor(Date.UTC(2035,0,1)/180_000)*180_000+42_000;
 await page.route('**/api/**',async route=>{const response=await route.fetch({headers:{...route.request().headers(),'accept-encoding':'identity'}});await route.fulfill({response,headers:{...response.headers(),'cache-control':'no-store','x-tasktopia-server-time':String(epoch)}});});
 const writes:string[]=[],errors:string[]=[];page.on('request',r=>{if(r.method()!=='GET'&&new URL(r.url()).pathname.startsWith('/api/'))writes.push(r.url());});page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`/task/${task.taskNumber}?countryId=${bootstrap.country.id}&taskId=${task.id}`);
 await expect(page.locator('#task-title')).toBeVisible();await page.getByRole('button',{name:'Закрыть',exact:true}).click();
 const world=page.locator('.world-canvas');await expect(world).toHaveAttribute('data-loading','false',{timeout:45000});
 await expect(world).toHaveAttribute('data-mobility-ready','true',{timeout:15000});await expect(world).toHaveAttribute('data-movement-preparing','false');
 await pauseInstalledClock(page);
 const preferences=page.locator('.world-preferences:visible').first();await preferences.locator(':scope > summary').click();
 await preferences.getByLabel('Жизнь города').setChecked(true);await page.keyboard.press('Escape');
 for(let step=0;step<16&&!await world.getAttribute('data-city-life-episode-id');step++)await page.clock.runFor(500);
 await expect(world).toHaveAttribute('data-city-life-phase','ARRIVING');
 const plan=JSON.parse((await world.getAttribute('data-city-life-plan'))!) as CityLifePlan;
 const canonical=g.tasks.find(task=>task.id===plan.taskId)!;expect(canonical.status).toBe('COMPLETED');expect(canonical.stage).toBe(5);
 expect(plan.route.every(cell=>g.walkGraph.has(key(cell))&&!g.blockedCells.has(key(cell)))).toBe(true);
 const serverNow=async()=>Number(await world.getAttribute('data-road-event-server-now'));
 const seek=async(target:number)=>{for(let attempt=0;attempt<8;attempt++){const now=await serverNow();if(now>=target)return;await page.clock.fastForward(Math.max(1,Math.floor((target-now)/1.1)));await page.clock.runFor(100);}};
 await seek(plan.start+9000);await expect(world).toHaveAttribute('data-city-life-phase','ACTIVITY');
 await page.screenshot({path:info.outputPath('completed-home-life.png')});
 await seek(plan.start+35_000);await expect(world).toHaveAttribute('data-city-life-phase','LEAVING');
 await seek(plan.start+39_000);await expect(world).not.toHaveAttribute('data-city-life-episode-id',plan.id);
 const owners=JSON.parse((await world.getAttribute('data-city-event-owners'))!) as {id:string}[];expect(owners.some(owner=>owner.id===plan.id)).toBe(false);
 expect(writes).toEqual([]);expect(errors).toEqual([]);
 await info.attach('life-evidence',{body:Buffer.from(JSON.stringify({plan,owners,writes,errors,deviceScaleFactor:await page.evaluate(()=>devicePixelRatio)})),contentType:'application/json'});
});

test('машина заезжает на существующий мощёный участок парковки и возвращается на дорогу',async({page},info)=>{
 test.setTimeout(110000);
 await page.setViewportSize({width:800,height:600});
 await page.addInitScript(()=>{
  localStorage.setItem('tasktopia:world-preferences:v1',JSON.stringify({quality:'ECONOMY'}));
  // Replay the traffic seed captured in the Linux CI failure.
  const random=crypto.getRandomValues.bind(crypto);
  Object.defineProperty(crypto,'getRandomValues',{value:(array:ArrayBufferView<ArrayBuffer>)=>{
   const result=random(array);if(array instanceof Uint32Array&&array.length===1)array[0]=3139827732;return result;
  }});
 });
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
 await expect(page.locator('#task-title')).toBeVisible();await page.getByRole('button',{name:'Закрыть',exact:true}).click();
 const host=page.locator('.world-canvas');await expect(host).toHaveAttribute('data-loading','false',{timeout:45000});
 await expect.poll(async()=>Number(await host.getAttribute('data-parking-lots'))).toBeGreaterThan(0);
 const state=()=>host.evaluate(el=>({steps:Number(el.dataset.mobilityFixedSteps),parked:el.dataset.parkedCarIds?.split(',').filter(Boolean)??[],road:el.dataset.roadCarIds?.split(',')??[],alive:el.dataset.agentIds?.split(',')??[]}));
 const arrivalStarted=(await state()).steps;
 // Entry uses the same simulation clock as the stop below: the CI trace had
 // advanced only 10.4 simulation seconds in 45 wall seconds, still en route.
 // Keep a 45-second simulation bound and the original whole-test deadline.
 await expect.poll(async()=>{const s=await state();return s.parked.length>0||s.steps-arrivalStarted>=900;},{timeout:75000}).toBe(true);
 const arrival=await state();expect(arrival.parked.length).toBeGreaterThan(0);
 const parkedId=arrival.parked[0]!;
 expect(parkedId).toBeTruthy();
 const parkedAt=Number(await host.getAttribute('data-mobility-fixed-steps'));
 await page.screenshot({path:info.outputPath('parking-stop.png')});
 // Other cars can arrive meanwhile. Follow the same car through its exit
 // instead of requiring every parking space in the city to be empty at once.
 // Rendering caps a tick at 50 ms. On a software renderer 25 wall seconds
 // may contain fewer than the 16 simulation seconds of a normal stop.
 // Keep a strict 25-second simulation budget, with a bounded wall deadline.
 await expect.poll(async()=>{const s=await state();return s.road.includes(parkedId)||!s.alive.includes(parkedId)||s.steps-parkedAt>=500;},{timeout:75000}).toBe(true);
 expect((await state()).road).toContain(parkedId);
 expect((await host.getAttribute('data-agent-ids'))?.split(',')).toContain(parkedId);
 await expect(host).toHaveAttribute('data-mobility-vehicle-unsafe-total','0');
 expect(writes).toEqual([]);
 await info.attach('parking-evidence',{body:Buffer.from(JSON.stringify({parcel:target!.id,parkedId,parking,writes,arrivalStarted,parkedAt,returnedAt:(await state()).steps,metrics:await host.evaluate(el=>({cars:el.dataset.cars,unsafe:el.dataset.mobilityVehicleUnsafeTotal,parked:el.dataset.parkedCars}))})),contentType:'application/json'});
});
