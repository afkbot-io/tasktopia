import { mkdir, readFile, writeFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { CITY_SCENE_SCHEMA_VERSION, type CitySceneDto } from "../../src/shared/city-scene-contract";
import type { CountryOverviewDto } from "../../src/shared/country-overview-contract";
import type { Cell } from "../../src/shared/contracts";
import { intercityRoadCorridors, type IntercityRoadRoute } from "../../src/shared/intercity-roads";
import { CityRoadPadding } from "../../src/client/city-road-padding";
import { isBuildableTerrain, terrainAt } from "../../src/shared/world-terrain";
import { CityTerrainPadding } from "../../src/client/city-terrain-padding";
import { atlasTerrainConnectionMask, atlasTerrainKindFromWorld, atlasTerrainTile } from "../../src/shared/atlas-scene";
import { expandCellRuns, expandRoadRuns, expandSurfaceRuns } from "../../src/shared/world-cell-runs";
import { generateWorldDecorations } from "../../src/shared/world-decorations";
import { CityTreePadding } from "../../src/client/city-tree-padding";
import { compactTreeCover } from "../../src/shared/compact-tree-placement";

test.skip(process.env.E2E_INTERCITY_ROADS_FIXTURE !== "true", "Read-only isolated intercity preview required");
test.use({ viewport: { width: 1600, height: 1100 }, actionTimeout: 10_000 });
type Fixture = { schema: string; seed: number; countryId: string; cities: Array<{ id: string; name: string }>;
  routes: IntercityRoadRoute[]; unreachable: unknown[];
  exits: Array<{ cityId: string; chunkX: number; chunkY: number; roadCells: number; surfaceCells: number }> };
const host = (page: Page) => page.locator(".world-canvas");
async function ready(page: Page) {
  await expect(host(page)).toBeVisible();
  await expect(host(page)).toHaveAttribute("data-city-scene-commit", "atomic");
  await expect(host(page)).toHaveAttribute("data-ground-bake-queue", "0");
  await expect(host(page)).toHaveAttribute("data-camera-padding-road-pending", "0");
  await expect(host(page)).toHaveAttribute("data-camera-padding-terrain-pending", "0");
  await expect(host(page)).toHaveAttribute("data-camera-padding-visible-untextured", "0");
  await expect(host(page)).toHaveAttribute("data-camera-padding-material", "terrain-v4-city-atlas");
  await expect(host(page)).toHaveAttribute("data-camera-padding-tree-pending", "0");
  await expect(host(page)).not.toHaveAttribute("data-load-error", "true");
  await expect(page.locator(".map-level-transition")).toHaveCount(0);
}

/** Compare unobstructed exterior and resident pixels with their exact native
 * family/mask/variant, not a color approximation or whole-family palette. */
async function paddingTerrainPixels(page: Page, scene: CitySceneDto, fixture: Fixture) {
  const terrain = new CityTerrainPadding(fixture.seed, scene.chunkSize, []);
  const residents = new Map(scene.chunks.map(chunk => [`${chunk.chunkX},${chunk.chunkY}`, chunk]));
  const roads = new CityRoadPadding(scene, cell => isBuildableTerrain(terrainAt(fixture.seed, cell.x, cell.y).terrain));
  const trees = new CityTreePadding(scene, fixture.seed, terrain, roads);
  const view = await camera(page);
  const canvas = page.locator("canvas[aria-label='Интерактивная карта города']");
  const bounds = (await canvas.boundingBox())!;
  const canvasSize = await canvas.evaluate(node => ({ width: (node as HTMLCanvasElement).width, height: (node as HTMLCanvasElement).height,
    css: { width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height }, dpr: devicePixelRatio }));
  const radiusX = bounds.width / (16 * view.scale), radiusY = bounds.height / (16 * view.scale);
  const candidates: Array<{ x: number; y: number; family: string; url: string; sourceX: number; sourceY: number; chunk: string; boundary: boolean; scope: "resident" | "padding" }> = [];
  const counts = new Map<string, number>();
  for (let cy = Math.floor((view.y - radiusY) / scene.chunkSize); cy <= Math.floor((view.y + radiusY) / scene.chunkSize); cy++) {
    for (let cx = Math.floor((view.x - radiusX) / scene.chunkSize); cx <= Math.floor((view.x + radiusX) / scene.chunkSize); cx++) {
      const material = terrain.get(cx, cy); if (!material) continue;
      const resident = residents.get(`${cx},${cy}`);
      const overlays = roads.get(cx, cy);
      const blocked = new Set([...(overlays?.roads ?? []), ...(overlays?.surfaces ?? [])].map(cell => `${cell.x},${cell.y}`));
      // Crowns originating in adjacent exterior chunks can legitimately cross
      // this seam; exclude them without changing the ground pixel oracle.
      for (let ty = cy - 1; ty <= cy + 1; ty++) for (let tx = cx - 1; tx <= cx + 1; tx++) {
        for (const tree of trees.get(tx, ty)) for (const cell of compactTreeCover(tree.origin)) blocked.add(`${cell.x},${cell.y}`);
      }
      if (resident) {
        const roadCells = expandRoadRuns(resident.roadRuns), surfaces = expandSurfaceRuns(resident.surfaceRuns);
        const addMargin = (cell: Cell, radius: number) => {
          for (let y = cell.y - radius; y <= cell.y + radius; y++) for (let x = cell.x - radius; x <= cell.x + radius; x++) blocked.add(`${x},${y}`);
        };
        for (const cell of [...roadCells, ...surfaces, ...expandCellRuns(resident.decorationContext.blockedCellRuns)]) blocked.add(`${cell.x},${cell.y}`);
        for (const cell of [...resident.tasks.flatMap(task => task.footprint), ...resident.worldFeatures.flatMap(feature => feature.footprint)]) addMargin(cell, 6);
        for (const site of resident.plannedSites ?? []) for (let y = site.origin.y; y < site.origin.y + site.height; y++) {
          for (let x = site.origin.x; x < site.origin.x + site.width; x++) addMargin({ x, y }, 1);
        }
        const decorationTerrain = [...material.chunk.terrain];
        for (let y = cy * scene.chunkSize - 4; y < (cy + 1) * scene.chunkSize + 4; y++) {
          for (let x = cx * scene.chunkSize - 4; x < (cx + 1) * scene.chunkSize + 4; x++) {
            if (x < cx * scene.chunkSize || x >= (cx + 1) * scene.chunkSize || y < cy * scene.chunkSize || y >= (cy + 1) * scene.chunkSize) {
              decorationTerrain.push({ x, y, ...terrainAt(fixture.seed, x, y) });
            }
          }
        }
        for (const decoration of generateWorldDecorations(fixture.seed, material.chunk.terrain, blocked,
          [...surfaces, ...expandSurfaceRuns(resident.decorationContext.surfaceHaloRuns)],
          resident.decorationContext.districts.map(({ cellRuns, ...district }) => ({ ...district, cells: expandCellRuns(cellRuns) })),
          resident.decorationContext.cityBounds, resident.decorationContext.tasks, decorationTerrain,
          cell => terrainAt(fixture.seed, cell.x, cell.y).terrain)) addMargin(decoration.origin, 6);
      }
      for (const cell of material.chunk.terrain) {
        if (blocked.has(`${cell.x},${cell.y}`)) continue;
        const sx = bounds.width / 2 + (cell.x - view.x) * 8 * view.scale;
        const sy = bounds.height / 2 + (cell.y - view.y) * 8 * view.scale;
        if (sx < 30 || sy < 30 || sx > bounds.width - 40 || sy > bounds.height - 110) continue;
        const family = atlasTerrainKindFromWorld(cell.terrain);
        // Dense tree canopies occlude the resident forest ground by design.
        if (resident && family === "forest") continue;
        const group = `${cx},${cy}:${family}`;
        const boundary = cell.x % scene.chunkSize === 0 || cell.y % scene.chunkSize === 0
          || (cell.x + 1) % scene.chunkSize === 0 || (cell.y + 1) % scene.chunkSize === 0;
        // Every exterior chunk/family contributes, including its exact edges.
        if (!boundary && (counts.get(group) ?? 0) >= 8) continue;
        const tile = atlasTerrainTile(family, "city", cell.x, cell.y,
          atlasTerrainConnectionMask(family, cell.x, cell.y, material.kindAt));
        candidates.push({ x: cell.x, y: cell.y, family, url: tile.url, sourceX: tile.sourceX, sourceY: tile.sourceY, chunk: `${cx},${cy}`, boundary, scope: resident ? "resident" : "padding" });
        counts.set(group, (counts.get(group) ?? 0) + 1);
      }
    }
  }
  expect(candidates.length).toBeGreaterThan(50);
  const manifest = JSON.parse(await readFile("assets/pixel-city-pack/manifest.json", "utf8")) as { assetRevision: string };
  const textures: Record<string, string> = {};
  for (const url of new Set(candidates.map(cell => cell.url))) {
    const response = await page.request.get(`/game-assets/v5/revisions/${manifest.assetRevision}/${url}`);
    expect(response.status()).toBe(200); textures[url] = (await response.body()).toString("base64");
  }
  const result = await page.evaluate(async ({ screenshot, textures, candidates, view }) => {
    const decode = async (encoded: string) => {
      const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(encoded), character => character.charCodeAt(0))], { type: "image/png" }));
      const context = new OffscreenCanvas(bitmap.width, bitmap.height).getContext("2d")!;
      context.drawImage(bitmap, 0, 0); const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height);
      bitmap.close(); return pixels;
    };
    const image = await decode(screenshot), sheets = new Map<string, ImageData>();
    for (const [url, encoded] of Object.entries(textures)) sheets.set(url, await decode(encoded));
    const samples = candidates.map(cell => {
      const sheet = sheets.get(cell.url)!;
      const left = image.width / 2 + (cell.x - view.x) * 8 * view.scale;
      const top = image.height / 2 + (cell.y - view.y) * 8 * view.scale;
      let matching = 0, sampled = 0;
      for (let y = Math.ceil(top + view.scale); y < top + 7 * view.scale; y++) {
        for (let x = Math.ceil(left + view.scale); x < left + 7 * view.scale; x++) {
          const sx = Math.min(7, Math.max(0, Math.floor((x + .5 - left) / view.scale)));
          const sy = Math.min(7, Math.max(0, Math.floor((y + .5 - top) / view.scale)));
          const expected = ((cell.sourceY + sy) * sheet.width + cell.sourceX + sx) * 4;
          const actual = (y * image.width + x) * 4;
          sampled++;
          if ([0, 1, 2].every(channel => Math.abs(image.data[actual + channel]! - sheet.data[expected + channel]!) <= 6)) matching++;
        }
      }
      return { family: cell.family, chunk: cell.chunk, scope: cell.scope, x: cell.x, y: cell.y, boundary: cell.boundary, matching, sampled };
    });
    const families = Object.fromEntries([...new Set(samples.map(sample => sample.family))].map(family => {
      const group = samples.filter(sample => sample.family === family);
      return [family, { cells: group.length, matching: group.reduce((n, cell) => n + cell.matching, 0), sampled: group.reduce((n, cell) => n + cell.sampled, 0) }];
    }));
    const scopes = Object.fromEntries(["resident", "padding"].map(scope => {
      const group = samples.filter(cell => cell.scope === scope);
      return [scope, { cells: group.length, matching: group.reduce((n, cell) => n + cell.matching, 0), sampled: group.reduce((n, cell) => n + cell.sampled, 0) }];
    }));
    return { families, scopes, imageSize: { width: image.width, height: image.height }, chunks: [...new Set(samples.map(sample => sample.chunk))], boundaryCells: samples.filter(sample => sample.boundary).length,
      matching: samples.reduce((n, cell) => n + cell.matching, 0), sampled: samples.reduce((n, cell) => n + cell.sampled, 0),
      failures: samples.filter(sample => sample.matching / sample.sampled < .85).slice(0, 20) };
  }, { screenshot: (await canvas.screenshot()).toString("base64"), textures, candidates, view });
  const diagnostics = JSON.stringify({ ...result, canvasSize, bounds, view });
  expect(result.chunks.length).toBeGreaterThanOrEqual(3);
  expect(result.boundaryCells).toBeGreaterThanOrEqual(12);
  for (const scope of ["resident", "padding"]) {
    expect(result.scopes[scope]!.cells, diagnostics).toBeGreaterThanOrEqual(20);
    expect(result.scopes[scope]!.matching / result.scopes[scope]!.sampled, diagnostics).toBeGreaterThan(.9);
  }
  for (const family of ["grass", "forest", "mountain"]) {
    expect(result.families[family]?.cells, diagnostics).toBeGreaterThanOrEqual(4);
    const values = result.families[family]!;
    expect(values.matching / values.sampled, diagnostics).toBeGreaterThan(.9);
  }
  expect(result.matching / result.sampled, JSON.stringify(result)).toBeGreaterThan(.9);
  return result;
}
const camera = (page: Page) => host(page).evaluate(node => ({ x: Number(node.getAttribute("data-camera-world-x")),
  y: Number(node.getAttribute("data-camera-world-y")), scale: Number(node.getAttribute("data-render-scale")), session: node.getAttribute("data-agent-session") }));
