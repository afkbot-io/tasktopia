import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import type { BootstrapDto, Cell, ChunkTaskDto } from "../../src/shared/contracts";
import { CITY_SCENE_SCHEMA_VERSION, type CitySceneDto } from "../../src/shared/city-scene-contract";

test.skip(process.env.E2E_COMPACT_SERVICE_ART_FIXTURE !== "true", "Requires the exact isolated service-art fixture; read-only after login");

async function ready(page: Page) {
  const host = page.locator(".world-canvas");
  await expect(host).toHaveAttribute("data-map-active", "true", { timeout: 45_000 });
  await expect(host).toHaveAttribute("data-city-scene-commit", "atomic", { timeout: 45_000 });
  await expect(host).toHaveAttribute("data-map-lod", "detail", { timeout: 45_000 });
  await expect(host).toHaveAttribute("data-task-building-views", "16", { timeout: 45_000 });
  await expect(host).toHaveAttribute("data-ground-bake-queue", "0", { timeout: 45_000 });
  await expect(host).toHaveAttribute("data-world-object-depth-errors", "0");
}

async function camera(page: Page) {
  const host = page.locator(".world-canvas");
  return {
    scale: Number(await host.getAttribute("data-render-scale")),
    x: Number(await host.getAttribute("data-camera-world-x")),
    y: Number(await host.getAttribute("data-camera-world-y")),
  };
}

/** Public pointer pan only; no injected Pixi state, hidden zoom control or mocked art. */
async function centerOn(page: Page, target: Cell) {
  const canvas = page.locator("canvas[aria-label='Интерактивная карта города']");
  const box = (await canvas.boundingBox())!;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const current = await camera(page);
    const dx = (current.x - target.x) * 8 * current.scale;
    const dy = (current.y - target.y) * 8 * current.scale;
    if (Math.abs(dx) < 2 && Math.abs(dy) < 2) break;
    const fraction = Math.min(1, box.width * .4 / Math.max(1, Math.abs(dx)), box.height * .4 / Math.max(1, Math.abs(dy)));
    const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.mouse.move(center.x, center.y);
    await page.mouse.down();
    await page.mouse.move(center.x + dx * fraction, center.y + dy * fraction, { steps: 10 });
    await page.mouse.up();
  }
  await page.waitForTimeout(520); // Real pan suppresses selection for 500ms; not a substitute for scene readiness.
  await ready(page);
  const current = await camera(page);
  const point = {
    x: box.x + box.width / 2 + (target.x - current.x) * 8 * current.scale,
    y: box.y + box.height / 2 + (target.y - current.y) * 8 * current.scale,
  };
  expect(point.x).toBeGreaterThan(box.x + 48);
  expect(point.x).toBeLessThan(box.x + box.width - 48);
  expect(point.y).toBeGreaterThan(box.y + 48);
  expect(point.y).toBeLessThan(box.y + box.height - 48);
  return point;
}

