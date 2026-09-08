import {expect,test} from "@playwright/test";
import {mkdir} from "node:fs/promises";
import type {PlanetAtlasDto} from "../../src/shared/planet-atlas-contract";
import type {CountryOverviewDto} from "../../src/shared/country-overview-contract";
import {decodeCountryTerrain} from "../../src/shared/country-overview-contract";

// Render fixture only: API source/auth/completion are covered by planet-atlas-route.test.ts.
// No production state or test database rows are mutated by this scenario.
test("small atlas labels, land railways and visible air/sea traffic",async({page})=>{
  await mkdir("screenshots/atlas-transport",{recursive:true});
  const errors:string[]=[];
  page.on("pageerror",e=>errors.push(e.message));page.on("console",m=>{if(m.type()==="error")errors.push(m.text());});
  await page.clock.setFixedTime(new Date("2026-09-08T10:00:00Z"));
  expect((await page.request.post("/api/auth/login",{data:{email:"demo@tasktopia.local",password:"tasktopia-demo"}})).ok()).toBe(true);
  const bootstrap=await(await page.request.get("/api/bootstrap")).json();
  const overview=await(await page.request.get(`/api/countries/${bootstrap.country.id}/overview`)).json() as CountryOverviewDto;
  const atlas=await(await page.request.get("/api/planet-atlas")).json() as PlanetAtlasDto;
  const original=overview.cities[0]!;
  const dry=Array.from(overview.geography.terrainCodes).flatMap((code,index)=>["grass","meadow","forest"].includes(decodeCountryTerrain(code))?[index]:[]);
  overview.cities=[dry[Math.floor(dry.length*.3)]!,dry[Math.floor(dry.length*.7)]!].map((index,i)=>({...structuredClone(original),id:i===0?original.id:"fixture-second-city",name:i===0?"Речной":"Приморский",atlasCenter:{x:(index%overview.geography.columns+.5)*overview.geography.cellSize,y:(Math.floor(index/overview.geography.columns)+.5)*overview.geography.cellSize},miniature:{...original.miniature,columns:8,rows:8,blocks:original.miniature.blocks.slice(0,3).map((b,n)=>({...b,x:3+n,y:3})),airports:[{taskId:`airport-${i}`,x:4,y:4}],stations:[{taskId:`station-${i}`,x:4,y:4}]}}));
  overview.connections=[{fromCityId:overview.cities[0]!.id,toCityId:overview.cities[1]!.id}];overview.revision+="-transport-fixture";
  const source=atlas.countries[0]!;
  atlas.countries=Array.from({length:4},(_,i)=>({...structuredClone(source),id:i===0?source.id:`fixture-country-${i}`,name:["Дедлайново","Северия","Островная","Приморье"][i]!,seed:11+i*11,worldBounds:{minX:0,minY:0,maxX:100,maxY:100},cityCount:2,cities:[20,80].map((x,j)=>({id:`city-${i}-${j}`,center:{x,y:50},districts:[{id:`d-${i}-${j}`,center:{x,y:50}}],airports:[{taskId:`airport-${i}-${j}`,center:{x,y:50}}],stations:[{taskId:`station-${i}-${j}`,center:{x,y:50}}]}))}));
  atlas.revision+="-transport-fixture";atlas.planetSeed=782441;
  await page.route("**/api/planet-atlas",route=>route.fulfill({json:atlas}));
  await page.route(`**/api/countries/${bootstrap.country.id}/overview`,route=>route.fulfill({json:overview}));
  await page.goto("/");
  await expect(page.locator(".world-canvas")).toHaveAttribute("data-city-scene-commit","atomic");
  await page.mouse.move(10,20);await page.screenshot({path:"screenshots/atlas-transport/city.png"});
  await page.getByRole("button",{name:"Страна",exact:true}).click();
  const country=page.locator(".country-overview");await expect(country).toHaveAttribute("data-country-ready","true");
  await expect(page.locator(".map-level-transition")).toHaveCount(0);
  await expect.poll(async()=>Number(await country.getAttribute("data-country-railways"))).toBeGreaterThan(0);
  const plane=page.locator(".country-atlas-aircraft").first();await expect(plane).toBeVisible();
  const first=await plane.getAttribute("style");await expect.poll(()=>plane.getAttribute("style")).not.toBe(first);
  await page.screenshot({path:"screenshots/atlas-transport/country.png"});
  await page.getByRole("button",{name:"Планета",exact:true}).click();
  const planet=page.locator(".planet-atlas");await expect(planet).toHaveAttribute("data-planet-ready","true");await expect(page.locator(".map-level-transition")).toHaveCount(0);
  await expect.poll(async()=>Number(await planet.getAttribute("data-planet-railways"))).toBeGreaterThan(0);
  await expect.poll(async()=>Number(await planet.getAttribute("data-planet-ships"))).toBeGreaterThan(0);
  expect(await page.locator(".planet-ships image").count()).toBeGreaterThan(0);
  await expect(page.locator(".planet-country-label .atlas-overview-card-hit").first()).toHaveAttribute("width","84");
  const ship=page.locator(".planet-ships > g").first();
  const position=()=>ship.evaluate(el=>{const m=(el as SVGGraphicsElement).getCTM()!;return[m.e,m.f];});
  const shipBefore=await position();await expect.poll(position).not.toEqual(shipBefore);
  await page.screenshot({path:"screenshots/atlas-transport/planet.png"});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:"screenshots/atlas-transport/mobile.png"});
  expect(errors).toEqual([]);
});
