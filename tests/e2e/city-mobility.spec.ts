import { createHash } from "node:crypto";
import { mkdir, open, readFile, writeFile } from "node:fs/promises";
import { cpus, platform, release } from "node:os";
import path from "node:path";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import type { BootstrapDto, PlanDistrictDto } from "../../src/shared/contracts";
import { CITY_SCENE_SCHEMA_VERSION, type CitySceneDto } from "../../src/shared/city-scene-contract";
import { CDP_TRACE_BYTE_BUDGET, streamCdpTrace } from "../helpers/cdp-trace-stream";

// This is an explicit, read-only acceptance run against the existing 40-task /
// three-district local demo. It must not silently reseed the shared UI fixture.
test.skip(process.env.E2E_MOBILITY_FIXTURE !== "true", "Use the dedicated compact demo schema and E2E_MOBILITY_FIXTURE=true");
test.use({ viewport: { width: 1440, height: 1000 },
  // Do not continuously read back the WebGL framebuffer for trace thumbnails
  // during the measured run. Explicit review captures happen after sampling.
  trace: { mode: "retain-on-failure", screenshots: false, snapshots: true, sources: true } });

// The normal acceptance run is two minutes. A shorter explicit override is
// useful for diagnosis, but is not the final delivery gate.
const SAMPLE_DURATION_MS = Number(process.env.MOBILITY_SAMPLE_DURATION_MS ?? 120_000);
if (!Number.isInteger(SAMPLE_DURATION_MS) || SAMPLE_DURATION_MS < 40_000 || SAMPLE_DURATION_MS > 300_000 || SAMPLE_DURATION_MS % 10_000 !== 0) {
  throw new Error("MOBILITY_SAMPLE_DURATION_MS must be 40–300 seconds in complete ten-second windows");
}
const SAMPLE_INTERVAL_MS = 100;
// The pure engine's multi-minute tests are the individual non-starvation proof.
// This browser bound catches runaway waiting; each 10-second window below must
// additionally contain actual cell transitions by BOTH kinds of road user.
const WAIT_BUDGET_MS = 60_000;
const numericMetrics = [
  "cars", "walkers", "trafficLifetimeSteps", "walkerLifetimeSteps", "mobilityFixedSteps",
  "trafficUnsafePairs", "trafficPedestrianUnsafePairs", "trafficVehiclePedestrianUnsafePairs",
  "mobilityVehicleUnsafeTotal", "mobilityPedestrianUnsafeTotal", "mobilityVehiclePedestrianUnsafeTotal",
  "trafficMaxWaitMs", "pedestrianMaxWaitMs", "trafficSignals", "mobilityNetworkBuilds",
  "mobilityTrips", "mobilityCrossings", "wrongWayCars", "walkerOffPath", "walkerRoadActivities",
  "mobilityStepP95Ms", "mobilityStepMaxMs",
  "mobilityPeakVehicleWaitMs", "mobilityPeakWalkerWaitMs",
  "agentSession",
  "mobilityPostPathConflicts",
] as const;
type NumericMetric = typeof numericMetrics[number];
type MobilitySample = Record<NumericMetric, number> & { elapsedMs: number; signalState: string; ready: string };

async function ready(page: Page): Promise<void> {
  const host = page.locator(".world-canvas");
  await expect(host).toBeVisible({ timeout: 45_000 });
  await expect(host).toHaveAttribute("data-map-active", "true");
  await expect(host).toHaveAttribute("data-map-lod", "detail", { timeout: 45_000 });
  await expect(host).toHaveAttribute("data-city-scene-commit", "atomic", { timeout: 45_000 });
  await expect(host).toHaveAttribute("data-ground-bake-queue", "0", { timeout: 45_000 });
  await expect(host).toHaveAttribute("data-mobility-ready", "true", { timeout: 45_000 });
  await expect(host).toHaveAttribute("data-mobility-post-path-conflicts", "0");
  await expect.poll(async () => Number(await host.getAttribute("data-cars")), { timeout: 15_000 }).toBeGreaterThan(0);
  await expect.poll(async () => Number(await host.getAttribute("data-walkers")), { timeout: 15_000 }).toBeGreaterThan(0);
  await expect(page.locator(".map-level-transition")).toHaveCount(0);
}

