import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { openMapCity } from "./map-navigation";

async function audit(page: Page, selector: string) {
  await expect(page.locator(selector).first()).toBeVisible();
  const violations = (await new AxeBuilder({ page }).include(selector).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations;
  expect(violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) }))).toEqual([]);
  expect(await page.locator(selector).first().evaluate(el => el.scrollWidth <= el.clientWidth + 1), `${selector}: горизонтальная прокрутка`).toBe(true);
}
async function menu(page: Page, label: string) {
  await page.getByLabel("Меню", { exact: true }).click();
  await page.getByRole("button", { name: label, exact: true }).click();
}

for (const width of [320, 390, 768, 1440]) test(`все основные панели согласованы и доступны на ширине ${width}`, async ({ page }, info) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width, height: width === 1440 ? 1100 : 844 });
  const errors: string[] = [];
  const externalFonts: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (/fonts\.(?:googleapis|gstatic)\.com/.test(request.url())) externalFonts.push(request.url()); });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Войти в Tasktopia" })).toBeVisible();
  await audit(page, ".auth-screen");
  await page.screenshot({ path: info.outputPath("entry.png") });
  await page.request.post("/api/auth/login", { data: { email: "demo@tasktopia.local", password: "tasktopia-demo" } });
  await page.goto("/");
  await expect(page.locator(".planet-atlas")).toHaveAttribute("data-planet-ready", "true");
  await audit(page, ".map-toolbar");
  await page.getByLabel("Меню", { exact: true }).focus();
  await page.keyboard.press("Enter");
  await audit(page, ".world-menu .game-popover-panel");
  await page.screenshot({ path: info.outputPath("menu.png") });
  await page.keyboard.press("Escape");
  await expect(page.locator(".world-menu")).not.toHaveAttribute("open", "");

  await menu(page, "Аккаунт и настройки");
  await audit(page, ".settings-panel");
  await page.screenshot({ path: info.outputPath("account.png") });
  await page.getByRole("button", { name: "MCP-интеграция", exact: true }).click();
  await audit(page, ".settings-panel");
  await page.screenshot({ path: info.outputPath("mcp.png") });
  await page.locator(".mcp-example summary").click();
  await audit(page, ".settings-panel");
  await page.keyboard.press("Escape");

  await page.locator(".country-title-button").click();
  await audit(page, ".country-switcher");
  await page.getByRole("button", { name: "Паспорт страны", exact: true }).click();
  await audit(page, ".country-government-dialog");
  await page.screenshot({ path: info.outputPath("passport.png") });
  await page.keyboard.press("Escape");

  await openMapCity(page);
  await expect(page.locator(".world-canvas")).toHaveAttribute("data-city-scene-commit", "atomic");
  await audit(page, ".map-toolbar");
  await page.locator(".header-city").click();
  await expect(page.locator(".city-directory .plan-row button").first()).toBeVisible();
  await audit(page, ".city-directory");
  await page.screenshot({ path: info.outputPath("districts.png") });
  await page.locator(".city-directory .plan-row button").first().click();
  await expect(page.locator(".city-directory .task-stage-dot").first()).toBeVisible();
  await audit(page, ".city-directory");
  await page.screenshot({ path: info.outputPath("district-tasks.png") });
  await page.keyboard.press("Escape");
  await page.getByLabel("Фильтры", { exact: true }).click();
  await audit(page, ".game-popover[open] .game-popover-panel");
  await page.getByRole("button", { name: "Развитие города", exact: true }).click();
  await expect(page.locator(".city-development-panel h3").first()).toHaveText("Службы");
  await audit(page, ".city-development-panel");
  await page.screenshot({ path: info.outputPath("development.png") });
  await page.keyboard.press("Escape");

  await menu(page, "Документы");
  await expect(page.locator(".document-tasks button").first()).toBeVisible();
  await audit(page, ".city-documents");
  await page.screenshot({ path: info.outputPath("documents.png") });
  await page.getByRole("button", { name: "Сводка", exact: true }).click();
  await audit(page, ".city-documents");
  await page.keyboard.press("Escape");

  await page.getByLabel("Поиск здания по номеру или названию").fill("1");
  await page.locator(".task-search-results button").first().click();
  await expect(page.locator("#task-title")).toBeVisible();
  for (const name of ["Задача", "Материалы", "Обсуждение", "История"]) {
    await page.getByRole("tab", { name: new RegExp(`^${name}`) }).click();
    await audit(page, ".task-modal");
    await page.screenshot({ path: info.outputPath(`task-${name}.png`) });
  }
  await page.getByRole("button", { name: "Превью", exact: true }).click();
  await page.getByText("Настроить поля", { exact: true }).click();
  await audit(page, ".task-preview-popover");
  await page.screenshot({ path: info.outputPath("preview-controls.png") });
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.getByLabel("Уведомления", { exact: true }).click();
  await expect(page.locator(".world-digest .game-popover-panel")).toBeVisible();
  await audit(page, ".world-digest .game-popover-panel");
  await page.screenshot({ path: info.outputPath("notifications.png") });
  await page.keyboard.press("Escape");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  expect(externalFonts).toEqual([]);
  expect(errors).toEqual([]);
});
