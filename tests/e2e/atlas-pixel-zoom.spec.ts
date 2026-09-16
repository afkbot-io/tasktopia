import { miniatureTransportMarkers } from "../../src/shared/city-miniature";
import type { CountryOverviewDto } from "../../src/shared/country-overview-contract";
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

test("planet uses the same real landmark families as country and grows them on zoom", async ({ page }, info) => {
  const errors: string[]=[]; page.on("pageerror",error=>errors.push(error.message));
  expect((await page.request.post("/api/auth/login", {data:{email:"demo@tasktopia.local",password:"tasktopia-demo"}})).ok()).toBe(true);
  const bootstrap=await (await page.request.get("/api/bootstrap")).json();
  const overview:CountryOverviewDto=await (await page.request.get(`/api/countries/${bootstrap.country.id}/overview`)).json();
  await page.goto("/");
  await page.getByRole("button",{name:"Планета",exact:true}).click();
  await expect(page.locator(".planet-atlas")).toHaveAttribute("data-planet-ready", "true");
  await expect(page.locator(".map-level-transition")).toHaveCount(0);
  const houses=page.locator(`.planet-country[data-country-id="${bootstrap.country.id}"] .planet-district-houses image`);
  await expect(houses.first()).toBeVisible();
  const families=await houses.evaluateAll(nodes=>nodes.map(n=>n.getAttribute("data-building-family")).sort());
  expect(families).toEqual(overview.cities.flatMap(city=>[...city.miniature.blocks,...miniatureTransportMarkers(city.miniature)].map(b=>b.family)).sort());
  const before=Number(await houses.first().getAttribute("width"));
  await page.mouse.move(800,400); await page.mouse.wheel(0,-800);
  await expect.poll(async()=>Number(await houses.first().getAttribute("width"))).toBeGreaterThan(before);
  await page.screenshot({path:info.outputPath("planet-landmarks.png")});
  expect(errors).toEqual([]);
});

test("country remains usable when building images fail and restores them on retry",async({page})=>{
  expect((await page.request.post("/api/auth/login",{data:{email:"demo@tasktopia.local",password:"tasktopia-demo"}})).ok()).toBe(true);
  await page.goto("/");
  await expect(page.locator(".world-canvas")).toHaveAttribute("data-city-scene-commit","atomic", { timeout: 60_000 });
  await page.route("**/buildings/**",route=>route.abort("failed"));
  await page.getByRole("button",{name:"Страна",exact:true}).click();
  const country=page.locator(".country-overview");
  await expect(country).toHaveAttribute("data-country-ready","true");
  await expect(page.locator(".country-overview-warning")).toContainText("Часть зданий");
  await expect(page.locator(".country-overview-city").first()).toBeVisible();
  expect(Number(await country.getAttribute("data-country-miniatures-expected"))).toBeGreaterThan(0);
  await page.unroute("**/buildings/**");
  await page.getByRole("button",{name:"Повторить загрузку карты",exact:true}).click();
  await expect.poll(async()=>{
    const loaded=Number(await country.getAttribute("data-country-miniatures-loaded"));
    const expected=Number(await country.getAttribute("data-country-miniatures-expected"));
    return expected>0 && loaded===expected;
  }).toBe(true);
  await expect(page.locator(".country-overview-warning")).toHaveCount(0);
});

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
  await page.locator(".planet-country-label").first().click();
  await expect(page.locator(".country-overview")).toHaveAttribute("data-country-ready", "true");
});
