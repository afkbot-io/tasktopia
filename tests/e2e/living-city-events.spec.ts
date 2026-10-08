import { expect, test, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { AppService } from '../../src/server/app-service';
import { createDb } from '../../src/server/db';
import { registerUser } from '../../src/server/auth';
import { seedCompactCity } from '../../src/server/fixtures/representative-country';
import { openMapCity } from './map-navigation';
import { taskLink } from '../../src/client/task-navigation';
import type { TaskDto } from '../../src/shared/contracts';

async function fixture(page:Page){
 const database=process.env.E2E_DATABASE_URL!;
 expect(['127.0.0.1','localhost']).toContain(new URL(database).hostname);
 const db=await createDb(database,{migrate:false}),service=new AppService(db);
 const {user}=await registerUser(db,{email:`living-${crypto.randomUUID()}@example.test`,name:'Живой город QA',password:'password123'});
 await db.prepare('UPDATE countries SET seed=? WHERE id=?').run(424242,user.countryId);
 const city=await seedCompactCity(service,user.countryId,{key:crypto.randomUUID(),name:'Город живых событий',taskCount:24});
 const tasks=await service.listTasks(user.countryId),task=tasks.find(t=>t.stage===1&&t.visualKind==='BUILDING'&&!['AIRPORT','PORT','RAILWAY'].includes(t.serviceRole??''))!;
 expect(task).toBeTruthy();
 expect((await page.request.post('/api/auth/login',{data:{email:user.email,password:'password123'}})).ok()).toBe(true);
 const tokenResponse=await page.request.post('/api/tokens',{data:{name:'Living city local QA',scopes:['tasks:read','tasks:write'],expiresInDays:30}});
 expect(tokenResponse.ok(),await tokenResponse.text()).toBe(true);const token=await tokenResponse.json();
 const client=new Client({name:'living-city-live-qa',version:'1.0.0'});
 await client.connect(new StreamableHTTPClientTransport(new URL('/mcp',process.env.E2E_BASE_URL),{requestInit:{headers:{Authorization:`Bearer ${token.token}`}}}));
 const call=async(name:string,args:Record<string,unknown>,idempotencyKey=crypto.randomUUID())=>{
  const result=await client.callTool({name,arguments:{countryId:user.countryId,idempotencyKey,...args}});
  expect(result.isError,JSON.stringify(result.content)).not.toBe(true);
  return JSON.parse((result.content as {type:string;text:string}[]).find(c=>c.type==='text')!.text);
 };
 const host=page.locator('.world-canvas');
 const focus=async(t:TaskDto)=>{await page.goto(taskLink(user.countryId,t));await expect(page.locator('#task-title')).toContainText(t.title);await page.getByRole('button',{name:'Закрыть',exact:true}).click();await expect(host).toHaveAttribute('data-city-scene-commit','atomic',{timeout:30000});await expect(host).toHaveAttribute('data-mobility-ready','true',{timeout:30000});};
 const cleanup=async()=>{await page.close();await client.close();await db.prepare('DELETE FROM countries WHERE id=?').run(user.countryId);await db.prepare('DELETE FROM users WHERE id=?').run(user.id);await db.close();};
 return {db,service,user,city,task,tasks,call,host,focus,cleanup};
}

test('MCP/WebSocket keeps the old building through all stages, delivers a helicopter transfer and leaves ruins after demolition',async({page},info)=>{
 test.setTimeout(180000);await page.setViewportSize({width:1440,height:1100});
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 const f=await fixture(page);
 try{
  await f.focus(f.task);
  let current=f.task,oldStage=current.stage;
  for(const [status,progress] of [['STARTED',undefined],['IN_PROGRESS',40],['IN_PROGRESS',60],['TESTING',undefined],['COMPLETED',undefined]] as const){
   const changed=await f.call('task.set_status',{taskId:current.id,status,...progress===undefined?{}:{progress},comment:'Живой локальный тест'});
   current=changed;
   if(current.stage!==oldStage){
    await expect(f.host).toHaveAttribute('data-cinematic-phases',new RegExp(`${current.id}:CONSTRUCT:WORK`));
    const state=JSON.parse((await f.host.getAttribute('data-cinematic-state'))!)[0];
    expect(state).toMatchObject({taskId:current.id,fromStage:oldStage,toStage:current.stage,oldVisible:true,targetVisible:false});
    expect(Number(await f.host.getAttribute('data-cinematic-workers'))).toBeGreaterThan(1);
    await page.screenshot({path:info.outputPath(`build-${oldStage}-${current.stage}-work.png`)});
    await expect(f.host).toHaveAttribute('data-city-cinematics','0',{timeout:9000});
   }
   oldStage=current.stage;
  }
  const key=crypto.randomUUID();await f.call('task.set_status',{taskId:current.id,status:'COMPLETED'},key);
  await f.call('task.set_status',{taskId:current.id,status:'COMPLETED'},key);
  await expect(f.host).toHaveAttribute('data-city-cinematics','0');
  const destination=(await f.service.listDistricts(f.user.countryId,f.city.id)).find(d=>d.id!==current.districtId&&d.status!=='COMPLETED')!;
  const before={...current.origin};
  current=await f.call('task.transfer',{taskId:current.id,targetDistrictId:destination.id});
  expect(current.origin).not.toEqual(before);
  await expect(f.host).toHaveAttribute('data-cinematic-phases',new RegExp(`${current.id}:TRANSFER:CARRY`),{timeout:9000});
  const flying=JSON.parse((await f.host.getAttribute('data-cinematic-state'))!)[0];
  expect(flying).toMatchObject({kind:'TRANSFER',oldVisible:true,targetVisible:false,aircraftVisible:true});
  await page.screenshot({path:info.outputPath('transfer-carry.png')});
  await expect(f.host).toHaveAttribute('data-city-cinematics','0',{timeout:10000});
  await f.focus(current);
  await f.call('task.delete',{taskId:current.id,confirmTitle:current.title});
  await expect(f.host).toHaveAttribute('data-cinematic-phases',new RegExp(`${current.id}:DEMOLISH:COVER`));
  await page.screenshot({path:info.outputPath('demolish-cover.png')});
  await expect(f.host).toHaveAttribute('data-city-cinematics','0',{timeout:9000});
  expect((await f.service.listWorldFeatures(f.user.countryId)).some(feature=>feature.siteMarker?.kind==='RUINED'&&feature.siteMarker.snapshot.taskNumber===current.taskNumber)).toBe(true);
  await page.screenshot({path:info.outputPath('demolish-ruins.png')});
  expect(await f.host.getAttribute('data-city-audio-voices')).toBe('0');expect(errors).toEqual([]);
 }finally{await f.cleanup();}
});

test('delayed artwork, rapid stage coalescing, rollback, map departure and reduced motion keep the latest state',async({page},info)=>{
 test.setTimeout(120000);const f=await fixture(page);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await f.focus(f.task);await f.call('task.set_status',{taskId:f.task.id,status:'STARTED'});await expect(f.host).toHaveAttribute('data-cinematic-phases',/CONSTRUCT:WORK/);await expect(f.host).toHaveAttribute('data-city-cinematics','0',{timeout:9000});
  let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});let blocked=false;
  await page.route('**/stage-3.png',async route=>{blocked=true;await gate;await route.continue();});
  await f.call('task.set_status',{taskId:f.task.id,status:'IN_PROGRESS',progress:40});
  await expect(f.host).toHaveAttribute('data-cinematic-phases',new RegExp(`${f.task.id}:CONSTRUCT:COVER`));
  expect(blocked).toBe(true);expect((await f.service.getTask(f.user.countryId,f.task.id)).stage).toBe(3);
  expect(JSON.parse((await f.host.getAttribute('data-cinematic-state'))!)[0]).toMatchObject({fromStage:2,toStage:3,oldVisible:true,targetVisible:false});
  await page.screenshot({path:info.outputPath('delayed-art-cover.png')});release();await page.unrouteAll({behavior:'wait'});
  await expect(f.host).toHaveAttribute('data-city-cinematics','0',{timeout:9000});
  await f.call('task.set_status',{taskId:f.task.id,status:'TESTING'});
  await expect(f.host).toHaveAttribute('data-cinematic-phases',/CONSTRUCT:WORK/);await expect(f.host).toHaveAttribute('data-city-cinematics','0',{timeout:9000});
  await f.call('task.set_status',{taskId:f.task.id,status:'IN_PROGRESS',progress:40,comment:'Возврат из тестирования после замечания QA'});
  await expect(f.host).toHaveAttribute('data-cinematic-phases',new RegExp(`${f.task.id}:CONSTRUCT:WORK`));
  expect(JSON.parse((await f.host.getAttribute('data-cinematic-state'))!)[0]).toMatchObject({fromStage:4,toStage:3,oldVisible:true,targetVisible:false});
  await expect(f.host).toHaveAttribute('data-city-cinematics','0',{timeout:9000});
  const fresh=f.tasks.find(t=>t.id!==f.task.id&&t.stage===1&&t.visualKind==='BUILDING'&&!['AIRPORT','PORT','RAILWAY'].includes(t.serviceRole??''))!;
  expect(fresh).toBeTruthy();await f.focus(fresh);
  for(const [status,progress] of [['STARTED',undefined],['IN_PROGRESS',60],['TESTING',undefined]] as const)
   await f.call('task.set_status',{taskId:fresh.id,status,...progress===undefined?{}:{progress}});
  await expect(f.host).toHaveAttribute('data-cinematic-state',/"toStage":4/);
  expect(JSON.parse((await f.host.getAttribute('data-cinematic-state'))!)[0]).toMatchObject({fromStage:1,toStage:4});
  await page.getByRole('navigation',{name:'Уровень карты'}).getByRole('button',{name:'Планета',exact:true}).click();
  await expect(f.host).toHaveAttribute('data-city-cinematics','0');
  await openMapCity(page);
  await expect(f.host).toHaveAttribute('data-city-cinematics','0');
  await page.emulateMedia({reducedMotion:'reduce'});await expect(f.host).toHaveAttribute('data-animation-active','false');
  await f.call('task.set_status',{taskId:fresh.id,status:'IN_PROGRESS',progress:40,comment:'Разрешённый возврат из тестирования'});
  await expect(f.host).toHaveAttribute('data-city-cinematics','0');await expect(f.host).toHaveAttribute('data-realtime-patched-tasks',new RegExp(fresh.id));
  await page.reload();await openMapCity(page);await expect(f.host).toHaveAttribute('data-city-scene-commit','atomic',{timeout:30000});await expect(f.host).toHaveAttribute('data-city-cinematics','0');
  expect(errors).toEqual([]);
 }finally{await f.cleanup();}
});

