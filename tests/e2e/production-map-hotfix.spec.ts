import { expect, test, type Page } from "@playwright/test";

async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("Email").fill("demo@tasktopia.local");
  await page.getByLabel("Пароль").fill("tasktopia-demo");
  await page.getByRole("button", { name: "Открыть страну" }).click();
}

test("hotfix keeps city, country and planet usable and visually connected", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const failures: string[] = [];
  const mapRequests: string[] = [];
  page.on("pageerror", (error) => failures.push(error.message));
  page.on("console", (message) => {
    const text = message.text();
    if (message.type() === "error" || /GL_INVALID_OPERATION|before initialization|passive event listener|PixiJS Deprecation/.test(text)) failures.push(text);
  });
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.endsWith("/scene") || path.includes("/api/world/viewport") || path.includes("/api/chunks/")) mapRequests.push(path);
  });

  await login(page);
  const city = page.locator(".world-canvas");
  await expect(city).toHaveAttribute("data-city-scene-commit", "atomic", { timeout: 90_000 });
  await expect(city).toHaveAttribute("data-loading", "false", { timeout: 90_000 });
  expect(mapRequests.filter((path) => path.endsWith("/scene"))).toHaveLength(1);
  expect(mapRequests.filter((path) => path.includes("/api/world/viewport") || path.includes("/api/chunks/"))).toEqual([]);
  expect(Number(await city.getAttribute("data-static-decoration-particles"))).toBeGreaterThan(0);

  const canvas = page.locator("canvas[aria-label='Интерактивная карта города']");
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const beforeX = Number(await city.getAttribute("data-camera-world-x"));
  await page.mouse.move(box!.x + box!.width * .7, box!.y + box!.height * .5);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width * .25, box!.y + box!.height * .5, { steps: 16 });
  await page.mouse.up();
  await expect.poll(async () => Number(await city.getAttribute("data-camera-world-x"))).not.toBe(beforeX);
  expect(mapRequests.filter((path) => path.includes("/api/world/viewport") || path.includes("/api/chunks/"))).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("city.png"), fullPage: true });

  let releaseTaskChunk: (() => void) | undefined;
  await page.route(/\/assets\/TaskModal-[^/]+\.js$/, async (route) => {
    await new Promise<void>((resolve) => { releaseTaskChunk = resolve; });
    await route.continue();
  });
  const search = page.getByLabel("Поиск здания по номеру или названию");
  await search.fill("1");
  await expect(page.getByRole("option").first()).toBeVisible();
  await page.getByRole("option").first().click();
  await expect(page.getByRole("dialog", { name: "Загрузка задачи" })).toBeVisible({ timeout: 500 });
  releaseTaskChunk?.();
  await expect(page.locator(".task-modal")).toBeVisible();
  await page.locator(".modal-close").click();

  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  const country = page.locator(".country-overview");
  await page.mouse.wheel(0, 4_000);
  await expect(country).toBeVisible({ timeout: 5_000 });
  await expect(country.locator(".country-overview-city")).toHaveCount(1);
  // This fixture has one city: there is no second airport for an intercity
  // flight. The dedicated country-overview fixture covers an actual route.
  await expect(country).toHaveAttribute("data-country-flights", "0");
  await expect(country.locator(".country-atlas-aircraft")).toHaveCount(0);
  await expect(country.locator(".country-side-fog")).toHaveCount(0);
  await expect(country).toHaveAttribute("data-country-ready", "true");
  expect(Number(await country.getAttribute("data-country-zoom"))).toBeGreaterThanOrEqual(.55);
  expect(Number(await country.getAttribute("data-country-zoom"))).toBeLessThanOrEqual(1.1);
  await page.screenshot({ path: testInfo.outputPath("country.png"), fullPage: true });

  const countryBox = await country.boundingBox();
  expect(countryBox).not.toBeNull();
  await expect(page.locator(".map-level-transition")).toHaveCount(0);
  await page.mouse.move(countryBox!.x + countryBox!.width / 2, countryBox!.y + countryBox!.height / 2);
  // A deliberate new gesture crosses COUNTRY -> PLANET on its first boundary
  // delta. Do not depend on driver latency to split or join wheel bursts.
  await page.waitForTimeout(300);
  await page.mouse.wheel(0, 4_000);
  const planet = page.locator(".planet-atlas");
  await expect(planet).toBeVisible({ timeout: 5_000 });
  expect(Number(await planet.getAttribute("data-globe-zoom"))).toBe(1);
  await expect(planet).toHaveAttribute("data-planet-ready", "true", { timeout: 30_000 });
  await expect(planet.locator("clipPath ellipse")).toHaveCount(0);
  const rows = await planet.locator("clipPath rect").evaluateAll(rects => rects.map(rect => ({
    x: Number(rect.getAttribute("x")), y: Number(rect.getAttribute("y")),
    width: Number(rect.getAttribute("width")), height: Number(rect.getAttribute("height")),
  })));
  expect(rows.length).toBeGreaterThan(20);
  expect(rows.every(row => row.width > 0 && row.height > 0)).toBe(true);
  // The round planet has stepped shoulders rather than a rectangular ocean.
  expect(rows[0]!.width).toBeLessThan(rows[Math.floor(rows.length / 2)]!.width);
  await page.screenshot({ path: testInfo.outputPath("planet.png"), fullPage: true });

  expect(failures.filter((message) => !message.includes("401 (Unauthorized)"))).toEqual([]);
});
