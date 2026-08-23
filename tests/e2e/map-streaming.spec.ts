import { expect, test } from "@playwright/test";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

const isWorldPayloadRequest = (url: string) => url.includes("/api/chunks/") || url.includes("/api/world/viewport");
const incidentScreenshotPath = process.env.INCIDENT_SCREENSHOT_PATH;

function worldRequestChunkKeys(requestUrl: string): string[] {
  const url = new URL(requestUrl);
  const chunkMatch = url.pathname.match(/\/api\/chunks\/(-?\d+)\/(-?\d+)/);
  if (chunkMatch) return [`${chunkMatch[1]},${chunkMatch[2]}`];
  if (url.pathname !== "/api/world/viewport") return [];
  const minX = Number(url.searchParams.get("minChunkX"));
  const maxX = Number(url.searchParams.get("maxChunkX"));
  const minY = Number(url.searchParams.get("minChunkY"));
  const maxY = Number(url.searchParams.get("maxChunkY"));
  const keys: string[] = [];
  for (let y = minY; y <= maxY; y += 1) for (let x = minX; x <= maxX; x += 1) keys.push(`${x},${y}`);
  return keys;
}

async function openDemoMap(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByLabel("Email").fill("demo@tasktopia.local");
  await page.getByLabel("Пароль").fill("tasktopia-demo");
  await page.getByRole("button", { name: "Открыть страну" }).click();
  const host = page.locator(".world-canvas");
  const canvas = page.locator("canvas[aria-label='Интерактивная карта страны']");
  await expect.poll(async () => await host.getAttribute("data-loading"), { timeout: 90_000 }).toBe("false");
  await canvas.hover();
  for (let step = 0; step < 8 && await host.getAttribute("data-map-lod") !== "detail"; step += 1) await page.mouse.wheel(0, -800);
  await expect(host).toHaveAttribute("data-map-lod", "detail", { timeout: 90_000 });
  await expect.poll(async () => Number(await host.getAttribute("data-cars")), { timeout: 90_000 }).toBeGreaterThan(0);
  await expect(host).toHaveAttribute("data-traffic-blocked-vehicles", /\d+/);
  const unsafeSamples = await page.evaluate(async () => await new Promise<number[]>((resolve) => {
    const samples: number[] = [];
    const timer = window.setInterval(() => {
      samples.push(Number(document.querySelector<HTMLElement>(".world-canvas")?.dataset.trafficUnsafePairs ?? -1));
      if (samples.length >= 8) { window.clearInterval(timer); resolve(samples); }
    }, 100);
  }));
  expect(unsafeSamples).toEqual(Array(8).fill(0));
  await expect(host).toHaveAttribute("data-wrong-way-cars", "0");
  await expect(host).toHaveAttribute("data-wrong-way-buses", "0");
  await expect.poll(async () => Number(await host.getAttribute("data-traffic-moving-vehicles")), { timeout: 16_000 }).toBeGreaterThan(0);
  await expect(host).toHaveAttribute("data-airplane-space", "world");
  await expect(host).toHaveAttribute("data-world-object-depth-errors", "0");
  return { host, canvas };
}

test("keeps visible agent state across detail zoom and randomizes a new page session", async ({ page }) => {
  test.setTimeout(120_000);
  let { host, canvas } = await openDemoMap(page);
  const idsBefore = new Set((await host.getAttribute("data-agent-ids"))!.split(",").filter(Boolean));
  const sessionBefore = await host.getAttribute("data-agent-session");
  const rebuildsBefore = Number(await host.getAttribute("data-movement-rebuilds") ?? 0);
  const walkStateBefore = await host.getAttribute("data-resident-walk-state");
  const trafficStepsBefore = Number(await host.getAttribute("data-traffic-steps") ?? 0);
  await expect.poll(async () => await host.getAttribute("data-resident-walk-state"), { timeout: 8_000 }).not.toBe(walkStateBefore);
  await expect.poll(async () => Number(await host.getAttribute("data-traffic-steps") ?? 0), { timeout: 8_000 }).toBeGreaterThan(trafficStepsBefore);
  await expect.poll(async () => await host.getAttribute("data-vehicle-rendered-frame-mask"), { timeout: 8_000 }).toBe("1111");
  await canvas.hover();
  await page.mouse.wheel(0, -200);
  await expect.poll(async () => await host.getAttribute("data-loading"), { timeout: 90_000 }).toBe("false");
  const idsAfter = new Set((await host.getAttribute("data-agent-ids"))!.split(",").filter(Boolean));
  const retained = [...idsBefore].filter((id) => idsAfter.has(id));
  expect(retained.length).toBeGreaterThan(0);
  expect(Number(await host.getAttribute("data-movement-rebuilds") ?? 0)).toBe(rebuildsBefore);

  await page.reload();
  host = page.locator(".world-canvas");
  canvas = page.locator("canvas[aria-label='Интерактивная карта страны']");
  await expect.poll(async () => await host.getAttribute("data-loading"), { timeout: 90_000 }).toBe("false");
  await canvas.hover();
  for (let step = 0; step < 8 && await host.getAttribute("data-map-lod") !== "detail"; step += 1) await page.mouse.wheel(0, -800);
  await expect(host).toHaveAttribute("data-map-lod", "detail", { timeout: 90_000 });
  expect(await host.getAttribute("data-agent-session")).not.toBe(sessionBefore);
});

