import { expect, test, type Page } from "@playwright/test";

const captureReleaseScreenshots = process.env.E2E_CAPTURE_SCREENSHOTS === "true";
async function capture(page: Page, path: string): Promise<void> {
  if (captureReleaseScreenshots) await page.screenshot({ path, fullPage: true });
}

test("public AI integration guide is directly accessible", async ({ request }) => {
  const response = await request.get("/ai.md");
  expect(response.ok()).toBe(true);
  expect(response.headers()["content-type"]).toContain("text/markdown");
  const guide = await response.text();
  expect(guide).toContain("https://tasktopia.online/mcp");
  expect(guide).toContain('"Authorization": "Bearer <PERSONAL_MCP_KEY>"');
  expect(guide).toContain("`country.get_current`");
  expect(guide).toContain("`task.report_progress`");
  const favicon = await request.get("/favicon.svg");
  expect(favicon.ok()).toBe(true);
  expect(favicon.headers()["content-type"]).toContain("image/svg+xml");
  const manifest = await request.get("/site.webmanifest");
  expect(manifest.ok()).toBe(true);
  expect((await manifest.json()).name).toBe("Tasktopia — цифровая страна");
});

test("login, map and MCP token management", async ({ page, context }) => {
  test.setTimeout(240_000);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" || (message.type() === "warning" && message.text().includes("PixiJS Warning"))) consoleErrors.push(message.text());
  });
  await page.goto("/");
  await expect(page).toHaveTitle("Tasktopia — цифровая страна");
  await expect(page.locator("body")).not.toContainText(/проект|команда/i);
  await page.getByLabel("Email").fill("demo@tasktopia.local");
  await page.getByLabel("Пароль").fill("tasktopia-demo");
  await page.getByRole("button", { name: "Открыть страну" }).click();
  await expect(page).toHaveTitle("Tasktopia — Тестовая страна");
  await expect(page.getByText("Riverside", { exact: true })).toBeVisible();
  await expect(page.getByText("Районов строится · 1", { exact: true })).toBeVisible();
  await expect(page.getByText("Зданий строится · 20", { exact: true })).toBeVisible();
  await expect(page.locator("canvas[aria-label='Интерактивная карта страны']")).toBeVisible();
  const mapWarmup = { timeout: 90_000 };
  const mapHost = page.locator(".world-canvas");
  await expect(page.getByText("Готовим карту…", { exact: true })).toBeHidden({ timeout: 90_000 });
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
  const districtsToggle = page.getByRole("button", { name: "Границы" });
  await expect(districtsToggle).toHaveAttribute("aria-pressed", "false");
  // The anonymous bootstrap request is expected to return 401 before login.
  consoleErrors.length = 0;
  await capture(page, "screenshots/release-city-desktop.png");
  await districtsToggle.click();
  await expect(districtsToggle).toHaveAttribute("aria-pressed", "true");
  await capture(page, "screenshots/release-city-districts.png");
  await districtsToggle.click();

  const canvas = page.locator("canvas[aria-label='Интерактивная карта страны']");
  const planToggle = page.getByRole("button", { name: "План", exact: true });
  await expect(planToggle).toHaveAttribute("aria-pressed", "false");
  await planToggle.click();
  await expect(planToggle).toHaveAttribute("aria-pressed", "true");
  let cityDirectory = page.getByRole("complementary", { name: "План страны" });
  await expect(cityDirectory.getByText("20 зданий")).toBeVisible();
  await cityDirectory.getByRole("button", { name: /^Тестовый район 1 / }).click();
  await cityDirectory.getByRole("button", { name: /Задача района 1\.1/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await capture(page, "screenshots/release-task-modal.png");
  await page.getByRole("button", { name: "Закрыть", exact: true }).click();
  await expect(cityDirectory).toBeHidden();

  await canvas.hover();
  for (let step = 0; step < 8; step += 1) await page.mouse.wheel(0, 800);
  await expect(mapHost).toHaveAttribute("data-map-lod", "overview");
  await expect.poll(async () => Number(await mapHost.getAttribute("data-resident-chunks")), mapWarmup).toBeGreaterThan(0);
  await expect(mapHost).toHaveAttribute("data-cars", "0");
  await expect(mapHost).toHaveAttribute("data-walkers", "0");
  const residentChunks = Number(await mapHost.getAttribute("data-resident-chunks"));
  expect(residentChunks).toBeLessThanOrEqual(36);
  await capture(page, "screenshots/release-city-zoomed-out.png");

  await page.getByRole("button", { name: "План", exact: true }).click();
  cityDirectory = page.getByRole("complementary", { name: "План страны" });
  await expect(cityDirectory).toBeVisible();
  await expect(cityDirectory.getByText("20 зданий")).toBeVisible();
  await capture(page, "screenshots/release-city-directory.png");
  await cityDirectory.getByRole("button", { name: /^Тестовый район 1 / }).click();
  await expect(cityDirectory.getByText(/Задача района 1\.1/)).toBeVisible();
  await capture(page, "screenshots/release-plan-tasks.png");
  await cityDirectory.getByRole("button", { name: "Закрыть план" }).click();

  await page.getByTitle("MCP-интеграции").click();
  await expect(page.getByRole("heading", { name: "Аккаунт и интеграции" })).toBeVisible();
  const endpoint = `${new URL(page.url()).origin}/mcp`;
  const aiGuide = `${new URL(page.url()).origin}/ai.md`;
  await expect(page.getByText(endpoint, { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Открыть ai.md" })).toHaveAttribute("href", aiGuide);
  await page.getByRole("button", { name: "Копировать ссылку" }).click();
  await expect(page.getByRole("button", { name: "Ссылка скопирована" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(aiGuide);
  await expect(page.getByText("Streamable HTTP", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Копировать URL" }).click();
  await expect(page.getByRole("button", { name: "Скопировано" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(endpoint);
  await capture(page, "screenshots/release-mcp-settings.png");
  await page.getByRole("button", { name: /Создать ключ|Заменить ключ/ }).click();
  await expect(page.getByText("Ключ готов")).toBeVisible();
  await page.getByRole("button", { name: "Скопировать ключ" }).click();
  await expect(page.getByRole("button", { name: "Ключ скопирован" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/^ttp_mcp_/);
  await page.getByRole("button", { name: "Отозвать", exact: true }).click();
  await expect(page.getByRole("button", { name: "Отозвать", exact: true })).toHaveCount(0);
  await expect(page.getByText("Отозван", { exact: true }).last()).toBeVisible();
  const settingsHeader = await page.locator(".settings-header").boundingBox();
  expect(settingsHeader?.y).toBeGreaterThanOrEqual(0);
  await page.getByRole("button", { name: "Профиль" }).click();
  await expect(page.getByLabel("Имя и фамилия")).toBeVisible();
  await page.getByRole("button", { name: "MCP-интеграция" }).click();
  await expect(page.getByRole("heading", { name: "Подключите MCP-клиент" })).toBeVisible();
  await page.getByRole("button", { name: "Закрыть" }).click();
  await page.locator(".country-title-button").click();
  const countrySwitcher = page.getByRole("dialog", { name: "Выбор страны" });
  await expect(countrySwitcher).toBeVisible();
  await expect(countrySwitcher.getByText("Глава страны", { exact: false }).first()).toBeVisible();
  await countrySwitcher.getByRole("button", { name: "Редактировать страну" }).click();
  await expect(page.getByRole("dialog", { name: "Тестовая страна" })).toBeVisible();
  await capture(page, "screenshots/release-country-government.png");
  await page.getByLabel("Название").fill("Тестовая страна 2");
  await page.getByRole("button", { name: "Сохранить название" }).click();
  await expect(page.locator(".country-title-button")).toContainText("Тестовая страна 2");
  await page.getByRole("button", { name: "Закрыть" }).click();

  await page.locator(".country-title-button").click();
  await countrySwitcher.getByRole("button", { name: /Новая страна/ }).click();
  await page.getByLabel("Название страны").fill("Временная страна");
  await page.getByRole("button", { name: "Создать страну" }).click();
  await expect(page.locator(".country-title-button")).toContainText("Временная страна");
  await page.getByRole("button", { name: "План", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "План страны" }).getByText("Нет городов", { exact: true })).toBeVisible();
  await page.locator(".map-region").click({ position: { x: 20, y: 20 } });
  await expect(page.getByRole("complementary", { name: "План страны" })).toBeHidden();
  await page.locator(".country-title-button").click();
  await countrySwitcher.getByRole("button", { name: "Редактировать страну" }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Удалить страну" }).click();
  await expect(page.locator(".country-title-button")).toContainText("Тестовая страна 2");
  await expect(canvas).toBeVisible();

  await page.locator(".country-title-button").click();
  await expect(countrySwitcher).toBeVisible();
  await canvas.click({ position: { x: 40, y: 40 } });
  await expect(countrySwitcher).toBeHidden();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(canvas).toBeVisible();
  await expect(page.getByRole("button", { name: "План", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Границы" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await capture(page, "screenshots/release-city-mobile.png");
  await page.getByRole("button", { name: "MCP-интеграции" }).click();
  await expect(page.getByRole("heading", { name: "Подключите MCP-клиент" })).toBeVisible();
  await capture(page, "screenshots/release-mcp-mobile.png");
  await page.getByRole("button", { name: "Профиль" }).click();
  await page.getByRole("button", { name: "Выйти из аккаунта" }).click();
  await expect(page.getByRole("button", { name: "Открыть страну" })).toBeVisible();
  expect(consoleErrors).toEqual([]);
});

test("registration creates the named country and first city", async ({ page }) => {
  const email = `new-mayor-${Date.now()}@example.test`;
  await page.goto("/");
  await page.getByRole("button", { name: "Нет аккаунта? Зарегистрироваться" }).click();
  await page.getByLabel("Имя", { exact: true }).fill("New Mayor");
  await page.getByLabel("Название вашей первой страны").fill("Новый продукт");
  await page.getByLabel("Название первого города").fill("Первый релиз");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Пароль").fill("safe-password-123");
  await page.getByRole("button", { name: "Создать аккаунт" }).click();
  await expect(page.getByText("Новый продукт", { exact: true })).toBeVisible();
  await expect(page.getByText("Первый релиз", { exact: true })).toBeVisible();
  await expect(page.locator("canvas[aria-label='Интерактивная карта страны']")).toBeVisible();
  await capture(page, "screenshots/release-onboarding-city.png");
});
