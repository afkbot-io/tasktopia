import { mkdir, writeFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import type { CitySceneDto } from "../../src/shared/city-scene-contract";
import type { BootstrapDto, Cell } from "../../src/shared/contracts";
import { cameraTerrainPadding } from "../../src/client/camera-terrain-padding";
import { atlasTerrainConnectionMask, atlasTerrainKindFromWorld, atlasTerrainTile } from "../../src/shared/atlas-scene";
import { terrainAt } from "../../src/shared/world-terrain";

test.skip(process.env.E2E_LARGE_PADDING !== "true", "Read-only release_perf_20260907_b fixture required");
test.use({ viewport: { width: 1600, height: 1100 } });
const host = (page: Page) => page.locator(".world-canvas");
const camera = (page: Page) => host(page).evaluate(node => ({ x: Number(node.getAttribute("data-camera-world-x")),
  y: Number(node.getAttribute("data-camera-world-y")), scale: Number(node.getAttribute("data-render-scale")) }));
async function ready(page: Page) {
  await expect(host(page)).toHaveAttribute("data-city-scene-commit", "atomic", { timeout: 60_000 });
  for (const name of ["data-ground-bake-queue", "data-camera-padding-terrain-pending", "data-camera-padding-visible-untextured", "data-camera-padding-tree-pending"]) {
    await expect(host(page)).toHaveAttribute(name, "0", { timeout: 30_000 });
  }
  await expect(host(page)).not.toHaveAttribute("data-load-error", "true");
  await expect(page.locator(".map-level-transition")).toHaveCount(0);
}
async function panTo(page: Page, target: Cell) {
  const box = (await page.locator("canvas[aria-label='Интерактивная карта города']").boundingBox())!;
  for (let n = 0; n < 15; n++) {
    const view = await camera(page), dx = (view.x - target.x) * 8 * view.scale, dy = (view.y - target.y) * 8 * view.scale;
    if (Math.abs(dx) + Math.abs(dy) < 2) break;
    const fraction = Math.min(1, box.width * .4 / Math.max(1, Math.abs(dx)), box.height * .4 / Math.max(1, Math.abs(dy)));
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + dx * fraction, box.y + box.height / 2 + dy * fraction, { steps: 4 }); await page.mouse.up();
    if (JSON.stringify(await camera(page)) === JSON.stringify(view)) break;
  }
  await ready(page);
}

