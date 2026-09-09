import { expect, test } from "@playwright/test";
import type { CitySceneDto } from "../../src/shared/city-scene-contract";

for (const stage of [1, 2, 3, 4, 5]) test(`transport construction stage ${stage} renders without a premature train`, async ({ page }, info) => {
  test.skip(process.env.E2E_MAP_LOADING_FIXTURE !== "true", "Local transport scene fixture");
  const loaded = new Set<string>();
  page.on("response", response => { if (response.ok()) loaded.add(new URL(response.url()).pathname); });
  // Vary the DTO at the browser boundary; never mutate the fixture's database.
  await page.route("**/api/countries/*/cities/*/scene", async route => {
    const response = await route.fetch();
    const scene = await response.json() as CitySceneDto;
    for (const task of [...scene.chunks.flatMap(chunk => chunk.tasks), ...scene.completedDistrictSnapshots.flatMap(snapshot => snapshot.tasks)]) {
      if (task.serviceRole !== "AIRPORT" && task.serviceRole !== "RAILWAY") continue;
      task.stage = stage;
      task.status = stage === 5 ? "COMPLETED" : "IN_PROGRESS";
    }
    await route.fulfill({ response, json: scene });
  });
  await page.goto("/");
  await page.getByLabel("Email").fill("megacity-validation@tasktopia.local");
  await page.getByLabel("Пароль").fill("tasktopia-megacity-validation");
  await page.getByRole("button", {name:"Открыть страну",exact:true}).click();
  const city = page.locator(".world-canvas");
  await expect(city).toHaveAttribute("data-city-scene-commit", "atomic", {timeout:45_000});
  await expect(city).toHaveAttribute("data-city-railway-stage", String(stage));
  await expect(city).toHaveAttribute("data-city-train", stage === 5 ? "running" : "none");
  if (stage >= 3) for (const family of ["airport", "railway"]) {
    expect([...loaded].some(path => path.endsWith(`/compact-${family}-v1/stage-${stage}.png`)), family).toBe(true);
  }
  await page.getByLabel("Поиск здания по номеру или названию").fill("37");
  await page.getByRole("option").filter({hasText:"#37"}).click();
  await page.getByRole("button",{name:"Закрыть",exact:true}).click();
  await page.mouse.move(50,70);
  await page.screenshot({path:info.outputPath(`transport-stage-${stage}.png`)});
});

test("completed city station has a moving locomotive and three coupled wagons", async ({ page }, testInfo) => {
  test.skip(process.env.E2E_MAP_LOADING_FIXTURE !== "true", "Dedicated local fixture with completed transport services");
  await page.clock.setFixedTime(new Date("2026-09-09T09:00:00Z"));
  const errors:string[]=[];
  page.on("pageerror",e=>errors.push(e.message));
  await page.goto("/");
  await page.getByLabel("Email").fill("megacity-validation@tasktopia.local");
  await page.getByLabel("Пароль").fill("tasktopia-megacity-validation");
  await page.getByRole("button",{name:"Открыть страну",exact:true}).click();
  const city=page.locator(".world-canvas");
  await expect(city).toHaveAttribute("data-city-scene-commit","atomic",{timeout:45_000});
  await expect(city).toHaveAttribute("data-city-train","running",{timeout:15_000});
  await expect(city).toHaveAttribute("data-city-train-wagons","3");
  expect(await city.getAttribute("data-city-railway")).toMatch(/horizontal|vertical/);
  const first=await city.getAttribute("data-city-train-lead");
  await expect.poll(()=>city.getAttribute("data-city-train-lead")).not.toBe(first);
  await expect(city).toHaveAttribute("data-city-train-phase","stopped",{timeout:15_000});
  const stopped = await city.getAttribute("data-city-train-lead");
  await page.waitForTimeout(1000);
  expect(await city.getAttribute("data-city-train-lead")).toBe(stopped);
  await expect(city).toHaveAttribute("data-city-train-phase","moving",{timeout:15_000});
  await page.getByLabel("Поиск здания по номеру или названию").fill("46");
  await page.getByRole("option").filter({hasText:"#46"}).click();
  await page.getByRole("button",{name:"Закрыть",exact:true}).click();
  await page.mouse.move(50,70);
  const geometry = JSON.parse((await city.getAttribute("data-city-railway-geometry"))!);
  const camera = await city.evaluate(el => ({x:Number((el as HTMLElement).dataset.cameraWorldX),y:Number((el as HTMLElement).dataset.cameraWorldY),scale:Number((el as HTMLElement).dataset.renderScale)}));
  const box = (await city.boundingBox())!;
  // Pan with the actual input gesture to include the straight corridor.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + (camera.x - geometry.platform.x) * 8 * camera.scale,
    box.y + box.height / 2 + (camera.y - geometry.platform.y) * 8 * camera.scale, {steps: 12});
  await page.mouse.up();
  await page.mouse.move(50,70);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const afterPan = await city.evaluate(el => ({x:Number((el as HTMLElement).dataset.cameraWorldX),y:Number((el as HTMLElement).dataset.cameraWorldY),scale:Number((el as HTMLElement).dataset.renderScale)}));
  const railPoint = geometry.from.y === geometry.to.y
    ? {x:geometry.platform.x-20,y:geometry.from.y+.5}
    : {x:geometry.from.x+.5,y:geometry.platform.y-20};
  const pixel = {x:Math.round(box.x+box.width/2+(railPoint.x-afterPan.x)*8*afterPan.scale),
    y:Math.round(box.y+box.height/2+(railPoint.y-afterPan.y)*8*afterPan.scale)};
  const dayPng = (await page.screenshot()).toString("base64");
  await page.clock.setFixedTime(new Date("2026-09-09T21:00:00Z"));
  await page.waitForTimeout(250);
  const nightPng = (await page.screenshot()).toString("base64");
  const light = await page.evaluate(async ({dayPng,nightPng,pixel}) => {
    const brightness = async (png:string) => {
      const bitmap=await createImageBitmap(new Blob([Uint8Array.from(atob(png),c=>c.charCodeAt(0))],{type:"image/png"}));
      const canvas=new OffscreenCanvas(bitmap.width,bitmap.height),ctx=canvas.getContext("2d")!;
      ctx.drawImage(bitmap,0,0); bitmap.close();
      const p=ctx.getImageData(pixel.x,pixel.y,1,1).data;
      return p[0]!+p[1]!+p[2]!;
    };
    return {day:await brightness(dayPng),night:await brightness(nightPng)};
  },{dayPng,nightPng,pixel});
  expect(light.day).toBeGreaterThan(60);
  expect(light.night).toBeLessThan(light.day*.85);
  await page.screenshot({path:testInfo.outputPath("city-railway.png")});
  await testInfo.attach("railway-geometry",{body:await city.getAttribute("data-city-railway-geometry")??"",contentType:"application/json"});
  await page.getByLabel("Поиск здания по номеру или названию").fill("37");
  await page.getByRole("option").filter({hasText:"#37"}).click();
  await page.getByRole("button",{name:"Закрыть",exact:true}).click();
  await page.mouse.move(50,70);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.screenshot({path:testInfo.outputPath("city-airport.png")});
  expect(errors).toEqual([]);
});
