import { expect, test } from "@playwright/test";

test.skip(process.env.E2E_PADDING_RETRY !== "true", "Explicit read-only large-city padding fixture required");
test.use({ viewport: { width: 1600, height: 1100 } });
test("native atlas preload failure stays unready and explicit Retry rebuilds one complete renderer", async ({ page }) => {
  test.setTimeout(90_000);
  let fail = true, failures = 0, successes = 0;
  await page.route("**/atlas/terrain-v4/city/river.png", async route => {
    if (fail) { failures++; await route.fulfill({ status: 503, body: "Intentional local renderer-retry fixture" }); }
    else { successes++; await route.continue(); }
  });
  expect((await page.request.post("/api/auth/login", { data: {
    email: "release-scale-b@tasktopia.local", password: "local-scale-fixture-only",
  } })).status()).toBe(200);
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText("Не удалось запустить карту", { timeout: 30_000 });
  expect(failures).toBeGreaterThan(0);
  await expect(page.locator(".world-canvas")).not.toHaveAttribute("data-city-scene-commit", "atomic");
  fail = false;
  await page.getByRole("alert").getByRole("button", { name: "Повторить", exact: true }).click();
  const host = page.locator(".world-canvas");
  await expect(host).toHaveAttribute("data-city-scene-commit", "atomic", { timeout: 60_000 });
  await expect(host).toHaveAttribute("data-camera-padding-atlas-families", "10");
  await expect(host).toHaveAttribute("data-ground-bake-queue", "0");
  await expect(host).toHaveAttribute("data-camera-padding-visible-untextured", "0");
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(successes).toBeGreaterThan(0);
  await expect(page.locator("canvas[aria-label='Интерактивная карта города']")).toHaveCount(1);
});
