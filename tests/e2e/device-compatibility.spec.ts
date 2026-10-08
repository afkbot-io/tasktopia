import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { openMapCity, openMapPlanet } from "./map-navigation";

test("вход, карта, панели и карточка удобны на выбранном устройстве", async ({ page, hasTouch }, info) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await page.evaluate(() => document.fonts.ready);
  await page.getByLabel("Email").fill("demo@tasktopia.local");
  await page.getByLabel("Пароль").fill("tasktopia-demo");
  await page.getByRole("button", { name: "Открыть страну", exact: true }).click();
  await expect(page.locator(".planet-atlas")).toHaveAttribute("data-planet-ready", "true");
  await openMapCity(page);
  await expect(page.locator(".world-canvas")).toHaveAttribute("data-city-scene-commit", "atomic");
  const menu = page.getByLabel("Меню", { exact: true });
  if (hasTouch) await menu.tap(); else await menu.click();
  await page.getByRole("button", { name: "Аккаунт и настройки", exact: true }).click();
  const account = page.locator(".settings-panel");
  await expect(account).toBeVisible();
  expect(await account.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).include(".settings-panel").withTags(["wcag2a", "wcag2aa"]).analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath("account-device.png") });
  await page.getByRole("button", { name: "Закрыть", exact: true }).click();

  await page.getByLabel("Поиск здания по номеру или названию").fill("1");
  await page.locator(".task-search-results button").first().click();
  await expect(page.locator("#task-title")).toBeVisible();
  const tabs = page.getByRole("tab");
  await expect(tabs).toHaveCount(4);
  for (const name of ["Задача", "Материалы", "Обсуждение", "История"]) {
    const tab = page.getByRole("tab", { name: new RegExp(`^${name}`) });
    if (hasTouch) await tab.tap(); else await tab.click();
    await expect(tab).toHaveAttribute("aria-selected", "true");
    expect(await page.locator(".task-modal").evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  }
  await tabs.last().focus();
  await page.keyboard.press("Home");
  await expect(tabs.first()).toBeFocused();
  await expect(tabs.first()).toHaveAttribute("aria-selected", "true");
  expect((await new AxeBuilder({ page }).include(".task-modal").withTags(["wcag2a", "wcag2aa"]).analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath("task-device.png") });
  await page.getByRole("button", { name: "Закрыть", exact: true }).click();
  await openMapPlanet(page);
  await expect(page.locator(".planet-atlas")).toHaveAttribute("data-planet-ready", "true");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test("ошибка загрузки карточки допускает повтор на выбранном устройстве", async ({ page }, info) => {
  expect((await page.request.post("/api/auth/login", { data: { email: "demo@tasktopia.local", password: "tasktopia-demo" } })).ok()).toBe(true);
  const bootstrap = await (await page.request.get("/api/bootstrap")).json();
  await page.route("**/api/tasks/resolve?**", route => route.fulfill({ status: 503, json: { error: "TEMPORARY_UNAVAILABLE", message: "Сервис временно недоступен" } }));
  await page.goto(`/task/1?countryId=${bootstrap.country.id}`);
  await expect(page.getByRole("button", { name: "Повторить", exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("task-error-device.png") });
  await page.unroute("**/api/tasks/resolve?**");
  await page.getByRole("button", { name: "Повторить", exact: true }).click();
  await expect(page.locator("#task-title")).toBeVisible();
  await expect(page.locator(".world-canvas")).toHaveCount(0);
});
