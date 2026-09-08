import { mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import type { CountryOverviewDto } from "../../src/shared/country-overview-contract";

test.skip(process.env.E2E_OVERVIEW_MATERIAL_FIXTURE !== "true", "Read-only isolated overview fixture required");
test.use({ viewport: { width: 1600, height: 1100 } });

test("finer overview materials retain selected geography and bounded raster on round trips", async ({ page }, info) => {
  const directory = process.env.OVERVIEW_MATERIAL_SCREENSHOTS ?? "screenshots/overview-materials";
  await mkdir(directory, { recursive: true });
  await page.clock.setFixedTime(new Date("2026-09-06T09:00:00Z"));
  const errors: string[] = [], warnings: string[] = [], reads: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error") errors.push(message.text());
    if (message.type() === "warning") {
      warnings.push(message.text());
      if (/WebGL.*(?:INVALID|error)|PixiJS Deprecation|Unable to preventDefault/i.test(message.text())) errors.push(message.text());
    }
  });
  page.on("response", response => { if (response.status() >= 400) errors.push(`${response.status()} ${new URL(response.url()).pathname}`); });
  page.on("requestfailed", request => errors.push(`${new URL(request.url()).pathname}: ${request.failure()?.errorText}`));
  page.on("request", request => {
    const path = new URL(request.url()).pathname;
    if (request.method() === "GET" && /\/scene$|\/overview$|\/planet-atlas$|\/world\/viewport|\/chunks\//.test(path)) reads.push(path);
  });
  expect((await page.request.post("/api/auth/login", { data: {
    email: process.env.E2E_NAVIGATION_EMAIL ?? "demo@tasktopia.local",
    password: process.env.E2E_NAVIGATION_PASSWORD ?? "tasktopia-demo",
  } })).status()).toBe(200);
  const loaded = page.waitForResponse(response => new URL(response.url()).pathname.endsWith("/overview") && response.ok());
  await page.goto("/");
  await expect.poll(async () => await page.locator(".country-overview").isVisible() ||
    await page.locator(".world-canvas[data-city-scene-commit='atomic']").isVisible(), { timeout: 60_000 }).toBe(true);
  // A real multi-city country intentionally bootstraps at COUNTRY. Select a
  // real directory entry rather than forcing a map mode or synthesising DTOs.
  const countryBootstrap = await page.locator(".country-overview").isVisible();
  if (countryBootstrap) {
    await expect(page.locator(".country-overview")).toHaveAttribute("data-country-ready", "true");
    if (await page.locator(".country-overview").getAttribute("data-country-label-mode") === "dense") {
      await page.locator(".country-city-directory-toggle").click();
      await page.locator(".country-city-directory-results [data-directory-city-id]").first().click();
    } else await page.locator(".country-overview-city:visible").first().click();
  }
  await expect(page.locator(".world-canvas")).toHaveAttribute("data-city-scene-commit", "atomic");
  await expect(page.locator(".world-canvas")).toHaveAttribute("data-minimum-render-scale", "0.8");
  const cityCanvas = await page.locator("canvas[aria-label='Интерактивная карта города']").elementHandle();
  const cityState = () => page.locator(".world-canvas").evaluate(host => ({
    x: host.getAttribute("data-camera-world-x"), y: host.getAttribute("data-camera-world-y"),
    scale: host.getAttribute("data-render-scale"), session: host.getAttribute("data-agent-session"),
  }));
  await expect.poll(async () => (await cityState()).x).not.toBeNull();
  const retainedCity = await cityState();
  await page.getByRole("button", { name: "Город", exact: true }).click();
  await expect(page.locator(".map-level-transition")).toHaveCount(0);
  expect(await cityState()).toEqual(retainedCity);
  await page.getByRole("button", { name: "Страна", exact: true }).click();
  const overview = await (await loaded).json() as CountryOverviewDto;
  const country = page.locator(".country-overview");
  await expect(country).toHaveAttribute("data-country-ready", "true");
  await expect(country).toHaveAttribute("data-country-material-subdivisions", "2");
  await expect(page.locator(".map-level-transition")).toHaveCount(0);
  const dimensions = await page.locator(".country-overview-raster").evaluate((canvas: HTMLCanvasElement) => ({
    width: canvas.width, height: canvas.height, scale: new DOMMatrixReadOnly(getComputedStyle(canvas).transform).a,
  }));
  const { columns, rows, cellSize } = overview.geography;
  expect(dimensions.width).toBe(columns * cellSize * 4);
  expect(dimensions.height).toBe(rows * cellSize * 4);
  await expect(country).toHaveAttribute("data-country-material-patches", String(columns * rows * 4));
  const materialScreenSize = cellSize / 4 * dimensions.scale;
  const blockGlyphScreenWidth = 1.45 * dimensions.scale;
  expect(materialScreenSize).toBeLessThan(blockGlyphScreenWidth);
  await page.screenshot({ path: `${directory}/country.png` });

  await page.getByRole("button", { name: "Планета", exact: true }).click();
  await expect(page.locator(".planet-atlas")).toHaveAttribute("data-planet-ready", "true");
  await expect(page.locator(".planet-atlas")).toHaveAttribute("data-planet-material-subdivisions", "2");
  await expect(page.locator(".map-level-transition")).toHaveCount(0);
  const macroCells = await page.locator(".planet-terrain-sprite").count();
  expect(macroCells).toBeGreaterThan(0);
  await expect(page.locator(".planet-terrain-sprite > svg")).toHaveCount(macroCells * 4);
  const districtIds = await page.locator(".planet-district-houses [data-district-id]").evaluateAll(nodes => nodes.map(node => node.getAttribute("data-district-id")));
  expect(districtIds.length).toBeGreaterThan(0);
  expect(new Set(districtIds).size).toBe(districtIds.length);
  await page.screenshot({ path: `${directory}/planet.png` });
  const returnStarted = performance.now();
  await page.getByRole("button", { name: "Город", exact: true }).click();
  await expect(page.locator(".world-canvas")).toBeVisible();
  await expect(page.locator(".map-level-transition")).toHaveCount(0);
  const directCityReturnMs = performance.now() - returnStarted;
  expect(await cityCanvas!.evaluate(canvas => canvas === document.querySelector("canvas[aria-label='Интерактивная карта города']"))).toBe(true);
  expect(await cityState()).toEqual(retainedCity);
  await page.getByRole("button", { name: "Планета", exact: true }).click();
  await expect(page.locator(".planet-atlas")).toHaveAttribute("data-planet-ready", "true");
  await expect(page.locator(".map-level-transition")).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${directory}/planet-mobile.png` });
  await page.getByRole("button", { name: "Страна", exact: true }).click();
  await expect(country).toHaveAttribute("data-country-ready", "true");
  await expect(page.locator(".map-level-transition")).toHaveCount(0);
  await page.screenshot({ path: `${directory}/country-mobile.png` });
  await page.getByRole("button", { name: "Город", exact: true }).click();
  await expect(page.locator(".world-canvas")).toHaveAttribute("data-city-scene-commit", "atomic");
  await expect(page.locator(".world-canvas")).toBeVisible();
  await expect(page.locator(".map-level-transition")).toHaveCount(0);
  expect(await cityCanvas!.evaluate(canvas => canvas.isConnected)).toBe(true);
  expect((await cityState()).session).toBe(retainedCity.session);
  for (const suffix of ["/scene", "/overview", "/planet-atlas"]) expect(reads.filter(path => path.endsWith(suffix))).toHaveLength(1);
  expect(reads.filter(path => /\/world\/viewport|\/chunks\//.test(path))).toEqual([]);
  expect(errors).toEqual([]);
  await info.attach("overview-materials", { body: JSON.stringify({ viewport: [1600, 1100], countryId: overview.countryId,
    selectedCityId: overview.cities[0]?.id, geography: overview.geography, dimensions, materialScreenSize,
    blockGlyphScreenWidth, macroCells, districtIds, countryBootstrap, cities: overview.cities.length,
    groundRoads: overview.groundRoads, retainedCity, directCityReturnMs, reads, errors, warnings }), contentType: "application/json" });
});
