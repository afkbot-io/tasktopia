import { transportSchedule,TRANSPORT_EPOCH } from "../../src/shared/transport-schedule";
import {expect,test} from "@playwright/test";
import {mkdir} from "node:fs/promises";
import { transportAtlasFixture } from "../fixtures/atlas-transport";

// Render fixture only: API source/auth/completion are covered by planet-atlas-route.test.ts.
// No production state or test database rows are mutated by this scenario.
test("small atlas labels, land railways and visible air/sea traffic",async({page}, info)=>{
  test.setTimeout(120_000);
  await mkdir("screenshots/atlas-transport",{recursive:true});
  // Keep browser animation time real; pin only the shared departure epoch.
  const errors:string[]=[];
  page.on("pageerror",e=>errors.push(e.message));page.on("console",m=>{if(m.type()==="error")errors.push(m.text());});
  expect((await page.request.post("/api/auth/login",{data:{email:"demo@tasktopia.local",password:"tasktopia-demo"}})).ok()).toBe(true);
  const atlas = transportAtlasFixture();
  const schedule=transportSchedule("AIR","airport-0","airport-1"),started=performance.now();
  // Preserve the AIR phase while selecting a SEA departure with enough travel
  // time for the viewport/reduced-motion checks before its scheduled stop.
  const anchor=TRANSPORT_EPOCH-schedule.offsetMs+schedule.dwellMs+schedule.travelMs*.3
    +2*(2*(schedule.travelMs+schedule.dwellMs)+schedule.gapMs);
  await page.route("**/api/**",async route=>{
    if(route.request().url().includes("/events")){await route.continue();return;}
    const response=await route.fetch();
    const headers={...response.headers(),"cache-control":"private, no-store","x-tasktopia-server-time":String(anchor+performance.now()-started)};
    if(route.request().url().endsWith("/planet-atlas"))await route.fulfill({response,headers,json:atlas});
    else await route.fulfill({response,headers});
  });
  await page.goto("/");
  const planet=page.locator(".planet-atlas");await expect(planet).toHaveAttribute("data-planet-ready","true", { timeout: 30_000 });await expect(page.locator(".map-level-transition")).toHaveCount(0);
  await expect.poll(async()=>Number(await planet.getAttribute("data-planet-railways"))).toBeGreaterThan(0);
  await expect.poll(async()=>Number(await planet.getAttribute("data-planet-ships"))).toBeGreaterThan(0);
  expect(await page.locator(".planet-ships image").count()).toBeGreaterThan(0);
  const ship=page.locator(".planet-ships > g").first();
  const position=()=>ship.evaluate(el=>{const m=(el as SVGGraphicsElement).getCTM()!;return[m.e,m.f];});
  const shipBefore=await position();await expect.poll(position).not.toEqual(shipBefore);
  const house = page.locator(".planet-district-houses [data-miniature-module]").first();
  const houseBefore = (await house.boundingBox())!;
  const planetZoom = await planet.getAttribute("data-globe-zoom");
  await page.mouse.move(700, 400); await page.mouse.wheel(0, -220);
  await expect.poll(() => planet.getAttribute("data-globe-zoom")).not.toBe(planetZoom);
  const houseAfter = (await house.boundingBox())!;
  expect(houseAfter.width).toBeGreaterThan(houseBefore.width); expect(houseAfter.height).toBeGreaterThan(houseBefore.height);
  const zoomedShip=await position();await expect.poll(position).not.toEqual(zoomedShip);
  await page.emulateMedia({reducedMotion:"reduce"});
  await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  const still=await ship.getAttribute("data-progress");
  await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  expect(await ship.getAttribute("data-progress")).toEqual(still);
  await page.emulateMedia({reducedMotion:"no-preference"});await expect.poll(()=>ship.getAttribute("data-progress")).not.toEqual(still);
  await page.screenshot({path:`screenshots/atlas-transport/planet-${info.project.name}.png`});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:"screenshots/atlas-transport/mobile.png"});
  expect(errors).toEqual([]);
});
