import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

function seriousViolations(result: Awaited<ReturnType<AxeBuilder["analyze"]>>) {
  return result.violations
    .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
    .map((violation) => ({ id: violation.id, impact: violation.impact, targets: violation.nodes.map((node) => node.target) }));
}

test("authentication and MCP settings have no serious accessibility violations", async ({ page }) => {
  await page.goto("/");
  expect(seriousViolations(await new AxeBuilder({ page }).analyze())).toEqual([]);

  await page.getByLabel("Email").fill("demo@tasktopia.local");
  await page.getByLabel("Пароль").fill("tasktopia-demo");
  await page.getByRole("button", { name: "Открыть страну" }).click();
  await page.getByRole("button", { name: "MCP-интеграции" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(seriousViolations(await new AxeBuilder({ page }).include(".settings-panel").analyze())).toEqual([]);

  await expect(page.getByRole("button", { name: "Закрыть" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(page.locator(".settings-panel :focus")).toBeVisible();
  await expect(page.getByRole("button", { name: "Закрыть" })).not.toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
});

test("key screens do not overflow at supported breakpoints", async ({ page }) => {
  for (const viewport of [{ width: 375, height: 812 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await page.getByRole("button", { name: "Нет аккаунта? Зарегистрироваться" }).click();
    await expect(page.getByLabel("Название вашей первой страны")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
  }

  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await page.getByLabel("Email").fill("demo@tasktopia.local");
  await page.getByLabel("Пароль").fill("tasktopia-demo");
  await page.getByRole("button", { name: "Открыть страну" }).click();
  await page.locator(".country-title-button").click();
  await expect(page.getByRole("dialog", { name: "Страны и команда" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  expect(seriousViolations(await new AxeBuilder({ page }).include("[aria-labelledby='countries-title']").analyze())).toEqual([]);
});
