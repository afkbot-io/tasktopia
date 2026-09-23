import { transportSchedule,TRANSPORT_EPOCH } from "../../src/shared/transport-schedule";
import { test, expect } from "@playwright/test";
import type { CitySceneDto } from "../../src/shared/city-scene-contract";
import { planCityRailway } from "../../src/client/city-railway";
test("server time preserves a platform stop across remount despite a wrong device clock",async({page})=>{
  test.skip(!/^http:\/\/(127\.0\.0\.1|localhost):/.test(process.env.E2E_BASE_URL ?? ""),"Local scene fixture only");
  await page.request.post("/api/auth/login",{data:{email:"demo@tasktopia.local",password:"tasktopia-demo"}});
  await page.clock.setFixedTime(new Date("2035-01-01T00:00:00Z"));
  let anchor: number | null = null, anchoredAt = 0;
  await page.route("**/api/**",async route=>{
    const response = await route.fetch();
    const headers = {...response.headers()}; delete headers["x-tasktopia-server-time"];
    if (!/\/cities\/[^/]+\/scene(?:\?|$)/.test(route.request().url())) { await route.fulfill({response,headers}); return; }
    const scene = await response.json() as CitySceneDto;
    const all = [...scene.chunks.flatMap(c=>c.tasks),...scene.completedDistrictSnapshots.flatMap(s=>s.tasks)];
    const stationId = (all.find(t=>t.serviceRole==="RAILWAY") ?? all[0])!.id;
    for(const task of all) if(task.id===stationId) { task.serviceRole="RAILWAY"; task.stage=5; task.status="COMPLETED"; }
    const tasks = [...new Map(all.map(t=>[t.id,t])).values()];
    const sites = [...new Map(scene.chunks.flatMap(c=>c.plannedSites??[]).map(s=>[s.id,s])).values()];
    const roads = scene.chunks.flatMap(c=>c.roadRuns.map(r=>({minX:Math.min(r.start.x,r.end.x),maxX:Math.max(r.start.x,r.end.x),minY:Math.min(r.start.y,r.end.y),maxY:Math.max(r.start.y,r.end.y)})));
    const line = planCityRailway(scene.city.bounds,tasks,sites,roads)!;
    expect(line).toBeDefined();
    scene.railway=line;
    const schedule=transportSchedule("RAIL",stationId,"z-other-station");
    scene.railConnections=[{id:schedule.id,fromStationId:stationId,toStationId:"z-other-station",fromCityId:scene.city.id,toCityId:"other-city"}];
    if(anchor===null) {
      anchor=TRANSPORT_EPOCH-schedule.offsetMs+1000; anchoredAt=performance.now();
    }
    headers["cache-control"]="private, no-store";
    headers["x-tasktopia-server-time"]=String(anchor+performance.now()-anchoredAt);
    await route.fulfill({response,headers,json:scene});
  });
  await page.goto("/");
    await page.getByRole("navigation", { name: "Уровень карты" }).getByRole("button", { name: "Город", exact: true }).click();
  const city=page.locator(".world-canvas");
  await expect(city).toHaveAttribute("data-city-scene-commit","atomic");
  await expect(city).toHaveAttribute("data-city-train-phase","stopped");
  await expect(city).toHaveAttribute("data-city-train-wagons","3");
  await expect(city).toHaveAttribute("data-city-train-lead",/.+/);
  const before=await city.getAttribute("data-city-train-lead");
  await page.reload();
    await page.getByRole("navigation", { name: "Уровень карты" }).getByRole("button", { name: "Город", exact: true }).click();
  await expect(city).toHaveAttribute("data-city-scene-commit","atomic");
  await expect(city).toHaveAttribute("data-city-train-phase","stopped");
  await expect(city).toHaveAttribute("data-city-train-lead",before!);
});