test("streams delayed chunks without duplicate requests or an exposed empty canvas", async ({ page }) => {
  test.setTimeout(120_000);
  const chunkRequests: string[] = [];
  const consoleProblems: string[] = [];
  await page.route(/\/api\/(?:chunks\/|world\/viewport)/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 600));
    await route.continue();
  });
  page.on("request", (request) => {
    if (isWorldPayloadRequest(request.url())) {
      const url = new URL(request.url());
      chunkRequests.push(`${url.pathname}${url.search}`);
    }
  });
  page.on("console", (message) => {
    const text = message.text();
    if (text.includes("Content Security Policy") || text.includes("not found in the Cache")) consoleProblems.push(text);
  });

  await page.goto("/");
  await page.getByLabel("Email").fill("demo@tasktopia.local");
  await page.getByLabel("Пароль").fill("tasktopia-demo");
  await page.getByRole("button", { name: "Открыть страну" }).click();

  const canvas = page.locator("canvas[aria-label='Интерактивная карта страны']");
  const firstFrame = page.getByText("Готовим карту…", { exact: true });
  await expect(canvas).toBeVisible();
  const host = page.locator(".world-canvas");
  await expect(host).toHaveAttribute("data-seed-first-frame", "true");
  await expect(host).toHaveAttribute("data-seed-terrain-pattern", "procedural-pixel-v1");
  await expect(firstFrame).toBeHidden({ timeout: 90_000 });
  await expect.poll(async () => Number(await host.getAttribute("data-resident-chunks"))).toBeGreaterThan(0);
  await expect.poll(async () => await host.getAttribute("data-loading")).toBe("false");
  await expect(host).toHaveAttribute("data-seed-ground-retained", "true");
  await expect(host).toHaveAttribute("data-seed-terrain-reused", "true");
  chunkRequests.length = 0;

  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width * 0.9, box!.y + box!.height * 0.5);
  await page.mouse.down();
  for (let step = 0; step < 24; step += 1) {
    await page.mouse.move(box!.x + box!.width * 0.9 - step * 50, box!.y + box!.height * 0.5, { steps: 1 });
  }
  await page.mouse.up();
  // A drag may finish over a building on a dense generated city. Close the
  // incidental task card so it cannot capture the following zoom gesture.
  await page.keyboard.press("Escape");
  const currentLod = await host.getAttribute("data-map-lod");
  await canvas.hover();
  for (let step = 0; step < 6; step += 1) await page.mouse.wheel(0, currentLod === "overview" ? -800 : 800);
  await expect(page.getByText("Подгружаем карту…", { exact: true })).toBeVisible();
  await expect.poll(async () => await host.getAttribute("data-loading"), { timeout: 90_000 }).toBe("false");
  await expect(page.getByText("Подгружаем карту…", { exact: true })).toBeHidden();

  const requestCounts = new Map<string, number>();
  for (const request of chunkRequests) requestCounts.set(request, (requestCounts.get(request) ?? 0) + 1);
  // The visible rectangle is normally delivered by one request. Compatibility
  // fallback may use individual chunks, but still stays inside a bounded budget.
  expect(chunkRequests.length).toBeLessThanOrEqual(20);
  expect(Math.max(0, ...requestCounts.values())).toBeLessThanOrEqual(1);
  expect(Number(await host.getAttribute("data-ground-cache"))).toBeGreaterThanOrEqual(Number(await host.getAttribute("data-resident-chunks")));
  expect(Number(await host.getAttribute("data-ground-cache"))).toBeLessThanOrEqual(96);
  expect(Number(await host.getAttribute("data-chunk-data-cache"))).toBeLessThanOrEqual(48);
  expect(Number(await host.getAttribute("data-chunk-payload-cache"))).toBeLessThanOrEqual(160);
  expect(Number(await host.getAttribute("data-ground-bakes-per-frame-max"))).toBe(1);
  await expect(host).toHaveAttribute("data-viewport-request-p95-ms", /\d/);
  await expect(host).toHaveAttribute("data-viewport-parse-p95-ms", /\d/);
  await expect(host).toHaveAttribute("data-chunk-materialize-p95-ms", /\d/);
  await expect(host).toHaveAttribute("data-ground-bake-p95-ms", /\d/);
  await expect(host).toHaveAttribute("data-viewport-payload-p95-bytes", /\d/);
  expect(consoleProblems).toEqual([]);
});