async function sampleMobility(page: Page) {
  return page.evaluate(async ({ keys, durationMs, intervalMs }) => {
    const host = document.querySelector<HTMLElement>(".world-canvas")!;
    const startedAt = performance.now();
    performance.mark("tasktopia.mobility.sample:start");
    const samples: Array<Record<string, number | string>> = [];
    const frameDurations: number[] = [];
    const longTasks: number[] = [];
    const longTaskTimeline: Array<{ startMs: number; durationMs: number }> = [];
    let previousFrame = startedAt;
    let frameId: number;
    const frame = (now: number) => {
      frameDurations.push(now - previousFrame);
      previousFrame = now;
      frameId = requestAnimationFrame(frame);
    };
    frameId = requestAnimationFrame(frame);
    const recordLongTasks = (entries: PerformanceEntry[]) => {
      for (const entry of entries) {
        longTasks.push(entry.duration);
        longTaskTimeline.push({ startMs: entry.startTime - startedAt, durationMs: entry.duration });
      }
    };
    const observer = new PerformanceObserver(list => recordLongTasks(list.getEntries()));
    observer.observe({ type: "longtask", buffered: false });
    try {
      for (;;) {
        if (!host.isConnected || document.visibilityState !== "visible") throw new Error("The sampled CITY host was replaced or hidden");
        const sample: Record<string, number | string> = {
          elapsedMs: performance.now() - startedAt, signalState: host.dataset.mobilitySignalState ?? "", ready: host.dataset.mobilityReady ?? "",
        };
        for (const key of keys) {
          const raw = host.dataset[key];
          if (raw == null || raw.trim() === "" || !Number.isFinite(Number(raw))) throw new Error(`Missing numeric mobility telemetry: ${key}=${raw}`);
          sample[key] = Number(raw);
        }
        samples.push(sample);
        if (performance.now() - startedAt >= durationMs) break;
        await new Promise<void>(resolve => setTimeout(resolve, intervalMs));
      }
    } finally {
      cancelAnimationFrame(frameId);
      recordLongTasks(observer.takeRecords());
      observer.disconnect();
      performance.mark("tasktopia.mobility.sample:end");
    }
    frameDurations.sort((a, b) => a - b);
    return {
      samples,
      frameTiming: {
        frames: frameDurations.length,
        p50Ms: frameDurations[Math.floor(frameDurations.length * .5)] ?? 0,
        p95Ms: frameDurations[Math.floor(frameDurations.length * .95)] ?? 0,
        maxMs: frameDurations.at(-1) ?? 0,
        longTasks,
        longTaskTimeline,
      },
    };
  }, { keys: [...numericMetrics], durationMs: SAMPLE_DURATION_MS, intervalMs: SAMPLE_INTERVAL_MS }) as Promise<{
    samples: MobilitySample[];
    frameTiming: { frames: number; p50Ms: number; p95Ms: number; maxMs: number; longTasks: number[];
      longTaskTimeline: Array<{ startMs: number; durationMs: number }> };
  }>;
}

