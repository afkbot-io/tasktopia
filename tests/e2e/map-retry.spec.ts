import { expect, test } from "@playwright/test";

test("country request timeout offers an in-place retry and releases the request", async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await page.getByLabel("Email").fill("demo@tasktopia.local");
  await page.getByLabel("Пароль").fill("tasktopia-demo");
  await page.getByRole("button", { name: "Открыть страну" }).click();
  await expect(page.locator("canvas[aria-label='Интерактивная карта города']")).toBeVisible({ timeout: 45_000 });
  let attempts = 0;
  await page.route("**/api/countries/*/overview", async route => {
    attempts += 1;
    if (attempts === 1) {
      await new Promise(resolve => setTimeout(resolve, 22_000));
      await route.abort().catch(() => undefined);
    } else await route.continue();
  });
  await page.getByRole("button", { name: "Страна", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("слишком долго", { timeout: 25_000 });
  await page.getByRole("button", { name: "Повторить загрузку карты" }).click();
  await expect(page.locator(".country-overview")).toHaveAttribute("data-country-ready", "true", { timeout: 30_000 });
  expect(attempts).toBe(2);
  expect(errors).toEqual([]);
});

test("a stalled terrain image can be retried without leaving the country", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/");
  await page.getByLabel("Email").fill("demo@tasktopia.local");
  await page.getByLabel("Пароль").fill("tasktopia-demo");
  await page.getByRole("button", { name: "Открыть страну" }).click();
  await expect(page.locator("canvas[aria-label='Интерактивная карта города']")).toBeVisible({ timeout: 45_000 });
  let delayed = false;
  await page.route("**/deep_water.png*", async route => {
    if (!delayed) {
      delayed = true;
      await new Promise(resolve => setTimeout(resolve, 22_000));
      await route.abort().catch(() => undefined);
    } else await route.continue();
  });
  await page.getByRole("button", { name: "Страна", exact: true }).click();
  await expect(page.locator(".country-overview-warning")).toContainText("графику карты", { timeout: 25_000 });
  await expect(page.getByText("Готовим карту страны…", { exact: true })).toBeHidden();
  await page.getByRole("button", { name: "Повторить загрузку карты" }).click();
  await expect(page.locator(".country-overview")).toHaveAttribute("data-country-ready", "true", { timeout: 30_000 });
});