test("real auto-assigned clinic and fire station render at native proportions and open their own tasks", async ({ page }, info) => {
  test.setTimeout(120_000);
  const url = new URL(process.env.E2E_DATABASE_URL ?? "invalid");
  expect(["localhost", "127.0.0.1"]).toContain(url.hostname);
  expect(url.pathname).toBe("/tasktopia_test");
  expect(url.searchParams.get("options")).toBe("-csearch_path=compact_service_art_20260905");
  const errors: string[] = [], failures: string[] = [], writes: string[] = [];
  const loadedArt = new Set<string>();
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/api/") && !["GET", "HEAD", "OPTIONS"].includes(request.method()) && path !== "/api/auth/login") {
      writes.push(`${request.method()} ${path}`);
    }
  });
  page.on("response", response => {
    const path = new URL(response.url()).pathname;
    if (response.status() >= 400 && !(response.status() === 401 && ["/api/session", "/api/bootstrap"].includes(path))) {
      failures.push(`${response.status()} ${path}`);
    }
    if (response.ok() && /\/buildings\/civic\/compact-(clinic|fire-station)-v1\/stage-5\.png$/.test(path)) loadedArt.add(path);
  });
  await page.goto("/");
  await page.getByLabel("Email").fill("demo@tasktopia.local");
  await page.getByLabel("Пароль").fill("tasktopia-demo");
  await page.getByRole("button", { name: "Открыть страну" }).click();
  await expect(page.getByLabel("Email")).toHaveCount(0, { timeout: 30_000 });
  const bootstrapResponse = await page.request.get("/api/bootstrap");
  expect(bootstrapResponse.ok()).toBe(true);
  const bootstrap = await bootstrapResponse.json() as BootstrapDto;
  expect(bootstrap.country.name).toBe("Compact service art QA");
  expect(bootstrap.initialCity?.name).toBe("Compact service art");
  expect(bootstrap.stats).toMatchObject({ cities: 1, districts: 1, tasks: 16, activeDistricts: 1 });
  // Bootstrap may deliberately start at COUNTRY. Enter the actual city through
  // the visible map; never force a camera mode through internal state.
  if (await page.locator(".country-overview").isVisible()) {
    await expect(page.locator(".country-overview")).toHaveAttribute("data-country-ready", "true", { timeout: 45_000 });
    await page.locator(".country-overview-city").first().click();
  }
  await ready(page);
  const sceneResponse = await page.request.get(`/api/countries/${bootstrap.country.id}/cities/${bootstrap.initialCity!.id}/scene`, {
    headers: { accept: `application/vnd.tasktopia.city-scene+json; version=${CITY_SCENE_SCHEMA_VERSION}` },
  });
  expect(sceneResponse.ok()).toBe(true);
  const scene = await sceneResponse.json() as CitySceneDto;
  expect(scene.schemaVersion).toBe(CITY_SCENE_SCHEMA_VERSION);
  const tasks = [...new Map([
    ...scene.chunks.flatMap(chunk => chunk.tasks),
    ...scene.completedDistrictSnapshots.flatMap(snapshot => snapshot.tasks),
  ].map(task => [task.id, task])).values()];
  expect(tasks).toHaveLength(16);
  const expected = [
    { number: 12, role: "MEDICAL", family: "compact-clinic-v1", file: "clinic" },
    { number: 16, role: "FIRE", family: "compact-fire-station-v1", file: "fire-station" },
  ] as const;
  const directory = process.env.COMPACT_SERVICE_ART_SCREENSHOTS ?? info.outputPath("service-art");
  await mkdir(directory, { recursive: true });
  await page.mouse.move(20, 25);
  await page.screenshot({ path: join(directory, "city.png"), fullPage: true });
  const rendered: Array<{ task: ChunkTaskDto; camera: Awaited<ReturnType<typeof camera>>; screenshot: string }> = [];
  for (const entry of expected) {
    const task = tasks.find(candidate => candidate.taskNumber === entry.number)!;
    expect(task).toMatchObject({ serviceRole: entry.role, buildingType: entry.family, stage: 5, visualKind: "BUILDING" });
    expect(task.footprint).toHaveLength(24);
    expect(new Set(task.footprint.map(cell => cell.x)).size).toBe(6);
    expect(new Set(task.footprint.map(cell => cell.y)).size).toBe(4);
    const target = { x: task.origin.x + 3, y: task.origin.y + 2 };
    await centerOn(page, target);
    const canvas = page.locator("canvas[aria-label='Интерактивная карта города']");
    const box = (await canvas.boundingBox())!;
    const beforeZoom = await camera(page);
    if (beforeZoom.scale < 3.8) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.wheel(0, -1200);
      await expect.poll(async () => (await camera(page)).scale).toBeGreaterThan(3.8);
      await page.waitForTimeout(700); // Let the real exponential wheel easing finish before a pixel-art capture.
    }
    const point = await centerOn(page, target);
    await page.mouse.move(20, 25);
    const screenshot = `${entry.file}-stage-5.png`;
    await page.screenshot({ path: join(directory, screenshot), fullPage: true });
    rendered.push({ task, camera: await camera(page), screenshot });
    await page.mouse.click(point.x, point.y);
    await expect(page.locator(".task-modal")).toBeVisible();
    await expect(page.locator("#task-title")).toContainText(task.title);
    await page.getByRole("button", { name: "Закрыть", exact: true }).click();
    await expect(page.locator(".task-modal")).toHaveCount(0);
  }
  expect([...loadedArt].filter(path => path.includes("compact-clinic-v1"))).toHaveLength(1);
  expect([...loadedArt].filter(path => path.includes("compact-fire-station-v1"))).toHaveLength(1);
  expect(new Set(tasks.map(task => task.stage))).toEqual(new Set([3, 4, 5]));
  const evidence = { sceneRevision: scene.sceneRevision, schemaVersion: scene.schemaVersion, taskCount: tasks.length,
    services: rendered, loadedArt: [...loadedArt], errors, failures, unexpectedWrites: writes };
  await info.attach("real-service-art", { body: JSON.stringify(evidence), contentType: "application/json" });
  await writeFile(join(directory, "evidence.json"), JSON.stringify(evidence, null, 2));
  expect(errors).toEqual([]);
  expect(failures).toEqual([]);
  expect(writes).toEqual([]);
});