test("keeps every visible ground resident when an ultra-wide viewport exceeds the base GPU limit", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 4970, height: 2420 });
  await page.route("**/api/bootstrap", async (route) => {
    const response = await route.fetch();
    if (response.status() !== 200) {
      await route.fulfill({ response });
      return;
    }
    const bootstrap = await response.json();
    const viewBounds = { minX: -1_000, minY: -1_000, maxX: 999, maxY: 999 };
    await route.fulfill({
      response,
      json: {
        ...bootstrap,
        viewBounds,
        initialCity: bootstrap.initialCity ? { ...bootstrap.initialCity, bounds: viewBounds } : null,
      },
    });
  });
  await page.goto("/");
  await page.getByLabel("Email").fill("demo@tasktopia.local");
  await page.getByLabel("Пароль").fill("tasktopia-demo");
  await page.getByRole("button", { name: "Открыть страну" }).click();

  const host = page.locator(".world-canvas");
  const canvas = page.locator("canvas[aria-label='Интерактивная карта страны']");
  await expect(canvas).toBeVisible();
  await expect(host).toHaveAttribute("data-input-ready", "true");
  await expect(host).toHaveAttribute("data-loading", "true");
  await expect.poll(async () => await host.getAttribute("data-loading"), { timeout: 180_000 }).toBe("false");
  await canvas.hover();
  for (let step = 0; step < 8 && await host.getAttribute("data-map-lod") !== "overview"; step += 1) {
    await page.mouse.wheel(0, 800);
  }
  await expect(host).toHaveAttribute("data-map-lod", "overview", { timeout: 90_000 });
  await expect.poll(async () => await host.getAttribute("data-loading"), { timeout: 180_000 }).toBe("false");
  await expect(host).toHaveAttribute("data-map-lod", "overview");
  const range = await host.getAttribute("data-chunk-range");
  expect(range).not.toBeNull();
  const [minimum, maximum] = range!.split(":").map((point) => point.split(",").map(Number));
  const visibleCount = (maximum![0]! - minimum![0]! + 1) * (maximum![1]! - minimum![1]! + 1);

  expect(visibleCount).toBeGreaterThan(96);
  expect(await host.getAttribute("data-ground-texture-resolution")).toBe("0.5");
  expect(Number(await host.getAttribute("data-resident-chunks"))).toBe(visibleCount);
  expect(Number(await host.getAttribute("data-ground-cache"))).toBe(visibleCount);
  expect(Number(await host.getAttribute("data-ground-bake-queue-max"))).toBeLessThanOrEqual(visibleCount);
});

test("returns across a chunk boundary from decoded and GPU caches", async ({ page }) => {
  test.setTimeout(120_000);
  const chunkRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/chunks/")) chunkRequests.push(request.url());
  });
  const { host, canvas } = await openDemoMap(page);
  const initialRange = await host.getAttribute("data-chunk-range");
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const drag = async (deltaX: number) => {
    const startX = box!.x + box!.width / 2;
    const y = box!.y + box!.height / 2;
    await page.mouse.move(startX, y);
    await page.mouse.down();
    await page.mouse.move(startX + deltaX, y, { steps: 12 });
    await page.mouse.up();
    await expect.poll(async () => await host.getAttribute("data-loading"), { timeout: 90_000 }).toBe("false");
  };

  await drag(-Math.min(700, box!.width * 0.55));
  await expect.poll(async () => await host.getAttribute("data-chunk-range"), { timeout: 30_000 }).not.toBe(initialRange);
  chunkRequests.length = 0;
  const bakesBeforeReturn = Number(await host.getAttribute("data-ground-rebuilds") ?? 0);

  await drag(Math.min(700, box!.width * 0.55));

  await expect.poll(async () => await host.getAttribute("data-chunk-range"), { timeout: 30_000 }).toBe(initialRange);
  expect(chunkRequests).toEqual([]);
  expect(Number(await host.getAttribute("data-ground-rebuilds") ?? 0)).toBe(bakesBeforeReturn);
  await expect(page.getByText("Подгружаем карту…", { exact: true })).toBeHidden();
  expect(Number(await host.getAttribute("data-resident-chunks") ?? 0)).toBeGreaterThan(0);
});

