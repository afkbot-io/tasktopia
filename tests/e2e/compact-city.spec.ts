import { mkdir, writeFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import type { BootstrapDto } from "../../src/shared/contracts";
import { CITY_SCENE_SCHEMA_VERSION, type CitySceneDto } from "../../src/shared/city-scene-contract";
import { armWarmCityTiming } from "./helpers/warm-city-timing";

async function expectVisibleGround(page: Page): Promise<{ missingShare: number; sampled: number }> {
  const canvas = page.locator("canvas[aria-label='Интерактивная карта города']");
  const png = await canvas.screenshot();
  const coverage = await page.evaluate(async (encoded) => {
    const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d")!;
    context.drawImage(bitmap, 0, 0);
    const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
    let missing = 0;
    let sampled = 0;
    // The middle of this seeded city must show atlas terrain/roads, never
    // the solid city backdrop or WebGL clear color left by an empty bake.
    for (let y = Math.floor(bitmap.height * .2); y < bitmap.height * .8; y += 2) {
      for (let x = Math.floor(bitmap.width * .2); x < bitmap.width * .8; x += 2) {
        const index = (y * bitmap.width + x) * 4;
        const color = (data[index]! << 16) | (data[index + 1]! << 8) | data[index + 2]!;
        if (color === 0x668548 || color === 0x101d20 || data[index + 3] === 0) missing += 1;
        sampled += 1;
      }
    }
    bitmap.close();
    return { missingShare: missing / sampled, sampled };
  }, png.toString("base64"));
  expect(coverage.missingShare, JSON.stringify(coverage)).toBeLessThan(.08);
  return coverage;
}

async function ready(page: Page): Promise<void> {
  const host = page.locator(".world-canvas");
  await expect(host).toHaveAttribute("data-map-lod", "detail", { timeout: 45_000 });
  await expect.poll(async () => Number(await host.getAttribute("data-task-building-views")), { timeout: 45_000 }).toBeGreaterThan(30);
  await expect(host).toHaveAttribute("data-city-scene-commit", "atomic", { timeout: 45_000 });
  await expect(host).toHaveAttribute("data-ground-bake-queue", "0", { timeout: 45_000 });
}

test("renders every compact city ground chunk, opens its task, and survives country return", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  const failures: string[] = [];
  const sceneRequests: string[] = [];
  page.on("request", request => { if (new URL(request.url()).pathname.endsWith("/scene")) sceneRequests.push(request.url()); });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400 && !response.url().endsWith("/api/session")) failures.push(`${response.status()} ${new URL(response.url()).pathname}`);
  });
  // A cold atlas with concurrent chunks reproduced the lease/readiness race.
  await page.route("**/game-assets/**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 100));
    await route.continue();
  });
  await page.goto("/");
  await page.getByLabel("Email").fill("demo@tasktopia.local");
  await page.getByLabel("Пароль").fill("tasktopia-demo");
  await page.getByRole("button", { name: "Открыть страну" }).click();
  const host = page.locator(".world-canvas");
  await expect(host).toBeVisible({ timeout: 45_000 });
  if (!await page.locator(".header-city strong").isVisible()) {
    await page.locator(".country-title-button").click();
    await page.getByRole("dialog", { name: "Выбор страны" }).getByRole("button", { name: "План страны" }).click();
    await page.getByRole("complementary", { name: "План страны" }).locator(".plan-row > button:first-child", { hasText: "Riverside" }).click();
  }
  await ready(page);
  await expect.poll(async () => Number(await host.getAttribute("data-planned-sites")), { timeout: 45_000 }).toBeGreaterThan(0);
  await expect(host).toHaveAttribute("data-world-object-depth-errors", "0");
  const firstCoverage = await expectVisibleGround(page);
  const bootstrap = await (await page.request.get("/api/bootstrap")).json() as BootstrapDto;
  const scene = await (await page.request.get(`/api/countries/${bootstrap.country.id}/cities/${bootstrap.initialCity!.id}/scene`, {
    headers: { accept: `application/vnd.tasktopia.city-scene+json; version=${CITY_SCENE_SCHEMA_VERSION}` },
  })).json() as CitySceneDto;
  const task = scene.chunks.flatMap((chunk) => chunk.tasks).find((candidate) => candidate.taskNumber === 1)!;
  expect(task).toBeDefined();
  const canvas = page.locator("canvas[aria-label='Интерактивная карта города']");
  const box = (await canvas.boundingBox())!;
  const scale = Number(await host.getAttribute("data-render-scale"));
  const centerX = Number(await host.getAttribute("data-camera-world-x"));
  const centerY = Number(await host.getAttribute("data-camera-world-y"));
  // Click the roof itself through the same public camera coordinates used by
  // the map, not a search-result shortcut or an internal event dispatch.
  await page.mouse.click(box.x + box.width / 2 + (task.origin.x + 3 - centerX) * 8 * scale,
    box.y + box.height / 2 + (task.origin.y + 2 - centerY) * 8 * scale);
  await expect(page.locator(".task-modal")).toBeVisible();
  await expect(page.locator("#task-title")).toContainText(task.title);
  await page.getByRole("button", { name: "Закрыть", exact: true }).click();
  const retainedCanvas = await canvas.elementHandle();
  const initialSceneRequests = sceneRequests.length;
  await page.getByRole("button", { name: "Страна", exact: true }).click();
  const country = page.locator(".country-overview");
  await expect(country).toHaveAttribute("data-country-ready", "true", { timeout: 45_000 });
  await expect(host).toHaveAttribute("data-map-active", "false");
  await expect(host).toHaveAttribute("data-animation-active", "false");
  expect(await retainedCanvas!.evaluate(node => node.isConnected)).toBe(true);
  await expect(page.locator(".map-level-transition")).toHaveCount(0);
  await armWarmCityTiming(page);
  await country.locator(".country-overview-city").first().click();
  await ready(page);
  await expect(page.locator(".map-level-transition")).toHaveCount(0);
  await expect(host).toHaveAttribute("data-qa-warm-return-ms", /\d/);
  const warmReturnMs = Number(await host.getAttribute("data-qa-warm-return-ms"));
  expect(warmReturnMs).toBeLessThan(1_000);
  expect(await retainedCanvas!.evaluate(node => node === document.querySelector("canvas[aria-label='Интерактивная карта города']"))).toBe(true);
  expect(sceneRequests.length).toBe(initialSceneRequests);
  const returnCoverage = await expectVisibleGround(page);

  const directory = process.env.COMPACT_CITY_SCREENSHOT_DIR;
  if (directory) {
    await mkdir(directory, { recursive: true });
    // A taller review frame and a real pan expose the compact city. An outward
    // wheel at the minimum now correctly leaves CITY, so it is not a screenshot
    // shortcut. Wheel boundary behavior has its own regression journey.
    await page.setViewportSize({ width: 1440, height: 1100 });
    await ready(page);
    const overviewScale = Number(await host.getAttribute("data-render-scale"));
    const fullBox = (await canvas.boundingBox())!;
    const cameraX = Number(await host.getAttribute("data-camera-world-x"));
    const cameraY = Number(await host.getAttribute("data-camera-world-y"));
    const targetX = (scene.city.bounds.minX + scene.city.bounds.maxX) / 2;
    const targetY = (scene.city.bounds.minY + scene.city.bounds.maxY) / 2;
    const from = { x: fullBox.x + fullBox.width / 2, y: fullBox.y + fullBox.height / 2 };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + (cameraX - targetX) * 8 * overviewScale, from.y + (cameraY - targetY) * 8 * overviewScale, { steps: 8 });
    await page.mouse.up();
    await ready(page);
    const fullCoverage = await expectVisibleGround(page);
    expect(fullCoverage.missingShare).toBeLessThan(.01);
    await page.mouse.move(20, 25);
    await page.screenshot({ path: `${directory}/city.png`, fullPage: true });
    await canvas.hover();
    await page.mouse.wheel(0, -420);
    await expect.poll(async () => Number(await host.getAttribute("data-render-scale"))).toBeGreaterThan(1.5);
    await page.mouse.move(20, 25);
    await page.screenshot({ path: `${directory}/city-blocks.png`, fullPage: true });
    await page.getByRole("button", { name: "Страна", exact: true }).click();
    await expect(country).toHaveAttribute("data-country-ready", "true");
    await expect(page.locator(".map-level-transition")).toHaveCount(0);
    await page.screenshot({ path: `${directory}/country.png`, fullPage: true });
    await page.getByRole("button", { name: "Планета", exact: true }).click();
    await expect(page.locator(".planet-atlas")).toHaveAttribute("data-planet-ready", "true");
    await expect(page.locator(".planet-district-houses image").first()).toBeVisible();
    const tile = page.locator(".planet-terrain-sprite").first();
    expect(await tile.evaluate(node => {
      const width = getComputedStyle(node).width;
      // SVG geometry attributes may retain computed "auto". A CSS width:100%
      // on every nested tile instead stretches an entire spritesheet viewport.
      return width === "auto" || Math.abs(Number.parseFloat(width) - Number(node.getAttribute("width"))) < .1;
    })).toBe(true);
    await expect(page.locator(".map-level-transition")).toHaveCount(0);
    await page.screenshot({ path: `${directory}/planet.png`, fullPage: true });
  }
  const metrics = { firstCoverage, returnCoverage, warmReturnMs, sceneRequests: sceneRequests.length, sameCanvasRetained: true };
  await testInfo.attach("ground-and-warm-return", { body: JSON.stringify(metrics), contentType: "application/json" });
  if (directory) await writeFile(`${directory}/metrics.json`, JSON.stringify(metrics, null, 2));
  expect(errors).toEqual([]);
  expect(failures.filter((value) => !value.includes("401 /api/bootstrap"))).toEqual([]);
});

