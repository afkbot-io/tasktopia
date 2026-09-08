import { mkdir } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import type { CitySceneDto } from "../../src/shared/city-scene-contract";
import type { ChunkTaskDto } from "../../src/shared/contracts";

test.skip(process.env.E2E_COMPACT_RELEASE_FIXTURE !== "true", "Explicit480task/20sprint isolated release fixture only");
test.use({ viewport: { width: 1440, height: 1100 } });
const directory = "screenshots/compact-rc-final";
const ready = async (page: Page) => {
  await expect(page.locator(".world-canvas")).toHaveAttribute("data-city-scene-commit", "atomic", { timeout: 60_000 });
  await expect(page.locator(".map-level-transition")).toHaveCount(0);
};
async function center(page: Page, task: Pick<ChunkTaskDto, "footprint">, acceptFullyVisible = false) {
  const xs = task.footprint.map(p => p.x), ys = task.footprint.map(p => p.y);
  const target = { x: (Math.min(...xs) + Math.max(...xs) + 1) / 2, y: (Math.min(...ys) + Math.max(...ys) + 1) / 2 };
  const host = page.locator(".world-canvas");
  const box = (await page.locator("canvas[aria-label='Интерактивная карта города']").boundingBox())!;
  for (let n = 0; n < 40; n++) {
    const scale = Number(await host.getAttribute("data-render-scale"));
    const dx = (Number(await host.getAttribute("data-camera-world-x")) - target.x) * 8 * scale;
    const dy = (Number(await host.getAttribute("data-camera-world-y")) - target.y) * 8 * scale;
    if (acceptFullyVisible && Math.abs(dx) + (Math.max(...xs) - Math.min(...xs) + 1) * 4 * scale < box.width / 2 - 8
      && Math.abs(dy) + (Math.max(...ys) - Math.min(...ys) + 1) * 4 * scale < box.height / 2 - 8) break;
    if (Math.abs(dx) < 2 && Math.abs(dy) < 2) break;
    const fraction = Math.min(1, box.width * .4 / Math.max(1, Math.abs(dx)), box.height * .4 / Math.max(1, Math.abs(dy)));
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + dx * fraction, box.y + box.height / 2 + dy * fraction, { steps: 4 });
    await page.mouse.up();
  }
  await page.waitForTimeout(520); // Documented post-pan click suppression, not scene readiness.
  const scale = Number(await host.getAttribute("data-render-scale"));
  return { x: box.x + box.width / 2 + (target.x - Number(await host.getAttribute("data-camera-world-x"))) * 8 * scale,
    y: box.y + box.height / 2 + (target.y - Number(await host.getAttribute("data-camera-world-y"))) * 8 * scale };
}

