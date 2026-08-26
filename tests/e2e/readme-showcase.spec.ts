import { expect, test } from "@playwright/test";

const screenshotPath = process.env.README_SCREENSHOT_PATH;

test.use({ viewport: { width: 1920, height: 1080 } });

test("captures the real README showcase city", async ({ page }) => {
  test.skip(!screenshotPath, "Run explicitly with README_SCREENSHOT_PATH");
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto("/");
  await page.getByLabel("Email").fill("showcase@tasktopia.local");
  await page.getByLabel("Пароль").fill("tasktopia-showcase");
  await page.getByRole("button", { name: "Открыть страну" }).click();
  await expect(page.getByText("Республика Аврора", { exact: true })).toBeVisible();

  const map = page.locator(".world-canvas");
  const canvas = page.locator("canvas[aria-label='Интерактивная карта города']");
  await expect.poll(async () => Number(await map.getAttribute("data-resident-chunks")), { timeout: 20_000 }).toBeGreaterThan(0);
  await canvas.hover();
  for (let step = 0; step < 8 && await map.getAttribute("data-map-lod") !== "detail"; step += 1) {
    await page.mouse.wheel(0, -800);
  }
  await expect(map).toHaveAttribute("data-map-lod", "detail", { timeout: 20_000 });
  await expect.poll(async () => Number(await map.getAttribute("data-cars")), { timeout: 20_000 }).toBeGreaterThan(0);
  await expect.poll(async () => Number(await map.getAttribute("data-walkers")), { timeout: 20_000 }).toBeGreaterThan(0);
  // The active sprint is intentionally the last generated district and may
  // start just above the initial fitted city frame. Pan north until all three
  // seeded incident buildings are resident; counting only the first viewport
  // made this visual gate depend on district geometry.
  const canvasBox = await canvas.boundingBox();
  if (canvasBox) {
    for (let step = 0; step < 3 && Number(await map.getAttribute("data-incidents")) < 3; step += 1) {
      const x = canvasBox.x + canvasBox.width / 2;
      const y = canvasBox.y + canvasBox.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x, y + 140, { steps: 6 });
      await page.mouse.up();
      await page.waitForTimeout(350);
    }
  }
  await expect.poll(async () => Number(await map.getAttribute("data-incidents")), { timeout: 20_000 }).toBeGreaterThanOrEqual(3);
  await expect(map).toHaveAttribute("data-wrong-way-cars", "0");

  consoleErrors.length = 0;
  await page.waitForTimeout(1_200);
  await page.screenshot({ path: screenshotPath!, fullPage: true });
  expect(consoleErrors).toEqual([]);
});