test('touch-sized economy mode, trusted sound opt-in and cancellation remain usable',async({page,hasTouch},info)=>{
 test.setTimeout(90000);await page.setViewportSize({width:390,height:844});const f=await fixture(page);
 try{
  await f.focus(f.task);const menu=page.locator('.world-menu > summary');if(hasTouch)await menu.tap();else await menu.click();const settings=page.locator('.world-preferences:visible');if(hasTouch)await settings.locator('> summary').tap();else await settings.locator('> summary').click();
  await settings.getByLabel('Детализация').selectOption('ECONOMY');await settings.getByLabel('Звуки города').check();await expect(settings.getByLabel('Звуки города')).toBeChecked();
  await page.screenshot({path:info.outputPath('mobile-sound-preferences.png')});await page.keyboard.press('Escape');await page.keyboard.press('Escape');
  await f.call('task.set_status',{taskId:f.task.id,status:'STARTED'});await expect(f.host).toHaveAttribute('data-cinematic-phases',/CONSTRUCT:WORK/);
  expect(Number(await f.host.getAttribute('data-cinematic-workers'))).toBeLessThanOrEqual(3);
  await expect.poll(async()=>Number(await f.host.getAttribute('data-city-audio-played'))).toBeGreaterThan(0);
  await page.screenshot({path:info.outputPath('mobile-build-work.png')});
  await page.emulateMedia({reducedMotion:'reduce'});await expect(f.host).toHaveAttribute('data-city-cinematics','0');await expect(f.host).toHaveAttribute('data-city-audio-voices','0');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }finally{await f.cleanup();}
});