test("20 sprint city: bounded exterior materials during a real >64-cell jump and full-territory review", async ({ page }, info) => {
  test.setTimeout(120_000);
  const directory = "screenshots/city-padding-large-final";
  await mkdir(directory, { recursive: true });
  const memorySession = process.env.E2E_LARGE_PADDING_MEMORY === "true" ? await page.context().newCDPSession(page) : undefined;
  const memory: Array<{ phase: string; usedBytes: number; totalBytes: number; trees: number; chunks: number }> = [];
  const sampleMemory = async (phase: string) => {
    if (!memorySession) return;
    await memorySession.send("HeapProfiler.collectGarbage");
    const heap = await memorySession.send("Runtime.getHeapUsage");
    const counts = await host(page).evaluateAll(nodes => ({
      trees: nodes.reduce((n, node) => n + Number((node as HTMLElement).dataset.cameraPaddingTrees ?? 0), 0),
      chunks: nodes.reduce((n, node) => n + Number((node as HTMLElement).dataset.cameraPaddingChunks ?? 0), 0),
    }));
    memory.push({ phase, usedBytes: heap.usedSize, totalBytes: heap.totalSize, ...counts });
  };
  await page.clock.setFixedTime(new Date("2026-09-07T09:00:00Z"));
  const errors: string[] = [], reads: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("response", response => { if (response.status() >= 400) errors.push(`${response.status()} ${new URL(response.url()).pathname}`); });
  page.on("requestfailed", request => errors.push(`${new URL(request.url()).pathname}: ${request.failure()?.errorText}`));
  page.on("request", request => { const path = new URL(request.url()).pathname;
    if (request.method() === "GET" && /\/scene$|\/overview$|\/planet-atlas$|\/world\/viewport|\/chunks\//.test(path)) reads.push(path); });
  expect((await page.request.post("/api/auth/login", { data: { email: "release-scale-b@tasktopia.local", password: "local-scale-fixture-only" } })).status()).toBe(200);
  const loaded = page.waitForResponse(response => new URL(response.url()).pathname.endsWith("/scene") && response.ok());
  const bootstrapLoaded = page.waitForResponse(response => new URL(response.url()).pathname === "/api/bootstrap" && response.ok());
  const started = performance.now();
  await page.goto("/"); const scene = await (await loaded).json() as CitySceneDto; await ready(page);
  const bootstrap = await (await bootstrapLoaded).json() as BootstrapDto;
  const coldMs = performance.now() - started;
  await sampleMemory("initial-1000-task-city");
  expect(scene.city.id).toBe("6357e8a0-1240-40b0-ab77-ba81bc2fb9aa");
  const tasks = [...new Map([...scene.chunks.flatMap(chunk => chunk.tasks), ...scene.completedDistrictSnapshots.flatMap(snapshot => snapshot.tasks)].map(task => [task.id, task])).values()];
  expect(tasks).toHaveLength(1000); expect(new Set(tasks.map(task => task.districtId)).size).toBe(20);
  expect(Number(await host(page).getAttribute("data-task-building-views"))).toBe(1000);
  const plaques = [...new Map(scene.chunks.flatMap(chunk => chunk.blockPlaques ?? []).map(plaque => [plaque.id, plaque])).values()];
  expect(plaques).toHaveLength(100); expect(plaques.reduce((n, plaque) => n + plaque.taskCount, 0)).toBe(1000);
  const retainedCanvas = await page.locator("canvas[aria-label='Интерактивная карта города']").elementHandle();
  const initialCamera = await camera(page);
  await page.locator("canvas[aria-label='Интерактивная карта города']").hover();
  await page.mouse.wheel(0, Math.log(initialCamera.scale / .81) / .0015);
  await expect.poll(async () => (await camera(page)).scale).toBeCloseTo(.81, 4); await ready(page);
  await page.setViewportSize({ width: 1600, height: 2800 }); await ready(page);
  await panTo(page, { x: scene.city.bounds.minX, y: (scene.city.bounds.minY + scene.city.bounds.maxY) / 2 });
  await page.screenshot({ path: `${directory}/jump-before.png` });
  const before = await camera(page);
  const exteriorAt = (view: typeof before, size: { width: number; height: number }) => cameraTerrainPadding(
    { x: size.width / 2 - view.x * 8 * view.scale, y: size.height / 2 - view.y * 8 * view.scale }, view.scale, size, scene.city.bounds, 8, scene.chunkSize);
  const initialBox = (await page.locator("canvas[aria-label='Интерактивная карта города']").boundingBox())!;
  expect(exteriorAt(before, initialBox).length).toBeGreaterThan(0);
  await page.evaluate(() => {
    const state = { stop: false, frames: 0, missingFrames: 0, maxMissing: 0, maxNative: 0, started: performance.now(), lastMissing: 0,
      samples: [] as Array<{ at: number; missing: number; queue: number; native: number }> };
    (window as typeof window & { paddingJump?: typeof state }).paddingJump = state;
    const sample = (now: number) => {
      const node = document.querySelector<HTMLElement>(".world-canvas")!;
      const missing = Number(node.dataset.cameraPaddingVisibleUntextured ?? 0);
      state.frames++; if (missing) { state.missingFrames++; state.lastMissing = now - state.started; }
      state.maxMissing = Math.max(state.maxMissing, missing);
      const native = Number(node.dataset.cameraPaddingNativeCells ?? 0); state.maxNative = Math.max(state.maxNative, native);
      if (state.samples.length < 2000) state.samples.push({ at: now - state.started, missing, native, queue: Number(node.dataset.groundBakeQueue ?? 0) });
      if (!state.stop && state.frames < 2000) requestAnimationFrame(sample);
    }; requestAnimationFrame(sample);
  });
  if (process.env.E2E_NATIVE_PIXEL_CAPTURE === "true") await page.evaluate(() => {
    type Capture = { encoded: string; nativeAtRead: number; camera: { x: number; y: number; scale: number } };
    (window as typeof window & { nativePaddingPixelCapture?: Promise<Capture> }).nativePaddingPixelCapture = new Promise((resolve, reject) => {
      let attempts = 0;
      const sample = async () => {
        const host = document.querySelector<HTMLElement>(".world-canvas")!;
        const nativeAtRead = Number(host.dataset.cameraPaddingNativeCells ?? 0);
        if (!nativeAtRead) {
          if (++attempts > 120) { reject(new Error("No native first-visible layer was observed")); return; }
          requestAnimationFrame(() => { void sample(); }); return;
        }
        try {
          const canvas = document.querySelector<HTMLCanvasElement>("canvas[aria-label='Интерактивная карта города']")!;
          const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
          if (!gl || gl.getParameter(gl.FRAMEBUFFER_BINDING) !== null) throw new Error("Native frame is not on the default WebGL framebuffer");
          // One explicit readback in this separate visual run, immediately
          // after the real RAF draw. No renderer pause or camera mutation.
          const bytes = new Uint8Array(canvas.width * canvas.height * 4);
          gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
          const image = new ImageData(canvas.width, canvas.height);
          for (let y = 0; y < canvas.height; y++) image.data.set(bytes.subarray(y * canvas.width * 4, (y + 1) * canvas.width * 4), (canvas.height - y - 1) * canvas.width * 4);
          const output = new OffscreenCanvas(canvas.width, canvas.height); output.getContext("2d")!.putImageData(image, 0, 0);
          const camera = { x: Number(host.dataset.cameraWorldX), y: Number(host.dataset.cameraWorldY), scale: Number(host.dataset.renderScale) };
          const blob = await output.convertToBlob({ type: "image/png" });
          const encoded = await new Promise<string>((done, fail) => {
            const reader = new FileReader(); reader.onerror = fail;
            reader.onload = () => done(String(reader.result).split(",")[1]!); reader.readAsDataURL(blob);
          });
          resolve({ encoded, nativeAtRead, camera });
        } catch (error) { reject(error); }
      }; requestAnimationFrame(() => { void sample(); });
    });
  });
  const box = (await page.locator("canvas[aria-label='Интерактивная карта города']").boundingBox())!;
  await page.mouse.move(box.x + box.width * .9, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + box.width * .1, box.y + box.height / 2, { steps: 1 }); await page.mouse.up();
  const after = await camera(page);
  expect(after.x - before.x).toBeGreaterThan(64);
  expect(exteriorAt(after, box).length).toBeGreaterThan(0);
  if (process.env.E2E_NATIVE_PIXEL_CAPTURE === "true") {
    // Separate visual run. PNG readback is deliberately excluded from the
    // performance report produced by the default (false) run above.
    const captured = await page.evaluate(() => (window as typeof window & { nativePaddingPixelCapture: Promise<{
      encoded: string; nativeAtRead: number; camera: { x: number; y: number; scale: number } }> }).nativePaddingPixelCapture);
    expect(captured.nativeAtRead).toBeGreaterThan(0);
    const png = Buffer.from(captured.encoded, "base64");
    await writeFile(`${directory}/native-jump-first-visible.png`, png);
    const kindAt = (x: number, y: number) => atlasTerrainKindFromWorld(terrainAt(bootstrap.worldManifest.terrainSeed, x, y).terrain);
    const cells = [-330, -325, 74, 79].flatMap(y => [200, 210, 220, 230, 240, 250, 270, 280, 290, 300, 310].map(x => {
      const kind = kindAt(x, y); return { x, y, tile: atlasTerrainTile(kind, "city", x, y, atlasTerrainConnectionMask(kind, x, y, kindAt)) };
    }));
    const pixels = await page.evaluate(async ({ encoded, cells, revision, camera }) => {
      const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(encoded), c => c.charCodeAt(0))], { type: "image/png" }));
      const frame = new OffscreenCanvas(bitmap.width, bitmap.height).getContext("2d")!; frame.drawImage(bitmap, 0, 0);
      const actual = frame.getImageData(0, 0, bitmap.width, bitmap.height);
      const atlases = new Map<string, ImageData>();
      for (const url of new Set(cells.map(cell => cell.tile.url))) {
        const image = await createImageBitmap(await (await fetch(`/game-assets/v5/revisions/${revision}/${url}`)).blob());
        const context = new OffscreenCanvas(image.width, image.height).getContext("2d")!; context.drawImage(image, 0, 0);
        atlases.set(url, context.getImageData(0, 0, image.width, image.height)); image.close();
      }
      const ox = bitmap.width / 2 - camera.x * 8 * camera.scale, oy = bitmap.height / 2 - camera.y * 8 * camera.scale;
      let matching = 0, sampled = 0;
      for (const cell of cells) for (const dx of [2, 3, 4]) for (const dy of [2, 3, 4]) {
        const px = Math.floor(ox + (cell.x * 8 + dx) * camera.scale), py = Math.floor(oy + (cell.y * 8 + dy) * camera.scale);
        const sx = Math.floor((px + .5 - ox) / camera.scale - cell.x * 8), sy = Math.floor((py + .5 - oy) / camera.scale - cell.y * 8);
        const atlas = atlases.get(cell.tile.url)!;
        const a = (py * actual.width + px) * 4, b = ((cell.tile.sourceY + sy) * atlas.width + cell.tile.sourceX + sx) * 4;
        sampled++; if ([0, 1, 2].every(channel => Math.abs(actual.data[a + channel]! - atlas.data[b + channel]!) <= 6)) matching++;
      }
      bitmap.close(); return { matching, sampled };
    }, { encoded: png.toString("base64"), cells, revision: bootstrap.worldManifest.assetRevision, camera: captured.camera });
    await info.attach("native-first-visible-pixels", { body: JSON.stringify({ nativeAtRead: captured.nativeAtRead, pixels, before, after, capturedCamera: captured.camera }), contentType: "application/json" });
    expect(pixels.matching / pixels.sampled).toBeGreaterThan(.98);
    await ready(page); expect(errors).toEqual([]);
    return;
  }
  // Do not run a PNG/GPU readback inside the measured input-to-material window.
  await ready(page);
  const jump = await page.evaluate(() => {
    const state = (window as typeof window & { paddingJump: { stop: boolean; missingFrames: number; maxNative: number } }).paddingJump; state.stop = true; return state;
  });
  await sampleMemory("after-large-jump");
  await page.screenshot({ path: `${directory}/jump-ready.png` });
  const padding = await host(page).evaluate(node => ({ ...((node as HTMLElement).dataset) }));
  await info.attach("large-padding-jump", { body: JSON.stringify({ before, after, jump, padding, coldMs }), contentType: "application/json" });
  expect(jump.missingFrames).toBe(0);
  expect(jump.maxNative).toBeGreaterThan(0); expect(jump.maxNative).toBeLessThanOrEqual(8192);
  expect(Number(padding.cameraPaddingNativeFrameMaxCells)).toBeLessThanOrEqual(8192);
  expect(padding.cameraPaddingNativeCells).toBe("0");
  expect(padding.cameraPaddingAtlasFamilies).toBe("10");
  await page.setViewportSize({ width: 3400, height: 2850 }); await ready(page);
  await panTo(page, { x: (scene.city.bounds.minX + scene.city.bounds.maxX) / 2, y: (scene.city.bounds.minY + scene.city.bounds.maxY) / 2 });
  await page.mouse.move(10, 20); await page.screenshot({ path: `${directory}/city-20-districts.png` });
  const noBoundaries = await page.locator("canvas[aria-label='Интерактивная карта города']").screenshot();
  await page.getByRole("button", { name: "Границы", exact: true }).click();
  await expect(page.getByRole("button", { name: "Границы", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(host(page)).toHaveAttribute("data-district-boundary-visible", "true");
  await expect(host(page)).toHaveAttribute("data-district-boundary-groups", "20");
  expect(Number(await host(page).getAttribute("data-district-boundary-cells"))).toBeGreaterThan(1000);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const withBoundaries = await page.locator("canvas[aria-label='Интерактивная карта города']").screenshot();
  const boundaryPixels = await page.evaluate(async ({ before, after, colors }) => {
    const decode = async (encoded: string) => {
      const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(encoded), c => c.charCodeAt(0))], { type: "image/png" }));
      const context = new OffscreenCanvas(bitmap.width, bitmap.height).getContext("2d")!; context.drawImage(bitmap, 0, 0);
      const image = context.getImageData(0, 0, bitmap.width, bitmap.height); bitmap.close(); return image;
    };
    const a = await decode(before), b = await decode(after);
    const palette = colors.map(color => Number.parseInt(color.slice(1), 16)).map(color => [color >> 16, color >> 8 & 255, color & 255]);
    let changedBoundaryPixels = 0;
    for (let i = 0; i < a.data.length; i += 4) if ([0, 1, 2].some(c => Math.abs(a.data[i + c]! - b.data[i + c]!) > 8)
      && palette.some(color => color.every((channel, c) => Math.abs(channel - b.data[i + c]!) <= 6))) changedBoundaryPixels++;
    return changedBoundaryPixels;
  }, { before: noBoundaries.toString("base64"), after: withBoundaries.toString("base64"), colors: [...new Set(scene.chunks.flatMap(chunk => chunk.districts.map(district => district.color)))] });
  expect(boundaryPixels).toBeGreaterThan(500);
  await page.screenshot({ path: `${directory}/districts-20.png` });
  await page.getByRole("button", { name: "Границы", exact: true }).click();
  const gallery = tasks.filter(task => task.stage >= 3);
  // This SQL scale fixture intentionally remains predominantly PLANNING;
  // assigned art families are not the same as completed visible buildings.
  expect(gallery.length).toBeGreaterThanOrEqual(1);
  await page.setViewportSize({ width: 1600, height: 1100 }); await ready(page);
  const view = await camera(page);
  await page.locator("canvas[aria-label='Интерактивная карта города']").hover();
  await page.mouse.wheel(0, -Math.log(1 / view.scale) / .0015);
  await expect.poll(async () => (await camera(page)).scale).toBeCloseTo(1, 4);
  await panTo(page, gallery[0]!.origin);
  await page.mouse.move(10, 20); await page.screenshot({ path: `${directory}/native-gallery.png` });
  await page.getByRole("button", { name: "Границы", exact: true }).click();
  await expect(host(page)).toHaveAttribute("data-district-boundary-visible", "true");
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.screenshot({ path: `${directory}/native-district-edge.png` });
  await page.getByRole("button", { name: "Границы", exact: true }).click();
  const retainedCamera = await camera(page);
  await page.getByRole("button", { name: "Страна", exact: true }).click();
  await expect(page.locator(".country-overview")).toHaveAttribute("data-country-ready", "true");
  await page.screenshot({ path: `${directory}/country.png` });
  await page.getByRole("button", { name: "Планета", exact: true }).click();
  await expect(page.locator(".planet-atlas")).toHaveAttribute("data-planet-ready", "true");
  await page.screenshot({ path: `${directory}/planet.png` });
  await page.getByRole("button", { name: "Город", exact: true }).click(); await ready(page);
  expect(await camera(page)).toEqual(retainedCamera);
  expect(await retainedCanvas!.evaluate(node => node === document.querySelector("canvas[aria-label='Интерактивная карта города']"))).toBe(true);
  for (const suffix of ["/scene", "/overview", "/planet-atlas"]) expect(reads.filter(path => path.endsWith(suffix))).toHaveLength(1);
  expect(reads.filter(path => /\/world\/viewport|\/chunks\//.test(path))).toEqual([]); expect(errors).toEqual([]);
  await sampleMemory("after-full-map-and-warm-return");
  if (memorySession) {
    const releasedHost = await host(page).elementHandle(); await retainedCanvas!.dispose();
    await page.getByRole("button", { name: /^Настройки аккаунта/ }).click();
    await page.getByRole("button", { name: "Выйти из аккаунта", exact: true }).click();
    await expect(page.getByLabel("Email")).toBeVisible(); await expect(host(page)).toHaveCount(0);
    await expect.poll(() => releasedHost!.evaluate(node => (node as HTMLElement).dataset.assetLease)).toBe("released");
    expect(await releasedHost!.evaluate(node => Number((node as HTMLElement).dataset.leasedAssets))).toBe(0);
    await releasedHost!.dispose(); await sampleMemory("logout-teardown");
    expect(memory.at(-1)).toMatchObject({ trees: 0, chunks: 0 });
    // Asset leases deliberately retain decoded sources for a real30-second
    // navigation grace period. Immediate logout is not its expiry proof.
    await page.waitForTimeout(31_000); await sampleMemory("after-asset-grace");
    await memorySession.detach();
    expect(errors).toEqual([]);
  }
  await info.attach("large-padding", { body: JSON.stringify({ schema: "release_perf_20260907_b", sceneRevision: scene.sceneRevision, coldMs,
    tasks: tasks.length, districts: new Set(tasks.map(task => task.districtId)).size, plaques: plaques.length, boundaryPixels,
    assignedFamilies: Object.fromEntries([...new Set(tasks.map(task => task.visualAssetKey))].map(key => [key, tasks.filter(task => task.visualAssetKey === key).length])),
    gallery: gallery.map(task => ({ id: task.id, key: task.visualAssetKey, stage: task.stage })), before, after, jump, padding, memory, reads, errors }), contentType: "application/json" });
});
