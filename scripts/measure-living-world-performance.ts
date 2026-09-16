/** Measure only a dedicated local fixture; no writes except local login. */
import {chromium,type Page} from "@playwright/test";
import {readFile,readdir,mkdir,writeFile} from "node:fs/promises";
import {performance} from "node:perf_hooks";
import {createHash} from "node:crypto";
import {cpus,platform,release} from "node:os";
import type { Application, Container, Texture } from "pixi.js";
const base=process.env.PERF_BASE_URL??"http://127.0.0.1:5196";
if(!["127.0.0.1","localhost","::1"].includes(new URL(base).hostname))throw new Error("Local benchmark only");
const size=process.env.LIVING_WORLD_SIZE??"M",variant=process.env.PERF_VARIANT??"candidate",mobile=process.env.PERF_MOBILE==="true";
const fixture=JSON.parse(await readFile(`tmp/living-world/performance/fixture-${size}.json`,"utf8")) as {email:string;cityId:string;countryId:string};
const coldCount=Number(process.env.PERF_COLD_SAMPLES??(size==="M"?20:10)),warmCount=Number(process.env.PERF_WARM_SAMPLES??(size==="M"?50:30));
const buildRoot=process.env.PERF_BUILD_ROOT??process.cwd();
const buildSha256=createHash("sha256").update(await readFile(`${buildRoot}/dist/server.mjs`)).digest("hex");
const clientHash=createHash("sha256");
for(const file of (await readdir(`${buildRoot}/dist/public/assets`)).filter(file=>/\.(js|css)$/.test(file)).sort()){
 clientHash.update(file).update(await readFile(`${buildRoot}/dist/public/assets/${file}`));
}
const clientSha256=clientHash.digest("hex");
const browser=await chromium.launch({headless:true});
const samples:{mode:string;ms:number;kind:string}[]=[],errors:string[]=[],heap:number[]=[],dom:unknown[]=[],resources:unknown[]=[];
const views=[{mode:"COUNTRY",label:"Страна",selector:".country-overview",attribute:"data-country-ready",value:"true"},
 {mode:"PLANET",label:"Планета",selector:".planet-atlas",attribute:"data-planet-ready",value:"true"},
 {mode:"CITY",label:"Город",selector:".world-canvas",attribute:"data-city-scene-commit",value:"atomic"}];
