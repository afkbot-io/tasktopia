import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

const screenshotDirectory = process.env.WORLD_VALIDATION_SCREENSHOT_DIR;
const onlyCityIndex = Number(process.env.WORLD_VALIDATION_ONLY_CITY ?? 0);
const cities = [
  "Янтарный Берег",
  "Северные Ворота",
  "Озероград",
  "Каменный Мост",
  "Лазурная Долина",
  "Новый Горизонт",
  "Речной Порт",
  "Зелёный Квартал",
  "Стальные Башни",
  "Город Будущего",
] as const;

test.use({ viewport: { width: 1920, height: 1080 } });

test("validates and captures ten new-build cities", async ({ page }) => {
  test.setTimeout(5 * 60_000);
  test.skip(!screenshotDirectory, "Run explicitly with WORLD_VALIDATION_SCREENSHOT_DIR");
  await mkdir(screenshotDirectory!, { recursive: true });
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto("/");
  await page.getByLabel("Email").fill("world-validation@tasktopia.local");
  await page.getByLabel("Пароль").fill("tasktopia-world-validation");
  await page.getByRole("button", { name: "Открыть страну" }).click();
  await expect(page.getByText("Федерация Новостроек", { exact: true })).toBeVisible();

  const host = page.locator(".world-canvas");
  const canvas = page.locator("canvas[aria-label='Интерактивная карта города']");
  const browserReport: Array<Record<string, string | number>> = [];
  for (let index = 0; index < cities.length; index += 1) {
    if (onlyCityIndex > 0 && index !== onlyCityIndex - 1) continue;
    consoleErrors.length = 0;
    const headerCity = page.locator(".header-city strong");
    // Atlas mode intentionally has no city heading. Never let that optional
    // element consume the full five-minute scenario timeout before opening
    // the requested city from the plan.
    const previousCity = await headerCity.textContent({ timeout: 1_000 }).catch(() => null);
    const previousAgentIds = await host.getAttribute("data-agent-ids", { timeout: 1_000 }).catch(() => null);
    await page.locator(".country-title-button").click();
    await page.getByRole("dialog", { name: "Выбор страны" }).getByRole("button", { name: "План страны" }).click();
    const drawer = page.getByRole("complementary", { name: "План страны" });
    await expect(drawer).toBeVisible();
    await drawer.locator(".plan-row > button:first-child", { hasText: cities[index] }).click();
    await expect(drawer).toBeHidden();
    await expect(headerCity).toHaveText(cities[index], { timeout: 45_000 });
    await expect.poll(async () => Number(await host.getAttribute("data-resident-chunks") ?? 0), { timeout: 45_000 })
      .toBeGreaterThan(0);
    await canvas.hover();
    for (let step = 0; step < 8 && await host.getAttribute("data-map-lod") !== "detail"; step += 1) {
      await page.mouse.wheel(0, -700);
      await page.waitForTimeout(120);
    }
    await expect(host).toHaveAttribute("data-map-lod", "detail", { timeout: 45_000 });
    await expect.poll(async () => Number(await host.getAttribute("data-world-objects") ?? 0), { timeout: 45_000 })
      .toBeGreaterThan(0);
    await expect.poll(async () => Number(await host.getAttribute("data-cars") ?? 0), { timeout: 45_000 })
      .toBeGreaterThan(0);
    await expect.poll(async () => Number(await host.getAttribute("data-walkers") ?? 0), { timeout: 45_000 })
      .toBeGreaterThan(0);
    if (previousCity && previousCity !== cities[index] && previousAgentIds) {
      await expect.poll(async () => await host.getAttribute("data-agent-ids"), { timeout: 45_000 })
        .not.toBe(previousAgentIds);
    }
    await expect.poll(async () => Number(await host.getAttribute("data-traffic-signals") ?? 0), { timeout: 45_000 })
      .toBeGreaterThanOrEqual(2);
    await expect(host).toHaveAttribute("data-wrong-way-cars", "0");
    await expect(host).toHaveAttribute("data-wrong-way-buses", "0");
    await expect(host).toHaveAttribute("data-traffic-unsafe-pairs", "0");
    await expect(host).toHaveAttribute("data-world-object-depth-errors", "0");
    await expect(host).toHaveAttribute("data-resident-center-errors", "0");
    const walkState = await host.getAttribute("data-resident-walk-state");
    const trafficLifetimeSteps = Number(await host.getAttribute("data-traffic-lifetime-steps") ?? 0);
    await expect.poll(async () => await host.getAttribute("data-resident-walk-state"), { timeout: 8_000 }).not.toBe(walkState);
    await expect.poll(async () => Number(await host.getAttribute("data-traffic-lifetime-steps") ?? 0), { timeout: 8_000 })
      .toBeGreaterThan(trafficLifetimeSteps);
    await expect.poll(async () => Number(await host.getAttribute("data-traffic-moving-vehicles") ?? 0), { timeout: 16_000 })
      .toBeGreaterThan(0);

    await page.waitForTimeout(600);
    const metric = async (name: string): Promise<number> => Number(await host.getAttribute(`data-${name}`) ?? 0);
    browserReport.push({
      index: index + 1,
      city: cities[index],
      lod: await host.getAttribute("data-map-lod") ?? "unknown",
      residentChunks: await metric("resident-chunks"),
      worldObjects: await metric("world-objects"),
      cars: await metric("cars"),
      buses: await metric("buses"),
      walkers: await metric("walkers"),
      cyclists: await metric("cyclists"),
      scooters: await metric("scooters"),
      animals: await metric("animals"),
      trafficSignals: await metric("traffic-signals"),
      wrongWayCars: await metric("wrong-way-cars"),
      wrongWayBuses: await metric("wrong-way-buses"),
      trafficUnsafePairs: await metric("traffic-unsafe-pairs"),
      trafficMovingVehicles: await metric("traffic-moving-vehicles"),
      trafficMaxWaitMs: await metric("traffic-max-wait-ms"),
      worldObjectDepthErrors: await metric("world-object-depth-errors"),
      residentCenterErrors: await metric("resident-center-errors"),
      trafficSteps: await metric("traffic-steps"),
      trafficLifetimeSteps: await metric("traffic-lifetime-steps"),
      residentWalkFrames: await host.getAttribute("data-resident-walk-frames") ?? "",
    });
    await page.screenshot({
      path: path.join(screenshotDirectory!, `city-${String(index + 1).padStart(2, "0")}.png`),
      fullPage: true,
    });
    if (index === cities.length - 1) {
      await page.setViewportSize({ width: 2560, height: 1440 });
      await page.locator(".country-title-button").click();
      await page.getByRole("dialog", { name: "Выбор страны" }).getByRole("button", { name: "План страны" }).click();
      const wideDrawer = page.getByRole("complementary", { name: "План страны" });
      await expect(wideDrawer).toBeVisible();
      await wideDrawer.locator(".plan-row > button:first-child", { hasText: cities[index] }).click();
      await expect(wideDrawer).toBeHidden();
      await page.getByRole("button", { name: "Границы", exact: true }).click();
      await expect.poll(async () => Number(await host.getAttribute("data-resident-chunks") ?? 0), { timeout: 45_000 })
        .toBeGreaterThan(0);
      await page.waitForTimeout(600);
      await page.screenshot({
        path: path.join(screenshotDirectory!, "final-four-district-city.png"),
        fullPage: true,
      });
    }
    expect(consoleErrors).toEqual([]);
  }
  const reportName = onlyCityIndex > 0 ? `browser-report-city-${String(onlyCityIndex).padStart(2, "0")}.json` : "browser-report.json";
  await writeFile(path.join(screenshotDirectory!, reportName), `${JSON.stringify(browserReport, null, 2)}\n`, "utf8");
});
