import { expect, test, type Page } from "@playwright/test";

async function openDemoCity(page: Page) {
  await page.goto("/");
  await page.getByLabel("Email").fill("demo@tasktopia.local");
  await page.getByLabel("Пароль").fill("tasktopia-demo");
  await page.getByRole("button", { name: "Открыть страну" }).click();
  const host = page.locator(".world-canvas");
  await expect(host).toHaveAttribute("data-city-scene-requests", "1", { timeout: 90_000 });
  await expect(host).toHaveAttribute("data-city-scene-commit", "atomic", { timeout: 90_000 });
  await expect(host).toHaveAttribute("data-loading", "false", { timeout: 90_000 });
  return { host, canvas: page.locator("canvas[aria-label='Интерактивная карта города']") };
}

test("loads a complete city through one request and never calls chunk endpoints", async ({ page }) => {
  test.setTimeout(120_000);
  const dataRequests: string[] = [];
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.endsWith("/scene") || pathname.includes("/world/viewport") || pathname.includes("/chunks/")) dataRequests.push(pathname);
  });
  const { host, canvas } = await openDemoCity(page);
  expect(dataRequests.filter((url) => url.endsWith("/scene"))).toHaveLength(1);
  expect(dataRequests.filter((url) => url.includes("/world/viewport") || url.includes("/chunks/"))).toEqual([]);
  await expect(host).toHaveAttribute("data-city-scene-entity-commits", "1");
  const staticDecorationParticles = Number(await host.getAttribute("data-static-decoration-particles") ?? 0);
  const decorationSpriteViews = Number(await host.getAttribute("data-decoration-sprite-views") ?? 0);
  const ambientAnimations = Number(await host.getAttribute("data-ambient-animations") ?? 0);
  const worldObjects = Number(await host.getAttribute("data-world-objects") ?? 0);
  expect(staticDecorationParticles).toBeGreaterThan(0);
  expect(decorationSpriteViews).toBe(ambientAnimations);
  expect(worldObjects).toBeLessThan(staticDecorationParticles / 4);
  expect(Number(await host.getAttribute("data-resident-chunks"))).toBe(Number(await host.getAttribute("data-city-scene-chunks")));
  await expect(host).toHaveAttribute("data-map-lod", "detail");

  dataRequests.length = 0;
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  for (const delta of [-500, 500, -350, 350]) {
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width / 2 + delta, box!.y + box!.height / 2, { steps: 12 });
    await page.mouse.up();
  }
  await page.waitForTimeout(500);
  expect(dataRequests).toEqual([]);
  await expect(page.getByText("Подгружаем карту…", { exact: true })).toHaveCount(0);
});

test("keeps the loader visible until the delayed whole-city scene commits", async ({ page }) => {
  test.setTimeout(120_000);
  let sceneStarted = false;
  let sceneResolved = false;
  await page.route("**/api/countries/*/cities/*/scene", async (route) => {
    sceneStarted = true;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    sceneResolved = true;
    await route.continue();
  });
  await page.goto("/");
  await page.getByLabel("Email").fill("demo@tasktopia.local");
  await page.getByLabel("Пароль").fill("tasktopia-demo");
  await page.getByRole("button", { name: "Открыть страну" }).click();
  await expect.poll(() => sceneStarted).toBe(true);
  await expect(page.getByText("Готовим карту…", { exact: true })).toBeVisible();
  expect(sceneResolved).toBe(false);
  await expect(page.locator(".world-canvas")).toHaveAttribute("data-city-scene-commit", "atomic", { timeout: 90_000 });
  await expect(page.getByText("Готовим карту…", { exact: true })).toBeHidden();
});

test("offers a renderer restart when the city-scene request fails", async ({ page }) => {
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
  await page.goto("/");
  await page.getByLabel("Email").fill("demo@tasktopia.local");
  await page.getByLabel("Пароль").fill("tasktopia-demo");
  await page.getByRole("button", { name: "Открыть страну" }).click();
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("Не удалось запустить карту", { timeout: 30_000 });
  await alert.getByRole("button", { name: "Повторить" }).click();
  await expect(alert).toHaveCount(0);
  await expect(page.locator(".world-canvas")).toHaveAttribute("data-city-scene-commit", "atomic", { timeout: 90_000 });
});

test("reduced motion still produces one complete static city frame", async ({ page }) => {
  test.setTimeout(120_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const { host } = await openDemoCity(page);
  await expect.poll(async () => Number(await host.getAttribute("data-static-renders") ?? 0)).toBeGreaterThan(0);
  await expect(host).toHaveAttribute("data-world-object-depth-errors", "0");
  await expect.poll(async () => Number(await host.getAttribute("data-world-objects") ?? 0)).toBeGreaterThan(0);
});

test("ten country-city cycles keep one renderer and a stable asset residency", async ({ page }) => {
  test.setTimeout(240_000);
  let { host } = await openDemoCity(page);
  const residentAssets: number[] = [];
  for (let cycle = 0; cycle < 10; cycle += 1) {
    await expect(page.locator(".map-region canvas")).toHaveCount(1);
    residentAssets.push(Number(await host.getAttribute("data-leased-assets") ?? 0));
    await page.getByRole("navigation", { name: "Уровень карты" }).getByRole("button", { name: "Страна" }).click();
    await expect(page.locator(".country-overview")).toHaveAttribute("data-country-ready", "true", { timeout: 30_000 });
    await expect(page.locator(".map-region canvas")).toHaveCount(1);
    await page.locator(".country-overview-city").first().click();
    host = page.locator(".world-canvas");
    await expect(host).toHaveAttribute("data-city-scene-commit", "atomic", { timeout: 90_000 });
  }
  await expect(page.locator(".map-region canvas")).toHaveCount(1);
  expect(residentAssets.every((value) => value > 0)).toBe(true);
  expect(Math.max(...residentAssets)).toBeLessThanOrEqual(residentAssets[0]!);
});
