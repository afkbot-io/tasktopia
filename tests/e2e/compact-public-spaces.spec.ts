import { mkdir } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import type { CitySceneDto } from "../../src/shared/city-scene-contract";
import type { ChunkTaskDto, TaskDto } from "../../src/shared/contracts";
import { TASK_PARK_VARIANTS } from "../../src/shared/task-park-catalog";
import { PUBLIC_SPACES_CITY_NAME, PUBLIC_SPACES_PLAN } from "../fixtures/compact-public-spaces-plan";

test.skip(process.env.E2E_COMPACT_PUBLIC_SPACES_FIXTURE !== "true", "Explicit isolated public-spaces preview fixture only");
test.use({ viewport: { width: 1440, height: 1100 }, actionTimeout: 10_000 });
const directory = process.env.COMPACT_PUBLIC_SPACES_SCREENSHOT_DIR ?? "screenshots/compact-public-spaces";

async function ready(page: Page) {
  await expect(page.locator(".world-canvas")).toHaveAttribute("data-city-scene-commit", "atomic", { timeout: 60_000 });
  await expect(page.locator(".map-level-transition")).toHaveCount(0);
}
async function screenshot(page: Page, name: string) {
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: `${directory}/${name}.png`, fullPage: true });
}
/** Use the same public pointer pan and camera telemetry as the regular city
 * tests. Never move sprites, inject camera state, or call a Pixi callback. */
