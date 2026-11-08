import {expect,test} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import type {ChunkTaskDto} from '../../src/shared/contracts';
import type {CitySceneDto} from '../../src/shared/city-scene-contract';
import {planCityParking} from '../../src/client/city-parking';
import {sceneWalkGeometry as geometry} from './city-scene-walk-fixture';
// Framebuffer readback for trace thumbnails starves a software renderer. Keep
// DOM/source traces and the explicit visual captures, as in city-mobility.
test.use({trace:{mode:'retain-on-failure',screenshots:false,snapshots:true,sources:true}});

test('машина заезжает на существующий мощёный участок парковки и возвращается на дорогу',async({page},info)=>{
 test.setTimeout(110000);
 await page.setViewportSize({width:800,height:600});
 await page.addInitScript(()=>{
  // Keep the initial traffic pool for this positive parking journey; calendar
  // closures, bus leases and population rebalancing have separate journeys.
  // Cars still use the real resolver, density and physical clock.
  localStorage.setItem('tasktopia:world-preferences:v2',JSON.stringify({quality:'ECONOMY',cityLife:false,sound:false}));
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
 await expect(host).toHaveAttribute('data-mobility-ready','true');
 await expect.poll(async()=>await host.getAttribute('data-road-event')??'').toBe('');
 await expect(host).toHaveAttribute('data-city-event-leases','0');await expect(host).toHaveAttribute('data-transit-role','');
 expect(Number(await host.getAttribute('data-cars'))).toBeGreaterThan(0);
 const state=()=>host.evaluate(el=>({steps:Number(el.dataset.mobilityFixedSteps),parked:el.dataset.parkedCarIds?.split(',').filter(Boolean)??[],road:el.dataset.roadCarIds?.split(',')??[],alive:el.dataset.agentIds?.split(',')??[]}));
 const arrivalStarted=(await state()).steps;
 // Entry uses the same simulation clock as the stop below: the CI trace had
 // advanced only 10.4 simulation seconds in 45 wall seconds, still en route.
 // Keep a 45-second simulation bound and the original whole-test deadline.
 await expect.poll(async()=>{const s=await state();return s.parked.length>0||s.steps-arrivalStarted>=900;},{timeout:75000}).toBe(true);
 const arrival=await state();
 await writeFile(info.outputPath('parking-arrival-state.json'),JSON.stringify({arrivalStarted,arrival,parking,
  state:await host.evaluate(el=>Object.fromEntries(['cars','parkingLots','trafficMaxWaitMs','mobilityPeakVehicleWaitMs','roadEvent','roadEventGeometry','roadClosedCells',
   'trafficBlockedVehicles','trafficMovingVehicles','mobilityTrips','cameraWorldX','cameraWorldY','populationLocalCars','worldQuality','worldPixelRatio',
   'transitRole','populationRetired','populationSpawned','mobilityReady','mobilityFixedSteps','agentIds'].map(k=>[k,el.dataset[k]??null])))},null,2));
 expect(arrival.parked.length).toBeGreaterThan(0);
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
