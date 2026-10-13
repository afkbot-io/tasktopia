import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("публичное превью доступно гостю, совпадает с темой и показывает отзыв ссылки", async ({ page, browser, baseURL }, info) => {
  await page.request.post("/api/auth/login", { data: { email: "demo@tasktopia.local", password: "tasktopia-demo" } });
  await page.goto("/task/1");
  await expect(page.locator("#task-title")).toBeVisible();
  await page.getByRole("button", { name: "Превью", exact: true }).click();
  await page.getByRole("button", { name: "Создать ссылку на превью", exact: true }).click();
  const url = await page.getByLabel("Ссылка с превью").inputValue();
  expect(new URL(url).origin).toBe(new URL(baseURL!).origin);
  const guest = await browser.newContext({ serviceWorkers: "block" });
  const preview = await guest.newPage();
  const errors: string[] = [];
  preview.on("pageerror", error => errors.push(error.message));
  try {
    expect((await preview.goto(url))?.status()).toBe(200);
    await expect.poll(() => preview.locator(".share-card").evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
    for (const width of [320, 1440]) {
      await preview.setViewportSize({ width, height: 844 });
      expect(await preview.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect((await new AxeBuilder({ page: preview }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations).toEqual([]);
      await preview.getByRole("link", { name: "Открыть задачу", exact: true }).focus();
      await expect(preview.getByRole("link", { name: "Открыть задачу", exact: true })).toBeFocused();
      await preview.screenshot({ path: info.outputPath(`public-preview-${width}.png`) });
    }
    await page.getByRole("button", { name: "Отозвать", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("отозваны");
    expect((await preview.reload())?.status()).toBe(404);
    await expect(preview.getByRole("heading", { name: "Tasktopia · ссылка недоступна" })).toBeVisible();
    await expect(preview.getByRole("link", { name: "Открыть Tasktopia" })).toBeVisible();
    expect((await new AxeBuilder({ page: preview }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations).toEqual([]);
    await preview.screenshot({ path: info.outputPath("public-preview-revoked.png") });
    expect(errors).toEqual([]);
  } finally { await guest.close(); }
});
