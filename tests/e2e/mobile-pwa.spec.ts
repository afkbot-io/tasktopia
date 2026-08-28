import { expect, test, type Locator, type Page } from "@playwright/test";

type GestureInterval = { startedAt: number; endedAt: number };
type LongTaskEntry = { startTime: number; duration: number };

async function dispatchPinch(page: Page, target: Locator, factor: number): Promise<GestureInterval> {
  return target.evaluate((element, zoomFactor) => {
    const box = element.getBoundingClientRect();
    const center = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    const startRadius = Math.min(box.width, box.height) * .08;
    const endRadius = startRadius * zoomFactor;
    const emit = (type: string, pointerId: number, x: number) => element.dispatchEvent(new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId,
      pointerType: "touch",
      isPrimary: pointerId === 1,
      clientX: x,
      clientY: center.y,
    }));
    const startedAt = performance.now();
    emit("pointerdown", 1, center.x - startRadius);
    emit("pointerdown", 2, center.x + startRadius);
    for (let step = 1; step <= 4; step += 1) {
      const radius = startRadius + (endRadius - startRadius) * step / 4;
      emit("pointermove", 1, center.x - radius);
      emit("pointermove", 2, center.x + radius);
    }
    emit("pointerup", 1, center.x - endRadius);
    emit("pointerup", 2, center.x + endRadius);
    return { startedAt, endedAt: performance.now() };
  }, factor);
}

async function login(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Email").fill("demo@tasktopia.local");
  await page.getByLabel("Пароль").fill("tasktopia-demo");
  await page.getByRole("button", { name: "Открыть страну" }).click();
  await expect(page.locator("canvas[aria-label='Интерактивная карта города']")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText("Готовим карту…", { exact: true })).toBeHidden({ timeout: 90_000 });
}

