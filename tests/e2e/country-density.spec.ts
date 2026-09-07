import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import type { CountryOverviewDto } from "../../src/shared/country-overview-contract";
import { COUNTRY_DENSE_LABEL_LIMIT, COUNTRY_DENSE_LEADER_LIMIT_PX } from "../../src/client/country-city-labels";

test.skip(process.env.E2E_COUNTRY_DENSITY_FIXTURE !== "true", "Read-only, explicitly selected 100-city local fixture only");

async function openCountry(page: Page): Promise<CountryOverviewDto> {
  await page.goto("/");
  await page.getByLabel("Email").fill(process.env.E2E_NAVIGATION_EMAIL ?? "release-scale-d@tasktopia.local");
  await page.getByLabel("Пароль").fill(process.env.E2E_NAVIGATION_PASSWORD ?? "local-scale-fixture-only");
  const overview = page.waitForResponse(response => /\/api\/countries\/[^/]+\/overview$/.test(new URL(response.url()).pathname) && response.ok());
  await page.getByRole("button", { name: "Открыть страну" }).click();
  const dto = await (await overview).json() as CountryOverviewDto;
  expect(dto.cities).toHaveLength(100);
  await expect(page.locator(".country-overview")).toHaveAttribute("data-country-ready", "true", { timeout: 60_000 });
  return dto;
}

async function verifyCountry(page: Page, dto: CountryOverviewDto): Promise<void> {
  const map = page.locator(".country-overview");
  await expect(map).toHaveAttribute("data-country-overview-cities", "100");
  await expect(map).toHaveAttribute("data-country-label-mode", "dense");
  await expect(map).toHaveAttribute("data-country-miniature-cells", String(dto.cities.reduce((sum, city) => sum + city.miniature.blocks.length, 0)));
  const visible = map.locator(".country-overview-city:visible");
  expect(await visible.count()).toBeLessThanOrEqual(COUNTRY_DENSE_LABEL_LIMIT);
  await expect(map).toHaveAttribute("data-country-visible-labels", String(await visible.count()));
  const boxes = await visible.evaluateAll(nodes => nodes.map(node => {
    const rect = node.getBoundingClientRect(); return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom };
  }));
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i]!, b = boxes[j]!;
    expect(a.x < b.right && a.right > b.x && a.y < b.bottom && a.bottom > b.y).toBe(false);
  }
  for (const width of await map.locator(".country-city-leader:visible").evaluateAll(nodes => nodes.map(node => parseFloat((node as HTMLElement).style.width)))) {
    expect(width).toBeLessThanOrEqual(COUNTRY_DENSE_LEADER_LIMIT_PX + .01);
  }
}

