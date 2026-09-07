import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import type { Cell, ChunkTaskDto, TaskDto } from "../../src/shared/contracts";
import { ASSET_REVISION, getBuilding } from "../../src/shared/catalog";
import { CITY_SCENE_SCHEMA_VERSION, type CitySceneDto } from "../../src/shared/city-scene-contract";
import { COURTYARD_FURNITURE } from "../../src/shared/courtyard-furniture";
import { materializeChunkPayload } from "../../src/shared/world-chunk-payload";
import { taskParkDecorLayout } from "../../src/shared/task-park";
import { COURTYARD_ART_CITY, COURTYARD_ART_PLAN, COURTYARD_ART_SERVICE_LIMIT } from "../fixtures/courtyard-art-plan";

test.skip(process.env.E2E_COURTYARD_ART_FIXTURE !== "true", "Read-only gate for a newly seeded local courtyard art fixture");
test.use({ viewport: { width: 1600, height: 1100 } });

async function ready(page: Page, count: number) {
  const host = page.locator(".world-canvas");
  await expect(host).toHaveAttribute("data-map-active", "true", { timeout: 60_000 });
  await expect(host).toHaveAttribute("data-city-scene-commit", "atomic", { timeout: 60_000 });
  await expect(host).toHaveAttribute("data-task-building-views", String(count));
  await expect(host).toHaveAttribute("data-ground-bake-queue", "0", { timeout: 60_000 });
  await expect(host).toHaveAttribute("data-world-object-depth-errors", "0");
  await expect(page.locator(".map-level-transition")).toHaveCount(0);
}
async function camera(page: Page) {
  const host = page.locator(".world-canvas");
  return { x: Number(await host.getAttribute("data-camera-world-x")),
    y: Number(await host.getAttribute("data-camera-world-y")), scale: Number(await host.getAttribute("data-render-scale")) };
}
async function centerOn(page: Page, target: Cell, count: number) {
  await expect(page.locator(".task-modal")).toHaveCount(0);
  const box = (await page.locator("canvas[aria-label='Интерактивная карта города']").boundingBox())!;
  for (let attempt = 0; attempt < 12; attempt++) {
    const current = await camera(page);
    const dx = (current.x - target.x) * 8 * current.scale, dy = (current.y - target.y) * 8 * current.scale;
    // Residual centering is unnecessary; retain the actual camera in the math.
    if (Math.abs(dx) + Math.abs(dy) < 24) break;
    const fraction = Math.min(1, box.width * .35 / Math.max(1, Math.abs(dx)), box.height * .35 / Math.max(1, Math.abs(dy)));
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x + dx * fraction, y + dy * fraction, { steps: 10 }); await page.mouse.up();
  }
  await page.waitForTimeout(520); // Respect the existing500ms pan/click guard.
  await ready(page, count);
  await expect(page.locator(".task-modal")).toHaveCount(0);
  const current = await camera(page);
  return { x: box.x + box.width / 2 + (target.x - current.x) * 8 * current.scale,
    y: box.y + box.height / 2 + (target.y - current.y) * 8 * current.scale };
}
async function captureMap(page: Page, file: string) {
  await expect(page.locator(".task-modal")).toHaveCount(0);
  await expect(page.locator(".map-level-transition")).toHaveCount(0);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.screenshot({ path: file, fullPage: true });
}
function nativePixelCheck(input: { native: string; screen: string; x: number; y: number; scale: number; roi?: number[] }) {
  // Integer camera phase only; never alternate art, resize, recolor or mask
  // observed failures. A building ROI excludes its deliberate fence/badge.
  const script = `import json,sys;from PIL import Image
data=json.loads(sys.argv[1]);native=Image.open(data['native']).convert('RGBA');screen=Image.open(data['screen']).convert('RGBA')
r=data.get('roi',[0,0,native.width,native.height])
points=[(x,y,p) for y in range(r[1],r[3]) for x in range(r[0],r[2]) if (p:=native.getpixel((x,y)))[3]==255]
best=0
for dy in range(-4,5):
 for dx in range(-4,5):
  matched=0
  for x,y,p in points:
   sx=round(data['x']+dx+(x+.5)*data['scale']);sy=round(data['y']+dy+(y+.5)*data['scale'])
   if 0<=sx<screen.width and 0<=sy<screen.height and screen.getpixel((sx,sy))[:3]==p[:3]: matched+=1
  best=max(best,matched)
print(json.dumps({'matched':best,'opaque':len(points),'ratio':best/len(points)}))`;
  return JSON.parse(execFileSync(".venv-assets/bin/python", ["-c", script, JSON.stringify(input)], { encoding: "utf8" })) as {
    matched: number; opaque: number; ratio: number;
  };
}
const center = (task: ChunkTaskDto): Cell => ({
  x: (Math.min(...task.footprint.map(c => c.x)) + Math.max(...task.footprint.map(c => c.x)) + 1) / 2,
  y: (Math.min(...task.footprint.map(c => c.y)) + Math.max(...task.footprint.map(c => c.y)) + 1) / 2,
});

