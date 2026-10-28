import { openMapCity } from "./map-navigation";
import { expect, test, type Page, type Route } from "@playwright/test";

async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("Email").fill("demo@tasktopia.local");
  await page.getByLabel("Пароль", { exact: true }).fill("tasktopia-demo");
  await page.getByRole("button", { name: "Открыть страну" }).click();
}

test("hotfix keeps city and planet usable and visually connected", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const failures: string[] = [];
  const mapRequests: string[] = [];
  page.on("pageerror", (error) => failures.push(error.message));
  page.on("console", (message) => {
    const text = message.text();
    if (message.type() === "error" || /GL_INVALID_OPERATION|before initialization|passive event listener|PixiJS Deprecation/.test(text)) failures.push(text);
  });
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.endsWith("/scene") || path.includes("/api/world/viewport") || path.includes("/api/chunks/")) mapRequests.push(path);
  });

  // Install before login: authentication already starts the code preload.
  const taskChunkPattern = /\/assets\/TaskModal-[^/]+\.js$/;
  let releaseTaskGate!: () => void, taskChunkReleased = false, heldTaskChunks = 0;
  const taskChunkGate = new Promise<void>(resolve => { releaseTaskGate = resolve; });
  const deliveries: Promise<void>[] = [];
  const releaseTaskChunk = () => { taskChunkReleased = true; releaseTaskGate(); };
  const holdTaskChunk = (route: Route) => {
    if (route.request().method() !== "GET" || route.request().resourceType() !== "script") return route.continue();
    heldTaskChunks++;
    const delivery = taskChunkGate.then(() => route.continue());
    deliveries.push(delivery);
    return delivery;
  };
  await page.route(taskChunkPattern, holdTaskChunk);
  try {
    await login(page);
    await openMapCity(page);
    const city = page.locator(".world-canvas");
    await expect(city).toHaveAttribute("data-city-scene-commit", "atomic", { timeout: 90_000 });
    await expect(city).toHaveAttribute("data-loading", "false", { timeout: 90_000 });
    expect(mapRequests.filter((path) => path.endsWith("/scene"))).toHaveLength(1);
    expect(mapRequests.filter((path) => path.includes("/api/world/viewport") || path.includes("/api/chunks/"))).toEqual([]);
    expect(Number(await city.getAttribute("data-static-decoration-particles"))).toBeGreaterThan(0);

    const canvas = page.locator("canvas[aria-label='Интерактивная карта города']");
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    const beforeX = Number(await city.getAttribute("data-camera-world-x"));
    await page.mouse.move(box!.x + box!.width * .7, box!.y + box!.height * .5);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width * .25, box!.y + box!.height * .5, { steps: 16 });
    await page.mouse.up();
    await expect.poll(async () => Number(await city.getAttribute("data-camera-world-x"))).not.toBe(beforeX);
    expect(mapRequests.filter((path) => path.includes("/api/world/viewport") || path.includes("/api/chunks/"))).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath("city.png"), fullPage: true });

    await expect.poll(() => heldTaskChunks).toBeGreaterThan(0);
    const search = page.getByLabel("Поиск здания по номеру или названию");
    await search.fill("1");
    const option = page.getByRole("listbox", { name: "Найденные задачи" }).getByRole("option").first();
    await expect(option).toBeVisible();
    const taskTitle = await option.locator(".task-search-title").innerText();
    await option.click();
    await expect(page.getByRole("dialog", { name: "Загрузка задачи" })).toBeVisible({ timeout: 500 });
    expect(taskChunkReleased, "The loading dialog must be witnessed while the actual module request is still held").toBe(false);
    await expect(page.locator("#task-title")).toHaveCount(0);
    releaseTaskChunk();
    await expect(page.locator("#task-title")).toBeVisible();
    await expect(page.locator("#task-title")).toHaveText(taskTitle);
    await expect(page.getByRole("dialog", { name: "Загрузка задачи" })).toHaveCount(0);
    await page.locator(".modal-close").click();

    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.wheel(0, 4_000);
    const planet = page.locator(".planet-atlas");
    await expect(planet).toBeVisible({ timeout: 5_000 });
    expect(Number(await planet.getAttribute("data-globe-zoom"))).toBe(1);
    await expect(planet).toHaveAttribute("data-planet-ready", "true", { timeout: 30_000 });
    await expect(planet.locator("clipPath ellipse")).toHaveCount(0);
    const rows = await planet.locator("clipPath rect").evaluateAll(rects => rects.map(rect => ({
      x: Number(rect.getAttribute("x")), y: Number(rect.getAttribute("y")),
      width: Number(rect.getAttribute("width")), height: Number(rect.getAttribute("height")),
    })));
    expect(rows.length).toBeGreaterThan(20);
    expect(rows.every(row => row.width > 0 && row.height > 0)).toBe(true);
    // The round planet has stepped shoulders rather than a rectangular ocean.
    expect(rows[0]!.width).toBeLessThan(rows[Math.floor(rows.length / 2)]!.width);
    await page.screenshot({ path: testInfo.outputPath("planet.png"), fullPage: true });

    expect(failures.filter((message) => !message.includes("401 (Unauthorized)"))).toEqual([]);
  } finally {
    releaseTaskChunk();
    await Promise.all(deliveries);
    await page.unroute(taskChunkPattern, holdTaskChunk);
  }
});
