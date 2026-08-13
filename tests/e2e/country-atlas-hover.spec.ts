import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 1440, height: 900 } });

test("all atlas cities hover safely and drive the compact header", async ({ page }) => {
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });

  await page.goto("/");
  await page.getByLabel("Email").fill("world-validation@tasktopia.local");
  await page.getByLabel("Пароль").fill("tasktopia-world-validation");
  await page.getByRole("button", { name: "Открыть страну" }).click();
  browserErrors.length = 0;

  const atlas = page.locator(".country-atlas");
  await expect(atlas).toHaveAttribute("data-country-atlas-cities", "10", { timeout: 45_000 });
  await expect(page.getByRole("banner").getByLabel("MCP-интеграции")).toHaveCount(0);
  const search = page.getByPlaceholder("Поиск задачи: № или название");
  await expect(search).toBeVisible();

  const cities = page.locator(".atlas-city");
  await expect(cities).toHaveCount(10);
  for (let index = 0; index < 10; index += 1) {
    const city = cities.nth(index);
    const name = await city.locator(".atlas-city-label text").first().textContent();
    expect(name).toBeTruthy();
    await city.locator(".atlas-city-label").hover();
    await expect(page.locator(".header-city strong")).toHaveText(name!);
  }
  await page.locator(".country-atlas").hover({ position: { x: 2, y: 2 } });
  await expect(page.locator(".header-city")).toHaveCount(0);
  expect(browserErrors).toEqual([]);
});
