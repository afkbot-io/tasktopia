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
