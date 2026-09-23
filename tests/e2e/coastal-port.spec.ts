import { expect, test } from "@playwright/test";
import { createDb } from "../../src/server/db";
import { createCountry, registerUser } from "../../src/server/auth";
import { AppService } from "../../src/server/app-service";
import type { PersonalPlanetGeography } from "../../src/shared/planet-geography";
import { taskLink } from "../../src/client/task-navigation";
test("shows five real port stages with a continuous approach and pier", async ({ page }, info) => {
  // Five cold city entries and native screenshots share this test. Hosted
  // software rendering took 62 s cumulatively while every readiness check
  // passed in its original budget; bound the whole visual sequence separately.
  test.setTimeout(120_000);
  test.skip(!/^http:\/\/(127\.0\.0\.1|localhost):/.test(process.env.E2E_BASE_URL ?? ""), "Local fixture only");
  const url = process.env.E2E_DATABASE_URL ?? "postgres://tasktopia:tasktopia@127.0.0.1:55432/tasktopia_test";
  expect(["localhost", "127.0.0.1"]).toContain(new URL(url).hostname);
  const db = await createDb(url, { migrate: false });
  let countryId: string | undefined;
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  const { user } = await registerUser(db, { email: `port-visual-${crypto.randomUUID()}@example.test`, name: "Port", password: "password123" });
  try {
  countryId = await createCountry(db, user.id, "Приморье", { version: 1, kind: "EAST_COAST", coastX: 128 });
  await db.prepare("UPDATE countries SET seed=123 WHERE id=?").run(countryId);
  const service = new AppService(db);
  const city = await service.createCity(countryId, { name: "Приморск", idempotencyKey: "city" });
  const district = await service.createDistrict(countryId, { cityId: city.id, name: "Портовый", activate: true, idempotencyKey: "district" });
  await expect(service.createTask(countryId, { cityId: city.id, districtId: district.id, title: "Без карты", estimate: 1,
    buildingHint: "compact-port-v1", idempotencyKey: "no-geography" })).rejects.toThrow(/подтверждённый/);
  await service.getPlanetAtlas(user.id);
  // Pin this fixture's private coast: random user IDs choose different
  // continents, including correctly unavailable inland/shared-coast cases.
  const stored = (await db.prepare("SELECT geography_json FROM personal_planet_geography_v1 WHERE user_id=?")
    .get<{ geography_json: PersonalPlanetGeography }>(user.id))!.geography_json;
  const record = stored.countries[countryId]!;
  const cells = Array.from({ length: 9 }, (_, i) => ({ q: 10 + i % 3, r: 10 + Math.floor(i / 3), id: `coastal-land-${i}`, terrain: "grass" as const }));
  const coastCells = [9, 10, 11, 12, 13].flatMap(r => [9, 10, 11, 12, 13].filter(q => q === 9 || q === 13 || r === 9 || r === 13)
    .map(q => ({ q, r, id: `coastal-shore-${q}-${r}`, terrain: "coast" as const })));
  const pinned = { ...stored, countries: { [countryId]: { ...record, sector: 0, cells } }, coastCells,
    coastOwners: Object.fromEntries(coastCells.map(cell => [cell.id, [countryId]])) };
  await db.prepare("UPDATE personal_planet_geography_v1 SET geography_json=?::jsonb WHERE user_id=?").run(JSON.stringify(pinned), user.id);
  const port = await service.createTask(countryId, { cityId: city.id, districtId: district.id, title: "Морской порт", estimate: 1,
    buildingHint: "compact-port-v1", idempotencyKey: "port" });

    await info.attach("port-plan", { body: JSON.stringify((await service.getCityScene(countryId, city.id)).ports), contentType: "application/json" });
    expect((await page.request.post("/api/auth/login", { data: { email: user.email, password: "password123" } })).ok()).toBe(true);
    const statuses = ["PLANNING", "STARTED", "IN_PROGRESS", "TESTING", "COMPLETED"] as const;
    for (const [index, status] of statuses.entries()) {
      if (index) await service.updateTaskStatus(countryId, { taskId: port.id, status, comment: "Проверка вида причала", idempotencyKey: status });
      await page.goto(taskLink(countryId, port));
      await expect(page.locator("#task-title")).toContainText(port.title);
      await page.getByRole("button", { name: "Закрыть", exact: true }).click();
      const host = page.locator(".world-canvas");
      await expect(host).toHaveAttribute("data-city-scene-commit", "atomic");
      await expect(host).toHaveAttribute("data-city-ports", "1");
      await expect(host).toHaveAttribute("data-city-port-stages", String(index + 1));
      await expect(host).toHaveAttribute("data-ground-bake-queue", "0");
      await page.screenshot({ path: info.outputPath(`port-stage-${index + 1}.png`) });
    }
    expect(errors).toEqual([]);
  } finally {
    await page.close();
    if (countryId) await db.prepare("DELETE FROM countries WHERE id=?").run(countryId);
    await db.prepare("DELETE FROM countries WHERE id=?").run(user.countryId);
    await db.prepare("DELETE FROM users WHERE id=?").run(user.id);
    await db.close();
  }
});