test("published developed families and completed courtyard furniture render through one real scene", async ({ page }, info) => {
  test.setTimeout(300_000);
  // Fixed daylight Date, not frozen timers: exact native RGB probes must not
  // compare accepted art against the legitimate time-of-day lighting tint.
  await page.clock.setFixedTime(new Date("2026-09-07T09:00:00Z"));
  const fixturePath = process.env.COURTYARD_ART_FIXTURE_JSON;
  expect(fixturePath, "Use the artifact returned by the guarded fixture script").toBeTruthy();
  const fixture = JSON.parse(await readFile(resolve(fixturePath!), "utf8")) as {
    schema: string; countryId: string; cityId: string; taskCount: number; caseCount: number; assetRevision: string;
    tasks: Array<{ key: string; id: string }>; connectors: unknown[];
    bounds: { minX: number; minY: number; maxX: number; maxY: number };
  };
  const database = new URL(process.env.E2E_DATABASE_URL ?? "invalid");
  expect(["localhost", "127.0.0.1"]).toContain(database.hostname);
  expect(database.pathname).toBe("/tasktopia_test");
  expect(fixture.schema).toMatch(/^courtyard_art_preview_[a-f0-9]{32}$/);
  expect(database.searchParams.get("options")).toBe(`-csearch_path=${fixture.schema}`);
  expect(fixture.assetRevision).toBe(ASSET_REVISION);
  expect(fixture.caseCount).toBe(48);
  expect(fixture.caseCount).toBe(COURTYARD_ART_PLAN.length);
  expect(fixture.connectors.length).toBeLessThanOrEqual(COURTYARD_ART_SERVICE_LIMIT);
  expect(fixture.taskCount).toBe(fixture.caseCount + fixture.connectors.length);
  const output = process.env.COURTYARD_ART_SCREENSHOT_DIR ?? info.outputPath("courtyard-art");
  await mkdir(output, { recursive: true });
  const errors: string[] = [], warnings: string[] = [], failed: string[] = [], mapReads: string[] = [], writes: string[] = [];
  const loadedBuildingArt = new Set<string>();
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error") errors.push(message.text());
    if (message.type() === "warning") {
      warnings.push(message.text());
      const screenshotReadback = /^\[\.WebGL-0x[\da-f]+\]GL Driver Message \(OpenGL, Performance, GL_CLOSE_PATH_NV, High\): GPU stall due to ReadPixels(?: \(this message will no longer repeat\))?$/.test(message.text());
      if (!screenshotReadback && /PixiJS|WebGL|passive.*listener/i.test(message.text())) errors.push(message.text());
    }
  });
  page.on("requestfailed", request => failed.push(`${new URL(request.url()).pathname}: ${request.failure()?.errorText}`));
  page.on("request", request => {
    const path = new URL(request.url()).pathname;
    if (request.method() === "GET" && /\/scene$|\/overview$|\/planet-atlas$|\/world\/viewport|\/chunks\//.test(path)) mapReads.push(path);
    if (path.startsWith("/api/") && !["GET", "HEAD", "OPTIONS"].includes(request.method())) writes.push(`${request.method()} ${path}`);
  });
  page.on("response", response => {
    const path = new URL(response.url()).pathname;
    if (response.status() >= 400) failed.push(`${response.status()} ${path}`);
    if (response.ok() && /\/buildings\/.*\/stage-[345]\.png$/.test(path)) loadedBuildingArt.add(path);
  });
  // API login sets a real session before navigation, avoiding an expected
  // anonymous401 in the strict runtime failure list. No domain mutations.
  const login = await page.request.post("/api/auth/login", { data: { email: "demo@tasktopia.local", password: "tasktopia-demo" } });
  expect(login.status(), await login.text()).toBe(200);
  const scenePending = page.waitForResponse(response => new URL(response.url()).pathname
    === `/api/countries/${fixture.countryId}/cities/${fixture.cityId}/scene`);
  await page.goto("/");
  await expect.poll(async () => await page.locator(".country-overview").isVisible()
    || await page.locator(".world-canvas").isVisible(), { timeout: 60_000 }).toBe(true);
  if (await page.locator(".country-overview").isVisible()) {
    await expect(page.locator(".country-overview")).toHaveAttribute("data-country-ready", "true", { timeout: 60_000 });
    await page.locator(".country-overview-city").first().click();
  }
  const response = await scenePending;
  expect(response.status(), await response.text()).toBe(200);
  const scene = await response.json() as CitySceneDto;
  expect(scene.schemaVersion).toBe(CITY_SCENE_SCHEMA_VERSION);
  expect(scene.city).toMatchObject({ id: fixture.cityId, name: COURTYARD_ART_CITY });
  const tasks = new Map([...scene.chunks.flatMap(c => c.tasks),
    ...scene.completedDistrictSnapshots.flatMap(s => s.tasks)].map(task => [task.id, task]));
  expect(tasks.size).toBe(fixture.taskCount);
  await ready(page, tasks.size);
  await centerOn(page, { x: (fixture.bounds.minX + fixture.bounds.maxX + 1) / 2,
    y: (fixture.bounds.minY + fixture.bounds.maxY + 1) / 2 }, tasks.size);
  await page.mouse.move(15, 20);
  await captureMap(page, join(output, "city.png"));
  await page.getByRole("button", { name: "Границы", exact: true }).click();
  await expect(page.locator(".world-canvas")).toHaveAttribute("data-district-boundary-visible", "true");
  await expect(page.locator(".world-canvas")).toHaveAttribute("data-district-boundary-groups", "3");
  expect(Number(await page.locator(".world-canvas").getAttribute("data-district-boundary-cells"))).toBeGreaterThan(0);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await captureMap(page, join(output, "districts.png"));
  await page.getByRole("button", { name: "Границы", exact: true }).click();
  await expect(page.locator(".world-canvas")).toHaveAttribute("data-district-boundary-visible", "false");
  const canvas = page.locator("canvas[aria-label='Интерактивная карта города']");
  await canvas.hover(); await page.mouse.wheel(0, -1600);
  await expect.poll(async () => (await camera(page)).scale).toBeGreaterThan(3.99);
  await page.waitForTimeout(700);
  const slowDragTask = tasks.get(fixture.tasks.find(item => item.key === "compact-apartment-v1-5")!.id)!;
  const slowStart = await centerOn(page, center(slowDragTask), tasks.size);
  const beforeSlowDrag = await camera(page);
  await page.mouse.move(slowStart.x, slowStart.y); await page.mouse.down();
  for (let pixel = 1; pixel <= 12; pixel++) await page.mouse.move(slowStart.x + pixel, slowStart.y);
  await page.waitForTimeout(650); // Longer than post-gesture suppression, still held.
  await expect(page.locator(".task-modal")).toHaveCount(0);
  await page.mouse.up();
  const afterSlowDrag = await camera(page);
  expect(Math.abs(afterSlowDrag.x - beforeSlowDrag.x)).toBeGreaterThan(.25);
  await expect(page.locator(".task-modal")).toHaveCount(0);
  await page.waitForTimeout(520);
  const afterSlowPoint = await centerOn(page, center(slowDragTask), tasks.size);
  const slowDetails = page.waitForResponse(r => new URL(r.url()).pathname === `/api/tasks/${slowDragTask.id}` && r.request().method() === "GET");
  await page.mouse.click(afterSlowPoint.x, afterSlowPoint.y);
  expect(await (await slowDetails).json() as TaskDto).toMatchObject({ id: slowDragTask.id, stage: 5 });
  await expect(page.locator("#task-title")).toHaveText(slowDragTask.title);
  await page.getByRole("button", { name: "Закрыть", exact: true }).click();
  await expect(page.locator(".task-modal")).toHaveCount(0);
  const slowDrag = { taskId: slowDragTask.id, screenPixels: 12, stepPixels: 1, holdMs: 650,
    before: beforeSlowDrag, after: afterSlowDrag, openedDuringDrag: false, normalClickOpenedCorrectTask: true };
  // Synthetic DOM PointerEvents exercise the real binder/Pixi integration;
  // they are not physical-device or trusted OS-touch acceptance.
  const touchPoint = await centerOn(page, center(slowDragTask), tasks.size);
  const touch = async (type: "pointerdown" | "pointerup", pointerId: number) => canvas.evaluate((element, input) => {
    element.dispatchEvent(new PointerEvent(input.type, { bubbles: true, cancelable: true,
      pointerId: input.pointerId, pointerType: "touch", isPrimary: input.pointerId === 101,
      clientX: input.x + (input.pointerId === 102 ? 2 : 0), clientY: input.y,
      button: 0, buttons: input.type === "pointerdown" ? 1 : 0 }));
  }, { type, pointerId, ...touchPoint });
  await touch("pointerdown", 101); await touch("pointerdown", 102);
  await touch("pointerup", 101);
  await expect(page.locator(".task-modal")).toHaveCount(0);
  await page.waitForTimeout(650);
  await touch("pointerup", 102);
  await expect(page.locator(".task-modal")).toHaveCount(0);
  await page.waitForTimeout(520);
  await page.mouse.click(touchPoint.x, touchPoint.y);
  await expect(page.locator("#task-title")).toHaveText(slowDragTask.title);
  await page.getByRole("button", { name: "Закрыть", exact: true }).click();
  await expect(page.locator(".task-modal")).toHaveCount(0);
  const multiContact = { taskId: slowDragTask.id, input: "synthetic DOM PointerEvents", motionPixels: 0,
    releaseOrder: [101, 102], remainingContactHoldMs: 650, openedDuringGesture: false, normalClickOpenedCorrectTask: true };
  const frames: Array<{ key: string; id: string; stage: number; screenshot: string; camera: Awaited<ReturnType<typeof camera>> }> = [];
  const parkFurniture: Array<{ key: string; cells: number; kinds: string[] }> = [];
  for (const example of COURTYARD_ART_PLAN) {
    const task = tasks.get(fixture.tasks.find(item => item.key === example.key)!.id)!;
    expect(task.stage).toBe(example.stage);
    if (example.family) {
      expect(task.buildingType).toBe(example.family);
      const shape = getBuilding(example.family).footprint;
      expect(task.footprint).toHaveLength(shape.width * shape.height);
    } else {
      expect(task.visualAssetKey).toBe(example.parkVariant);
      const props = taskParkDecorLayout(task.footprint, example.stage, task.visualAssetKey, task.taskNumber)
        .filter(p => Object.hasOwn(COURTYARD_FURNITURE, p.kind));
      // Protected paths, centrepieces and lighting can consume every usable
      // bed. Stage5 permits furniture; it must never force it onto obstacles.
      if (example.stage < 5) expect(props).toEqual([]);
      expect(props.length).toBeLessThanOrEqual(3);
      expect(new Set(props.map(prop => prop.kind)).size).toBe(props.length);
      parkFurniture.push({ key: example.key, cells: task.footprint.length, kinds: props.map(prop => prop.kind) });
    }
    const point = await centerOn(page, center(task), tasks.size);
    const view = (await canvas.boundingBox())!;
    const actualCamera = await camera(page);
    const projected = task.footprint.map(cell => ({
      x: view.x + view.width / 2 + (cell.x - actualCamera.x) * 8 * actualCamera.scale,
      y: view.y + view.height / 2 + (cell.y - actualCamera.y) * 8 * actualCamera.scale,
    }));
    expect(Math.min(...projected.map(cell => cell.x))).toBeGreaterThan(view.x + 16);
    expect(Math.min(...projected.map(cell => cell.y))).toBeGreaterThan(view.y + 16);
    expect(Math.max(...projected.map(cell => cell.x)) + 8 * actualCamera.scale).toBeLessThan(view.x + view.width - 16);
    expect(Math.max(...projected.map(cell => cell.y)) + 8 * actualCamera.scale).toBeLessThan(view.y + view.height - 16);
    await page.mouse.move(15, 20);
    const file = `${example.key}.png`;
    await captureMap(page, join(output, file));
    frames.push({ key: example.key, id: task.id, stage: task.stage, screenshot: file, camera: await camera(page) });
    // One representative click per shape/variant at its finished stage verifies
    // real hit areas and canonical ownership, including non-square L/U sites.
    if (example.stage === 5) {
      // The slow-drag check already opened the apartment. Its warm modal is
      // intentionally cached; every other first open still validates real GET.
      const details = task.id === slowDragTask.id ? undefined
        : page.waitForResponse(r => new URL(r.url()).pathname === `/api/tasks/${task.id}` && r.request().method() === "GET");
      await page.mouse.click(point.x, point.y);
      if (details) expect(await (await details).json() as TaskDto).toMatchObject({ id: task.id, stage: 5 });
      await expect(page.locator("#task-title")).toHaveText(task.title);
      await page.getByRole("button", { name: "Закрыть", exact: true }).click();
      await expect(page.locator(".task-modal")).toHaveCount(0);
    }
  }
  // Keep matrix/GET evidence even if a later strict native pixel gate fails.
  await writeFile(join(output, "stage-matrix-evidence.json"), `${JSON.stringify({
    schema: fixture.schema, assetRevision: ASSET_REVISION, sceneRevision: scene.sceneRevision,
    frames, parkFurniture, mapReads, errors, warnings, failed, writes,
  }, null, 2)}\n`);
  const naturalDecorations = [...new Map(scene.chunks.flatMap(chunk => materializeChunkPayload(chunk).decorations).map(p => [p.id, p])).values()];
  const furniture = [
    ...naturalDecorations.filter(p => Object.hasOwn(COURTYARD_FURNITURE, p.kind)),
    ...[...tasks.values()].filter(t => t.visualKind === "PARK").flatMap(task =>
      taskParkDecorLayout(task.footprint, task.stage as 3 | 4 | 5, task.visualAssetKey, task.taskNumber)
        .filter(p => Object.hasOwn(COURTYARD_FURNITURE, p.kind))),
  ];
  const pixelChecks: unknown[] = [];
  for (const [kind, shape] of Object.entries(COURTYARD_FURNITURE)) {
    const prop = furniture.find(p => p.kind === kind)!;
    expect(prop, `Actual completed placement of ${kind}`).toBeDefined();
    const point = await centerOn(page, { x: prop.origin.x, y: prop.origin.y }, tasks.size);
    await page.mouse.move(15, 20);
    const screenshot = join(output, `${kind}-native4x.png`);
    await captureMap(page, screenshot);
    const scale = (await camera(page)).scale;
    const pixels = nativePixelCheck({
      native: resolve(`public/game-assets/v5/props/${kind}.png`), screen: resolve(screenshot),
      x: point.x, y: point.y, scale,
    });
    expect(pixels.ratio, `${kind}: actual native opaque pixels must be visible, not only declared in the DTO`).toBeGreaterThan(.95);
    pixelChecks.push({ kind, origin: prop.origin, footprint: shape, screenshot, ...pixels });
  }
  const vertical = tasks.get(fixture.tasks.find(item => item.key === "compact-long-slate-wing-v1-3")!.id)!;
  const verticalEntry = getBuilding(vertical.buildingType);
  const verticalPoint = await centerOn(page, center(vertical), tasks.size);
  await page.mouse.move(15, 20);
  const verticalScreenshot = join(output, "compact-long-slate-wing-v1-3-native4x.png");
  await captureMap(page, verticalScreenshot);
  const verticalScale = (await camera(page)).scale;
  const verticalRoi = [2, 2, verticalEntry.spriteSize.width - 2, verticalEntry.spriteSize.height - 10];
  const verticalPixels = nativePixelCheck({
    native: resolve("public/game-assets/v5/buildings/house/compact-long-slate-wing-v1/stage-3.png"),
    screen: resolve(verticalScreenshot), scale: verticalScale, roi: verticalRoi,
    x: verticalPoint.x - verticalEntry.spriteSize.width / 2 * verticalScale,
    y: verticalPoint.y + (verticalEntry.footprint.height * 8 / 2 - verticalEntry.spriteSize.height) * verticalScale,
  });
  expect(verticalPixels.opaque).toBeGreaterThan(1000);
  expect(verticalPixels.ratio, "Vertical building native opaque ROI must remain nearest-sampled").toBeGreaterThan(.95);
  pixelChecks.push({ family: vertical.buildingType, stage: 3, roi: verticalRoi, screenshot: verticalScreenshot, ...verticalPixels });
  for (const example of COURTYARD_ART_PLAN.filter(item => item.family)) {
    expect([...loadedBuildingArt].some(path => path.endsWith(`/${example.family}/stage-${example.stage}.png`)), example.key).toBe(true);
  }
  // A separate real1× view distinguishes native readability from enlarged
  // inspection. Use normal wheel input and a bounded tall desktop viewport.
  await page.setViewportSize({ width: 1600, height: 1400 });
  await ready(page, tasks.size);
  await canvas.hover();
  await page.mouse.wheel(0, Math.log((await camera(page)).scale) / .0015);
  await expect.poll(async () => Math.abs((await camera(page)).scale - 1)).toBeLessThan(.001);
  const nativeFrames: Array<{ kind: string; origin: Cell; screenshot: string }> = [];
  for (const kind of Object.keys(COURTYARD_FURNITURE)) {
    const prop = furniture.find(p => p.kind === kind)!;
    await centerOn(page, prop.origin, tasks.size); await page.mouse.move(15, 20);
    const file = `${kind}-native1x.png`;
    await captureMap(page, join(output, file));
    nativeFrames.push({ kind, origin: prop.origin, screenshot: file });
  }
  await centerOn(page, { x: (fixture.bounds.minX + fixture.bounds.maxX + 1) / 2,
    y: (fixture.bounds.minY + fixture.bounds.maxY + 1) / 2 }, tasks.size);
  await captureMap(page, join(output, "city-native1x.png"));
  expect(mapReads.filter(path => path.endsWith("/scene"))).toHaveLength(1);
  expect(mapReads.filter(path => /\/world\/viewport|\/chunks\//.test(path))).toEqual([]);
  await page.getByRole("button", { name: "Страна", exact: true }).click();
  await expect(page.locator(".country-overview")).toHaveAttribute("data-country-ready", "true", { timeout: 60_000 });
  await captureMap(page, join(output, "country.png"));
  await page.getByRole("button", { name: "Планета", exact: true }).click();
  await expect(page.locator(".planet-atlas")).toHaveAttribute("data-planet-ready", "true", { timeout: 60_000 });
  await captureMap(page, join(output, "planet.png"));
  await page.getByRole("button", { name: "Город", exact: true }).click();
  await ready(page, tasks.size);
  const originalCanvas = await canvas.elementHandle();
  const decorationCount = await page.locator(".world-canvas").getAttribute("data-static-decoration-particles");
  const lampCount = await page.locator(".world-canvas").getAttribute("data-illuminated-lamps");
  // Explicit clock-controlled night, not an application dropdown or a paused
  // simulation. Wait for the real lighting sampler to apply the new phase.
  await page.clock.setFixedTime(new Date("2026-09-07T18:00:00Z"));
  await expect(page.locator(".world-canvas")).toHaveAttribute("data-light-phase", "NIGHT");
  await expect(page.locator(".world-canvas")).toHaveAttribute("data-lamp-intensity", "1.000");
  expect(Number(lampCount)).toBeGreaterThan(0);
  await expect(page.locator(".world-canvas")).toHaveAttribute("data-illuminated-lamps", lampCount!);
  await expect(page.locator(".world-canvas")).toHaveAttribute("data-static-decoration-particles", decorationCount!);
  expect(await originalCanvas!.evaluate(node => node.isConnected)).toBe(true);
  await expect(page.getByLabel("Освещение мира")).toHaveCount(0);
  await captureMap(page, join(output, "city-night-clock-controlled.png"));
  expect(mapReads.filter(path => path.endsWith("/scene"))).toHaveLength(1);
  expect(mapReads.filter(path => path.endsWith("/overview"))).toHaveLength(1);
  expect(mapReads.filter(path => path.endsWith("/planet-atlas"))).toHaveLength(1);
  const evidence = { schema: fixture.schema, assetRevision: ASSET_REVISION, sceneRevision: scene.sceneRevision,
    caseCount: frames.length, taskCount: tasks.size, serviceConnectors: fixture.connectors, frames, pixelChecks, parkFurniture, nativeFrames, slowDrag, multiContact,
    lightingDate: "2026-09-07T09:00:00Z",
    night: { lightingDate: "2026-09-07T18:00:00Z", phase: "NIGHT", lampIntensity: 1,
      lamps: Number(lampCount), staticDecorationParticles: Number(decorationCount), canvasRetained: true },
    loadedBuildingArt: [...loadedBuildingArt], mapReads, errors, warnings, failed, writes };
  await writeFile(join(output, "evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
  expect(errors).toEqual([]); expect(failed).toEqual([]); expect(writes).toEqual([]);
});

test("recaptures settled overview and clock-controlled night without transition overlays", async ({ page }, info) => {
  test.setTimeout(90_000);
  const fixture = JSON.parse(await readFile(resolve(process.env.COURTYARD_ART_FIXTURE_JSON!), "utf8")) as {
    schema: string; taskCount: number; assetRevision: string;
  };
  const database = new URL(process.env.E2E_DATABASE_URL ?? "invalid");
  expect(["localhost", "127.0.0.1"]).toContain(database.hostname);
  expect(database.pathname).toBe("/tasktopia_test");
  expect(fixture.schema).toMatch(/^courtyard_art_preview_[a-f0-9]{32}$/);
  expect(database.searchParams.get("options")).toBe(`-csearch_path=${fixture.schema}`);
  expect(fixture.assetRevision).toBe(ASSET_REVISION);
  const output = process.env.COURTYARD_ART_SCREENSHOT_DIR ?? info.outputPath("settled-overviews");
  await mkdir(output, { recursive: true });
  const errors: string[] = [], failures: string[] = [], reads: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("requestfailed", request => failures.push(`${request.method()} ${request.url()}`));
  page.on("response", response => { if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`); });
  page.on("request", request => {
    if (request.method() === "GET" && /\/scene$|\/overview$|\/planet-atlas$|\/world\/viewport|\/chunks\//.test(new URL(request.url()).pathname)) {
      reads.push(new URL(request.url()).pathname);
    }
  });
  await page.clock.setFixedTime(new Date("2026-09-07T09:00:00Z"));
  expect((await page.request.post("/api/auth/login", { data: { email: "demo@tasktopia.local", password: "tasktopia-demo" } })).status()).toBe(200);
  await page.goto("/");
  await expect.poll(async () => await page.locator(".country-overview").isVisible()
    || await page.locator(".world-canvas").isVisible(), { timeout: 60_000 }).toBe(true);
  if (await page.locator(".country-overview").isVisible()) {
    await expect(page.locator(".country-overview")).toHaveAttribute("data-country-ready", "true");
    await page.locator(".country-overview-city").first().click();
  }
  await ready(page, fixture.taskCount);
  const canvas = await page.locator("canvas[aria-label='Интерактивная карта города']").elementHandle();
  await page.getByRole("button", { name: "Страна", exact: true }).click();
  await expect(page.locator(".country-overview")).toHaveAttribute("data-country-ready", "true");
  await page.mouse.move(15, 20); await captureMap(page, join(output, "country.png"));
  await page.getByRole("button", { name: "Планета", exact: true }).click();
  await expect(page.locator(".planet-atlas")).toHaveAttribute("data-planet-ready", "true");
  await page.mouse.move(15, 20); await captureMap(page, join(output, "planet.png"));
  await page.getByRole("button", { name: "Город", exact: true }).click();
  await ready(page, fixture.taskCount);
  expect(await canvas!.evaluate(node => node.isConnected)).toBe(true);
  await page.clock.setFixedTime(new Date("2026-09-07T18:00:00Z"));
  await expect(page.locator(".world-canvas")).toHaveAttribute("data-light-phase", "NIGHT");
  await expect(page.locator(".world-canvas")).toHaveAttribute("data-lamp-intensity", "1.000");
  await page.mouse.move(10, 60); await page.mouse.move(15, 20);
  await captureMap(page, join(output, "city-night-clock-controlled.png"));
  expect(reads.filter(path => path.endsWith("/scene"))).toHaveLength(1);
  expect(reads.filter(path => path.endsWith("/overview"))).toHaveLength(1);
  expect(reads.filter(path => path.endsWith("/planet-atlas"))).toHaveLength(1);
  expect(reads.filter(path => /\/world\/viewport|\/chunks\//.test(path))).toEqual([]);
  expect(errors).toEqual([]); expect(failures).toEqual([]);
  await writeFile(join(output, "evidence.json"), JSON.stringify({ schema: fixture.schema, assetRevision: ASSET_REVISION,
    transitionOverlays: 0, canvasRetained: true, day: "2026-09-07T09:00:00Z", night: "2026-09-07T18:00:00Z", reads, errors, failures }, null, 2));
});
