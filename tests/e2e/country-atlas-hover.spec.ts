import { expect, test, type Page } from "@playwright/test";

test.use({ viewport: { width: 1440, height: 900 } });
test.skip(process.env.E2E_ATLAS_FIXTURE !== "true", "Run against the dedicated fixture with npm run test:atlas");

async function loginAndOpenCountry(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Email").fill("world-validation@tasktopia.local");
  await page.getByLabel("Пароль").fill("tasktopia-world-validation");
  await page.getByRole("button", { name: "Открыть страну" }).click();
  const countryTitle = page.locator(".country-title-button strong");
  if (await countryTitle.textContent() !== "Федерация Новостроек") {
    await page.locator(".country-title-button").click();
    await page.getByRole("dialog", { name: "Выбор страны" }).getByRole("button").filter({ hasText: "Федерация Новостроек" }).click();
  }
  await expect(page.locator(".country-atlas")).toHaveAttribute("data-country-atlas-cities", "10", { timeout: 45_000 });
}

test("country overview keeps projected city silhouettes and accessible controls", async ({ page }, testInfo) => {
  const browserErrors: string[] = [];
  const atlasRequests: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") browserErrors.push(message.text()); });
  page.on("request", (request) => { if (request.url().includes("/api/country-atlas")) atlasRequests.push(request.url()); });

  await loginAndOpenCountry(page);
  const atlas = page.locator(".country-atlas");
  await expect(atlas.locator("svg")).toHaveCount(1);
  await expect(atlas.locator("canvas")).toHaveCount(0);
  await expect(atlas.locator(".atlas-city")).toHaveCount(10);
  await expect(atlas.locator(".country-side-fog")).toHaveCount(2);
  expect(atlasRequests.length).toBeGreaterThan(0);

  const activeLabel = atlas.locator('.atlas-city[data-active="true"] .atlas-city-label');
  await activeLabel.hover();
  await expect(page.locator(".header-city strong")).toContainText((await activeLabel.locator(".atlas-overview-card-title").textContent())!.replace(/…$/, ""));
  await atlas.hover({ position: { x: 2, y: 2 } });
  await expect(page.locator(".header-city")).toHaveCount(0);

  const metrics = await page.evaluate(async () => {
    const response = await fetch("/api/country-atlas");
    const body = await response.arrayBuffer();
    return { status: response.status, bytes: body.byteLength, etag: response.headers.get("etag") };
  });
  expect(metrics).toMatchObject({ status: 200, etag: expect.any(String) });
  expect(metrics.bytes).toBeLessThan(10_000_000);
  await testInfo.attach("country-overview-metrics", { body: Buffer.from(JSON.stringify(metrics, null, 2)), contentType: "application/json" });
  if (process.env.ATLAS_SCREENSHOT_PATH) await page.screenshot({ path: process.env.ATLAS_SCREENSHOT_PATH, fullPage: true });
  expect(browserErrors.filter((message) => !message.includes("401 (Unauthorized)"))).toEqual([]);
});

test("country camera is RAF-driven and its zoom is intentionally bounded", async ({ page }, testInfo) => {
  await loginAndOpenCountry(page);
  await page.evaluate(() => {
    const target = window as typeof window & { __countryLongTasks?: number[] };
    target.__countryLongTasks = [];
    new PerformanceObserver((list) => target.__countryLongTasks!.push(...list.getEntries().map((entry) => entry.duration)))
      .observe({ type: "longtask", buffered: false });
  });
  const atlas = page.locator(".country-atlas");
  const box = await atlas.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  for (let index = 0; index < 20; index += 1) await page.mouse.wheel(0, -240);
  await expect.poll(async () => Number(await atlas.getAttribute("data-country-zoom"))).toBeLessThanOrEqual(8.5);
  expect(await atlas.locator(".atlas-city").count()).toBe(10);
  await page.waitForTimeout(250);
  const longTasks = await page.evaluate(() => (window as typeof window & { __countryLongTasks?: number[] }).__countryLongTasks ?? []);
  expect(longTasks).toEqual([]);
  await testInfo.attach("country-interaction-performance", { body: Buffer.from(JSON.stringify({ longTasks, zoom: await atlas.getAttribute("data-country-zoom") }, null, 2)), contentType: "application/json" });
});

