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
  await expect(modal.getByRole("alert")).toHaveText("Архив временно недоступен");
  expect((await new AxeBuilder({ page }).include(".archive-record-modal").withTags(["wcag2a", "wcag2aa"]).analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath("archive-error.png") });
  await page.keyboard.press("Escape");
  await page.unroute(`**/api/archive/records/${record.id}`);
  // Escape closes the underlying drawer together with the record in the current flow.
  await openMapCity(page);
  const world = page.locator(".world-canvas");
  await expect(world).toHaveAttribute("data-city-scene-commit", "atomic");
  const canvas = page.locator("canvas[aria-label='Интерактивная карта города']");
  const box = (await canvas.boundingBox())!;
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const x = task.origin.x + 3, y = task.origin.y + 2;
  const scale = Number(await world.getAttribute("data-render-scale"));
  const cameraX = Number(await world.getAttribute("data-camera-world-x")), cameraY = Number(await world.getAttribute("data-camera-world-y"));
  await page.mouse.move(center.x, center.y); await page.mouse.down();
  await page.mouse.move(center.x + (cameraX - x) * 8 * scale, center.y + (cameraY - y) * 8 * scale, { steps: 10 }); await page.mouse.up();
  await page.waitForTimeout(520); // Documented 500 ms suppression after a pan gesture.
  const currentX = Number(await world.getAttribute("data-camera-world-x")), currentY = Number(await world.getAttribute("data-camera-world-y"));
  await page.mouse.click(center.x + (x - currentX) * 8 * scale, center.y + (y - currentY) * 8 * scale);
  await expect(page.getByRole("dialog", { name: "Задача удалена" })).toBeVisible();
  expect((await new AxeBuilder({ page }).include(".site-history-modal").withTags(["wcag2a", "wcag2aa"]).analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath("site-history-mobile.png") });
  await page.keyboard.press("Escape");
  await expect(page.locator(".site-history-modal")).toHaveCount(0);
});