test('live cards stay current, reconnect skips old events and failed artwork cannot hold a ghost forever',async({page},info)=>{
 test.setTimeout(100000);const f=await fixture(page);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 const openCard=async()=>{await page.getByLabel('Поиск здания по номеру или названию').fill(String(f.task.taskNumber));await page.locator('.task-search-results button').first().click();await expect(page.locator('#task-title')).toContainText(f.task.title);};
 try{
  await f.focus(f.task);await openCard();await f.call('task.set_status',{taskId:f.task.id,status:'STARTED'});
  await expect(page.locator('.task-modal .stage-icon')).toHaveText('2');await expect(f.host).toHaveAttribute('data-cinematic-phases',/CONSTRUCT:WORK/);
  expect(JSON.parse((await f.host.getAttribute('data-cinematic-state'))!)[0]).toMatchObject({fromStage:1,toStage:2,oldVisible:true,targetVisible:false});
  await page.getByRole('button',{name:'Закрыть',exact:true}).click();await expect(f.host).toHaveAttribute('data-city-cinematics','0',{timeout:9000});
  await page.context().setOffline(true);await expect(page.getByRole('button',{name:'Настройки аккаунта, подключение',exact:true})).toBeVisible({timeout:30000});
  await f.call('task.set_status',{taskId:f.task.id,status:'IN_PROGRESS',progress:40});await page.waitForTimeout(11000);
  await page.context().setOffline(false);await expect(page.getByRole('button',{name:'Настройки аккаунта, в сети',exact:true})).toBeVisible({timeout:30000});
  await expect(f.host).toHaveAttribute('data-city-scene-commit','atomic',{timeout:30000});await expect(f.host).toHaveAttribute('data-city-cinematics','0');
  await openCard();await expect(page.locator('.task-modal .stage-icon')).toHaveText('3');await page.getByRole('button',{name:'Закрыть',exact:true}).click();
  let failed=0;await page.route('**/stage-4.png',route=>{failed++;return route.fulfill({status:503,body:'Temporary artwork failure'});});
  await f.call('task.set_status',{taskId:f.task.id,status:'TESTING'});await expect(f.host).toHaveAttribute('data-cinematic-phases',/CONSTRUCT:WORK/);
  await expect(f.host).toHaveAttribute('data-city-cinematics','0',{timeout:9000});await expect(f.host).toHaveAttribute('data-cinematic-workers','0');expect(failed).toBeGreaterThan(0);
  expect((await f.service.getTask(f.user.countryId,f.task.id)).stage).toBe(4);await page.screenshot({path:info.outputPath('art-failure-no-held-ghost.png')});
  const publishes=Number(await f.host.getAttribute('data-entity-ready-publishes'));
  const recovered=page.waitForResponse(response=>response.url().endsWith('/stage-4.png')&&response.ok(),{timeout:30000});
  await page.unrouteAll({behavior:'wait'});const retry=page.locator('.map-retry-button');if(await retry.isVisible())await retry.click();await recovered;
  await expect.poll(async()=>Number(await f.host.getAttribute('data-entity-ready-publishes')),{timeout:30000}).toBeGreaterThan(publishes);await openCard();await expect(page.locator('.task-modal .stage-icon')).toHaveText('4');expect(errors).toEqual([]);
 }finally{await page.context().setOffline(false);await f.cleanup();}
});

