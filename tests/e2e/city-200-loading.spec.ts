import { expect, test } from "@playwright/test";
import { openMapCity, openMapPlanet } from "./map-navigation";
import type { CitySceneDto } from "../../src/shared/city-scene-contract";

test.skip(process.env.E2E_CITY_200 !== "true", "Requires the owned 200-task loading fixture");

for (const viewport of [{ width: 1440, height: 1000 }, { width: 1440, height: 1100 }, { width: 390, height: 844 }]) {
  test(`200-task first frame and exterior prewarm at ${viewport.width}x${viewport.height}`, async ({ page }, info) => {
    await page.setViewportSize(viewport);
    await page.addInitScript(() => {
      // Isolate motion changes from AUTO quality's legitimate network resize.
      localStorage.setItem("tasktopia:world-preferences:v2", JSON.stringify({ cityLife: true, reduceMotion: false, quality: "NORMAL" }));
      const audit = { numberPaints: 0 };
      (window as typeof window & { cityNumberPaintAudit: typeof audit }).cityNumberPaintAudit = audit;
      const original = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function(text, ...args) {
        if (this.font.includes("Manrope") && /^[0-9]{2,}$/.test(text)) audit.numberPaints++;
        return original.call(this, text, ...args);
      };
    });
    const errors: string[] = [], requests: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error" || /passive|deprecated/i.test(message.text())) errors.push(message.text()); });
    page.on("request", request => requests.push(new URL(request.url()).pathname));
    const sceneResponse = page.waitForResponse(response => /\/cities\/[^/]+\/scene$/.test(new URL(response.url()).pathname));
    expect((await page.request.post("/api/auth/login", { data: { email: "demo@tasktopia.local", password: "tasktopia-demo" } })).status()).toBe(200);
    await page.goto("/"); await openMapCity(page);
    const host = page.locator(".world-canvas");
    await expect(host).toHaveAttribute("data-city-scene-commit", "atomic", { timeout: 30_000 });
    await expect(page.locator(".map-level-transition")).toHaveCount(0);
    const scene = await (await sceneResponse).json() as CitySceneDto;
    const taskIds = new Set([...scene.chunks.flatMap(c => c.tasks), ...scene.completedDistrictSnapshots.flatMap(s => s.tasks)].map(t => t.id));
    expect(taskIds.size).toBe(200); await expect(host).toHaveAttribute("data-task-building-views", "200");
    expect(await page.evaluate(() => (window as typeof window & { cityNumberPaintAudit: { numberPaints: number } }).cityNumberPaintAudit.numberPaints),
      "Building numbers share glyph textures instead of painting 200 separate canvases").toBeLessThan(10);
    const initial = await host.evaluate(node => {
      const d = (node as HTMLElement).dataset;
      return { x: Number(d.cameraWorldX), y: Number(d.cameraWorldY), scale: Number(d.renderScale), initial: Number(d.cameraPaddingInitialChunks),
        width: node.clientWidth, height: node.clientHeight };
    });
    const residents = new Set(scene.chunks.map(c => `${c.chunkX},${c.chunkY}`));
    const chunkPixels = 8 * scene.chunkSize * initial.scale;
    const originX = initial.width / 2 - initial.x * 8 * initial.scale, originY = initial.height / 2 - initial.y * 8 * initial.scale;
    let exterior = 0;
    for (let y = Math.floor(-originY / chunkPixels); y <= Math.floor((initial.height - originY - 1) / chunkPixels); y++) {
      for (let x = Math.floor(-originX / chunkPixels); x <= Math.floor((initial.width - originX - 1) / chunkPixels); x++) if (!residents.has(`${x},${y}`)) exterior++;
    }
    expect(initial.initial, "The initial frame prepares only visible exterior, then prewarms its halo").toBe(exterior);
    await expect(host).toHaveAttribute("data-camera-padding-visible-unbaked", "0");
    await expect(host).toHaveAttribute("data-camera-padding-visible-untextured", "0");
    await page.screenshot({ path: info.outputPath("first-frame.png") });
    await expect(host).toHaveAttribute("data-ground-bake-queue", "0", { timeout: 30_000 });
    await expect.poll(async () => Number(await host.getAttribute("data-camera-padding-chunks"))).toBeGreaterThan(exterior);
    await page.screenshot({ path: info.outputPath("prewarm.png") });
    await expect(host).toHaveAttribute("data-mobility-ready", "true");
    const networkBuilds = await host.getAttribute("data-walk-network-builds");
    const entityBuilds = Number(await host.getAttribute("data-entity-rebuilds"));
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(host).toHaveAttribute("data-animation-active", "false");
    await expect.poll(async () => Number(await host.getAttribute("data-entity-rebuilds"))).toBeGreaterThan(entityBuilds);
    expect(await host.getAttribute("data-walk-network-builds"), "Motion preferences do not rebuild unchanged paths").toBe(networkBuilds);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await expect(host).toHaveAttribute("data-animation-active", "true");
    const box = (await host.locator("canvas").boundingBox())!;
    if (viewport.width === 1440 && viewport.height === 1000) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.wheel(0, Math.log(initial.scale) / .0015);
      await expect.poll(async () => Number(await host.getAttribute("data-render-scale"))).toBeCloseTo(1, 2);
      await page.screenshot({ path: info.outputPath("native-1x.png") });
      await page.mouse.wheel(0, -1500);
      await expect.poll(async () => Number(await host.getAttribute("data-render-scale"))).toBeCloseTo(4, 2);
      await page.screenshot({ path: info.outputPath("zoom-4x.png") });
      await expect(host).toHaveAttribute("data-minimum-render-scale", "0.8");
    }
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 100, box.y + box.height / 2, { steps: 5 }); await page.mouse.up();
    await expect.poll(async () => Number(await host.getAttribute("data-camera-world-x"))).toBeGreaterThan(initial.x);
    await expect(host).toHaveAttribute("data-camera-padding-visible-untextured", "0");
    await openMapPlanet(page); await openMapCity(page);
    await expect(host).toHaveAttribute("data-city-scene-commit", "atomic");
    await expect(page.locator(".map-level-transition")).toHaveCount(0);
    expect(requests.filter(p => /\/cities\/[^/]+\/scene$/.test(p))).toHaveLength(1);
    expect(requests.filter(p => /\/world\/viewport|\/chunks\//.test(p))).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test("200-task city remains usable with unavailable webfonts", async ({ page }) => {
  let failures = 0;
  await page.route(/\/assets\/manrope-[^/]+\.woff2$/, route => { failures++; return route.abort(); });
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  expect((await page.request.post("/api/auth/login", { data: { email: "demo@tasktopia.local", password: "tasktopia-demo" } })).status()).toBe(200);
  await page.goto("/"); await openMapCity(page);
  const host = page.locator(".world-canvas");
  await expect(host).toHaveAttribute("data-city-scene-commit", "atomic", { timeout: 30_000 });
  await expect(host).toHaveAttribute("data-task-building-views", "200");
  await expect(page.locator(".map-level-transition")).toHaveCount(0);
  expect(failures).toBeGreaterThan(0); expect(errors).toEqual([]);
});

test("shared number atlas survives warm return and is released on logout", async ({ page }) => {
  await page.addInitScript(() => {
    const audit = { glyphPaints: 0, maxGlyphPagePixels: 0 };
    (window as typeof window & { cityGlyphAudit: typeof audit }).cityGlyphAudit = audit;
    const original = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function(text, ...args) {
      if (this.font.includes("Manrope") && /^[0-9]$/.test(text)) {
        audit.glyphPaints++;
        audit.maxGlyphPagePixels = Math.max(audit.maxGlyphPagePixels, this.canvas.width * this.canvas.height);
      }
      return original.call(this, text, ...args);
    };
  });
  const painted = () => page.evaluate(() => (window as typeof window & { cityGlyphAudit: { glyphPaints: number } }).cityGlyphAudit.glyphPaints);
  expect((await page.request.post("/api/auth/login", { data: { email: "demo@tasktopia.local", password: "tasktopia-demo" } })).status()).toBe(200);
  await page.goto("/"); await openMapCity(page);
  await expect(page.locator(".world-canvas")).toHaveAttribute("data-city-scene-commit", "atomic", { timeout: 30_000 });
  const initial = await painted(); expect(initial).toBeGreaterThanOrEqual(10);
  expect(await page.evaluate(() => (window as typeof window & { cityGlyphAudit: { maxGlyphPagePixels: number } }).cityGlyphAudit.maxGlyphPagePixels),
    "The shared numeric page stays within 1MiB RGBA at the existing glyph density").toBeLessThanOrEqual(512 * 512);
  await openMapPlanet(page); await openMapCity(page);
  await expect(page.locator(".map-level-transition")).toHaveCount(0); expect(await painted()).toBe(initial);
  await page.getByLabel("Меню", { exact: true }).click();
  await page.getByRole("button", { name: "Аккаунт и настройки", exact: true }).click();
  await page.getByRole("button", { name: "Выйти из аккаунта", exact: true }).click();
  await expect(page.locator(".world-canvas")).toHaveCount(0);
  await page.getByLabel("Email").fill("demo@tasktopia.local"); await page.getByLabel("Пароль").fill("tasktopia-demo");
  await page.getByRole("button", { name: "Открыть страну", exact: true }).click(); await openMapCity(page);
  await expect(page.locator(".world-canvas")).toHaveAttribute("data-city-scene-commit", "atomic", { timeout: 30_000 });
  expect(await painted(), "A disposed font is generated anew for the next renderer").toBeGreaterThanOrEqual(initial + 10);
});
