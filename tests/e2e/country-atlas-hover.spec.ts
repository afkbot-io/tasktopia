import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 1440, height: 900 } });
test.skip(process.env.E2E_ATLAS_FIXTURE !== "true", "Run against the dedicated fixture with npm run test:atlas");

test("all atlas cities hover safely and drive the compact header", async ({ page }) => {
  const browserErrors: string[] = [];
  const fullBuildingRequests: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("request", (request) => {
    if (request.url().includes("/game-assets/v5/buildings/")) fullBuildingRequests.push(request.url());
  });

  await page.goto("/");
  await page.getByLabel("Email").fill("world-validation@tasktopia.local");
  await page.getByLabel("Пароль").fill("tasktopia-world-validation");
  await page.getByRole("button", { name: "Открыть страну" }).click();
  browserErrors.length = 0;

  const atlas = page.locator(".country-atlas");
  await expect(atlas).toHaveAttribute("data-country-atlas-cities", "10", { timeout: 45_000 });
  await expect(page.getByRole("banner").getByLabel("MCP-интеграции")).toHaveCount(0);
  const search = page.getByPlaceholder("Поиск задачи: № или название");
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
    const name = await city.locator(".atlas-city-label text").first().textContent();
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
  expect(browserErrors).toEqual([]);
});

test("a city miniature click opens the exact district instead of a task card", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Email").fill("world-validation@tasktopia.local");
  await page.getByLabel("Пароль").fill("tasktopia-world-validation");
  await page.getByRole("button", { name: "Открыть страну" }).click();
  await expect(page.locator(".country-atlas")).toHaveAttribute("data-country-atlas-cities", "10", { timeout: 45_000 });

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
