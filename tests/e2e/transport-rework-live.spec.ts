import {expect,test,type Page} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {openMapPlanet} from './map-navigation';
import {installSceneClock} from './city-scene-clock';
import {planCityAirServices,sampleCityAirService} from '../../src/shared/city-air-service';
import {planCityRailServices} from '../../src/shared/city-rail-service';
import {planCitySeaServices} from '../../src/shared/city-sea-service';
import {TRANSPORT_EPOCH} from '../../src/shared/transport-schedule';
import type {CitySceneDto} from '../../src/shared/city-scene-contract';
test.skip(process.env.E2E_TRANSPORT_REWORK!=='true','Owned local transport fixture');
function fixture(){
 expect(new URL(process.env.E2E_BASE_URL!).hostname).toMatch(/^(127\.0\.0\.1|localhost)$/);
 return JSON.parse(readFileSync('.builder/transport-rework-2026-10-09/functional-fixture.json','utf8')) as {schema:string;sites:{countryId:string;districtId:string;city:{id:string;name:string};terminals:{id:string;role:string}[]}[]};
}
async function entry(page:Page){
 const site=fixture().sites[0]!;
 expect((await page.request.post('/api/auth/login',{data:{email:'transport-qa@example.test',password:'tasktopia-transport-qa'}})).status()).toBe(200);
 expect((await page.request.post(`/api/countries/${site.countryId}/select`)).status()).toBe(200);
 await page.goto('/');await expect(page.locator('.planet-atlas')).toHaveAttribute('data-planet-ready','true',{timeout:20000});
 const target=page.locator(`.planet-city-targets [data-city-id="${site.city.id}"]`);await target.focus();await page.keyboard.press('Enter');
 const host=page.locator('.world-canvas');await expect(host).toHaveAttribute('data-city-scene-commit','atomic',{timeout:30000});await expect(host).toHaveAttribute('data-mobility-ready','true',{timeout:20000});
 return {site,host};
}
async function development(page:Page){await page.locator('.game-popover > summary').filter({hasText:'Фильтры'}).click();await page.getByRole('button',{name:'Развитие города',exact:true}).click();const panel=page.getByRole('complementary',{name:'Развитие города'});await expect(panel.getByRole('heading',{name:'Транспортные направления'})).toBeVisible();return panel;}
test('failed transport PNG leaves the city usable and retries successfully without another scene request',async({page})=>{
 let fail=true,attempts=0,scenes=0;const errors:string[]=[];
 page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(/\/cities\/[^/]+\/scene/.test(request.url()))scenes++;});
 await page.route('**/city-transport/locomotive-east.png',async route=>{attempts++;if(fail)await route.fulfill({status:503,body:'Local QA asset failure'});else await route.continue();});
 const {host}=await entry(page);await expect(host).toHaveAttribute('data-city-train','error');
 const alert=page.getByRole('alert').filter({hasText:'Не удалось загрузить транспорт'});await expect(alert).toBeVisible();
 expect(scenes).toBe(1);fail=false;await alert.getByRole('button',{name:'Повторить загрузку транспорта'}).click();
 await expect(host).toHaveAttribute('data-city-train','running');await expect(alert).toHaveCount(0);expect(attempts).toBeGreaterThan(1);expect(scenes).toBe(1);expect(errors).toEqual([]);
});
test('economy reduced motion reload and inactive planet preserve actual routes and bounded residents',async({page},info)=>{
 test.setTimeout(90000);const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>localStorage.setItem('tasktopia:world-preferences:v1',JSON.stringify({quality:'ECONOMY',reduceMotion:true})));
 await page.clock.setFixedTime(new Date('2035-01-01T00:00:00Z'));
 const {host}=await entry(page);await expect(host).toHaveAttribute('data-animation-active','false');await expect(host).toHaveAttribute('data-frame-limit','30');
 const vehicles=(await host.getAttribute('data-city-train-vehicles'))?.split(',').filter(Boolean)??[];expect(vehicles.length).toBeLessThanOrEqual(1);
 const fleet=await host.getAttribute('data-city-train-fleet'),routeIds=await host.getAttribute('data-airport-flight-routes');
 const passengers=JSON.parse((await host.getAttribute('data-transport-passengers'))!);expect(passengers.carried+passengers.waiting).toBeLessThanOrEqual(4);
 const panel=await development(page);await expect(panel.locator('[data-transport-route]').first()).toBeVisible();
 await page.screenshot({path:info.outputPath('economy-reduced.png')});await page.reload();
 await expect(page.locator('.planet-atlas')).toHaveAttribute('data-planet-ready','true',{timeout:20000});
 const target=page.locator(`.planet-city-targets [data-city-id="${fixture().sites[0]!.city.id}"]`);await target.focus();await page.keyboard.press('Enter');
 await expect(host).toHaveAttribute('data-city-scene-commit','atomic');await expect(host).toHaveAttribute('data-city-train-fleet',fleet!);await expect(host).toHaveAttribute('data-airport-flight-routes',routeIds!);await expect(host).toHaveAttribute('data-animation-active','false');
 await openMapPlanet(page);await expect(host).toHaveAttribute('data-map-active','false');expect(errors).toEqual([]);
});
for(const stage of [1,2,3,4,5] as const)test(`native terminal render boundary respects all five stages ${stage}`,async({page},info)=>{
 test.setTimeout(90000);const loaded=new Set<string>();let airportNumber=0;
 page.on('response',response=>{if(response.ok())loaded.add(new URL(response.url()).pathname);});
 await page.route('**/api/countries/*/cities/*/scene',async route=>{
  const response=await route.fetch(),scene=await response.json() as CitySceneDto;
  for(const task of [...scene.chunks.flatMap(chunk=>chunk.tasks),...scene.completedDistrictSnapshots.flatMap(snapshot=>snapshot.tasks)])if(['AIRPORT','RAILWAY','PORT'].includes(task.serviceRole??'')){task.stage=stage;task.status=stage===5?'COMPLETED':'IN_PROGRESS';if(task.serviceRole==='AIRPORT')airportNumber=task.taskNumber;}
  if(scene.railway)scene.railway={...scene.railway,stage,running:stage===5};scene.airports=scene.airports?.map(site=>({...site,stage}));scene.ports=scene.ports?.map(port=>({...port,stage}));
  await route.fulfill({response,json:scene});
 });
 const {host}=await entry(page);await expect(host).toHaveAttribute('data-city-railway-stage',String(stage));await expect(host).toHaveAttribute('data-city-port-stages',String(stage));await expect(host).toHaveAttribute('data-city-train',stage===5?'running':'none');
 if(stage>=3)for(const family of ['airport','railway'])expect([...loaded].some(path=>new RegExp(`/compact-${family}(?:-row)?-v1/stage-${stage}\\.png$`).test(path)),family).toBe(true);
 expect(airportNumber).toBeGreaterThan(0);await page.getByLabel('Поиск здания по номеру или названию').fill(String(airportNumber));await page.getByRole('option').filter({hasText:`#${airportNumber}`}).click();await page.getByRole('button',{name:'Закрыть',exact:true}).click();
 const box=(await host.boundingBox())!;await page.mouse.move(box.x+box.width/2,box.y+box.height/2);for(let i=0;i<8;i++)await page.mouse.wheel(0,-300);await expect.poll(async()=>Number(await host.getAttribute('data-render-scale'))).toBe(4);
 await page.mouse.move(20,20);await page.screenshot({path:info.outputPath(`native-airport-stage-${stage}.png`)});
});
for(const viewport of [{width:1440,height:1000},{width:1440,height:1100},{width:390,height:844}])test(`ready real air rail sea, route navigation and native presentation ${viewport.width}x${viewport.height}`,async({page},info)=>{
 test.setTimeout(90000);await page.setViewportSize(viewport);const errors:string[]=[],requests:string[]=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(new URL(r.url()).pathname));
 page.on('console',message=>{if(['error','warning'].includes(message.type())&&/WebGL.*(?:INVALID_OPERATION|INVALID_VALUE|OUT_OF_MEMORY|error)|passive event listener|PixiJS Deprecation/i.test(message.text()))errors.push(message.text());});
 const {site,host}=await entry(page);
 await expect(host).toHaveAttribute('data-city-train','running');await expect(host).toHaveAttribute('data-city-train-wagons','5');
 await expect(host).toHaveAttribute('data-city-airfields','1');expect(Number(await host.getAttribute('data-airport-flight-fleet'))).toBeGreaterThanOrEqual(2);expect(Number(await host.getAttribute('data-city-ship-fleet'))).toBeGreaterThanOrEqual(2);
 expect(requests.filter(path=>path.endsWith(`/cities/${site.city.id}/scene`))).toHaveLength(1);
 expect(requests.some(path=>path.startsWith('/api/world/viewport')||path.startsWith('/api/chunks/'))).toBe(false);
 for(const title of ['Железная дорога','Авиарейсы','Морские рейсы']){
  const panel=await development(page),line=panel.locator('li').filter({has:page.getByText(title,{exact:true})});
  await expect(line.locator('[data-departure-seconds]').first()).toBeVisible();
  const route=line.locator('[data-transport-route]').first(),id=(await route.getAttribute('data-transport-route'))!;
  await route.getByRole('button',{name:'Показать направление'}).click();await expect(host).toHaveAttribute('data-selected-transport-route',id);
  await expect(host).toHaveAttribute('data-camera-padding-visible-untextured','0');
  await page.mouse.move(20,20);await page.screenshot({path:info.outputPath(`${title}.png`)});
  await development(page);await route.getByRole('button',{name:'Скрыть направление'}).click();await expect(host).toHaveAttribute('data-selected-transport-route','');
 }
 const oldCity=await page.locator('.header-city').innerText();
 const panel=await development(page),destination=panel.getByRole('button',{name:/Открыть город/}).first();await destination.click();
 await expect(page.locator('.map-level-transition')).toHaveCount(0,{timeout:20000});
 await expect(host).toHaveAttribute('data-city-scene-commit','atomic');await expect(page.locator('.header-city')).not.toHaveText(oldCity);
 await openMapPlanet(page);await expect(page.locator('.planet-atlas')).toHaveAttribute('data-planet-ready','true');await page.screenshot({path:info.outputPath('planet.png')});
 expect(errors).toEqual([]);
});
test('touch transport route cards fit portrait and landscape with native DPR',async({page},info)=>{
 test.skip(!info.project.name.startsWith('transport-mobile-'),'Dedicated touch emulation');test.setTimeout(90000);
 await page.addInitScript(()=>{window.addEventListener('touchstart',()=>document.documentElement.dataset.qaTouch='true',true);window.addEventListener('pointerdown',event=>{if(event.pointerType==='touch')document.documentElement.dataset.qaTouch='true';},true);});
 const {host}=await entry(page),errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 expect(info.project.use.hasTouch).toBe(true);expect(await page.evaluate(()=>devicePixelRatio)).toBeGreaterThanOrEqual(2);
 for(const viewport of [{width:390,height:844},{width:844,height:390}]){
  await page.setViewportSize(viewport);await expect(host).toHaveAttribute('data-city-scene-commit','atomic');
  const panel=await development(page),route=panel.locator('[data-transport-route]').first();
  const id=(await route.getAttribute('data-transport-route'))!,button=route.getByRole('button',{name:'Показать направление'});await button.scrollIntoViewIfNeeded();
  const bounds=(await panel.boundingBox())!;expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThanOrEqual(viewport.width);
  await button.tap();await expect(host).toHaveAttribute('data-selected-transport-route',id);
  await expect(page.locator('html')).toHaveAttribute('data-qa-touch','true');
  await expect(host).toHaveAttribute('data-camera-padding-visible-untextured','0');await page.screenshot({path:info.outputPath(`touch-${viewport.width}x${viewport.height}.png`)});
  await development(page);await route.getByRole('button',{name:'Скрыть направление'}).tap();await expect(host).toHaveAttribute('data-selected-transport-route','');
 }
 expect(errors).toEqual([]);
});
test('all seven air phases use the real ready site and passengers board then alight on its continuous clock',async({page},info)=>{
 test.setTimeout(180000);await installSceneClock(page);const site=fixture().sites[0]!;
 await page.request.post('/api/auth/login',{data:{email:'transport-qa@example.test',password:'tasktopia-transport-qa'}});
 const scene=await(await page.request.get(`/api/countries/${site.countryId}/cities/${site.city.id}/scene`)).json() as CitySceneDto;
 const plan=planCityAirServices(scene)[0]!;expect(plan).toBeTruthy();
 const origin=TRANSPORT_EPOCH-plan.schedule.offsetMs+(plan.airport.taskId===plan.schedule.fromId?0:plan.schedule.dwellMs+plan.schedule.travelMs);
 // Actual domain scene and assets; only the authoritative time header is pinned.
 await page.route('**/api/**',async route=>{const response=await route.fetch();await route.fulfill({response,headers:{...response.headers(),'x-tasktopia-server-time':String(origin)}});});
 const {host}=await entry(page);await page.unrouteAll({behavior:'wait'});
 for(const [elapsed,phase] of [[5_000,'GATE'],[27_000,'TAXI_OUT'],[34_000,'TAKEOFF'],[40_000,'FLYING'],[190_000,'LANDING'],[195_000,'TAXI_IN'],[203_000,'GATE']] as const){
  const now=origin+elapsed,expected=sampleCityAirService(plan,now);expect(expected.phase).toBe(phase);
  const sampled=Number(await host.getAttribute('data-airplane-sampled-at'));
  const delta=Math.max(0,now-sampled);
  if(delta>30_000){await page.clock.fastForward(delta-6_000);await page.clock.runFor(6_000);}else await page.clock.runFor(delta);
  await expect(host).toHaveAttribute('data-airplane-phase',phase);
  expect(sampleCityAirService(plan,Number(await host.getAttribute('data-airplane-sampled-at'))).phase).toBe(phase);
  await page.screenshot({path:info.outputPath(`air-${phase}-${elapsed}.png`)});
 }
 expect(JSON.parse((await host.getAttribute('data-transport-passengers'))!).boarded).toBeGreaterThan(0);
 expect(JSON.parse((await host.getAttribute('data-transport-passengers'))!).alighted).toBeGreaterThan(0);
 await page.clock.runFor(5_000);
 const flows=JSON.parse((await host.getAttribute('data-transport-passengers'))!).flows.AIR;
 expect(flows.boarded).toBeGreaterThan(0);expect(flows.alighted).toBeGreaterThan(0);
});

