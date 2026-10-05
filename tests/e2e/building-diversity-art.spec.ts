import { openMapCity, openMapPlanet } from "./map-navigation";
import { mkdir, writeFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import type { CitySceneDto } from "../../src/shared/city-scene-contract";
import type { ChunkTaskDto } from "../../src/shared/contracts";
import { getBuilding } from "../../src/shared/catalog";

test.skip(process.env.E2E_BUILDING_DIVERSITY_ART !== "true", "Requires seed-building-diversity-preview's isolated local fixture");
test.use({ viewport: { width: 1440, height: 1000 } });
const familyOf = (task: ChunkTaskDto) => task.visualKind === "PARK" ? task.visualAssetKey : task.buildingType;
function geometry(task: ChunkTaskDto) {
  if (task.visualKind !== "PARK") return getBuilding(task.buildingType);
  const width = Math.max(...task.footprint.map(c => c.x)) - Math.min(...task.footprint.map(c => c.x)) + 1;
  const height = Math.max(...task.footprint.map(c => c.y)) - Math.min(...task.footprint.map(c => c.y)) + 1;
  return { footprint: { width, height }, spriteSize: { width: width * 8, height: height * 8 } };
}
async function center(page: Page, task: ChunkTaskDto) {
  const entry = geometry(task);
  const target = { x: task.origin.x + entry.footprint.width / 2, y: task.origin.y + entry.footprint.height / 2 };
  const host = page.locator(".world-canvas");
  const box = (await page.locator("canvas[aria-label='Интерактивная карта города']").boundingBox())!;
  for (let i = 0; i < 30; i++) {
    const scale = Number(await host.getAttribute("data-render-scale"));
    const dx = (Number(await host.getAttribute("data-camera-world-x")) - target.x) * 8 * scale;
    const dy = (Number(await host.getAttribute("data-camera-world-y")) - target.y) * 8 * scale;
    if (Math.abs(dx) < 2 && Math.abs(dy) < 2) break;
    const fraction = Math.min(1, box.width * .4 / Math.max(1, Math.abs(dx)), box.height * .4 / Math.max(1, Math.abs(dy)));
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + dx * fraction, box.y + box.height / 2 + dy * fraction, { steps: 4 });
    await page.mouse.up();
  }
  await page.waitForTimeout(520); // Public post-pan click suppression, not load readiness.
  const scale = Number(await host.getAttribute("data-render-scale"));
  return { x: box.x + box.width / 2 + (target.x - Number(await host.getAttribute("data-camera-world-x"))) * 8 * scale,
    y: box.y + box.height / 2 + (target.y - Number(await host.getAttribute("data-camera-world-y"))) * 8 * scale };
}

const parks = Boolean(process.env.PARK_ART_VARIANTS);
const families = (process.env.PARK_ART_VARIANTS ?? process.env.BUILDING_ART_FAMILIES ?? "compact-blue-bay-v1,compact-copper-court-v1").split(",");

