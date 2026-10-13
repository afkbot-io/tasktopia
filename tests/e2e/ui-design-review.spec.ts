import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { openMapCity } from "./map-navigation";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile } from "node:fs/promises";
import type { TaskDto } from "../../src/shared/contracts";

async function login(page: Page) {
  await page.request.post("/api/auth/login", { data: { email: "demo@tasktopia.local", password: "tasktopia-demo" } });
  await page.goto("/");
  await expect(page.getByLabel("Меню", { exact: true })).toBeVisible();
}
async function menu(page: Page, name: string) {
  await page.getByLabel("Меню", { exact: true }).click();
  await page.getByRole("button", { name, exact: true }).click();
}

test("паспорт страны возвращает клавиатурный фокус к выбору страны", async ({ page }) => {
  await login(page);
  const trigger = page.locator(".country-title-button");
  await trigger.focus();
  await trigger.press("Enter");
  const passport = page.getByRole("button", { name: "Паспорт страны", exact: true });
  await passport.focus();
  await passport.press("Enter");
  await expect(page.locator(".country-government-dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
});

test("поиск показывает ожидание и ошибку, скрывает прежние результаты и повторяет запрос", async ({ page }, info) => {
  await login(page);
  const input = page.getByLabel("Поиск здания по номеру или названию");
  await input.fill("1");
  await expect(page.locator(".task-search-results button").first()).toBeVisible();
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/tasks/search?*", async route => {
    await held;
    await route.fulfill({ status: 503, json: { message: "unavailable" } });
  });
  await input.fill("Не найденная задача");
  try {
    await expect(page.locator(".task-search-results [role=status]")).toHaveText("Ищем задачи…");
    await expect(page.locator(".task-search-results [role=option]")).toHaveCount(0);
    expect((await new AxeBuilder({ page }).include(".task-search").withTags(["wcag2a", "wcag2aa"]).analyze()).violations).toEqual([]);
    await input.press("Enter");
    await expect(page.locator(".task-modal")).toHaveCount(0);
    await page.screenshot({ path: info.outputPath("search-loading.png") });
  } finally { release(); }
  await expect(page.locator(".task-search-results [role=alert]")).toContainText("Не удалось выполнить поиск");
  await page.screenshot({ path: info.outputPath("search-error.png") });
  await page.unroute("**/api/tasks/search?*");
  await page.getByRole("button", { name: "Повторить поиск" }).click();
  await expect(page.locator(".task-search-results [role=status]")).toHaveText("Ничего не найдено");
});

test("поиск выбирает второй результат стрелками и не открывается вновь после Escape", async ({ page }) => {
  await login(page);
  const input = page.getByLabel("Поиск здания по номеру или названию");
  const response = await page.request.get("/api/tasks/search?q=Задача&limit=10");
  const results = await response.json();
  expect(results.length).toBeGreaterThan(1);
  await input.fill("Задача");
  await expect(page.locator(".task-search-results [role=option]")).toHaveCount(results.length);
  expect((await new AxeBuilder({ page }).include(".task-search").withTags(["wcag2a", "wcag2aa"]).analyze()).violations).toEqual([]);
  await input.press("ArrowDown");
  await input.press("ArrowDown");
  await input.press("Enter");
  await expect(page.locator("#task-title")).toHaveText(results[1].title);
  await page.keyboard.press("Escape");
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/tasks/search?*", async route => { await held; await route.fulfill({ json: results }); });
  await input.fill("Задача");
  try {
    await expect(input).toHaveAttribute("aria-expanded", "true");
    await input.press("Escape");
    release();
    await expect(input).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator(".task-search-results")).toHaveCount(0);
    await input.press("Enter");
    await expect(page.locator(".task-modal")).toHaveCount(0);
  } finally { release(); }
});