for(const kind of ['RAIL','SEA'] as const)test(`real ${kind} passengers complete boarding travel arrival and alighting`,async({page},info)=>{
 test.setTimeout(120000);await installSceneClock(page);const site=fixture().sites[0]!;
 await page.request.post('/api/auth/login',{data:{email:'transport-qa@example.test',password:'tasktopia-transport-qa'}});
 const scene=await(await page.request.get(`/api/countries/${site.countryId}/cities/${site.city.id}/scene`)).json() as CitySceneDto;
 const plan=kind==='RAIL'?planCityRailServices(scene.railway!,scene.railConnections??[])[0]!:planCitySeaServices(scene.ports??[],scene.seaConnections??[])[0]!;
 const stopId=kind==='RAIL'?scene.railway!.stationId:scene.ports![0]!.taskId;
 const origin=TRANSPORT_EPOCH-plan.schedule.offsetMs+(stopId===plan.schedule.fromId?0:plan.schedule.dwellMs+plan.schedule.travelMs);
 await page.route('**/api/**',async route=>{const response=await route.fetch();await route.fulfill({response,headers:{...response.headers(),'x-tasktopia-server-time':String(origin)}});});
 const {host}=await entry(page);
 const panel=await development(page),line=panel.locator('li').filter({has:page.getByText(kind==='RAIL'?'Железная дорога':'Морские рейсы',{exact:true})});
 await line.getByRole('button',{name:'Показать направление'}).first().click();
 await page.unrouteAll({behavior:'wait'});
 await page.clock.runFor(plan.schedule.dwellMs);
 const metrics=async()=>JSON.parse((await host.getAttribute('data-transport-passengers'))!);
 expect((await metrics()).flows[kind].boarded).toBeGreaterThan(0);
 await page.screenshot({path:info.outputPath(`${kind}-departed.png`)});
 const sampled=Number(await host.getAttribute('data-airplane-sampled-at'));
 const arrival=origin+2*(plan.schedule.dwellMs+plan.schedule.travelMs);
 await page.clock.fastForward(Math.max(0,arrival-sampled-6_000));await page.clock.runFor(6_000+plan.schedule.dwellMs*.4);
 expect((await metrics()).flows[kind].alighted).toBeGreaterThan(0);
 await page.screenshot({path:info.outputPath(`${kind}-alighted.png`)});
});

