import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { openMapCity, openMapPlanet } from "./map-navigation";

test("новая тема укладывается в бюджеты шрифтов и открывает город без дополнительных чтений", async ({ page }, info) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width:1440, height:1100 });
  const reads: string[] = [], errors: string[] = [];
  page.on("request", r => { if (/\/scene(?:\?|$)|\/api\/world\/viewport|\/api\/chunks\//.test(r.url())) reads.push(new URL(r.url()).pathname); });
  page.on("pageerror", e => errors.push(e.message));
  await page.goto("/");
  await expect(page.getByLabel("Email")).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const fonts = await page.evaluate(() => performance.getEntriesByType("resource").filter(e => /\.woff2(?:$|\?)/.test(e.name)).map(e => ({url:e.name,bytes:(e as PerformanceResourceTiming).encodedBodySize})));
  expect(fonts.length).toBe(2);
  expect(fonts.every(f => new URL(f.url).origin === new URL(page.url()).origin)).toBe(true);
  expect(fonts.reduce((sum,f)=>sum+f.bytes,0)).toBeLessThanOrEqual(45_000);
  await page.getByLabel("Email").fill("demo@tasktopia.local");
  await page.getByLabel("Пароль").fill("tasktopia-demo");
  await page.getByRole("button",{name:"Открыть страну",exact:true}).click();
  await expect(page.locator(".planet-atlas")).toHaveAttribute("data-planet-ready","true");
  const samples: number[] = [];
  for(let attempt=0;attempt<4;attempt++) {
    const started=Date.now();
    await openMapCity(page);
    await expect(page.locator(".world-canvas")).toHaveAttribute("data-city-scene-commit","atomic");
    await expect(page.locator(".map-level-transition")).toHaveCount(0);
    const elapsed=Date.now()-started;samples.push(elapsed);
    expect(elapsed).toBeLessThan(attempt===0?8_000:3_000);
    await openMapPlanet(page);
  }
  expect(reads.filter(r=>r.endsWith("/scene"))).toHaveLength(1);
  expect(reads.filter(r=>!r.endsWith("/scene"))).toEqual([]);
  const filters=await page.locator(".map-toolbar").evaluate(el=>({backgroundFilter:getComputedStyle(el).backdropFilter}));
  expect(filters.backgroundFilter).toBe("none");
  expect(errors).toEqual([]);
  const report = JSON.stringify({ fonts, samples, reads, errors }, null, 2);
  await writeFile(info.outputPath("forest-load.json"), report);
  await info.attach("forest-load", { body: report, contentType: "application/json" });
});
