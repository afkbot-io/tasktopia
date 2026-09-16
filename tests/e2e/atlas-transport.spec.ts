import { transportSchedule,TRANSPORT_EPOCH } from "../../src/shared/transport-schedule";
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
  // Keep browser animation time real; pin only the shared departure epoch.
  const errors:string[]=[];
  page.on("pageerror",e=>errors.push(e.message));page.on("console",m=>{if(m.type()==="error")errors.push(m.text());});
  expect((await page.request.post("/api/auth/login",{data:{email:"demo@tasktopia.local",password:"tasktopia-demo"}})).ok()).toBe(true);
  const bootstrap=await(await page.request.get("/api/bootstrap")).json();
  const overview=await(await page.request.get(`/api/countries/${bootstrap.country.id}/overview`)).json() as CountryOverviewDto;
  const atlas = transportAtlasFixture();
  const original=overview.cities[0]!;
  const dry=Array.from(overview.geography.terrainCodes).flatMap((code,index)=>["grass","meadow","forest"].includes(decodeCountryTerrain(code))?[index]:[]);
  overview.cities=[dry[Math.floor(dry.length*.3)]!,dry[Math.floor(dry.length*.7)]!].map((index,i)=>({...structuredClone(original),id:i===0?original.id:"fixture-second-city",name:i===0?"Речной":"Приморский",atlasCenter:{x:(index%overview.geography.columns+.5)*overview.geography.cellSize,y:(Math.floor(index/overview.geography.columns)+.5)*overview.geography.cellSize},miniature:{...original.miniature,columns:8,rows:8,blocks:original.miniature.blocks.slice(0,3).map((b,n)=>({...b,x:3+n,y:3})),airports:[{taskId:`airport-${i}`,x:4,y:4}],stations:[{taskId:`station-${i}`,x:4,y:4}]}}));
  overview.connections=[{fromCityId:overview.cities[0]!.id,toCityId:overview.cities[1]!.id}];overview.railConnections=undefined;overview.revision+="-transport-fixture";
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
    else if(route.request().url().includes(`/countries/${bootstrap.country.id}/overview`))await route.fulfill({response,headers,json:overview});
    else await route.fulfill({response,headers});
  });
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

