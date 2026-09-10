import { expect, test } from "@playwright/test";

test.use({ deviceScaleFactor: 2 });
test("country remains a native-resolution pixel canvas at close zoom", async ({ page }) => {
  expect((await page.request.post("/api/auth/login", { data: { email: "demo@tasktopia.local", password: "tasktopia-demo" } })).ok()).toBe(true);
  await page.goto("/");
  await page.getByRole("button", { name: "Страна", exact: true }).click();
  const country = page.locator(".country-overview");
  await expect(country).toHaveAttribute("data-country-ready", "true");
  const glyph = page.locator(".country-city-glyph").first();
  const before = (await glyph.boundingBox())!;
  await page.mouse.move(950, 350);
  await page.mouse.wheel(0, -1800);
  await expect.poll(async () => Number(await country.getAttribute("data-country-zoom"))).toBeGreaterThan(2.5);
  expect((await glyph.boundingBox())!.width).toBeGreaterThan(before.width * 2);
  const bitmap = await page.locator(".country-overview-raster").evaluate((node: HTMLCanvasElement) => ({
    width: node.width, height: node.height, cssWidth: node.clientWidth, cssHeight: node.clientHeight,
    transform: getComputedStyle(node).transform, smoothing: node.getContext("2d")!.imageSmoothingEnabled,
  }));
  expect(bitmap.width).toBe(bitmap.cssWidth * 2);
  expect(bitmap.height).toBe(bitmap.cssHeight * 2);
  expect(bitmap.transform).toBe("none");
  expect(bitmap.smoothing).toBe(false);
  await page.screenshot({ path: "screenshots/atlas-transport/country-close-retina.png" });
});