test("recovers a failed chunk and paints a static map with reduced motion", async ({ page }) => {
  test.setTimeout(120_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  let failedOnce = false;
  await page.route("**/api/world/viewport**", async (route) => {
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "temporary" }) });
  });
  await page.route("**/api/chunks/**", async (route) => {
    if (!failedOnce) {
      failedOnce = true;
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "temporary" }) });
      return;
    }
    await route.continue();
  });

  await page.goto("/");
  await page.getByLabel("Email").fill("demo@tasktopia.local");
  await page.getByLabel("Пароль").fill("tasktopia-demo");
  await page.getByRole("button", { name: "Открыть страну" }).click();

  const host = page.locator(".world-canvas");
  await expect(page.getByText("Готовим карту…", { exact: true })).toBeHidden({ timeout: 90_000 });
  await expect.poll(async () => await host.getAttribute("data-loading"), { timeout: 90_000 }).toBe("false");
  await expect.poll(async () => Number(await host.getAttribute("data-static-renders"))).toBeGreaterThan(0);
  await expect(host).toHaveAttribute("data-world-object-depth-errors", "0");
  await expect.poll(async () => Number(await host.getAttribute("data-world-objects"))).toBeGreaterThan(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(failedOnce).toBe(true);
});

test("offers a working renderer restart when its setup fails", async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    const OriginalResizeObserver = ResizeObserver;
    (window as typeof window & { __allowMapRenderer?: boolean }).__allowMapRenderer = false;
    window.ResizeObserver = class extends OriginalResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        if (!(window as typeof window & { __allowMapRenderer?: boolean }).__allowMapRenderer) {
          throw new Error("simulated renderer setup failure");
        }
        super(callback);
      }
    };
  });

  await page.goto("/");
  await page.getByLabel("Email").fill("demo@tasktopia.local");
  await page.getByLabel("Пароль").fill("tasktopia-demo");
  await page.getByRole("button", { name: "Открыть страну" }).click();

  const alert = page.getByRole("alert");
  await expect(alert).toContainText("Не удалось запустить карту", { timeout: 30_000 });
  await page.evaluate(() => {
    (window as typeof window & { __allowMapRenderer?: boolean }).__allowMapRenderer = true;
  });
  await alert.getByRole("button", { name: "Повторить" }).click();
  await expect(alert).toHaveCount(0);
  await expect(page.getByText("Готовим карту…", { exact: true })).toBeHidden({ timeout: 90_000 });
  await expect(page.locator(".world-canvas")).toHaveAttribute("data-seed-first-frame", "true");
});

test("shows a recoverable error after retries and keeps rendered ground", async ({ page }) => {
  test.setTimeout(120_000);
  let failChunks = false;
  await page.route("**/api/world/viewport**", async (route) => {
    if (failChunks) {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "temporary" }) });
      return;
    }
    await route.continue();
  });
  await page.route("**/api/chunks/**", async (route) => {
    if (failChunks) {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "temporary" }) });
      return;
    }
    await route.continue();
  });
  await page.goto("/");
  await page.getByLabel("Email").fill("demo@tasktopia.local");
  await page.getByLabel("Пароль").fill("tasktopia-demo");
  await page.getByRole("button", { name: "Открыть страну" }).click();

  const host = page.locator(".world-canvas");
  const canvas = page.locator("canvas[aria-label='Интерактивная карта страны']");
  await expect.poll(async () => await host.getAttribute("data-loading"), { timeout: 90_000 }).toBe("false");
  const initialLod = await host.getAttribute("data-map-lod");
  failChunks = true;
  await canvas.hover();
  for (let step = 0; step < 6; step += 1) await page.mouse.wheel(0, initialLod === "overview" ? -800 : 800);
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("Не удалось загрузить карту", { timeout: 30_000 });
  await expect(alert).not.toHaveClass(/world-first-frame-loading/);
  await expect(canvas).toBeVisible();
  expect(Number(await host.getAttribute("data-resident-chunks"))).toBeGreaterThan(0);
  failChunks = false;
  await alert.getByRole("button", { name: "Повторить" }).click();
  await expect(alert).toHaveCount(0);
  await expect.poll(async () => await host.getAttribute("data-loading"), { timeout: 90_000 }).toBe("false");
  await expect.poll(async () => Number(await host.getAttribute("data-resident-chunks"))).toBeGreaterThan(0);
});