test("country renders a foreign flight without inventing a local destination city",async({page})=>{
  test.skip(!/^http:\/\/(127\.0\.0\.1|localhost):/.test(process.env.E2E_BASE_URL ?? ""),"Local fixture only");
  const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
  await page.request.post("/api/auth/login",{data:{email:"demo@tasktopia.local",password:"tasktopia-demo"}});
  const bootstrap=await(await page.request.get("/api/bootstrap")).json();
  const overview=await(await page.request.get(`/api/countries/${bootstrap.country.id}/overview`)).json() as CountryOverviewDto;
  const local=overview.cities[0]!;
  local.miniature.airports=[{taskId:"local-airport",x:local.miniature.columns/2,y:local.miniature.rows/2}];
  overview.connections=[{fromCityId:local.id,toCityId:"foreign-city",fromAirportId:"local-airport",toAirportId:"remote-airport",toCityName:"Удалённый город",toPoint:{x:local.atlasCenter.x+480,y:local.atlasCenter.y}}];
  overview.revision+="-foreign-flight";
  const schedule=transportSchedule("AIR","local-airport","remote-airport");
  const epoch=TRANSPORT_EPOCH-schedule.offsetMs+schedule.dwellMs+1000,started=performance.now();
  await page.route("**/api/**",async route=>{
    if(route.request().url().includes("/events")){await route.continue();return;}
    const response=await route.fetch();
    const headers={...response.headers(),"cache-control":"private, no-store","x-tasktopia-server-time":String(epoch+performance.now()-started)};
    if(route.request().url().includes(`/countries/${bootstrap.country.id}/overview`))await route.fulfill({response,headers,json:overview});
    else await route.fulfill({response,headers});
  });
  await page.goto("/");await page.getByRole("button",{name:"Страна",exact:true}).click();
  const country=page.locator(".country-overview");await expect(country).toHaveAttribute("data-country-ready","true");
  await expect(country).toHaveAttribute("data-country-flights","1");
  const plane=page.locator(".country-atlas-aircraft");await expect(plane).toHaveAttribute("data-route-id",schedule.id);
  const before=await plane.getAttribute("style");await expect.poll(()=>plane.getAttribute("style")).not.toBe(before);
  await page.mouse.move(650,420);await page.mouse.wheel(0,-150);
  await expect(plane).toHaveAttribute("data-route-id",schedule.id);
  await expect(page.getByText("Удалённый город",{exact:true})).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("country ships follow the visible part of the shared ocean voyage",async({page},info)=>{
  const {projectPlanetAtlas}=await import("../../src/shared/planet-atlas");
  const {buildPlanetSeaRoutes}=await import("../../src/shared/planet-port-transport");
  const {buildCountryGeography,countryMacroContext}=await import("../../src/server/world/country-geography");
  const {projectForeignSea}=await import("../../src/server/world/country-foreign-rail");
  const {encodeCountryTerrain}=await import("../../src/shared/country-overview-contract");
  expect((await page.request.post("/api/auth/login",{data:{email:"demo@tasktopia.local",password:"tasktopia-demo"}})).ok()).toBe(true);
  const bootstrap=await(await page.request.get("/api/bootstrap")).json();
  const overview=await(await page.request.get(`/api/countries/${bootstrap.country.id}/overview`)).json() as CountryOverviewDto;
  const atlas=projectPlanetAtlas(transportAtlasFixture()),route=buildPlanetSeaRoutes(atlas)[0]!;
  const geography=buildCountryGeography({countryId:route.fromCountryId,seed:1,macroCells:countryMacroContext(atlas,route.fromCountryId)});
  const segment=projectForeignSea(route.points,atlas.oceanCells.map(c=>({...c,id:`ocean:${c.q}:${c.r}`})),geography,atlas.hexRadius,true)!;
  expect(segment.progressRange[0]).toBe(0);
  overview.geography={...geography.grid,terrainCodes:encodeCountryTerrain(geography.cells.map(c=>c.terrain)),territoryCodes:geography.cells.map(c=>c.selected?"1":"0").join("")};
  overview.bounds={minX:0,minY:0,maxX:144,maxY:88};
  overview.cities=[];overview.connections=[];overview.railConnections=[];overview.groundRoads.routes=[];
  overview.seaConnections=[{...route,...segment}];overview.revision+="-marine";
  const schedule=transportSchedule("SEA",route.fromPortId,route.toPortId);
  let started=0;
  const anchor=TRANSPORT_EPOCH-schedule.offsetMs+schedule.dwellMs+schedule.travelMs*.005;
  await page.route("**/api/**",async request=>{
    if(request.request().url().includes("/events")){await request.continue();return;}
    const response=await request.fetch();
    const isOverview=request.request().url().includes(`/countries/${bootstrap.country.id}/overview`);
    if(isOverview&&!started)started=performance.now();
    const headers={...response.headers(),"x-tasktopia-server-time":String(anchor+(started?performance.now()-started:0))};
    await request.fulfill({response,headers,...(isOverview?{json:overview}:{})});
  });
  let invalidate: (()=>void)|undefined;
  await page.routeWebSocket("**/socket.io/**",socket=>{
    socket.connectToServer();
    invalidate=()=>socket.send('42["atlas:invalidate"]');
  });
  const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
  await page.goto("/");await expect(page.locator(".world-canvas")).toHaveAttribute("data-city-scene-commit","atomic",{timeout:60_000});
  await page.getByRole("button",{name:"Страна",exact:true}).click();
  await expect(page.locator(".country-overview")).toHaveAttribute("data-country-ready","true");
  const ship=page.locator(".country-atlas-ship");await expect(ship).toBeVisible();
  await expect(ship).toHaveAttribute("data-route-id",route.id);await expect(ship).toHaveAttribute("data-phase","MOVING");
  const before=await ship.getAttribute("data-progress");await expect.poll(()=>ship.getAttribute("data-progress")).not.toEqual(before);
  await page.emulateMedia({reducedMotion:"reduce"});
  await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  const still=await ship.getAttribute("data-progress");
  await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  expect(await ship.getAttribute("data-progress")).toBe(still);
  const oldBox=(await ship.boundingBox())!;
  await page.mouse.move(700,400);await page.mouse.wheel(0,-100);
  await expect.poll(async()=>(await ship.boundingBox())!.width).toBeGreaterThan(oldBox.width);
  expect(await ship.getAttribute("data-progress")).toBe(still);
  await mkdir("screenshots/atlas-transport",{recursive:true});await page.screenshot({path:`screenshots/atlas-transport/country-sea-${info.project.name}.png`});
  await expect.poll(()=>Boolean(invalidate)).toBe(true);
  const connections=overview.seaConnections;
  overview.seaConnections=[];overview.revision+="-closed";
  invalidate!();
  await expect(ship).toHaveCount(0);
  overview.seaConnections=connections;overview.revision+="-reopened";
  invalidate!();
  await expect(ship).toBeVisible();
  await expect(ship).toHaveAttribute("data-route-id",route.id);
  expect(errors).toEqual([]);
});