test("отказ загрузки кода оставляет доступное закрываемое окно и рабочую карту", async ({ page }, info) => {
  await login(page);
  await page.route(/\/TokenPanel-[^/]+\.js(?:\?.*)?$/, route => route.fulfill({ status: 503, headers: { "cache-control": "no-store" }, body: "unavailable" }));
  await menu(page, "Аккаунт и настройки");
  const dialog = page.getByRole("dialog", { name: "Не удалось открыть окно" });
  await expect(dialog.getByRole("alert")).toContainText("Перезагрузите страницу");
  await expect(dialog.getByRole("button", { name: "Перезагрузить" })).toBeEnabled();
  expect((await new AxeBuilder({ page }).include("[role=dialog]").withTags(["wcag2a", "wcag2aa"]).analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath("chunk-failure.png") });
  await dialog.getByRole("button", { name: "Закрыть", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByLabel("Меню", { exact: true })).toBeFocused();
  await page.unroute(/\/TokenPanel-[^/]+\.js(?:\?.*)?$/);
  await menu(page, "Аккаунт и настройки");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Перезагрузить" }).click();
  await expect(page.getByLabel("Меню", { exact: true })).toBeVisible();
  await menu(page, "Аккаунт и настройки");
  await expect(page.getByRole("heading", { name: "Аккаунт и интеграции" })).toBeVisible();
});

test("архив показывает загрузку, повторяет 503 и сохраняет список при закрытии записи", async ({ page }, info) => {
  test.skip(process.env.E2E_FOREST_UI_FIXTURE !== "true", "Отдельная локальная схема для архива");
  await login(page);
  const bootstrap = await (await page.request.get("/api/bootstrap")).json();
  const { stdout } = await promisify(execFile)(process.execPath, ["--import", "tsx", "tests/fixtures/seed-forest-ui.ts", bootstrap.country.id, bootstrap.initialCity.id]);
  const { record } = JSON.parse(stdout);
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route(/\/ArchiveRecordModal-[^/]+\.js(?:\?.*)?$/, async route => { await held; await route.continue(); });
  await menu(page, "Архив проекта");
  const row = page.locator(".city-directory").getByRole("button", { name: new RegExp(record.title) });
  await row.click();
  try {
    await expect(page.getByRole("dialog", { name: "Загрузка архива" }).getByRole("status")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(row).toBeFocused();
    release();
  } finally { release(); }
  await page.route(`**/api/archive/records/${record.id}`, route => route.fulfill({ status: 503, json: { message: "Архив временно недоступен" } }));
  await row.click();
  const modal = page.locator(".archive-record-modal");
  await expect(modal.getByRole("alert")).toContainText("Архив временно недоступен");
  await page.unroute(`**/api/archive/records/${record.id}`);
  await modal.getByRole("button", { name: "Повторить" }).click();
  await expect(modal.getByRole("heading", { name: record.title })).toBeVisible();
  await page.setViewportSize({ width: 320, height: 740 });
  expect(await modal.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).include(".archive-record-modal").withTags(["wcag2a", "wcag2aa"]).analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath("archive-recovered-mobile.png") });
  await page.keyboard.press("Escape");
  await expect(row).toBeVisible();
  await expect(row).toBeFocused();
});

for (const [chunk, item, label] of [
  ["CityDocuments", "Документы", "Загрузка документов"],
  ["TokenPanel", "Аккаунт и настройки", "Загрузка настроек"],
] as const) test(`окно ${item}: загрузка видна, блокирует фон и отменяется до получения кода`, async ({ page }, info) => {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route(new RegExp(`/${chunk}-[^/]+\\.js(?:\\?.*)?$`), async route => { await held; await route.continue(); });
  await login(page);
  await menu(page, item);
  try {
    const dialog = page.getByRole("dialog", { name: label });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("status")).toBeVisible();
    expect(await page.locator(".map-toolbar").evaluate(el => Boolean(el.closest("[inert]")))).toBe(true);
    expect((await new AxeBuilder({ page }).include("[role=dialog]").withTags(["wcag2a", "wcag2aa"]).analyze()).violations).toEqual([]);
    await page.screenshot({ path: info.outputPath(`${chunk}-loading.png`) });
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    release();
    await expect(page.getByLabel("Меню", { exact: true })).toBeFocused();
    expect(await page.locator(".map-toolbar").evaluate(el => Boolean(el.closest("[inert]")))).toBe(false);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  } finally { release(); }
});

test("карточка из списка блокирует фон и закрывает только себя, сохраняя фокус и район", async ({ page }) => {
  await login(page);
  await expect(page.locator(".planet-atlas")).toHaveAttribute("data-planet-ready", "true", { timeout: 30_000 });
  await openMapCity(page);
  await page.locator(".header-city").click();
  const drawer = page.locator(".city-directory");
  await drawer.locator(".plan-row button").filter({ has: page.locator(".district-dot") }).first().click();
  const task = drawer.locator(".plan-row button").filter({ has: page.locator(".task-stage-dot") }).first();
  const label = await task.innerText();
  await task.click();
  await expect(page.locator("#task-title")).toBeVisible();
  await page.locator(".task-modal h2").click();
  await expect(drawer).toHaveCount(1);
  expect(await drawer.evaluate(el => Boolean(el.closest("[inert]")))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.locator(".task-modal")).toHaveCount(0);
  await expect(drawer).toBeVisible();
  await expect(task).toHaveText(label, { useInnerText: true });
  await expect(task).toBeFocused();
});