test("a real port docks and dispatches the same scheduled ship",async({page},info)=>{
  test.skip(!/^http:\/\/(127\.0\.0\.1|localhost):/.test(process.env.E2E_BASE_URL??""),"Local fixture only");
  const {coastalPortPair}=await import("../fixtures/coastal-ports");
  const {transportSchedule,TRANSPORT_EPOCH}=await import("../../src/shared/transport-schedule");
  const url=process.env.E2E_DATABASE_URL??"postgres://tasktopia:tasktopia@127.0.0.1:55432/tasktopia_test";
  expect(["localhost","127.0.0.1"]).toContain(new URL(url).hostname);
  const db=await createDb(url,{migrate:false});
  const {user,service,ports}=await coastalPortPair(db);
  const local=ports[0]!,errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
  try{
    const scene=await service.getCitySceneForUser(user.id,local.countryId,local.city.id);
    const route=scene.seaConnections![0]!,schedule=transportSchedule("SEA",route.fromPortId,route.toPortId);
    const localFrom=local.port.id===schedule.fromId;
    let anchor=TRANSPORT_EPOCH-schedule.offsetMs+(localFrom?0:schedule.dwellMs+schedule.travelMs),started=performance.now();
    await page.route("**/api/**",async request=>{
      if(request.request().url().includes("/events")){await request.continue();return;}
      const response=await request.fetch();
      await request.fulfill({response,headers:{...response.headers(),"x-tasktopia-server-time":String(anchor+performance.now()-started)}});
    });
    expect((await page.request.post("/api/auth/login",{data:{email:user.email,password:"password123"}})).ok()).toBe(true);
    const open=async()=>{
      await page.goto(taskLink(local.countryId,local.port));
      await expect(page.locator("#task-title")).toContainText(local.port.title);
      await page.getByRole("button",{name:"Закрыть",exact:true}).click();
      await expect(page.locator(".world-canvas")).toHaveAttribute("data-city-scene-commit","atomic");
    };
    await open();
    const host=page.locator(".world-canvas");
    await expect(host).toHaveAttribute("data-city-ship-routes","1");
    await expect(host).toHaveAttribute("data-city-ship-phase","STOPPED");
    await expect(host).toHaveAttribute("data-city-ship-route",route.id);
    const stopped=await host.getAttribute("data-city-ship-progress");
    await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
    expect(await host.getAttribute("data-city-ship-progress")).toBe(stopped);
    await page.screenshot({path:info.outputPath("port-ship-docked.png")});
    anchor+=schedule.dwellMs+1000;started=performance.now();await open();
    await expect(host).toHaveAttribute("data-city-ship-phase","MOVING");
    const moving=await host.getAttribute("data-city-ship-progress");
    await expect.poll(()=>host.getAttribute("data-city-ship-progress")).not.toBe(moving);
    await page.screenshot({path:info.outputPath("port-ship-departure.png")});
    await page.getByLabel("Фильтры",{exact:true}).click();
    await page.getByRole("button",{name:"Развитие города",exact:true}).click();
    const panel=page.getByRole("complementary",{name:"Развитие города"});
    await expect(panel.getByText("Морские рейсы",{exact:true})).toBeVisible();
    await expect(panel.locator(`[data-transport-route="${route.id}"]`)).toContainText(ports[1]!.city.name);
    await expect(panel.locator(`[data-transport-route="${route.id}"]`)).toContainText("120 с · стоянка 24 с");
    await page.screenshot({path:info.outputPath("port-development.png")});
    expect(errors).toEqual([]);
  }finally{
    await page.close();
    for(const site of ports)await db.prepare("DELETE FROM countries WHERE id=?").run(site.countryId);
    await db.prepare("DELETE FROM countries WHERE id=?").run(user.countryId);
    await db.prepare("DELETE FROM users WHERE id=?").run(user.id);await db.close();
  }
});