test('real-clock effects stay within the CPU and retained-heap budgets over repeated updates',async({page,browserName},info)=>{
 test.skip(browserName!=='chromium','CDP heap evidence requires Chromium');test.setTimeout(180000);await page.setViewportSize({width:1440,height:1100});const f=await fixture(page);
 try{
  await f.focus(f.task);await page.locator('.world-menu > summary').click();const preferences=page.locator('.world-preferences:visible');await preferences.locator('> summary').click();await preferences.getByLabel('Детализация').selectOption('NORMAL');await page.keyboard.press('Escape');await page.keyboard.press('Escape');
  const samples:{label:string;cpuP95:number;cpuMax:number;workers:number;ghosts:number}[]=[];
  const sample=async(label:string)=>samples.push(await f.host.evaluate((el,label)=>{const d=(el as HTMLElement).dataset;return {label,cpuP95:Number(d.livingWorldFrameCpuP95Ms),cpuMax:Number(d.livingWorldFrameCpuMaxMs),workers:Number(d.cinematicWorkers),ghosts:Number(d.cityCinematics)};},label));
  await expect.poll(async()=>Number(await f.host.getAttribute('data-living-world-frame-samples'))).toBe(120);await sample('idle baseline');
  for(const status of ['STARTED','IN_PROGRESS','TESTING']as const){await f.call('task.set_status',{taskId:f.task.id,status,...status==='IN_PROGRESS'?{progress:40}:{}});await expect(f.host).toHaveAttribute('data-cinematic-phases',/CONSTRUCT:WORK/);await sample(`warm ${status}`);await expect(f.host).toHaveAttribute('data-cinematic-phases',/CONSTRUCT:COVER/);await sample(`cover ${status}`);await expect(f.host).toHaveAttribute('data-city-cinematics','0',{timeout:9000});}
  const cdp=await page.context().newCDPSession(page);await cdp.send('HeapProfiler.collectGarbage');const before=await cdp.send('Runtime.getHeapUsage');
  for(let cycle=0;cycle<3;cycle++)for(const status of ['IN_PROGRESS','TESTING']as const){await f.call('task.set_status',{taskId:f.task.id,status,...status==='IN_PROGRESS'?{progress:40,comment:'Цикл проверки памяти'}:{}});await expect(f.host).toHaveAttribute('data-cinematic-phases',/CONSTRUCT:WORK/);await sample(`cycle ${cycle} ${status}`);await expect(f.host).toHaveAttribute('data-city-cinematics','0',{timeout:9000});}
  await cdp.send('HeapProfiler.collectGarbage');const after=await cdp.send('Runtime.getHeapUsage');
  const renderer=await page.locator('.world-canvas canvas').evaluate(el=>{const gl=(el as HTMLCanvasElement).getContext('webgl2')??(el as HTMLCanvasElement).getContext('webgl');const ext=gl?.getExtension('WEBGL_debug_renderer_info');return ext?gl!.getParameter(ext.UNMASKED_RENDERER_WEBGL):'unavailable';});
  await expect.poll(async()=>Number(await f.host.getAttribute('data-road-event-started')),{timeout:95000}).toBeGreaterThan(0);
  const roadPlanningMs=Number(await f.host.getAttribute('data-road-planning-ms'));
  await mkdir(info.outputDir,{recursive:true});const report=info.outputPath('performance.json');
  await writeFile(report,JSON.stringify({workload:'24 tasks, normal quality, 3 warm stages + 6 repeated transitions + one scheduled road response; real monotonic browser clock',budgets:{livingCpuP95Ms:8,roadPlanningMs:50,retainedHeapGrowthBytes:8*1024*1024,ghosts:3,workers:18},renderer,samples,roadPlanningMs,before,after,heapGrowth:after.usedSize-before.usedSize},null,2));await info.attach('performance',{path:report,contentType:'application/json'});
  expect(Math.max(...samples.map(s=>s.cpuP95))).toBeLessThanOrEqual(8);expect(roadPlanningMs).toBeLessThanOrEqual(50);expect(samples.every(s=>s.ghosts<=3&&s.workers<=18)).toBe(true);expect(after.usedSize-before.usedSize).toBeLessThan(8*1024*1024);
  await expect(f.host).toHaveAttribute('data-cinematic-workers','0');await expect(f.host).toHaveAttribute('data-city-audio-voices','0');await cdp.detach();
 }finally{await f.cleanup();}
});

