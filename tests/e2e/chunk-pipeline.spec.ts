import { expect, test } from "@playwright/test";
import type { ChunkPayloadDto } from "../../src/shared/contracts";
import { materializeChunkPayload } from "../../src/shared/world-chunk-payload";

test("accepts full legacy chunks from a rollback server", async ({ page }) => {
  test.setTimeout(60_000);
  await page.route("**/api/world/viewport**", async (route) => {
    await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ message: "rollback server" }) });
  });
  await page.route("**/api/chunks/**", async (route) => {
    const response = await route.fetch();
    const body = await response.json() as ChunkPayloadDto;
    await route.fulfill({ response, json: materializeChunkPayload(body) });
  });

  await page.goto("/");
  await page.getByLabel("Email").fill("demo@tasktopia.local");
  await page.getByLabel("Пароль").fill("tasktopia-demo");
  await page.getByRole("button", { name: "Открыть страну" }).click();

  const host = page.locator(".world-canvas");
  await expect.poll(async () => await host.getAttribute("data-loading"), { timeout: 30_000 }).toBe("false");
  await expect.poll(async () => Number(await host.getAttribute("data-resident-chunks") ?? 0)).toBeGreaterThan(0);
  await expect(host).not.toHaveAttribute("data-load-error", "true");
});

test("slow sprite downloads do not block the chunk API pipeline", async ({ page }) => {
  test.setTimeout(60_000);
  const viewportStarts: number[] = [];

  await page.route("**/game-assets/**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 4_000));
    await route.continue();
  });
  page.on("request", (request) => {
    if (request.url().includes("/api/world/viewport")) viewportStarts.push(Date.now());
  });

  await page.goto("/");
  await page.getByLabel("Email").fill("demo@tasktopia.local");
  await page.getByLabel("Пароль").fill("tasktopia-demo");
  await page.getByRole("button", { name: "Открыть страну" }).click();
  await expect.poll(() => viewportStarts.length, {
    message: "the viewport JSON request must start while sprites are still downloading",
    timeout: 1_500,
  }).toBe(1);
});

test("paints seed ground while the viewport response is still delayed", async ({ page }) => {
  test.setTimeout(60_000);
  let delayedStarted = false;
  let delayedResolved = false;
  await page.route("**/api/world/viewport**", async (route) => {
    delayedStarted = true;
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    delayedResolved = true;
    await route.continue();
  });

  await page.goto("/");
  await page.getByLabel("Email").fill("demo@tasktopia.local");
  await page.getByLabel("Пароль").fill("tasktopia-demo");
  await page.getByRole("button", { name: "Открыть страну" }).click();

  const host = page.locator(".world-canvas");
  await expect.poll(() => delayedStarted, { timeout: 10_000 }).toBe(true);
  await expect.poll(async () => Number(await host.getAttribute("data-static-ground-views") ?? 0), {
    message: "deterministic seed ground must paint without a network response",
    timeout: 2_000,
  }).toBeGreaterThan(0);
  await expect(host).toHaveAttribute("data-seed-first-frame-mode", "synchronous");
  expect(delayedResolved).toBe(false);
});

test("paints static ground before a slow building sprite is available", async ({ page }) => {
  test.setTimeout(60_000);
  let delayedStarted = false;
  let delayedResolved = false;
  await page.route("**/game-assets/**", async (route) => {
    if (!delayedStarted && new URL(route.request().url()).pathname.includes("/buildings/")) {
      delayedStarted = true;
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      delayedResolved = true;
    }
    await route.continue();
  });

  await page.goto("/");
  await page.getByLabel("Email").fill("demo@tasktopia.local");
  await page.getByLabel("Пароль").fill("tasktopia-demo");
  await page.getByRole("button", { name: "Открыть страну" }).click();

  const host = page.locator(".world-canvas");
  await expect.poll(() => delayedStarted, { timeout: 15_000 }).toBe(true);
  await expect.poll(async () => Number(await host.getAttribute("data-static-ground-views") ?? 0), {
    message: "seed terrain must not wait for dynamic building PNGs",
    timeout: 1_500,
  }).toBeGreaterThan(0);
  expect(delayedResolved).toBe(false);
  const entityPublishesBeforeAsset = Number(await host.getAttribute("data-entity-ready-publishes") ?? 0);
  const entityRebuildsBeforeAsset = Number(await host.getAttribute("data-entity-rebuilds") ?? 0);
  await expect.poll(() => delayedResolved, { timeout: 10_000 }).toBe(true);
  await expect.poll(async () => Number(await host.getAttribute("data-entity-rebuilds") ?? 0), {
    message: "the chunk must reconcile again after its delayed entity asset becomes ready",
    timeout: 10_000,
  }).toBeGreaterThan(entityRebuildsBeforeAsset);
  await expect.poll(async () => Number(await host.getAttribute("data-entity-ready-publishes") ?? 0), {
    message: "the delayed chunk must become entity-ready after its building texture loads",
    timeout: 10_000,
  }).toBeGreaterThan(entityPublishesBeforeAsset);
});

test("retries entity assets after ground has already committed", async ({ page }) => {
  test.setTimeout(60_000);
  let buildingFailureSeen = false;
  let buildingRetrySeen = false;
  await page.route("**/game-assets/**", async (route) => {
    if (!new URL(route.request().url()).pathname.includes("/buildings/")) {
      await route.continue();
      return;
    }
    if (!buildingFailureSeen) {
      buildingFailureSeen = true;
      await route.abort("failed");
      return;
    }
    buildingRetrySeen = true;
    await route.continue();
  });

  await page.goto("/");
  await page.getByLabel("Email").fill("demo@tasktopia.local");
  await page.getByLabel("Пароль").fill("tasktopia-demo");
  await page.getByRole("button", { name: "Открыть страну" }).click();
  const host = page.locator(".world-canvas");
  const canvas = page.locator("canvas[aria-label='Интерактивная карта страны']");
  await expect.poll(async () => await host.getAttribute("data-loading"), { timeout: 30_000 }).toBe("false");
  await canvas.hover();
  for (let step = 0; step < 8 && await host.getAttribute("data-map-lod") !== "detail"; step += 1) await page.mouse.wheel(0, -800);

  await expect.poll(() => buildingFailureSeen, { timeout: 15_000 }).toBe(true);
  await expect.poll(() => buildingRetrySeen, {
    message: "an entity-only failure must be retried even though its ground is already resident",
    timeout: 15_000,
  }).toBe(true);
  await expect.poll(async () => await host.getAttribute("data-loading"), { timeout: 30_000 }).toBe("false");
  await expect(host).not.toHaveAttribute("data-load-error", "true");
});
