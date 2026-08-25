import { expect, test, type Page } from "@playwright/test";

test.use({ viewport: { width: 1440, height: 900 } });
test.skip(process.env.E2E_ATLAS_FIXTURE !== "true", "Run against the dedicated fixture with npm run test:atlas");

async function loginAndOpenCountryAtlas(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Email").fill("world-validation@tasktopia.local");
  await page.getByLabel("Пароль").fill("tasktopia-world-validation");
  await page.getByRole("button", { name: "Открыть страну" }).click();
  const countryTitle = page.locator(".country-title-button strong");
  if (await countryTitle.textContent() !== "Федерация Новостроек") {
    await page.locator(".country-title-button").click();
    await page.getByRole("dialog", { name: "Выбор страны" }).getByRole("button").filter({ hasText: "Федерация Новостроек" }).click();
  }
  await expect(page.locator(".country-atlas")).toHaveAttribute("data-country-atlas-cities", "10", { timeout: 45_000 });
}

test("all atlas cities hover safely and drive the compact header", async ({ page }, testInfo) => {
  const browserErrors: string[] = [];
  const fullBuildingRequests: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("request", (request) => {
    if (request.url().includes("/game-assets/v5/buildings/")) fullBuildingRequests.push(request.url());
  });

  await loginAndOpenCountryAtlas(page);
  browserErrors.length = 0;

  await expect(page.getByRole("banner").getByLabel("MCP-интеграции")).toHaveCount(0);
  const header = page.getByLabel("Панель управления страной");
  await expect(header.getByRole("button", { name: "Карта", exact: true })).toHaveCount(0);
  await expect(header.getByRole("button", { name: "План", exact: true })).toHaveCount(0);
  await expect(page.locator(".map-help")).toHaveCount(0);
  await page.locator(".country-title-button").click();
  await page.getByRole("dialog", { name: "Выбор страны" }).getByRole("button", { name: "План страны" }).click();
  await expect(page.getByRole("complementary", { name: "План страны" })).toBeVisible();
  await page.getByRole("button", { name: "Закрыть план" }).click();
  const accountBox = await page.getByRole("button", { name: /Настройки аккаунта/ }).boundingBox();
  expect(accountBox).not.toBeNull();
  expect(Math.abs(accountBox!.width - accountBox!.height)).toBeLessThanOrEqual(1);
  const search = page.getByPlaceholder("Поиск здания: № или название");
  await expect(search).toBeVisible();

  const cities = page.locator(".atlas-city");
  await expect(cities).toHaveCount(10);
  const buildingProfiles = await page.locator("[data-atlas-profile]").evaluateAll((nodes) =>
    [...new Set(nodes.map((node) => node.getAttribute("data-atlas-profile")))].sort(),
  );
  expect(buildingProfiles).toEqual(["courtyard", "flat", "gable", "stepped"]);
  expect(fullBuildingRequests).toEqual([]);
  for (let index = 0; index < 10; index += 1) {
    const city = cities.nth(index);
    const label = city.locator(".atlas-city-label .atlas-overview-card");
    const ariaLabel = await label.getAttribute("aria-label");
    const name = ariaLabel?.match(/^Открыть город (.*?), \d+/)?.[1];
    expect(name).toBeTruthy();
    await city.locator(".atlas-city-label").hover();
    await expect(page.locator(".header-city strong")).toHaveText(name!);
  }
  await page.locator(".country-atlas").hover({ position: { x: 2, y: 2 } });
  await expect(page.locator(".header-city")).toHaveCount(0);
  // Building markers intentionally sit above their owning district and intercept
  // pointer input so they can open the exact district. Exercise the district's
  // equivalent keyboard-focus contract instead of forcing a pointer through a
  // valid interactive child.
  await page.locator(".atlas-district").first().focus();
  const tooltip = page.getByRole("tooltip");
  await expect(tooltip).toBeVisible();
  expect((await tooltip.boundingBox())!.width).toBeGreaterThanOrEqual(160);

  const cacheMetrics = await page.evaluate(async () => {
    const startedAt = performance.now();
    const response = await fetch("/api/country-atlas", { cache: "no-store" });
    const payload = await response.arrayBuffer();
    return {
      bytes: payload.byteLength,
      durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
      status: response.status,
    };
  });
  expect(cacheMetrics.status).toBe(200);
  expect(cacheMetrics.bytes).toBeLessThan(2_000_000);
  expect(cacheMetrics.durationMs).toBeLessThan(1_500);
  console.info("country-atlas-cache-metrics", JSON.stringify(cacheMetrics));
  await testInfo.attach("country-atlas-cache-metrics", {
    body: Buffer.from(JSON.stringify(cacheMetrics, null, 2)),
    contentType: "application/json",
  });
  if (process.env.ATLAS_SCREENSHOT_PATH) {
    await page.screenshot({ path: process.env.ATLAS_SCREENSHOT_PATH, fullPage: true });
  }
  expect(browserErrors).toEqual([]);
});