test('visibility lifecycle stops work and audio, then releases an expired capture onto the latest server stage',async({page})=>{
 test.setTimeout(45000);const f=await fixture(page);
 try{
  await f.focus(f.task);await f.call('task.set_status',{taskId:f.task.id,status:'STARTED'});await expect(f.host).toHaveAttribute('data-cinematic-phases',/CONSTRUCT:WORK/);
  // Headless tabs remain visible even after bringToFront on another tab.
  // Inject only the browser lifecycle signal; changes still use live MCP/WS.
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
  await expect(f.host).toHaveAttribute('data-animation-active','false');await expect(f.host).toHaveAttribute('data-city-audio-voices','0');
  await f.call('task.set_status',{taskId:f.task.id,status:'IN_PROGRESS',progress:40});await page.waitForTimeout(6000);
  await page.evaluate(()=>{Reflect.deleteProperty(document,'hidden');document.dispatchEvent(new Event('visibilitychange'));});
  await expect(f.host).toHaveAttribute('data-city-cinematics','0');await expect(f.host).toHaveAttribute('data-cinematic-workers','0');await expect(f.host).toHaveAttribute('data-animation-active','true');
  await page.getByLabel('Поиск здания по номеру или названию').fill(String(f.task.taskNumber));await page.locator('.task-search-results button').first().click();await expect(page.locator('.task-modal .stage-icon')).toHaveText('3');
 }finally{await f.cleanup();}
});

