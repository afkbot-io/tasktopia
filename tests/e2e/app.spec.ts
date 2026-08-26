import { expect, test, type Page } from "@playwright/test";

const captureReleaseScreenshots = process.env.E2E_CAPTURE_SCREENSHOTS === "true";
const expectedAppOrigin = (process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173").replace(/\/$/, "");
async function capture(page: Page, path: string): Promise<void> {
  if (captureReleaseScreenshots) await page.screenshot({ path, fullPage: true });
}

test("CSP permits CDN asset fetches and the web manifest", async ({ request }) => {
  const shell = await request.get("/");
  expect(shell.ok()).toBe(true);
  const staticOrigin = (process.env.STATIC_ORIGIN ?? process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173").replace(/\/$/, "");
  const contentSecurityPolicy = shell.headers()["content-security-policy"];
  expect(contentSecurityPolicy).toContain(`connect-src 'self' ${staticOrigin}`);
  expect(contentSecurityPolicy).toContain(`manifest-src 'self' ${staticOrigin}`);
});

test("public AI integration guide is directly accessible", async ({ request }) => {
  const shell = await request.get("/");
  expect(shell.ok()).toBe(true);
  const bundlePath = (await shell.text()).match(/<script[^>]+src="([^"]*\/assets\/[^"]+\.js)"/)?.[1];
  expect(bundlePath).toBeDefined();
  const bundle = await request.get(bundlePath!);
  expect(bundle.ok()).toBe(true);
  expect(bundle.headers()["cache-control"]).toContain("immutable");
  expect(bundle.headers()["access-control-allow-origin"]).toBe(expectedAppOrigin);
  expect(bundle.headers()["cross-origin-resource-policy"]).toBe("cross-origin");
  const response = await request.get("/ai.md");
  expect(response.ok()).toBe(true);
  expect(response.headers()["content-type"]).toContain("text/markdown");
  const guide = await response.text();
  expect(guide).toContain("https://tasktopia.online/mcp");
  expect(guide).toContain('"Authorization": "Bearer <PERSONAL_MCP_KEY>"');
  expect(guide).toContain("`country.get`");
  expect(guide).toContain("`task.report_progress`");
  const skill = await request.get("/skills/tasktopia-progress/SKILL.md");
  expect(skill.ok()).toBe(true);
  expect(skill.headers()["content-type"]).toContain("text/markdown");
  expect(await skill.text()).toContain("name: tasktopia-progress");
  const favicon = await request.get("/favicon.svg");
  expect(favicon.ok()).toBe(true);
  expect(favicon.headers()["content-type"]).toContain("image/svg+xml");
  const staticManifest = await request.get("/game-assets/v5/manifest.json");
  expect(staticManifest.ok()).toBe(true);
  expect(staticManifest.headers()["access-control-allow-origin"]).toBe(expectedAppOrigin);
  expect(staticManifest.headers()["cross-origin-resource-policy"]).toBe("cross-origin");
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
  await expect(page.locator("canvas[aria-label='Интерактивная карта города']")).toBeVisible();
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
    // Ground readiness intentionally precedes dynamic-entity publication.
    // Wait for that public stream instead of sampling the first coherent frame.
    await expect.poll(async () => Number(await mapHost.getAttribute("data-cars")), { timeout: 30_000 }).toBeGreaterThan(0);
    await expect.poll(async () => Number(await mapHost.getAttribute("data-walkers")), { timeout: 30_000 }).toBeGreaterThan(0);
    expect(Number(await mapHost.getAttribute("data-walkers"))).toBeLessThanOrEqual(24);
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

  const canvas = page.locator("canvas[aria-label='Интерактивная карта города']");
  await page.locator(".country-title-button").click();
  await page.getByRole("dialog", { name: "Выбор страны" }).getByRole("button", { name: "План страны" }).click();
  let cityDirectory = page.getByRole("complementary", { name: "План страны" });
  await expect(cityDirectory.getByText(/^\d+ зданий$/)).toBeVisible();
  await cityDirectory.getByRole("button", { name: /^Тестовый район 1 / }).click();
  await cityDirectory.getByRole("button", { name: /^\d+ #1 · Задача района 1\.1/ }).click();
  const taskDialog = page.getByRole("dialog");
  await expect(taskDialog).toBeVisible();
  await expect(taskDialog.getByRole("heading", { name: "Материалы для реализации" })).toBeVisible();
  await expect(taskDialog.getByRole("tab")).toHaveCount(4);
  await taskDialog.getByRole("tab", { name: /Архитектура/ }).click();
  await expect(taskDialog.getByRole("tabpanel")).toContainText("Markdown-документы и пункты чек-листа");
  await expect(taskDialog.locator(".task-checklist li")).toHaveCount(3);
  await expect(taskDialog.locator(".task-checklist li.done")).toHaveCount(2);
  await expect(taskDialog.locator('input[type="file"]')).toHaveCount(0);
  await expect(taskDialog.getByRole("button", { name: /Удалить задачу|Добавить/ })).toHaveCount(0);
  await capture(page, "screenshots/release-task-modal.png");
  await page.getByRole("button", { name: "Закрыть", exact: true }).click();
  await expect(cityDirectory).toBeHidden();

  await canvas.hover();
  for (let step = 0; step < 8; step += 1) await page.mouse.wheel(0, 800);
  // City view stays in detail mode at the shared 0.8 minimum zoom.
  // The complete resident scene remains authoritative without a second request.
  await expect(mapHost).toHaveAttribute("data-map-lod", "detail", mapWarmup);
  await expect.poll(async () => Number(await mapHost.getAttribute("data-resident-chunks")), mapWarmup).toBeGreaterThan(0);
  await expect.poll(async () => Number(await mapHost.getAttribute("data-cars")), mapWarmup).toBeGreaterThan(0);
  await expect.poll(async () => Number(await mapHost.getAttribute("data-walkers")), mapWarmup).toBeGreaterThan(0);
  const residentChunks = Number(await mapHost.getAttribute("data-resident-chunks"));
  expect(residentChunks).toBeLessThanOrEqual(36);
  await capture(page, "screenshots/release-city-zoomed-out.png");

  await page.locator(".country-title-button").click();
  await page.getByRole("dialog", { name: "Выбор страны" }).getByRole("button", { name: "План страны" }).click();
  cityDirectory = page.getByRole("complementary", { name: "План страны" });
  await expect(cityDirectory).toBeVisible();
  await expect(cityDirectory.getByText(/^\d+ зданий$/)).toBeVisible();
  await capture(page, "screenshots/release-city-directory.png");
  await cityDirectory.getByRole("button", { name: /^Тестовый район 1 / }).click();
  await expect(cityDirectory.getByText(/Задача района 1\.1/)).toBeVisible();
  await capture(page, "screenshots/release-plan-tasks.png");
  await cityDirectory.getByRole("button", { name: "Закрыть план" }).click();

  await page.getByRole("button", { name: "Настройки аккаунта" }).click();
  await page.getByRole("button", { name: "MCP-интеграция" }).click();
  await expect(page.getByRole("heading", { name: "Аккаунт и интеграции" })).toBeVisible();
  const endpoint = `${new URL(page.url()).origin}/mcp`;
  const aiGuide = `${new URL(page.url()).origin}/ai.md`;
  const progressSkill = `${new URL(page.url()).origin}/skills/tasktopia-progress/SKILL.md`;
  await expect(page.getByText(endpoint, { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Открыть ai.md" })).toHaveAttribute("href", aiGuide);
  await expect(page.getByRole("link", { name: "Открыть skill" })).toHaveAttribute("href", progressSkill);
  await page.getByRole("button", { name: "Копировать ссылку" }).click();
  await expect(page.getByRole("button", { name: "Ссылка скопирована" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(aiGuide);
  await page.getByRole("button", { name: "Копировать skill" }).click();
  await expect(page.getByRole("button", { name: "Skill скопирован" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(progressSkill);
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
  await page.getByRole("button", { name: "Сохранить паспорт" }).click();
  await expect(page.locator(".country-title-button")).toContainText("Тестовая страна 2");
  await page.getByRole("button", { name: "Закрыть" }).click();

  await page.locator(".country-title-button").click();
  await countrySwitcher.getByRole("button", { name: /Новая страна/ }).click();
  await page.getByLabel("Название страны").fill("Временная страна");
  await page.getByRole("button", { name: "Создать страну" }).click();
  await expect(page.locator(".country-title-button")).toContainText("Временная страна");
  await page.locator(".country-title-button").click();
  await page.getByRole("dialog", { name: "Выбор страны" }).getByRole("button", { name: "План страны" }).click();
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
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(canvas).toBeVisible();
  await page.locator(".country-title-button").click();
  await expect(page.getByRole("dialog", { name: "Выбор страны" }).getByRole("button", { name: "План страны" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Границы" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await capture(page, "screenshots/release-city-mobile.png");
  await page.getByRole("button", { name: "Настройки аккаунта" }).click();
  await page.getByRole("button", { name: "MCP-интеграция" }).click();
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
  await page.getByLabel("Пароль", { exact: true }).fill("safe-password-123");
  await page.getByLabel("Повторите пароль", { exact: true }).fill("safe-password-123");
  await page.getByRole("button", { name: "Создать аккаунт" }).click();
  await expect(page.getByText("Новый продукт", { exact: true })).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText("Первый релиз", { exact: true })).toBeVisible({ timeout: 90_000 });
  await expect(page.locator("canvas[aria-label='Интерактивная карта города']")).toBeVisible({ timeout: 90_000 });
  await capture(page, "screenshots/release-onboarding-city.png");
});