test("city opens with one atomic scene request and pan performs no data I/O", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const requests: string[] = [];
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if ((pathname.includes("/cities/") && pathname.endsWith("/scene")) || pathname.includes("/api/world/viewport") || pathname.includes("/api/chunks/")) requests.push(pathname);
  });
  await loginAndOpenCountry(page);
  requests.length = 0;
  const sceneResponsePromise = page.waitForResponse((response) => {
    const pathname = new URL(response.url()).pathname;
    return pathname.includes("/cities/") && pathname.endsWith("/scene");
  });
  await page.locator(".atlas-city").first().click();
  const sceneResponse = await sceneResponsePromise;
  const sceneBytes = (await sceneResponse.body()).byteLength;

  const host = page.locator(".world-canvas");
  await expect(host).toHaveAttribute("data-city-scene-requests", "1", { timeout: 90_000 });
  await expect(host).toHaveAttribute("data-city-scene-commit", "atomic", { timeout: 90_000 });
  await expect(host).toHaveAttribute("data-loading", "false", { timeout: 90_000 });
  expect(requests.filter((url) => url.endsWith("/scene"))).toHaveLength(1);
  expect(requests.filter((url) => url.includes("/world/viewport") || url.includes("/chunks/"))).toEqual([]);
  expect(sceneBytes).toBeLessThan(10_000_000);

  requests.length = 0;
  const residentBeforePan = await host.getAttribute("data-resident-chunks");
  const skippedBeforePan = Number(await host.getAttribute("data-skipped-reconciles") ?? 0);
  const canvas = page.locator("canvas[aria-label='Интерактивная карта города']");
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width * .75, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width * .25, box!.y + box!.height / 2, { steps: 18 });
  await page.mouse.up();
  for (let index = 0; index < 6; index += 1) await page.mouse.wheel(0, -120);
  await page.waitForTimeout(500);
  expect(requests).toEqual([]);
  await expect(host).toHaveAttribute("data-pan-network-requests", "0");
  await expect(host).toHaveAttribute("data-resident-chunks", residentBeforePan!);
  expect(Number(await host.getAttribute("data-skipped-reconciles") ?? 0)).toBeGreaterThan(skippedBeforePan);
  await testInfo.attach("city-scene-runtime", {
    body: Buffer.from(JSON.stringify({ chunks: await host.getAttribute("data-city-scene-chunks"), sceneRevision: await host.getAttribute("data-city-scene-revision"), sceneBytes, requests }, null, 2)),
    contentType: "application/json",
  });
});

test("planet, country and city transitions keep a single renderer mounted", async ({ page }) => {
  test.setTimeout(120_000);
  await loginAndOpenCountry(page);
  const levels = page.getByRole("navigation", { name: "Уровень карты" });
  await levels.getByRole("button", { name: "Планета" }).click();
  await expect(page.locator(".planet-atlas")).toBeVisible();
  await expect(page.locator(".country-atlas, .world-canvas")).toHaveCount(0);
  await page.locator(".planet-country-label").first().click();
  await expect(page.locator(".country-atlas")).toBeVisible({ timeout: 45_000 });
  await expect(page.locator(".planet-atlas, .world-canvas")).toHaveCount(0);
  await page.locator(".atlas-city").first().click();
  await expect(page.locator(".world-canvas")).toHaveAttribute("data-city-scene-commit", "atomic", { timeout: 90_000 });
  await expect(page.locator(".planet-atlas, .country-atlas")).toHaveCount(0);
  await levels.getByRole("button", { name: "Страна" }).click();
  await expect(page.locator(".country-atlas")).toBeVisible({ timeout: 45_000 });
  await expect(page.locator("canvas")).toHaveCount(0);
});

test("a failed city preload keeps the country interactive and supports retry", async ({ page }) => {
  test.setTimeout(120_000);
  let fail = true;
  await page.route("**/api/countries/*/cities/*/scene", async (route) => {
    if (fail) {
      fail = false;
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "temporary" }) });
      return;
    }
    await route.continue();
  });
  await loginAndOpenCountry(page);
  await page.locator(".atlas-city").first().click();
  await expect(page.locator(".country-atlas")).toBeVisible();
  await expect(page.locator(".world-canvas")).toHaveCount(0);
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("temporary");
  await alert.getByRole("button", { name: "Закрыть" }).click();
  await page.locator(".atlas-city").first().click();
  await expect(page.locator(".world-canvas")).toHaveAttribute("data-city-scene-commit", "atomic", { timeout: 90_000 });
});

test("distinct full-city visits release renderer heap before the next city", async ({ page, context }, testInfo) => {
  test.setTimeout(240_000);
  await loginAndOpenCountry(page);
  const cdp = await context.newCDPSession(page);
  const heapAfterEviction: number[] = [];
  for (let cityIndex = 0; cityIndex < 3; cityIndex += 1) {
    await page.locator(".atlas-city").nth(cityIndex).dispatchEvent("click");
    await expect(page.locator(".world-canvas")).toHaveAttribute("data-city-scene-commit", "atomic", { timeout: 90_000 });
    await expect(page.locator(".map-region canvas")).toHaveCount(1);
    await page.getByRole("navigation", { name: "Уровень карты" }).getByRole("button", { name: "Страна" }).click();
    await expect(page.locator(".country-atlas")).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(2_250);
    await cdp.send("HeapProfiler.collectGarbage");
    heapAfterEviction.push(await page.evaluate(() => (
      performance as Performance & { memory?: { usedJSHeapSize: number } }
    ).memory?.usedJSHeapSize ?? 0));
    await expect(page.locator(".map-region canvas")).toHaveCount(0);
  }
  const heapDrift = heapAfterEviction.at(-1)! - heapAfterEviction[0]!;
  // Full-city scenes intentionally retain a small decoded payload/cache
  // envelope; three different cities must still remain comfortably bounded.
  expect(heapDrift).toBeLessThan(16 * 1024 * 1024);
  await testInfo.attach("city-cycle-memory", {
    body: Buffer.from(JSON.stringify({ heapAfterEviction, heapDrift }, null, 2)),
    contentType: "application/json",
  });
});