test("planet, country and city levels keep selection and disabled states coherent", async ({ page }) => {
  await loginAndOpenCountryAtlas(page);

  const planetFixture = await page.evaluate(async () => {
    const bootstrap = await fetch("/api/bootstrap").then((response) => response.json()) as { country: { id: string }; countries: unknown[] };
    if (bootstrap.countries.length < 2) {
      await fetch("/api/countries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Островная страна" }),
      });
    }
    const atlas = await fetch("/api/planet-atlas", { cache: "no-store" }).then((response) => response.json()) as { countries: unknown[] };
    return { originalCountryId: bootstrap.country.id, countryCount: atlas.countries.length };
  });

  const levels = page.getByRole("navigation", { name: "Уровень карты" });
  await levels.getByRole("button", { name: "Планета" }).click();
  await expect(page.locator(".planet-atlas")).toHaveAttribute("data-planet-countries", String(planetFixture.countryCount));
  await expect(page.locator(".planet-atlas")).toHaveAttribute("data-planet-renderer", "square-pixel-map");
  await expect(page.locator(".planet-globe-shadow, .planet-globe-atmosphere, .planet-globe-hint")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Настройки аккаунта, в сети/i })).toBeVisible();
  await expect(page.getByText("В сети", { exact: true })).toHaveCount(0);
  const countryLabelBoxes = await page.locator(".planet-country-label .atlas-overview-card-hit").evaluateAll((nodes) => nodes.map((node) => {
    const box = (node as SVGGraphicsElement).getBoundingClientRect();
    return { width: box.width, height: box.height };
  }));
  expect(new Set(countryLabelBoxes.map((box) => `${Math.round(box.width)}:${Math.round(box.height)}`)).size).toBe(1);
  const globe = page.locator(".planet-atlas svg");
  const globeBox = await globe.boundingBox();
  expect(globeBox).not.toBeNull();
  await page.mouse.move(globeBox!.x + globeBox!.width / 2, globeBox!.y + globeBox!.height / 2);
  await page.mouse.wheel(0, -120);
  await expect(page.locator(".planet-atlas")).toHaveAttribute("data-globe-zoom", "1.20");
  const zoomedCountryLabelBoxes = await page.locator(".planet-country-label .atlas-overview-card-hit").evaluateAll((nodes) => nodes.map((node) => {
    const box = (node as SVGGraphicsElement).getBoundingClientRect();
    return { width: Math.round(box.width), height: Math.round(box.height) };
  }));
  expect(new Set(zoomedCountryLabelBoxes.map((box) => `${box.width}:${box.height}`))).toEqual(
    new Set(countryLabelBoxes.map((box) => `${Math.round(box.width)}:${Math.round(box.height)}`)),
  );
  const planetCard = page.locator(".planet-country-label.atlas-overview-card").first();
  await expect(planetCard).toContainText("ГОРОДА");
  await expect(planetCard).toContainText("В РАБОТЕ");
  await expect(planetCard.locator(".atlas-overview-card-progress")).toContainText("%");
  if (process.env.ATLAS_SCREENSHOT_PATH) {
    await page.screenshot({ path: process.env.ATLAS_SCREENSHOT_PATH.replace(/\.png$/, "-planet.png"), fullPage: true });
  }
  await expect(page.locator(".planet-routes .atlas-aircraft-sprite").first()).toBeAttached();
  await expect(page.locator(".planet-routes .atlas-aircraft-frame-b")).toHaveCount(0);
  await expect(page.locator(".planet-routes .atlas-aircraft-trail").first()).toBeAttached();
  await expect(page.locator(".planet-airport-markers rect")).not.toHaveCount(0);
  await expect(page.locator('.planet-terrain-sprite[href*="/terrain/"]')).not.toHaveCount(0);
  await expect(page.locator('.planet-terrain-sprite[href*="atlas/terrain-v3/"]')).toHaveCount(0);
  await expect(page.locator('.planet-clouds image[href*="atlas/clouds-v2/"]')).not.toHaveCount(0);
  await expect(page.locator('.planet-routes image[href*="atlas/aircraft-v4/"]')).not.toHaveCount(0);
  await expect(page.locator('.planet-routes animateMotion[rotate="auto"]')).not.toHaveCount(0);
  await expect(page.locator('.planet-routes animateTransform[values="0.05;1;1;0.05"]')).not.toHaveCount(0);
  expect(await page.locator(".planet-routes .atlas-aircraft-sprite").first().evaluate((node) => getComputedStyle(node).imageRendering)).toBe("pixelated");
  expect(await page.locator(".planet-clouds > g").first().evaluate((node) => getComputedStyle(node).animationDirection)).toBe("alternate");
  await expect(levels.getByRole("button", { name: "Страна" })).toBeDisabled();
  await expect(levels.getByRole("button", { name: "Город" })).toBeDisabled();
  await expect(page.getByLabel("Панель управления страной").getByText(/Районов|Зданий/)).toHaveCount(0);

  const targetCountry = page.locator(`.planet-country[data-country-id="${planetFixture.originalCountryId}"]`);
  const targetBox = await targetCountry.boundingBox();
  expect(targetBox).not.toBeNull();
  await page.mouse.move(targetBox!.x + targetBox!.width / 2, targetBox!.y + targetBox!.height / 2);
  for (let index = 0; index < 24 && await page.locator(".planet-atlas").count() > 0; index += 1) {
    await page.mouse.wheel(0, -160);
    await page.waitForTimeout(35);
  }
  await expect(page.locator(".country-atlas")).toHaveAttribute("data-country-atlas-cities", "10", { timeout: 45_000 });
  const cityCard = page.locator(".atlas-city-label .atlas-overview-card").first();
  const cityCardSizes = await page.locator(".atlas-city-label .atlas-overview-card-hit").evaluateAll((nodes) => nodes.map((node) => {
    const box = (node as SVGGraphicsElement).getBoundingClientRect();
    return `${Math.round(box.width)}:${Math.round(box.height)}`;
  }));
  expect(new Set(cityCardSizes).size).toBe(1);
  await expect(page.locator(".atlas-airport-markers")).not.toHaveCount(0);
  await expect(page.locator('.atlas-clouds image[href*="atlas/clouds-v2/cloud-topdown-"]')).not.toHaveCount(0);
  await expect(page.locator(".country-world-fog rect")).not.toHaveCount(0);
  await expect(cityCard).toContainText("В РАБОТЕ");
  await expect(cityCard.locator(".atlas-overview-card-progress")).toContainText("%");
  await expect(cityCard).not.toContainText("РАЙОНА");
  if (process.env.ATLAS_SCREENSHOT_PATH) {
    await page.screenshot({ path: process.env.ATLAS_SCREENSHOT_PATH.replace(/\.png$/, "-country.png"), fullPage: true });
  }
  await expect(levels.getByRole("button", { name: "Страна" })).toHaveAttribute("aria-current", "page");
  await expect(levels.getByRole("button", { name: "Город" })).toBeDisabled();

  const zoomCity = page.locator(".atlas-city").first();
  const zoomCityBox = await zoomCity.locator(".atlas-city-cutout-outline").boundingBox();
  expect(zoomCityBox).not.toBeNull();
  await page.mouse.move(zoomCityBox!.x + zoomCityBox!.width / 2, zoomCityBox!.y + zoomCityBox!.height / 2);
  for (let index = 0; index < 28 && await page.locator(".country-atlas").count() > 0; index += 1) {
    await page.mouse.wheel(0, -160);
    await page.waitForTimeout(35);
  }
  await expect(page.locator(".world-canvas")).toBeVisible({ timeout: 45_000 });
  await expect(page.locator(".world-canvas")).toHaveAttribute("data-airports", /^[1-9]\d*$/, { timeout: 45_000 });
  await expect(page.locator(".world-canvas")).toHaveAttribute("data-airplane", "flying", { timeout: 20_000 });
  if (process.env.ATLAS_SCREENSHOT_PATH) {
    await page.screenshot({ path: process.env.ATLAS_SCREENSHOT_PATH.replace(/\.png$/, "-city.png"), fullPage: true });
  }
  await expect(levels.getByRole("button", { name: "Город" })).toHaveAttribute("aria-current", "page");
  await expect(levels.getByRole("button", { name: "Страна" })).toBeEnabled();
  await levels.getByRole("button", { name: "Страна" }).click();
  await expect(page.locator(".country-atlas")).toBeVisible();
});

