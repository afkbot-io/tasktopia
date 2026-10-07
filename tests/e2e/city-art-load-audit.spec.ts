import { mkdir, writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import type { CitySceneDto } from "../../src/shared/city-scene-contract";
import { getBuilding } from "../../src/shared/catalog";
import { openMapCity, openMapPlanet } from "./map-navigation";

for (const viewport of [{ width: 1440, height: 1100 }, { width: 390, height: 844 }]) {
  test(`город сохраняет объекты, выбор и границы масштаба на ${viewport.width}×${viewport.height}`, async ({ page }, info) => {
    test.setTimeout(90_000);
    await page.setViewportSize(viewport);
    const errors: string[] = [], dataReads: string[] = [], driverWarnings: string[] = [];
    let startup = true;
    await page.addInitScript(() => {
      Object.assign(window, { __cityAuditReadbacks: 0 });
      for (const Context of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
        if (!Context) continue;
        const original = Context.prototype.readPixels;
        Context.prototype.readPixels = new Proxy(original, { apply(target, context, args) {
          (window as unknown as { __cityAuditReadbacks: number }).__cityAuditReadbacks++;
          return Reflect.apply(target, context, args);
        } });
      }
    });
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => {
      if (startup && message.type() === "warning" && /^\[\.WebGL-0x[0-9a-f]+\]GL Driver Message \(OpenGL, Performance, GL_CLOSE_PATH_NV, High\): GPU stall due to ReadPixels(?: \(this message will no longer repeat\))?$/.test(message.text())) {
        driverWarnings.push(message.text()); return;
      }
      if (message.type() === "error" || (message.type() === "warning" && /webgl|pixi|passive|deprecated/i.test(message.text()))) errors.push(message.text());
    });
    page.on("response", response => { if (response.status() >= 400) errors.push(`${response.status()} ${new URL(response.url()).pathname}`); });
    page.on("requestfailed", request => {
      if (!/ERR_ABORTED/.test(request.failure()?.errorText ?? "")) errors.push(`${request.failure()?.errorText} ${request.url()}`);
    });
    page.on("request", request => {
      const path = new URL(request.url()).pathname;
      if (path.endsWith("/scene") || /\/api\/(?:world\/viewport|chunks\/)/.test(path)) dataReads.push(path);
    });
    expect((await page.request.post("/api/auth/login", { data: { email: "demo@tasktopia.local", password: "tasktopia-demo" } })).ok()).toBe(true);
    const response = page.waitForResponse(response => new URL(response.url()).pathname.endsWith("/scene"));
    await page.goto("/"); await openMapCity(page);
    const scene = await (await response).json() as CitySceneDto;
    const host = page.locator(".world-canvas"), canvas = page.locator("canvas[aria-label='Интерактивная карта города']");
    await expect(host).toHaveAttribute("data-city-scene-commit", "atomic");
    await expect(host).toHaveAttribute("data-ground-bake-queue", "0", { timeout: 45_000 });
    await expect(host).toHaveAttribute("data-city-first-frame-rendered", "true");
    startup = false;
    const applicationReadbacks = await page.evaluate(() => (window as unknown as { __cityAuditReadbacks: number }).__cityAuditReadbacks);
    expect(applicationReadbacks).toBe(0); // Only driver startup warnings are exempt.
    const resident = new Set(scene.chunks.map(chunk => `${chunk.chunkX},${chunk.chunkY}`));
    for (let x = Math.floor(scene.city.bounds.minX / scene.chunkSize); x <= Math.floor(scene.city.bounds.maxX / scene.chunkSize); x++) {
      for (let y = Math.floor(scene.city.bounds.minY / scene.chunkSize); y <= Math.floor(scene.city.bounds.maxY / scene.chunkSize); y++) expect(resident.has(`${x},${y}`)).toBe(true);
    }
    await expect(host).toHaveAttribute("data-world-object-depth-errors", "0");
    expect(Number(await host.getAttribute("data-world-objects"))).toBeGreaterThan(0);
    const beforePan = Number(await host.getAttribute("data-camera-world-x"));
    const box = (await canvas.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
    await page.mouse.move(box.x + box.width * .75, box.y + box.height / 2, { steps: 10 }); await page.mouse.up();
    await expect.poll(async () => Number(await host.getAttribute("data-camera-world-x"))).not.toBe(beforePan);
    await canvas.hover(); await page.mouse.wheel(0, -1200);
    await expect.poll(async () => Number(await host.getAttribute("data-render-scale"))).toBe(4);
    const task = [...scene.chunks.flatMap(chunk => chunk.tasks), ...scene.completedDistrictSnapshots.flatMap(snapshot => snapshot.tasks)]
      .find(task => task.visualKind !== "PARK")!;
    expect(task).toBeDefined();
    const footprint = getBuilding(task.buildingType).footprint;
    const target = { x: task.origin.x + footprint.width / 2, y: task.origin.y + footprint.height / 2 };
    // Centre through public drag gestures, including on a narrow screen.
    for (let attempt = 0; attempt < 30; attempt++) {
      const scale = Number(await host.getAttribute("data-render-scale"));
      const dx = (Number(await host.getAttribute("data-camera-world-x")) - target.x) * 8 * scale;
      const dy = (Number(await host.getAttribute("data-camera-world-y")) - target.y) * 8 * scale;
      if (Math.abs(dx) < 2 && Math.abs(dy) < 2) break;
      const fraction = Math.min(1, box.width * .35 / Math.max(1, Math.abs(dx)), box.height * .35 / Math.max(1, Math.abs(dy)));
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + dx * fraction, box.y + box.height / 2 + dy * fraction, { steps: 4 }); await page.mouse.up();
    }
    await page.waitForTimeout(520); // Documented suppression of clicks immediately after a drag.
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let detailRequested = false;
    await page.route(`**/api/tasks/${task.id}`, async route => { detailRequested = true; await gate; await route.continue(); });
    try {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await expect(page.getByRole("dialog")).toBeVisible();
      await expect.poll(() => detailRequested).toBe(true);
    } finally { release(); }
    await expect(page.locator("#task-title")).toHaveText(task.title);
    await page.getByRole("button", { name: "Закрыть", exact: true }).click();
    await canvas.hover();
    const scale = Number(await host.getAttribute("data-render-scale"));
    await page.mouse.wheel(0, Math.log(scale) / .0015);
    await expect.poll(async () => Number(await host.getAttribute("data-render-scale"))).toBeCloseTo(1, 3);
    await page.setViewportSize({ width: viewport.width + 20, height: viewport.height });
    await expect(host).toHaveAttribute("data-minimum-render-scale", "0.8");
    await page.setViewportSize(viewport);
    expect(dataReads).toHaveLength(1);
    expect(dataReads[0]).toMatch(/\/scene$/);
    const directory = process.env.CITY_AUDIT_SCREENSHOT_DIR ?? info.outputPath("city-audit");
    await mkdir(directory, { recursive: true });
    await page.mouse.move(10, 20);
    await page.screenshot({ path: `${directory}/city-${viewport.width}.png` });
    await canvas.hover(); await page.mouse.wheel(0, Math.log(1 / .81) / .0015);
    await expect.poll(async () => Number(await host.getAttribute("data-render-scale"))).toBeCloseTo(.81, 3);
    await page.mouse.wheel(0, 60);
    await expect(page.locator(".planet-atlas")).toHaveAttribute("data-planet-ready", "true");
    await openMapCity(page);
    await expect(host).toHaveAttribute("data-city-scene-commit", "atomic");
    await openMapPlanet(page);
    await expect(host).toHaveAttribute("data-animation-active", "false");
    expect(errors).toEqual([]);
    await writeFile(`${directory}/viewport-${viewport.width}.json`, JSON.stringify({ viewport, sceneRevision: scene.sceneRevision, chunks: resident.size, dataReads, errors, driverWarnings, applicationReadbacks }, null, 2));
  });
}
