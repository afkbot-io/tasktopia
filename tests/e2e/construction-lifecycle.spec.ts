import { openMapCity } from "./map-navigation";
import { expect,test } from "@playwright/test";
import { AppService } from "../../src/server/app-service";
import { createDb } from "../../src/server/db";
import { Client,StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

test("construction life reacts live to task stages and defects without reloading the map",async({page},info)=>{
  test.skip(!/^http:\/\/(127\.0\.0\.1|localhost):/.test(process.env.E2E_BASE_URL??""),"Isolated local fixture only");
  const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
  await page.request.post("/api/auth/login",{data:{email:"demo@tasktopia.local",password:"tasktopia-demo"}});
  const bootstrap=await(await page.request.get("/api/bootstrap")).json();expect(bootstrap.country.name).toBe("Тестовая страна");
  const countryId=bootstrap.country.id,cityId=bootstrap.initialCity.id;
  const db=await createDb(process.env.E2E_DATABASE_URL??"postgres://tasktopia:tasktopia@127.0.0.1:55432/tasktopia_test",{migrate:false}),service=new AppService(db);
  const active=(await service.listDistricts(countryId,cityId)).find(d=>d.status==="ACTIVE")!;
  const tokenResponse=await page.request.post("/api/tokens",{data:{name:"Construction lifecycle QA",scopes:["tasks:write"],expiresInDays:30}});
  expect(tokenResponse.ok()).toBe(true);const token=await tokenResponse.json();
  const client=new Client({name:"construction-lifecycle-qa",version:"1.0.0"});
  await client.connect(new StreamableHTTPClientTransport(new URL("/mcp",process.env.E2E_BASE_URL),{requestInit:{headers:{Authorization:`Bearer ${token.token}`}}}));
  const call=async(name:string,args:Record<string,unknown>)=>{
    const result=await client.callTool({name,arguments:{countryId,idempotencyKey:crypto.randomUUID(),...args}});
    expect(result.isError,JSON.stringify(result.content)).not.toBe(true);
    return JSON.parse((result.content as {type:string;text:string}[]).find(c=>c.type==="text")!.text);
  };
  let district:Awaited<ReturnType<typeof service.createDistrict>>|undefined,task:Awaited<ReturnType<typeof service.createTask>>|undefined;
  try{
    district=await service.createDistrict(countryId,{cityId,name:`Стройка QA ${crypto.randomUUID().slice(0,8)}`,activate:false,idempotencyKey:crypto.randomUUID()});
    await service.activateDistrict(countryId,district.id,crypto.randomUUID());
    task=await service.createTask(countryId,{cityId,districtId:district.id,title:"Строительство QA",estimate:3,idempotencyKey:crypto.randomUUID()});
    await page.goto("/");
    await openMapCity(page);const host=page.locator(".world-canvas");
    await expect(host).toHaveAttribute("data-city-scene-commit","atomic");
    await expect(host).toHaveAttribute("data-construction-workers","0");
    const status=async(status:string,progress?:number)=>call("task.set_status",{taskId:task!.id,status,progress,comment:"Локальная браузерная проверка"});
    await status("STARTED");await expect.poll(async()=>Number(await host.getAttribute("data-construction-workers"))).toBeGreaterThan(0);
    await status("IN_PROGRESS",60);await expect.poll(async()=>Number(await host.getAttribute("data-construction-workers"))).toBeGreaterThan(0);
    const defect=await call("task.defect_create",{taskId:task.id,title:"Локальный тест пожара",reproductionSteps:"Воспроизвести дефект на тестовом здании",actualResult:"Дефект открыт",expectedResult:"После исправления стройка возобновляется"});
    await expect(host).toHaveAttribute("data-construction-workers","0");await expect(host).toHaveAttribute("data-construction-materials","0");
    await expect(host).toHaveAttribute("data-incident-modes",/DEFECT_REPORTED/);
    await page.screenshot({path:info.outputPath("construction-defect.png")});
    for(const status of ["IN_PROGRESS","VERIFYING","FIXED"])await call("task.defect_update",{defectId:defect.id,status});
    await expect.poll(async()=>Number(await host.getAttribute("data-construction-workers"))).toBeGreaterThan(0);
    await status("TESTING");await expect(host).toHaveAttribute("data-construction-materials","0");
    await expect.poll(async()=>Number(await host.getAttribute("data-construction-workers"))).toBeGreaterThan(0);
    await status("IN_PROGRESS",70);await expect.poll(async()=>Number(await host.getAttribute("data-construction-workers"))).toBeGreaterThan(0);
    await status("TESTING");await status("COMPLETED");
    await expect(host).toHaveAttribute("data-construction-workers","0");await expect(host).toHaveAttribute("data-construction-materials","0");
    expect(errors).toEqual([]);
  }finally{
    await service.activateDistrict(countryId,active.id,crypto.randomUUID());
    if(task)await service.deleteTask(countryId,{taskId:task.id,confirmTitle:task.title,idempotencyKey:crypto.randomUUID()});
    if(district)await service.deleteDistrict(countryId,{districtId:district.id,confirmName:district.name,idempotencyKey:crypto.randomUUID()});
    await client.close();await page.request.delete(`/api/tokens/${token.id}`);await db.close();
  }
});
