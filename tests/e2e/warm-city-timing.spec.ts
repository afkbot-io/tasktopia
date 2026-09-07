import { expect, test } from "@playwright/test";
import { armWarmCityTiming } from "./helpers/warm-city-timing";

for (const activationDelay of [0, 1_100]) test(`warm timing measures ${activationDelay} ms activation independently of driver waits`, async ({ page }) => {
  await page.setContent(`<button class="country-overview-city">Город</button>
    <div class="world-canvas" data-map-active="false" data-city-scene-commit="atomic" data-ground-bake-queue="0"></div>`);
  await armWarmCityTiming(page);
  await page.evaluate(delay => {
    document.querySelector("button")!.addEventListener("click", () => {
      setTimeout(() => { (document.querySelector(".world-canvas") as HTMLElement).dataset.mapActive = "true"; }, delay);
    });
  }, activationDelay);
  await page.waitForTimeout(1_100);
  await page.getByRole("button", { name: "Город" }).click();
  const host = page.locator(".world-canvas");
  await expect(host).toHaveAttribute("data-qa-warm-return-ms", /\d/);
  const measured = Number(await host.getAttribute("data-qa-warm-return-ms"));
  if (activationDelay === 0) expect(measured).toBeLessThan(1_000);
  else expect(measured).toBeGreaterThanOrEqual(1_100);
  // A delayed driver read must not keep increasing the captured measurement.
  await page.waitForTimeout(300);
  expect(Number(await host.getAttribute("data-qa-warm-return-ms"))).toBe(measured);
});