const ready=async(page:Page,view:typeof views[number])=>{
 await page.locator(view.selector).waitFor({state:"visible",timeout:60_000});
 await page.waitForFunction(({selector,attribute,value})=>document.querySelector(selector)?.getAttribute(attribute)===value,view,{timeout:60_000});
};
const context=async()=>{
 const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:900},deviceScaleFactor:mobile?2:Number(process.env.PERF_DPR??1),serviceWorkers:"block"});
 const response=await context.request.post(`${base}/api/auth/login`,{data:{email:fixture.email,password:"living-world-local-performance"}});
 if(!response.ok())throw new Error(`Login ${response.status()}: ${await response.text()}`);
 const page=await context.newPage();page.on("pageerror",error=>errors.push(error.message));
 if(process.env.PERF_RESOURCES === "true") await page.addInitScript(() => {
  // Pixi's supported debug initialization hook; a WeakRef cannot keep a closed
  // scene alive and the application itself is never changed by this census.
  globalThis.__PIXI_APP_INIT__ = app => {
   if ("stage" in app) (window as typeof window & {__livingWorldApp?: WeakRef<Application>}).__livingWorldApp = new WeakRef(app);
  };
 });
 if(process.env.PERF_PROFILE === "true") await page.addInitScript(()=>performance.setResourceTimingBufferSize(5000));
 const cdp=await context.newCDPSession(page);
 await cdp.send("Network.enable");
 await cdp.send("Network.emulateNetworkConditions",{offline:false,latency:80,downloadThroughput:50_000_000/8,uploadThroughput:50_000_000/8});
 if(mobile)await cdp.send("Emulation.setCPUThrottlingRate",{rate:4});
 await cdp.send("Performance.enable");
 return {context,page,cdp};
};
try{
 if(process.env.PERF_PRIME_SERVER === "true"){
  const {context:ctx}=await context();
  try{
   for(const path of ["/api/bootstrap",`/api/countries/${fixture.countryId}/cities/${fixture.cityId}/scene`,
    `/api/countries/${fixture.countryId}/overview`,"/api/planet-atlas"]){
    const response=await ctx.request.get(`${base}${path}`);
    if(!response.ok())throw new Error(`Server warmup ${path}: ${response.status()}`);
    await response.body();
   }
  }finally{await ctx.close();}
 }
 for(let i=0;i<coldCount;i++){
  const {context:ctx,page,cdp}=await context();
  const profileMode=process.env.PERF_PROFILE_MODE ?? "CITY";
  if(process.env.PERF_PROFILE_CPU === "true" && i===0 && profileMode==="CITY"){
   await cdp.send("Profiler.enable");await cdp.send("Profiler.setSamplingInterval",{interval:1000});await cdp.send("Profiler.start");
  }
  const start=performance.now();await page.goto(base,{waitUntil:"domcontentloaded"});await page.getByRole("button",{name:"Город",exact:true}).click();await ready(page,views[2]!);
  samples.push({mode:"CITY",ms:performance.now()-start,kind:"cold"});
  if(process.env.PERF_PROFILE_CPU === "true" && i===0 && profileMode==="CITY"){
   const {profile}=await cdp.send("Profiler.stop");
   await mkdir("tmp/living-world/performance",{recursive:true});
   await writeFile(`tmp/living-world/performance/${variant}-${size}-cold.cpuprofile`,JSON.stringify(profile));
  }
  if(process.env.PERF_PROFILE === "true" && i === 0){
   const resources=await page.evaluate(()=>performance.getEntriesByType("resource").map(entry=>{
    const resource=entry as PerformanceResourceTiming;
    return {name:resource.name,initiator:resource.initiatorType,start:resource.startTime,duration:resource.duration,
     responseStart:resource.responseStart,responseEnd:resource.responseEnd,transferSize:resource.transferSize,decodedSize:resource.decodedBodySize};
   }));
   await mkdir("tmp/living-world/performance",{recursive:true});
   await writeFile(`tmp/living-world/performance/${variant}-${size}-cold-resources.json`,JSON.stringify(resources,null,2));
  }
  for(const view of views.slice(0,2)){
   if(process.env.PERF_PROFILE_CPU === "true" && i===0 && profileMode===view.mode){
    await cdp.send("Profiler.enable");await cdp.send("Profiler.setSamplingInterval",{interval:1000});await cdp.send("Profiler.start");
   }
   const start=performance.now();await page.getByRole("button",{name:view.label,exact:true}).click();await ready(page,view);
   samples.push({mode:view.mode,ms:performance.now()-start,kind:"first-overview"});
   if(process.env.PERF_PROFILE_CPU === "true" && i===0 && profileMode===view.mode){
    const {profile}=await cdp.send("Profiler.stop");
    await mkdir("tmp/living-world/performance",{recursive:true});
    await writeFile(`tmp/living-world/performance/${variant}-${size}-${view.mode.toLowerCase()}.cpuprofile`,JSON.stringify(profile));
   }
   if(process.env.PERF_PROFILE === "true" && i === 0){
    const resources=await page.evaluate(()=>performance.getEntriesByType("resource").map(entry=>entry.toJSON()));
    await writeFile(`tmp/living-world/performance/${variant}-${size}-${view.mode.toLowerCase()}-resources.json`,JSON.stringify(resources,null,2));
   }
  }
  await ctx.close();console.log(JSON.stringify({variant,size,cold:i+1,samples:samples.slice(-3)}));
 }
 const {context:ctx,page,cdp}=await context();
 await page.goto(base,{waitUntil:"domcontentloaded"});await page.getByRole("button",{name:"Город",exact:true}).click();await ready(page,views[2]!);
 for(const view of views){await page.getByRole("button",{name:view.label,exact:true}).click();await ready(page,view);}
 for(let i=0;i<warmCount;i++){
  for(const view of views){
   const start=performance.now();await page.getByRole("button",{name:view.label,exact:true}).click();await ready(page,view);
   samples.push({mode:view.mode,ms:performance.now()-start,kind:"warm"});
  }
  if(i%5===0||i===warmCount-1){
   await cdp.send("HeapProfiler.collectGarbage");
   heap.push((await cdp.send("Performance.getMetrics")).metrics.find(m=>m.name==="JSHeapUsedSize")!.value);
   dom.push(await cdp.send("Memory.getDOMCounters"));
   if(process.env.PERF_RESOURCES === "true") resources.push({cycle:i+1,...await page.evaluate(() => {
    const app=(window as typeof window & {__livingWorldApp?:WeakRef<Application>}).__livingWorldApp?.deref();
    if(!app?.stage) throw new Error("Live Pixi application was not observed");
    let views=0;
    const textures=new Set<Texture>(), sources=new Set<Texture["source"]>();
    const pending:Container[]=[app.stage];
    while(pending.length){
     const node=pending.pop()!;
     if(node.destroyed) throw new Error("Destroyed view retained in the scene");
     views++;
     const texture=(node as Container & {texture?:Texture}).texture;
     if(texture){textures.add(texture);sources.add(texture.source);}
     pending.push(...node.children);
    }
    const managed=(app.renderer.texture as unknown as {managedTextures:unknown[]}).managedTextures;
    if(!Array.isArray(managed))throw new Error("Texture census unavailable for this renderer");
    const live=managed.filter(Boolean) as Texture["source"][];
    const census=window as typeof window & {__livingWorldTextureIds?:Set<number>};
    const newlyUploaded=census.__livingWorldTextureIds ? live.filter(source=>!census.__livingWorldTextureIds!.has(source.uid)).map(source=>({
     label:source.label,width:source.pixelWidth,height:source.pixelHeight,
     resource:source.resource?.constructor?.name,
     url:source.resource instanceof HTMLImageElement ? source.resource.src.replace(/^data:.*$/,"data:") : undefined,
    })) : [];
    census.__livingWorldTextureIds=new Set(live.map(source=>source.uid));
    // Pixi leaves null tombstones after unload until its next GC pass.
    return {views,textureViews:textures.size,textureSources:sources.size,managedTextures:live.length,textureSlots:managed.length,newlyUploaded};
   })});
  }
 }
 let sceneRequests=0;page.on("request",request=>{if(/\/(scene|overview|planet-atlas)(?:\?|$)/.test(request.url()))sceneRequests++;});
 const frames=await page.evaluate<number[]>(`new Promise(resolve => {
  const values=[];let previous=performance.now();
  function frame(now){values.push(now-previous);previous=now;if(values.length>=180)resolve(values);else requestAnimationFrame(frame);}
  requestAnimationFrame(frame);
 })`);
 const datasets=await page.locator(".world-canvas").evaluate(el=>({...((el as HTMLElement).dataset)}));
 const percentile=(values:number[],fraction:number)=>[...values].sort((a,b)=>a-b)[Math.ceil(values.length*fraction)-1];
 const summaries=Object.fromEntries([...new Set(samples.map(s=>`${s.kind}:${s.mode}`))].map(key=>{
  const values=samples.filter(s=>`${s.kind}:${s.mode}`===key).map(s=>s.ms);
  return [key,{count:values.length,p50:percentile(values,.5),p95:percentile(values,.95),max:Math.max(...values)}];
 }));
 const report={variant,size,fixture,buildSha256,clientSha256,profiling:process.env.PERF_PROFILE_CPU === "true",serverPrimed:process.env.PERF_PRIME_SERVER === "true",host:{platform:platform(),release:release(),cpu:cpus()[0]?.model,node:process.version},browser:browser.version(),viewport:page.viewportSize(),dpr:mobile?2:Number(process.env.PERF_DPR??1),cpu:mobile?4:1,network:{mbps:50,rttMs:80},samples,summaries,
  heap,dom,resources,idleFrames:{p95:percentile(frames,.95),max:Math.max(...frames)},idleSceneRequests:sceneRequests,datasets,errors,generatedAt:new Date().toISOString()};
 await mkdir("tmp/living-world/performance",{recursive:true});
 const suffix=process.env.PERF_PROFILE === "true" || process.env.PERF_PROFILE_CPU === "true" ? "-profile" : "";
 await writeFile(`tmp/living-world/performance/${variant}-${size}-${mobile?"mobile":"desktop"}${suffix}.json`,JSON.stringify(report,null,2));
 console.log(JSON.stringify({summaries,heap,resources,idleSceneRequests:sceneRequests,errors}));
 await ctx.close();
 if(errors.length)process.exitCode=1;
}finally{await browser.close();}