test("здание открывает свою карточку на карте телефона и компьютера", async ({ page }, info) => {
  await page.request.post("/api/auth/login", { data: { email: "demo@tasktopia.local", password: "tasktopia-demo" } });
  const [result] = await (await page.request.get("/api/tasks/search?q=1&limit=1")).json();
  const task = await (await page.request.get(`/api/tasks/${result.id}`)).json() as TaskDto;
  const target = {
    x: (Math.min(...task.footprint.map(c => c.x)) + Math.max(...task.footprint.map(c => c.x)) + 1) / 2,
    y: (Math.min(...task.footprint.map(c => c.y)) + Math.max(...task.footprint.map(c => c.y)) + 1) / 2,
  };
  const openings: number[] = [];
  for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/task/1");
    await expect(page.locator("#task-title")).toHaveText(task.title);
    await page.getByRole("button", { name: "Закрыть", exact: true }).click();
    const world = page.locator(".world-canvas");
    await expect(world).toHaveAttribute("data-city-scene-commit", "atomic");
    await expect(page.locator(".map-level-transition")).toHaveCount(0);
    const box = (await page.getByLabel("Интерактивная карта города", { exact: true }).boundingBox())!;
    const scale = Number(await world.getAttribute("data-render-scale"));
    const cameraX = Number(await world.getAttribute("data-camera-world-x")), cameraY = Number(await world.getAttribute("data-camera-world-y"));
    const start = Date.now();
    await page.mouse.click(box.x + box.width / 2 + (target.x - cameraX) * 8 * scale, box.y + box.height / 2 + (target.y - cameraY) * 8 * scale);
    await expect(page.locator("#task-title")).toHaveText(task.title);
    openings.push(Date.now() - start);
    expect(openings.at(-1)).toBeLessThan(1_500);
    await page.keyboard.press("Escape");
    await expect(page.locator(".task-modal")).toHaveCount(0);
    expect(await world.evaluate(el => Boolean(el.closest("[inert]")))).toBe(false);
  }
  const evidence = JSON.stringify({ widths: [320, 1440], openings }, null, 2);
  await writeFile(info.outputPath("building-task-opening.json"), evidence);
  await info.attach("building-task-opening", { body: evidence, contentType: "application/json" });
});

test("длинное название и материалы не вытесняют содержимое карточки на телефоне", async ({ page }, info) => {
  await page.request.post("/api/auth/login", { data: { email: "demo@tasktopia.local", password: "tasktopia-demo" } });
  await page.route(/\/api\/tasks\/[a-f0-9-]{36}$/, async route => {
    const response = await route.fetch({ headers: { ...route.request().headers(), "accept-encoding": "identity" } });
    const task = await response.json();
    await route.fulfill({ json: { ...task, title: "Проверка длинного названия и доступности материалов задачи в небольшом окне браузера ".repeat(2), description: "Полное описание задачи доступно.\n\n```ts\n" + "long_material_".repeat(60) + "\n```" } });
  });
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/task/1");
  await expect(page.locator("#task-title")).toBeVisible();
  const titleBox = (await page.locator(".task-header > .min-w-0").boundingBox())!;
  const closeBox = (await page.getByRole("button", { name: "Закрыть", exact: true }).boundingBox())!;
  expect(titleBox.x + titleBox.width, "метаданные и название оставляют место для кнопки закрытия").toBeLessThanOrEqual(closeBox.x - 4);
  const panel = page.getByRole("tabpanel", { name: "Задача", exact: true });
  expect(await panel.evaluate(el => el.clientHeight)).toBeGreaterThan(100);
  await panel.getByText("Полное описание задачи доступно.", { exact: true }).scrollIntoViewIfNeeded();
  await panel.getByText("Полное описание задачи доступно.", { exact: true }).click();
  expect(await page.locator(".task-modal").evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("task-long-title.png") });
  await page.keyboard.press("Escape");
  await expect(page.locator(".task-modal")).toHaveCount(0);
});

test("touch: документы, карточка и меню работают при касании и смене ориентации", async ({ page, isMobile }, info) => {
  test.skip(!isMobile, "Контексты с настоящим touch");
  await login(page);
  await page.getByLabel("Меню", { exact: true }).tap();
  await page.getByRole("button", { name: "Документы", exact: true }).tap();
  const documents = page.getByRole("dialog", { name: "Документы" });
  await documents.locator(".document-tasks button").first().tap();
  await expect(page.locator("#task-title")).toBeVisible();
  for (const name of ["Материалы", "Обсуждение", "История", "Задача"]) {
    await page.getByRole("tab", { name: new RegExp(`^${name}`) }).tap();
    await expect(page.getByRole("tabpanel", { name: new RegExp(`^${name}`) })).toBeVisible();
  }
  await page.getByRole("button", { name: "Закрыть", exact: true }).tap();
  await expect(documents).toBeVisible();
  await page.setViewportSize({ width: 844, height: 390 });
  await documents.locator(".document-tasks button").first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath("touch-documents-landscape.png") });
  await documents.getByRole("button", { name: "Закрыть документы" }).tap();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByLabel("Меню", { exact: true }).tap();
  await expect(page.getByRole("button", { name: "Аккаунт и настройки", exact: true })).toBeVisible();
});

test("документы доступны на низком экране при 200% тексте", async ({ page }, info) => {
  await page.setViewportSize({ width: 740, height: 320 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await login(page);
  await page.evaluate(() => { document.documentElement.style.fontSize = "32px"; });
  await menu(page, "Документы");
  const dialog = page.getByRole("dialog", { name: "Документы" });
  const task = dialog.locator(".document-tasks button").first();
  await expect(task).toBeVisible();
  await task.scrollIntoViewIfNeeded();
  const box = (await task.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(320);
  expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("documents-landscape-200.png") });
  await task.click();
  await expect(page.locator("#task-title")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await expect(task).toBeFocused();
});