test('all five road scenes dispatch moving services, close and reopen lanes without unsafe pairs',async({page},info)=>{
 test.setTimeout(240000);await page.setViewportSize({width:1440,height:1100});await page.clock.install();const f=await fixture(page);
 try{
  await f.focus(f.task);const kinds=new Set<string>();
  for(let attempt=0;attempt<12&&kinds.size<5;attempt++){
   await expect(f.host).toHaveAttribute('data-road-event-server-now',/\d{13}/);
   for(let advance=0;advance<4&&!(await f.host.getAttribute('data-road-event'));advance++){
    const now=Number(await f.host.getAttribute('data-road-event-server-now')),next=Number(await f.host.getAttribute('data-road-event-next-start'));
    await page.clock.fastForward(Math.max(100,Math.round(next-now)+300));await page.clock.runFor(100);
   }
   await expect.poll(()=>f.host.getAttribute('data-road-event'),{timeout:3000}).not.toBe('');
   const kind=(await f.host.getAttribute('data-road-event'))!;kinds.add(kind);
   expect(Number(await f.host.getAttribute('data-road-responders'))).toBeGreaterThan(0);
   expect(Number(await f.host.getAttribute('data-road-closed-cells'))).toBe(kind==='PATROL'?0:3);
   await page.clock.runFor(5500);
   await page.screenshot({path:info.outputPath(`road-${kind.toLowerCase()}.png`)});
   await expect(f.host).toHaveAttribute('data-mobility-vehicle-unsafe-total','0');
   await expect(f.host).toHaveAttribute('data-mobility-vehicle-pedestrian-unsafe-total','0');
   await page.clock.runFor(17000);await expect(f.host).toHaveAttribute('data-road-event','');await expect(f.host).toHaveAttribute('data-road-closed-cells','0');
  }
  expect(kinds).toEqual(new Set(['ACCIDENT','REPAIR','FIRE','MEDICAL','PATROL']));
  expect(Number(await f.host.getAttribute('data-road-response-trips'))).toBeGreaterThan(0);
 }finally{await f.cleanup();}
});

test('park ground changes and demolition overriding unfinished work settle to authoritative scene',async({page},info)=>{
 test.setTimeout(90000);const f=await fixture(page);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  const park=f.tasks.find(task=>task.visualKind==='PARK'&&task.stage===1)!;expect(park).toBeTruthy();
  await f.service.activateDistrict(f.user.countryId,park.districtId,crypto.randomUUID());await f.focus(park);
  await f.call('task.set_status',{taskId:park.id,status:'STARTED'});await expect(f.host).toHaveAttribute('data-cinematic-phases',/CONSTRUCT:WORK/);await expect(f.host).toHaveAttribute('data-city-cinematics','0',{timeout:9000});
  const changed=await f.call('task.set_status',{taskId:park.id,status:'IN_PROGRESS',progress:60});
  await expect(f.host).toHaveAttribute('data-cinematic-phases',new RegExp(`${park.id}:CONSTRUCT:WORK`)).catch(async error=>{await info.attach('park-diagnostics',{body:JSON.stringify({park,changed,dataset:await f.host.evaluate(el=>({...((el as HTMLElement).dataset)}))},null,2),contentType:'application/json'});throw error;});
  expect(JSON.parse((await f.host.getAttribute('data-cinematic-state'))!)[0]).toMatchObject({fromStage:2,toStage:changed.stage,oldVisible:true,targetVisible:false});
  await page.screenshot({path:info.outputPath('park-old-ground-work.png')});await expect(f.host).toHaveAttribute('data-city-cinematics','0',{timeout:9000});
  await f.service.activateDistrict(f.user.countryId,f.task.districtId,crypto.randomUUID());
  await f.focus(f.task);await f.call('task.set_status',{taskId:f.task.id,status:'STARTED'});
  await expect(f.host).toHaveAttribute('data-cinematic-phases',new RegExp(`${f.task.id}:CONSTRUCT:CREW`));
  await f.call('task.delete',{taskId:f.task.id,confirmTitle:f.task.title});
  await expect(f.host).toHaveAttribute('data-cinematic-phases',new RegExp(`${f.task.id}:DEMOLISH:WORK`));
  expect(JSON.parse((await f.host.getAttribute('data-cinematic-state'))!)[0]).toMatchObject({kind:'DEMOLISH',fromStage:1,oldVisible:true});
  await expect(f.host).toHaveAttribute('data-city-cinematics','0',{timeout:9000});await expect(f.host).toHaveAttribute('data-cinematic-workers','0');
  expect((await f.service.listTasks(f.user.countryId)).some(task=>task.id===f.task.id)).toBe(false);
  await page.screenshot({path:info.outputPath('demolition-overrides-construction.png')});expect(errors).toEqual([]);
 }finally{await f.cleanup();}
});

