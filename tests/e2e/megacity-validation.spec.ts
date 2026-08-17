import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

const screenshotDirectory = process.env.MEGACITY_VALIDATION_SCREENSHOT_DIR;

test.use({ viewport: { width: 2560, height: 1440 } });

test("opens and captures the 100-task megacity", async ({ page }) => {
  test.setTimeout(5 * 60_000);
  test.skip(!screenshotDirectory, "Run explicitly with MEGACITY_VALIDATION_SCREENSHOT_DIR");
  await mkdir(screenshotDirectory!, { recursive: true });
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto("/");
  await page.getByLabel("Email").fill("megacity-validation@tasktopia.local");
  await page.getByLabel("Пароль").fill("tasktopia-megacity-validation");
  await page.getByRole("button", { name: "Открыть страну" }).click();
  await expect(page.getByText("Республика Атлас", { exact: true })).toBeVisible();
  // The anonymous bootstrap request is expected to receive 401 before login;
  // only authenticated-world errors belong to this visual QA run.
  consoleErrors.length = 0;

  const host = page.locator(".world-canvas");
  const canvas = page.locator("canvas[aria-label='Интерактивная карта страны']");
  await page.getByRole("button", { name: "План", exact: true }).click();
  const drawer = page.getByRole("complementary", { name: "План страны" });
  await expect(drawer).toBeVisible();
  await drawer.locator(".plan-row > button:first-child", { hasText: "Большой Атлас" }).click();
  await expect(drawer).toBeHidden();

  await expect.poll(async () => Number(await host.getAttribute("data-resident-chunks") ?? 0), { timeout: 60_000 })
    .toBeGreaterThan(0);
  await expect.poll(async () => Number(await host.getAttribute("data-world-objects") ?? 0), { timeout: 60_000 })
    .toBeGreaterThanOrEqual(100);
  await page.getByRole("button", { name: "Границы", exact: true }).click();
  await page.waitForTimeout(1_000);
  await page.screenshot({
    path: path.join(screenshotDirectory!, "megacity-overview.png"),
    fullPage: true,
  });

  await canvas.hover();
  for (let step = 0; step < 10 && await host.getAttribute("data-map-lod") !== "detail"; step += 1) {
    await page.mouse.wheel(0, -700);
    await page.waitForTimeout(150);
  }
  await expect(host).toHaveAttribute("data-map-lod", "detail", { timeout: 60_000 });
  await expect.poll(async () => Number(await host.getAttribute("data-cars") ?? 0), { timeout: 60_000 }).toBeGreaterThan(0);
  await expect.poll(async () => Number(await host.getAttribute("data-walkers") ?? 0), { timeout: 60_000 }).toBeGreaterThan(0);
  await expect(host).toHaveAttribute("data-wrong-way-cars", "0");
  await expect(host).toHaveAttribute("data-wrong-way-buses", "0");
  await expect(host).toHaveAttribute("data-traffic-unsafe-pairs", "0");
  await expect(host).toHaveAttribute("data-world-object-depth-errors", "0");
  await expect(host).toHaveAttribute("data-resident-center-errors", "0");
  await page.waitForTimeout(1_000);
  await page.screenshot({
    path: path.join(screenshotDirectory!, "megacity-detail.png"),
    fullPage: true,
  });

  const captureFocusedTask = async (taskNumber: number, fileName: string) => {
    const search = page.getByLabel("Поиск задачи по номеру или названию");
    await search.fill(String(taskNumber));
    const result = page.getByRole("option").filter({ hasText: `#${taskNumber}` }).first();
    await expect(result).toBeVisible();
    await result.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: "Закрыть" }).click();
    await page.waitForTimeout(1_000);
    await page.screenshot({
      path: path.join(screenshotDirectory!, fileName),
      fullPage: true,
    });
  };
  await captureFocusedTask(20, "megacity-house-20.png");
  await captureFocusedTask(78, "megacity-towers-78-79.png");

  const metric = async (name: string): Promise<number> => Number(await host.getAttribute(`data-${name}`) ?? 0);
  const browserReport = {
    city: "Большой Атлас",
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
    worldObjectDepthErrors: await metric("world-object-depth-errors"),
    residentCenterErrors: await metric("resident-center-errors"),
    consoleErrors,
  };
  await writeFile(path.join(screenshotDirectory!, "browser-report.json"), `${JSON.stringify(browserReport, null, 2)}\n`, "utf8");
  expect(consoleErrors).toEqual([]);
});
