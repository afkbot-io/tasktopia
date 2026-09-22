import { expect, test } from "@playwright/test";

test.use({ deviceScaleFactor: 2 });
test("planet camera retains terrain cells while zooming and keeps pixel materials", async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect((await page.request.post("/api/auth/login", { data: { email: "demo@tasktopia.local", password: "tasktopia-demo" } })).ok()).toBe(true);
  await page.goto("/");
  await page.getByRole("button", { name: "Планета", exact: true }).click();
  const planet = page.locator(".planet-atlas"), land = page.locator(".planet-country-terrain").first();
  await expect(planet).toHaveAttribute("data-planet-ready", "true");
  await expect(page.locator(".map-level-transition")).toHaveCount(0);
  await expect(land).toBeVisible();
  await land.evaluate(node => {
    const observer = new MutationObserver(changes => { node.setAttribute("data-camera-mutations", String(Number(node.getAttribute("data-camera-mutations") ?? 0) + changes.length)); });
    // Geometry and children only; diagnostic attributes are excluded.
    observer.observe(node, { attributes: true, attributeFilter: ["x", "y", "width", "height", "href"], subtree: true, childList: true });
    node.addEventListener("qa-stop-observer", () => observer.disconnect(), { once: true });
  });
  const cell = land.locator(".planet-terrain-sprite").first(), before = (await cell.boundingBox())!;
  const zoom = Number(await planet.getAttribute("data-globe-zoom"));
  await planet.evaluate(node => node.addEventListener("wheel", event => {
    node.setAttribute("data-qa-wheel-delta", String((event as WheelEvent).deltaY));
  }, { once: true }));
  await page.mouse.move(800, 400);
  await page.mouse.wheel(0, -350);
  await expect(planet).toHaveAttribute("data-qa-wheel-delta");
  // Chromium and WebKit normalize Playwright wheel input differently at DPR2.
  const delta = Number(await planet.getAttribute("data-qa-wheel-delta"));
  await expect(planet).toHaveAttribute("data-globe-zoom", (zoom * Math.exp(-delta * .0015)).toFixed(2));
  expect((await cell.boundingBox())!.width).toBeGreaterThan(before.width);
  expect(await land.getAttribute("data-camera-mutations")).toBeNull();
  expect(await cell.locator("image").first().evaluate(node => getComputedStyle(node).imageRendering)).toBe("pixelated");
  await page.screenshot({ path: info.outputPath("planet-retained-terrain.png") });
  await land.dispatchEvent("qa-stop-observer");
  await page.locator(".planet-city-targets [data-city-id]").first().focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".world-canvas")).toHaveAttribute("data-city-scene-commit", "atomic");
});
