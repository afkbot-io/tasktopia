import { expect, test } from "@playwright/test";

const screenshotPath = process.env.BLOCK_WORLD_PREVIEW_SCREENSHOT;

test("renders the compact block-v1 city with production terrain", async ({ page }) => {
  test.skip(!screenshotPath, "Run explicitly with the block-world preview build");
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto("/?block-preview=1");
  const canvas = page.getByLabel("Предпросмотр квартального города");
  await expect(canvas).toHaveAttribute("data-render-cell-px", "4");
  await expect(canvas).toHaveAttribute("data-terrain-source", "production-v5");
  await expect(page.getByRole("status")).toHaveCount(0, { timeout: 30_000 });
  await page.screenshot({ path: screenshotPath!, fullPage: true });
  expect(consoleErrors).toEqual([]);
});