test("keeps the rendered LOD coherent and recovers a rapid zoom reversal", async ({ page }) => {
  test.setTimeout(120_000);
  let slowLod: "overview" | "detail" = "detail";
  let armed = false;
  let slowOverviewStarted = false;
  let slowOverviewResolved = false;
  let releaseSlowOverview: (() => void) | undefined;
  const slowOverviewGate = new Promise<void>((resolve) => {
    releaseSlowOverview = resolve;
  });
  await page.route(/\/api\/(?:chunks\/|world\/viewport)/, async (route) => {
    const isSlowLod = armed && new URL(route.request().url()).searchParams.get("lod") === slowLod;
    if (isSlowLod && !slowOverviewStarted) {
      slowOverviewStarted = true;
      await slowOverviewGate;
      slowOverviewResolved = true;
    } else if (isSlowLod) {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    await route.continue();
  });
  await page.goto("/");
  await page.getByLabel("Email").fill("demo@tasktopia.local");
  await page.getByLabel("Пароль").fill("tasktopia-demo");
  await page.getByRole("button", { name: "Открыть страну" }).click();
  const host = page.locator(".world-canvas");
  const canvas = page.locator("canvas[aria-label='Интерактивная карта страны']");
  await expect.poll(async () => await host.getAttribute("data-loading"), { timeout: 90_000 }).toBe("false");
  const initialLod = await host.getAttribute("data-map-lod") as "overview" | "detail";
  slowLod = initialLod === "overview" ? "detail" : "overview";
  armed = true;
  await canvas.hover();
  for (let step = 0; step < 6; step += 1) await page.mouse.wheel(0, slowLod === "overview" ? 800 : -800);
  await expect.poll(async () => slowOverviewStarted).toBe(true);
  await expect(page.getByText("Подгружаем карту…", { exact: true })).toBeVisible();
  expect(Number(await host.getAttribute("data-resident-chunks"))).toBeGreaterThan(0);
  expect(slowOverviewResolved).toBe(false);
  for (let step = 0; step < 6; step += 1) await page.mouse.wheel(0, slowLod === "overview" ? -800 : 800);
  releaseSlowOverview?.();
  await expect.poll(async () => await host.getAttribute("data-loading"), { timeout: 90_000 }).toBe("false");
  await expect(host).toHaveAttribute("data-map-lod", initialLod);
});

test("never presents adjacent chunks from different LODs", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 640, height: 480 });
  let armed = false;
  let delayedBuildingStarted = false;
  let delayedBuildingResolved = false;
  let releaseDelayedBuilding: (() => void) | undefined;
  const delayedBuildingGate = new Promise<void>((resolve) => {
    releaseDelayedBuilding = resolve;
  });
  await page.route("**/game-assets/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (armed && !delayedBuildingStarted && pathname.includes("/buildings/")) {
      delayedBuildingStarted = true;
      await delayedBuildingGate;
      delayedBuildingResolved = true;
    }
    await route.continue();
  });
  await page.goto("/");
  await page.getByLabel("Email").fill("demo@tasktopia.local");
  await page.getByLabel("Пароль").fill("tasktopia-demo");
  await page.getByRole("button", { name: "Открыть страну" }).click();

  const host = page.locator(".world-canvas");
  const canvas = page.locator("canvas[aria-label='Интерактивная карта страны']");
  await expect.poll(async () => await host.getAttribute("data-loading"), { timeout: 90_000 }).toBe("false");
  for (let step = 0; step < 8 && await host.getAttribute("data-map-lod") !== "overview"; step += 1) {
    await canvas.hover();
    await page.mouse.wheel(0, 800);
  }
  await expect(host).toHaveAttribute("data-map-lod", "overview", { timeout: 90_000 });
  await expect(host).toHaveAttribute("data-mixed-ground-lods", "false");

  armed = true;
  await canvas.hover();
  for (let step = 0; step < 8 && !delayedBuildingStarted; step += 1) await page.mouse.wheel(0, -800);
  await expect.poll(async () => delayedBuildingStarted).toBe(true);
  const observedGroundLods: Array<string | null> = [];
  const sampleUntil = Date.now() + 1_800;
  while (Date.now() < sampleUntil && !delayedBuildingResolved) {
    observedGroundLods.push(await host.getAttribute("data-mixed-ground-lods"));
    await page.waitForTimeout(50);
  }
  expect(observedGroundLods).not.toContain("true");
  expect(delayedBuildingResolved).toBe(false);
  releaseDelayedBuilding?.();
  await expect.poll(async () => delayedBuildingResolved, { timeout: 30_000 }).toBe(true);
});