test("creates a coastal country from the landscape picker",async({page},info)=>{
  test.skip(!/^http:\/\/(127\.0\.0\.1|localhost):/.test(process.env.E2E_BASE_URL??""),"Local fixture only");
  const url=process.env.E2E_DATABASE_URL??"postgres://tasktopia:tasktopia@127.0.0.1:55432/tasktopia_test";
  expect(["localhost","127.0.0.1"]).toContain(new URL(url).hostname);
  const db=await createDb(url,{migrate:false});
  const {user}=await registerUser(db,{email:`coastal-picker-${crypto.randomUUID()}@example.test`,name:"Берег",password:"password123"});
  const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
  let countryId:string|undefined;
  try{
    expect((await page.request.post("/api/auth/login",{data:{email:user.email,password:"password123"}})).ok()).toBe(true);
    await page.goto("/");
    await page.locator(".country-title-button").click();
    await page.getByRole("button",{name:"＋ Новая страна",exact:true}).click();
    const dialog=page.getByRole("dialog",{name:"Новая страна"});
    await dialog.getByLabel("Название страны").fill("Морской край");
    await expect(dialog.getByLabel("Ландшафт")).toHaveValue("CLASSIC");
    await dialog.getByLabel("Ландшафт").selectOption("COASTAL");
    await page.screenshot({path:info.outputPath("coastal-country-form.png")});
    await page.setViewportSize({width:390,height:844});
    await expect(dialog.getByLabel("Ландшафт")).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:info.outputPath("coastal-country-form-mobile.png")});
    await dialog.getByRole("button",{name:"Создать страну",exact:true}).click();
    await expect(dialog).toBeHidden();await expect(page.locator(".country-title-button")).toContainText("Морской край");
    const bootstrap=await(await page.request.get("/api/bootstrap")).json();countryId=bootstrap.country.id;
    expect(bootstrap.worldManifest.terrainProfile).toEqual({version:1,kind:"EAST_COAST",coastX:128});
    const service=new AppService(db);
    const city=await service.createCity(countryId!,{name:"Первый приморский город",idempotencyKey:"picker-city"});
    // Open CITY directly: users need not visit PLANET to establish a port's
    // private geographic source. No fixture coast or atlas request is injected.
    await page.reload();
    await page.getByRole("navigation", { name: "Уровень карты" }).getByRole("button", { name: "Город", exact: true }).click();
    await expect(page.locator(".world-canvas")).toHaveAttribute("data-city-scene-commit","atomic");
    expect(await db.prepare("SELECT 1 AS present FROM personal_planet_geography_v1 WHERE user_id=? AND jsonb_extract_path(geography_json,'countries',?,'cities',?) IS NOT NULL")
      .get(user.id,countryId!,city.id)).toEqual({present:1});
    await page.screenshot({path:info.outputPath("coastal-first-city.png")});
    expect(await db.prepare("SELECT terrain_profile_json FROM countries WHERE id=?").get(user.countryId)).toEqual({terrain_profile_json:null});
    expect(errors).toEqual([]);
  }finally{
    await page.close();
    if(countryId)await db.prepare("DELETE FROM countries WHERE id=?").run(countryId);
    await db.prepare("DELETE FROM countries WHERE user_id=?").run(user.id);
    await db.prepare("DELETE FROM users WHERE id=?").run(user.id);await db.close();
  }
});

test("an automatically assigned port keeps its approach clear beside a landward railway",async({page},info)=>{
  test.skip(!/^http:\/\/(127\.0\.0\.1|localhost):/.test(process.env.E2E_BASE_URL??""),"Local fixture only");
  const {coastalPortPair}=await import("../fixtures/coastal-ports");
  const url=process.env.E2E_DATABASE_URL??"postgres://tasktopia:tasktopia@127.0.0.1:55432/tasktopia_test";
  expect(["localhost","127.0.0.1"]).toContain(new URL(url).hostname);
  const db=await createDb(url,{migrate:false});
  const {user,service,sites}=await coastalPortPair(db,false),site=sites[0]!;
  const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
  try{
    let port:Awaited<ReturnType<typeof service.createTask>>|undefined;
    for(let i=0;i<140;i++){
      const task=await service.createTask(site.countryId,{cityId:site.city.id,districtId:site.district.id,title:`Обычная задача ${i+1}`,estimate:1,idempotencyKey:`automatic-${i}`});
      if(task.serviceRole==="PORT"){port=task;break;}
    }
    expect(port).toBeDefined();
    expect((await page.request.post("/api/auth/login",{data:{email:user.email,password:"password123"}})).ok()).toBe(true);
    await page.goto(taskLink(site.countryId,port!));
    await expect(page.locator("#task-title")).toContainText(port!.title);
    await page.getByRole("button",{name:"Закрыть",exact:true}).click();
    const host=page.locator(".world-canvas");await expect(host).toHaveAttribute("data-city-scene-commit","atomic");
    await expect(host).toHaveAttribute("data-city-ports","1");await expect(host).toHaveAttribute("data-city-port-stages","1");
    await expect(host).toHaveAttribute("data-ground-bake-queue","0");
    const scene=await service.getCityScene(site.countryId,site.city.id);
    expect(scene.railway!.axis).toBe("vertical");
    expect(scene.railway!.from.x).toBeLessThan(scene.ports![0]!.plan.terminal.minX);
    await page.screenshot({path:info.outputPath("automatic-port-city.png")});expect(errors).toEqual([]);
  }finally{
    await page.close();for(const item of sites)await db.prepare("DELETE FROM countries WHERE id=?").run(item.countryId);
    await db.prepare("DELETE FROM countries WHERE id=?").run(user.countryId);
    await db.prepare("DELETE FROM users WHERE id=?").run(user.id);await db.close();
  }
});
