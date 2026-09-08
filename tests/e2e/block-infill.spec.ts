import { mkdir } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import type { CitySceneDto } from "../../src/shared/city-scene-contract";
import type { ChunkTaskDto } from "../../src/shared/contracts";

test.skip(process.env.E2E_BLOCK_INFILL_FIXTURE !== "true", "Isolated block_infill_20260906 fixture only");
test.use({ viewport: { width: 1600, height: 1100 }, actionTimeout: 10_000 });
const directory = process.env.BLOCK_SCREENSHOT_DIR ?? "screenshots/block-infill";
const phaseTime = { DAWN: "05:00", DAY: "09:00", DUSK: "14:00", NIGHT: "18:00" } as const;
async function setMoscowPhase(page: Page, phase: keyof typeof phaseTime) {
  // Freeze only Date, not animation frames or browser timers. UTC + 3 = MSK.
  await page.clock.setFixedTime(new Date(`2026-09-06T${phaseTime[phase]}:00Z`));
}
const ready = async (page: Page) => {
  await expect(page.locator(".world-canvas")).toHaveAttribute("data-city-scene-commit", "atomic");
  await expect(page.locator(".world-canvas")).not.toHaveAttribute("data-load-error", "true");
  await expect(page.locator(".world-canvas")).toHaveAttribute("data-minimum-render-scale", "0.8");
  await expect(page.locator(".map-level-transition")).toHaveCount(0);
};
async function pointAt(page: Page, task: Pick<ChunkTaskDto, "footprint">) {
  const target = { x: (Math.min(...task.footprint.map(p => p.x)) + Math.max(...task.footprint.map(p => p.x)) + 1) / 2,
    y: (Math.min(...task.footprint.map(p => p.y)) + Math.max(...task.footprint.map(p => p.y)) + 1) / 2 };
  const host = page.locator(".world-canvas");
  const box = (await page.locator("canvas[aria-label='Интерактивная карта города']").boundingBox())!;
  for (let n = 0; n < 30; n++) {
    const scale = Number(await host.getAttribute("data-render-scale"));
    const dx = (Number(await host.getAttribute("data-camera-world-x")) - target.x) * 8 * scale;
    const dy = (Number(await host.getAttribute("data-camera-world-y")) - target.y) * 8 * scale;
    if (Math.abs(dx) < 2 && Math.abs(dy) < 2) break;
    const fraction = Math.min(1, box.width * .4 / Math.max(1, Math.abs(dx)), box.height * .4 / Math.max(1, Math.abs(dy)));
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + dx * fraction, box.y + box.height / 2 + dy * fraction, { steps: 4 });
    await page.mouse.up();
  }
  await page.waitForTimeout(520); // Public post-drag click suppression is500ms.
  const scale = Number(await host.getAttribute("data-render-scale"));
  return { x: box.x + box.width / 2 + (target.x - Number(await host.getAttribute("data-camera-world-x"))) * 8 * scale,
    y: box.y + box.height / 2 + (target.y - Number(await host.getAttribute("data-camera-world-y"))) * 8 * scale };
}

