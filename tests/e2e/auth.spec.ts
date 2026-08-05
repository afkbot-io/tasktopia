import { expect, test } from "@playwright/test";

test("shows a clear duplicate-registration error and keeps the form usable", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Нет аккаунта? Зарегистрироваться" }).click();
  await page.getByLabel("Имя").fill("Duplicate Mayor");
  await page.getByLabel("Название вашей первой страны").fill("Duplicate Product");
  await page.getByLabel("Название первого города").fill("Duplicate Epic");
  await page.getByLabel("Email").fill("demo@tasktopia.local");
  await page.getByLabel("Пароль").fill("safe-password-123");
  await page.getByRole("button", { name: "Создать аккаунт" }).click();

  await expect(page.getByRole("alert")).toHaveText("Аккаунт с таким email уже существует");
  await expect(page.getByRole("button", { name: "Создать аккаунт" })).toBeEnabled();
});

test("keeps authentication pending through bootstrap and offers retry after a country-load failure", async ({ page }) => {
  let failNextBootstrap = false;
  await page.route("**/api/bootstrap", async (route) => {
    if (failNextBootstrap) {
      failNextBootstrap = false;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ message: "Не удалось загрузить страну. Повторите запрос" }),
      });
      return;
    }
    await route.continue();
  });

  await page.goto("/");
  await page.getByLabel("Email").fill("demo@tasktopia.local");
  await page.getByLabel("Пароль").fill("tasktopia-demo");
  failNextBootstrap = true;
  await page.getByRole("button", { name: "Открыть страну" }).click();

  await expect(page.getByRole("alert")).toHaveText("Не удалось загрузить страну. Повторите запрос");
  await page.getByRole("button", { name: "Повторить загрузку" }).click();
  await expect(page.locator("canvas[aria-label='Интерактивная карта страны']")).toBeVisible();
});