test("mobile viewport keeps controls safe and all map levels accept continuous touch zoom", async ({ page, browserName }, testInfo) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await login(page);
  await page.evaluate(() => {
    const state = window as typeof window & { __mobileLongTasks?: LongTaskEntry[] };
    state.__mobileLongTasks = [];
    if ("PerformanceObserver" in window && PerformanceObserver.supportedEntryTypes?.includes("longtask")) {
      new PerformanceObserver((list) => state.__mobileLongTasks!.push(...list.getEntries().map((entry) => ({
        startTime: entry.startTime,
        duration: entry.duration,
      }))))
        .observe({ type: "longtask", buffered: false });
    }
  });
  const measurePinch = async (target: Locator, factor: number) => {
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await page.evaluate(() => { (window as typeof window & { __mobileLongTasks?: LongTaskEntry[] }).__mobileLongTasks = []; });
    const interval = await dispatchPinch(page, target, factor);
    await page.waitForTimeout(180);
    return page.evaluate(({ startedAt, endedAt }) => (
      (window as typeof window & { __mobileLongTasks?: LongTaskEntry[] }).__mobileLongTasks ?? []
    ).filter((entry) => entry.startTime <= endedAt && entry.startTime + entry.duration >= startedAt)
      .map((entry) => entry.duration), interval);
  };

  const viewport = page.viewportSize()!;
  const layout = await page.evaluate(() => ({
    bodyWidth: document.body.scrollWidth,
    rootWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
  }));
  expect(layout.bodyWidth).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.rootWidth).toBeLessThanOrEqual(layout.viewportWidth);
  expect(viewport.width).toBe(layout.viewportWidth);

  const search = page.getByLabel("Поиск здания по номеру или названию");
  await search.fill("1");
  await expect(page.getByRole("option").first()).toBeVisible();
  await page.getByRole("option").first().click();
  const taskDialog = page.getByRole("dialog");
  await expect(taskDialog).toBeVisible();
  const taskBox = await taskDialog.boundingBox();
  expect(taskBox!.x).toBeGreaterThanOrEqual(0);
  expect(taskBox!.y).toBeGreaterThanOrEqual(0);
  expect(taskBox!.x + taskBox!.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(taskBox!.y + taskBox!.height).toBeLessThanOrEqual(viewport.height + 1);
  await taskDialog.getByRole("button", { name: "Закрыть", exact: true }).click();
  await expect(taskDialog).toBeHidden();

  const profile = page.getByRole("button", { name: /Настройки аккаунта/ });
  await expect(profile).toBeVisible();
  const profileBox = await profile.boundingBox();
  expect(profileBox!.width).toBeGreaterThanOrEqual(44);
  expect(profileBox!.height).toBeGreaterThanOrEqual(44);
  await profile.click();
  const settings = page.getByRole("dialog", { name: "Аккаунт и интеграции" });
  await expect(settings).toBeVisible();
  const settingsBox = await settings.boundingBox();
  expect(settingsBox!.x).toBeGreaterThanOrEqual(0);
  expect(settingsBox!.y).toBeGreaterThanOrEqual(0);
  expect(settingsBox!.x + settingsBox!.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(settingsBox!.y + settingsBox!.height).toBeLessThanOrEqual(viewport.height + 1);
  await settings.getByRole("button", { name: "Закрыть" }).click();
  await expect(settings).toBeHidden();

  const city = page.locator(".world-canvas");
  const cityScale = Number(await city.getAttribute("data-render-scale"));
  // Keep the interaction probe within the current CITY LOD. Crossing the
  // overview/detail threshold measures scene materialization, not gesture
  // handler latency, and is covered by the dedicated city-scene suites.
  const cityLongTasks = await measurePinch(city.locator("canvas"), 1.15);
  await expect.poll(async () => Number(await city.getAttribute("data-render-scale"))).toBeGreaterThan(cityScale);
  await expect(page.locator(".country-title-button")).toBeInViewport();
  await expect(page.locator(".header-search")).toBeInViewport();
  await expect(profile).toBeInViewport();
  if (process.env.MOBILE_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.MOBILE_SCREENSHOT_DIR}/${testInfo.project.name}-city.png` });

  await page.getByRole("button", { name: "Страна", exact: true }).click();
  const country = page.locator(".country-overview");
  await expect(country).toHaveAttribute("data-country-ready", "true", { timeout: 45_000 });
  const countryScale = Number(await country.getAttribute("data-country-zoom"));
  const countryLongTasks = await measurePinch(country, 1.35);
  await expect.poll(async () => Number(await country.getAttribute("data-country-zoom"))).toBeGreaterThan(countryScale);
  if (process.env.MOBILE_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.MOBILE_SCREENSHOT_DIR}/${testInfo.project.name}-country.png` });

  await page.getByRole("button", { name: "Планета", exact: true }).click();
  const planet = page.locator(".planet-atlas");
  await expect(planet).toBeVisible({ timeout: 45_000 });
  const planetScale = Number(await planet.getAttribute("data-globe-zoom"));
  const planetLongTasks = await measurePinch(planet.locator(":scope > svg"), 1.35);
  await expect.poll(async () => Number(await planet.getAttribute("data-globe-zoom"))).toBeGreaterThan(planetScale);
  if (process.env.MOBILE_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.MOBILE_SCREENSHOT_DIR}/${testInfo.project.name}-planet.png` });

  const performance = { cityLongTasks, countryLongTasks, planetLongTasks };
  await testInfo.attach("mobile-map-interaction-performance", { body: Buffer.from(JSON.stringify(performance, null, 2)), contentType: "application/json" });
  if (browserName === "chromium") expect(Math.max(0, ...cityLongTasks, ...countryLongTasks, ...planetLongTasks)).toBeLessThan(50);

  expect(errors.filter((message) => !message.includes("401 (Unauthorized)"))).toEqual([]);
});

test("installable shell registers a revisioned worker and survives offline navigation", async ({ page, context, browserName }) => {
  test.skip(browserName !== "chromium", "Playwright WebKit does not expose a production-equivalent service-worker lifecycle");
  await page.goto("/");
  const manifest = await page.locator('link[rel="manifest"]').getAttribute("href");
  expect(manifest).toBe("/site.webmanifest");
  const pwa = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise<void>((resolve) => navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), { once: true }));
    const cacheNames = await caches.keys();
    const cachedPaths = (
      await Promise.all(
        cacheNames.map(async (cacheName) => {
          const cache = await caches.open(cacheName);
          return (await cache.keys()).map((request) => new URL(request.url).pathname);
        }),
      )
    ).flat();
    return { scope: registration.scope, caches: cacheNames, cachedPaths, controlled: Boolean(navigator.serviceWorker.controller) };
  });
  expect(pwa.scope).toBe(`${new URL(page.url()).origin}/`);
  expect(pwa.controlled).toBe(true);
  expect(pwa.caches.some((key) => key.startsWith("tasktopia-shell-"))).toBe(true);
  expect(pwa.cachedPaths).toContain("/");
  expect(pwa.cachedPaths.some((path) => path.startsWith("/api/") || path.startsWith("/mcp/") || path.startsWith("/socket.io/"))).toBe(false);

  await context.setOffline(true);
  try {
    const response = await page.reload({ waitUntil: "domcontentloaded" });
    expect(response?.ok()).toBe(true);
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/site.webmanifest");
  } finally {
    await context.setOffline(false);
  }
});
