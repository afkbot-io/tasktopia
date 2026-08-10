import { expect, test } from "@playwright/test";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

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
  await expect(host).toHaveAttribute("data-wrong-way-cars", "0");
  await expect(host).toHaveAttribute("data-wrong-way-buses", "0");
  await expect(host).toHaveAttribute("data-airplane-space", "world");
  return { host, canvas };
}

test("keeps visible agent state across detail zoom and randomizes a new page session", async ({ page }) => {
  test.setTimeout(120_000);
  let { host, canvas } = await openDemoMap(page);
  const idsBefore = new Set((await host.getAttribute("data-agent-ids"))!.split(",").filter(Boolean));
  const sessionBefore = await host.getAttribute("data-agent-session");
  const rebuildsBefore = Number(await host.getAttribute("data-movement-rebuilds") ?? 0);
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
  const currentLod = await host.getAttribute("data-map-lod");
  await canvas.hover();
  for (let step = 0; step < 6; step += 1) await page.mouse.wheel(0, currentLod === "overview" ? -800 : 800);
  await expect(page.getByText("Подгружаем карту…", { exact: true })).toBeVisible();
  await expect.poll(async () => await host.getAttribute("data-loading"), { timeout: 90_000 }).toBe("false");
  await expect(page.getByText("Подгружаем карту…", { exact: true })).toBeHidden();

  const requestCounts = new Map<string, number>();
  for (const request of chunkRequests) requestCounts.set(request, (requestCounts.get(request) ?? 0) + 1);
  // A 64-cell chunk is roughly half a desktop viewport. Pan plus one LOD
  // transition must stay inside a bounded visible-only request budget instead
  // of expanding to the former 30+ request prefetch ring.
  expect(chunkRequests.length).toBeLessThanOrEqual(20);
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
  await canvas.hover();
  for (let step = 0; step < 6; step += 1) await page.mouse.wheel(0, slowLod === "overview" ? 800 : -800);
  await expect.poll(async () => slowOverviewStarted).toBe(true);
  await expect(page.getByText("Подгружаем карту…", { exact: true })).toBeVisible();
  expect(Number(await host.getAttribute("data-resident-chunks"))).toBeGreaterThan(0);
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
  const canvas = page.locator("canvas[aria-label='Интерактивная карта страны']");
  requestedChunks.clear();
  await canvas.hover();
  for (let step = 0; step < 8 && await host.getAttribute("data-map-lod") !== "detail"; step += 1) await page.mouse.wheel(0, -800);
  await expect(host).toHaveAttribute("data-map-lod", "detail", { timeout: 90_000 });
  await expect.poll(async () => await host.getAttribute("data-loading"), { timeout: 90_000 }).toBe("false");

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
    expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
    await expect.poll(async () => Number(await host.getAttribute("data-ground-rebuilds")), { timeout: 30_000 }).toBeGreaterThan(beforeRebuilds);
    expect(requestedChunks.has(integration.chunkKey)).toBe(true);
    expect(Number(await host.getAttribute("data-movement-rebuilds"))).toBe(beforeMovementRebuilds);

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
    const checklistResult = await client.callTool({
      name: "task.checklist_replace",
      arguments: {
        taskId: integration.taskId,
        items: [{ title: "Проверить realtime-перестроение здания", done: true }],
        idempotencyKey: `e2e-map-checklist-${Date.now()}`,
      },
    });
    expect(checklistResult.isError).not.toBe(true);
    for (const [status, progress] of [["IN_PROGRESS", 55], ["TESTING", 90], ["COMPLETED", 100]] as const) {
      const result = await client.callTool({
        name: "task.set_status",
        arguments: { taskId: integration.taskId, status, progress, idempotencyKey: `e2e-map-${status}-${Date.now()}` },
      });
      expect(result.isError).not.toBe(true);
    }
    await expect(page.locator(".realtime-notice-success")).toContainText("Здание завершено — город обновлён");
    await expect.poll(async () => Number(await host.getAttribute("data-celebrations") ?? 0), { timeout: 30_000 }).toBeGreaterThan(0);
  } finally {
    await client.close().catch(() => undefined);
    await page.evaluate(async (tokenId) => { await fetch(`/api/tokens/${tokenId}`, { method: "DELETE" }); }, integration.id);
  }
});
