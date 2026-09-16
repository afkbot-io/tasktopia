/** Cached outline latency on the existing local M fixture; restores assignment. */
import { chromium } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createDb } from "../src/server/db";
import { AppService } from "../src/server/app-service";
const base=process.env.PERF_BASE_URL??"http://127.0.0.1:5196";
if(!["localhost","127.0.0.1"].includes(new URL(base).hostname))throw new Error("Local only");
const fixture=JSON.parse(await readFile("tmp/living-world/performance/fixture-M.json","utf8"));
const db=await createDb(process.env.DATABASE_URL??"postgres://tasktopia:tasktopia@127.0.0.1:55432/tasktopia_test",{migrate:false});
const service=new AppService(db),browser=await chromium.launch();
const user=await db.prepare("SELECT id FROM users WHERE email=?").get<{id:string}>(fixture.email);
if(!user)throw new Error("Missing dedicated fixture");
const task=(await service.listTasks(fixture.countryId)).find(t=>t.cityId===fixture.cityId)!;
try{
 await service.assignTask(fixture.countryId,{taskId:task.id,assigneeUserId:user.id,idempotencyKey:crypto.randomUUID()});
 for(const mobile of [false,true]){
  const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:900},deviceScaleFactor:mobile?2:1,serviceWorkers:"block"});
  const login=await context.request.post(`${base}/api/auth/login`,{data:{email:fixture.email,password:"living-world-local-performance"}});
  if(!login.ok())throw new Error(`Login: ${login.status()}`);
  await context.addInitScript("globalThis.__name = (target) => target");
  const page=await context.newPage(),errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
  const cdp=await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions",{offline:false,latency:80,downloadThroughput:6250000,uploadThroughput:6250000});
  if(mobile)await cdp.send("Emulation.setCPUThrottlingRate",{rate:4});
  await page.goto(base);await page.getByRole("button",{name:"Город",exact:true}).click();
  await page.waitForFunction(()=>document.querySelector(".world-canvas")?.getAttribute("data-city-scene-commit")==="atomic",{},{timeout:60000});
  const mine=page.getByRole("navigation",{name:"Подсветка задач"}).getByRole("button",{name:"Мои",exact:true});
  if(await mine.getAttribute("aria-pressed")!=="true")await mine.click();
  await page.waitForFunction(()=>Number(document.querySelector(".world-canvas")?.getAttribute("data-attention-tasks"))>0);
  let requests=0;page.on("request",r=>{if(r.url().includes("/api/map-attention?"))requests++;});
  const result=await page.evaluate(async()=>{
   const host=document.querySelector<HTMLElement>(".world-canvas")!;
   const button=[...document.querySelectorAll<HTMLButtonElement>('nav[aria-label="Подсветка задач"] button')].find(b=>b.textContent?.trim()==="Мои")!;
   const snapshot=()=>[host.dataset.cameraWorldX,host.dataset.cameraWorldY,host.dataset.groundRebuilds];
   const before=snapshot(),samples:number[]=[];
   const transition=(enabled:boolean)=>new Promise<number>((resolve,reject)=>{
    const start=performance.now();
    const observer=new MutationObserver(()=>{
     if((Number(host.dataset.attentionTasks)>0)!==enabled)return;
     observer.disconnect();clearTimeout(timer);requestAnimationFrame(()=>resolve(performance.now()-start));
    });
    observer.observe(host,{attributes:true,attributeFilter:["data-attention-tasks"]});
    const timer=window.setTimeout(()=>{observer.disconnect();reject(new Error("Outline did not update"));},5000);
    button.click();
   });
   for(let i=0;i<55;i++){await transition(false);const elapsed=await transition(true);if(i>=5)samples.push(elapsed);}
   return {samples,before,after:snapshot()};
  });
  const sorted=[...result.samples].sort((a,b)=>a-b),p95=sorted[Math.ceil(sorted.length*.95)-1]!;
  const report={...result,p50:sorted[24],p95,budget:mobile?100:50,passed:p95<=(mobile?100:50)&&requests===0&&errors.length===0&&JSON.stringify(result.before)===JSON.stringify(result.after),requests,errors,mobile,cpu:mobile?4:1,browser:browser.version(),buildSha256:createHash("sha256").update(await readFile("dist/server.mjs")).digest("hex"),measurement:"DOM click to outline mutation and next animation frame; five warmup, fifty cached samples"};
  await writeFile(`tmp/living-world/performance/attention-M-${mobile?"mobile":"desktop"}.json`,JSON.stringify(report,null,2));
  console.log(JSON.stringify({mobile,p95,passed:report.passed,requests,errors}));
  await context.close();
 }
}finally{
 await service.assignTask(fixture.countryId,{taskId:task.id,assigneeUserId:task.assignee?.id??null,idempotencyKey:crypto.randomUUID()});
 await browser.close();await db.close();
}
