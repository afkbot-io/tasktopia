import { openMapCity } from "./map-navigation";
import { expect, test } from "@playwright/test";
test("city development opens lazily and links to existing service tasks", async ({ page }, info) => {
  test.skip(!/^http:\/\/(127\.0\.0\.1|localhost):/.test(process.env.E2E_BASE_URL ?? ""), "Local isolated fixture only");
  const errors: string[] = []; page.on("pageerror", error=>errors.push(error.message));
  await page.request.post("/api/auth/login", { data: { email: "demo@tasktopia.local", password: "tasktopia-demo" } });
  let requests=0; page.on("request",r=>{if(r.url().includes("/api/city-development?"))requests++;});
  await page.goto("/");
  await openMapCity(page);
  await expect(page.locator(".world-canvas")).toHaveAttribute("data-city-scene-commit","atomic");
  expect(requests).toBe(0);
  await page.locator(".game-popover > summary").filter({hasText:"Фильтры"}).click();
  await page.getByRole("button",{name:"Развитие города",exact:true}).click();
  const panel=page.getByRole("complementary",{name:"Развитие города"});
  await expect(panel.getByRole("heading",{name:/Достопримечательности/})).toContainText("20");
  expect(requests).toBe(1);
  await page.screenshot({path:info.outputPath("development.png")});
  await panel.getByRole("button",{name:"Открыть задачу"}).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.locator("#task-title")).toBeVisible();
  await expect(panel).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.setViewportSize({width:390,height:844});
  await page.locator(".game-popover > summary").filter({hasText:"Фильтры"}).click();
  await page.getByRole("button",{name:"Развитие города",exact:true}).click();
  await expect(panel).toBeInViewport();
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("separates city milestones from districts and identifies repeated services", async ({ page }) => {
  test.skip(!/^http:\/\/(127\.0\.0\.1|localhost):/.test(process.env.E2E_BASE_URL ?? ""), "Local isolated fixture only");
  await page.request.post("/api/auth/login", { data: { email: "demo@tasktopia.local", password: "tasktopia-demo" } });
  await page.route("**/api/city-development?*", route => route.fulfill({ json: {
    revision: 1,
    districts: ["Северный", "Южный"].map((name, i) => ({ id: `district-${i}`, name, milestones: [
      { id: "city:RAILWAY:6", role: "RAILWAY", count: 4, required: 6, unit: "CITY_BLOCKS", eligible: false },
      { id: `district-${i}:POLICE`, role: "POLICE", count: 10, required: 19, unit: "BUILDINGS", eligible: false },
    ] })),
    services: [0, 1].map(i => ({ role: "EDUCATION", districtId: `district-${i}`, state: "READY" })), landmarks: [],
  } }));
  await page.goto("/");
  await openMapCity(page);
  await page.locator(".game-popover > summary").filter({hasText:"Фильтры"}).click();
  await page.getByRole("button", { name: "Развитие города", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "Развитие города" });
  await expect(panel.getByText("Вокзал", { exact: true })).toHaveCount(1);
  await expect(panel.getByText("Полиция", { exact: true })).toHaveCount(2);
  await expect(panel.getByText("Готово · Северный", { exact: true })).toBeVisible();
  await expect(panel.getByText("Готово · Южный", { exact: true })).toBeVisible();
});

test("transport cards explain paired routes and waiting infrastructure on mobile", async ({page}, info) => {
  test.skip(!/^http:\/\/(127\.0\.0\.1|localhost):/.test(process.env.E2E_BASE_URL ?? ""), "Local isolated fixture only");
  const errors: string[] = []; page.on("pageerror",error=>errors.push(error.message));
  await page.request.post("/api/auth/login", {data:{email:"demo@tasktopia.local",password:"tasktopia-demo"}});
  await page.setViewportSize({width:390,height:844});
  await page.route("**/api/city-development?*", route=>route.fulfill({json:{revision:1,districts:[],services:[],landmarks:[],transport:[
    {kind:"AIR",state:"NO_CONNECTION",routes:[]},
    {kind:"RAIL",state:"CONNECTED",routes:[{id:"rail:one:two",destinationCityId:"two",destinationName:"Приморский город",travelMs:90000,dwellMs:12000}]},
  ]}}));
  await page.goto("/");
  await openMapCity(page);
  await page.locator(".game-popover > summary").filter({hasText:"Фильтры"}).click();
  await page.getByRole("button",{name:"Развитие города",exact:true}).click();
  const section=page.getByRole("region",{name:"Транспортные направления"});
  await expect(section.getByText("↔ Приморский город",{exact:true})).toBeVisible();
  await expect(section.getByText(/В пути · 90 с · стоянка 12 с/)).toBeVisible();
  await expect(section.getByText(/Нужен ещё один готовый аэропорт/)).toBeVisible();
  const panel=page.getByRole("complementary",{name:"Развитие города"});
  expect(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  await page.screenshot({path:info.outputPath("transport-cards-mobile.png")});
  await page.keyboard.press("Escape");await expect(panel).toHaveCount(0);
  expect(errors).toEqual([]);
});