test("city architecture renders all five real construction stages and opens its tasks", async ({ page }) => {
  test.setTimeout(120_000);
  const database = new URL(process.env.E2E_DATABASE_URL ?? "invalid");
  expect(["localhost", "127.0.0.1"]).toContain(database.hostname);
  expect(database.pathname).toBe("/tasktopia_test");
  expect(database.searchParams.get("options")).toMatch(/^-csearch_path=building_diversity_[a-f0-9]{32}$/);
  const directory = process.env.BUILDING_ART_SCREENSHOT_DIR ?? "screenshots/building-diversity-art";
  await mkdir(directory, { recursive: true });
  await page.clock.setFixedTime(new Date("2026-09-06T09:00:00Z"));
  const errors: string[] = [], writes: string[] = [], loaded = new Set<string>();
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("requestfailed", request => errors.push(request.url()));
  page.on("request", request => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/api/") && !["GET", "HEAD", "OPTIONS"].includes(request.method()) && path !== "/api/auth/login") writes.push(path);
  });
  page.on("response", response => {
    const path = new URL(response.url()).pathname;
    if (response.status() >= 400) errors.push(`${response.status()} ${path}`);
    if (response.ok() && families.some(family => new RegExp(`${family}/stage-[345]\\.png$`).test(path))) loaded.add(path);
  });
  expect((await page.request.post("/api/auth/login", { data: { email: "demo@tasktopia.local", password: "tasktopia-demo" } })).status()).toBe(200);
  const pending = page.waitForResponse(response => /\/cities\/[^/]+\/scene$/.test(new URL(response.url()).pathname));
  await page.goto("/");
  await openMapCity(page);
  const scene = await (await pending).json() as CitySceneDto;
  expect(scene.city.name).toBe("Новые дома — все стадии");
  const host = page.locator(".world-canvas");
  await expect(host).toHaveAttribute("data-city-scene-commit", "atomic");
  await expect(host).toHaveAttribute("data-world-object-depth-errors", "0");
  const tasks = [...new Map(scene.chunks.flatMap(chunk => chunk.tasks).map(task => [task.id, task])).values()]
    .filter(task => families.includes(familyOf(task)));
  expect(tasks).toHaveLength(families.length * 5);
  await page.screenshot({ path: `${directory}/city.png` });
  for (const family of families) {
    expect(tasks.filter(task => familyOf(task) === family).map(task => task.stage).sort()).toEqual([1, 2, 3, 4, 5]);
  }
  await page.locator("canvas[aria-label='Интерактивная карта города']").hover();
  await page.mouse.wheel(0, -1200);
  await expect.poll(async () => Number(await host.getAttribute("data-render-scale"))).toBeGreaterThan(3.8);
  const examples = [];
  for (const task of tasks.sort((a, b) => familyOf(a).localeCompare(familyOf(b)) || a.stage - b.stage)) {
    const entry = geometry(task);
    expect(task.footprint).toHaveLength(entry.footprint.width * entry.footprint.height);
    const point = await center(page, task);
    await page.mouse.move(10, 20);
    const file = `${familyOf(task)}-stage-${task.stage}.png`;
    const renderScale = Number(await host.getAttribute("data-render-scale"));
    const viewport = page.viewportSize()!;
    const width = Math.min(viewport.width, Math.max(360, (entry.spriteSize.width + 32) * renderScale));
    const height = Math.min(viewport.height, Math.max(360, (entry.spriteSize.height + 32) * renderScale));
    await page.screenshot({ path: `${directory}/${file}`, clip: {
      x: Math.max(0, Math.min(viewport.width - width, point.x - width / 2)),
      y: Math.max(0, Math.min(viewport.height - height, point.y - height / 2)), width, height,
    } });
    await page.mouse.click(point.x, point.y);
    await expect(page.getByRole("dialog").locator("#task-title")).toHaveText(task.title);
    await page.getByRole("button", { name: "Закрыть", exact: true }).click();
    await expect(page.locator(".task-modal")).toHaveCount(0);
    const art = geometry(task);
    if (task.stage >= 3 && art.spriteSize.height > art.footprint.height * 8) {
      // Click the authored roof above the physical parcel: a taller canvas must
      // remain interactive, not be clipped to the lot or select its neighbour.
      const scale = Number(await host.getAttribute("data-render-scale"));
      await page.mouse.click(point.x, point.y - (art.footprint.height / 2 + .25) * 8 * scale);
      await expect(page.getByRole("dialog").locator("#task-title")).toHaveText(task.title);
      await page.getByRole("button", { name: "Закрыть", exact: true }).click();
    }
    examples.push({ id: task.id, family: familyOf(task), stage: task.stage, file });
  }
  if (!parks) expect(loaded.size).toBe(families.length * 3);
  // Native scale and the actual regional/global atlas use the same saved city.
  await page.locator("canvas[aria-label='Интерактивная карта города']").hover();
  await page.mouse.wheel(0, Math.log(Number(await host.getAttribute("data-render-scale"))) / .0015);
  await expect.poll(async () => Math.abs(Number(await host.getAttribute("data-render-scale")) - 1)).toBeLessThan(.001);
  for (const task of tasks.filter(task => task.stage === 5)) {
    await center(page, task); await page.mouse.move(10, 20);
    await page.screenshot({ path: `${directory}/${familyOf(task)}-native1x.png` });
  }
  await openMapPlanet(page);
  const planet = page.locator(".planet-atlas");
  await expect(planet).toHaveAttribute("data-planet-ready", "true");
  await page.screenshot({ path: `${directory}/planet.png` });
  await page.locator(`.planet-city-targets [data-city-id="${scene.city.id}"]`).click();
  await expect(planet).toHaveAttribute("data-globe-zoom", "3.00");
  await expect(page.locator(`.planet-city-label[data-city-id="${scene.city.id}"]`)).toBeVisible();
  await page.screenshot({ path: `${directory}/country-region.png` });
  await openMapCity(page);
  await expect(host).toHaveAttribute("data-city-scene-commit", "atomic");
  await center(page, tasks.find(task => task.stage === 5)!);
  await page.screenshot({ path: `${directory}/city-return.png` });
  expect(errors).toEqual([]); expect(writes).toEqual([]);
  await writeFile(`${directory}/evidence.json`, JSON.stringify({ sceneRevision: scene.sceneRevision, examples, loaded: [...loaded], errors, writes }, null, 2));
});
