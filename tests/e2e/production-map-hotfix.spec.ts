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
  for (let step = 0; step < 12 && await country.count() === 0; step += 1) {
    await page.mouse.wheel(0, 240);
    await page.waitForTimeout(80);
  }
  await expect(country).toBeVisible({ timeout: 5_000 });
  await expect(country.locator(".country-overview-city")).toHaveCount(1);
  expect(Number(await country.getAttribute("data-country-flights"))).toBeGreaterThan(0);
  await expect(country.locator(".country-side-fog")).toHaveCount(0);
  expect(Number(await country.getAttribute("data-country-zoom"))).toBeGreaterThan(1);
  await page.screenshot({ path: testInfo.outputPath("country.png"), fullPage: true });

  const countryBox = await country.boundingBox();
  expect(countryBox).not.toBeNull();
  await page.mouse.move(countryBox!.x + countryBox!.width / 2, countryBox!.y + countryBox!.height / 2);
  await page.mouse.wheel(0, 600);
  await expect.poll(async () => Number(await country.getAttribute("data-country-zoom"))).toBe(1);
  await page.mouse.wheel(0, 240);
  const planet = page.locator(".planet-atlas");
  await expect(planet).toBeVisible({ timeout: 5_000 });
  expect(Number(await planet.getAttribute("data-globe-zoom"))).toBeGreaterThan(1);
  const surface = planet.locator("clipPath ellipse");
  const radii = await surface.evaluate((ellipse) => ({ rx: Number(ellipse.getAttribute("rx")), ry: Number(ellipse.getAttribute("ry")) }));
  expect(radii.rx).toBeLessThan(500);
  expect(radii.ry).toBeLessThan(350);
  await page.screenshot({ path: testInfo.outputPath("planet.png"), fullPage: true });

  expect(failures.filter((message) => !message.includes("401 (Unauthorized)"))).toEqual([]);
});
