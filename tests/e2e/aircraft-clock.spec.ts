import { expect,test } from "@playwright/test";
import { transportSchedule,TRANSPORT_EPOCH } from "../../src/shared/transport-schedule";
import type { PlanetAtlasDto } from "../../src/shared/planet-atlas-contract";
import type { CitySceneDto } from "../../src/shared/city-scene-contract";
import type { CountryOverviewDto } from "../../src/shared/country-overview-contract";
test("CITY, COUNTRY and PLANET resume the same airport pair phase after a reload",async({page})=>{
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
    }else if(/\/countries\/[^/]+\/overview(?:\?|$)/.test(route.request().url())){
      const overview=await response.json() as CountryOverviewDto;
      if(overview.cities.length===1){
        const other=structuredClone(overview.cities[0]!);other.id="qa-other-city";other.name="QA second city";other.atlasCenter.x+=12;overview.cities.push(other);
      }
      const [from,to]=overview.cities;
      for(const city of overview.cities)city.miniature.airports=[];
      from!.miniature.airports=[{taskId:"qa-air-a",x:from!.miniature.columns/2,y:from!.miniature.rows/2}];
      to!.miniature.airports=[{taskId:"qa-air-b",x:to!.miniature.columns/2,y:to!.miniature.rows/2}];
      overview.connections=[{fromCityId:from!.id,toCityId:to!.id}];
      await route.fulfill({response,headers,json:overview});
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
  const city=page.locator(".world-canvas");
  await expect(city).toHaveAttribute("data-airplane-route",schedule.id);
  const before=Number(await city.getAttribute("data-airplane-progress"));
  expect(before).toBeGreaterThan(.35);expect(before).toBeLessThan(.7);
  await page.getByRole("button",{name:"Страна",exact:true}).click();
  const plane=page.locator(`.country-atlas-aircraft[data-route-id="${schedule.id}"]`);
  await expect(plane).toBeVisible();
  const after=Number(await plane.getAttribute("data-progress"));
  expect(after).toBeGreaterThanOrEqual(before-.01);expect(after-before).toBeLessThan(.15);
  await page.getByRole("button",{name:"Планета",exact:true}).click();
  const planetPlane=page.locator(`.planet-routes .atlas-aircraft-flight[data-route-id="${schedule.id}"]`);
  await expect(planetPlane).toBeVisible();
  await expect(planetPlane).toHaveCount(1);
  const planetProgress=Number(await planetPlane.getAttribute("data-progress"));
  expect(planetProgress).toBeGreaterThanOrEqual(after-.01);expect(planetProgress-after).toBeLessThan(.15);
  await page.reload();
  await page.getByRole("button",{name:"Город",exact:true}).click();
  await expect(city).toHaveAttribute("data-airplane-route",schedule.id);
  expect(Number(await city.getAttribute("data-airplane-progress"))).toBeGreaterThanOrEqual(after-.01);
  expect(errors).toEqual([]);
});