test('two live clients receive MCP rework completion deletion and idempotent transport changes over WebSocket',async({page,browser})=>{
 test.setTimeout(120000);
 const {createDb}=await import('../../src/server/db'),{AppService}=await import('../../src/server/app-service');
 const {synchronizeCityBlocks}=await import('../../src/server/world/active-block-layout');
 const {synchronizeCountryTransportNetworks,readCountryTransportNetworks}=await import('../../src/server/world/country-transport-network-store');
 const {Client,StreamableHTTPClientTransport}=await import('@modelcontextprotocol/client');
 const f=fixture(),url=new URL(readFileSync('.builder/transport-rework-2026-10-09/functional-db-url','utf8'));
 expect(url.hostname).toMatch(/^(127\.0\.0\.1|localhost)$/);expect(url.port).toBe('55433');expect(url.pathname).toBe('/tasktopia_test');expect(f.schema).toMatch(/^transport_qa_[a-f0-9]{32}$/);expect(url.searchParams.get('options')).toBe(`-csearch_path=${f.schema}`);
 const db=await createDb(url.toString(),{migrate:false}),service=new AppService(db);
 const targets:Array<{countryId:string;cityId:string;terminal:{id:string;role:string}}>=[];
 // A partial destructive QA run may have consumed one peer. Every mode still
 // needs a real remaining peer; never skip a mode after a failed run.
 for(const role of ['AIRPORT','RAILWAY','PORT']){
  for(const site of f.sites.slice(1)){
   const terminal=site.terminals.find(terminal=>terminal.role===role);
   if(terminal&&await db.prepare('SELECT id FROM tasks_v3 WHERE id=?').get(terminal.id)){targets.push({countryId:site.countryId,cityId:site.city.id,terminal});break;}
  }
 }
 expect(targets.map(target=>target.terminal.role)).toEqual(['AIRPORT','RAILWAY','PORT']);
 const {transaction}=await import('../../src/server/db');
 await transaction(db,async()=>{
  for(const target of targets)await db.prepare("UPDATE tasks_v3 SET status='TESTING',progress=80 WHERE id=?").run(target.terminal.id);
  for(const target of targets)await synchronizeCityBlocks(db,target.countryId,target.cityId);
  for(const countryId of new Set(targets.map(target=>target.countryId))){await synchronizeCountryTransportNetworks(db,countryId,await readCountryTransportNetworks(db,countryId));await db.prepare('UPDATE countries SET world_version=world_version+1 WHERE id=?').run(countryId);}
 });
 const context=await browser.newContext({baseURL:process.env.E2E_BASE_URL}),second=await context.newPage();
 const errors:string[]=[];for(const p of [page,second])p.on('pageerror',e=>errors.push(e.message));
 const sceneRequests=[0,0];[page,second].forEach((p,i)=>p.on('request',r=>{if(r.url().includes('/cities/')&&r.url().includes('/scene'))sceneRequests[i]!++;}));
 const lastScenes:Array<CitySceneDto|undefined>=[];
 [page,second].forEach((p,i)=>p.on('response',async response=>{if(response.ok()&&new URL(response.url()).pathname.endsWith(`/cities/${f.sites[0]!.city.id}/scene`))lastScenes[i]=await response.json() as CitySceneDto;}));
 const client=new Client({name:'transport-rework-local-qa',version:'1.0.0'});let token:{id:string;token:string}|undefined;
 try{
  await entry(page);await entry(second);
  token=await(await page.request.post('/api/tokens',{data:{name:'Transport live QA',scopes:['tasks:read','tasks:write','districts:write'],expiresInDays:30}})).json();
  await client.connect(new StreamableHTTPClientTransport(new URL('/mcp',process.env.E2E_BASE_URL),{requestInit:{headers:{Authorization:`Bearer ${token!.token}`}}}));
  for(const {countryId,terminal} of targets){
   const call=async(name:string,args:Record<string,unknown>,key=crypto.randomUUID())=>{const result=await client.callTool({name,arguments:{countryId,idempotencyKey:key,...args}});expect(result.isError,JSON.stringify(result.content)).not.toBe(true);};
   const districtId=(await service.getTask(countryId,terminal.id)).districtId;
   await call('district.activate',{districtId});
   const before=[...sceneRequests];
   await call('task.set_status',{taskId:terminal.id,status:'IN_PROGRESS',progress:40,comment:'Возврат из тестирования'});
   await call('task.set_status',{taskId:terminal.id,status:'TESTING',comment:'Повторная проверка'});
   const key=crypto.randomUUID();await call('task.set_status',{taskId:terminal.id,status:'COMPLETED',comment:'Терминал готов'},key);
   for(let i=0;i<2;i++)await expect.poll(()=>sceneRequests[i]).toBeGreaterThan(before[i]!);
   const connected=await service.getCitySceneForUser(fixtureUserId(),f.sites[0]!.countryId,f.sites[0]!.city.id);
   expect(hasTerminal(connected,terminal.id)).toBe(true);
   for(let i=0;i<2;i++)await expect.poll(()=>lastScenes[i]&&hasTerminal(lastScenes[i]!,terminal.id)).toBe(true);
   const events=(await service.listEvents(countryId)).length;
   await call('task.set_status',{taskId:terminal.id,status:'COMPLETED',comment:'Терминал готов'},key);expect((await service.listEvents(countryId)).length).toBe(events);
   const task=await service.getTask(countryId,terminal.id);const beforeDelete=[...sceneRequests];
   await call('task.delete',{taskId:terminal.id,confirmTitle:task.title});
   for(let i=0;i<2;i++)await expect.poll(()=>sceneRequests[i]).toBeGreaterThan(beforeDelete[i]!);
   expect(hasTerminal(await service.getCitySceneForUser(fixtureUserId(),f.sites[0]!.countryId,f.sites[0]!.city.id),terminal.id)).toBe(false);
   for(let i=0;i<2;i++)await expect.poll(()=>lastScenes[i]&&hasTerminal(lastScenes[i]!,terminal.id)).toBe(false);
  }
  expect(errors).toEqual([]);
 }finally{await client.close();if(token)await page.request.delete(`/api/tokens/${token.id}`);await context.close();await db.close();}
});
function fixtureUserId(){return JSON.parse(readFileSync('.builder/transport-rework-2026-10-09/functional-fixture.json','utf8')).userId as string;}
function hasTerminal(scene:CitySceneDto,id:string){return scene.airportConnections.some(r=>r.from.taskId===id||r.to.taskId===id)||!!scene.railConnections?.some(r=>r.fromStationId===id||r.toStationId===id)||!!scene.seaConnections?.some(r=>r.fromPortId===id||r.toPortId===id);}