async function pointAt(page: Page, target: { x: number; y: number }) {
  const host = page.locator(".world-canvas");
  const box = (await page.locator("canvas[aria-label='Интерактивная карта города']").boundingBox())!;
  const before = {
    x: Number(await host.getAttribute("data-camera-world-x")), y: Number(await host.getAttribute("data-camera-world-y")),
    scale: Number(await host.getAttribute("data-render-scale")),
  };
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(center.x, center.y); await page.mouse.down();
  await page.mouse.move(center.x + (before.x - target.x) * 8 * before.scale,
    center.y + (before.y - target.y) * 8 * before.scale, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(520); // Real pan suppresses selection for500ms, not a loading delay.
  const currentScale = Number(await host.getAttribute("data-render-scale"));
  return {
    x: center.x + (target.x - Number(await host.getAttribute("data-camera-world-x"))) * 8 * currentScale,
    y: center.y + (target.y - Number(await host.getAttribute("data-camera-world-y"))) * 8 * currentScale,
  };
}
function taskCenter(task: ChunkTaskDto) {
  const xs = task.footprint.map(cell => cell.x), ys = task.footprint.map(cell => cell.y);
  return { x: (Math.min(...xs) + Math.max(...xs) + 1) / 2, y: (Math.min(...ys) + Math.max(...ys) + 1) / 2 };
}
async function clickCanonicalPark(page: Page, task: ChunkTaskDto) {
  const point = await pointAt(page, taskCenter(task));
  const response = page.waitForResponse(response => new URL(response.url()).pathname === `/api/tasks/${task.id}`
    && response.request().method() === "GET");
  await page.mouse.click(point.x, point.y);
  const loaded = await response;
  expect(loaded.status(), await loaded.text()).toBe(200);
  expect(await loaded.json() as TaskDto).toMatchObject({ id: task.id, stage: task.stage, visualAssetKey: task.visualAssetKey });
  await expect(page.getByRole("dialog").locator("#task-title")).toHaveText(task.title);
  await page.getByRole("button", { name: "Закрыть", exact: true }).click();
  await expect(page.locator(".task-modal")).toHaveCount(0);
  await page.mouse.move(15, 20);
}

test("real generated compact public spaces preserve stages, object selection and all map levels", async ({ page }, info) => {
  test.setTimeout(180_000);
  const consoleErrors: string[] = [], pageErrors: string[] = [], networkErrors: string[] = [], warnings: string[] = [], mapReads: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error") consoleErrors.push(message.text());
    if (message.type() === "warning") {
      warnings.push(message.text());
      // Chromium's software GPU reports readback stalls when Playwright takes
      // screenshots. Retain these as evidence, not as application errors or an
      // FPS claim. Context loss, Pixi and other WebGL warnings still fail.
      const screenshotReadback = /^\[\.WebGL-0x[\da-f]+\]GL Driver Message \(OpenGL, Performance, GL_CLOSE_PATH_NV, High\): GPU stall due to ReadPixels(?: \(this message will no longer repeat\))?$/.test(message.text());
      if (!screenshotReadback && /PixiJS|WebGL|passive.*listener/i.test(message.text())) consoleErrors.push(message.text());
    }
  });
  page.on("requestfailed", request => networkErrors.push(`${request.method()} ${new URL(request.url()).pathname}: ${request.failure()?.errorText}`));
  page.on("response", response => { if (response.status() >= 400) networkErrors.push(`${response.status()} ${new URL(response.url()).pathname}`); });
  page.on("request", request => {
    const path = new URL(request.url()).pathname;
    if (request.method() === "GET" && /\/scene$|\/overview$|\/planet-atlas$|\/world\/viewport|\/chunks\//.test(path)) mapReads.push(path);
  });
  // Authenticate before loading the shell so no expected anonymous401 can hide
  // a genuine map/API/PNG error in the browser's strict error arrays.
  const login = await page.request.post("/api/auth/login", { data: { email: "demo@tasktopia.local", password: "tasktopia-demo" } });
  expect(login.status(), await login.text()).toBe(200);
  const initialScene = page.waitForResponse(response => /\/api\/countries\/[^/]+\/cities\/[^/]+\/scene$/.test(new URL(response.url()).pathname));
  await page.goto("/");
  const response = await initialScene;
  expect(response.status(), await response.text()).toBe(200);
  const scene = await response.json() as CitySceneDto;
  expect(scene.city.name).toBe(PUBLIC_SPACES_CITY_NAME);
  await ready(page);
  const tasks = [...new Map([...scene.chunks.flatMap(chunk => chunk.tasks),
    ...scene.completedDistrictSnapshots.flatMap(snapshot => snapshot.tasks)].map(task => [task.id, task])).values()];
  expect(tasks).toHaveLength(30);
  expect(new Set(tasks.map(task => task.districtId)).size).toBe(3);
  expect(tasks.filter(task => task.visualKind === "BUILDING")).toHaveLength(11);
  expect([...new Set(tasks.filter(task => task.visualKind === "PARK").map(task => task.visualAssetKey))].sort()).toEqual([...TASK_PARK_VARIANTS].sort());
  for (const [index, example] of PUBLIC_SPACES_PLAN.flat().entries()) {
    const task = tasks.find(task => task.taskNumber === index + 1)!;
    expect(task.stage).toBe(example.stage);
    if (example.parkVariant) expect(task.visualAssetKey).toBe(example.parkVariant);
  }
  const large = tasks.find(task => task.visualAssetKey === "urban-large")!;
  expect(large.footprint).toHaveLength(289);
  expect(new Set(large.footprint.map(cell => cell.x)).size).toBe(17);
  expect(new Set(large.footprint.map(cell => cell.y)).size).toBe(17);
  await pointAt(page, { x: (scene.city.bounds.minX + scene.city.bounds.maxX) / 2, y: (scene.city.bounds.minY + scene.city.bounds.maxY) / 2 });
  await screenshot(page, "city");

  const canvas = page.locator("canvas[aria-label='Интерактивная карта города']");
  await canvas.hover(); await page.mouse.wheel(0, -520);
  await expect.poll(async () => Number(await page.locator(".world-canvas").getAttribute("data-render-scale"))).toBeGreaterThan(1.5);
  for (const variant of ["urban-fountain", "urban-monument"] as const) for (const stage of [3, 4, 5]) {
    const task = tasks.find(task => task.visualAssetKey === variant && task.stage === stage)!;
    expect(task, `${variant} stage${stage}`).toBeDefined();
    expect(new Set(task.footprint.map(cell => cell.x)).size).toBeLessThanOrEqual(6);
    expect(new Set(task.footprint.map(cell => cell.y)).size).toBeLessThanOrEqual(6);
    await clickCanonicalPark(page, task);
    await screenshot(page, `${variant}-stage-${stage}`);
  }
  await clickCanonicalPark(page, large);
  await screenshot(page, "large-park");
  expect(mapReads.filter(path => path.endsWith("/scene"))).toHaveLength(1);
  expect(mapReads.filter(path => /\/world\/viewport|\/chunks\//.test(path))).toEqual([]);

  await page.getByRole("button", { name: "Страна", exact: true }).click();
  await expect(page.locator(".country-overview")).toHaveAttribute("data-country-ready", "true");
  await expect(page.locator(".map-level-transition")).toHaveCount(0);
  await screenshot(page, "country");
  await page.getByRole("button", { name: "Планета", exact: true }).click();
  await expect(page.locator(".planet-atlas")).toHaveAttribute("data-planet-ready", "true");
  await expect(page.locator(".map-level-transition")).toHaveCount(0);
  await screenshot(page, "planet");

  // Responsive layout smoke, not a substitute for touch/Safari/PWA testing.
  await page.setViewportSize({ width: 390, height: 844 });
  const fitsViewport = async () => expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await fitsViewport();
  // The level bar zooms out; zooming in selects an actual country/city card.
  await page.getByRole("button", { name: /^Открыть страну .*, 1 городов,/ }).click();
  await expect(page.locator(".country-overview")).toHaveAttribute("data-country-ready", "true");
  await expect(page.locator(".map-level-transition")).toHaveCount(0);
  await fitsViewport();
  await page.getByRole("button", { name: new RegExp(`^Открыть город ${PUBLIC_SPACES_CITY_NAME},`) }).click();
  await ready(page);
  await fitsViewport();
  await clickCanonicalPark(page, tasks.find(task => task.visualAssetKey === "urban-pocket")!);
  await screenshot(page, "city-mobile");
  expect(mapReads.filter(path => path.endsWith("/scene"))).toHaveLength(1);
  expect(mapReads.filter(path => path.endsWith("/overview"))).toHaveLength(1);
  expect(mapReads.filter(path => path.endsWith("/planet-atlas"))).toHaveLength(1);
  expect(mapReads.filter(path => /\/world\/viewport|\/chunks\//.test(path))).toEqual([]);
  await info.attach("public-space-preview", { body: JSON.stringify({ schema: "compact_public_spaces_20260905", sceneRevision: scene.sceneRevision,
    tasks: tasks.map(task => ({ id: task.id, number: task.taskNumber, variant: task.visualAssetKey, stage: task.stage,
      origin: task.origin, footprintCells: task.footprint.length })), mapReads, pageErrors, consoleErrors, networkErrors, warnings }, null, 2), contentType: "application/json" });
  expect(pageErrors).toEqual([]); expect(consoleErrors).toEqual([]); expect(networkErrors).toEqual([]);
});
