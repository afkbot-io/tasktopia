import { test, expect } from "@playwright/test";
test("switches light and decorative budgets without rebuilding the city", async ({ page }, info) => {
  test.skip(!/^http:\/\/(127\.0\.0\.1|localhost):/.test(process.env.E2E_BASE_URL ?? ""), "Local demo fixture only");
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.request.post("/api/auth/login", { data: { email: "demo@tasktopia.local", password: "tasktopia-demo" } });
  await page.goto("/");
  const host = page.locator(".world-canvas");
  await expect(host).toHaveAttribute("data-city-scene-commit", "atomic");
  await expect.poll(async () => Number(await host.getAttribute("data-construction-workers"))).toBeGreaterThan(2);
  const bakes = await host.getAttribute("data-ground-rebuilds");
  const canvas = await host.locator("canvas").elementHandle();
  await page.getByLabel("Вид карты", { exact: true }).click();
  await page.getByRole("combobox", { name: "Освещение", exact: true }).selectOption("DAY");
  await expect(host).toHaveAttribute("data-light-phase", "DAY");
  await expect(host).toHaveAttribute("data-lamp-intensity", "0.000");
  await page.getByRole("combobox", { name: "Детализация", exact: true }).selectOption("ECONOMY");
  await expect(host).toHaveAttribute("data-world-quality", "ECONOMY");
  await expect.poll(async () => Number(await host.getAttribute("data-construction-workers"))).toBeLessThanOrEqual(2);
  expect(await host.getAttribute("data-ground-rebuilds")).toBe(bakes);
  expect(await canvas!.evaluate(node => node.isConnected)).toBe(true);
  await page.screenshot({ path: info.outputPath("day-economy.png") });
  await page.getByRole("combobox", { name: "Детализация", exact: true }).selectOption("NORMAL");
  await expect.poll(async () => Number(await host.getAttribute("data-construction-workers"))).toBeGreaterThan(2);
  await page.reload();
  await expect(host).toHaveAttribute("data-light-phase", "DAY");
  await page.getByLabel("Вид карты", { exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Детализация", exact: true })).toHaveValue("NORMAL");
  await expect(host).toHaveAttribute("data-city-scene-commit", "atomic");
  await expect.poll(async () => Number(await host.getAttribute("data-construction-workers"))).toBeGreaterThan(2);
  const beforeMotionChange = await host.getAttribute("data-ground-rebuilds");
  const liveCanvas = await host.locator("canvas").elementHandle();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(host).toHaveAttribute("data-animation-active", "false");
  await page.getByRole("combobox", { name: "Освещение", exact: true }).selectOption("REAL_TIME");
  await page.getByRole("combobox", { name: "Освещение", exact: true }).selectOption("DAY");
  await expect(host).toHaveAttribute("data-light-phase", "DAY");
  await expect(host).toHaveAttribute("data-construction-workers", "0");
  await page.clock.setFixedTime(new Date("2026-09-16T09:00:00Z"));
  await page.getByRole("combobox", { name: "Освещение", exact: true }).selectOption("REAL_TIME");
  await expect(host).toHaveAttribute("data-light-phase", "DAY");
  await page.clock.setFixedTime(new Date("2026-09-16T21:00:00Z"));
  await expect(host).toHaveAttribute("data-light-phase", "NIGHT");
  await expect(host).toHaveAttribute("data-lamp-intensity", "1.000");
  await expect(host).toHaveAttribute("data-animation-active", "false");
  expect(await host.getAttribute("data-ground-rebuilds")).toBe(beforeMotionChange);
  expect(await liveCanvas!.evaluate(node => node.isConnected)).toBe(true);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(host).toHaveAttribute("data-animation-active", "true");
  await expect.poll(async () => Number(await host.getAttribute("data-construction-workers"))).toBeGreaterThan(2);
  expect(errors).toEqual([]);
});

test("mobile map preferences remain usable with disabled storage across map levels", async ({ page }, info) => {
  test.skip(!/^http:\/\/(127\.0\.0\.1|localhost):/.test(process.env.E2E_BASE_URL ?? ""), "Local demo fixture only");
  await page.setViewportSize({ width: 390, height: 844 });
  // Block only preference persistence, leaving unrelated existing application storage intact.
  await page.addInitScript(() => {
    const get = Storage.prototype.getItem, set = Storage.prototype.setItem;
    Storage.prototype.getItem = function(key) { if (key === "tasktopia:world-preferences:v1") throw new DOMException("Blocked", "SecurityError"); return get.call(this, key); };
    Storage.prototype.setItem = function(key, value) { if (key === "tasktopia:world-preferences:v1") throw new DOMException("Blocked", "SecurityError"); set.call(this, key, value); };
  });
  await page.request.post("/api/auth/login", { data: { email: "demo@tasktopia.local", password: "tasktopia-demo" } });
  await page.goto("/");
  await page.getByLabel("Вид карты", { exact: true }).click();
  await page.getByRole("combobox", { name: "Освещение", exact: true }).selectOption("DAY");
  await page.getByRole("combobox", { name: "Детализация", exact: true }).selectOption("ECONOMY");
  const bounds = await page.locator(".world-preferences .map-legend-panel").boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: info.outputPath("mobile-preferences.png") });
  await page.getByLabel("Вид карты", { exact: true }).click();
  await page.getByRole("button", { name: "Страна", exact: true }).click();
  await expect(page.locator(".country-overview")).toHaveAttribute("data-country-ready", "true");
  await expect(page.locator("html")).toHaveAttribute("data-world-quality", "ECONOMY");
  expect(await page.locator("html").evaluate(node => (node as HTMLElement).style.getPropertyValue("--world-light-filter"))).toBe("brightness(1)");
  await page.getByRole("button", { name: "Планета", exact: true }).click();
  await expect(page.locator(".planet-country").first()).toBeVisible();
  await page.getByLabel("Вид карты", { exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Освещение", exact: true })).toHaveValue("DAY");
});

test("atlas AUTO responds to sustained frame pressure without changing map contents", async ({ page }) => {
  test.skip(!/^http:\/\/(127\.0\.0\.1|localhost):/.test(process.env.E2E_BASE_URL ?? ""), "Local demo fixture only");
  // Exercise the real observer deterministically; this is not a performance benchmark.
  await page.addInitScript(() => {
    const original = window.requestAnimationFrame.bind(window);
    Object.assign(window, { qualityTestPressure: false });
    let realFrame = -1, testTime = 0;
    window.requestAnimationFrame = callback => original(time => {
      // All callbacks of one frame see the same monotonic synthetic time.
      // Multiplying WebKit's 33ms frames by8 exceeded the observer's250ms
      // background-gap cutoff and kept resetting its warmup indefinitely.
      if (time !== realFrame) {
        testTime = (window as unknown as { qualityTestPressure: boolean }).qualityTestPressure ? testTime + 100 : time;
        realFrame = time;
      }
      callback(testTime);
    });
  });
  await page.request.post("/api/auth/login", { data: { email: "demo@tasktopia.local", password: "tasktopia-demo" } });
  await page.goto("/");
  await expect(page.locator(".world-canvas")).toHaveAttribute("data-city-scene-commit", "atomic");
  for (const [name, selector, readyAttribute] of [
    ["Страна", ".country-overview", "data-country-ready"],
    ["Планета", ".planet-atlas", "data-planet-ready"],
  ] as const) {
    await page.evaluate(() => Object.assign(window, { qualityTestPressure: false }));
    await page.getByRole("button", { name, exact: true }).click();
    const map = page.locator(selector);
    await expect(map).toHaveAttribute(readyAttribute, "true");
    await page.getByLabel("Вид карты", { exact: true }).click();
    await page.getByRole("combobox", { name: "Детализация", exact: true }).selectOption("AUTO");
    const images = await map.locator("image, img").count();
    await page.evaluate(() => Object.assign(window, { qualityTestPressure: true }));
    await expect(page.locator("html")).toHaveAttribute("data-world-quality", "ECONOMY", { timeout: 15000 });
    expect(await map.locator("image, img").count()).toBe(images);
    await page.getByRole("combobox", { name: "Детализация", exact: true }).selectOption("NORMAL");
    await expect(page.locator("html")).toHaveAttribute("data-world-quality", "NORMAL");
    await page.getByLabel("Вид карты", { exact: true }).click();
  }
  const svg = page.locator(".planet-atlas > svg");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect.poll(() => svg.evaluate(node => (node as SVGSVGElement).animationsPaused())).toBe(true);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect.poll(() => svg.evaluate(node => (node as SVGSVGElement).animationsPaused())).toBe(false);
});
