/** Local, read-only browser benchmark. Login is the only application write. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { cpus, platform } from "node:os";
import { chromium, expect } from "@playwright/test";
import { openMapCity, openMapPlanet } from "../tests/e2e/map-navigation";
import type { CitySceneDto } from "../src/shared/city-scene-contract";

const url = process.env.AUDIT_URL ?? "http://127.0.0.1:5186";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(url).hostname));
const variant = process.env.AUDIT_VARIANT ?? "baseline";
const workload = process.env.AUDIT_WORKLOAD ?? "parks30";
assert.ok(/^[a-zA-Z0-9_-]+$/.test(variant) && /^[a-zA-Z0-9_-]+$/.test(workload));
const count = Number(process.env.AUDIT_SAMPLES ?? 3);
assert.ok(Number.isInteger(count) && count >= 1 && count <= 10);
const churnCycles = Number(process.env.AUDIT_CHURN_CYCLES ?? 0);
assert.ok(Number.isInteger(churnCycles) && churnCycles >= 0 && churnCycles <= 20);
const profile = process.env.AUDIT_PROFILE === "true";
const compact = process.env.AUDIT_COMPACT === "true";
const headed = process.env.AUDIT_HEADED === "true";
const quality = process.env.AUDIT_QUALITY ?? "AUTO";
assert.ok(["AUTO", "NORMAL", "ECONOMY"].includes(quality));
const label = process.env.AUDIT_LABEL ?? "";
assert.ok(/^[a-zA-Z0-9_-]*$/.test(label));
const directory = `tmp/city-art-load/${variant}-${workload}${compact ? "-compact" : ""}${profile ? "-profile" : ""}${label ? `-${label}` : ""}`;
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ headless: !headed });
const samples = [], errors: string[] = [];
let failure: string | null = null;
try {
  for (let sample = 0; sample < count; sample++) {
    const context = await browser.newContext({ baseURL: url, viewport: compact ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, deviceScaleFactor: 1, serviceWorkers: "block" });
    try {
      const login = await context.request.post("/api/auth/login", { data: { email: process.env.AUDIT_EMAIL ?? "demo@tasktopia.local", password: process.env.AUDIT_PASSWORD ?? "tasktopia-demo" } });
      assert.equal(login.status(), 200);
      const page = await context.newPage();
      const paths: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      page.on("requestfailed", request => errors.push(request.url()));
      page.on("response", response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
      page.on("request", request => paths.push(new URL(request.url()).pathname));
      await page.addInitScript(() => performance.setResourceTimingBufferSize(5000));
      await page.addInitScript(() => {
        const state: Array<{ startTime: number; duration: number }> = [];
        (window as typeof window & { __cityAuditLongTasks: typeof state }).__cityAuditLongTasks = state;
        if (PerformanceObserver.supportedEntryTypes.includes("longtask")) {
          new PerformanceObserver(list => {
            for (const entry of list.getEntries()) state.push({ startTime: entry.startTime, duration: entry.duration });
          }).observe({ type: "longtask", buffered: true });
        }
      });
      await page.addInitScript(quality => localStorage.setItem("tasktopia:world-preferences:v2", JSON.stringify({
        cityLife: true, reduceMotion: false, quality,
      })), quality);
      const cdp = await context.newCDPSession(page);
      await cdp.send("Performance.enable");
      if (profile) { await cdp.send("Profiler.enable"); await cdp.send("Profiler.start"); }
      const response = page.waitForResponse(response => /\/cities\/[^/]+\/scene$/.test(new URL(response.url()).pathname));
      const start = performance.now();
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await expect(page.locator(".planet-atlas")).toHaveAttribute("data-planet-ready", "true", { timeout: 30_000 });
      const bootstrapResponse = await page.request.get("/api/bootstrap");
      assert.equal(bootstrapResponse.status(), 200, "Cold entry requires a successful bootstrap");
      const bootstrap = await bootstrapResponse.json();
      assert.ok(bootstrap.initialCity?.id, "Cold entry requires a fixture city");
      await page.locator(`.planet-city-targets [data-city-id="${bootstrap.initialCity.id}"]`).focus();
      const enter = performance.now();
      await page.keyboard.press("Enter");
      const host = page.locator(".world-canvas");
      await expect(host).toHaveAttribute("data-city-scene-commit", "atomic", { timeout: 60_000 });
      const coldMs = performance.now() - enter;
      await expect(page.locator(".map-level-transition")).toHaveCount(0);
      const interactiveMs = performance.now() - enter, appMs = performance.now() - start;
      const scene = await (await response).json() as CitySceneDto;
      const tasks = [...new Map([...scene.chunks.flatMap(chunk => chunk.tasks), ...scene.completedDistrictSnapshots.flatMap(snapshot => snapshot.tasks)]
        .map(task => [task.id, task])).values()].sort((a, b) => a.id.localeCompare(b.id));
      const geometryHash = createHash("sha256").update(JSON.stringify({ city: scene.city, roads: scene.roadContext,
        tasks: tasks.map(task => ({ id: task.id, taskNumber: task.taskNumber, stage: task.stage, buildingType: task.buildingType,
          visualKind: task.visualKind, visualAssetKey: task.visualAssetKey, origin: task.origin, footprint: task.footprint, accessPath: task.accessPath })),
        chunks: scene.chunks.map(chunk => ({ x: chunk.chunkX, y: chunk.chunkY, roads: chunk.roadRuns, surfaces: chunk.surfaceRuns,
          districts: chunk.districts, sites: chunk.plannedSites, features: chunk.worldFeatures })),
      })).digest("hex");
      if (profile) await writeFile(`${directory}/${sample}.cpuprofile`, JSON.stringify((await cdp.send("Profiler.stop")).profile));
      const resources = await page.evaluate(() => performance.getEntriesByType("resource").map(entry => entry.toJSON()));
      const coldTelemetry = await host.evaluate(el => ({ ...(el as HTMLElement).dataset }));
      const renderer = await page.locator(".world-canvas canvas").evaluate(canvas => {
        const gl = (canvas as HTMLCanvasElement).getContext("webgl2") ?? (canvas as HTMLCanvasElement).getContext("webgl");
        const debug = gl?.getExtension("WEBGL_debug_renderer_info");
        return debug ? gl!.getParameter(debug.UNMASKED_RENDERER_WEBGL) as string : "unavailable";
      });
      await expect(host).toHaveAttribute("data-ground-bake-queue", "0", { timeout: 30_000 });
      await expect(host).toHaveAttribute("data-mobility-ready", "true", { timeout: 30_000 });
      await page.waitForTimeout(3000);
      const sampledTelemetryStart = await host.evaluate(el => ({ ...(el as HTMLElement).dataset }));
      const steadyStart = await page.evaluate(() => performance.now());
      const frames = await page.evaluate<number[]>(`new Promise(resolve => {
        const values = []; let previous = performance.now(); const start = previous;
        function frame(now) { values.push(now - previous); previous = now;
          if (now - start >= 8000) resolve(values); else requestAnimationFrame(frame); }
        requestAnimationFrame(frame);
      })`);
      const sampledTelemetryEnd = await host.evaluate(el => ({ ...(el as HTMLElement).dataset }));
      const steadyLongTasks = await page.evaluate(start => {
        const state = (window as typeof window & { __cityAuditLongTasks: Array<{ startTime: number; duration: number }> }).__cityAuditLongTasks;
        return state.filter(entry => entry.startTime >= start);
      }, steadyStart);
      await openMapPlanet(page);
      await expect(page.locator(".planet-atlas")).toHaveAttribute("data-planet-ready", "true");
      const warmStart = performance.now();
      await openMapCity(page);
      await expect(host).toBeVisible();
      await expect(host).toHaveAttribute("data-city-scene-commit", "atomic");
      await expect(page.locator(".map-level-transition")).toHaveCount(0);
      const warmMs = performance.now() - warmStart;
      await cdp.send("HeapProfiler.collectGarbage");
      const metrics = (await cdp.send("Performance.getMetrics")).metrics;
      const heapBeforeChurn = metrics.find(metric => metric.name === "JSHeapUsedSize")!.value;
      const retainedCanvas = await host.locator("canvas").elementHandle();
      for (let cycle = 0; cycle < churnCycles; cycle++) {
        await openMapPlanet(page);
        await expect(host).toHaveAttribute("data-animation-active", "false");
        await openMapCity(page);
        await expect(host).toHaveAttribute("data-city-scene-commit", "atomic");
        await expect(page.locator(".map-level-transition")).toHaveCount(0);
        assert.equal(await retainedCanvas!.evaluate(el => el === document.querySelector(".world-canvas canvas")), true);
      }
      let heapAfterChurn = heapBeforeChurn;
      if (churnCycles > 0) {
        await page.waitForTimeout(1000);
        await cdp.send("HeapProfiler.collectGarbage");
        heapAfterChurn = (await cdp.send("Performance.getMetrics")).metrics.find(metric => metric.name === "JSHeapUsedSize")!.value;
      }
      const sorted = frames.slice(1).sort((a, b) => a - b);
      const result = { sample, coldMs, interactiveMs, appMs, warmMs, geometryHash, chunks: scene.chunks.length,
        tasks: tasks.length,
        sceneRequests: paths.filter(path => /\/cities\/[^/]+\/scene$/.test(path)).length,
        viewportRequests: paths.filter(path => /\/api\/(?:world\/(?:viewport|chunks)|chunks\/)/.test(path)).length,
        p50FrameMs: sorted[Math.floor(sorted.length * .5)], p95FrameMs: sorted[Math.floor(sorted.length * .95)],
        heapBytes: heapBeforeChurn, churnCycles, heapAfterChurn, heapChurnDeltaBytes: heapAfterChurn - heapBeforeChurn,
        steadyLongTasks, renderer, coldTelemetry,
        sampledTelemetryStart, sampledTelemetryEnd, resources };
      samples.push(result);
      console.log(JSON.stringify({ sample, coldMs, appMs, warmMs, geometryHash, chunks: result.chunks, tasks: result.tasks,
        sceneRequests: result.sceneRequests, viewportRequests: result.viewportRequests, p95FrameMs: result.p95FrameMs, heapBytes: result.heapBytes }));
    } finally { await context.close(); }
  }
  assert.deepEqual(errors, []);
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
  throw error;
} finally {
  try {
    await writeFile(`${directory}/report.json`, JSON.stringify({ variant, workload, profile, compact, headed, quality, churnCycles,
      expectedSamples: count, complete: failure === null && samples.length === count, failure,
      viewport: compact ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, deviceScaleFactor: 1,
      browser: browser.version(), host: { platform: platform(), cpu: cpus()[0]?.model }, network: "local unrestricted", samples, errors }, null, 2));
  } finally { await browser.close(); }
}
