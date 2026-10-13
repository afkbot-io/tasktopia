import { execFile } from "node:child_process";
import { promisify } from "node:util";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { openMapCity } from "./map-navigation";
import type { ArchiveRecordDto, TaskDto } from "../../src/shared/contracts";

test("архив, его ошибки и история участка читаются в общей теме", async ({ page }, info) => {
  test.skip(process.env.E2E_FOREST_UI_FIXTURE !== "true", "Только отдельная локальная forest_ui_ схема");
  test.setTimeout(90_000);
  await page.request.post("/api/auth/login", { data: { email: "demo@tasktopia.local", password: "tasktopia-demo" } });
  const bootstrap = await (await page.request.get("/api/bootstrap")).json();
  const { stdout } = await promisify(execFile)(process.execPath, ["--import", "tsx", "tests/fixtures/seed-forest-ui.ts", bootstrap.country.id, bootstrap.initialCity.id]);
  const { record, task } = JSON.parse(stdout) as { record: ArchiveRecordDto; task: TaskDto };
  await page.goto("/");
  await page.getByLabel("Меню", { exact: true }).click();
  await page.getByRole("button", { name: "Архив проекта", exact: true }).click();
  await page.getByRole("button", { name: new RegExp(record.title) }).click();
  const modal = page.locator(".archive-record-modal");
  await expect(modal.getByRole("heading", { name: record.title })).toBeVisible();
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect((await new AxeBuilder({ page }).include(".archive-record-modal").withTags(["wcag2a", "wcag2aa"]).analyze()).violations).toEqual([]);
    expect(await modal.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`archive-${width}.png`) });
  }
  await page.keyboard.press("Escape");
  await page.getByLabel("Меню", { exact: true }).click();
  await page.getByRole("button", { name: "Архив проекта", exact: true }).click();
  await page.route(`**/api/archive/records/${record.id}`, route => route.fulfill({ status: 503, json: { message: "Архив временно недоступен" } }));
  await page.getByRole("button", { name: new RegExp(record.title) }).click();
  await expect(modal.getByRole("alert")).toContainText("Архив временно недоступен");
  expect((await new AxeBuilder({ page }).include(".archive-record-modal").withTags(["wcag2a", "wcag2aa"]).analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath("archive-error.png") });
  await page.keyboard.press("Escape");
  await page.unroute(`**/api/archive/records/${record.id}`);
  // The record closes independently. Finish the archive journey before panning.
  await page.getByRole("button", { name: "Закрыть список", exact: true }).click();
  await openMapCity(page);
  const world = page.locator(".world-canvas");
  await expect(world).toHaveAttribute("data-city-scene-commit", "atomic");
  await expect(page.locator(".map-level-transition")).toHaveCount(0);
  const canvas = page.locator("canvas[aria-label='Интерактивная карта города']");
  expect(await canvas.evaluate(el => Boolean(el.closest("[inert]")))).toBe(false);
  const box = (await canvas.boundingBox())!;
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const hit = await page.evaluate(p => { const el = document.elementFromPoint(p.x, p.y); return { tag: el?.tagName, class: el?.getAttribute("class") }; }, center);
  const x = task.origin.x + 3, y = task.origin.y + 2;
  // Keep each drag inside the phone viewport: a single long drag can leave the
  // browser window before reaching an outer plot and stop delivering pointers.
  for (let attempt = 0; attempt < 6; attempt++) {
    const scale = Number(await world.getAttribute("data-render-scale"));
    const cameraX = Number(await world.getAttribute("data-camera-world-x")), cameraY = Number(await world.getAttribute("data-camera-world-y"));
    const dx = (cameraX - x) * 8 * scale, dy = (cameraY - y) * 8 * scale;
    if (Math.abs(dx) < box.width / 3 && Math.abs(dy) < box.height / 3) break;
    await page.mouse.move(center.x, center.y); await page.mouse.down();
    await page.mouse.move(center.x + Math.max(-box.width / 3, Math.min(box.width / 3, dx)), center.y + Math.max(-box.height / 3, Math.min(box.height / 3, dy)), { steps: 10 }); await page.mouse.up();
    await page.waitForTimeout(60); // Camera attributes follow the next animation frame.
  }
  await page.waitForTimeout(520); // Documented 500 ms suppression after a pan gesture.
  const currentX = Number(await world.getAttribute("data-camera-world-x")), currentY = Number(await world.getAttribute("data-camera-world-y"));
  const scale = Number(await world.getAttribute("data-render-scale"));
  await info.attach("site-hit-geometry", { body: JSON.stringify({ hit, box, center, origin: task.origin, currentX, currentY, scale, click: { x: center.x + (x - currentX) * 8 * scale, y: center.y + (y - currentY) * 8 * scale } }), contentType: "application/json" });
  await page.mouse.click(center.x + (x - currentX) * 8 * scale, center.y + (y - currentY) * 8 * scale);
  await expect(page.getByRole("dialog", { name: "Задача удалена" })).toBeVisible();
  expect((await new AxeBuilder({ page }).include(".site-history-modal").withTags(["wcag2a", "wcag2aa"]).analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath("site-history-mobile.png") });
  await page.keyboard.press("Escape");
  await expect(page.locator(".site-history-modal")).toHaveCount(0);
});