test("infill tasks, block plaques and district boundaries survive a map round trip", async ({ page }, info) => {
  test.setTimeout(180_000);
  await setMoscowPhase(page, "DAY");
  await mkdir(directory, { recursive: true });
  const errors: string[] = [], reads: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("response", response => { if (response.status() >= 400) errors.push(`${response.status()} ${new URL(response.url()).pathname}`); });
  page.on("requestfailed", request => errors.push(`${new URL(request.url()).pathname}: ${request.failure()?.errorText}`));
  page.on("request", request => { const path = new URL(request.url()).pathname;
    if (request.method() === "GET" && /\/scene$|\/overview$|\/planet-atlas$|\/world\/viewport|\/chunks\//.test(path)) reads.push(path); });
  expect((await page.request.post("/api/auth/login", { data: { email: "demo@tasktopia.local", password: "tasktopia-demo" } })).status()).toBe(200);
  const loaded = page.waitForResponse(r => /\/cities\/[^/]+\/scene$/.test(new URL(r.url()).pathname));
  await page.goto("/");
  const scene = await (await loaded).json() as CitySceneDto;
  expect(scene.city.name).toBe("Разнообразные кварталы"); await ready(page);
  const tasks = [...new Map(scene.chunks.flatMap(c => c.tasks).map(t => [t.id, t])).values()];
  expect(tasks).toHaveLength(96); expect(new Set(tasks.map(t => t.districtId)).size).toBe(3);
  const plaques = [...new Map(scene.chunks.flatMap(c => c.blockPlaques ?? []).map(p => [p.id, p])).values()];
  expect(plaques.length).toBeGreaterThan(3);
  expect(plaques.reduce((sum, p) => sum + p.taskCount, 0)).toBe(96);
  await expect.poll(async () => Number(await page.locator(".world-canvas").getAttribute("data-block-plaques"))).toBeGreaterThan(0);
  await pointAt(page, { footprint: [{ x: scene.city.bounds.minX, y: scene.city.bounds.minY },
    { x: scene.city.bounds.maxX, y: scene.city.bounds.maxY }] });
  await page.screenshot({ path: `${directory}/city.png` });
  const host = page.locator(".world-canvas");
  const originalCanvas = await page.locator("canvas[aria-label='Интерактивная карта города']").elementHandle();
  await expect(page.getByLabel("Освещение мира")).toHaveCount(0);
  for (const phase of ["DAWN", "DUSK", "NIGHT", "DAY"] as const) {
    await setMoscowPhase(page, phase);
    await expect(host).toHaveAttribute("data-light-phase", phase);
    if (phase === "NIGHT") {
      await expect(host).toHaveAttribute("data-lamp-intensity", "1.000");
      await expect.poll(async () => Number(await host.getAttribute("data-illuminated-lamps"))).toBeGreaterThan(0);
    }
    expect(await originalCanvas!.evaluate(node => node.isConnected)).toBe(true);
    await page.screenshot({ path: `${directory}/city-${phase.toLowerCase()}.png` });
  }
  await page.getByRole("button", { name: "Районы", exact: true }).click();
  await page.screenshot({ path: `${directory}/districts.png` });
  const parks = tasks.filter(t => t.visualKind === "PARK");
  const examples = [1, 3, 5].map(stage => parks.find(t => t.stage === stage)!);
  expect(examples.every(Boolean)).toBe(true);
  const narrow = parks.find(t => new Set(t.footprint.map(p => p.x)).size <= 2 || new Set(t.footprint.map(p => p.y)).size <= 2);
  expect(narrow).toBeTruthy(); examples.push(narrow!);
  await page.locator("canvas[aria-label='Интерактивная карта города']").hover(); await page.mouse.wheel(0, -500);
  for (const [i, task] of examples.entries()) {
    const point = await pointAt(page, task);
    await page.mouse.click(point.x, point.y);
    await expect(page.getByRole("dialog").locator("#task-title")).toHaveText(task.title);
    await page.getByRole("button", { name: "Закрыть", exact: true }).click();
    await expect(page.locator(".task-modal")).toHaveCount(0);
    await page.mouse.move(10, 20); await page.screenshot({ path: `${directory}/park-${i}-stage-${task.stage}.png` });
  }
  await page.getByRole("button", { name: "Город", exact: true }).click();
  await page.getByRole("button", { name: "Страна", exact: true }).click();
  await expect(page.locator(".country-overview")).toHaveAttribute("data-country-ready", "true");
  await expect(page.locator(".map-level-transition")).toHaveCount(0); await page.screenshot({ path: `${directory}/country.png` });
  await setMoscowPhase(page, "NIGHT");
  await expect.poll(() => page.locator(".country-overview-raster").evaluate(node => getComputedStyle(node).filter)).not.toBe("brightness(1)");
  await page.screenshot({ path: `${directory}/country-night.png` });
  await setMoscowPhase(page, "DAY");
  await page.getByRole("button", { name: "Планета", exact: true }).click();
  await expect(page.locator(".planet-atlas")).toHaveAttribute("data-planet-ready", "true");
  await expect(page.locator(".map-level-transition")).toHaveCount(0); await page.screenshot({ path: `${directory}/planet.png` });
  await setMoscowPhase(page, "NIGHT");
  await expect.poll(() => page.locator(".planet-map-ocean").evaluate(node => getComputedStyle(node).filter)).not.toBe("brightness(1)");
  await page.screenshot({ path: `${directory}/planet-night.png` });
  await setMoscowPhase(page, "DAY");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: /^Открыть страну .*, 1 городов,/ }).click();
  await expect(page.locator(".country-overview")).toHaveAttribute("data-country-ready", "true");
  await page.getByRole("button", { name: /^Открыть город Разнообразные кварталы,/ }).click(); await ready(page);
  await pointAt(page, examples[2]!); await page.screenshot({ path: `${directory}/mobile.png` });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  for (const suffix of ["/scene", "/overview", "/planet-atlas"]) expect(reads.filter(p => p.endsWith(suffix))).toHaveLength(1);
  expect(reads.filter(p => /\/world\/viewport|\/chunks\//.test(p))).toEqual([]); expect(errors).toEqual([]);
  await info.attach("block-infill", { body: JSON.stringify({ sceneRevision: scene.sceneRevision, plaques, parkCount: parks.length, examples: examples.map(t => ({ id: t.id, stage: t.stage, cells: t.footprint.length })), reads, errors }), contentType: "application/json" });
});
