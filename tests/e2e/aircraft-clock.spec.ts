import { openMapCity, openMapPlanet } from "./map-navigation";
import { expect,test } from "@playwright/test";
import { sampleTransportSchedule,transportSchedule,TRANSPORT_EPOCH } from "../../src/shared/transport-schedule";
import type { PlanetAtlasDto } from "../../src/shared/planet-atlas-contract";
import type { CitySceneDto } from "../../src/shared/city-scene-contract";
test("CITY and PLANET resume the same airport pair phase after a reload",async({page})=>{
  test.skip(!/^http:\/\/(127\.0\.0\.1|localhost):/.test(process.env.E2E_BASE_URL??""),"Local scene fixture only");
  await page.request.post("/api/auth/login",{data:{email:"demo@tasktopia.local",password:"tasktopia-demo"}});
  const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
  await page.clock.setFixedTime(new Date("2035-01-01T00:00:00Z"));
  const schedule=transportSchedule("AIR","qa-air-a","qa-air-b"), started=performance.now();
  const anchor=TRANSPORT_EPOCH-schedule.offsetMs+schedule.dwellMs+schedule.travelMs*.4;
  await page.route("**/api/**",async route=>{
    const response=await route.fetch(),headers={...response.headers(),"cache-control":"private, no-store","x-tasktopia-server-time":String(anchor+performance.now()-started)};
    if(/\/cities\/[^/]+\/scene(?:\?|$)/.test(route.request().url())){
      const scene=await response.json() as CitySceneDto;
      const from={taskId:"qa-air-a",cityId:scene.city.id,point:scene.city.center};
      const to={taskId:"qa-air-b",cityId:"remote",point:{x:scene.city.center.x+30,y:scene.city.center.y+30}};
      scene.airportConnections=[{id:"qa-air-a:qa-air-b",from,to},{id:"qa-air-b:qa-air-a",from:to,to:from}];
      await route.fulfill({response,headers,json:scene});
    }else if(/\/api\/planet-atlas(?:\?|$)/.test(route.request().url())){
      const atlas=await response.json() as PlanetAtlasDto;
      for(const country of atlas.countries)for(const city of country.cities)city.airports=[];
      const city=atlas.countries[0]!.cities[0]!;
      city.airports=[{taskId:"qa-air-a",center:{...city.center}}];
      const remote={...structuredClone(city),id:"qa-remote-city",center:{x:city.center.x+30,y:city.center.y+30}};
      remote.airports=[{taskId:"qa-air-b",center:remote.center}];
      atlas.countries[0]!.cities.push(remote);
      const saved=atlas.geography?.countries[atlas.countries[0]!.id];
      if(saved){const old=saved.cities[city.id]!;saved.cities[remote.id]={sourceCenter:remote.center,point:{x:old.point.x+24,y:old.point.y+24}};}
      await route.fulfill({response,headers,json:atlas});
    }else await route.fulfill({response,headers});
  });
  await page.goto("/");
  await openMapCity(page);
  const city=page.locator(".world-canvas");
  await expect(city).toHaveAttribute("data-airplane-route",schedule.id);
  const before=Number(await city.getAttribute("data-airplane-progress"));
  expect(before).toBeGreaterThan(.35);expect(before).toBeLessThan(.7);
  await openMapPlanet(page);
  const planetPlane=page.locator(`.planet-routes .atlas-aircraft-flight[data-route-id="${schedule.id}"]`);
  await expect(planetPlane).toBeVisible();
  await expect(planetPlane).toHaveCount(1);
  const planetProgress=Number(await planetPlane.getAttribute("data-progress"));
  expect(planetProgress).toBeGreaterThanOrEqual(before-.01);expect(planetProgress-before).toBeLessThan(.15);
  await page.reload();
  await openMapCity(page);
  await expect(city).toHaveAttribute("data-city-scene-commit","atomic");
  await expect(city).toHaveAttribute("data-ambient-assets","ready");
  // Slow CI may cross arrival while reloading. Compare with the server phase,
  // not a monotonic progress assumption across the flight's dwell/return cycle.
  await expect.poll(async()=>{
    const actual=await city.evaluate(node=>({route:node.getAttribute("data-airplane-route"),progress:node.getAttribute("data-airplane-progress")}));
    const expected=sampleTransportSchedule(schedule,anchor+performance.now()-started);
    if(expected.phase!=="MOVING")return actual.route===null;
    const progress=expected.direction===1?expected.progress:1-expected.progress;
    return actual.route===schedule.id&&actual.progress!==null&&Math.abs(Number(actual.progress)-progress)<.05;
  }).toBe(true);
  expect(errors).toEqual([]);
});