async function exerciseDirectory(page: Page, dto: CountryOverviewDto, touch: boolean, context: BrowserContext) {
  const reads: string[] = [];
  page.on("request", request => {
    const url = new URL(request.url());
    if (request.method() === "GET" && url.pathname.startsWith("/api/") && url.pathname !== "/api/events") reads.push(url.pathname);
  });
  const toggle = page.locator(".country-city-directory-toggle");
  const retainedRaster = await page.locator(".country-overview canvas").elementHandle();
  const retainedTransform = await page.locator(".country-overview canvas").getAttribute("style");
  await toggle.click();
  const directory = page.getByRole("dialog", { name: "Города страны" });
  const search = directory.getByLabel("Найти город");
  await expect(search).toBeFocused();
  const ids = await directory.locator("[data-directory-city-id]").evaluateAll(nodes => nodes.map(node => node.getAttribute("data-directory-city-id")));
  expect(ids.sort()).toEqual(dto.cities.map(city => city.id).sort());
  const map = page.locator(".country-overview");
  const zoom = await map.getAttribute("data-country-zoom");
  const scroll = directory.locator(".country-city-directory-results");
  if (touch) {
    // Real browser touch dispatch verifies native scroll, unlike synthetic
    // PointerEvents, which cannot exercise touch-action/scroll arbitration.
    const session = await context.newCDPSession(page);
    const box = (await scroll.boundingBox())!;
    const point = { x: box.x + box.width / 2, y: box.y + Math.min(box.height - 12, 180) };
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...point, id: 1 }] });
    for (let step = 1; step <= 6; step++) await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: point.x, y: point.y - step * 20, id: 1 }] });
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await session.detach();
  } else {
    await scroll.hover();
    await page.mouse.wheel(0, 360);
  }
  await expect.poll(() => scroll.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
  await expect(map).toHaveAttribute("data-country-zoom", zoom!);
  const target = [...dto.cities].sort((a, b) => a.name.localeCompare(b.name, "ru", { numeric: true })).at(-1)!;
  await search.fill("no-such-city-for-local-density-qa");
  await expect(directory.getByRole("status")).toHaveText("Город не найден");
  await search.fill(target.name);
  await expect(directory.locator("[data-directory-city-id]")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(directory).toHaveCount(0);
  await expect(toggle).toBeFocused();
  await toggle.press("Enter");
  await expect(directory.locator("[data-directory-city-id]")).toHaveCount(100);
  await search.fill(target.name);
  await expect(map).toHaveAttribute("data-country-zoom", zoom!);
  expect(await retainedRaster!.evaluate(node => node === document.querySelector(".country-overview canvas"))).toBe(true);
  await expect(map.locator("canvas")).toHaveAttribute("style", retainedTransform!);
  expect(reads).toEqual([]);
  return { target, button: directory.locator(`[data-directory-city-id='${target.id}']`) };
}

test.describe("desktop dense-country directory", () => {
  test.use({ viewport: { width: 1440, height: 1000 } });
  test("does not expose unpacked label hit targets while atlas images are still loading", async ({ page }) => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let held = 0;
    await page.route("**/atlas/terrain-v4/country/*.png", async route => { held++; await gate; await route.continue(); });
    const loading = openCountry(page);
    try {
      await expect.poll(() => held).toBeGreaterThan(0);
      const map = page.locator(".country-overview");
      await expect(map).toHaveAttribute("data-country-ready", "false");
      await expect(map.locator(".country-overview-city")).toHaveCount(100);
      await expect(map.locator(".country-overview-city:visible")).toHaveCount(0);
      await map.locator(".country-overview-city").first().evaluate(element => (element as HTMLButtonElement).focus());
      await expect(map.locator(".country-overview-city").first()).not.toBeFocused();
    } finally { release(); }
    const dto = await loading;
    await verifyCountry(page, dto);
  });
  test("keeps every city accessible without overlapping cards, extra GETs or map scrolling", async ({ page, context }, info) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    const dto = await openCountry(page);
    await verifyCountry(page, dto);
    if (process.env.COUNTRY_DENSITY_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.COUNTRY_DENSITY_SCREENSHOT_DIR}/country-100-cities.png` });
    const map = page.locator(".country-overview");
    const surface = page.locator(".country-map-gesture-surface");
    const bounds = (await surface.boundingBox())!;
    await page.mouse.move(bounds.x + bounds.width - 3, bounds.y + bounds.height / 2);
    const zoom = Number(await map.getAttribute("data-country-zoom"));
    await page.mouse.wheel(0, -900);
    await expect.poll(async () => Number(await map.getAttribute("data-country-zoom"))).toBeGreaterThan(zoom);
    // Let the smooth zoom finish before comparing a pan, rather than counting
    // a still-running zoom animation as evidence of pointer movement.
    await expect.poll(async () => Number(await map.getAttribute("data-country-zoom"))).toBeCloseTo(Math.min(2.6, zoom * Math.exp(1.35)), 1);
    await map.locator("canvas").evaluate(canvas => new Promise<void>(resolve => {
      let previous = "", stableFrames = 0;
      const check = () => {
        const next = canvas.getAttribute("style") ?? "";
        stableFrames = next === previous ? stableFrames + 1 : 0;
        previous = next;
        if (stableFrames >= 3) resolve(); else requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
    }));
    const transform = await map.locator("canvas").getAttribute("style");
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width - 123, bounds.y + bounds.height / 2 + 60, { steps: 6 });
    await page.mouse.up();
    await expect.poll(() => map.locator("canvas").getAttribute("style")).not.toBe(transform);
    await verifyCountry(page, dto);
    const { target, button } = await exerciseDirectory(page, dto, false, context);
    await button.click();
    await expect(page.locator(".world-canvas")).toHaveAttribute("data-city-scene-commit", "atomic", { timeout: 60_000 });
    await expect(page.locator(".header-city strong")).toHaveText(target.name);
    expect(errors).toEqual([]);
    await info.attach("density-selection", { body: Buffer.from(JSON.stringify({ cities: dto.cities.length, selectedCityId: target.id, viewport: page.viewportSize() })), contentType: "application/json" });
  });
});

test.describe("touch dense-country directory", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  test("scrolls all 100 city choices natively and opens a late city with keyboard without zooming", async ({ page, context }) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    const dto = await openCountry(page);
    await verifyCountry(page, dto);
    const { target, button } = await exerciseDirectory(page, dto, true, context);
    await page.keyboard.press("Tab");
    await expect(button).toBeFocused();
    if (process.env.COUNTRY_DENSITY_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.COUNTRY_DENSITY_SCREENSHOT_DIR}/country-100-cities-mobile-directory.png` });
    await button.press("Enter");
    await expect(page.locator(".world-canvas")).toHaveAttribute("data-city-scene-commit", "atomic", { timeout: 60_000 });
    await expect(page.locator(".header-city strong")).toHaveText(target.name);
    expect(errors).toEqual([]);
  });
});
