import { expect,test } from "@playwright/test";
import { AppService } from "../../src/server/app-service";
import { createDb } from "../../src/server/db";
import { registerUser } from "../../src/server/auth";
import { Client,StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

test("foreign airport changes refresh an open map without reloading the page",async({page})=>{
  test.skip(!/^http:\/\/(127\.0\.0\.1|localhost):/.test(process.env.E2E_BASE_URL??""),"Isolated local fixture only");
  test.setTimeout(60000);
  const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
  await page.request.post("/api/auth/login",{data:{email:"demo@tasktopia.local",password:"tasktopia-demo"}});
  const bootstrap=await(await page.request.get("/api/bootstrap")).json();expect(bootstrap.country.name).toBe("Тестовая страна");
  const db=await createDb(process.env.E2E_DATABASE_URL??"postgres://tasktopia:tasktopia@127.0.0.1:55432/tasktopia_test",{migrate:false}),service=new AppService(db);
  const token=await(await page.request.post("/api/tokens",{data:{name:"Foreign transport QA",scopes:["tasks:write"],expiresInDays:30}})).json();
  const client=new Client({name:"foreign-transport-qa",version:"1.0.0"});
  let owner:Awaited<ReturnType<typeof registerUser>>["user"]|undefined;
  try{
    await client.connect(new StreamableHTTPClientTransport(new URL("/mcp",process.env.E2E_BASE_URL),{requestInit:{headers:{Authorization:`Bearer ${token.token}`}}}));
    owner=(await registerUser(db,{email:`foreign-qa-${crypto.randomUUID()}@example.test`,name:"Foreign QA",password:"password123"})).user;
    await db.prepare("INSERT INTO country_members(country_id,user_id,role,created_at) VALUES (?,?,'MEMBER',now())").run(owner.countryId,bootstrap.user.id);
    const city=await service.createCity(owner.countryId,{name:"Foreign QA",idempotencyKey:crypto.randomUUID()});
    let districtId="";
    for(let i=0;i<3;i++){
      const district=await service.createDistrict(owner.countryId,{cityId:city.id,name:`QA ${i}`,activate:false,idempotencyKey:crypto.randomUUID()});
      districtId=district.id;
      await service.createTask(owner.countryId,{cityId:city.id,districtId,title:`Building ${i}`,estimate:1,idempotencyKey:crypto.randomUUID()});
    }
    await service.activateDistrict(owner.countryId,districtId,crypto.randomUUID());
    const airport=await service.createTask(owner.countryId,{cityId:city.id,districtId,title:"Foreign airport QA",estimate:1,idempotencyKey:crypto.randomUUID()});
    expect(airport.serviceRole).toBe("AIRPORT");
    for(const status of ["STARTED","IN_PROGRESS","TESTING"] as const)await service.updateTaskStatus(owner.countryId,{taskId:airport.id,status,comment:"QA setup",idempotencyKey:crypto.randomUUID()});
    const call=async(name:string,args:Record<string,unknown>)=>{
      const result=await client.callTool({name,arguments:{countryId:owner!.countryId,idempotencyKey:crypto.randomUUID(),...args}});
      expect(result.isError,JSON.stringify(result.content)).not.toBe(true);
    };
    let scenes=0,overviews=0,navigations=0;
    page.on("request",request=>{
      if(request.isNavigationRequest()&&request.frame()===page.mainFrame())navigations++;
      if(request.url().includes(`/countries/${bootstrap.country.id}/cities/`)&&request.url().includes("/scene"))scenes++;
      if(request.url().endsWith("/planet-atlas"))overviews++;
    });
    await page.goto("/");await page.getByRole("navigation", { name: "Уровень карты" }).getByRole("button", { name: "Город", exact: true }).click();await expect(page.locator(".world-canvas")).toHaveAttribute("data-city-scene-commit","atomic");
    const host=page.locator(".world-canvas");
    const ground=await host.getAttribute("data-ground-rebuilds");
    const transportRefreshes=Number(await host.getAttribute("data-transport-only-refreshes") ?? 0);
    const sceneCount=scenes;
    await call("task.set_status",{taskId:airport.id,status:"COMPLETED",comment:"Ready foreign airport"});
    await expect.poll(()=>scenes).toBeGreaterThan(sceneCount);
    await expect.poll(async()=>Number(await host.getAttribute("data-transport-only-refreshes") ?? 0)).toBeGreaterThan(transportRefreshes);
    expect(await host.getAttribute("data-ground-rebuilds")).toBe(ground);
    await page.getByRole("button",{name:"Планета",exact:true}).click();
    await expect(page.locator(".planet-atlas")).toHaveAttribute("data-planet-ready","true");
    const overviewCount=overviews;
    await call("task.delete",{taskId:airport.id,confirmTitle:airport.title});
    await expect.poll(()=>overviews).toBeGreaterThan(overviewCount);
    expect(navigations).toBe(1);expect(errors).toEqual([]);
  }finally{
    await client.close();if(token.id)await page.request.delete(`/api/tokens/${token.id}`);
    if(owner){await db.prepare("DELETE FROM countries WHERE id=?").run(owner.countryId);await db.prepare("DELETE FROM users WHERE id=?").run(owner.id);}
    await db.close();
  }
});
