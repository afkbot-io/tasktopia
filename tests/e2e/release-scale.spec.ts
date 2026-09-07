import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { PLANET_REVALIDATE_MS } from "../../src/client/planet-atlas-cache";

const output = process.env.RELEASE_SCALE_SCREENSHOT_DIR;
test.skip(process.env.E2E_RELEASE_SCALE !== "true", "Explicit local, real-generator scale fixture only");
test.use({ viewport: { width: 1440, height: 1000 }, trace: { mode: "retain-on-failure", screenshots: false, snapshots: false, sources: true } });

test("1000-task city: cold frame, bounded residency and 30 warm atlas round trips", async ({ page, context }, info) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  const reads: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error" && !message.text().includes("401 (Unauthorized)")) errors.push(message.text());
  });
  page.on("request", request => {
    const pathname = new URL(request.url()).pathname;
    if (/\/scene$|\/overview$|\/planet-atlas$|\/world\/viewport|\/chunks\//.test(pathname)) reads.push(pathname);
  });
  await page.goto("/");
  await page.getByLabel("Email").fill("release-scale-e@tasktopia.local");
  await page.getByLabel("Пароль").fill("local-scale-fixture-only");
  // Time the actual DOM click through the first complete CITY frame, not
  // Playwright's locator polling. Login/bootstrap/network are included.
  await page.evaluate(() => {
    const state = { elapsedMs: -1 };
    (window as typeof window & { __scaleCold?: typeof state }).__scaleCold = state;
    document.addEventListener("click", () => {
      const start = performance.now();
      const check = () => {
        if (document.querySelector('.world-canvas[data-city-scene-commit="atomic"][data-ground-bake-queue="0"]')) state.elapsedMs = performance.now() - start;
        else if (performance.now() - start < 90_000) requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
    }, { once: true, capture: true });
  });
  await page.getByRole("button", { name: "Открыть страну" }).click();
  const host = page.locator(".world-canvas");
  await expect(host).toHaveAttribute("data-city-scene-commit", "atomic", { timeout: 90_000 });
  await expect(host).toHaveAttribute("data-ground-bake-queue", "0", { timeout: 90_000 });
  await page.waitForFunction(() => ((window as typeof window & { __scaleCold?: { elapsedMs: number } }).__scaleCold?.elapsedMs ?? -1) >= 0);
  const coldMs = await page.evaluate(() => (window as typeof window & { __scaleCold: { elapsedMs: number } }).__scaleCold.elapsedMs);
  const resident = await host.evaluate(element => ({ ...((element as HTMLElement).dataset) }));
  expect(Number(resident.taskBuildingViews)).toBeGreaterThanOrEqual(1000);
  expect(reads.filter(value => value.endsWith("/scene"))).toHaveLength(1);
  expect(reads.filter(value => /\/world\/viewport|\/chunks\//.test(value))).toEqual([]);
  if (output) { await mkdir(output, { recursive: true }); await page.screenshot({ path: path.join(output, "city-1000.png") }); }

  const cityCanvas = await page.locator("canvas[aria-label='Интерактивная карта города']").elementHandle();
  const roundTrip = async (capture = false) => {
    await page.getByRole("button", { name: "Страна", exact: true }).click();
    await expect(page.locator(".country-overview")).toHaveAttribute("data-country-ready", "true");
    await expect(host).toHaveAttribute("data-animation-active", "false");
    if (capture && output) await page.screenshot({ path: path.join(output, "country-1000.png") });
    await page.getByRole("button", { name: "Планета", exact: true }).click();
    await expect(page.locator(".planet-atlas")).toHaveAttribute("data-planet-ready", "true");
    if (capture && output) await page.screenshot({ path: path.join(output, "planet-1000.png") });
    // Return through actual territory selectors. In overview modes the level
    // buttons intentionally do not guess which child country/city to open.
    await page.locator(".planet-country-label").click();
    await expect(page.locator(".country-overview")).toHaveAttribute("data-country-ready", "true");
    await page.locator(".country-overview-city").click();
    await expect(host).toHaveAttribute("data-map-active", "true");
    await expect(page.locator(".map-level-transition")).toHaveCount(0);
  };
  await roundTrip(true);
  await expect(host).toHaveAttribute("data-ambient-assets", "ready", { timeout: 60_000 });
  const warmedResident = await host.evaluate(element => ({ ...((element as HTMLElement).dataset) }));
  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable");
  const memory = async () => {
    await cdp.send("HeapProfiler.collectGarbage");
    const metrics = await cdp.send("Performance.getMetrics");
    return Object.fromEntries(metrics.metrics.filter(metric => ["JSHeapUsedSize", "JSHeapTotalSize", "Nodes", "Documents"].includes(metric.name)).map(metric => [metric.name, metric.value]));
  };
  // Force GC at BOTH endpoints: this measures retained JS, not transient
  // allocation or GPU memory; no claim about physical-device frame rate.
  const baseline = await memory();
  const warmStart = reads.length;
  const warmStartedAt = Date.now();
  const memorySamples = [baseline];
  for (let i = 0; i < 30; i++) {
    await roundTrip();
    if ((i + 1) % 10 === 0) memorySamples.push(await memory());
  }
  const final = memorySamples.at(-1)!;
  const finalResident = await host.evaluate(element => ({ ...((element as HTMLElement).dataset) }));
  const report = {
    fixture: "release_perf_20260905_e — real generator, 1000 tasks / 1 district, predominantly stage 1",
    browser: "Chromium / local software-rendered environment", viewport: page.viewportSize(),
    coldLoginToCompleteCityMs: coldMs, coldBudgetMs: 3000, resident, warmedResident, finalResident,
    warmMapReads: reads.slice(warmStart), memorySamples,
    retainedHeapGrowth: final.JSHeapUsedSize! / baseline.JSHeapUsedSize! - 1,
    groundTextureRGBAEstimateBytes: (Number(resident.staticGroundViews) + Number(resident.infrastructureOverlayViews)) * 512 * 512 * 4,
    memoryLimitations: "Estimate excludes CPU canvas backing and sprite textures; post-GC JS metrics do not measure GPU residency.", errors,
  };
  await info.attach("large-city-browser-evidence", { body: Buffer.from(JSON.stringify(report, null, 2)), contentType: "application/json" });
  if (output) await writeFile(path.join(output, "browser-scale.json"), `${JSON.stringify(report, null, 2)}\n`);
  expect(await cityCanvas!.evaluate(node => node === document.querySelector("canvas[aria-label='Интерактивная карта города']"))).toBe(true);
  expect(reads.slice(warmStart).filter(path => !path.endsWith("/planet-atlas"))).toEqual([]);
  expect(reads.slice(warmStart).filter(path => path.endsWith("/planet-atlas")).length)
    .toBeLessThanOrEqual(Math.ceil((Date.now() - warmStartedAt) / PLANET_REVALIDATE_MS));
  expect(finalResident.leasedAssets).toBe(warmedResident.leasedAssets);
  expect(finalResident.staticGroundViews).toBe(warmedResident.staticGroundViews);
  expect(report.retainedHeapGrowth).toBeLessThan(.2);
  expect(errors).toEqual([]);
  expect(coldMs).toBeGreaterThan(0);
  expect(coldMs).toBeLessThan(3000);
});