test("city exits at its zoom boundary while country keeps its two-step parent guard", async ({ page }) => {
  await loginAndOpenCountryAtlas(page);
  const activeCountryId = await page.evaluate(async () => (await fetch("/api/bootstrap").then((response) => response.json()) as { country: { id: string } }).country.id);
  const atlas = page.locator(".country-atlas");
  const atlasBox = await atlas.boundingBox();
  expect(atlasBox).not.toBeNull();
  await page.mouse.move(atlasBox!.x + atlasBox!.width / 2, atlasBox!.y + atlasBox!.height / 2);
  await page.mouse.wheel(0, 120);
  await expect(atlas).toBeVisible();
  await page.mouse.wheel(0, 120);
  await expect(page.locator(".planet-atlas")).toBeVisible();

  await page.locator(`.planet-country-label[data-country-id="${activeCountryId}"]`).click();
  await page.locator(".atlas-city-label").first().click();
  const world = page.locator(".world-canvas");
  await expect(world).toBeVisible({ timeout: 45_000 });
  const worldBox = await world.boundingBox();
  expect(worldBox).not.toBeNull();
  await page.mouse.move(worldBox!.x + worldBox!.width / 2, worldBox!.y + worldBox!.height / 2);
  for (let index = 0; index < 15 && await world.count() > 0; index += 1) await page.mouse.wheel(0, 180);
  await expect(page.locator(".country-atlas")).toBeVisible();
});

