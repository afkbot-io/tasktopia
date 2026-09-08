import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import type { BootstrapDto, TaskDto, WorldFeatureDto } from "../../src/shared/contracts";
import { CITY_SCENE_SCHEMA_VERSION, type CitySceneDto } from "../../src/shared/city-scene-contract";
import { taskLink } from "../../src/client/task-navigation";

test.skip(process.env.E2E_PERMANENT_SITE_FIXTURE !== "true", "Explicit isolated local mutable compact fixture only");
const screenshots = process.env.COMPACT_NEXT_SCREENSHOTS;

async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("Email").fill("demo@tasktopia.local");
  await page.getByLabel("Пароль").fill("tasktopia-demo");
  await page.getByRole("button", { name: "Открыть страну" }).click();
  await expect(page.locator(".world-canvas")).toHaveAttribute("data-city-scene-commit", "atomic", { timeout: 60_000 });
  return (await (await page.request.get("/api/bootstrap")).json()) as BootstrapDto;
}
async function scene(page: Page, bootstrap: BootstrapDto) {
  const response = await page.request.get(`/api/countries/${bootstrap.country.id}/cities/${bootstrap.initialCity!.id}/scene`, {
    headers: { accept: `application/vnd.tasktopia.city-scene+json; version=${CITY_SCENE_SCHEMA_VERSION}` },
  });
  expect(response.ok()).toBe(true);
  return await response.json() as CitySceneDto;
}
async function point(page: Page, x: number, y: number) {
  const host = page.locator(".world-canvas");
  const canvas = page.locator("canvas[aria-label='Интерактивная карта города']");
  const box = (await canvas.boundingBox())!;
  const position = async () => ({
    scale: Number(await host.getAttribute("data-render-scale")),
    x: Number(await host.getAttribute("data-camera-world-x")),
    y: Number(await host.getAttribute("data-camera-world-y")),
  });
  const before = await position();
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(center.x, center.y); await page.mouse.down();
  await page.mouse.move(center.x + (before.x - x) * 8 * before.scale, center.y + (before.y - y) * 8 * before.scale, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(520); // Public pan gesture suppresses selection for 500ms; not data readiness.
  const current = await position();
  return { x: center.x + (x - current.x) * 8 * current.scale, y: center.y + (y - current.y) * 8 * current.scale };
}
async function clickSite(page: Page, feature: WorldFeatureDto) {
  const p = await point(page, feature.origin.x + 3, feature.origin.y + 2);
  await screenshot(page, `${feature.siteMarker!.kind.toLowerCase()}-site`);
  await page.mouse.click(p.x, p.y);
  await expect(page.getByRole("dialog", { name: /Задача (перенесена|удалена)/ })).toBeVisible();
}
async function screenshot(page: Page, name: string) {
  if (!screenshots) return;
  await mkdir(screenshots, { recursive: true });
  await page.screenshot({ path: `${screenshots}/${name}.png`, fullPage: true });
}

test("API transfer leaves clickable MOVE without a task-modal transfer control; deletion retains both occupied historical sites", async ({ page }, info) => {
  test.setTimeout(120_000);
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  const bootstrap = await login(page);
  const initial = await scene(page, bootstrap);
  const previousMarkers = [...new Map(initial.chunks.flatMap(chunk => chunk.worldFeatures)
    .filter(feature => feature.siteMarker).map(feature => [feature.id, feature])).values()];
  const original = initial.chunks.flatMap(chunk => chunk.tasks).find(task => task.taskNumber === 1)!;
  await page.goto(taskLink(bootstrap.country.id, original));
  await expect(page.locator("#task-title")).toContainText(original.title);
  await expect(page.getByRole("button", { name: "Перенести в другой спринт" })).toHaveCount(0);
  const targetDistrictId = initial.chunks.flatMap(chunk => chunk.districts).find(d => d.id !== original.districtId)!.id;
  const response = await page.request.post(`/api/tasks/${original.id}/transfer`, {
    data: { targetDistrictId, idempotencyKey: randomUUID() },
  });
  expect(response.status(), await response.text()).toBe(200);
  const moved = await response.json() as TaskDto;
  expect(moved).toMatchObject({ id: original.id, taskNumber: original.taskNumber, status: original.status, progress: original.progress });
  expect(moved.districtId).not.toBe(original.districtId);
  await expect(page.locator(".task-transfer-panel")).toHaveCount(0);
  await page.getByRole("button", { name: "Закрыть", exact: true }).click();
  await expect(page.locator(".world-canvas")).toHaveAttribute("data-moved-sites", String(previousMarkers.filter(feature => feature.siteMarker?.kind === "RELOCATED").length + 1));
  const marker = (await scene(page, bootstrap)).chunks.flatMap(chunk => chunk.worldFeatures)
    .find(feature => feature.siteMarker?.kind === "RELOCATED" && feature.siteMarker.snapshot.taskNumber === original.taskNumber)!;
  expect(marker.origin).toEqual(original.origin);
  await clickSite(page, marker);
  await expect(page.locator(".site-history-modal")).toContainText(original.title);
  await screenshot(page, "move-history");
  const resolveResponse = page.waitForResponse(response => response.url().includes(`/api/tasks/resolve?id=${original.id}`));
  await page.getByRole("button", { name: "Открыть текущую задачу" }).click();
  expect((await (await resolveResponse).json()).origin).toEqual(moved.origin);
  await expect(page.locator("#task-title")).toContainText(original.title);
  await page.getByRole("button", { name: "Закрыть", exact: true }).click();

  // Real authenticated deletion contract; site selection remains a physical
  // canvas click, never an injected React/Pixi callback or screenshot mockup.
  const deletion = await page.request.delete(`/api/tasks/${moved.id}`, { data: { confirmTitle: moved.title, idempotencyKey: `site-delete-${moved.id}` } });
  expect(deletion.status(), await deletion.text()).toBe(200);
  await expect(page.locator(".world-canvas")).toHaveAttribute("data-site-markers", String(previousMarkers.length + 2));
  const after = await scene(page, bootstrap);
  const ruined = after.chunks.flatMap(chunk => chunk.worldFeatures).find(feature => feature.siteMarker?.kind === "RUINED" && feature.siteMarker.snapshot.taskNumber === moved.taskNumber)!;
  expect(ruined.origin).toEqual(moved.origin);
  expect(after.chunks.flatMap(chunk => chunk.tasks).some(task => task.id === moved.id)).toBe(false);
  await clickSite(page, ruined);
  await expect(page.locator(".site-history-modal")).toContainText("Новые постройки здесь не размещаются");
  await expect(page.getByRole("button", { name: "Открыть текущую задачу" })).toHaveCount(0);
  await screenshot(page, "ruin-history");
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(page.locator(".world-canvas")).toHaveAttribute("data-site-markers", String(previousMarkers.length + 2), { timeout: 60_000 });
  await clickSite(page, marker);
  await expect(page.getByRole("button", { name: "Открыть текущую задачу" })).toHaveCount(0);
  expect(errors).toEqual([]);
  await info.attach("permanent-sites", { body: JSON.stringify({ original: original.origin, moved: moved.origin, taskId: moved.id, markerId: marker.id, ruinId: ruined.id, errors }), contentType: "application/json" });
});

test("HOTFIX verification is quiet; active compact construction has bounded effects that clean up", async ({ page }) => {
  const run = randomUUID();
  const errors: string[] = []; const assets: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (request.url().includes("/game-assets/")) assets.push(request.url()); });
  const bootstrap = await login(page);
  const tasks = (await scene(page, bootstrap)).chunks.flatMap(chunk => chunk.tasks);
  const original = tasks.find(task => task.visualKind === "BUILDING" && task.status === "TESTING")!;
  const activeTask = tasks.find(task => task.visualKind === "BUILDING" && task.status === "IN_PROGRESS")!;
  expect(original).toBeDefined();
  expect(activeTask).toBeDefined();
  const edit = await page.request.patch(`/api/tasks/${original.id}`, { data: { workItemType: "HOTFIX", idempotencyKey: `incident-type-${run}-${original.id}` } });
  expect(edit.status(), await edit.text()).toBe(200);
  const host = page.locator(".world-canvas");
  await expect(host).toHaveAttribute("data-incident-modes", "HOTFIX_VERIFYING");
  await expect(host).toHaveAttribute("data-incident-fires", "0");
  const active = await page.request.patch(`/api/tasks/${activeTask.id}`, { data: { workItemType: "HOTFIX", idempotencyKey: `incident-active-${run}-${activeTask.id}` } });
  expect(active.status(), await active.text()).toBe(200);
  await expect(host).toHaveAttribute("data-incident-modes", "HOTFIX_ACTIVE,HOTFIX_VERIFYING");
  await expect(host).toHaveAttribute("data-incident-fires", "1");
  await expect(host).toHaveAttribute("data-incident-water-jets", "1");
  await point(page, activeTask.origin.x + 3, activeTask.origin.y + 3);
  await screenshot(page, "compact-hotfix-response");
  const verifying = await page.request.patch(`/api/tasks/${activeTask.id}`, { data: { workItemType: "TASK", idempotencyKey: `incident-clear-${run}-${activeTask.id}` } });
  expect(verifying.status(), await verifying.text()).toBe(200);
  await expect(host).toHaveAttribute("data-incident-modes", "HOTFIX_VERIFYING");
  await expect(host).toHaveAttribute("data-incident-fires", "0");
  await expect(host).toHaveAttribute("data-incident-water-jets", "0");
  await screenshot(page, "compact-hotfix-verification");
  expect(assets.filter(url => /incident-(flame|smoke)-/.test(url))).toEqual([]);
  expect(errors).toEqual([]);
});

test("retained MOVE and ruined sites remain selectable after a new login", async ({ page }) => {
  const bootstrap = await login(page);
  const sites = (await scene(page, bootstrap)).chunks.flatMap(chunk => chunk.worldFeatures);
  for (const kind of ["RELOCATED", "RUINED"] as const) {
    const feature = sites.find(candidate => candidate.siteMarker?.kind === kind)!;
    expect(feature).toBeDefined();
    await clickSite(page, feature);
    await expect(page.getByRole("button", { name: "Открыть текущую задачу" })).toHaveCount(0);
    await page.keyboard.press("Escape");
  }
});