/** Opt-in diagnostic only: profiler overhead is never called a final frame budget. */
async function beginMobilityProfile(page: Page): Promise<() => Promise<void>> {
  const directory = process.env.MOBILITY_PROFILE_DIR;
  if (!directory) return async () => undefined;
  await mkdir(directory, { recursive: true });
  const browser = page.context().browser();
  const browserSession = await browser!.newBrowserCDPSession();
  try {
    const system = await browserSession.send("SystemInfo.getInfo");
    const source = await readFile("src/client/components/WorldCanvas.tsx");
    const frame = await page.evaluate(() => {
      const host = document.querySelector<HTMLElement>(".world-canvas")!;
      return { width: innerWidth, height: innerHeight, devicePixelRatio,
        scale: host.dataset.renderScale, cameraX: host.dataset.cameraWorldX, cameraY: host.dataset.cameraWorldY,
        cars: host.dataset.cars, walkers: host.dataset.walkers, objects: host.dataset.worldObjects,
        light: host.dataset.lightPhase, lampIntensity: host.dataset.lampIntensity,
        bundles: performance.getEntriesByType("resource").map(entry => entry.name).filter(name => /\/assets\/.*\.js/.test(name)) };
    });
    await writeFile(path.join(directory, "environment.json"), JSON.stringify({
      profiling: true, startedAtUtc: new Date().toISOString(), sampleDurationMs: SAMPLE_DURATION_MS,
      browser: browser!.version(), platform: platform(), release: release(), cpu: cpus()[0]?.model,
      logicalCpus: cpus().length, sourceSha256: createHash("sha256").update(source).digest("hex"),
      system, frame,
    }, null, 2));
  } finally { await browserSession.detach(); }
  const session = await page.context().newCDPSession(page);
  const complete = new Promise<{ stream?: string; dataLossOccurred: boolean }>(resolve => session.once("Tracing.tracingComplete", resolve));
  let traceEnd: Promise<void> | undefined;
  let incomplete: string | undefined;
  const stopTrace = () => traceEnd ??= session.send("Tracing.end").then(() => undefined);
  session.on("Tracing.bufferUsage", usage => {
    if ((usage.percentFull ?? usage.value ?? 0) >= .85 && !traceEnd) {
      incomplete = "Trace buffer budget reached before the sample ended";
      void stopTrace().catch(() => { incomplete = "Trace buffer budget reached; stopping trace failed"; });
    }
  });
  await session.send("Profiler.enable");
  await session.send("Profiler.setSamplingInterval", { interval: 1_000 });
  await session.send("Profiler.start");
  await session.send("Tracing.start", {
    // Per-draw GPU and generic toplevel tasks produced hundreds of MB. The
    // default bounded capture focuses on app callbacks/GC; GPU backend remains
    // explicit in environment.json. A full native-process study is separate.
    traceConfig: { recordMode: "recordUntilFull", traceBufferSizeInKb: 64 * 1024,
      includedCategories: ["devtools.timeline", "v8", "blink.user_timing"] },
    bufferUsageReportingInterval: 1_000,
    transferMode: "ReturnAsStream",
  });
  return async () => {
    try {
      const { profile } = await session.send("Profiler.stop");
      await writeFile(path.join(directory, "main-thread.cpuprofile"), JSON.stringify(profile));
      await stopTrace();
      const { stream, dataLossOccurred } = await complete;
      if (dataLossOccurred) incomplete = "Chromium reported lost trace events";
      if (!stream) throw new Error("Chromium did not return the diagnostic timeline stream");
      const output = await open(path.join(directory, "main-thread-trace.json"), "w");
      try {
        await streamCdpTrace(size => session.send("IO.read", { handle: stream, size }),
          bytes => output.writeFile(bytes));
      } finally {
        await output.close();
        await session.send("IO.close", { handle: stream });
      }
      if (incomplete) throw new Error(`Incomplete diagnostic: ${incomplete}`);
      await writeFile(path.join(directory, "profile-status.json"), JSON.stringify({ complete: true, byteBudget: CDP_TRACE_BYTE_BUDGET }));
    } catch (error) {
      await writeFile(path.join(directory, "profile-status.json"), JSON.stringify({ complete: false,
        byteBudget: CDP_TRACE_BYTE_BUDGET, reason: error instanceof Error ? error.message : "Trace export failed" }));
      throw error;
    } finally {
      await stopTrace().catch(() => undefined);
      await session.detach();
    }
  };
}

async function capture(page: Page, testInfo: TestInfo, name: string, directory?: string): Promise<void> {
  await page.mouse.move(20, 25);
  const body = await page.screenshot({ ...(directory ? { path: path.join(directory, `${name}.png`) } : {}), fullPage: true });
  await testInfo.attach(name, { body, contentType: "image/png" });
}

async function readScene(page: Page, countryId: string, cityId: string): Promise<CitySceneDto> {
  const response = await page.request.get(`/api/countries/${countryId}/cities/${cityId}/scene`, {
    headers: { accept: `application/vnd.tasktopia.city-scene+json; version=${CITY_SCENE_SCHEMA_VERSION}` },
  });
  expect(response.status()).toBe(200);
  return response.json() as Promise<CitySceneDto>;
}

