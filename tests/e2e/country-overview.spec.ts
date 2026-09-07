import { expect, test, type ElementHandle, type Page } from "@playwright/test";

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
  const overview = page.locator(".country-overview");
  await expect(overview).toHaveAttribute("data-country-overview-cities", "10", { timeout: 45_000 });
  // Loading the Pixi renderer and aircraft textures is startup work, not camera
  // interaction. Begin interaction/performance assertions only after the first
  // complete country frame has been committed.
  await expect(overview).toHaveAttribute("data-country-ready", "true", { timeout: 45_000 });
}

test("country overview keeps projected city silhouettes and accessible controls", async ({ page }, testInfo) => {
  const browserErrors: string[] = [];
  const atlasRequests: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") browserErrors.push(message.text()); });
  page.on("request", (request) => { if (request.url().includes("/overview")) atlasRequests.push(request.url()); });

  await loginAndOpenCountry(page);
  const atlas = page.locator(".country-overview");
  await expect(atlas).toHaveAttribute("data-country-renderer", "raster-dom");
  await expect(atlas.locator("svg")).toHaveCount(0);
  await expect(atlas.locator("canvas")).toHaveCount(1);
  await expect(atlas.locator(".country-overview-city")).toHaveCount(10);
  const labelRects = await atlas.locator(".country-overview-city").evaluateAll(labels => labels.map(label => {
    const box = label.getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width, height: box.height };
  }));
  for (let i = 0; i < labelRects.length; i++) for (let j = i + 1; j < labelRects.length; j++) {
    const a = labelRects[i]!, b = labelRects[j]!;
    expect(a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y).toBe(false);
  }
  await expect(atlas.locator(".country-city-leader")).toHaveCount(10);
  expect(await atlas.locator(".country-city-leader").first().evaluate(node => getComputedStyle(node).pointerEvents)).toBe("none");
  await expect(atlas.locator(".country-side-fog")).toHaveCount(0);
  await expect(atlas).toHaveAttribute("data-country-terrain-cells", "792");
  await expect(atlas).toHaveAttribute("data-country-terrain-render", "directional-16px-sheets");
  await expect(atlas).toHaveAttribute("data-country-city-render", "one-house-per-block");
  expect(Number(await atlas.getAttribute("data-country-selected-cells"))).toBeGreaterThan(0);
  expect(Number(await atlas.getAttribute("data-country-airports"))).toBe(2);
  await expect(atlas).toHaveAttribute("data-country-flights", "1");
  const aircraft = atlas.locator(".country-atlas-aircraft");
  await expect(aircraft).toHaveCount(1);
  const flightBefore = await aircraft.first().getAttribute("style");
  await page.waitForTimeout(160);
  await expect.poll(() => aircraft.first().getAttribute("style")).not.toBe(flightBefore);
  expect(atlasRequests.length).toBeGreaterThan(0);

  const activeLabel = atlas.locator('.country-overview-city[data-active="true"]');
  await activeLabel.hover();
  await expect(page.locator(".header-city strong")).toContainText((await activeLabel.locator("strong").textContent())!);
  await atlas.hover({ position: { x: 2, y: 2 } });
  await expect(page.locator(".header-city")).toHaveCount(0);

  const metrics = await page.evaluate(async () => {
    const countryId = document.querySelector<HTMLElement>(".country-overview")!.dataset.countryId!;
    const response = await fetch(`/api/countries/${countryId}/overview`, {
      headers: { accept: "application/vnd.tasktopia.country-overview+json; version=7" },
    });
    const body = await response.arrayBuffer();
    const json = JSON.parse(new TextDecoder().decode(body));
    const miniature = json.cities[0]?.miniature;
    const airports = json.cities.flatMap((city: { id: string; miniature: { airports: { taskId: string }[] } }) => city.miniature.airports.map(airport => ({ ...airport, cityId: city.id })));
    const airportTasks = await Promise.all(airports.map(async (airport: { taskId: string; cityId: string }) => {
      const task = await (await fetch(`/api/tasks/${airport.taskId}`)).json();
      return { id: task.id, cityId: task.cityId, role: task.serviceRole, status: task.status, stage: task.stage,
        sameTask: task.id === airport.taskId && task.cityId === airport.cityId };
    }));
    return {
      status: response.status,
      bytes: body.byteLength,
      etag: response.headers.get("etag"),
      schemaVersion: json.schemaVersion,
      cellSize: miniature?.cellSize,
      miniatureKeys: Object.keys(miniature).sort(),
      blockCount: json.cities.reduce((sum: number, city: { miniature: { blocks: unknown[] } }) => sum + city.miniature.blocks.length, 0),
      geographyCells: json.geography.terrainCodes.length,
      territoryCells: json.geography.territoryCodes.length,
      connections: json.connections.length,
      airportTasks,
      hasRawGeometry: /buildings|roads|surfaces|features|footprint/.test(new TextDecoder().decode(body)),
    };
  });
  expect(metrics).toMatchObject({ status: 200, etag: expect.any(String), schemaVersion: 7, cellSize: 8, hasRawGeometry: false,
    miniatureKeys: ["airports", "blocks", "cellSize", "columns", "rows"], geographyCells: 792, territoryCells: 792, connections: 1 });
  expect(metrics.blockCount).toBeGreaterThanOrEqual(10);
  expect(metrics.airportTasks).toHaveLength(2);
  for (const task of metrics.airportTasks) expect(task).toMatchObject({ sameTask: true, role: "AIRPORT", status: "COMPLETED", stage: 5 });
  await expect(atlas).toHaveAttribute("data-country-miniature-cells", String(metrics.blockCount));
  expect(metrics.bytes).toBeLessThan(200_000);
  await testInfo.attach("country-overview-metrics", { body: Buffer.from(JSON.stringify(metrics, null, 2)), contentType: "application/json" });
  await expect(atlas).toHaveAttribute("data-country-ready", "true");
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
  const atlas = page.locator(".country-overview");
  const box = await atlas.boundingBox();
  expect(box).not.toBeNull();
  // Empty outer context: zooming into an actual city now correctly enters CITY.
  await page.mouse.move(box!.x + 2, box!.y + 2);
  for (let index = 0; index < 20; index += 1) await page.mouse.wheel(0, -240);
  await expect.poll(async () => Number(await atlas.getAttribute("data-country-zoom"))).toBe(2.6);
  expect(await atlas.locator(".country-overview-city").count()).toBe(10);
  await page.waitForTimeout(250);
  expect(Number(await atlas.getAttribute("data-country-camera-frame-max-ms"))).toBeLessThan(50);
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
  // The bootstrap's first city may already be retained behind COUNTRY. A
  // different city is the actual cold-entry contract; warm return is separate.
  await page.locator(".country-overview-city").nth(1).click();
  const sceneResponse = await sceneResponsePromise;
  const sceneBytes = (await sceneResponse.body()).byteLength;

  const host = page.locator(".world-canvas");
  await expect(host).toHaveAttribute("data-city-scene-requests", "1", { timeout: 90_000 });
  await expect(host).toHaveAttribute("data-city-scene-commit", "atomic", { timeout: 90_000 });
  await expect(host).toHaveAttribute("data-loading", "false", { timeout: 90_000 });
  await expect.poll(async () => Number(await host.getAttribute("data-render-scale")) - Number(await host.getAttribute("data-minimum-render-scale")), { timeout: 90_000 }).toBeCloseTo(0, 3);
  expect(Number(await host.getAttribute("data-render-scale"))).toBeGreaterThanOrEqual(.8);
  expect(requests.filter((url) => url.endsWith("/scene"))).toHaveLength(1);
  expect(requests.filter((url) => url.includes("/world/viewport") || url.includes("/chunks/"))).toEqual([]);
  expect(sceneBytes).toBeLessThan(10_000_000);

  const canvas = page.locator("canvas[aria-label='Интерактивная карта города']");
  const zoomFrames = await canvas.evaluate(async (element) => {
    const host = element.closest<HTMLElement>(".world-canvas")!;
    const before = Number(host.dataset.renderScale);
    element.dispatchEvent(new WheelEvent("wheel", { deltaY: -300, clientX: 400, clientY: 300, bubbles: true, cancelable: true }));
    const immediate = Number(host.dataset.renderScale);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const firstFrame = Number(host.dataset.renderScale);
    await new Promise((resolve) => setTimeout(resolve, 350));
    return { before, immediate, firstFrame, settled: Number(host.dataset.renderScale) };
  });
  expect(zoomFrames.immediate).toBe(zoomFrames.before);
  expect(zoomFrames.firstFrame).toBeGreaterThan(zoomFrames.before);
  expect(zoomFrames.firstFrame).toBeLessThan(zoomFrames.settled);

  requests.length = 0;
  const residentBeforePan = await host.getAttribute("data-resident-chunks");
  const skippedBeforePan = Number(await host.getAttribute("data-skipped-reconciles") ?? 0);
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

test("planet and country transitions retain exactly one paused city renderer for warm return", async ({ page }) => {
  test.setTimeout(120_000);
  await loginAndOpenCountry(page);
  const levels = page.getByRole("navigation", { name: "Уровень карты" });
  await page.locator(".country-overview-city").first().click();
  const host = page.locator(".world-canvas");
  await expect(host).toHaveAttribute("data-city-scene-commit", "atomic", { timeout: 90_000 });
  const canvas = await page.locator(".world-canvas-element").elementHandle();
  await levels.getByRole("button", { name: "Страна" }).click();
  await expect(page.locator(".country-overview")).toHaveAttribute("data-country-ready", "true", { timeout: 45_000 });
  await expect(host).toBeHidden();
  await expect(host).toHaveAttribute("data-map-active", "false");
  await expect(host).toHaveAttribute("data-animation-active", "false");
  await levels.getByRole("button", { name: "Планета" }).click();
  await expect(page.locator(".planet-atlas")).toBeVisible();
  await expect(page.locator(".planet-atlas")).toHaveAttribute("data-planet-ready", "true", { timeout: 45_000 });
  await expect(page.locator(".planet-atlas")).toHaveAttribute("data-planet-countries", "3");
  const visibleCountries = Number(await page.locator(".planet-atlas").getAttribute("data-visible-countries"));
  expect(visibleCountries).toBeGreaterThan(0); expect(visibleCountries).toBeLessThanOrEqual(3);
  await expect(page.locator(".planet-country-label")).toHaveCount(visibleCountries);
  const planetTerrainSheets = page.locator('.planet-terrain-sprite image[href*="atlas/terrain-v4/planet/"]');
  await expect(planetTerrainSheets.first()).toBeVisible();
  expect(await planetTerrainSheets.count()).toBeGreaterThan(20);
  if (process.env.PLANET_SCREENSHOT_PATH) {
    await expect(page.locator(".map-level-transition")).toHaveCount(0);
    await page.screenshot({ path: process.env.PLANET_SCREENSHOT_PATH, fullPage: true });
  }
  await expect(page.locator(".country-overview")).toHaveCount(0);
  await expect(host).toHaveCount(1); await expect(host).toBeHidden();
  expect(await canvas!.evaluate(node => node.isConnected)).toBe(true);
  await page.locator('.planet-country-label[data-active="true"]').click();
  await expect(page.locator(".country-overview")).toBeVisible({ timeout: 45_000 });
  await expect(page.locator(".planet-atlas")).toHaveCount(0);
  await expect(host).toBeHidden();
  await page.locator(".country-overview-city").first().click();
  await expect(page.locator(".world-canvas")).toHaveAttribute("data-city-scene-commit", "atomic", { timeout: 90_000 });
  await expect(host).toBeVisible();
  await expect(host).toHaveAttribute("data-map-active", "true");
  expect(await canvas!.evaluate(node => node === document.querySelector(".world-canvas-element"))).toBe(true);
  await expect(page.locator(".planet-atlas, .country-overview")).toHaveCount(0);
  await levels.getByRole("button", { name: "Страна" }).click();
  await expect(page.locator(".country-overview")).toBeVisible({ timeout: 45_000 });
  await expect(page.locator(".country-overview canvas")).toHaveCount(1);
});

test("a failed city preload keeps the country interactive and supports retry", async ({ page }) => {
  test.setTimeout(120_000);
  await loginAndOpenCountry(page);
  const targetCityId = await page.locator(".country-overview-city").nth(1).getAttribute("data-city-id");
  let fail = true;
  await page.route(`**/api/countries/*/cities/${targetCityId}/scene`, async (route) => {
    if (fail) {
      fail = false;
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "temporary" }) });
      return;
    }
    await route.continue();
  });
  await page.locator(".country-overview-city").nth(1).click();
  await expect(page.locator(".country-overview")).toBeVisible();
  await expect(page.locator(".world-canvas")).toBeHidden();
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("temporary");
  await alert.getByRole("button", { name: "Закрыть" }).click();
  await page.locator(".country-overview-city").nth(1).click();
  await expect(page.locator(".world-canvas")).toHaveAttribute("data-city-scene-commit", "atomic", { timeout: 90_000 });
  await expect(page.locator(".map-level-transition")).toHaveCount(0, { timeout: 90_000 });
  await expect(page.locator(".world-canvas")).toBeVisible();
});

