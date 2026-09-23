import { openMapPlanet } from "./map-navigation";
import { expect,test } from "@playwright/test";
import { Client,StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createDb } from "../../src/server/db";
import { AppService } from "../../src/server/app-service";
test("live progress keeps the planet scene and camera",async({page})=>{
  test.skip(!/^http:\/\/(127\.0\.0\.1|localhost):/.test(process.env.E2E_BASE_URL??""),"Local fixture only");
  expect((await page.request.post("/api/auth/login",{data:{email:"demo@tasktopia.local",password:"tasktopia-demo"}})).ok()).toBe(true);
  const bootstrap=await (await page.request.get("/api/bootstrap")).json();
  expect(bootstrap.country.name).toBe("Тестовая страна");
  const db=await createDb(process.env.E2E_DATABASE_URL??"postgres://tasktopia:tasktopia@127.0.0.1:55432/tasktopia_test",{migrate:false});
  const service=new AppService(db),tasks=await service.listTasks(bootstrap.country.id);
  const task=tasks.find(t=>t.status==="IN_PROGRESS"&&t.progress>27&&t.progress<=50)!;
  if(!task) { await db.close(); throw new Error("Fixture needs an in-progress task in the same construction band"); }
  const token=await (await page.request.post("/api/tokens",{data:{name:"Country activity QA",scopes:["tasks:write"],expiresInDays:30}})).json();
  const client=new Client({name:"country-activity-qa",version:"1.0.0"});
  await client.connect(new StreamableHTTPClientTransport(new URL("/mcp",process.env.E2E_BASE_URL),{requestInit:{headers:{Authorization:`Bearer ${token.token}`}}}));
  try {
    await page.goto("/");await openMapPlanet(page);
    const country=page.locator(".planet-atlas");await expect(country).toHaveAttribute("data-planet-ready","true");
    await page.locator(".planet-city-targets [data-city-id]").first().click();
    await expect(country).toHaveAttribute("data-globe-zoom","3.00");
    const before=await country.evaluate(el=>({builds:el.getAttribute("data-planet-countries"),zoom:el.getAttribute("data-globe-zoom")}));
    const refresh=page.waitForResponse(r=>r.url().endsWith("/planet-atlas")&&r.status()===200);
    const changed=await client.callTool({name:"task.report_progress",arguments:{countryId:bootstrap.country.id,taskId:task.id,status:task.status,progress:task.progress+1,comment:"Проверка сохранения камеры",idempotencyKey:crypto.randomUUID()}});
    expect(changed.isError).not.toBe(true);await refresh;
    await expect(country).toHaveAttribute("data-planet-ready","true");
    await page.waitForTimeout(250);
    expect(await country.evaluate(el=>({builds:el.getAttribute("data-planet-countries"),zoom:el.getAttribute("data-globe-zoom")}))).toEqual(before);
  } finally {
    await client.callTool({name:"task.report_progress",arguments:{countryId:bootstrap.country.id,taskId:task.id,status:task.status,progress:task.progress,comment:"Восстановление тестового прогресса",idempotencyKey:crypto.randomUUID()}});
    await client.close();await page.request.delete(`/api/tokens/${token.id}`);await db.close();
  }
});
