import { expect, test, type Page } from "@playwright/test";
import type { CountryOverviewDto } from "../../src/shared/country-overview-contract";
import type { CitySceneDto } from "../../src/shared/city-scene-contract";

test.skip(process.env.E2E_ATLAS_WHEEL_FIXTURE !== "true", "Explicit local compact fixture only; no seed or world mutations");
test.use({ viewport: { width: 1440, height: 1000 } });

async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("Email").fill(process.env.E2E_NAVIGATION_EMAIL ?? "demo@tasktopia.local");
  await page.getByLabel("Пароль").fill(process.env.E2E_NAVIGATION_PASSWORD ?? "tasktopia-demo");
  await page.getByRole("button", { name: "Открыть страну" }).click();
  await expect(page.locator('.world-canvas[data-map-active="true"]')).toHaveAttribute("data-city-scene-commit", "atomic", { timeout: 60_000 });
}

test("one wheel burst crosses only one level, while reversing over the same city enters immediately", async ({ page }, info) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  const requests: string[] = [];
  let overview: CountryOverviewDto | undefined;
  let scene: CitySceneDto | undefined;
  page.on("pageerror", error => errors.push(error.message));
  page.on("response", async response => {
    const pathname = new URL(response.url()).pathname;
    if (pathname.endsWith("/overview") && response.ok()) overview = await response.json();
    if (pathname.endsWith("/scene") && response.ok()) scene = await response.json();
  });
  page.on("request", request => { if (/\/api\/(?:chunks|world\/viewport)/.test(new URL(request.url()).pathname)) requests.push(request.url()); });
  await login(page);
  const cityId = scene!.city.id;
  const canvas = page.locator("canvas[aria-label='Интерактивная карта города']");
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width * .5, box.y + box.height * .5);
  await page.mouse.wheel(0, 4_000);
  // Real wheel input continues during the transition and renderer preload.
  for (let step = 0; step < 30; step++) { await page.mouse.wheel(0, 80); await page.waitForTimeout(12); }
  const country = page.locator(".country-overview");
  await expect(country).toHaveAttribute("data-country-ready", "true");
  await expect(page.locator(".planet-atlas")).toHaveCount(0);
  await expect(page.locator(".map-level-transition")).toHaveCount(0);
  expect(overview!.schemaVersion).toBe(6);
  const city = overview!.cities.find(candidate => candidate.id === cityId)!;
  const focus = await country.evaluate((host, point) => {
    const canvas = host.querySelector("canvas")!;
    const transform = new DOMMatrix(getComputedStyle(canvas).transform);
    const bounds = host.getBoundingClientRect();
    return { x: bounds.left + transform.e + point.x * transform.a, y: bounds.top + transform.f + point.y * transform.d };
  }, city.atlasCenter);
  await page.mouse.move(focus.x, focus.y);
  // Opposite input is intentional; no retreat to .55 or timer at max zoom.
  await page.mouse.wheel(0, -4_000);
  await expect(page.locator('.world-canvas[data-map-active="true"]')).toHaveAttribute("data-city-scene-commit", "atomic");
  await expect(page.locator(".country-overview")).toHaveCount(0);
  expect(scene!.city.id).toBe(cityId);
  expect(requests).toEqual([]);
  expect(errors).toEqual([]);
  await info.attach("wheel-roundtrip", { body: JSON.stringify({ cityId, countryId: overview!.countryId, schemaVersion: overview!.schemaVersion, focus, errors, forbiddenReads: requests }), contentType: "application/json" });
});

test("COUNTRY exits on the first boundary delta and PLANET never enters a nearest country over empty space", async ({ page }) => {
  await login(page);
  await page.getByRole("button", { name: "Страна", exact: true }).click();
  await expect(page.locator(".country-overview")).toHaveAttribute("data-country-ready", "true");
  await expect(page.locator(".map-level-transition")).toHaveCount(0);
  const box = (await page.locator(".country-overview").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 4_000);
  await expect(page.locator(".planet-atlas")).toHaveAttribute("data-planet-ready", "true");
  const planet = (await page.locator(".planet-atlas svg").first().boundingBox())!;
  await page.mouse.move(planet.x + 3, planet.y + 3);
  for (let step = 0; step < 10; step++) await page.mouse.wheel(0, -240);
  await expect(page.locator(".planet-atlas")).toBeVisible();
  await expect(page.locator(".country-overview")).toHaveCount(0);
});