function geometryDigest(scene: CitySceneDto): string {
  return createHash("sha256").update(JSON.stringify({ city: scene.city, chunks: scene.chunks,
    completedDistrictSnapshots: scene.completedDistrictSnapshots, airportConnections: scene.airportConnections, intercityRoads: scene.intercityRoads })).digest("hex");
}

test("keeps cars and walkers moving safely through a long sampled run, district focus and atlas return", async ({ page }, testInfo) => {
  test.setTimeout(SAMPLE_DURATION_MS + 110_000);
  const directory = process.env.MOBILITY_SCREENSHOT_DIR;
  if (directory) await mkdir(directory, { recursive: true });
  const pageErrors: string[] = [];
  const consoleIssues: string[] = [];
  const consoleTimeline: Array<{ phase: string; type: string; text: string; atMs: number }> = [];
  let phase = "startup";
  const runStarted = Date.now();
  const failedRequests: string[] = [];
  const missingResponses: string[] = [];
  // Diagnostic observation only: the native function, arguments and return
  // value are preserved. This separates actual application GPU readbacks from
  // browser/driver startup warnings without suppressing any console message.
  await page.addInitScript(() => {
    const observation = { readbacks: [] as Array<{ atMs: number; phase: string; size: number[]; canvas: number[]; stack: string }> };
    Object.defineProperty(window, "__mobilityGpuObservation", { value: observation, configurable: true });
    for (const Context of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
      if (!Context) continue;
      const prototype = Context.prototype;
      const original = prototype.readPixels;
      Object.defineProperty(prototype, "readPixels", { configurable: true, writable: true,
        value: new Proxy(original, { apply(target, context, args) {
          const canvas = Reflect.get(context, "canvas") as HTMLCanvasElement | OffscreenCanvas;
          observation.readbacks.push({ atMs: performance.now(),
            phase: document.querySelector<HTMLElement>(".world-canvas")?.dataset.mobilityReady === "true" ? "city-ready" : "startup-or-atlas",
            size: args.slice(0, 4).map(Number), canvas: [canvas.width, canvas.height], stack: new Error("readPixels call site").stack ?? "" });
          return Reflect.apply(target, context, args);
        } }),
      });
    }
  });
  page.on("pageerror", error => pageErrors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error" || (message.type() === "warning" && /webgl|pixi|texture|context.?lost/i.test(message.text()))) {
      consoleIssues.push(message.text());
      consoleTimeline.push({ phase, type: message.type(), text: message.text(), atMs: Date.now() - runStarted });
    }
  });
  page.on("requestfailed", request => {
    // Normal map-level cancellation is not a failed network resource. A PNG
    // failure is never filtered, even when its consumer has been unmounted.
    if (!/ERR_ABORTED/.test(request.failure()?.errorText ?? "") || /\.png(?:\?|$)/i.test(request.url())) {
      failedRequests.push(`${request.failure()?.errorText} ${new URL(request.url()).pathname}`);
    }
  });
  page.on("response", response => {
    const pathname = new URL(response.url()).pathname;
    const anonymousSession = response.status() === 401 && ["/api/session", "/api/bootstrap"].includes(pathname);
    if (response.status() >= 400 && !anonymousSession) missingResponses.push(`${response.status()} ${pathname}`);
  });

  await page.goto("/");
  await page.getByLabel("Email").fill("demo@tasktopia.local");
  await page.getByLabel("Пароль").fill("tasktopia-demo");
  await page.getByRole("button", { name: "Открыть страну" }).click();
  await expect(page.locator(".country-title-button")).toBeVisible();
  const bootstrapResponse = await page.request.get("/api/bootstrap");
  expect(bootstrapResponse.status()).toBe(200);
  const bootstrap = await bootstrapResponse.json() as BootstrapDto;
  expect(bootstrap.initialCity).not.toBeNull();
  const city = bootstrap.initialCity!;
  await page.locator(".country-title-button").click();
  await page.getByRole("dialog", { name: "Выбор страны" }).getByRole("button", { name: "План страны" }).click();
  await page.getByRole("complementary", { name: "План страны" }).locator(".plan-row > button:first-child").filter({ hasText: city.name }).click();
  await ready(page);
  const host = page.locator(".world-canvas");
  const canvas = page.locator("canvas[aria-label='Интерактивная карта города']");
  const originalCanvas = await canvas.elementHandle();
  const sceneBefore = await readScene(page, bootstrap.country.id, city.id);
  const tasks = [...new Map([...sceneBefore.chunks.flatMap(chunk => chunk.tasks),
    ...sceneBefore.completedDistrictSnapshots.flatMap(snapshot => snapshot.tasks)].map(task => [task.id, task])).values()];
  const districtResponse = await page.request.get(`/api/plan/cities/${city.id}/districts`);
  expect(districtResponse.status()).toBe(200);
  const districts = await districtResponse.json() as PlanDistrictDto[];
  expect(tasks).toHaveLength(40);
  expect(districts).toHaveLength(3);

  // Frame the complete city with ordinary wheel/pan gestures. The API supplies
  // geography only; all camera changes still go through the real canvas UI.
  await canvas.hover();
  const sampleScale = Math.max(1.05, Number(await host.getAttribute("data-minimum-render-scale")) + .025);
  const currentScale = Number(await host.getAttribute("data-render-scale"));
  if (currentScale > sampleScale) {
    // The minimum is now the COUNTRY transition boundary. Stay in detail CITY
    // for mobility measurement; crossing it is a separate wheel-navigation test.
    await page.mouse.wheel(0, Math.log(currentScale / sampleScale) / .0015);
  }
  await expect.poll(async () => Number(await host.getAttribute("data-render-scale"))).toBeCloseTo(Math.min(currentScale, sampleScale), 2);
  const scale = Number(await host.getAttribute("data-render-scale"));
  const cameraX = Number(await host.getAttribute("data-camera-world-x"));
  const cameraY = Number(await host.getAttribute("data-camera-world-y"));
  const cityCenter = { x: (sceneBefore.city.bounds.minX + sceneBefore.city.bounds.maxX) / 2,
    y: (sceneBefore.city.bounds.minY + sceneBefore.city.bounds.maxY) / 2 };
  const canvasBox = (await canvas.boundingBox())!;
  const dragFrom = { x: canvasBox.x + canvasBox.width / 2, y: canvasBox.y + canvasBox.height / 2 };
  await page.mouse.move(dragFrom.x, dragFrom.y);
  await page.mouse.down();
  await page.mouse.move(dragFrom.x + (cameraX - cityCenter.x) * 8 * scale,
    dragFrom.y + (cameraY - cityCenter.y) * 8 * scale, { steps: 8 });
  await page.mouse.up();
  await ready(page);
  phase = `sample-${SAMPLE_DURATION_MS / 1_000}-seconds`;
  const systemSession = await page.context().browser()!.newBrowserCDPSession();
  const system = await systemSession.send("SystemInfo.getInfo"); await systemSession.detach();
  const measurementEnvironment = { startedAtUtc: new Date().toISOString(), node: process.version,
    browser: page.context().browser()!.version(), platform: platform(), release: release(), cpu: cpus()[0]?.model,
    logicalCpus: cpus().length, profiling: Boolean(process.env.MOBILITY_PROFILE_DIR), system,
    sourceSha256: createHash("sha256").update(await readFile("src/client/components/WorldCanvas.tsx")).digest("hex"),
    sceneRevision: sceneBefore.sceneRevision, assetRevision: bootstrap.worldManifest.assetRevision,
    viewport: page.viewportSize(), render: await host.evaluate(node => {
      const d = (node as HTMLElement).dataset;
      return { scale: d.renderScale, cameraX: d.cameraWorldX, cameraY: d.cameraWorldY,
        paddingTrees: d.cameraPaddingTrees, paddingChunks: d.cameraPaddingChunks,
        paddingNative: d.cameraPaddingNativeCells, paddingAtlases: d.cameraPaddingAtlasFamilies,
        worldObjects: d.worldObjects, light: d.lightPhase, devicePixelRatio };
    }) };
  const finishProfile = await beginMobilityProfile(page);
  let sampled: Awaited<ReturnType<typeof sampleMobility>>;
  try {
    sampled = await sampleMobility(page);
    // Preserve observations even if the optional profiler fails to export.
    if (process.env.MOBILITY_PROFILE_DIR) await writeFile(path.join(process.env.MOBILITY_PROFILE_DIR, "sampled.json"), JSON.stringify(sampled));
  } finally { await finishProfile(); }
  const samples = sampled.samples;
  // Persist every observation before assertions so a failing safety/stall gate
  // still has temporal evidence instead of only the final screenshot.
  await testInfo.attach("mobility-samples", { body: JSON.stringify(sampled, null, 2), contentType: "application/json" });
  if (directory) await writeFile(path.join(directory, "mobility-samples.json"), JSON.stringify(sampled, null, 2));
  expect(samples.length).toBeGreaterThanOrEqual(SAMPLE_DURATION_MS / SAMPLE_INTERVAL_MS / 2);
  expect(samples.at(-1)!.elapsedMs).toBeGreaterThanOrEqual(SAMPLE_DURATION_MS);
  const initial = samples[0]!;
  const final = samples.at(-1)!;
  for (const sample of samples) {
    expect(sample.ready).toBe("true");
    expect(sample.signalState).not.toBe("");
    expect(sample.cars).toBeGreaterThan(0);
    expect(sample.walkers).toBeGreaterThan(0);
    for (const metric of ["trafficUnsafePairs", "trafficPedestrianUnsafePairs", "trafficVehiclePedestrianUnsafePairs",
      "mobilityVehicleUnsafeTotal", "mobilityPedestrianUnsafeTotal", "mobilityVehiclePedestrianUnsafeTotal",
      "wrongWayCars", "walkerOffPath", "walkerRoadActivities", "mobilityPostPathConflicts"] as const) {
      expect(sample[metric], `${metric} at ${sample.elapsedMs.toFixed(0)}ms`).toBe(0);
    }
    expect(sample.trafficMaxWaitMs).toBeLessThan(WAIT_BUDGET_MS);
    expect(sample.pedestrianMaxWaitMs).toBeLessThan(WAIT_BUDGET_MS);
    expect(sample.mobilityPeakVehicleWaitMs).toBeLessThan(WAIT_BUDGET_MS);
    expect(sample.mobilityPeakWalkerWaitMs).toBeLessThan(WAIT_BUDGET_MS);
    expect(sample.mobilityNetworkBuilds).toBe(initial.mobilityNetworkBuilds);
    expect(sample.agentSession).toBe(initial.agentSession);
  }
  for (let index = 1; index < samples.length; index++) {
    for (const metric of ["trafficLifetimeSteps", "walkerLifetimeSteps", "mobilityFixedSteps"] as const) {
      expect(samples[index]![metric], `${metric} must not reset during unchanged CITY`).toBeGreaterThanOrEqual(samples[index - 1]![metric]);
    }
  }
  const movementWindows = [];
  for (let window = 0; window < SAMPLE_DURATION_MS / 10_000; window++) {
    const from = samples.find(sample => sample.elapsedMs >= window * 10_000)!;
    const to = [...samples].reverse().find(sample => sample.elapsedMs <= (window + 1) * 10_000) ?? final;
    const movement = { startMs: from.elapsedMs, endMs: to.elapsedMs,
      carSteps: to.trafficLifetimeSteps - from.trafficLifetimeSteps,
      walkerSteps: to.walkerLifetimeSteps - from.walkerLifetimeSteps };
    expect(movement.carSteps, `Cars stalled in window ${window + 1}`).toBeGreaterThan(0);
    expect(movement.walkerSteps, `Pedestrians stalled in window ${window + 1}`).toBeGreaterThan(0);
    movementWindows.push(movement);
  }
  expect(final.mobilityFixedSteps).toBeGreaterThan(initial.mobilityFixedSteps);
  expect(Math.max(...samples.map(sample => sample.mobilityStepP95Ms)), "Active CITY mobility step p95 budget").toBeLessThan(5);
  expect(final.mobilityTrips).toBeGreaterThan(initial.mobilityTrips);
  expect(final.mobilityCrossings).toBeGreaterThan(initial.mobilityCrossings);
  expect(initial.mobilityNetworkBuilds).toBeGreaterThan(0);
  expect(samples.some(sample => sample.trafficSignals > 0)).toBe(true);
  expect(new Set(samples.map(sample => sample.signalState)).size).toBeGreaterThan(1);
  phase = "capture-city";
  await capture(page, testInfo, "city", directory);

  const districtViews = [];
  for (const district of districts.slice(0, 2)) {
    phase = `district-focus-${district.name}`;
    const districtTasks = tasks.filter(task => task.districtId === district.id);
    const center = { x: districtTasks.reduce((sum, task) => sum + task.origin.x, 0) / districtTasks.length,
      y: districtTasks.reduce((sum, task) => sum + task.origin.y, 0) / districtTasks.length };
    const target = districtTasks.sort((a, b) => Math.hypot(a.origin.x - center.x, a.origin.y - center.y)
      - Math.hypot(b.origin.x - center.x, b.origin.y - center.y) || a.taskNumber - b.taskNumber)[0]!;
    expect(target).toBeDefined();
    // The normal header search performs the public building/camera-focus
    // journey. No renderer handles, synthetic events or application state writes.
    await page.getByRole("textbox", { name: "Поиск здания по номеру или названию" }).fill(String(target.taskNumber));
    await page.getByRole("option").filter({ has: page.locator("strong", { hasText: new RegExp(`^#${target.taskNumber}$`) }) }).click();
    await expect(page.locator("#task-title")).toHaveText(target.title);
    await page.getByRole("button", { name: "Закрыть", exact: true }).click();
    await expect(host).toHaveAttribute("data-focus-x", String(target.origin.x));
    await expect(host).toHaveAttribute("data-focus-y", String(target.origin.y));
    await ready(page);
    await canvas.hover();
    await page.mouse.wheel(0, -260);
    await expect.poll(async () => Number(await host.getAttribute("data-render-scale"))).toBeGreaterThan(1.5);
    await expect(host).toHaveAttribute("data-ground-bake-queue", "0");
    await expect(host).toHaveAttribute("data-world-object-depth-errors", "0");
    const name = `district-${district.name.replace(/[^\p{L}\p{N}]+/gu, "-")}`;
    phase = `capture-${name}`;
    await capture(page, testInfo, name, directory);
    districtViews.push({ districtId: district.id, districtName: district.name, taskId: target.id, origin: target.origin, screenshot: `${name}.png` });
    await expect(host).toHaveAttribute("data-mobility-network-builds", String(initial.mobilityNetworkBuilds));
  }
  expect(new Set(districtViews.map(view => view.districtId)).size).toBe(2);

  phase = "country-transition";
  await page.getByRole("button", { name: "Страна", exact: true }).click();
  await expect(page.locator(".country-overview")).toHaveAttribute("data-country-ready", "true", { timeout: 45_000 });
  await expect(host).toHaveAttribute("data-map-active", "false");
  await expect(host).toHaveAttribute("data-animation-active", "false");
  const pausedFixedSteps = await host.getAttribute("data-mobility-fixed-steps");
  phase = "capture-country";
  await capture(page, testInfo, "country", directory);
  phase = "planet-transition";
  await page.getByRole("button", { name: "Планета", exact: true }).click();
  await expect(page.locator(".planet-atlas")).toHaveAttribute("data-planet-ready", "true", { timeout: 45_000 });
  await expect(page.locator(".map-level-transition")).toHaveCount(0);
  phase = "capture-planet";
  await capture(page, testInfo, "planet", directory);
  await expect(host).toHaveAttribute("data-mobility-fixed-steps", pausedFixedSteps!);
  expect(await originalCanvas!.evaluate(node => node.isConnected)).toBe(true);
  phase = "return-to-city";
  // Zooming inward goes through actual country/city map targets; the level
  // toolbar intentionally disables direct PLANET -> CITY jumps.
  await page.locator('.planet-country-label[data-active="true"]').click();
  await expect(page.locator(".country-overview")).toHaveAttribute("data-country-ready", "true", { timeout: 45_000 });
  await page.locator(`.country-overview-city[data-city-id="${city.id}"]`).click();
  await ready(page);
  expect(await originalCanvas!.evaluate(node => node === document.querySelector("canvas[aria-label='Интерактивная карта города']"))).toBe(true);
  await expect(host).toHaveAttribute("data-mobility-network-builds", String(initial.mobilityNetworkBuilds));
  await expect.poll(async () => Number(await host.getAttribute("data-mobility-fixed-steps")), { timeout: 5_000 }).toBeGreaterThan(Number(pausedFixedSteps));
  const sceneAfter = await readScene(page, bootstrap.country.id, city.id);
  expect(sceneAfter.sceneRevision).toBe(sceneBefore.sceneRevision);
  expect(geometryDigest(sceneAfter)).toBe(geometryDigest(sceneBefore));
  const gpuObservation = await page.evaluate(() => {
    const observed = Reflect.get(window, "__mobilityGpuObservation") as {
      readbacks: Array<{ atMs: number; phase: string; size: number[]; canvas: number[]; stack: string }>;
    };
    const canvas = document.querySelector<HTMLCanvasElement>("canvas[aria-label='Интерактивная карта города']");
    const gl = canvas?.getContext("webgl2") ?? canvas?.getContext("webgl");
    const info = gl?.getExtension("WEBGL_debug_renderer_info");
    return { ...observed, rendererInfo: gl ? {
      renderer: String(gl.getParameter(info?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER)),
      vendor: String(gl.getParameter(info?.UNMASKED_VENDOR_WEBGL ?? gl.VENDOR)),
      version: String(gl.getParameter(gl.VERSION)),
    } : null };
  });
  // Observed headless-driver startup diagnostic: this exact message occurs
  // before CITY sampling, with zero native JS readPixels calls. Keep every
  // warning as evidence; do not relax the gate for any other GL/Pixi warning,
  // warning during movement/capture, or an application-origin GPU readback.
  const startupReadPixels = /^\[\.WebGL-[^\]]+\]GL Driver Message \(OpenGL, Performance, GL_CLOSE_PATH_NV, High\): GPU stall due to ReadPixels(?: \(this message will no longer repeat\))?$/;
  const environmentWarnings = consoleTimeline.filter(issue => issue.phase === "startup" && issue.type === "warning"
    && startupReadPixels.test(issue.text) && gpuObservation.readbacks.length === 0);
  const unexpectedConsoleIssues = consoleTimeline.filter(issue => !environmentWarnings.includes(issue)
    && !issue.text.includes("401 (Unauthorized)"));

  const report = { measurementEnvironment, cityId: city.id, cityName: city.name, tasks: tasks.length, districtViews, durationMs: final.elapsedMs,
    movementWindows, frameTiming: sampled.frameTiming,
    maxVehicleWaitMs: Math.max(...samples.map(sample => sample.trafficMaxWaitMs)),
    maxPedestrianWaitMs: Math.max(...samples.map(sample => sample.pedestrianMaxWaitMs)),
    peakVehicleWaitMs: final.mobilityPeakVehicleWaitMs,
    peakWalkerWaitMs: final.mobilityPeakWalkerWaitMs,
    completedTrips: final.mobilityTrips - initial.mobilityTrips,
    completedCrossings: final.mobilityCrossings - initial.mobilityCrossings,
    observedSignalStates: new Set(samples.map(sample => sample.signalState)).size,
    stepP95Ms: Math.max(...samples.map(sample => sample.mobilityStepP95Ms)),
    stepMaxMs: Math.max(...samples.map(sample => sample.mobilityStepMaxMs)),
    networkBuilds: initial.mobilityNetworkBuilds, agentSession: initial.agentSession,
    sameCanvasRetained: true, geometryDigest: geometryDigest(sceneAfter),
    pageErrors, consoleIssues, consoleTimeline, gpuObservation, environmentWarnings, unexpectedConsoleIssues,
    failedRequests, missingResponses };
  await testInfo.attach("mobility-acceptance", { body: JSON.stringify(report, null, 2), contentType: "application/json" });
  if (directory) await writeFile(path.join(directory, "metrics.json"), JSON.stringify(report, null, 2));
  expect(pageErrors).toEqual([]);
  expect(unexpectedConsoleIssues).toEqual([]);
  expect(failedRequests).toEqual([]);
  expect(missingResponses).toEqual([]);
});