test("a city miniature click opens the exact district instead of a task card", async ({ page }) => {
  await loginAndOpenCountryAtlas(page);

  const target = await page.evaluate(async () => {
    const atlas = await fetch("/api/country-atlas", { cache: "no-store" }).then((response) => response.json()) as {
      cities: Array<{
        districts: Array<{ id: string; name: string; sourceCenter: { x: number; y: number } }>;
        buildings: Array<{ taskNumber: number; title: string; districtId: string }>;
      }>;
    };
    for (const city of atlas.cities) {
      const building = city.buildings[0];
      const district = building && city.districts.find((entry) => entry.id === building.districtId);
      if (building && district) return { building, district };
    }
    throw new Error("The atlas fixture has no district building");
  });

  // Atlas markers are painted in depth order and may overlap within one
  // district. Click its topmost painted sprite so the test exercises the same
  // real hit target a user can reach instead of waiting on an occluded image.
  await page.locator(`.atlas-building[data-district-id="${target.district.id}"]`).last().click();

  await expect(page.locator(".task-modal")).toHaveCount(0);
  await expect(page.locator(".country-atlas")).toHaveCount(0);
  const host = page.locator(".world-canvas");
  await expect(host).toHaveAttribute("data-focus-x", String(target.district.sourceCenter.x));
  await expect(host).toHaveAttribute("data-focus-y", String(target.district.sourceCenter.y));
});

test("a session snapshot paints while the atlas revalidates in the background", async ({ page }) => {
  await loginAndOpenCountryAtlas(page);

  const revalidationHeaders: string[] = [];
  await page.route("**/api/country-atlas", async (route) => {
    revalidationHeaders.push(route.request().headers()["cache-control"] ?? "");
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    await route.continue();
  });
  await page.reload();
  await expect(page.locator(".country-atlas")).toHaveAttribute("data-country-atlas-cities", "10", { timeout: 700 });
  await expect.poll(() => revalidationHeaders.length).toBeGreaterThan(0);
  expect(revalidationHeaders.some((value) => value.includes("no-cache") || value.includes("max-age=0"))).toBe(true);
});

test("building search switches to the owning city before focusing the building", async ({ page }) => {
  await loginAndOpenCountryAtlas(page);

  const target = await page.evaluate(async () => {
    const atlas = await fetch("/api/country-atlas", { cache: "no-store" }).then((response) => response.json()) as {
      cities: Array<{
        id: string;
        name: string;
        buildings: Array<{ id: string; taskNumber: number; title: string; sourceOrigin: { x: number; y: number } }>;
      }>;
    };
    const city = atlas.cities.at(-1)!;
    const building = city.buildings.at(-1)!;
    return { city, building };
  });

  const search = page.getByLabel("Поиск здания по номеру или названию");
  await search.fill(String(target.building.taskNumber));
  await page.getByRole("option").filter({ hasText: target.building.title }).click();

  await expect(page.locator(".country-atlas")).toHaveCount(0);
  await expect(page.locator(".header-city strong")).toHaveText(target.city.name);
  await expect(page.locator(".world-canvas")).toHaveAttribute("data-focus-x", String(target.building.sourceOrigin.x));
  await expect(page.locator(".world-canvas")).toHaveAttribute("data-focus-y", String(target.building.sourceOrigin.y));
  await expect(page.getByRole("dialog").getByRole("heading", { name: target.building.title })).toBeVisible();
});
