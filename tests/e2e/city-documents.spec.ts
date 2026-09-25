import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { openMapCity } from "./map-navigation";
test("documents remain read-only, preserve context across task preview and fit a phone", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.request.post("/api/auth/login", {
    data: { email: "demo@tasktopia.local", password: "tasktopia-demo" },
  });
  let reads = 0;
  page.on("request", (r) => {
    if (r.url().includes("/api/city-report?")) reads++;
  });
  await page.goto("/");
  await openMapCity(page);
  expect(reads).toBe(0);
  await page.getByLabel("Меню", { exact: true }).click();
  await page.getByRole("button", { name: "Документы", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Документы" });
  await expect(dialog.locator(".document-tasks button").first()).toBeVisible();
  await expect(
    dialog.getByRole("button", {
      name: /Взять в работу|Назначить|Создать задачу/,
    }),
  ).toHaveCount(0);
  const district = await dialog
    .getByRole("combobox", { name: "Район", exact: true })
    .inputValue();
  await dialog.locator(".document-tasks button").first().click();
  await expect(page.locator("#task-title")).toBeVisible();
  await expect(dialog).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("combobox", { name: "Район", exact: true }),
  ).toHaveValue(district);
  await dialog.getByRole("button", { name: "Сводка", exact: true }).click();
  await expect(dialog.getByText("Готово / всего")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await dialog.evaluate((n) => n.scrollWidth <= n.clientWidth)).toBe(
    true,
  );
  expect(
    (
      await new AxeBuilder({ page })
        .include(".city-documents")
        .withTags(["wcag2a", "wcag2aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.screenshot({ path: info.outputPath("documents-mobile.png") });
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  expect(errors).toEqual([]);
});
test("document failure retries without stale rows and empty attention is explicit", async ({
  page,
}) => {
  await page.request.post("/api/auth/login", {
    data: { email: "demo@tasktopia.local", password: "tasktopia-demo" },
  });
  await page.goto("/");
  await page.route("**/api/city-report?*", (r) =>
    r.fulfill({ status: 503, json: { message: "unavailable" } }),
  );
  await page.getByLabel("Меню", { exact: true }).click();
  await page.getByRole("button", { name: "Документы", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Документы" });
  await expect(dialog.getByRole("alert")).toBeVisible();
  await page.route("**/api/city-report?*", (r) =>
    r.fulfill({
      json: {
        items: [],
        total: 0,
        nextOffset: null,
        counts: {
          working: 0,
          planned: 0,
          completed: 0,
          testing: 0,
          attention: 0,
          completedPeriod: 0,
        },
      },
    }),
  );
  await dialog.getByRole("button", { name: "Повторить" }).click();
  await expect(
    dialog.getByText("В этом разделе пока нет задач."),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Требует внимания", exact: true })
    .click();
  await expect(
    dialog.getByText("Нет объектов, требующих внимания."),
  ).toBeVisible();
});

test("world inspection has no work mutation controls or requests", async ({ page }) => {
  await page.request.post("/api/auth/login", { data: { email: "demo@tasktopia.local", password: "tasktopia-demo" } });
  const writes: string[] = [];
  page.on("request", request => {
    const path = new URL(request.url()).pathname;
    if (request.method() !== "GET" && /^\/api\/(tasks|cities|districts|archive|countries)(\/|$)/.test(path)) writes.push(`${request.method()} ${path}`);
  });
  await page.goto("/");
  await page.locator(".country-title-button").click();
  const switcher = page.getByRole("dialog", { name: "Выбор страны" });
  await expect(switcher.getByRole("button", { name: /Новая страна|Редактировать/ })).toHaveCount(0);
  await switcher.getByRole("button", { name: "Паспорт страны" }).click();
  const passport = page.locator(".country-government-dialog");
  await expect(passport.getByRole("heading", { name: "Правительство" })).toBeVisible();
  await expect(passport.locator("input, textarea, select")).toHaveCount(0);
  await expect(passport.getByRole("button", { name: /Сохранить|Удалить|Назначить|Исключить|Перегенерировать/ })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.locator(".country-title-button").click();
  await switcher.getByRole("button", { name: "Города", exact: true }).click();
  await expect(page.locator(".city-directory")).toBeVisible();
  await expect(page.locator(".plan-delete")).toHaveCount(0);
  expect(writes).toEqual([]);
});

test("a shrinking queue returns to an existing page", async ({ page }) => {
  await page.request.post("/api/auth/login", { data: { email: "demo@tasktopia.local", password: "tasktopia-demo" } });
  let shrink = false;
  const offsets: string[] = [];
  await page.route("**/api/city-report?*", async route => {
    const offset = new URL(route.request().url()).searchParams.get("offset")!;
    offsets.push(offset);
    if (offset === "50") shrink = true;
    await route.fulfill({ json: {
      items: offset === "50" ? [] : [{ id: "display-only", taskNumber: 1, title: "Последний объект", status: "PLANNING", progress: 0, cityName: "Город", districtName: "Район", assignee: null, dueAt: null, defects: 0, dependencies: 0 }],
      total: shrink ? 1 : 51, nextOffset: shrink ? null : 50,
      counts: { working: 0, planned: shrink ? 1 : 51, completed: 0, testing: 0, attention: 0, completedPeriod: 0 },
    } });
  });
  await page.goto("/");
  await page.getByLabel("Меню", { exact: true }).click();
  await page.getByRole("button", { name: "Документы", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Документы" });
  await dialog.getByRole("button", { name: "Далее", exact: true }).click();
  await expect(dialog.getByText("Объекты 1–1 из 1")).toBeVisible();
  expect(offsets.slice(-2)).toEqual(["50", "0"]);
});
