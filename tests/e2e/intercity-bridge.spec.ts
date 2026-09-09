import {expect,test} from "@playwright/test";
import type {CitySceneDto} from "../../src/shared/city-scene-contract";

test("recorded bridge and its road approaches render outside resident city chunks", async ({page},info) => {
  test.skip(process.env.E2E_MAP_LOADING_FIXTURE !== "true", "Local map fixture");
  let target={x:0,y:0};
  const errors:string[]=[];
  page.on("pageerror",error=>errors.push(error.message));
  await page.route("**/api/countries/*/cities/*/scene",async route=>{
    const response=await route.fetch();
    const scene=await response.json() as CitySceneDto;
    target={x:(Math.max(...scene.chunks.map(c=>c.chunkX))+1)*scene.chunkSize+24,y:scene.city.bounds.maxY-24};
    scene.intercityRoads=[{id:"qa-bridge",fromCityId:scene.city.id,toCityId:"qa-neighbor",fromNodeId:"a",toNodeId:"b",widthCells:3,
      geometry:{start:{x:target.x-88,y:target.y},runs:[{direction:"E",length:160}]},
      bridges:[{start:{x:target.x-16,y:target.y},runs:[{direction:"E",length:32}]}]}];
    await route.fulfill({response,json:scene});
  });
  await page.goto("/");
  await page.getByLabel("Email").fill("megacity-validation@tasktopia.local");
  await page.getByLabel("Пароль").fill("tasktopia-megacity-validation");
  await page.getByRole("button",{name:"Открыть страну",exact:true}).click();
  const city=page.locator(".world-canvas");
  await expect(city).toHaveAttribute("data-city-scene-commit","atomic",{timeout:45_000});
  await expect(city).toHaveAttribute("data-intercity-road-routes","1");
  const box=(await city.boundingBox())!;
  const camera=await city.evaluate(el=>({x:Number((el as HTMLElement).dataset.cameraWorldX),y:Number((el as HTMLElement).dataset.cameraWorldY),scale:Number((el as HTMLElement).dataset.renderScale)}));
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
  await page.mouse.down();
  await page.mouse.move(box.x+box.width/2+(camera.x-target.x)*8*camera.scale,box.y+box.height/2+(camera.y-target.y)*8*camera.scale,{steps:12});
  await page.mouse.up();
  await expect.poll(async()=>Number(await city.getAttribute("data-camera-padding-road-cells"))).toBeGreaterThan(20);
  await page.screenshot({path:info.outputPath("intercity-bridge.png")});
  expect(errors).toEqual([]);
});
