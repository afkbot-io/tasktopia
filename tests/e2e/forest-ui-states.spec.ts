import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("без буфера обмена ссылка доступна в карточке вместо системного диалога", async ({ page }, info) => {
  await page.request.post("/api/auth/login", { data: { email: "demo@tasktopia.local", password: "tasktopia-demo" } });
  const bootstrap = await (await page.request.get("/api/bootstrap")).json();
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto(`/task/1?countryId=${bootstrap.country.id}`);
  await expect(page.locator("#task-title")).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const tabContentFits = await page.locator(".game-tabs button").evaluateAll(buttons => buttons.every(button => {
    const label = document.createRange();
    label.selectNodeContents(button.firstChild!);
    const text = label.getBoundingClientRect();
    const control = button.getBoundingClientRect();
    const count = button.querySelector("span")?.getBoundingClientRect();
    return text.left >= control.left && text.right <= control.right
      && (!count || (count.left > text.right && count.right <= control.right));
  }));
  expect(tabContentFits, "подписи и счётчики вкладок не перекрывают друг друга на 320px").toBe(true);
  await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined }));
  const dialogs: string[] = [];
  page.on("dialog", dialog => { dialogs.push(dialog.type()); void dialog.dismiss(); });
  await page.getByRole("button", { name: "Ссылка", exact: true }).click();
  const field = page.getByRole("textbox", { name: "Ссылка на задачу", exact: true });
  await expect(field).toHaveValue(new RegExp(`/task/1\\?countryId=${bootstrap.country.id}&taskId=`));
  await expect(field).toHaveAttribute("readonly", "");
  await field.focus();
  expect(await field.evaluate((el: HTMLInputElement) => el.selectionStart === 0 && el.selectionEnd === el.value.length)).toBe(true);
  expect((await new AxeBuilder({ page }).include(".task-modal").withTags(["wcag2a", "wcag2aa"]).analyze()).violations).toEqual([]);
  expect(await page.locator(".task-modal").evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("task-copy-fallback.png") });
  expect(dialogs).toEqual([]);
});

test("пустое состояние, ошибка, ожидание, секрет и отзыв MCP-ключа доступны в новой теме", async ({ page }, info) => {
  const registration = await page.request.post("/api/auth/register", { data: {
    email: `forest-${info.project.name}-${Date.now()}@example.test`, name: "Хранитель атласа",
    password: "forest-test-password", passwordConfirmation: "forest-test-password",
    countryName: "Атлас проверки", cityName: "Проверочный город",
  } });
  expect(registration.ok()).toBe(true);
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/");
  await page.getByLabel("Меню", { exact: true }).click();
  await page.getByRole("button", { name: "Аккаунт и настройки", exact: true }).click();
  await page.getByRole("button", { name: "MCP-интеграция", exact: true }).click();
  const panel = page.locator(".settings-panel");
  const submit = panel.getByRole("button", { name: "Создать ключ", exact: true });
  await panel.getByLabel("Название ключа", { exact: true }).fill("");
  await expect(submit).toBeDisabled();
  await expect(panel.locator(".token-list")).toHaveCount(0);
  await panel.getByLabel("Название ключа", { exact: true }).fill("Проверка темы");
  const endpoint = "**/api/tokens";
  await page.route(endpoint, route => route.request().method() === "POST"
    ? route.fulfill({ status: 503, json: { message: "Ключи временно недоступны" } }) : route.continue());
  await submit.click();
  await expect(panel.getByRole("alert")).toHaveText("Ключи временно недоступны");
  expect((await new AxeBuilder({ page }).include(".settings-panel").withTags(["wcag2a", "wcag2aa"]).analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath("mcp-error.png") });
  await page.unroute(endpoint);

  let resume!: () => void;
  const gate = new Promise<void>(resolve => { resume = resolve; });
  await page.route(endpoint, async route => {
    if (route.request().method() === "POST") await gate;
    await route.continue();
  });
  await submit.click();
  await expect(panel.getByRole("button", { name: "Подождите…", exact: true })).toBeDisabled();
  resume();
  await expect(panel.locator(".token-secret")).toBeVisible();
  await expect(panel.locator(".token-list article")).toHaveCount(1);
  expect((await new AxeBuilder({ page }).include(".settings-panel").withTags(["wcag2a", "wcag2aa"]).analyze()).violations).toEqual([]);
  expect(await panel.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await panel.locator(".token-secret").scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath("mcp-secret.png"), mask: [panel.locator(".token-secret code")] });
  await panel.getByRole("button", { name: "Отозвать", exact: true }).click();
  await expect(panel.locator(".token-list article")).toHaveClass("revoked");
  await expect(panel.locator(".token-status")).toHaveText("Отозван");
  await panel.locator(".token-list").scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath("mcp-revoked.png"), mask: [panel.locator(".token-secret code")] });
});

test("корневой шрифт 200%, уменьшенное движение и горизонтальный экран сохраняют навигацию", async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 740, height: 320 });
  await page.goto("/");
  await expect(page.getByLabel("Email")).toBeVisible();
  await page.addStyleTag({ content: "html { font-size: 32px; }" });
  await page.getByLabel("Email").fill("demo@tasktopia.local");
  await page.getByLabel("Пароль").fill("tasktopia-demo");
  await page.getByRole("button", { name: "Открыть страну", exact: true }).click();
  await page.getByLabel("Меню", { exact: true }).click();
  await page.getByRole("button", { name: "Аккаунт и настройки", exact: true }).click();
  const panel = page.locator(".settings-panel");
  await expect(panel.getByRole("heading", { name: "Аккаунт и интеграции" })).toBeVisible();
  expect(await panel.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).include(".settings-panel").withTags(["wcag2a", "wcag2aa"]).analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath("landscape-text-200.png") });
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
});
