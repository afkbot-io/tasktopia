import { expect,test,type Page } from "@playwright/test";
import type { CitySceneDto } from "../../src/shared/city-scene-contract";
import type { BootstrapDto,RealtimeEvent } from "../../src/shared/contracts";
import { chunkPayloadContentHash } from "../../src/server/world/chunk-payload-hash";
import { openMapCity } from "./map-navigation";
import { installCityPreparationDiagnostics, attachCityPreparationFailure } from "./city-preparation-diagnostics";
import { installCooperativeYieldGate, type CooperativeYieldGateWindow } from './cooperative-yield-gate';

// Сохраняем вызовы, сеть, исходники и итоговый PNG. Повторные автоматические
// снимки canvas не являются частью проверяемой работы города.
test.use({ trace: { mode: 'retain-on-failure', snapshots: false, screenshots: false, sources: true } });
test.beforeEach(async ({ page }) => { await installCityPreparationDiagnostics(page); });
test.afterEach(async ({ page }, info) => { await attachCityPreparationFailure(page, info); });

// Follow the visible desktop/mobile navigation instead of addressing hidden tools.
async function openWorldPreferences(page:Page,hasTouch:boolean,keyboardDesktop=false){
  const activate=async(trigger:ReturnType<Page["locator"]>)=>{
    if(hasTouch)await trigger.tap();
    else if(keyboardDesktop){await trigger.focus();await trigger.press("Enter");}
    else await trigger.click();
  };
  let preferences=page.locator(".map-toolbar-actions > nav > .world-preferences");
  if(!await preferences.isVisible()){
    const menu=page.locator(".world-menu");
    if(await menu.getAttribute("open")===null){
      const trigger=menu.locator(":scope > summary");
      await activate(trigger);
    }
    preferences=menu.locator(".mobile-menu-tools .world-preferences");
  }
  await expect(preferences).toBeVisible();
  if(await preferences.getAttribute("open")===null){
    const trigger=preferences.locator(":scope > summary");
    await activate(trigger);
  }
  await expect(preferences.getByLabel("Детализация")).toBeVisible();
  return preferences;
}

async function enterCity(page:Page) {
  await page.addInitScript(() => {
    const NativeSocket=window.WebSocket,sockets=new Set<WebSocket>();
    window.WebSocket=class extends NativeSocket {
      constructor(url:string|URL,protocols?:string|string[]){super(url,protocols);if(String(url).includes("/socket.io")){sockets.add(this);this.addEventListener("close",()=>sockets.delete(this));}}
    };
    Object.assign(window,{qaDisconnectWorld:()=>{for(const socket of sockets)socket.close();},
      qaWorldSockets:()=>[...sockets].filter(socket=>socket.readyState===NativeSocket.OPEN).length,
      qaWorldFrame:(event:unknown)=>{for(const socket of sockets)if(socket.readyState===NativeSocket.OPEN)
        socket.dispatchEvent(new MessageEvent("message",{data:`42${JSON.stringify(["world:event",event])}`}));}});
    localStorage.setItem("tasktopia:world-preferences:v2",JSON.stringify({quality:"NORMAL",cityLife:true,sound:false}));
  });
  expect((await page.request.post("/api/auth/login",{data:{email:process.env.E2E_CITY_EMAIL??"demo@tasktopia.local",password:process.env.E2E_CITY_PASSWORD??"tasktopia-demo"}})).status()).toBe(200);
  await page.goto("/");await openMapCity(page);
  const host=page.locator(".world-canvas");
  await expect(host).toHaveAttribute("data-city-scene-commit","atomic",{timeout:30_000});
  await expect(host).toHaveAttribute("data-loading","false");
  return host;
}

test("a hung authoritative refresh expires without destroying the city and a real retry recovers",async({page})=>{
  test.setTimeout(90_000);
  let reads=0,hold=false,release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  await page.route("**/api/countries/*/cities/*/scene",async route=>{
    reads++;
    if(hold)await gate;
    if(route.request().failure())return;
    await route.continue().catch(()=>undefined);
  });
  const host=await enterCity(page);
  const identity=await host.locator("canvas").elementHandle();
  hold=true;
  await page.evaluate(()=>(window as unknown as {qaDisconnectWorld():void}).qaDisconnectWorld());
  await expect.poll(()=>reads,{timeout:20_000}).toBeGreaterThan(1);
  await expect(page.getByRole("alert")).toContainText("Не удалось обновить город",{timeout:25_000});
  expect(await identity!.evaluate(node=>node.isConnected)).toBe(true);
  await expect(host).toHaveAttribute("data-city-scene-commit","atomic");
  hold=false;release();
  const beforeRetry=reads;
  await page.getByRole("alert").getByRole("button",{name:"Повторить",exact:true}).click();
  await expect.poll(()=>reads).toBeGreaterThan(beforeRetry);
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(await identity!.evaluate(node=>node.isConnected)).toBe(true);
});

