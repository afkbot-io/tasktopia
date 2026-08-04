import { expect, test, type Page } from "@playwright/test";

const captureReleaseScreenshots = process.env.E2E_CAPTURE_SCREENSHOTS === "true";
async function capture(page: Page, path: string): Promise<void> {
  if (captureReleaseScreenshots) await page.screenshot({ path, fullPage: true });
}

test("login, map and MCP token management", async ({ page }) => {
  test.setTimeout(240_000);
  const consoleErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  await page.goto("/");
  await page.getByLabel("Email").fill("demo@tasktopia.local");
  await page.getByLabel("Пароль").fill("tasktopia-demo");
  await page.getByRole("button", { name: "Открыть страну" }).click();
  await expect(page.getByText("Riverside", { exact: true })).toBeVisible();
  await expect(page.locator("canvas[aria-label='Интерактивная карта страны']")).toBeVisible();
  const mapWarmup = { timeout: 90_000 };
  const mapHost = page.locator(".world-canvas");
  await expect.poll(async () => Number(await mapHost.getAttribute("data-resident-chunks")), mapWarmup).toBeGreaterThan(0);
  await expect.poll(async () => await mapHost.getAttribute("data-map-lod"), mapWarmup).toMatch(/^(overview|detail)$/);
  const initialLod = await mapHost.getAttribute("data-map-lod");
  if (initialLod === "overview") {
    expect(Number(await mapHost.getAttribute("data-cars"))).toBe(0);
    expect(Number(await mapHost.getAttribute("data-walkers"))).toBe(0);
  } else {
    expect(Number(await mapHost.getAttribute("data-cars"))).toBeGreaterThan(0);
    expect(Number(await mapHost.getAttribute("data-walkers"))).toBeGreaterThan(0);
  }
  const districtsToggle = page.getByRole("button", { name: "Районы" });
  await expect(districtsToggle).toHaveAttribute("aria-pressed", "false");
  // The anonymous bootstrap request is expected to return 401 before login.
  consoleErrors.length = 0;
  await capture(page, "screenshots/release-city-desktop.png");
  await districtsToggle.click();
  await expect(districtsToggle).toHaveAttribute("aria-pressed", "true");
  await capture(page, "screenshots/release-city-districts.png");
  await districtsToggle.click();

  const canvas = page.locator("canvas[aria-label='Интерактивная карта страны']");
  await page.getByRole("button", { name: "План" }).click();
  let cityDirectory = page.getByRole("complementary", { name: "План страны" });
  await expect(cityDirectory.getByText("20 задач")).toBeVisible();
  await cityDirectory.getByRole("button", { name: /^Тестовый район 1 / }).click();
  await cityDirectory.getByRole("button", { name: /Задача района 1\.1/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await capture(page, "screenshots/release-task-modal.png");
  await page.getByRole("button", { name: "Закрыть", exact: true }).click();
  await cityDirectory.getByRole("button", { name: "Закрыть план" }).click();

  await canvas.hover();
  for (let step = 0; step < 8; step += 1) await page.mouse.wheel(0, 800);
  await expect(mapHost).toHaveAttribute("data-map-lod", "overview");
  await expect.poll(async () => Number(await mapHost.getAttribute("data-resident-chunks")), mapWarmup).toBeGreaterThan(0);
  await expect(mapHost).toHaveAttribute("data-cars", "0");
  await expect(mapHost).toHaveAttribute("data-walkers", "0");
  const residentChunks = Number(await mapHost.getAttribute("data-resident-chunks"));
  expect(residentChunks).toBeLessThanOrEqual(36);
  await capture(page, "screenshots/release-city-zoomed-out.png");

  await page.getByRole("button", { name: "План" }).click();
  cityDirectory = page.getByRole("complementary", { name: "План страны" });
  await expect(cityDirectory).toBeVisible();
  await expect(cityDirectory.getByText("20 задач")).toBeVisible();
  await capture(page, "screenshots/release-city-directory.png");
  await cityDirectory.getByRole("button", { name: /^Тестовый район 1 / }).click();
  await expect(cityDirectory.getByText(/Задача района 1\.1/)).toBeVisible();
  await capture(page, "screenshots/release-plan-tasks.png");
  await cityDirectory.getByRole("button", { name: "Закрыть план" }).click();

  await page.getByTitle("MCP-интеграции").click();
  await expect(page.getByRole("heading", { name: "Аккаунт и MCP" })).toBeVisible();
  await page.getByRole("button", { name: "Перевыпустить" }).click();
  await expect(page.getByText("Скопируйте сейчас")).toBeVisible();
  await page.getByRole("button", { name: "Закрыть" }).click();
  await page.locator(".country-title-button").click();
  await expect(page.getByRole("heading", { name: "Страны и палата" })).toBeVisible();
  await expect(page.getByText("Основатель").first()).toBeVisible();
  await capture(page, "screenshots/release-countries-chamber.png");
  await page.getByRole("button", { name: "Закрыть" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(canvas).toBeVisible();
  await capture(page, "screenshots/release-city-mobile.png");
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
