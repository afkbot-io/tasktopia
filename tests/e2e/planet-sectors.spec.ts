import { expect,test } from "@playwright/test";
import type { PlanetAtlasDto } from "../../src/shared/planet-atlas-contract";
test("switches overview areas without rescaling or displaying the other area's countries",async({page},info)=>{
  test.skip(!/^http:\/\/(127\.0\.0\.1|localhost):/.test(process.env.E2E_BASE_URL??""),"Local fixture only");
  await page.setViewportSize({width:390,height:844});
  const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
  await page.request.post("/api/auth/login",{data:{email:"demo@tasktopia.local",password:"tasktopia-demo"}});
  const source=await (await page.request.get("/api/planet-atlas")).json() as PlanetAtlasDto;
  const original=source.countries[0]!;
  const extra={...structuredClone(original),id:"extra-sector-country",name:"Новая область"};
  const record={...structuredClone(source.geography!.countries[original.id]!),sector:1};
  const fixture:PlanetAtlasDto={...source,revision:"sectors-test",countries:[...source.countries,extra],geography:{...source.geography!,
    countries:{...source.geography!.countries,[extra.id]:record},
    coastCells:[...source.geography!.coastCells,...source.geography!.coastCells.map(cell=>({...cell,id:`sector-1:${cell.id}`,sector:1}))],
  }};
  await page.route("**/api/planet-atlas",route=>route.fulfill({json:fixture}));
  await page.goto("/");
  await page.getByRole("button",{name:"Планета",exact:true}).click();
  const map=page.locator(".planet-atlas"), selector=page.getByRole("combobox",{name:"Область планеты",exact:true});
  await expect(map).toHaveAttribute("data-planet-ready","true");
  await expect(page.locator(`.planet-country[data-country-id="${original.id}"]`)).toHaveCount(1);
  await expect(page.locator(`.planet-country[data-country-id="${extra.id}"]`)).toHaveCount(0);
  const size=await map.locator("svg").first().getAttribute("viewBox");
  await selector.selectOption("1");
  await expect(map).toHaveAttribute("data-planet-ready","true");
  await expect(page.locator(`.planet-country[data-country-id="${extra.id}"]`)).toHaveCount(1);
  await expect(page.locator(`.planet-country[data-country-id="${original.id}"]`)).toHaveCount(0);
  expect(await map.locator("svg").first().getAttribute("viewBox")).toBe(size);
  await expect(map).toHaveAttribute("data-globe-zoom","1.00");
  const bounds=await selector.boundingBox();expect(bounds!.x).toBeGreaterThanOrEqual(0);expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(390);
  await page.screenshot({path:info.outputPath("sector-mobile.png")});
  await selector.selectOption("0");
  await expect(page.locator(`.planet-country[data-country-id="${original.id}"]`)).toHaveCount(1);
  expect(errors).toEqual([]);
});