test("distinct city visits replace the retained renderer and keep heap bounded", async ({ page, context }, testInfo) => {
  test.setTimeout(240_000);
  await loginAndOpenCountry(page);
  const cdp = await context.newCDPSession(page);
  const heapAfterEviction: number[] = [];
  let previousCanvas: ElementHandle<HTMLElement | SVGElement> | null = null;
  for (let cityIndex = 0; cityIndex < 3; cityIndex += 1) {
    await page.locator(".country-overview-city").nth(cityIndex).dispatchEvent("click");
    // The previous hidden canvas can still carry "atomic" while the next
    // scene is preloading. Wait for the user-visible transition to commit.
    await expect(page.locator(".map-level-transition")).toHaveCount(0, { timeout: 90_000 });
    await expect(page.locator(".world-canvas")).toBeVisible();
    await expect(page.locator(".world-canvas")).toHaveAttribute("data-city-scene-commit", "atomic", { timeout: 90_000 });
    await expect(page.locator(".world-canvas-element")).toHaveCount(1);
    if (previousCanvas) await expect.poll(() => previousCanvas!.evaluate(node => node.isConnected), { timeout: 30_000 }).toBe(false);
    previousCanvas = await page.locator(".world-canvas-element").elementHandle();
    await expect(page.locator(".country-overview-raster")).toHaveCount(0);
    await page.getByRole("navigation", { name: "Уровень карты" }).getByRole("button", { name: "Страна" }).click();
    await expect(page.locator(".country-overview")).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(2_250);
    await cdp.send("HeapProfiler.collectGarbage");
    heapAfterEviction.push(await page.evaluate(() => (
      performance as Performance & { memory?: { usedJSHeapSize: number } }
    ).memory?.usedJSHeapSize ?? 0));
    await expect(page.locator(".world-canvas-element")).toHaveCount(1);
    await expect(page.locator(".world-canvas-element")).toBeHidden();
    await expect(page.locator(".world-canvas")).toHaveAttribute("data-map-active", "false");
    await expect(page.locator(".world-canvas")).toHaveAttribute("data-animation-active", "false");
    expect(await previousCanvas!.evaluate(node => node.isConnected)).toBe(true);
    await expect(page.locator(".country-overview-raster")).toHaveCount(1);
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