test('native road captures cover every scene without adding standalone props or browser errors',async({page},info)=>{
 test.setTimeout(90000);await page.setViewportSize({width:1440,height:1100});await page.clock.install();const f=await fixture(page),kinds=new Set<string>(),errors:string[]=[],standalone:string[]=[];page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(/\/props\/[^/]+\.png/.test(request.url()))standalone.push(request.url());});
 try{
  await f.focus(f.task);
  for(let attempt=0;attempt<12&&kinds.size<5;attempt++){
   for(let advance=0;advance<4&&!(await f.host.getAttribute('data-road-event'));advance++){
    const now=Number(await f.host.getAttribute('data-road-event-server-now')),next=Number(await f.host.getAttribute('data-road-event-next-start'));
    await page.clock.fastForward(Math.max(100,next-now+300));await page.clock.runFor(100);
   }
   const kind=await f.host.getAttribute('data-road-event');if(!kind)continue;
   await page.clock.fastForward(4500);await page.clock.runFor(100);await page.screenshot({path:info.outputPath(`road-${kind.toLowerCase()}.png`)});kinds.add(kind);
   await page.clock.fastForward(20000);await page.clock.runFor(100);await expect(f.host).toHaveAttribute('data-road-closed-cells','0');
  }
  expect(kinds.size).toBe(5);expect(errors).toEqual([]);expect(standalone).toEqual([]);
 }finally{await f.cleanup();}
});

test('deleting cargo in flight demolishes the authoritative destination without reserving former lots',async({page},info)=>{
 test.setTimeout(90000);await page.setViewportSize({width:1440,height:1100});const f=await fixture(page);
 try{
  await f.focus(f.task);await f.call('task.set_status',{taskId:f.task.id,status:'STARTED'});await f.call('task.set_status',{taskId:f.task.id,status:'IN_PROGRESS',progress:40});
  await expect(f.host).toHaveAttribute('data-cinematic-phases',/CONSTRUCT:WORK/);await expect(f.host).toHaveAttribute('data-city-cinematics','0',{timeout:9000});
  const destination=(await f.service.listDistricts(f.user.countryId,f.city.id)).find(d=>d.status==='PLANNED')!;
  let current=await f.call('task.transfer',{taskId:f.task.id,targetDistrictId:destination.id});await expect(f.host).toHaveAttribute('data-cinematic-phases',/TRANSFER:CARRY/);await expect(f.host).toHaveAttribute('data-city-cinematics','0',{timeout:10000});await f.focus(current);
  const formerOrigin={...current.origin};current=await f.call('task.transfer',{taskId:f.task.id,targetDistrictId:f.task.districtId});await expect(f.host).toHaveAttribute('data-cinematic-phases',/TRANSFER:CARRY/);
  await f.call('task.delete',{taskId:current.id,confirmTitle:current.title});await expect(f.host).toHaveAttribute('data-cinematic-phases',/DEMOLISH:WORK/);
  expect(JSON.parse((await f.host.getAttribute('data-cinematic-state'))!)[0]).toMatchObject({kind:'DEMOLISH',oldVisible:true,aircraftVisible:false});
  await page.screenshot({path:info.outputPath('in-flight-delete-work.png')});await expect(f.host).toHaveAttribute('data-city-cinematics','0',{timeout:9000});
  const sites=(await f.service.listWorldFeatures(f.user.countryId)).filter(feature=>feature.siteMarker?.snapshot.taskNumber===current.taskNumber);
  expect(sites.filter(feature=>feature.siteMarker?.kind==='RELOCATED')).toHaveLength(0);expect(sites.some(site=>site.origin.x===formerOrigin.x&&site.origin.y===formerOrigin.y)).toBe(false);const ruined=sites.find(feature=>feature.siteMarker?.kind==='RUINED')!;
  expect(ruined.origin).toEqual(current.origin);await expect(f.host).toHaveAttribute('data-cinematic-workers','0');await page.screenshot({path:info.outputPath('in-flight-delete-final-sites.png')});
 }finally{await f.cleanup();}
});