test("480real tasks across20sprints keep compact art, one resident scene and accessible map transitions", async ({ page }, info) => {
  test.setTimeout(300_000);
  await mkdir(directory, { recursive: true });
  const errors: string[] = [], reads: string[] = [], taskTimes: number[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("response", response => { if (response.status() >= 400) errors.push(`${response.status()} ${new URL(response.url()).pathname}`); });
  page.on("requestfailed", request => errors.push(`${request.method()} ${new URL(request.url()).pathname}: ${request.failure()?.errorText}`));
  page.on("request", request => { const path = new URL(request.url()).pathname;
    if (request.method() === "GET" && /\/scene$|\/overview$|\/planet-atlas$|\/world\/viewport|\/chunks\//.test(path)) reads.push(path); });
  const login = await page.request.post("/api/auth/login", { data: { email: "demo@tasktopia.local", password: "tasktopia-demo" } });
  expect(login.status()).toBe(200);
  const loaded = page.waitForResponse(r => /\/cities\/[^/]+\/scene$/.test(new URL(r.url()).pathname));
  const started = Date.now(); await page.goto("/");
  const response = await loaded; const scene = await response.json() as CitySceneDto;
  expect(scene.city.name).toBe("Город двадцати спринтов"); await ready(page);
  const firstReadyMs = Date.now() - started;
  const tasks = [...new Map([...scene.chunks.flatMap(c => c.tasks), ...scene.completedDistrictSnapshots.flatMap(s => s.tasks)].map(t => [t.id, t])).values()];
  expect(tasks).toHaveLength(480); expect(new Set(tasks.map(t => t.districtId)).size).toBe(20);
  await page.screenshot({ path: `${directory}/city.png`, fullPage: true });
  await page.getByRole("button", { name: "Районы", exact: true }).click();
  await page.screenshot({ path: `${directory}/districts.png`, fullPage: true });
  await page.getByRole("button", { name: "Город", exact: true }).click();
  const examples = tasks.filter(t => t.taskNumber <= 240 && (t.taskNumber - 1) % 24 >= 3 && (t.taskNumber - 1) % 24 < 6).sort((a, b) => a.taskNumber - b.taskNumber);
  expect(examples).toHaveLength(30); expect(new Set(examples.map(t => t.buildingType)).size).toBe(10);
  await page.locator("canvas[aria-label='Интерактивная карта города']").hover(); await page.mouse.wheel(0, -600);
  await expect.poll(async () => Number(await page.locator(".world-canvas").getAttribute("data-render-scale"))).toBeGreaterThan(1.5);
  for (const task of examples) {
    const point = await center(page, task);
    const time = Date.now();
    const detail = page.waitForResponse(r => new URL(r.url()).pathname === `/api/tasks/${task.id}`);
    await page.mouse.click(point.x, point.y); expect((await detail).status()).toBe(200);
    await expect(page.getByRole("dialog").locator("#task-title")).toHaveText(task.title); taskTimes.push(Date.now() - time);
    await page.getByRole("button", { name: "Закрыть", exact: true }).click(); await expect(page.locator(".task-modal")).toHaveCount(0);
    await page.mouse.move(12, 15); await page.screenshot({ path: `${directory}/${task.buildingType}-stage-${task.stage}.png`, fullPage: true });
  }
  for (const role of ["SHOP", "EDUCATION", "MEDICAL", "FIRE", "POLICE", "RAILWAY", "AIRPORT", "CIVIC"]) {
    const task = tasks.filter(task => task.serviceRole === role).sort((a, b) => b.stage - a.stage)[0];
    expect(task, `The20sprint fixture must include a reserved ${role} task`).toBeTruthy();
    await center(page, task!);
    await page.screenshot({ path: `${directory}/service-${role.toLowerCase()}.png`, fullPage: true });
  }
  await page.getByRole("button", { name: "Страна", exact: true }).click();
  await expect(page.locator(".country-overview")).toHaveAttribute("data-country-ready", "true");
  await expect(page.locator(".map-level-transition")).toHaveCount(0); await page.screenshot({ path: `${directory}/country.png`, fullPage: true });
  await page.getByRole("button", { name: "Планета", exact: true }).click();
  await expect(page.locator(".planet-atlas")).toHaveAttribute("data-planet-ready", "true");
  await expect(page.locator(".map-level-transition")).toHaveCount(0); await page.screenshot({ path: `${directory}/planet.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: /^Открыть страну .*, 1 городов,/ }).click();
  await expect(page.locator(".country-overview")).toHaveAttribute("data-country-ready", "true");
  await page.getByRole("button", { name: /^Открыть город Город двадцати спринтов,/ }).click(); await ready(page);
  await center(page, examples[2]!); await page.screenshot({ path: `${directory}/city-mobile.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  for (const endpoint of ["/scene", "/overview", "/planet-atlas"]) expect(reads.filter(p => p.endsWith(endpoint))).toHaveLength(1);
  expect(reads.filter(p => /\/world\/viewport|\/chunks\//.test(p))).toEqual([]); expect(errors).toEqual([]);
  await info.attach("compact-release-evidence", { body: JSON.stringify({ sceneRevision: scene.sceneRevision, firstReadyMs,
    sceneBytes: Buffer.byteLength(JSON.stringify(scene)), chunks: scene.chunks.length, tasks: tasks.length, districts: 20,
    taskOpenMs: taskTimes, reads, errors, examples: examples.map(t => ({ id: t.id, family: t.buildingType, stage: t.stage })) }, null, 2), contentType: "application/json" });
});

test("six newly authored service families render and open their actual tasks", async ({ page }, info) => {
  test.setTimeout(120_000);
  const output = "screenshots/compact-rc-service-art";
  await mkdir(output, { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("response", response => { if (response.status() >= 400) errors.push(`${response.status()} ${new URL(response.url()).pathname}`); });
  expect((await page.request.post("/api/auth/login", { data: { email: "demo@tasktopia.local", password: "tasktopia-demo" } })).status()).toBe(200);
  const loaded = page.waitForResponse(r => /\/cities\/[^/]+\/scene$/.test(new URL(r.url()).pathname));
  await page.goto("/");
  const scene = await (await loaded).json() as CitySceneDto;
  await ready(page);
  const tasks = [...new Map([...scene.chunks.flatMap(c => c.tasks), ...scene.completedDistrictSnapshots.flatMap(s => s.tasks)].map(t => [t.id, t])).values()];
  await page.locator("canvas[aria-label='Интерактивная карта города']").hover(); await page.mouse.wheel(0, -600);
  await expect.poll(async () => Number(await page.locator(".world-canvas").getAttribute("data-render-scale"))).toBeGreaterThan(1.5);
  const examples = [];
  for (const family of ["police", "school", "shop", "railway", "airport", "civic"]) {
    const key = `compact-${family}-v1`;
    const task = tasks.find(task => task.buildingType === key && task.stage === 5);
    expect(task, `Completed authored ${key}, not a structural service fallback`).toBeTruthy();
    const point = await center(page, task!);
    const detail = page.waitForResponse(r => new URL(r.url()).pathname === `/api/tasks/${task!.id}`);
    await page.mouse.click(point.x, point.y); expect((await detail).status()).toBe(200);
    await expect(page.getByRole("dialog").locator("#task-title")).toHaveText(task!.title);
    await page.getByRole("button", { name: "Закрыть", exact: true }).click(); await expect(page.locator(".task-modal")).toHaveCount(0);
    await page.mouse.move(12, 15);
    await page.screenshot({ path: `${output}/${key}.png` });
    examples.push({ key, taskId: task!.id, stage: task!.stage, role: task!.serviceRole });
  }
  expect(errors).toEqual([]);
  await info.attach("service-art", { body: JSON.stringify({ examples, errors }), contentType: "application/json" });
});

test("whole20sprint city fits one review capture without changing its geography", async ({ page }) => {
  test.setTimeout(90_000);
  await mkdir(directory, { recursive: true });
  await page.setViewportSize({ width: 3000, height: 2700 });
  expect((await page.request.post("/api/auth/login", { data: { email: "demo@tasktopia.local", password: "tasktopia-demo" } })).status()).toBe(200);
  const loaded = page.waitForResponse(r => /\/cities\/[^/]+\/scene$/.test(new URL(r.url()).pathname));
  await page.goto("/"); const scene = await (await loaded).json() as CitySceneDto; await ready(page);
  expect(scene.city.name).toBe("Город двадцати спринтов");
  const host = page.locator(".world-canvas");
  const minimum = Number(await host.getAttribute("data-minimum-render-scale"));
  // Reaching the exact minimum intentionally opens COUNTRY; stop just above
  // that public navigation threshold to review the complete CITY instead.
  const targetScale = minimum + .025;
  const currentScale = Number(await host.getAttribute("data-render-scale"));
  if (currentScale > targetScale) {
    await page.locator("canvas[aria-label='Интерактивная карта города']").hover();
    await page.mouse.wheel(0, Math.log(currentScale / targetScale) / .0015);
    await expect.poll(async () => Number(await host.getAttribute("data-render-scale"))).toBeCloseTo(targetScale, 2);
  }
  await center(page, { footprint: [{ x: scene.city.bounds.minX, y: scene.city.bounds.minY },
    { x: scene.city.bounds.maxX, y: scene.city.bounds.maxY }] }, true);
  await expect(host).toHaveAttribute("data-ground-bake-queue", "0");
  await page.mouse.move(10, 15);
  await page.screenshot({ path: `${directory}/city-whole.png`, fullPage: true });
  await page.getByRole("button", { name: "Районы", exact: true }).click();
  await page.screenshot({ path: `${directory}/districts-whole.png`, fullPage: true });
});
