import { expect, test } from "@playwright/test";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

test("streams delayed chunks without duplicate requests or an exposed empty canvas", async ({ page }) => {
  test.setTimeout(120_000);
  const chunkRequests: string[] = [];
  const consoleProblems: string[] = [];
  await page.route("**/api/chunks/**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 600));
    await route.continue();
  });
  page.on("request", (request) => {
    if (request.url().includes("/api/chunks/")) {
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
  await expect(firstFrame).toBeVisible();
  await expect(firstFrame).toBeHidden({ timeout: 90_000 });

  const host = page.locator(".world-canvas");
  await expect.poll(async () => Number(await host.getAttribute("data-resident-chunks"))).toBeGreaterThan(0);
  await expect.poll(async () => await host.getAttribute("data-loading")).toBe("false");
  chunkRequests.length = 0;

  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width * 0.75, box!.y + box!.height * 0.5);
  await page.mouse.down();
  for (let step = 0; step < 18; step += 1) {
    await page.mouse.move(box!.x + box!.width * 0.75 - step * 45, box!.y + box!.height * 0.5, { steps: 1 });
  }
  await page.mouse.up();
  await expect.poll(async () => await host.getAttribute("data-loading"), { timeout: 90_000 }).toBe("false");

  const requestCounts = new Map<string, number>();
  for (const request of chunkRequests) requestCounts.set(request, (requestCounts.get(request) ?? 0) + 1);
  expect(Math.max(0, ...requestCounts.values())).toBeLessThanOrEqual(1);
  expect(Number(await host.getAttribute("data-ground-cache"))).toBeGreaterThanOrEqual(Number(await host.getAttribute("data-resident-chunks")));
  expect(Number(await host.getAttribute("data-ground-cache"))).toBeLessThanOrEqual(96);
  expect(Number(await host.getAttribute("data-chunk-data-cache"))).toBeLessThanOrEqual(160);
  expect(consoleProblems).toEqual([]);
});

test("recovers a failed chunk and paints a static map with reduced motion", async ({ page }) => {
  test.setTimeout(120_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  let failedOnce = false;
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
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(failedOnce).toBe(true);
});

test("shows a recoverable error after retries and keeps rendered ground", async ({ page }) => {
  test.setTimeout(120_000);
  let failChunks = false;
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
  expect(Number(await host.getAttribute("data-resident-chunks"))).toBeGreaterThan(0);
  failChunks = false;
  await alert.getByRole("button", { name: "Повторить" }).click();
  await expect(alert).toHaveCount(0);
  await expect.poll(async () => await host.getAttribute("data-loading"), { timeout: 90_000 }).toBe("false");
  await expect.poll(async () => Number(await host.getAttribute("data-resident-chunks"))).toBeGreaterThan(0);
});

test("progressively replaces LOD and recovers a rapid zoom reversal", async ({ page }) => {
  test.setTimeout(120_000);
  let slowLod: "overview" | "detail" = "detail";
  let armed = false;
  let slowOverviewStarted = false;
  let slowOverviewResolved = false;
  await page.route("**/api/chunks/**", async (route) => {
    const isSlowLod = armed && new URL(route.request().url()).searchParams.get("lod") === slowLod;
    if (isSlowLod && !slowOverviewStarted) {
      slowOverviewStarted = true;
      await new Promise((resolve) => setTimeout(resolve, 2_500));
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
  const beforeRebuilds = Number(await host.getAttribute("data-ground-rebuilds"));
  await canvas.hover();
  for (let step = 0; step < 6; step += 1) await page.mouse.wheel(0, slowLod === "overview" ? 800 : -800);
  await expect.poll(async () => slowOverviewStarted).toBe(true);
  await expect.poll(async () => Number(await host.getAttribute("data-ground-rebuilds"))).toBeGreaterThan(beforeRebuilds);
  expect(slowOverviewResolved).toBe(false);
  for (let step = 0; step < 6; step += 1) await page.mouse.wheel(0, slowLod === "overview" ? -800 : 800);
  await expect.poll(async () => await host.getAttribute("data-loading"), { timeout: 90_000 }).toBe("false");
  await expect(host).toHaveAttribute("data-map-lod", initialLod);
});

test("realtime task invalidation refetches and rebuilds the affected ground", async ({ page }) => {
  test.setTimeout(120_000);
  const requestedChunks = new Set<string>();
  page.on("request", (request) => {
    const match = new URL(request.url()).pathname.match(/\/api\/chunks\/(-?\d+)\/(-?\d+)/);
    if (match) requestedChunks.add(`${match[1]},${match[2]}`);
  });
  await page.goto("/");
  await page.getByLabel("Email").fill("demo@tasktopia.local");
  await page.getByLabel("Пароль").fill("tasktopia-demo");
  await page.getByRole("button", { name: "Открыть страну" }).click();
  const host = page.locator(".world-canvas");
  await expect.poll(async () => await host.getAttribute("data-loading"), { timeout: 90_000 }).toBe("false");

  const integration = await page.evaluate(async (visibleChunkKeys) => {
    const cities = await fetch("/api/plan/cities").then((response) => response.json()) as Array<{ id: string }>;
    for (const city of cities) {
      const districts = await fetch(`/api/plan/cities/${city.id}/districts`).then((response) => response.json()) as Array<{ id: string }>;
      for (const district of districts) {
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
  }, [...requestedChunks]);

  const beforeRebuilds = Number(await host.getAttribute("data-ground-rebuilds"));
  const beforeMovementRebuilds = Number(await host.getAttribute("data-movement-rebuilds"));
  requestedChunks.clear();
  const client = new Client({ name: "realtime-map-test", version: "1.0.0" }, { versionNegotiation: { mode: "auto" } });
  const transport = new StreamableHTTPClientTransport(new URL("/mcp", page.url()), {
    requestInit: { headers: { authorization: `Bearer ${integration.token}` } },
  });
  try {
    await client.connect(transport);
    const result = await client.callTool({
      name: "task.set_status",
      arguments: { taskId: integration.taskId, status: "STARTED", progress: 10, idempotencyKey: `e2e-map-${Date.now()}` },
    });
    expect(result.isError).not.toBe(true);
    await expect.poll(async () => Number(await host.getAttribute("data-ground-rebuilds")), { timeout: 30_000 }).toBeGreaterThan(beforeRebuilds);
    expect(requestedChunks.has(integration.chunkKey)).toBe(true);
    expect(Number(await host.getAttribute("data-movement-rebuilds"))).toBe(beforeMovementRebuilds);
  } finally {
    await client.close().catch(() => undefined);
    await page.evaluate(async (tokenId) => { await fetch(`/api/tokens/${tokenId}`, { method: "DELETE" }); }, integration.id);
  }
});
