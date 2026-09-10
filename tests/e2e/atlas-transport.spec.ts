import {expect,test} from "@playwright/test";
import {mkdir, writeFile} from "node:fs/promises";
import { transportAtlasFixture } from "../fixtures/atlas-transport";
import type {CountryOverviewDto} from "../../src/shared/country-overview-contract";
import {decodeCountryTerrain} from "../../src/shared/country-overview-contract";

// Render fixture only: API source/auth/completion are covered by planet-atlas-route.test.ts.
// No production state or test database rows are mutated by this scenario.
test("small atlas labels, land railways and visible air/sea traffic",async({page}, info)=>{
  test.setTimeout(120_000);
  await mkdir("screenshots/atlas-transport",{recursive:true});
  // Keep the browser clock real: this scenario verifies live SVG SMIL motion.
  const errors:string[]=[];
  page.on("pageerror",e=>errors.push(e.message));page.on("console",m=>{if(m.type()==="error")errors.push(m.text());});
  expect((await page.request.post("/api/auth/login",{data:{email:"demo@tasktopia.local",password:"tasktopia-demo"}})).ok()).toBe(true);
  const bootstrap=await(await page.request.get("/api/bootstrap")).json();
  const overview=await(await page.request.get(`/api/countries/${bootstrap.country.id}/overview`)).json() as CountryOverviewDto;
  const atlas = transportAtlasFixture();
  const original=overview.cities[0]!;
  const dry=Array.from(overview.geography.terrainCodes).flatMap((code,index)=>["grass","meadow","forest"].includes(decodeCountryTerrain(code))?[index]:[]);
  overview.cities=[dry[Math.floor(dry.length*.3)]!,dry[Math.floor(dry.length*.7)]!].map((index,i)=>({...structuredClone(original),id:i===0?original.id:"fixture-second-city",name:i===0?"Речной":"Приморский",atlasCenter:{x:(index%overview.geography.columns+.5)*overview.geography.cellSize,y:(Math.floor(index/overview.geography.columns)+.5)*overview.geography.cellSize},miniature:{...original.miniature,columns:8,rows:8,blocks:original.miniature.blocks.slice(0,3).map((b,n)=>({...b,x:3+n,y:3})),airports:[{taskId:`airport-${i}`,x:4,y:4}],stations:[{taskId:`station-${i}`,x:4,y:4}]}}));
  overview.connections=[{fromCityId:overview.cities[0]!.id,toCityId:overview.cities[1]!.id}];overview.revision+="-transport-fixture";
  await page.route("**/api/planet-atlas",route=>route.fulfill({json:atlas}));
  await page.route(`**/api/countries/${bootstrap.country.id}/overview`,route=>route.fulfill({json:overview}));
  await page.goto("/");
  await expect(page.locator(".world-canvas")).toHaveAttribute("data-city-scene-commit","atomic", { timeout: 60_000 });
  await page.mouse.move(10,20);await page.screenshot({path:"screenshots/atlas-transport/city.png"});
  await page.getByRole("button",{name:"Страна",exact:true}).click();
  const country=page.locator(".country-overview");await expect(country).toHaveAttribute("data-country-ready","true", { timeout: 30_000 });
  await expect(page.locator(".map-level-transition")).toHaveCount(0);
  await expect.poll(async()=>Number(await country.getAttribute("data-country-railways"))).toBeGreaterThan(0);
  const plane=page.locator(".country-atlas-aircraft").first();await expect(plane).toBeVisible();
  const first=await plane.getAttribute("style");await expect.poll(()=>plane.getAttribute("style")).not.toBe(first);
  const glyph = page.locator(".country-city-glyph").first();
  const glyphBefore = (await glyph.boundingBox())!;
  const countryZoom = await country.getAttribute("data-country-zoom");
  await page.mouse.move(700, 400); await page.mouse.wheel(0, -220);
  await expect.poll(() => country.getAttribute("data-country-zoom")).not.toBe(countryZoom);
  const glyphAfter = (await glyph.boundingBox())!;
  expect(glyphAfter.width).toBeGreaterThan(glyphBefore.width); expect(glyphAfter.height).toBeGreaterThan(glyphBefore.height);
  await page.screenshot({path:`screenshots/atlas-transport/country-${info.project.name}.png`});
  await page.getByRole("button",{name:"Планета",exact:true}).click();
  const planet=page.locator(".planet-atlas");await expect(planet).toHaveAttribute("data-planet-ready","true", { timeout: 30_000 });await expect(page.locator(".map-level-transition")).toHaveCount(0);
  await expect.poll(async()=>Number(await planet.getAttribute("data-planet-railways"))).toBeGreaterThan(0);
  await expect.poll(async()=>Number(await planet.getAttribute("data-planet-ships"))).toBeGreaterThan(0);
  expect(await page.locator(".planet-ships image").count()).toBeGreaterThan(0);
  await expect(page.locator(".planet-country-label .atlas-overview-card-hit").first()).toHaveAttribute("width","84");
  const ship=page.locator(".planet-ships > g").first();
  const position=()=>ship.evaluate(el=>{const m=(el as SVGGraphicsElement).getCTM()!;return[m.e,m.f];});
  const shipBefore=await position();await expect.poll(position).not.toEqual(shipBefore);
  const house = page.locator(".planet-district-houses image").first();
  const houseBefore = (await house.boundingBox())!;
  const planetZoom = await planet.getAttribute("data-globe-zoom");
  await page.mouse.move(700, 400); await page.mouse.wheel(0, -220);
  await expect.poll(() => planet.getAttribute("data-globe-zoom")).not.toBe(planetZoom);
  const houseAfter = (await house.boundingBox())!;
  expect(houseAfter.width).toBeGreaterThan(houseBefore.width); expect(houseAfter.height).toBeGreaterThan(houseBefore.height);
  await page.screenshot({path:`screenshots/atlas-transport/planet-${info.project.name}.png`});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:"screenshots/atlas-transport/mobile.png"});
  expect(errors).toEqual([]);
});

