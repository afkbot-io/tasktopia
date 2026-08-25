import { expect, test } from "@playwright/test";

test("starts the whole-city request before slow sprite downloads", async ({ page }) => {
  test.setTimeout(90_000);
  let sceneStartedAt = 0;
  let firstSpriteStartedAt = 0;
  let firstSpriteReleasedAt = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.endsWith("/scene") && sceneStartedAt === 0) sceneStartedAt = Date.now();
  });
  await page.route("**/game-assets/**", async (route) => {
    if (firstSpriteStartedAt === 0) firstSpriteStartedAt = Date.now();
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    if (firstSpriteReleasedAt === 0) firstSpriteReleasedAt = Date.now();
    await route.continue();
  });
  await page.goto("/");
  await page.getByLabel("Email").fill("demo@tasktopia.local");
  await page.getByLabel("Пароль").fill("tasktopia-demo");
  await page.getByRole("button", { name: "Открыть страну" }).click();
  await expect.poll(() => sceneStartedAt, { timeout: 15_000 }).toBeGreaterThan(0);
  await expect.poll(() => firstSpriteStartedAt, { timeout: 30_000 }).toBeGreaterThan(0);
  expect(sceneStartedAt).toBeLessThanOrEqual(firstSpriteStartedAt);
  await expect(page.getByText("Готовим карту…", { exact: true })).toBeVisible();
  await expect.poll(() => firstSpriteReleasedAt, { timeout: 30_000 }).toBeGreaterThan(0);
  await expect(page.locator(".world-canvas")).toHaveAttribute("data-city-scene-commit", "atomic", { timeout: 90_000 });
});

test("retries a failed building texture before the atomic scene commit", async ({ page }) => {
  test.setTimeout(90_000);
  let buildingFailureSeen = false;
  let buildingRetrySeen = false;
  await page.route("**/game-assets/**", async (route) => {
    if (!new URL(route.request().url()).pathname.includes("/buildings/")) {
      await route.continue();
      return;
    }
    if (!buildingFailureSeen) {
      buildingFailureSeen = true;
      await route.abort("failed");
      return;
    }
    buildingRetrySeen = true;
    await route.continue();
  });
  await page.goto("/");
  await page.getByLabel("Email").fill("demo@tasktopia.local");
  await page.getByLabel("Пароль").fill("tasktopia-demo");
  await page.getByRole("button", { name: "Открыть страну" }).click();
  await expect.poll(() => buildingFailureSeen, { timeout: 30_000 }).toBe(true);
  await expect.poll(() => buildingRetrySeen, { timeout: 30_000 }).toBe(true);
  await expect(page.locator(".world-canvas")).toHaveAttribute("data-city-scene-commit", "atomic", { timeout: 90_000 });
  await expect(page.locator(".world-canvas")).not.toHaveAttribute("data-load-error", "true");
});