async function panTo(page: Page, target: Cell) {
  const box = (await page.locator("canvas[aria-label='Интерактивная карта города']").boundingBox())!;
  for (let n = 0; n < 12; n++) {
    const before = await camera(page);
    const dx = (before.x - target.x) * before.scale * 8, dy = (before.y - target.y) * before.scale * 8;
    if (Math.abs(dx) < 2 && Math.abs(dy) < 2) break;
    const fraction = Math.min(1, box.width * .4 / Math.max(1, Math.abs(dx)), box.height * .4 / Math.max(1, Math.abs(dy)));
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + dx * fraction, box.y + box.height / 2 + dy * fraction, { steps: 4 }); await page.mouse.up();
    if (JSON.stringify(await camera(page)) === JSON.stringify(before)) break; // Respect the public camera clamp.
  }
  await ready(page);
}

/** Independent pixel evidence: a real road outside every resident chunk must
 * contain opaque colors from the same published LOCAL asphalt atlas. Geometry
 * counters alone would not detect a transparent/blank overlay texture. */
async function paddingPixels(page: Page, scene: CitySceneDto, fixture: Fixture, exit: Fixture["exits"][number]) {
  const padding = new CityRoadPadding(scene, cell => isBuildableTerrain(terrainAt(fixture.seed, cell.x, cell.y).terrain));
  const chunk = padding.get(exit.chunkX, exit.chunkY)!;
  expect(chunk.roads.length).toBeGreaterThanOrEqual(24);
  const crosswalks = new Set(chunk.surfaces.filter(cell => cell.kind === "CROSSWALK").map(cell => `${cell.x},${cell.y}`));
  const points = chunk.roads.filter(cell => cell.mask === 15 && !crosswalks.has(`${cell.x},${cell.y}`));
  const view = await camera(page);
  const png = await page.locator("canvas[aria-label='Интерактивная карта города']").screenshot();
  const manifest = JSON.parse(await readFile("assets/pixel-city-pack/manifest.json", "utf8")) as { assetRevision: string };
  const atlas = await page.request.get(`/game-assets/v5/revisions/${manifest.assetRevision}/atlas/road-v2/road.png`);
  expect(atlas.status()).toBe(200);
  const result = await page.evaluate(async ({ screenshot, texture, points, view }) => {
    const decode = async (encoded: string) => {
      const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(encoded), character => character.charCodeAt(0))], { type: "image/png" }));
      const context = new OffscreenCanvas(bitmap.width, bitmap.height).getContext("2d")!;
      context.drawImage(bitmap, 0, 0); const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height);
      bitmap.close(); return pixels;
    };
    const image = await decode(screenshot), atlas = await decode(texture);
    const palette: number[][] = [];
    // LOCAL occupies the first three rows of 8px variants in the actual atlas.
    for (let i = 0; i < atlas.width * 24 * 4; i += 4) if (atlas.data[i + 3] === 255) palette.push(Array.from(atlas.data.slice(i, i + 3)));
    const samples = points.flatMap(point => {
      const x = Math.floor(image.width / 2 + (point.x + .3125 - view.x) * 8 * view.scale);
      const y = Math.floor(image.height / 2 + (point.y + .3125 - view.y) * 8 * view.scale);
      if (x < 8 || y < 8 || x >= image.width - 8 || y >= image.height - 8) return [];
      const offset = (y * image.width + x) * 4, rgb = Array.from(image.data.slice(offset, offset + 3));
      // A 3px line overlay may cover the exact sample centre. Inspect the
      // surrounding 3×3 screenshot pixels, still inside this asphalt tile.
      let match = false;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        const candidate = ((y + oy) * image.width + x + ox) * 4;
        if (palette.some(color => color.every((channel, i) => Math.abs(channel - image.data[candidate + i]!) <= 6))) match = true;
      }
      return [{ cell: point, rgb, match }];
    });
    return { sampled: samples.length, matching: samples.filter(sample => sample.match).length, samples };
  }, { screenshot: png.toString("base64"), texture: (await atlas.body()).toString("base64"), points, view });
  expect(result.sampled).toBeGreaterThanOrEqual(12);
  expect(result.matching / result.sampled, JSON.stringify(result)).toBeGreaterThan(.85);
  return result;
}