test("dense country keeps navigation bounded and directory usable", async ({ page }, info) => {
  test.setTimeout(120_000);
  expect((await page.request.post("/api/auth/login", { data: { email: "demo@tasktopia.local", password: "tasktopia-demo" } })).ok()).toBe(true);
  const bootstrap = await (await page.request.get("/api/bootstrap")).json();
  const overview = await (await page.request.get(`/api/countries/${bootstrap.country.id}/overview`)).json() as CountryOverviewDto;
  const original = overview.cities[0]!;
  const dry = Array.from(overview.geography.terrainCodes).flatMap((code, i) => ["grass", "meadow", "forest"].includes(decodeCountryTerrain(code)) ? [i] : []);
  overview.cities = Array.from({ length: 150 }, (_, i) => {
    const cell = dry[Math.floor(i * dry.length / 150)]!;
    return { ...structuredClone(original), id: i ? `dense-city-${i}` : original.id, name: `Город ${i + 1}`,
      atlasCenter: { x: (cell % overview.geography.columns + .5) * overview.geography.cellSize, y: (Math.floor(cell / overview.geography.columns) + .5) * overview.geography.cellSize },
      miniature: { ...original.miniature, airports: [], stations: [] } };
  });
  overview.connections = []; overview.revision += "-dense-150";
  await page.route(`**/api/countries/${bootstrap.country.id}/overview`, route => route.fulfill({ json: overview }));
  await page.goto("/");
  await expect(page.locator(".world-canvas")).toHaveAttribute("data-city-scene-commit", "atomic", { timeout: 60_000 });
  await page.getByRole("button", { name: "Страна", exact: true }).click();
  const host = page.locator(".country-overview");
  await expect(host).toHaveAttribute("data-country-ready", "true", { timeout: 30_000 });
  await expect(page.locator(".map-level-transition")).toHaveCount(0);
  await expect(page.locator(".country-city-glyph")).toHaveCount(150);
  const before = await page.locator(".country-overview").getAttribute("style");
  await page.mouse.move(400, 150); await page.mouse.down(); await page.mouse.move(600, 150, { steps: 12 }); await page.mouse.up();
  await expect.poll(() => page.locator(".country-overview").getAttribute("style")).not.toBe(before);
  const timing = Number(await host.getAttribute("data-country-camera-frame-max-ms"));
  expect(timing).toBeLessThan(100); // 150 cached glyphs; avoid main-thread stalls during pan.
  await page.locator(".country-city-directory-toggle").click();
  await page.getByLabel("Найти город").fill("Город 150");
  await expect(page.locator(".country-city-directory-results button")).toHaveCount(1);
  await mkdir("screenshots/atlas-transport", { recursive: true });
  await page.screenshot({ path: `screenshots/atlas-transport/dense-${info.project.name}.png` });
  await writeFile(`screenshots/atlas-transport/timing-${info.project.name}.json`, JSON.stringify({ cities: 150, maxCameraFrameMs: timing }, null, 2) + "\n");
  await info.attach("dense-country-timing", { body: JSON.stringify({ cities: 150, maxCameraFrameMs: timing }), contentType: "application/json" });
});