test("realtime task status patches its entity without refetching or rebaking static ground", async ({ page }) => {
  test.setTimeout(120_000);
  const requestedChunks = new Set<string>();
  page.on("request", (request) => {
    for (const key of worldRequestChunkKeys(request.url())) requestedChunks.add(key);
  });
  await page.goto("/");
  await page.getByLabel("Email").fill("demo@tasktopia.local");
  await page.getByLabel("Пароль").fill("tasktopia-demo");
  await page.getByRole("button", { name: "Открыть страну" }).click();
  const host = page.locator(".world-canvas");
  await expect.poll(async () => await host.getAttribute("data-loading"), { timeout: 90_000 }).toBe("false");
  const canvas = page.locator("canvas[aria-label='Интерактивная карта страны']");
  requestedChunks.clear();
  await canvas.hover();
  for (let step = 0; step < 8 && await host.getAttribute("data-map-lod") !== "detail"; step += 1) await page.mouse.wheel(0, -800);
  await expect(host).toHaveAttribute("data-map-lod", "detail", { timeout: 90_000 });
  await expect.poll(async () => await host.getAttribute("data-loading"), { timeout: 90_000 }).toBe("false");
  const visibleRange = await host.getAttribute("data-chunk-range");
  expect(visibleRange).not.toBeNull();
  const [visibleMin, visibleMax] = visibleRange!.split(":").map((point) => point.split(",").map(Number));
  const visibleChunkKeys: string[] = [];
  for (let chunkY = visibleMin![1]!; chunkY <= visibleMax![1]!; chunkY += 1) {
    for (let chunkX = visibleMin![0]!; chunkX <= visibleMax![0]!; chunkX += 1) {
      visibleChunkKeys.push(`${chunkX},${chunkY}`);
    }
  }

  const integration = await page.evaluate(async (visibleChunkKeys) => {
    const cities = await fetch("/api/plan/cities").then((response) => response.json()) as Array<{ id: string }>;
    for (const city of cities) {
      const districts = await fetch(`/api/plan/cities/${city.id}/districts`).then((response) => response.json()) as Array<{ id: string; status: string }>;
      for (const district of districts) {
        if (district.status !== "ACTIVE") continue;
        const tasks = await fetch(`/api/plan/districts/${district.id}/tasks`).then((response) => response.json()) as Array<{ id: string; status: string }>;
        for (const task of tasks) {
          if (task.status !== "PLANNING") continue;
          const detail = await fetch(`/api/tasks/${task.id}`).then((response) => response.json()) as { origin: { x: number; y: number } };
          const chunkKey = `${Math.floor(detail.origin.x / 64)},${Math.floor(detail.origin.y / 64)}`;
          if (!visibleChunkKeys.includes(chunkKey)) continue;
          const issued = await fetch("/api/tokens", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name: "Realtime map test" }),
          }).then((response) => response.json()) as { id: string; token: string };
          return { taskId: task.id, chunkKey, ...issued };
        }
      }
    }
    throw new Error("No visible planning task found");
  }, visibleChunkKeys);

  const beforeRebuilds = Number(await host.getAttribute("data-ground-rebuilds"));
  const beforeEntityRebuilds = Number(await host.getAttribute("data-entity-rebuilds"));
  const beforeMovementRebuilds = Number(await host.getAttribute("data-movement-rebuilds"));
  requestedChunks.clear();
  const client = new Client({ name: "realtime-map-test", version: "1.0.0" }, { versionNegotiation: { mode: "auto" } });
  const transport = new StreamableHTTPClientTransport(new URL("/mcp", page.url()), {
    requestInit: { headers: { authorization: `Bearer ${integration.token}` } },
  });
  let releaseChunkRefresh: (() => void) | undefined;
  try {
    await client.connect(transport);
    const result = await client.callTool({
      name: "task.set_status",
      arguments: { taskId: integration.taskId, status: "STARTED", progress: 10, idempotencyKey: `e2e-map-${Date.now()}` },
    });
    expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
    await expect.poll(async () => Number(await host.getAttribute("data-entity-rebuilds")), { timeout: 30_000 }).toBeGreaterThan(beforeEntityRebuilds);
    const groundRebuildsAfterRetry = Number(await host.getAttribute("data-ground-rebuilds"));
    const rebuildDiagnostics = await host.evaluate((element) => ({
      invalidated: element.getAttribute("data-ground-rebuild-invalidated"),
      seed: element.getAttribute("data-ground-rebuild-seed"),
      lod: element.getAttribute("data-ground-rebuild-lod"),
      primes: element.getAttribute("data-seed-ground-primes"),
      replaced: element.getAttribute("data-ground-remove-replace"),
      pruned: element.getAttribute("data-ground-remove-prune"),
    }));
    expect(groundRebuildsAfterRetry, JSON.stringify(rebuildDiagnostics)).toBe(beforeRebuilds);
    expect(requestedChunks.has(integration.chunkKey)).toBe(false);
    expect(Number(await host.getAttribute("data-movement-rebuilds"))).toBe(beforeMovementRebuilds);
    expect(await host.getAttribute("data-realtime-decorations")).toBeNull();

    const defectIds = await page.evaluate(async (taskId) => {
      const ids: string[] = [];
      for (let index = 0; index < 6; index += 1) {
        const response = await fetch(`/api/tasks/${taskId}/defects`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            title: `E2E visual incident ${index + 1}`,
            reproductionSteps: "Open the visible building",
            actualResult: "Incident is present",
            expectedResult: "Incident is resolved",
            idempotencyKey: `e2e-incident-${index}-${Date.now()}`,
          }),
        });
        if (!response.ok) throw new Error(await response.text());
        ids.push((await response.json() as { id: string }).id);
      }
      return ids;
    }, integration.taskId);
    await expect.poll(async () => await host.getAttribute("data-incident-modes"), { timeout: 30_000 }).toContain("DEFECT_REPORTED");
    await expect.poll(async () => Number(await host.getAttribute("data-incident-active-defects")), { timeout: 30_000 }).toBe(6);
    await expect.poll(async () => Number(await host.getAttribute("data-incident-smoke-strength")), { timeout: 30_000 }).toBe(6);
    await expect.poll(async () => Number(await host.getAttribute("data-incident-fires")), { timeout: 30_000 }).toBe(1);
    await expect.poll(async () => Number(await host.getAttribute("data-incident-water-jets")), { timeout: 30_000 }).toBe(1);
    await expect.poll(async () => Number(await host.getAttribute("data-incident-water-targets")), { timeout: 30_000 }).toBeGreaterThan(1);
    const targetIndex = await host.getAttribute("data-incident-water-target-indexes");
    await expect.poll(async () => await host.getAttribute("data-incident-water-target-indexes"), { timeout: 4_000 }).not.toBe(targetIndex);
    if (incidentScreenshotPath) {
      await page.waitForTimeout(420);
      await page.screenshot({ path: incidentScreenshotPath, fullPage: true });
    }
    const updateDefect = async (defectId: string, status: "IN_PROGRESS" | "VERIFYING" | "FIXED") => {
      await page.evaluate(async ({ defectId: targetId, status: nextStatus }) => {
        const response = await fetch(`/api/defects/${targetId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status: nextStatus, idempotencyKey: `e2e-incident-${nextStatus}-${Date.now()}` }),
        });
        if (!response.ok) throw new Error(await response.text());
      }, { defectId, status });
    };
    await updateDefect(defectIds[0]!, "IN_PROGRESS");
    await expect.poll(async () => await host.getAttribute("data-incident-modes"), { timeout: 30_000 }).toContain("DEFECT_REPAIRING");
    await updateDefect(defectIds[0]!, "VERIFYING");
    await expect.poll(async () => await host.getAttribute("data-incident-modes"), { timeout: 30_000 }).toContain("DEFECT_VERIFYING");
    await updateDefect(defectIds[0]!, "FIXED");
    await expect.poll(async () => Number(await host.getAttribute("data-incident-active-defects")), { timeout: 30_000 }).toBe(5);
    await expect.poll(async () => Number(await host.getAttribute("data-incident-smoke-strength")), { timeout: 30_000 }).toBe(5);
    await expect.poll(async () => Number(await host.getAttribute("data-incident-fires")), { timeout: 30_000 }).toBe(0);
    for (const remainingDefectId of defectIds.slice(1)) await updateDefect(remainingDefectId, "FIXED");
    await expect.poll(async () => Number(await host.getAttribute("data-incidents")), { timeout: 30_000 }).toBe(0);
    let delayedChunkRefreshStarted = false;
    let holdChunkRefresh = false;
    const chunkRefreshGate = new Promise<void>((resolve) => {
      releaseChunkRefresh = resolve;
    });
    const refreshRoute = /\/api\/(?:chunks\/|world\/viewport)/;
    await page.route(refreshRoute, async (route) => {
      if (holdChunkRefresh && !delayedChunkRefreshStarted
        && worldRequestChunkKeys(route.request().url()).includes(integration.chunkKey)) {
        const response = await route.fetch();
        delayedChunkRefreshStarted = true;
        await chunkRefreshGate;
        await route.fulfill({ response });
        return;
      }
      await route.continue();
    });
    holdChunkRefresh = true;
    const checklistResult = await client.callTool({
      name: "task.checklist_replace",
      arguments: {
        taskId: integration.taskId,
        items: [{ title: "Проверить realtime-перестроение здания", done: true }],
        idempotencyKey: `e2e-map-checklist-${Date.now()}`,
      },
    });
    expect(checklistResult.isError).not.toBe(true);
    await expect.poll(() => delayedChunkRefreshStarted, { timeout: 30_000 }).toBe(true);
    let realtimeAssetFailures = 0;
    let realtimeAssetRetried = false;
    await page.route("**/game-assets/**", async (route) => {
      if (!new URL(route.request().url()).pathname.includes("/buildings/")) {
        await route.continue();
        return;
      }
      if (realtimeAssetFailures < 3) {
        realtimeAssetFailures += 1;
        await route.abort("failed");
        return;
      }
      realtimeAssetRetried = true;
      await route.continue();
    });
    const entityRebuildsBeforeRetry = Number(await host.getAttribute("data-entity-rebuilds"));
    requestedChunks.clear();
    const inProgressResult = await client.callTool({
      name: "task.set_status",
      arguments: { taskId: integration.taskId, status: "IN_PROGRESS", progress: 55, idempotencyKey: `e2e-map-IN_PROGRESS-${Date.now()}` },
    });
    expect(inProgressResult.isError).not.toBe(true);
    releaseChunkRefresh?.();
    await expect.poll(() => realtimeAssetFailures, { timeout: 30_000 }).toBe(3);
    await expect.poll(() => realtimeAssetRetried, {
      message: "realtime stage assets must recover after internal retries and the delayed outer retry are exhausted",
      timeout: 30_000,
    }).toBe(true);
    await expect.poll(async () => Number(await host.getAttribute("data-entity-rebuilds")), { timeout: 30_000 })
      .toBeGreaterThan(entityRebuildsBeforeRetry);
    const finalGroundRebuilds = Number(await host.getAttribute("data-ground-rebuilds"));
    const finalRebuildDiagnostics = await host.evaluate((element) => ({
      invalidated: element.getAttribute("data-ground-rebuild-invalidated"),
      seed: element.getAttribute("data-ground-rebuild-seed"),
      lod: element.getAttribute("data-ground-rebuild-lod"),
      primes: element.getAttribute("data-seed-ground-primes"),
      replaced: element.getAttribute("data-ground-remove-replace"),
      pruned: element.getAttribute("data-ground-remove-prune"),
    }));
    expect(finalGroundRebuilds, JSON.stringify(finalRebuildDiagnostics)).toBe(beforeRebuilds);
    await expect(host).toHaveAttribute("data-realtime-decorations", "rematerialized", { timeout: 30_000 });
    expect(requestedChunks.has(integration.chunkKey)).toBe(false);
    await page.unroute(refreshRoute);
    await page.unroute("**/game-assets/**");
    for (const [status, progress] of [["TESTING", 90], ["COMPLETED", 100]] as const) {
      const result = await client.callTool({
        name: "task.set_status",
        arguments: { taskId: integration.taskId, status, progress, idempotencyKey: `e2e-map-${status}-${Date.now()}` },
      });
      expect(result.isError).not.toBe(true);
    }
    await expect(page.locator(".realtime-notice-success")).toContainText("Здание завершено — город обновлён");
    await expect.poll(async () => Number(await host.getAttribute("data-celebrations") ?? 0), { timeout: 30_000 }).toBeGreaterThan(0);
  } finally {
    releaseChunkRefresh?.();
    await client.close().catch(() => undefined);
    await page.evaluate(async (tokenId) => { await fetch(`/api/tokens/${tokenId}`, { method: "DELETE" }); }, integration.id);
  }
});
