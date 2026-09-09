import { writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

test("records cold and repeated map opening on the fixed 100-task city", async ({ page }, testInfo) => {
  test.skip(process.env.E2E_MAP_LOADING_FIXTURE !== "true", "Dedicated local 100-task fixture");
  test.setTimeout(120_000);
  const samples: Array<{ mode: string; attempt: number; ms: number; metrics: Record<string, string> }> = [];
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await page.getByLabel("Email").fill("megacity-validation@tasktopia.local");
  await page.getByLabel("Пароль").fill("tasktopia-megacity-validation");
  const start = Date.now();
  await page.getByRole("button", { name: "Открыть страну", exact: true }).click();
  const city = page.locator(".world-canvas");
  await expect(city).toBeVisible();
  await expect(city).toHaveAttribute("data-city-scene-commit", "atomic", { timeout: 45_000 });
  samples.push({ mode: "CITY", attempt: 0, ms: Date.now() - start, metrics: await city.evaluate(el => ({ ...(el as HTMLElement).dataset }) as Record<string,string>) });
  for (let attempt = 0; attempt < 3; attempt++) for (const [mode, label, selector, attribute] of [
    ["COUNTRY", "Страна", ".country-overview", "data-country-ready"],
    ["PLANET", "Планета", ".planet-atlas", "data-planet-ready"],
    ["CITY", "Город", ".world-canvas", "data-city-scene-commit"],
  ]) {
    const begin = Date.now();
    await page.getByRole("button", { name: label, exact: true }).click();
    const host = page.locator(selector!);
    await expect(host).toBeVisible();
    await expect(host).toHaveAttribute(attribute!, mode === "CITY" ? "atomic" : "true", { timeout: 30_000 });
    samples.push({ mode: mode!, attempt: mode === "CITY" ? attempt + 1 : attempt, ms: Date.now() - begin,
      metrics: await host.evaluate(el => ({ ...(el as HTMLElement).dataset }) as Record<string,string>) });
  }
  expect(errors).toEqual([]);
  for (const sample of samples) {
    const budget = sample.attempt === 0 ? 8_000 : 3_000;
    expect(sample.ms, `${sample.mode}, attempt ${sample.attempt}`).toBeLessThan(budget);
  }
  await testInfo.attach("map-opening", { body: JSON.stringify(samples, null, 2), contentType: "application/json" });
  if (process.env.MAP_OPENING_REPORT) await writeFile(process.env.MAP_OPENING_REPORT.replace(/\.json$/, `-${testInfo.repeatEachIndex}.json`), JSON.stringify(samples, null, 2));
});