test("opens a deep-linked task card while city terrain is still pending", async ({ page }) => {
  let releaseScene!: () => void;
  const sceneGate = new Promise<void>(resolve => { releaseScene = resolve; });
  let sceneStarted = false;
  let sceneReleased = false;
  await page.route("**/api/countries/*/cities/*/scene", async route => {
    sceneStarted = true;
    await sceneGate;
    sceneReleased = true;
    await route.continue();
  });
  try {
    await page.goto("/task/1");
    await page.getByLabel("Email").fill("demo@tasktopia.local");
    await page.getByLabel("Пароль").fill("tasktopia-demo");
    await page.getByRole("button", { name: "Открыть страну" }).click();
    await expect.poll(() => sceneStarted).toBe(true);
    await expect(page.locator("#task-title")).toBeVisible({ timeout: 5_000 });
    expect(sceneReleased).toBe(false);
  } finally { releaseScene(); }
  await expect(page.locator(".world-canvas")).toHaveAttribute("data-city-scene-commit", "atomic", { timeout: 45_000 });
  const [linked] = await (await page.request.get("/api/tasks/search?q=1&limit=1")).json() as Array<{ origin: { x: number; y: number } }>;
  await expect(page.locator(".world-canvas")).toHaveAttribute("data-focus-x", String(linked!.origin.x));
  await expect(page.locator(".world-canvas")).toHaveAttribute("data-focus-y", String(linked!.origin.y));
});
