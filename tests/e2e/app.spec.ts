import { expect, test } from "@playwright/test";
import { countryViewBounds, fitCameraScale, minimumCameraScale } from "../../src/client/world-camera";

test("login, map and MCP token management", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  await page.goto("/");
  await page.getByLabel("Email").fill("demo@tasktopia.local");
  await page.getByLabel("Пароль").fill("tasktopia-demo");
  await page.getByRole("button", { name: "Открыть страну" }).click();
  await expect(page.getByText("Riverside", { exact: true })).toBeVisible();
  await expect(page.locator("canvas[aria-label='Интерактивная карта страны']")).toBeVisible();
  const mapWarmup = { timeout: 30_000 };
  await expect.poll(async () => Number(await page.locator(".world-canvas").getAttribute("data-resident-chunks")), mapWarmup).toBeGreaterThan(0);
  await expect.poll(async () => Number(await page.locator(".world-canvas").getAttribute("data-cars")), mapWarmup).toBeGreaterThan(0);
  await expect.poll(async () => Number(await page.locator(".world-canvas").getAttribute("data-walkers")), mapWarmup).toBeGreaterThan(0);
  const districtsToggle = page.getByRole("button", { name: "Районы" });
  await expect(districtsToggle).toHaveAttribute("aria-pressed", "false");
  // The anonymous bootstrap request is expected to return 401 before login.
  consoleErrors.length = 0;
  await page.screenshot({ path: "screenshots/mvp-city-desktop.png", fullPage: true });
  await districtsToggle.click();
  await expect(districtsToggle).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({ path: "screenshots/mvp-city-districts.png", fullPage: true });
  await districtsToggle.click();

  const canvas = page.locator("canvas[aria-label='Интерактивная карта страны']");
  const state = await page.evaluate(async () => (await fetch("/api/bootstrap")).json());
  const task = state.tasks[0];
  const city = state.cities.find((item: { id: string }) => item.id === task.cityId);
  const districtCells = state.districts.filter((item: { cityId: string }) => item.cityId === city.id).flatMap((item: { cells: Array<{ x: number; y: number }> }) => item.cells);
  const focusBounds = {
    minX: Math.min(...districtCells.map((cell: { x: number }) => cell.x)) - 4,
    minY: Math.min(...districtCells.map((cell: { y: number }) => cell.y)) - 12,
    maxX: Math.max(...districtCells.map((cell: { x: number }) => cell.x)) + 4,
    maxY: Math.max(...districtCells.map((cell: { y: number }) => cell.y)) + 4,
  };
  const focus = {
    x: (focusBounds.minX + focusBounds.maxX + 1) / 2,
    y: (focusBounds.minY + focusBounds.maxY + 1) / 2,
  };
  const footprintWidth = Math.max(...task.footprint.map((cell: { x: number }) => cell.x)) - task.origin.x + 1;
  const footprintHeight = Math.max(...task.footprint.map((cell: { y: number }) => cell.y)) - task.origin.y + 1;
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const screen = { width: box!.width, height: box!.height };
  const scale = Math.max(
    fitCameraScale(screen, focusBounds, 8),
    minimumCameraScale(screen, countryViewBounds(state.cities), 8),
  );
  await canvas.click({ position: {
    x: box!.width / 2 + (task.origin.x + footprintWidth / 2 - focus.x) * 8 * scale,
    y: box!.height / 2 + (task.origin.y + footprintHeight - focus.y) * 8 * scale - 4,
  } });
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.screenshot({ path: "screenshots/mvp-task-modal.png", fullPage: true });
  await page.getByRole("button", { name: "Закрыть" }).click();

  await canvas.hover();
  for (let step = 0; step < 8; step += 1) await page.mouse.wheel(0, 800);
  const mapHost = page.locator(".world-canvas");
  await expect.poll(async () => Number(await mapHost.getAttribute("data-resident-chunks"))).toBeGreaterThanOrEqual(30);
  const residentChunks = Number(await mapHost.getAttribute("data-resident-chunks"));
  expect(residentChunks).toBeLessThan(200);
  await page.screenshot({ path: "screenshots/mvp-city-zoomed-out.png", fullPage: true });

  await page.getByRole("button", { name: "План" }).click();
  const cityDirectory = page.getByRole("complementary", { name: "План страны" });
  await expect(cityDirectory).toBeVisible();
  await expect(cityDirectory.getByText("200 задач")).toBeVisible();
  await expect(cityDirectory.getByText("60 задач")).toBeVisible();
  await expect(cityDirectory.getByText("50 задач")).toBeVisible();
  await expect(cityDirectory.getByText("40 задач")).toBeVisible();
  await page.screenshot({ path: "screenshots/mvp-city-directory.png", fullPage: true });
  await cityDirectory.getByRole("button", { name: /^Квартал Риверсайда 1 Завершён/ }).click();
  await expect(cityDirectory.getByText(/Подготовить секцию/).first()).toBeVisible();
  await page.screenshot({ path: "screenshots/mvp-plan-tasks.png", fullPage: true });
  await cityDirectory.getByRole("button", { name: /Harborview/ }).click();
  await expect(page.getByText("Harborview", { exact: true })).toBeVisible();
  await expect(canvas).toBeVisible();
  await expect.poll(async () => Number(await page.locator(".world-canvas").getAttribute("data-resident-chunks"))).toBeGreaterThan(0);
  await page.screenshot({ path: "screenshots/mvp-harborview.png", fullPage: true });

  await page.getByRole("button", { name: "План" }).click();
  await page.getByRole("complementary", { name: "План страны" }).getByRole("button", { name: /Pinegate/ }).click();
  await expect(page.getByText("Pinegate", { exact: true })).toBeVisible();
  await expect.poll(async () => Number(await page.locator(".world-canvas").getAttribute("data-resident-chunks"))).toBeGreaterThan(0);
  await page.screenshot({ path: "screenshots/mvp-pinegate.png", fullPage: true });

  await page.getByTitle("MCP-интеграции").click();
  await expect(page.getByRole("heading", { name: "Аккаунт и MCP" })).toBeVisible();
  await page.getByRole("button", { name: "Перевыпустить" }).click();
  await expect(page.getByText("Скопируйте сейчас")).toBeVisible();
  await page.getByRole("button", { name: "Закрыть" }).click();
  await page.locator(".country-title-button").click();
  await expect(page.getByRole("heading", { name: "Страны и палата" })).toBeVisible();
  await expect(page.getByText("Основатель").first()).toBeVisible();
  await page.screenshot({ path: "screenshots/mvp-countries-chamber.png", fullPage: true });
  await page.getByRole("button", { name: "Закрыть" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(canvas).toBeVisible();
  await page.screenshot({ path: "screenshots/mvp-city-mobile.png", fullPage: true });
  expect(consoleErrors).toEqual([]);
});

test("registration automatically creates an empty country", async ({ page }) => {
  const email = `new-mayor-${Date.now()}@example.test`;
  await page.goto("/");
  await page.getByRole("button", { name: "Нет аккаунта? Зарегистрироваться" }).click();
  await page.getByLabel("Имя").fill("New Mayor");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Пароль").fill("safe-password-123");
  await page.getByRole("button", { name: "Создать аккаунт" }).click();
  await expect(page.getByRole("heading", { name: "Создайте первый город через MCP" })).toBeVisible();
  await page.getByTitle("Настройки аккаунта").click();
  await expect(page.getByText(email)).toBeVisible();
  await expect(page.locator("canvas[aria-label='Интерактивная карта страны']")).toBeVisible();
});