test("canonical dry roads continue beyond city chunks and render on the country map without foreign reads", async ({ page }, info) => {
  const trafficSeconds = Number(process.env.INTERCITY_TRAFFIC_SECONDS ?? 0);
  if (![0, 60, 300].includes(trafficSeconds)) throw new Error("INTERCITY_TRAFFIC_SECONDS must be 0, 60 or 300");
  test.setTimeout(trafficSeconds * 1_000 + 150_000);
  // Explicit diagnostic only: forced GC measures retained JS heap, not GPU
  // memory, and must never run inside the uninterrupted traffic sample window.
  const memorySession = process.env.INTERCITY_MEMORY === "true" ? await page.context().newCDPSession(page) : undefined;
  const memory: Array<{ phase: string; usedBytes: number; totalBytes: number; nodes: number; listeners: number; trees: number; chunks: number }> = [];
  const sampleMemory = async (phase: string) => {
    if (!memorySession) return;
    await memorySession.send("HeapProfiler.collectGarbage");
    const heap = await memorySession.send("Runtime.getHeapUsage");
    const dom = await memorySession.send("Memory.getDOMCounters");
    const counts = await page.locator(".world-canvas").evaluateAll(nodes => ({
      trees: nodes.reduce((sum, node) => sum + Number((node as HTMLElement).dataset.cameraPaddingTrees ?? 0), 0),
      chunks: nodes.reduce((sum, node) => sum + Number((node as HTMLElement).dataset.cameraPaddingChunks ?? 0), 0),
    }));
    memory.push({ phase, usedBytes: heap.usedSize, totalBytes: heap.totalSize, nodes: dom.nodes,
      listeners: dom.jsEventListeners, ...counts });
  };
  const fixture = JSON.parse(await readFile(process.env.INTERCITY_FIXTURE_JSON ?? "tmp/intercity-road-preview-final-20260907.json", "utf8")) as Fixture;
  expect(fixture.schema).toMatch(/^intercity_road_preview_[a-f0-9]{32}$/);
  const directory = process.env.INTERCITY_SCREENSHOTS ?? "screenshots/intercity-roads-final";
  await mkdir(directory, { recursive: true });
  await page.clock.setFixedTime(new Date("2026-09-07T09:00:00Z"));
  const errors: string[] = [], warnings: string[] = [], reads: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); if (message.type() === "warning") warnings.push(message.text()); });
  page.on("response", response => { if (response.status() >= 400) errors.push(`${response.status()} ${new URL(response.url()).pathname}`); });
  page.on("requestfailed", request => errors.push(`${new URL(request.url()).pathname}: ${request.failure()?.errorText}`));
  page.on("request", request => { const path = new URL(request.url()).pathname;
    if (request.method() === "GET" && /\/scene$|\/overview$|\/planet-atlas$|\/world\/viewport|\/chunks\//.test(path)) reads.push(path); });
  expect((await page.request.post("/api/auth/login", { data: { email: "demo@tasktopia.local", password: "tasktopia-demo" } })).status()).toBe(200);
  const overviewLoaded = page.waitForResponse(response => new URL(response.url()).pathname.endsWith("/overview"));
  await page.goto("/");
  const overview = await (await overviewLoaded).json() as CountryOverviewDto;
  const country = page.locator(".country-overview");
  await expect(country).toHaveAttribute("data-country-ready", "true");
  await expect(page.locator(".map-level-transition")).toHaveCount(0);
  await sampleMemory("country-before-city");
  expect(overview.countryId).toBe(fixture.countryId);
  expect(overview.groundRoads.routes.length).toBeGreaterThan(0);
  expect(overview.groundRoads.routes.every(route => fixture.routes.some(canonical => canonical.id === route.id))).toBe(true);
  for (const route of fixture.routes) expect(overview.groundRoads.routes.some(item => item.id === route.id)
    || overview.groundRoads.unavailable.some(item => item.routeId === route.id && Boolean(item.reason))).toBe(true);
  await expect(country).toHaveAttribute("data-country-ground-roads", String(overview.groundRoads.routes.length));
  await expect(country).toHaveAttribute("data-country-ground-road-unavailable", String(overview.groundRoads.unavailable.length));
  await expect(country).toHaveAttribute("data-country-ground-road-rejected", "0");
  await expect(country).toHaveAttribute("data-country-ground-road-asphalt-pixels", "3");
  await expect(country).toHaveAttribute("data-country-ground-road-pavement-pixels", "5");
  await expect(country).toHaveAttribute("data-country-ground-road-atlas-urls", "2");
  const countryMetrics = await country.evaluate(node => ({ ...((node as HTMLElement).dataset) }));
  await page.screenshot({ path: `${directory}/country.png` });

  const scenes = new Map<string, CitySceneDto>();
  for (const city of fixture.cities) {
    const response = await page.request.get(`/api/countries/${fixture.countryId}/cities/${city.id}/scene`, {
      headers: { accept: `application/vnd.tasktopia.city-scene+json; version=${CITY_SCENE_SCHEMA_VERSION}` },
    });
    expect(response.status()).toBe(200); const scene = await response.json() as CitySceneDto;
    expect(scene.schemaVersion).toBe(CITY_SCENE_SCHEMA_VERSION);
    const resident = {
      minX: Math.min(...scene.chunks.map(chunk => chunk.chunkX)) * scene.chunkSize,
      minY: Math.min(...scene.chunks.map(chunk => chunk.chunkY)) * scene.chunkSize,
      maxX: (Math.max(...scene.chunks.map(chunk => chunk.chunkX)) + 1) * scene.chunkSize - 1,
      maxY: (Math.max(...scene.chunks.map(chunk => chunk.chunkY)) + 1) * scene.chunkSize - 1,
    };
    expect(scene.intercityRoads).toEqual(fixture.routes.filter(route => route.fromCityId === city.id || route.toCityId === city.id
      || intercityRoadCorridors([route], 0).some(road => road.minX <= resident.maxX && road.maxX >= resident.minX
        && road.minY <= resident.maxY && road.maxY >= resident.minY)));
    scenes.set(city.id, scene);
  }
  await page.getByRole("button", { name: /^Открыть город Город Альфа,/ }).click(); await ready(page);
  await page.screenshot({ path: `${directory}/city.png` });
  await page.getByRole("button", { name: "Страна", exact: true }).click();
  await expect(country).toHaveAttribute("data-country-ready", "true");
  const exit = [...fixture.exits].sort((a, b) => b.roadCells - a.roadCells)[0]!;
  expect(exit.roadCells).toBeGreaterThanOrEqual(24);
  const selectedCity = fixture.cities.find(city => city.id === exit.cityId)!;
  await page.getByRole("button", { name: new RegExp(`^Открыть город ${selectedCity.name},`) }).click(); await ready(page);
  const scene = scenes.get(exit.cityId)!;
  const canvas = await page.locator("canvas[aria-label='Интерактивная карта города']").elementHandle();
  const selectedReads = [...reads];
  await page.evaluate(() => {
    const state = { frames: 0, untexturedFrames: 0, maxMissing: 0, longestMissMs: 0, openMissAt: 0, phase: "resize",
      phases: {} as Record<string, { frames: number; missingFrames: number; maxMissing: number }> };
    (window as typeof window & { paddingProbe?: typeof state }).paddingProbe = state;
    const sample = (now: number) => {
      const node = document.querySelector<HTMLElement>(".world-canvas");
      if (node && node.offsetWidth && getComputedStyle(node.parentElement!).visibility !== "hidden") {
        const missing = Number(node.dataset.cameraPaddingVisibleUntextured ?? 0);
        const phase = state.phases[state.phase] ??= { frames: 0, missingFrames: 0, maxMissing: 0 };
        state.frames++; phase.frames++;
        if (missing) { state.untexturedFrames++; phase.missingFrames++; state.openMissAt ||= now; }
        else if (state.openMissAt) { state.longestMissMs = Math.max(state.longestMissMs, now - state.openMissAt); state.openMissAt = 0; }
        state.maxMissing = Math.max(state.maxMissing, missing); phase.maxMissing = Math.max(phase.maxMissing, missing);
      }
      if (state.frames < 15_000) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  const paddingMetrics: Array<{ phase: string; values: Record<string, string | undefined> }> = [];
  const samplePadding = async (phase: string) => {
    paddingMetrics.push({ phase, values: await host(page).evaluate(node => Object.fromEntries(Object.entries((node as HTMLElement).dataset)
      .filter(([key]) => key.startsWith("cameraPadding") || key.startsWith("groundBake")))) });
    await page.evaluate(phase => { const probe = (window as typeof window & { paddingProbe?: { phase: string } }).paddingProbe; if (probe) probe.phase = phase; }, phase);
  };
  // The city camera correctly stays on its own territory. A taller review
  // frame exposes the actual distant bend without loosening that clamp.
  await page.setViewportSize({ width: 1600, height: 1500 });
  await ready(page);
  await page.locator("canvas[aria-label='Интерактивная карта города']").hover();
  if ((await camera(page)).scale > .8) { await page.mouse.wheel(0, 900); await expect.poll(async () => (await camera(page)).scale).toBeCloseTo(.8, 4); }
  await panTo(page, { x: exit.chunkX * 64 + 32, y: exit.chunkY * 64 + 32 });
  await expect.poll(async () => Number(await host(page).getAttribute("data-camera-padding-road-cells"))).toBeGreaterThanOrEqual(24);
  await expect.poll(async () => Number(await host(page).getAttribute("data-camera-padding-surface-cells"))).toBeGreaterThan(0);
  const material = await paddingPixels(page, scene, fixture, exit);
  const terrainMaterial = await paddingTerrainPixels(page, scene, fixture);
  const treeSample = JSON.parse((await host(page).getAttribute("data-camera-padding-tree-sample"))!) as Array<{ id: string; kind: string; origin: Cell }>;
  const treeGround = new CityTerrainPadding(fixture.seed, scene.chunkSize, scene.chunks);
  const treeRoads = new CityRoadPadding(scene, cell => isBuildableTerrain(terrainAt(fixture.seed, cell.x, cell.y).terrain));
  const treeReference = new CityTreePadding(scene, fixture.seed, treeGround, treeRoads);
  expect(treeSample).toHaveLength(16);
  expect(new Set(treeSample.map(tree => tree.id)).size).toBe(treeSample.length);
  for (const tree of treeSample) {
    const x = Math.floor(tree.origin.x / scene.chunkSize), y = Math.floor(tree.origin.y / scene.chunkSize);
    expect(scene.chunks.some(chunk => chunk.chunkX === x && chunk.chunkY === y)).toBe(false);
    expect(treeReference.get(x, y).find(candidate => candidate.id === tree.id)).toEqual(tree);
  }
  const initialTrees = Number(await host(page).getAttribute("data-camera-padding-trees"));
  expect(initialTrees).toBeGreaterThan(100);
  await sampleMemory("full-padding");
  await expect(host(page)).toHaveAttribute("data-world-object-depth-errors", "0");
  await samplePadding("zoom-and-pan");
  await page.mouse.move(10, 20); await page.screenshot({ path: `${directory}/exit.png` });
  const exitCamera = await camera(page);
  await page.locator("canvas[aria-label='Интерактивная карта города']").hover();
  await page.mouse.wheel(0, -Math.log(1 / .8) / .0015);
  await expect.poll(async () => (await camera(page)).scale).toBeCloseTo(1, 4); await ready(page);
  const nativeTerrainMaterial = await paddingTerrainPixels(page, scene, fixture);
  await page.mouse.move(10, 20); await page.screenshot({ path: `${directory}/native-terrain.png` });
  await page.locator("canvas[aria-label='Интерактивная карта города']").hover();
  // Leave a small margin above the explicit CITY→COUNTRY wheel threshold.
  // The initial 0.8 frame is still verified; do not bypass normal navigation.
  const returnScale = .81;
  await page.mouse.wheel(0, Math.log(1 / returnScale) / .0015);
  await expect.poll(async () => (await camera(page)).scale).toBeCloseTo(returnScale, 4); await ready(page);
  const fullPaddingCells = Number(await host(page).getAttribute("data-camera-padding-road-cells"));
  const fullPaddingChunks = Number(await host(page).getAttribute("data-camera-padding-chunks"));
  await page.locator("canvas[aria-label='Интерактивная карта города']").hover();
  await page.mouse.wheel(0, -700); await expect.poll(async () => (await camera(page)).scale).toBeCloseTo(returnScale * Math.exp(1.05), 4);
  await panTo(page, { x: scene.city.center.x + 20, y: scene.city.center.y });
  const pannedCamera = await camera(page);
  expect(pannedCamera.x).toBeGreaterThan(scene.city.center.x + 10);
  const prunedPaddingCells = Number(await host(page).getAttribute("data-camera-padding-road-cells"));
  const prunedPaddingChunks = Number(await host(page).getAttribute("data-camera-padding-chunks"));
  const prunedTrees = Number(await host(page).getAttribute("data-camera-padding-trees"));
  // The one-chunk prewarm ring may still contain the whole road; assert that
  // unused material chunks are actually evicted, not an arbitrary road count.
  expect(prunedPaddingChunks).toBeLessThan(fullPaddingChunks);
  expect(prunedTrees).toBeLessThan(initialTrees);
  await sampleMemory("pruned-padding");
  await samplePadding("large-zoom-out");
  await panTo(page, { x: scene.city.center.x, y: scene.city.center.y });
  await page.locator("canvas[aria-label='Интерактивная карта города']").hover();
  await page.mouse.wheel(0, 700); await expect.poll(async () => (await camera(page)).scale).toBeCloseTo(returnScale, 4); await ready(page);
  expect((await camera(page)).session).toBe(exitCamera.session);
  expect(reads).toEqual(selectedReads);
  const returnMaterial = await paddingPixels(page, scene, fixture, exit);
  const returnTerrainMaterial = await paddingTerrainPixels(page, scene, fixture);
  let returnCamera = await camera(page);
  const returnedTrees = Number(await host(page).getAttribute("data-camera-padding-trees"));
  expect(returnedTrees).toBe(initialTrees);
  await sampleMemory("restored-padding");
  if (memorySession && process.env.INTERCITY_MEMORY_PROFILE === "true") await memorySession.send("HeapProfiler.startSampling", { samplingInterval: 16_384 });
  if (memorySession) for (let cycle = 1; cycle <= 3; cycle++) {
    await page.locator("canvas[aria-label='Интерактивная карта города']").hover();
    await page.mouse.wheel(0, -700);
    await expect.poll(async () => (await camera(page)).scale).toBeCloseTo(returnScale * Math.exp(1.05), 4);
    await panTo(page, { x: scene.city.center.x + 20, y: scene.city.center.y });
    expect(Number(await host(page).getAttribute("data-camera-padding-trees"))).toBe(prunedTrees);
    await sampleMemory(`cycle-${cycle}-pruned`);
    await panTo(page, scene.city.center);
    await page.locator("canvas[aria-label='Интерактивная карта города']").hover();
    await page.mouse.wheel(0, 700);
    await expect.poll(async () => (await camera(page)).scale).toBeCloseTo(returnScale, 4); await ready(page);
    expect(Number(await host(page).getAttribute("data-camera-padding-trees"))).toBe(initialTrees);
    expect(Number(await host(page).getAttribute("data-camera-padding-native-cells"))).toBe(0);
    await sampleMemory(`cycle-${cycle}-restored`);
  }
  if (memorySession) returnCamera = await camera(page);
  await samplePadding("warm-return");
  const traffic: unknown[] = [];
  if (trafficSeconds) {
    let previousCars = -1, previousWalkers = -1;
    for (let sample = 0; sample <= trafficSeconds / 10; sample++) {
      if (sample) await page.waitForTimeout(10_000);
      const state = await host(page).evaluate(node => ({ cars: Number(node.getAttribute("data-traffic-lifetime-steps")),
        walkers: Number(node.getAttribute("data-walker-lifetime-steps")), vehicleUnsafe: Number(node.getAttribute("data-mobility-vehicle-unsafe-total")),
        pedestrianUnsafe: Number(node.getAttribute("data-mobility-pedestrian-unsafe-total")), mixedUnsafe: Number(node.getAttribute("data-mobility-vehicle-pedestrian-unsafe-total")) }));
      expect(state.cars).toBeGreaterThan(previousCars); expect(state.walkers).toBeGreaterThan(previousWalkers);
      expect([state.vehicleUnsafe, state.pedestrianUnsafe, state.mixedUnsafe]).toEqual([0, 0, 0]);
      previousCars = state.cars; previousWalkers = state.walkers; traffic.push(state);
    }
  }
  await page.getByRole("button", { name: "Планета", exact: true }).click();
  await expect(page.locator(".planet-atlas")).toHaveAttribute("data-planet-ready", "true");
  await expect(page.locator(".map-level-transition")).toHaveCount(0);
  await page.screenshot({ path: `${directory}/planet.png` });
  const warmStarted = performance.now();
  await page.getByRole("button", { name: "Город", exact: true }).click(); await ready(page);
  const warmReturnMs = performance.now() - warmStarted;
  expect(warmReturnMs).toBeLessThan(1_000);
  expect(await camera(page)).toEqual(returnCamera);
  expect(await canvas!.evaluate(node => node === document.querySelector("canvas[aria-label='Интерактивная карта города']"))).toBe(true);
  expect(reads.filter(path => path.endsWith("/scene"))).toEqual(selectedReads.filter(path => path.endsWith("/scene")));
  expect(new Set(reads.filter(path => path.endsWith("/scene"))).size).toBe(reads.filter(path => path.endsWith("/scene")).length);
  for (const suffix of ["/overview", "/planet-atlas"]) expect(reads.filter(path => path.endsWith(suffix))).toHaveLength(1);
  expect(reads.filter(path => /\/world\/viewport|\/chunks\//.test(path))).toEqual([]);
  expect(errors).toEqual([]);
  await samplePadding("complete");
  const paddingProbe = await page.evaluate(() => (window as typeof window & { paddingProbe: { untexturedFrames: number } }).paddingProbe);
  expect(paddingProbe.untexturedFrames).toBe(0);
  await sampleMemory("after-traffic-and-warm-return");
  if (memorySession && process.env.INTERCITY_MEMORY_PROFILE === "true") {
    const profile = await memorySession.send("HeapProfiler.stopSampling");
    await writeFile("tmp/padding-retained-allocations.json", JSON.stringify(profile));
  }
  if (memorySession) {
    await info.attach("padding-memory-before-teardown", { body: JSON.stringify(memory), contentType: "application/json" });
    const releasedHost = await host(page).elementHandle();
    await canvas!.dispose();
    await page.getByRole("button", { name: /^Настройки аккаунта/ }).click();
    await page.getByRole("button", { name: "Выйти из аккаунта", exact: true }).click();
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(host(page)).toHaveCount(0);
    await expect.poll(() => releasedHost!.evaluate(node => (node as HTMLElement).dataset.assetLease)).toBe("released");
    expect(await releasedHost!.evaluate(node => Number((node as HTMLElement).dataset.leasedAssets))).toBe(0);
    await releasedHost!.dispose();
    await sampleMemory("logout-teardown");
    expect(memory.at(-1)).toMatchObject({ trees: 0, chunks: 0 });
    await memorySession.detach();
    expect(errors).toEqual([]);
  }
  await info.attach("intercity-roads", { body: JSON.stringify({ countryId: fixture.countryId, fixtureSchema: fixture.schema,
    sceneRevision: scene.sceneRevision, routes: fixture.routes, unavailable: overview.groundRoads.unavailable, countryMetrics,
    selectedCity, exit, exitCamera, returnCamera, pannedCamera, fullPaddingCells, prunedPaddingCells, fullPaddingChunks, prunedPaddingChunks, material, returnMaterial,
    terrainMaterial, nativeTerrainMaterial, returnTerrainMaterial, treeSample, initialTrees, prunedTrees, returnedTrees,
    paddingMetrics, paddingProbe, warmReturnMs, traffic, memory, reads, errors, warnings }), contentType: "application/json" });
  if (memorySession) {
    const restored = memory.filter(sample => /^cycle-\d+-restored$/.test(sample.phase));
    expect(restored).toHaveLength(3);
    // Identical cache contents must plateau after warmup. Four MiB allows
    // instrumentation bookkeeping, not the reproduced17 MiB per cycle.
    expect(Math.max(...restored.map(sample => sample.usedBytes)) - Math.min(...restored.map(sample => sample.usedBytes))).toBeLessThan(4 * 1024 * 1024);
  }
});
