import { openMapCity, openMapPlanet } from "./map-navigation";
import { expect, test, type Page } from "@playwright/test";

test("initial realtime connection preserves the scene but reconnect refreshes transport", async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    const NativeSocket = window.WebSocket;
    const sockets = new Set<WebSocket>();
    window.WebSocket = class extends NativeSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        sockets.add(this);
        this.addEventListener("close", () => sockets.delete(this));
      }
    };
    Object.assign(window, {
      qaOpenSockets: () => [...sockets].filter(socket => socket.readyState === NativeSocket.OPEN).length,
      qaCloseSockets: () => { for (const socket of sockets) socket.close(); },
    });
  });
  let scenes = 0;
  page.on("request", request => { if (new URL(request.url()).pathname.endsWith("/scene")) scenes++; });
  const { host } = await openDemoCity(page);
  await expect.poll(() => page.evaluate(() => (window as unknown as { qaOpenSockets(): number }).qaOpenSockets())).toBeGreaterThan(0);
  expect(scenes).toBe(1);
  const refreshes = Number(await host.getAttribute("data-transport-only-refreshes") ?? 0);
  await page.evaluate(() => (window as unknown as { qaCloseSockets(): void }).qaCloseSockets());
  await expect.poll(() => scenes, { timeout: 20_000 }).toBeGreaterThan(1);
  await expect.poll(async () => Number(await host.getAttribute("data-transport-only-refreshes") ?? 0), { timeout: 20_000 }).toBeGreaterThan(refreshes);
});

async function openDemoCity(page: Page) {
  await page.goto("/");
  await page.getByLabel("Email").fill("demo@tasktopia.local");
  await page.getByLabel("Пароль").fill("tasktopia-demo");
  await page.getByRole("button", { name: "Открыть страну" }).click();
  await openMapCity(page);
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
  const staticDecorationLayers = Number(await host.getAttribute("data-static-decoration-layers") ?? 0);
  expect(staticDecorationParticles).toBeGreaterThan(0);
  expect(decorationSpriteViews).toBe(ambientAnimations);
  // Compare decoration bands with decorations, not with buildings, incidents,
  // road features, padding and moving agents sharing the depth-sorted layer.
  expect(staticDecorationLayers).toBeGreaterThan(0);
  expect(staticDecorationLayers).toBeLessThan(staticDecorationParticles / 4);
  await expect(host).toHaveAttribute("data-world-object-depth-errors", "0");
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

test("renders the normalized city frame before input and crosses one level at the shared zoom-out limit", async ({ page }) => {
  test.setTimeout(120_000);
  const { host, canvas } = await openDemoCity(page);
  await expect(host).toHaveAttribute("data-city-first-frame-rendered", "true");
  expect(Number(await host.getAttribute("data-render-scale"))).toBeLessThanOrEqual(1);

  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  // One input crosses one boundary. Twelve separate round trips on a loaded
  // runner can span multiple gestures (>220 ms gaps), reaching PLANET.
  await page.mouse.wheel(0, 4_000);
  await expect(page.locator(".planet-atlas")).toHaveAttribute("data-planet-ready", "true");
  await expect(host).toHaveAttribute("data-animation-active", "false");
});

test("keeps the loader visible until the delayed whole-city scene commits", async ({ page }) => {
  test.setTimeout(120_000);
  let sceneStarted = false;
  let sceneResolved = false;
  let releaseScene!: () => void;
  const sceneGate = new Promise<void>(resolve => { releaseScene = resolve; });
  await page.route("**/api/countries/*/cities/*/scene", async (route) => {
    sceneStarted = true;
    await sceneGate;
    sceneResolved = true;
    await route.continue();
  });
  await page.goto("/");
  await page.getByLabel("Email").fill("demo@tasktopia.local");
  await page.getByLabel("Пароль").fill("tasktopia-demo");
  await page.getByRole("button", { name: "Открыть страну" }).click();
  await openMapCity(page);
  await expect.poll(() => sceneStarted).toBe(true);
  await expect(page.locator(".map-level-transition")).toContainText("Открываем город…");
  expect(sceneResolved).toBe(false);
  releaseScene();
  await expect(page.locator(".world-canvas")).toHaveAttribute("data-city-scene-commit", "atomic", { timeout: 90_000 });
  await expect(page.locator(".map-level-transition")).toHaveCount(0);
});

test("returns to the planet and allows city re-entry when the scene request fails", async ({ page }) => {
  test.setTimeout(120_000);
  let fail = true;
  await page.route("**/api/countries/*/cities/*/scene", async (route) => {
    if (fail) {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "temporary" }) });
      return;
    }
    await route.continue();
  });
  await page.goto("/");
  await page.getByLabel("Email").fill("demo@tasktopia.local");
  await page.getByLabel("Пароль").fill("tasktopia-demo");
  await page.getByRole("button", { name: "Открыть страну" }).click();
  await openMapCity(page);
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("temporary", { timeout: 30_000 });
  await expect(page.locator(".planet-atlas")).toHaveAttribute("data-planet-ready", "true");
  fail = false;
  await openMapCity(page);
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

test("ten planet-city cycles keep one renderer and a stable asset residency", async ({ page }) => {
  test.setTimeout(240_000);
  let { host } = await openDemoCity(page);
  const residentAssets: number[] = [];
  for (let cycle = 0; cycle < 10; cycle += 1) {
    await expect(page.locator(".map-region canvas")).toHaveCount(1);
    await expect(host).toHaveAttribute("data-ambient-assets", "ready", { timeout: 30_000 });
    residentAssets.push(Number(await host.getAttribute("data-leased-assets") ?? 0));
    await openMapPlanet(page);
    await expect(page.locator(".planet-atlas")).toHaveAttribute("data-planet-ready", "true");
    await expect(host).toHaveAttribute("data-animation-active", "false");
    await expect(page.locator(".planet-atlas canvas")).toHaveCount(0);
    await openMapCity(page);
    host = page.locator(".world-canvas");
    await expect(host).toHaveAttribute("data-city-scene-commit", "atomic", { timeout: 90_000 });
  }
  await expect(page.locator(".map-region canvas")).toHaveCount(1);
  await expect(page.locator(".country-city-glyph, .country-railway-overlay")).toHaveCount(0);
  expect(residentAssets.every((value) => value > 0)).toBe(true);
  expect(Math.max(...residentAssets)).toBeLessThanOrEqual(residentAssets[0]!);
});