test("a movement timeout keeps its native retry after a same-range camera pan",async({page},info)=>{
 test.setTimeout(90_000);
 const errors:string[]=[],movementErrors:string[]=[],reads:string[]=[];
 page.on("pageerror",error=>errors.push(error.message));
 page.on("console",message=>{if(message.type()==="error"&&message.text().startsWith("City movement preparation failed"))movementErrors.push(message.text());});
 page.on("request",request=>{const path=new URL(request.url()).pathname;if(/\/scene$|\/world\/viewport|\/chunks\//.test(path))reads.push(path);});
 await page.clock.install();
 await installCooperativeYieldGate(page,{phase:'movement',armInitially:false,firstOnly:true});
 let releaseAmbient!:()=>void;
 const ambientGate=new Promise<void>(resolve=>{releaseAmbient=resolve;});
 await page.route("**/micro-ambient/**",async route=>{await ambientGate;await route.continue().catch(()=>undefined);});
 try{
   const host=await enterCity(page),canvas=host.getByLabel("Интерактивная карта города"),identity=await canvas.elementHandle();
   await expect(host).toHaveAttribute("data-ground-bake-queue","0");
   await expect(host).not.toHaveAttribute("data-ambient-assets","ready");
   // Find two real camera positions in one already prepared chunk range.
   // Returning between these positions cannot legitimately rebuild movement.
   let sameRange:string|null=null;
   for(let step=0;step<4&&sameRange===null;step++){
     const range=await host.getAttribute("data-chunk-range"),x=await host.getAttribute("data-camera-world-x"),skipped=Number(await host.getAttribute("data-skipped-reconciles")??0);
     await canvas.focus();await page.keyboard.press("ArrowRight");
     await expect.poll(()=>host.getAttribute("data-camera-world-x")).not.toBe(x);
     await expect.poll(async()=>Number(await host.getAttribute("data-skipped-reconciles")??0)>skipped||await host.getAttribute("data-chunk-range")!==range).toBe(true);
     await expect(host).toHaveAttribute("data-camera-presentation-pending","false");
     await expect(host).toHaveAttribute("data-loading","false");
     if(await host.getAttribute("data-chunk-range")===range&&Number(await host.getAttribute("data-skipped-reconciles")??0)>skipped)sameRange=range;
   }
   expect(sameRange,"A native pan must have two positions inside the same prepared range").not.toBeNull();
   await expect(host).toHaveAttribute("data-ground-bake-queue","0");
   // Pause while sprites are gated, then arm only the next movement channel.
   // Existing React channels and all later preparations keep native delivery.
   await page.clock.pauseAt(await page.evaluate(()=>Date.now()+100));
   await page.evaluate(()=>(window as unknown as CooperativeYieldGateWindow).qaCooperativeYield.arm());
   releaseAmbient();await expect(host).toHaveAttribute("data-ambient-assets","ready");
   await page.clock.runFor(16);
   await expect.poll(()=>page.evaluate(()=>{
     const {captured,held}=(window as unknown as CooperativeYieldGateWindow).qaCooperativeYield.state();return {captured,held};
   })).toEqual({captured:true,held:1});
   await expect(host).toHaveAttribute("data-movement-preparing","true");
   await expect(host).not.toHaveAttribute("data-mobility-ready","true");
   await page.clock.fastForward(20_000);
   const failure=page.getByRole("alert").filter({hasText:"Не удалось подготовить движение в городе"});
   await expect(failure).toBeVisible();await expect(failure.getByRole("button",{name:"Повторить",exact:true})).toBeVisible();
   await expect(host).toHaveAttribute("data-movement-preparing","false");
   expect(movementErrors).toHaveLength(1);
   const before={x:await host.getAttribute("data-camera-world-x"),skipped:Number(await host.getAttribute("data-skipped-reconciles")??0)};
   await page.clock.resume();await canvas.focus();await page.keyboard.press("ArrowLeft");
   await expect.poll(()=>host.getAttribute("data-camera-world-x")).not.toBe(before.x);
   await expect.poll(async()=>Number(await host.getAttribute("data-skipped-reconciles")??0)).toBeGreaterThan(before.skipped);
   await expect(host).toHaveAttribute("data-chunk-range",sameRange!);
   await expect(host).toHaveAttribute("data-loading","false");
   await info.attach("movement-timeout-after-pan",{body:JSON.stringify({before,failureVisible:await failure.isVisible(),after:await host.evaluate(node=>({...((node as HTMLElement).dataset)}))}),contentType:"application/json"});
   await page.screenshot({path:info.outputPath("movement-timeout-after-pan.png")});
   const layout=await failure.evaluate(alert=>{
     const rect=(node:Element)=>{const r=node.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom};};
     const retry=alert.querySelector<HTMLButtonElement>('button')!,wrap=alert.closest('.world-canvas-wrap')!,world=wrap.querySelector('.world-canvas')!,tour=wrap.querySelector('.city-world-tour-trigger')!;
     return {alert:rect(alert),retry:rect(retry),world:rect(world),tour:rect(tour),retryClientWidth:retry.clientWidth,retryScrollWidth:retry.scrollWidth};
   });
   await info.attach("movement-timeout-layout",{body:JSON.stringify(layout),contentType:"application/json"});
   expect(layout.retryScrollWidth,"The complete retry label must fit inside its button").toBeLessThanOrEqual(layout.retryClientWidth+1);
   for(const edge of ['left','top'] as const){expect(layout.alert[edge]).toBeGreaterThanOrEqual(layout.world[edge]-1);expect(layout.retry[edge]).toBeGreaterThanOrEqual(layout.alert[edge]-1);}
   for(const edge of ['right','bottom'] as const){expect(layout.alert[edge]).toBeLessThanOrEqual(layout.world[edge]+1);expect(layout.retry[edge]).toBeLessThanOrEqual(layout.alert[edge]+1);}
   const overlapsTour=layout.alert.left<layout.tour.right&&layout.alert.right>layout.tour.left&&layout.alert.top<layout.tour.bottom&&layout.alert.bottom>layout.tour.top;
   expect(overlapsTour,"The city tour trigger must not obscure the error message").toBe(false);
   await expect(failure).toBeVisible();
   await expect(host).not.toHaveAttribute("data-mobility-ready","true");
   await page.evaluate(()=>(window as unknown as CooperativeYieldGateWindow).qaCooperativeYield.release());
   await failure.getByRole("button",{name:"Повторить",exact:true}).click();
   await expect(host).toHaveAttribute("data-mobility-ready","true",{timeout:30_000});
   await expect(host).toHaveAttribute("data-walk-network-builds","1");await expect(failure).toHaveCount(0);
   expect(await identity!.evaluate(node=>node===document.querySelector(".world-canvas canvas"))).toBe(true);
   expect(reads.filter(path=>path.endsWith("/scene"))).toHaveLength(1);expect(reads.filter(path=>/\/world\/viewport|\/chunks\//.test(path))).toEqual([]);
   expect(errors).toEqual([]);expect(movementErrors).toHaveLength(1);
   await info.attach("movement-timeout-retry",{body:JSON.stringify({before,after:await host.evaluate(node=>({...((node as HTMLElement).dataset)})),movementErrors,reads}),contentType:"application/json"});
 }finally{
   releaseAmbient();await page.clock.resume().catch(()=>undefined);
   await page.evaluate(()=>(window as unknown as CooperativeYieldGateWindow).qaCooperativeYield?.release()).catch(()=>undefined);
 }
});

test("same render content advances publication fences without decoding, rebaking or recompiling paths",async({page})=>{
  test.setTimeout(90_000);
  let captured:CitySceneDto|undefined,promote=false;
  await page.route("**/api/countries/*/cities/*/scene",async route=>{
    const response=await route.fetch({headers:{...route.request().headers(),"accept-encoding":"identity"}});
    const next=await response.json() as CitySceneDto;
    if(!captured)captured=next;
    if(promote){next.sceneRevision+="-publication-only";next.chunks=next.chunks.map(chunk=>({...chunk,publishedVersion:chunk.publishedVersion+1}));}
    await route.fulfill({response,json:next});
  });
  const host=await enterCity(page);
  await expect(host).toHaveAttribute("data-mobility-ready","true");
  const counters=()=>host.evaluate(node=>{
    const d=(node as HTMLElement).dataset;
    return {ground:d.groundRebuilds,walk:d.walkNetworkBuilds,life:d.everydayCompiles,decode:d.chunkMaterializeSamples};
  });
  const before=await counters();promote=true;
  await page.evaluate(()=>(window as unknown as {qaDisconnectWorld():void}).qaDisconnectWorld());
  await expect(host).toHaveAttribute("data-city-scene-revision",/-publication-only$/,{timeout:20_000});
  await expect.poll(counters).toEqual(before);
});

test("a quality change keeps the pending physical preparation and adopts the latest population limits",async({page,hasTouch},info)=>{
 const errors:string[]=[],movementErrors:string[]=[],reads:string[]=[];
 page.on("pageerror",error=>errors.push(error.message));
 page.on("console",message=>{if(message.type()==="error"&&message.text().startsWith("City movement preparation failed"))movementErrors.push(message.text());});
 page.on("request",request=>{const path=new URL(request.url()).pathname;if(/\/scene$|\/world\/viewport|\/chunks\//.test(path))reads.push(path);});
 await page.clock.install();
 await installCooperativeYieldGate(page,{phase:'movement',armInitially:false,firstOnly:true});
 let releaseAmbient!:()=>void;
 const ambientGate=new Promise<void>(resolve=>{releaseAmbient=resolve;});
 await page.route("**/micro-ambient/**",async route=>{await ambientGate;await route.continue().catch(()=>undefined);});
 try{
   const host=await enterCity(page),identity=await host.locator("canvas").elementHandle();
   await expect(host).toHaveAttribute("data-ground-bake-queue","0");
   await expect(host).toHaveAttribute("data-world-quality","NORMAL");
   await expect(host).not.toHaveAttribute("data-ambient-assets","ready");
   const canonical=await host.getAttribute("data-canonical-task-count");
   // This test holds PNG requests while the physical owner is arranged.
   // Keyboard activation avoids WebKit pointer stability waiting on virtual
   // animation frames until the unchanged image deadline has already expired.
   const preferences=await openWorldPreferences(page,hasTouch,true);
   await expect(preferences.getByLabel("Детализация")).toHaveValue("NORMAL");
   // The gate, rather than elapsed renderer time, keeps this exact owner
   // pending while the user changes quality. Its real deadline is not extended.
   await page.clock.pauseAt(await page.evaluate(()=>Date.now()+100));
   await page.evaluate(()=>(window as unknown as CooperativeYieldGateWindow).qaCooperativeYield.arm());
   releaseAmbient();await expect(host).toHaveAttribute("data-ambient-assets","ready");
   await page.clock.runFor(16);
   await expect.poll(()=>page.evaluate(()=>{
     const {captured,held,channels}=(window as unknown as CooperativeYieldGateWindow).qaCooperativeYield.state();
     return {captured,held,channels};
   })).toEqual({captured:true,held:1,channels:1});
   await expect(host).toHaveAttribute("data-movement-preparing","true");
   await expect(host).not.toHaveAttribute("data-mobility-ready","true");
   await preferences.getByLabel("Детализация").selectOption("ECONOMY");
   await expect(host).toHaveAttribute("data-world-quality","ECONOMY");
   await page.clock.runFor(16);
   const pending=await page.evaluate(()=>(window as unknown as CooperativeYieldGateWindow).qaCooperativeYield.state());
   await info.attach("quality-change-pending-owner",{body:JSON.stringify({pending,dataset:await host.evaluate(node=>({...((node as HTMLElement).dataset)}))}),contentType:"application/json"});
   expect(pending.firstStack).toContain("yieldTask");
   expect(pending.transport).toBe(pending.nativeAvailable?'scheduler':'message-channel');
   expect({channels:pending.channels,firstClosed:pending.firstClosed,held:pending.held},"Quality must retain the first pending physical owner before its native yield is released")
     .toEqual({channels:1,firstClosed:pending.transport==='message-channel'?false:null,held:1});
   await expect(host).not.toHaveAttribute("data-mobility-ready","true");
   await page.evaluate(()=>(window as unknown as CooperativeYieldGateWindow).qaCooperativeYield.release());
   await page.clock.resume();
   await expect(host).toHaveAttribute("data-mobility-ready","true",{timeout:15_000});
   await expect(host).toHaveAttribute("data-movement-preparing","false");
   await expect(host).toHaveAttribute("data-walk-network-builds","1");
   await expect(host).toHaveAttribute("data-mobility-network-builds","1");
   expect(Number(await host.getAttribute("data-cars"))).toBeGreaterThan(0);
   expect(Number(await host.getAttribute("data-walkers"))).toBeGreaterThan(0);
   expect(Number(await host.getAttribute("data-cars"))).toBeLessThanOrEqual(8);
   expect(Number(await host.getAttribute("data-walkers"))).toBeLessThanOrEqual(12);
   expect(await host.getAttribute("data-canonical-task-count")).toBe(canonical);
   expect(await identity!.evaluate(node=>node===document.querySelector(".world-canvas canvas"))).toBe(true);
   expect(reads.filter(path=>path.endsWith("/scene"))).toHaveLength(1);
   expect(reads.filter(path=>/\/world\/viewport|\/chunks\//.test(path))).toEqual([]);
   expect(errors).toEqual([]);expect(movementErrors).toEqual([]);
 }finally{
   releaseAmbient();await page.clock.resume().catch(()=>undefined);
   await page.evaluate(()=>(window as unknown as CooperativeYieldGateWindow).qaCooperativeYield?.release()).catch(()=>undefined);
 }
});

test("quality limits preserve the physical walk network and everyday compilation",async({page,hasTouch})=>{
  const host=await enterCity(page);
  await expect(host).toHaveAttribute("data-mobility-ready","true");
  const walk=await host.getAttribute("data-walk-network-builds"),life=await host.getAttribute("data-everyday-compiles");
  const preferences=await openWorldPreferences(page,hasTouch);
  await preferences.getByLabel("Детализация").selectOption("ECONOMY");
  await expect(host).toHaveAttribute("data-world-quality","ECONOMY");
  await expect.poll(async()=>Number(await host.getAttribute("data-cars"))).toBeLessThanOrEqual(8);
  expect(await host.getAttribute("data-walk-network-builds")).toBe(walk);
  expect(await host.getAttribute("data-everyday-compiles")).toBe(life);
  await preferences.getByLabel("Детализация").selectOption("NORMAL");
  await expect(host).toHaveAttribute("data-world-quality","NORMAL");
  expect(await host.getAttribute("data-walk-network-builds")).toBe(walk);
});

test("authoritative resync keeps a ready CITY canvas and reuses identical physical networks",async({page})=>{
  let recovering=false,failedHistory=0,bootstrapReads=0;
  await page.route("**/api/bootstrap",async route=>{
    const response=await route.fetch({headers:{...route.request().headers(),"accept-encoding":"identity"}}),next=await response.json() as BootstrapDto;
    bootstrapReads++;if(recovering)next.eventCursor++;
    await route.fulfill({response,json:next});
  });
  await page.route("**/api/events?after=*",async route=>{
    if(recovering&&failedHistory<3){failedHistory++;await route.fulfill({status:503,json:{message:"Controlled unavailable replay history"}});return;}
    await route.continue();
  });
  const host=await enterCity(page);
  await expect(host).toHaveAttribute("data-mobility-ready","true");
  await expect(page.getByRole("button",{name:"Настройки аккаунта, в сети",exact:true})).toBeVisible();
  const canvas=await host.locator("canvas").elementHandle(),walk=await host.getAttribute("data-walk-network-builds"),life=await host.getAttribute("data-everyday-compiles");
  const reads=bootstrapReads;recovering=true;
  await page.evaluate(()=>(window as unknown as {qaDisconnectWorld():void}).qaDisconnectWorld());
  await expect.poll(()=>bootstrapReads).toBeGreaterThan(reads);
  await expect.poll(async()=>Number(await host.getAttribute("data-realtime-batch-count")??0)).toBeGreaterThan(0);
  await expect(host).toHaveAttribute("data-loading","false");
  await expect(page.getByRole("button",{name:"Настройки аккаунта, в сети",exact:true})).toBeVisible();
  expect(failedHistory).toBe(3);expect(await canvas!.evaluate(node=>node===document.querySelector(".world-canvas canvas"))).toBe(true);
  expect(await host.getAttribute("data-walk-network-builds")).toBe(walk);
  expect(await host.getAttribute("data-everyday-compiles")).toBe(life);
});

test("an offscreen frontage stage update preserves every canonical decoded page",async({page})=>{
  test.skip(process.env.E2E_CITY_200!=="true","Requires the owned dense-city fixture");
  await page.setViewportSize({width:390,height:844});
  const sceneResponse=page.waitForResponse(response=>new URL(response.url()).pathname.endsWith("/scene"));
  const host=await enterCity(page),scene=await (await sceneResponse).json() as CitySceneDto;
  const bootstrap=await (await page.request.get("/api/bootstrap")).json() as BootstrapDto;
  await expect(host).toHaveAttribute("data-mobility-ready","true");
  await expect.poll(()=>page.evaluate(()=>(window as unknown as {qaWorldSockets():number}).qaWorldSockets())).toBeGreaterThan(0);
  const camera={x:Number(await host.getAttribute("data-camera-world-x")),y:Number(await host.getAttribute("data-camera-world-y"))};
  const task=[...new Map(scene.chunks.flatMap(chunk=>chunk.tasks).map(task=>[task.id,task])).values()]
    .filter(task=>task.stage<3&&!['AIRPORT','RAILWAY','PORT'].includes(task.serviceRole??''))
    .sort((a,b)=>Math.hypot(b.origin.x-camera.x,b.origin.y-camera.y)-Math.hypot(a.origin.x-camera.x,a.origin.y-camera.y))[0]!;
  expect(task).toBeDefined();expect(Math.hypot(task.origin.x-camera.x,task.origin.y-camera.y)).toBeGreaterThan(scene.chunkSize*2);
  const ground=await host.getAttribute("data-ground-rebuilds"),decoded=Number(await host.getAttribute("data-chunk-materialize-samples"));
  const event:RealtimeEvent={id:bootstrap.eventCursor+1,countryId:bootstrap.country.id,worldVersion:bootstrap.country.worldVersion+1,
    type:"task.status_changed",createdAt:new Date().toISOString(),payload:{taskId:task.id,cityId:scene.city.id,status:"IN_PROGRESS",progress:50,stage:3,groundChanged:false}};
  await page.evaluate(value=>(window as unknown as {qaWorldFrame(event:unknown):void}).qaWorldFrame(value),event);
  await expect.poll(async()=>Number(await host.getAttribute("data-realtime-batch-count")??0)).toBeGreaterThan(0);
  await page.emulateMedia({reducedMotion:"reduce"});
  await expect(host).toHaveAttribute("data-animation-active","false");
  await expect(host).toHaveAttribute("data-canonical-decoded-chunks",String(scene.chunks.length));
  await expect(host).toHaveAttribute("data-canonical-task-count",String(Number(process.env.WORLD_RENDER_TASK_COUNT??200)));
  await expect(host).toHaveAttribute("data-realtime-decorations","rematerialized");
  await expect.poll(async()=>Number(await host.getAttribute("data-chunk-materialize-samples"))).toBeGreaterThan(decoded);
  await expect(host).toHaveAttribute("data-canonical-snapshot-pending","false");
  expect(await host.getAttribute("data-ground-rebuilds")).toBe(ground);
});

test("dense CITY keeps canonical tasks while phone rendering follows viewport and halo with no pan reads",async({page},info)=>{
  test.skip(process.env.E2E_CITY_200!=="true","Requires the owned dense-city fixture");
  test.setTimeout(90_000);await page.setViewportSize({width:390,height:844});
  const reads:string[]=[];
  page.on("request",request=>{const path=new URL(request.url()).pathname;if(/\/scene$|\/world\/viewport|\/chunks\//.test(path))reads.push(path);});
  const host=await enterCity(page),canvas=host.locator("canvas"),identity=await canvas.elementHandle();
  const expected=Number(process.env.WORLD_RENDER_TASK_COUNT??200);
  await expect(host).toHaveAttribute("data-mobility-ready","true");
  const canonicalSignals=Number(await host.getAttribute("data-canonical-traffic-signals"));
  const junctions=await host.getAttribute("data-traffic-junctions");
  expect(canonicalSignals).toBeGreaterThan(0);
  expect(Number(await host.getAttribute("data-traffic-signals"))).toBeGreaterThan(0);
  expect(Number(await host.getAttribute("data-traffic-signals"))).toBeLessThan(canonicalSignals);
  await expect(host).toHaveAttribute("data-canonical-task-count",String(expected));
  expect(Number(await host.getAttribute("data-task-building-views"))).toBeLessThan(expected);
  expect(Number(await host.getAttribute("data-resident-chunks"))).toBeLessThanOrEqual(Number(await host.getAttribute("data-city-resident-chunk-budget")));
  const box=(await canvas.boundingBox())!,initial=Number(await host.getAttribute("data-camera-world-x"));
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
  await page.mouse.move(box.x+box.width/2-900,box.y+box.height/2,{steps:4});await page.mouse.up();
  await expect.poll(async()=>Number(await host.getAttribute("data-camera-world-x")),{timeout:15_000}).toBeGreaterThan(initial+10);
  await expect(host).toHaveAttribute("data-camera-presentation-pending","false");
  await expect(host).toHaveAttribute("data-loading","false");
  expect(await identity!.evaluate(node=>node.isConnected)).toBe(true);
  await expect(host).toHaveAttribute("data-canonical-task-count",String(expected));
  expect(reads.filter(path=>path.endsWith("/scene"))).toHaveLength(1);
  expect(reads.filter(path=>/\/world\/viewport|\/chunks\//.test(path))).toEqual([]);
  await expect(host).toHaveAttribute("data-canonical-traffic-signals",String(canonicalSignals));
  await expect(host).toHaveAttribute("data-traffic-junctions",junctions!);
  expect(Number(await host.getAttribute("data-traffic-signals"))).toBeLessThan(canonicalSignals);
  await page.screenshot({path:info.outputPath("dense-city-after-pan.png")});
});

test("focused keyboard camera controls preserve canonical data and ignore task dialogs",async({page})=>{
 const reads:string[]=[];page.on("request",request=>{const path=new URL(request.url()).pathname;if(/\/scene$|\/world\/viewport|\/chunks\//.test(path))reads.push(path);});
 const host=await enterCity(page),canvas=host.getByLabel("Интерактивная карта города"),identity=await canvas.elementHandle();
 const canonical=await host.getAttribute("data-canonical-task-count"),before=Number(await host.getAttribute("data-camera-world-x"));
 await canvas.focus();await page.keyboard.press("ArrowRight");
 await expect.poll(async()=>Number(await host.getAttribute("data-camera-world-x"))).toBeGreaterThan(before);
 await expect(host).toHaveAttribute("data-camera-presentation-pending","false");
 const scale=Number(await host.getAttribute("data-render-scale"));await page.keyboard.press("+");
 await expect.poll(async()=>Number(await host.getAttribute("data-render-scale"))).toBeGreaterThan(scale);
 await page.keyboard.press("Home");await expect(host).toHaveAttribute("data-camera-presentation-pending","false");
 expect(await host.getAttribute("data-canonical-task-count")).toBe(canonical);
 expect(await identity!.evaluate(node=>node.isConnected)).toBe(true);
 expect(reads.filter(path=>path.endsWith("/scene"))).toHaveLength(1);expect(reads.filter(path=>/\/world\/viewport|\/chunks\//.test(path))).toEqual([]);
 const search=page.getByLabel("Поиск здания по номеру или названию");await search.fill("1");await page.keyboard.press("ArrowRight");
 const stationary=await host.getAttribute("data-camera-world-x");await page.keyboard.press("Home");expect(await host.getAttribute("data-camera-world-x")).toBe(stationary);
 await page.locator(".task-search-results").getByRole("option").first().click();await expect(page.locator("#task-title")).toBeVisible();
 const inDialog=await host.getAttribute("data-camera-world-x");await page.keyboard.press("ArrowLeft");await page.keyboard.press("Home");
 expect(await host.getAttribute("data-camera-world-x")).toBe(inDialog);
});

test("real resident itinerary compilation reuses the canonical city and bounds existing actors across quality and reduced motion",async({page,hasTouch})=>{
 test.skip(process.env.E2E_CITY_200!=="true","Requires the owned dense city with ready homes and institutions");
 const host=await enterCity(page);await expect(host).toHaveAttribute("data-mobility-ready","true");
 await expect.poll(async()=>Number(await host.getAttribute("data-resident-itinerary-homes"))).toBeGreaterThan(0);
 await expect.poll(async()=>Number(await host.getAttribute("data-resident-itinerary-workplaces"))).toBeGreaterThan(0);
 await expect.poll(async()=>Number(await host.getAttribute("data-resident-itineraries"))).toBeGreaterThan(0);
 expect(Number(await host.getAttribute("data-resident-itineraries"))).toBeLessThanOrEqual(4);
 const canonical=await host.getAttribute("data-canonical-task-count"),walk=await host.getAttribute("data-walk-network-builds"),compiles=await host.getAttribute("data-resident-itinerary-compiles");
 const preferences=await openWorldPreferences(page,hasTouch);await preferences.getByLabel("Детализация").selectOption("ECONOMY");
 await expect(host).toHaveAttribute("data-world-quality","ECONOMY");await expect.poll(async()=>Number(await host.getAttribute("data-resident-itineraries"))).toBeLessThanOrEqual(2);
 expect(await host.getAttribute("data-walk-network-builds")).toBe(walk);expect(await host.getAttribute("data-resident-itinerary-compiles")).toBe(compiles);
 await page.emulateMedia({reducedMotion:"reduce"});await expect(host).toHaveAttribute("data-animation-active","false");await expect(host).toHaveAttribute("data-resident-itineraries","0");
 expect(await host.getAttribute("data-canonical-task-count")).toBe(canonical);expect(await host.getAttribute("data-walk-network-builds")).toBe(walk);
});

test("the voluntary city tour opens with keyboard focus and Escape returns to its trigger",async({page})=>{
 await enterCity(page);const trigger=page.getByRole("button",{name:"Сейчас в городе",exact:true});await trigger.focus();await page.keyboard.press("Enter");
 const tour=page.getByRole("complementary",{name:"Интересное в городе"});await expect(tour).toBeVisible();
 await expect(tour.getByRole("button",{name:"Закрыть интересное в городе"})).toBeFocused();
 await page.keyboard.press("Escape");await expect(tour).toHaveCount(0);await expect(trigger).toBeFocused();
});

test("leaving during cooperative preparation cancels late publication and a retained city really retries",async({page})=>{
 test.skip(process.env.E2E_CITY_200!=="true","Requires the owned dense-city fixture");test.setTimeout(90_000);
 const errors:string[]=[],reads:string[]=[];page.on("pageerror",error=>errors.push(error.message));
 page.on("request",request=>{const path=new URL(request.url()).pathname;if(/\/scene$|\/world\/viewport|\/chunks\//.test(path))reads.push(path);});
 await installCooperativeYieldGate(page,{phase:'movement',armInitially:true,firstOnly:false});
 const host=await enterCity(page),canvas=await host.locator("canvas").elementHandle();
 await expect.poll(()=>page.evaluate(()=>(window as unknown as CooperativeYieldGateWindow).qaCooperativeYield.state().held),{timeout:30_000}).toBeGreaterThan(0);
 await expect(host).not.toHaveAttribute("data-mobility-ready","true");
 await page.getByRole("navigation",{name:"Уровень карты"}).getByRole("button",{name:"Планета",exact:true}).click();
 await expect(page.locator(".planet-atlas")).toBeVisible();await expect(host).toHaveAttribute("data-map-active","false");
 await page.evaluate(()=>(window as unknown as CooperativeYieldGateWindow).qaCooperativeYield.release());
 await expect(host).toHaveAttribute("data-movement-preparing","false");
 await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
 await expect(host).not.toHaveAttribute("data-mobility-ready","true");
 await openMapCity(page);await expect(host).toHaveAttribute("data-mobility-ready","true",{timeout:30_000});
 await expect(host).toHaveAttribute("data-walk-network-builds","1");
 await expect(host).toHaveAttribute("data-canonical-task-count",String(Number(process.env.WORLD_RENDER_TASK_COUNT??200)));
 expect(await canvas!.evaluate(node=>node===document.querySelector(".world-canvas canvas"))).toBe(true);
 expect(reads.filter(path=>path.endsWith("/scene"))).toHaveLength(1);expect(reads.filter(path=>/\/world\/viewport|\/chunks\//.test(path))).toEqual([]);
 expect(errors).toEqual([]);
});

test("a newer defect summary during held life preparation wins without rebuilding canonical paths",async({page})=>{
 test.skip(process.env.E2E_CITY_200!=="true","Requires the owned dense-city fixture");test.setTimeout(90_000);
 const errors:string[]=[],reads:string[]=[];page.on("pageerror",error=>errors.push(error.message));
 page.on("request",request=>{const path=new URL(request.url()).pathname;if(/\/scene$|\/world\/viewport|\/chunks\//.test(path))reads.push(path);});
 await installCooperativeYieldGate(page,{phase:'life',armInitially:true,firstOnly:false});
 let incident:"BASE"|"ACTIVE"|"RESOLVED"="BASE",changedTaskId="",revision=0;
 await page.route("**/api/countries/*/cities/*/scene",async route=>{
   const response=await route.fetch({headers:{...route.request().headers(),"accept-encoding":"identity"}});
   const next=await response.json() as CitySceneDto;
   if(incident!=="BASE"){
     const patch=(task:CitySceneDto["chunks"][number]["tasks"][number])=>task.id===changedTaskId?{...task,
       defectSummary:incident==="ACTIVE"?{open:1,inProgress:0,verifying:0,active:1}:{open:0,inProgress:0,verifying:0,active:0}}:task;
     next.sceneRevision+=`-incident-${incident.toLowerCase()}`;
     next.chunks=next.chunks.map(chunk=>{
       const {contentHash,...content}=chunk;void contentHash;
       const patched={...content,publishedVersion:revision,tasks:chunk.tasks.map(patch)};
       return {...patched,contentHash:chunkPayloadContentHash(patched)};
     });
     next.completedDistrictSnapshots=next.completedDistrictSnapshots.map(snapshot=>snapshot.tasks.some(task=>task.id===changedTaskId)
       ?{...snapshot,revision:`${snapshot.revision}:${revision}`,tasks:snapshot.tasks.map(patch)}:snapshot);
   }
   await route.fulfill({response,json:next});
 });
 const response=page.waitForResponse(response=>new URL(response.url()).pathname.endsWith("/scene"));
 const host=await enterCity(page),scene=await(await response).json() as CitySceneDto;
 await expect(host).toHaveAttribute("data-mobility-ready","true",{timeout:30_000});
 await expect.poll(()=>page.evaluate(()=>(window as unknown as {qaWorldSockets():number}).qaWorldSockets())).toBeGreaterThan(0);
 const bootstrap=await(await page.request.get("/api/bootstrap")).json() as BootstrapDto;
 const task=[...scene.chunks.flatMap(chunk=>chunk.tasks),...scene.completedDistrictSnapshots.flatMap(snapshot=>snapshot.tasks)].find(task=>task.workItemType==="TASK"&&task.status==="COMPLETED"&&task.stage===5&&task.accessPath.length&&!['AIRPORT','RAILWAY','PORT'].includes(task.serviceRole??''))!;
 expect(task).toBeDefined();changedTaskId=task.id;
 const canvas=await host.locator("canvas").elementHandle(),walk=await host.getAttribute("data-walk-network-builds");
 const compiles=Number(await host.getAttribute("data-everyday-compiles")),sites=await host.getAttribute("data-city-life-sites");
 const batch=Number(await host.getAttribute("data-realtime-batch-count")??0);
 const event=(offset:number):RealtimeEvent=>({id:bootstrap.eventCursor+offset,
   countryId:bootstrap.country.id,worldVersion:bootstrap.country.worldVersion+offset,type:"task.defect_updated",createdAt:new Date().toISOString(),
   payload:{taskId:task.id,cityId:scene.city.id,groundChanged:false}});
 incident="ACTIVE";revision=bootstrap.country.worldVersion+1;
 await page.evaluate(value=>(window as unknown as {qaWorldFrame(event:unknown):void}).qaWorldFrame(value),event(1));
 await expect.poll(()=>page.evaluate(()=>(window as unknown as CooperativeYieldGateWindow).qaCooperativeYield.state().held)).toBeGreaterThan(0);
 await expect(host).toHaveAttribute("data-everyday-compiles",String(compiles));
 incident="RESOLVED";revision=bootstrap.country.worldVersion+2;
 await page.evaluate(value=>(window as unknown as {qaWorldFrame(event:unknown):void}).qaWorldFrame(value),event(2));
 await expect.poll(async()=>Number(await host.getAttribute("data-realtime-batch-count")??0)).toBeGreaterThan(batch+1);
 await expect(host).toHaveAttribute("data-city-scene-revision",/-incident-resolved$/);
 await page.evaluate(()=>(window as unknown as CooperativeYieldGateWindow).qaCooperativeYield.release());
 await expect(host).toHaveAttribute("data-life-preparing","false",{timeout:30_000});
 await expect(host).toHaveAttribute("data-everyday-compiles",String(compiles+1));
 await expect(host).toHaveAttribute("data-city-life-sites",sites!);
 expect(await host.getAttribute("data-walk-network-builds")).toBe(walk);
 expect(await canvas!.evaluate(node=>node===document.querySelector(".world-canvas canvas"))).toBe(true);
 expect(reads.filter(path=>path.endsWith("/scene"))).toHaveLength(3);expect(reads.filter(path=>/\/world\/viewport|\/chunks\//.test(path))).toEqual([]);
 expect(errors).toEqual([]);
});

type CanonicalWorkerGateSnapshot={
 targetKey:string;targetHash:string;held:number;released:boolean;forwardedTarget:number;everLoadError:boolean;
 records:Array<{id:number;key:string;hash:string;workerUrl:string}>;
};
type CanonicalWorkerGateWindow=Window&{
 qaArmCanonicalWorker(target:{key:string;hash:string}):void;
 qaCanonicalWorkerGate():CanonicalWorkerGateSnapshot;
 qaReleaseCanonicalWorker():void;
};

test("resident ground starts while a real offscreen canonical worker decode is held",async({page},info)=>{
 test.skip(process.env.E2E_CITY_200!=="true"||Number(process.env.WORLD_RENDER_TASK_COUNT??200)!==1000,"Requires the owned1000-task dense-city fixture");
 test.setTimeout(90_000);await page.setViewportSize({width:390,height:844});
 const errors:string[]=[],reads:string[]=[];page.on("pageerror",error=>errors.push(error.message));
 page.on("request",request=>{const path=new URL(request.url()).pathname;if(/\/scene$|\/world\/viewport|\/chunks\//.test(path))reads.push(path);});
 await page.addInitScript(()=>{
   const NativeWorker=window.Worker,queued:Array<()=>void>=[];
   const records:CanonicalWorkerGateSnapshot["records"]=[];
   let targetKey="",targetHash="",released=false,forwardedTarget=0,everLoadError=false;
   document.addEventListener("DOMContentLoaded",()=>{
     const observeError=()=>{everLoadError ||= document.querySelector<HTMLElement>(".world-canvas")?.dataset.loadError==="true";};
     new MutationObserver(observeError).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:["data-load-error"]});
     observeError();
   },{once:true});
   window.Worker=class extends NativeWorker{
     constructor(scriptURL:string|URL,options?:WorkerOptions){
       super(scriptURL,options);
       const workerUrl=String(scriptURL),post=this.postMessage.bind(this);
       this.postMessage=((...args:Parameters<Worker["postMessage"]>)=>{
         const request=args[0] as {id?:number;payload?:{chunkX?:number;chunkY?:number;contentHash?:string}}|null;
         const payload=request?.payload;
         if(!workerUrl.includes("chunk-materializer-worker")||typeof request?.id!=="number"
           ||typeof payload?.chunkX!=="number"||typeof payload.chunkY!=="number"){post(...args);return;}
         const key=`${payload.chunkX},${payload.chunkY}`,hash=String(payload.contentHash??"");
         records.push({id:request.id,key,hash,workerUrl});
         const target=key===targetKey&&hash===targetHash;
         const forward=()=>{post(...args);if(target)forwardedTarget++;};
         if(target&&!released)queued.push(forward);else forward();
       }) as Worker["postMessage"];
     }
   };
   Object.assign(window,{
     qaArmCanonicalWorker:(target:{key:string;hash:string})=>{targetKey=target.key;targetHash=target.hash;},
     qaCanonicalWorkerGate:()=>({targetKey,targetHash,held:queued.length,released,forwardedTarget,everLoadError,records:records.map(record=>({...record}))}),
     qaReleaseCanonicalWorker:()=>{released=true;for(const forward of queued.splice(0))forward();},
   });
   localStorage.setItem("tasktopia:world-preferences:v2",JSON.stringify({quality:"NORMAL",cityLife:true,sound:false}));
 });
 let scene:CitySceneDto|undefined,bakesAtArm=0;
 let target:{chunkX:number;chunkY:number;hash:string}|undefined;
 await page.route("**/api/countries/*/cities/*/scene",async route=>{
   const response=await route.fetch({headers:{...route.request().headers(),"accept-encoding":"identity"}}),next=await response.json() as CitySceneDto;
   if(!scene){
     scene=next;
     const far=[...next.chunks].sort((a,b)=>Math.hypot((b.chunkX+.5)*next.chunkSize-next.city.center.x,(b.chunkY+.5)*next.chunkSize-next.city.center.y)
       -Math.hypot((a.chunkX+.5)*next.chunkSize-next.city.center.x,(a.chunkY+.5)*next.chunkSize-next.city.center.y))[0]!;
     expect(far.contentHash).toBeTruthy();
     expect(Math.hypot((far.chunkX+.5)*next.chunkSize-next.city.center.x,(far.chunkY+.5)*next.chunkSize-next.city.center.y)).toBeGreaterThan(next.chunkSize*2);
     target={chunkX:far.chunkX,chunkY:far.chunkY,hash:far.contentHash!};
     bakesAtArm=await page.evaluate(value=>{
       (window as unknown as CanonicalWorkerGateWindow).qaArmCanonicalWorker(value);
       return Number(document.querySelector<HTMLElement>(".world-canvas")?.dataset.groundBakeSamples??0);
     },{key:`${far.chunkX},${far.chunkY}`,hash:far.contentHash!});
   }
   // Return the actual response unchanged. The gate only postpones one native
   // postMessage; it never fabricates a chunk, worker result or scene version.
   await route.fulfill({response});
 });
 try{
   expect((await page.request.post("/api/auth/login",{data:{email:process.env.E2E_CITY_EMAIL??"demo@tasktopia.local",password:process.env.E2E_CITY_PASSWORD??"tasktopia-demo"}})).status()).toBe(200);
   await page.goto("/");await openMapCity(page);
   const host=page.locator(".world-canvas");
   await expect.poll(()=>page.evaluate(()=>(window as unknown as CanonicalWorkerGateWindow).qaCanonicalWorkerGate().held),{timeout:30_000}).toBe(1);
   expect(scene).toBeDefined();expect(target).toBeDefined();
   const actualTaskIds=new Set([...scene!.chunks.flatMap(chunk=>chunk.tasks),...scene!.completedDistrictSnapshots.flatMap(snapshot=>snapshot.tasks)].map(task=>task.id));
   expect(actualTaskIds.size).toBe(1000);
   const camera=await host.evaluate(node=>{const d=(node as HTMLElement).dataset;return {x:Number(d.cameraWorldX),y:Number(d.cameraWorldY),scale:Number(d.renderScale)};});
   expect(Number.isFinite(camera.x)&&Number.isFinite(camera.y)&&Number.isFinite(camera.scale)&&camera.scale>0).toBe(true);
   // Full-screen dimensions conservatively contain the smaller canvas. One
   // complete chunk extra on each side also excludes the resident halo.
   const halfX=390/(camera.scale*8*2),halfY=844/(camera.scale*8*2),size=scene!.chunkSize;
   expect((target!.chunkX+1)*size<camera.x-halfX-size||target!.chunkX*size>camera.x+halfX+size
     ||(target!.chunkY+1)*size<camera.y-halfY-size||target!.chunkY*size>camera.y+halfY+size).toBe(true);
   const canvas=await host.locator("canvas").elementHandle();expect(canvas).not.toBeNull();
   await expect.poll(async()=>Number(await host.getAttribute("data-ground-bake-samples")??0),{timeout:5_000}).toBeGreaterThan(bakesAtArm);
   await expect(host).not.toHaveAttribute("data-city-scene-commit","atomic");
   expect(Number(await host.getAttribute("data-ground-rebuilds")??0)).toBe(0);
   const held=await page.evaluate(()=>(window as unknown as CanonicalWorkerGateWindow).qaCanonicalWorkerGate());
   expect(held.held).toBe(1);expect(held.forwardedTarget).toBe(0);expect(held.everLoadError).toBe(false);
   expect(held.records.filter(record=>record.key===held.targetKey&&record.hash===held.targetHash)).toHaveLength(1);
   await info.attach("offscreen-canonical-worker-held",{body:JSON.stringify({bakesAtArm,bakesDuringHold:await host.getAttribute("data-ground-bake-samples"),camera,target,gate:held}),contentType:"application/json"});
   await page.evaluate(()=>(window as unknown as CanonicalWorkerGateWindow).qaReleaseCanonicalWorker());
   await expect(host).toHaveAttribute("data-city-scene-commit","atomic",{timeout:30_000});
   await expect(host).toHaveAttribute("data-loading","false");
   await expect(host).toHaveAttribute("data-canonical-decoded-chunks",String(scene!.chunks.length));
   await expect(host).toHaveAttribute("data-canonical-task-count","1000");
   await expect(host).toHaveAttribute("data-mobility-ready","true");
   expect(await canvas!.evaluate(node=>node===document.querySelector(".world-canvas canvas"))).toBe(true);
   expect(reads.filter(path=>path.endsWith("/scene"))).toHaveLength(1);expect(reads.filter(path=>/\/world\/viewport|\/chunks\//.test(path))).toEqual([]);
   expect((await page.evaluate(()=>(window as unknown as CanonicalWorkerGateWindow).qaCanonicalWorkerGate())).everLoadError).toBe(false);
   expect(errors).toEqual([]);
 }finally{
   if(!page.isClosed()){
     const gate=await page.evaluate(()=>({gate:(window as unknown as CanonicalWorkerGateWindow).qaCanonicalWorkerGate(),
       bakes:document.querySelector<HTMLElement>(".world-canvas")?.dataset.groundBakeSamples??"0",
       commit:document.querySelector<HTMLElement>(".world-canvas")?.dataset.citySceneCommit??null})).catch(()=>undefined);
     await info.attach("offscreen-canonical-worker-final",{body:JSON.stringify({bakesAtArm,target,...gate}),contentType:"application/json"});
     await page.evaluate(()=>(window as unknown as CanonicalWorkerGateWindow).qaReleaseCanonicalWorker()).catch(()=>undefined);
   }
 }
});

type CanonicalFailureGateState={
 workers:number;residentId:number|null;residentKey:string;residentHeld:number;responses:number;
 faulted:boolean;failedId:number|null;retryDelay:number|null;retryFired:number;retryHeld:number;retryFarPosts:number;retryDelays:number[];
 farKey:string;farHash:string;residentHash:string;workerUrls:string[];
};
type CanonicalFailureGateWindow={
 qaArmFailure(value:{farKey:string;farHash:string;pages:Array<[string,string]>}):void;
 qaFailureState():CanonicalFailureGateState;qaReleaseResident():void;qaReleaseRetry():void;
};

for(const retryWhileResidentHeld of [false,true])test(retryWhileResidentHeld
 ?"a native retry shares a real held resident decode across failed iterations"
 :"a failed canonical decode cannot bake a late resident and its native retry recovers",async({page},info)=>{
 test.skip(process.env.E2E_CITY_200!=="true"||Number(process.env.WORLD_RENDER_TASK_COUNT??200)!==1000,"Requires the owned1000-task dense-city fixture");
 test.setTimeout(90_000);await page.setViewportSize({width:390,height:844});
 const errors:string[]=[],reads:string[]=[];page.on("pageerror",error=>errors.push(error.message));
 page.on("request",request=>{const path=new URL(request.url()).pathname;if(/\/scene$|\/world\/viewport|\/chunks\//.test(path))reads.push(path);});
 await page.addInitScript(()=>{
   const NativeWorker=window.Worker,nativeTimeout=window.setTimeout.bind(window);
   const residents:Array<()=>void>=[],retries:Array<()=>void>=[],pages=new Map<string,string>(),workerUrls:string[]=[],retryDelays:number[]=[];
   let farKey="",farHash="",armed=false,residentId:number|null=null,residentKey="",responses=0,workers=0;
   let faulted=false,failedId:number|null=null,holdResident=true,holdRetry=true,retryCaptured=false,retryDelay:number|null=null,retryFired=0,retryFarPosts=0;
   window.Worker=class extends NativeWorker{
     constructor(scriptURL:string|URL,options?:WorkerOptions){
       super(scriptURL,options);
       const owned=String(scriptURL).includes("chunk-materializer-worker"),post=this.postMessage.bind(this);
       if(owned){workers++;workerUrls.push(String(scriptURL));}
       this.addEventListener("message",event=>{if(owned&&(event.data as {id?:number}|null)?.id===residentId)responses++;});
       this.postMessage=((...args:Parameters<Worker["postMessage"]>)=>{
         const request=args[0] as {id?:number;payload?:{chunkX?:number;chunkY?:number;contentHash?:string}}|null,payload=request?.payload;
         if(!armed||!owned||typeof request?.id!=="number"||typeof payload?.chunkX!=="number"||typeof payload.chunkY!=="number"){post(...args);return;}
         const key=`${payload.chunkX},${payload.chunkY}`,hash=String(payload.contentHash??"");
         if(pages.get(key)!==hash){post(...args);return;}
         if(residentId===null&&key!==farKey&&holdResident){residentId=request.id;residentKey=key;residents.push(()=>post(...args));return;}
         if(residentId!==null&&key===farKey&&hash===farHash&&!faulted){
           faulted=true;failedId=request.id;throw new DOMException("Controlled canonical postMessage clone failure","DataCloneError");
         }
         if(faulted&&key===farKey&&hash===farHash)retryFarPosts++;
         post(...args);
       }) as Worker["postMessage"];
     }
   };
   window.setTimeout=((...args:Parameters<typeof window.setTimeout>)=>{
     const [handler,delay,...callbackArgs]=args;
     if(typeof handler==="function"&&(delay===500||delay===1000)&&faulted
       &&document.querySelector<HTMLElement>(".world-canvas")?.dataset.loadError==="true")retryDelays.push(delay);
     if(typeof handler!=="function"||delay!==500||!faulted||!holdRetry||retryCaptured
       ||document.querySelector<HTMLElement>(".world-canvas")?.dataset.loadError!=="true")return nativeTimeout(...args);
     retryCaptured=true;retryDelay=delay;
     // The actual500ms timer still fires; only its already-due callback waits.
     // Other timers/RAF and the worker's15s watchdog stay native and unchanged.
     return nativeTimeout(()=>{retryFired++;const resume=()=>Reflect.apply(handler,window,callbackArgs);
       if(holdRetry)retries.push(resume);else resume();},delay);
   }) as typeof window.setTimeout;
   Object.assign(window,{
     qaArmFailure:(value:{farKey:string;farHash:string;pages:Array<[string,string]>})=>{
       farKey=value.farKey;farHash=value.farHash;for(const [key,hash] of value.pages)pages.set(key,hash);armed=true;
     },
     qaFailureState:()=>({workers,residentId,residentKey,residentHeld:residents.length,responses,faulted,failedId,retryDelay,retryFired,retryHeld:retries.length,retryFarPosts,retryDelays:[...retryDelays],
       farKey,farHash,residentHash:pages.get(residentKey)??"",workerUrls:[...workerUrls]}),
     qaReleaseResident:()=>{holdResident=false;for(const resume of residents.splice(0))resume();},
     qaReleaseRetry:()=>{holdRetry=false;for(const resume of retries.splice(0))resume();},
   });
   localStorage.setItem("tasktopia:world-preferences:v2",JSON.stringify({quality:"NORMAL",cityLife:true,sound:false}));
 });
 let scene:CitySceneDto|undefined;
 await page.route("**/api/countries/*/cities/*/scene",async route=>{
   const response=await route.fetch({headers:{...route.request().headers(),"accept-encoding":"identity"}}),next=await response.json() as CitySceneDto;
   if(!scene){
     scene=next;
     const far=[...next.chunks].sort((a,b)=>Math.hypot((b.chunkX+.5)*next.chunkSize-next.city.center.x,(b.chunkY+.5)*next.chunkSize-next.city.center.y)
       -Math.hypot((a.chunkX+.5)*next.chunkSize-next.city.center.x,(a.chunkY+.5)*next.chunkSize-next.city.center.y))[0]!;
     expect(far.contentHash).toBeTruthy();
     expect(Math.hypot((far.chunkX+.5)*next.chunkSize-next.city.center.x,(far.chunkY+.5)*next.chunkSize-next.city.center.y)).toBeGreaterThan(next.chunkSize*2);
     await page.evaluate(value=>(window as unknown as CanonicalFailureGateWindow).qaArmFailure(value),
       {farKey:`${far.chunkX},${far.chunkY}`,farHash:far.contentHash!,pages:next.chunks.map(chunk=>[`${chunk.chunkX},${chunk.chunkY}`,String(chunk.contentHash??"")] as [string,string])});
   }
   await route.fulfill({response});
 });
 const census=()=>page.locator(".world-canvas").evaluate(node=>{const d=(node as HTMLElement).dataset;return{
   bakes:Number(d.groundBakeSamples??0),rebuilds:Number(d.groundRebuilds??0),resident:Number(d.residentChunks??0),
   entities:Number(d.entityViews??0),commit:d.citySceneCommit??null,error:d.loadError??null,
 };});
 try{
   expect((await page.request.post("/api/auth/login",{data:{email:process.env.E2E_CITY_EMAIL??"demo@tasktopia.local",password:process.env.E2E_CITY_PASSWORD??"tasktopia-demo"}})).status()).toBe(200);
   await page.goto("/");await openMapCity(page);
   const host=page.locator(".world-canvas");
   await expect.poll(()=>page.evaluate(()=>(window as unknown as CanonicalFailureGateWindow).qaFailureState().workers),{timeout:30_000}).toBeGreaterThan(1);
   await expect.poll(()=>page.evaluate(()=>(window as unknown as CanonicalFailureGateWindow).qaFailureState().faulted)).toBe(true);
   await expect(host).toHaveAttribute("data-load-error","true");
   await expect.poll(()=>page.evaluate(()=>(window as unknown as CanonicalFailureGateWindow).qaFailureState().retryHeld)).toBe(1);
   const failed=await page.evaluate(()=>(window as unknown as CanonicalFailureGateWindow).qaFailureState());
   expect(failed.residentHeld).toBe(1);expect(failed.responses).toBe(0);expect(failed.retryDelay).toBe(500);expect(failed.retryFired).toBe(1);
   expect(failed.failedId).not.toBe(failed.residentId);expect(failed.farKey).not.toBe(failed.residentKey);expect(failed.residentHash).toBeTruthy();
   const camera=await host.evaluate(node=>{const d=(node as HTMLElement).dataset;return{x:Number(d.cameraWorldX),y:Number(d.cameraWorldY),scale:Number(d.renderScale)};});
   const [residentX,residentY]=failed.residentKey.split(",").map(Number),size=scene!.chunkSize;
   const halfX=390/(camera.scale*8*2),halfY=844/(camera.scale*8*2);
   expect(Number.isFinite(camera.scale)&&camera.scale>0).toBe(true);
   expect((residentX!+1)*size>=camera.x-halfX-size&&residentX!*size<=camera.x+halfX+size
     &&(residentY!+1)*size>=camera.y-halfY-size&&residentY!*size<=camera.y+halfY+size).toBe(true);
   const canvas=await host.locator("canvas").elementHandle(),before=await census();expect(canvas).not.toBeNull();expect(before.commit).not.toBe("atomic");
   if(retryWhileResidentHeld){
     await page.evaluate(()=>(window as unknown as CanonicalFailureGateWindow).qaReleaseRetry());
     await expect(host).toHaveAttribute("data-loading","true");
     await expect.poll(()=>page.evaluate(()=>(window as unknown as CanonicalFailureGateWindow).qaFailureState().retryFarPosts)).toBeGreaterThan(0);
   }
   await page.evaluate(()=>(window as unknown as CanonicalFailureGateWindow).qaReleaseResident());
   await expect.poll(()=>page.evaluate(()=>(window as unknown as CanonicalFailureGateWindow).qaFailureState().responses)).toBe(1);
   await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
   const after=await census();
   await info.attach("failed-iteration-late-resident",{body:JSON.stringify({retryWhileResidentHeld,before,after,gate:await page.evaluate(()=>(window as unknown as CanonicalFailureGateWindow).qaFailureState())}),contentType:"application/json"});
   if(!retryWhileResidentHeld){
     expect(after.bakes).toBe(before.bakes);expect(after.rebuilds).toBe(before.rebuilds);expect(after.resident).toBe(before.resident);expect(after.entities).toBe(before.entities);
     expect(after.commit).not.toBe("atomic");expect(after.error).toBe("true");
     await page.evaluate(()=>(window as unknown as CanonicalFailureGateWindow).qaReleaseRetry());
   }
   await expect(host).toHaveAttribute("data-city-scene-commit","atomic",{timeout:30_000});
   await expect(host).toHaveAttribute("data-loading","false");
   await expect(host).toHaveAttribute("data-canonical-decoded-chunks",String(scene!.chunks.length));
   await expect(host).toHaveAttribute("data-canonical-task-count","1000");
   await expect(host).toHaveAttribute("data-mobility-ready","true");
   if(retryWhileResidentHeld){const recovered=await census();expect(recovered.bakes-before.bakes).toBeLessThanOrEqual(recovered.resident*2);}
   expect((await page.evaluate(()=>(window as unknown as CanonicalFailureGateWindow).qaFailureState())).retryDelays).toEqual([500]);
   expect(await canvas!.evaluate(node=>node===document.querySelector(".world-canvas canvas"))).toBe(true);
   expect(reads.filter(path=>path.endsWith("/scene"))).toHaveLength(1);expect(reads.filter(path=>/\/world\/viewport|\/chunks\//.test(path))).toEqual([]);
   expect(errors).toEqual([]);
 }finally{
   if(!page.isClosed()){
     const gate=await page.evaluate(()=>(window as unknown as CanonicalFailureGateWindow).qaFailureState()).catch(()=>undefined);
     await info.attach("failed-canonical-worker-final",{body:JSON.stringify({gate}),contentType:"application/json"});
     await page.evaluate(()=>{const qa=window as unknown as CanonicalFailureGateWindow;qa.qaReleaseResident();qa.qaReleaseRetry();}).catch(()=>undefined);
   }
 }
});

type FirstAtomicCitySnapshot = {
 dataset: Record<string, string | undefined>;
 canvas: { width: number; height: number; clientWidth: number; clientHeight: number; imageRendering: string; touchAction: string } | null;
};
type FirstAtomicCityWindow = {
 qaFirstAtomicCity(): FirstAtomicCitySnapshot | undefined;
 qaFirstAtomicCitySameCanvas(): boolean;
};

test("the first atomic CITY frame keeps complete visible ground and all entity sources before invisible halo bakes",async({page},info)=>{
 test.skip(process.env.E2E_CITY_200!=="true"||Number(process.env.WORLD_RENDER_TASK_COUNT??200)!==1000,"Requires the owned1000-task dense-city fixture");
 test.setTimeout(90_000);await page.setViewportSize({width:390,height:844});
 const errors:string[]=[],reads:string[]=[];
 page.on("pageerror",error=>errors.push(error.message));
 page.on("request",request=>{const path=new URL(request.url()).pathname;if(/\/scene$|\/world\/viewport|\/chunks\//.test(path))reads.push(path);});
 await page.addInitScript(()=>{
   let first:FirstAtomicCitySnapshot|undefined,canvas:WeakRef<HTMLCanvasElement>|undefined;
   const capture=()=>{
     if(first)return;
     const host=document.querySelector<HTMLElement>('.world-canvas[data-city-scene-commit="atomic"]');
     if(!host)return;
     const element=host.querySelector("canvas"),style=element?getComputedStyle(element):undefined;
     if(element)canvas=new WeakRef(element);
     // Observe the actual first commit microtask, before any later locator wait
     // can hide an unnecessary initial halo barrier. No work or clocks are held.
     first={dataset:{...host.dataset},canvas:element?{width:element.width,height:element.height,clientWidth:element.clientWidth,clientHeight:element.clientHeight,
       imageRendering:style!.imageRendering,touchAction:style!.touchAction}:null};
   };
   new MutationObserver(capture).observe(document,{subtree:true,childList:true,attributes:true,attributeFilter:["data-city-scene-commit"]});
   Object.assign(window,{
     qaFirstAtomicCity:()=>first,
     qaFirstAtomicCitySameCanvas:()=>!!canvas?.deref()&&canvas.deref()===document.querySelector(".world-canvas canvas"),
   });
 });
 const sceneResponse=page.waitForResponse(response=>new URL(response.url()).pathname.endsWith("/scene"));
 const host=await enterCity(page),scene=await(await sceneResponse).json() as CitySceneDto;
 const first=await page.evaluate(()=>(window as unknown as FirstAtomicCityWindow).qaFirstAtomicCity());
 expect(first).toBeDefined();
 await info.attach("first-atomic-city",{body:JSON.stringify(first),contentType:"application/json"});
 const data=first!.dataset,budget=Number(data.cityResidentChunkBudget),rebuilds=Number(data.groundRebuilds);
 // This existing metric must fail first on the previous all-halo barrier;
 // absent instrumentation is not the reason the unchanged runtime is RED.
 expect(rebuilds).toBeGreaterThan(0);expect(budget).toBeGreaterThan(0);
 expect(rebuilds).toBeLessThan(budget);
 const actualTaskIds=new Set([...scene.chunks.flatMap(chunk=>chunk.tasks),...scene.completedDistrictSnapshots.flatMap(snapshot=>snapshot.tasks)].map(task=>task.id));
 expect(actualTaskIds.size).toBe(1000);expect(Number(data.canonicalTaskCount)).toBe(actualTaskIds.size);
 expect(Number(data.canonicalDecodedChunks)).toBe(scene.chunks.length);expect(data.canonicalSnapshotPending).toBe("false");
 expect(data.cityCriticalGroundReady).toBe("true");expect(Number(data.cityCriticalGroundCount)).toBeGreaterThan(0);
 expect(first!.canvas).not.toBeNull();
 const scale=Number(data.renderScale),centerX=Number(data.cameraWorldX),centerY=Number(data.cameraWorldY);
 expect(Number.isFinite(scale)&&scale>0&&Number.isFinite(centerX)&&Number.isFinite(centerY)).toBe(true);
 // Derive actual visible chunk rectangles from native canvas dimensions and
 // authoritative geometry, independently of the production partition helper.
 // Continuous overlap includes every visible fractional edge pixel.
 const halfX=first!.canvas!.clientWidth/(scale*8*2),halfY=first!.canvas!.clientHeight/(scale*8*2);
 const viewport={minX:Math.max(scene.city.bounds.minX,centerX-halfX),minY:Math.max(scene.city.bounds.minY,centerY-halfY),
   maxX:Math.min(scene.city.bounds.maxX+1,centerX+halfX),maxY:Math.min(scene.city.bounds.maxY+1,centerY+halfY)};
 const actualVisible=scene.chunks.filter(chunk=>chunk.chunkX*scene.chunkSize<viewport.maxX&&(chunk.chunkX+1)*scene.chunkSize>viewport.minX
   &&chunk.chunkY*scene.chunkSize<viewport.maxY&&(chunk.chunkY+1)*scene.chunkSize>viewport.minY);
 expect(actualVisible.length).toBeGreaterThan(0);expect(Number(data.cityCriticalGroundCount)).toBe(actualVisible.length);
 expect(Number(data.cityCriticalGroundCount)).toBeLessThanOrEqual(budget);
 await info.attach("first-atomic-visible-geometry",{body:JSON.stringify({viewport,scale,centerX,centerY,visible:actualVisible.map(chunk=>[chunk.chunkX,chunk.chunkY])}),contentType:"application/json"});
 expect(Number(data.citySceneEntityChunks)).toBe(budget);expect(Number(data.citySceneEntityCommits)).toBeGreaterThan(0);
 expect(Number(data.cityHaloGroundPending)).toBeGreaterThan(0);expect(data.cityResidencyHalo).toBe("1");
 expect(data.cameraPaddingVisibleUntextured).toBe("0");expect(data.cameraPaddingTargetUnbaked).toBe("0");
 expect(data.cameraPaddingTreePending).toBe("0");expect(data.cameraPresentationPending).toBe("false");
 expect(data.worldQuality).toBe("NORMAL");expect(first!.canvas).not.toBeNull();
 expect(first!.canvas!.width).toBeGreaterThan(0);expect(first!.canvas!.height).toBeGreaterThan(0);
 expect(first!.canvas!.touchAction).toBe("none");
 await expect(host).toHaveAttribute("data-city-halo-ground-pending","0");
 await expect(host).toHaveAttribute("data-ground-bake-queue","0");
 await expect(host).toHaveAttribute("data-loading","false");
 await expect.poll(async()=>Number(await host.getAttribute("data-ground-rebuilds"))).toBeGreaterThanOrEqual(budget);
 await expect(host).toHaveAttribute("data-resident-chunks",String(budget));
 expect(await page.evaluate(()=>(window as unknown as FirstAtomicCityWindow).qaFirstAtomicCitySameCanvas())).toBe(true);
 const canvas=host.locator("canvas"),box=(await canvas.boundingBox())!,initial=Number(await host.getAttribute("data-camera-world-x"));
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
 await page.mouse.move(box.x+box.width/2-900,box.y+box.height/2,{steps:4});await page.mouse.up();
 await expect.poll(async()=>Number(await host.getAttribute("data-camera-world-x")),{timeout:15_000}).toBeGreaterThan(initial+10);
 await expect(host).toHaveAttribute("data-camera-presentation-pending","false");
 await expect(host).toHaveAttribute("data-loading","false");
 await expect(host).toHaveAttribute("data-canonical-task-count","1000");
 await expect(host).toHaveAttribute("data-canonical-decoded-chunks",String(scene.chunks.length));
 await expect(host).toHaveAttribute("data-camera-padding-visible-untextured","0");
 await expect(host).toHaveAttribute("data-camera-padding-target-unbaked","0");
 await expect(host).toHaveAttribute("data-world-quality","NORMAL");
 expect(await page.evaluate(()=>(window as unknown as FirstAtomicCityWindow).qaFirstAtomicCitySameCanvas())).toBe(true);
 expect(await canvas.evaluate(element=>{const style=getComputedStyle(element);return{imageRendering:style.imageRendering,touchAction:style.touchAction};}))
   .toEqual({imageRendering:first!.canvas!.imageRendering,touchAction:first!.canvas!.touchAction});
 expect(reads.filter(path=>path.endsWith("/scene"))).toHaveLength(1);
 expect(reads.filter(path=>/\/world\/viewport|\/chunks\//.test(path))).toEqual([]);expect(errors).toEqual([]);
 await page.screenshot({path:info.outputPath("initial-critical-city-after-pan.png")});
});
