import { expect, test } from "@playwright/test";

const screenshotPath = process.env.GROWTH_SCREENSHOT_PATH;
const expectedTasks = Number(process.env.GROWTH_EXPECTED_TASKS ?? 100);

test("captures a deterministic city growth checkpoint", async ({ page }) => {
  test.skip(!screenshotPath, "Run explicitly with a growth fixture and output path");
  const consoleErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });

  await page.goto("/");
  await page.getByLabel("Email").fill("growth@tasktopia.local");
  await page.getByLabel("Пароль").fill("growth-demo-100");
  await page.getByRole("button", { name: "Открыть страну" }).click();
  await expect(page.getByText("Centuria", { exact: true })).toBeVisible();
  const map = page.locator(".world-canvas");
  const canvas = page.locator("canvas[aria-label='Интерактивная карта страны']");
  await expect.poll(async () => Number(await map.getAttribute("data-resident-chunks"))).toBeGreaterThan(0);
  await canvas.hover();
  for (let step = 0; step < 8 && await map.getAttribute("data-map-lod") !== "detail"; step += 1) {
    await page.mouse.wheel(0, -800);
  }
  await expect(map).toHaveAttribute("data-map-lod", "detail", { timeout: 20_000 });
  const simulationReady = { timeout: 20_000 };
  await expect.poll(async () => Number(await map.getAttribute("data-cars")), simulationReady).toBeGreaterThan(0);
  await expect.poll(async () => Number(await map.getAttribute("data-walkers")), simulationReady).toBeGreaterThan(0);
  await expect.poll(async () => Number(await map.getAttribute("data-traffic-junctions")), simulationReady).toBeGreaterThan(0);
  await expect.poll(async () => Number(await map.getAttribute("data-traffic-signals")), simulationReady).toBeGreaterThanOrEqual(2);
  await expect(map).toHaveAttribute("data-traffic-blocked-vehicles", /\d+/);
  await expect(map).toHaveAttribute("data-traffic-unsafe-pairs", "0");
  await expect(map).toHaveAttribute("data-wrong-way-cars", "0");
  await expect(map).toHaveAttribute("data-wrong-way-buses", "0");
  // Anonymous bootstrap/token requests before login are expected to return 401.
  consoleErrors.length = 0;

  const bootstrap = await page.evaluate(async () => (await fetch("/api/bootstrap")).json());
  expect(bootstrap.initialCity).toMatchObject({ name: "Centuria" });
  expect(bootstrap.stats.cities).toBe(1);
  expect(bootstrap).not.toHaveProperty("tasks");
  expect(bootstrap).not.toHaveProperty("districts");
  expect(bootstrap.stats.tasks).toBe(expectedTasks);
  expect(bootstrap.stats.districts).toBe(expectedTasks / 10);
  expect(Number(await map.getAttribute("data-resident-chunks"))).toBeLessThan(200);
  await page.screenshot({ path: screenshotPath!, fullPage: true });
  expect(consoleErrors).toEqual([]);
});
