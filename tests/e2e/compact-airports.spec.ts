import { openMapPlanet } from "./map-navigation";
import { mkdir, readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

test.skip(process.env.E2E_COMPACT_AIRPORTS !== "true", "Dedicated two-city task-backed airport fixture");
test("completed task airports launch compact flights and retain their identity in both map levels", async ({ page }, info) => {
  test.setTimeout(90_000);
  // Read the published contract without importing browser/Vite catalog code
  // into Playwright's Node runner (which has no import.meta.env transform).
  const manifest = JSON.parse(await readFile("assets/pixel-city-pack/manifest.json", "utf8"));
  const airport = manifest.buildings["compact-airport-v1"];
  const airportUrl = `/game-assets/v5/revisions/${manifest.assetRevision}/${airport.stages[4]}`;
  const errors: string[] = [], assets: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (request.url().includes("/game-assets/")) assets.push(request.url()); });
  page.on("response", response => { if (response.status() >= 400) errors.push(`${response.status()} ${new URL(response.url()).pathname}`); });
  expect((await page.request.post("/api/auth/login", { data: { email: "demo@tasktopia.local", password: "tasktopia-demo" } })).status()).toBe(200);
  await page.goto("/");
  await page.getByRole("button", { name: "Открыть город Северный терминал", exact: true }).focus();
  await page.keyboard.press("Enter");
  const host = page.locator(".world-canvas");
  await expect(host).toHaveAttribute("data-city-scene-commit", "atomic", { timeout: 45_000 });
  await expect(host).toHaveAttribute("data-airport-flight-routes", "2");
  await expect(host).toHaveAttribute("data-airplane-space", "world");
  await expect(host).toHaveAttribute("data-airplane", "flying", { timeout: 30_000 });
  await expect(host).toHaveAttribute("data-airplane-variant", "micro-regional");
  await mkdir("screenshots/compact-rc-airports", { recursive: true });
  await page.screenshot({ path: "screenshots/compact-rc-airports/city.png" });
  expect(assets.some(url => url.endsWith(airportUrl))).toBe(true);
  await openMapPlanet(page);
  await expect(page.locator(".planet-atlas")).toHaveAttribute("data-planet-ready", "true");
  const flights = page.locator(".planet-routes .atlas-aircraft-flight");
  await expect(flights).toHaveCount(1);
  await expect(flights).toHaveAttribute("data-route-id", /.+/);
  await page.screenshot({ path: "screenshots/compact-rc-airports/planet.png" });
  expect(errors).toEqual([]);
  await info.attach("airport-identity", { body: JSON.stringify({ cityRoutes: 2, planetFlights: 1, errors }), contentType: "application/json" });
});
