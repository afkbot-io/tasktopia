import { expect, test } from "@playwright/test";

test("100-task city opens repeatedly and country zoom preserves a panned anchor", async ({ page }, testInfo) => {
  test.skip(process.env.E2E_MAP_LOADING_FIXTURE !== "true", "Requires the isolated megacity fixture");
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await page.getByLabel("Email").fill("megacity-validation@tasktopia.local");
  await page.getByLabel("Пароль").fill("tasktopia-megacity-validation");
  const started = Date.now();
  await page.getByRole("button", { name: "Открыть страну", exact: true }).click();
  const city = page.locator(".world-canvas");
  await expect(city).toHaveAttribute("data-city-scene-commit", "atomic", { timeout: 15_000 });
  await expect(city).toHaveAttribute("data-loading", "false");
  const durations = [Date.now() - started];
  await page.screenshot({ path: testInfo.outputPath("city-100.png") });
  for (let i = 0; i < 2; i++) {
    await page.getByRole("button", { name: "Страна", exact: true }).click();
    const country = page.locator(".country-overview");
    await expect(country).toHaveAttribute("data-country-ready", "true");
    expect(await country.evaluate(host => getComputedStyle(host,"::before").filter))
      .toBe(await country.locator(".country-overview-raster").evaluate(raster => getComputedStyle(raster).filter));
    const box = (await country.boundingBox())!;
    await page.mouse.move(box.x + box.width * .6, box.y + box.height * .7);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * .7, box.y + box.height * .7, { steps: 8 });
    await page.mouse.up();
    const raster = country.locator(".country-overview-raster");
    const before = (await raster.boundingBox())!;
    const focus = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const anchor = { x: (focus.x - before.x) / before.width, y: (focus.y - before.y) / before.height };
    await page.mouse.move(focus.x, focus.y);
    await page.mouse.wheel(0, -120);
    await expect.poll(async () => (await raster.boundingBox())!.width).toBeGreaterThan(before.width + 1);
    await expect.poll(async () => {
      const after = (await raster.boundingBox())!;
      return Math.abs(after.x + anchor.x * after.width - focus.x) + Math.abs(after.y + anchor.y * after.height - focus.y);
    }).toBeLessThan(3);
    await page.screenshot({ path: testInfo.outputPath(`country-${i}.png`) });
    const start = Date.now();
    await page.getByRole("button", { name: "Город", exact: true }).click();
    await expect(city).toHaveAttribute("data-city-scene-commit", "atomic", { timeout: 15_000 });
    await expect(city).toHaveAttribute("data-loading", "false");
    durations.push(Date.now() - start);
  }
  await page.getByRole("button", { name: "Планета", exact: true }).click();
  const planet = page.locator(".planet-atlas");
  await expect(planet).toHaveAttribute("data-planet-ready", "true");
  const ocean = planet.locator(".planet-map-ocean");
  const cloud = planet.locator(".planet-clouds > g").first();
  const oceanX = Number(await ocean.getAttribute("x"));
  const cloudX = Number((await cloud.getAttribute("transform"))!.match(/translate\(([-\d.]+)/)![1]);
  await planet.getByRole("group").focus();
  await page.keyboard.press("ArrowRight");
  await expect.poll(async () => Number(await ocean.getAttribute("x"))).toBeLessThan(oceanX);
  const cloudAfter = Number((await cloud.getAttribute("transform"))!.match(/translate\(([-\d.]+)/)![1]);
  expect(cloudAfter - cloudX).toBeCloseTo(Number(await ocean.getAttribute("x")) - oceanX);
  await page.screenshot({ path: testInfo.outputPath("planet.png") });
  expect(errors).toEqual([]);
  await testInfo.attach("city-opening-ms", { body: JSON.stringify(durations), contentType: "application/json" });
});

test("a silent worker cannot leave city loading forever", async ({ page }) => {
  test.skip(process.env.E2E_MAP_LOADING_FIXTURE !== "true", "Requires the isolated megacity fixture");
  test.setTimeout(75_000);
  await page.route(/\/assets\/chunk-materializer-worker-[^/]+\.js$/, route => route.fulfill({
    status: 200, contentType: "text/javascript", body: "self.onmessage = () => {};",
  }));
  await page.goto("/");
  await page.getByLabel("Email").fill("megacity-validation@tasktopia.local");
  await page.getByLabel("Пароль").fill("tasktopia-megacity-validation");
  await page.getByRole("button", { name: "Открыть страну", exact: true }).click();
  const ready = page.locator('.world-canvas[data-city-scene-commit="atomic"]');
  const retry = page.getByRole("button", { name: /Повторить/ });
  await expect(ready.or(retry).first()).toBeVisible({ timeout: 55_000 });
  await page.unroute(/\/assets\/chunk-materializer-worker-[^/]+\.js$/);
  if (await retry.isVisible()) await retry.click();
  await expect(ready).toBeVisible({ timeout: 15_000 });
});
