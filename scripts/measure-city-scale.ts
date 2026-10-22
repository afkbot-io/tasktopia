/** Paired, local-only performance evidence for one frozen 200/1000-task city.
 * Browser/device emulation is explicit; unsupported engine metrics remain null. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { cpus, platform } from "node:os";
import { join } from "node:path";
import { chromium, firefox, webkit, expect, type CDPSession, type Page } from "@playwright/test";
import type { Application, Container, Texture } from "pixi.js";
import type { CitySceneDto } from "../src/shared/city-scene-contract";
import { CITY_SCALE_COLD_OBSERVER_SCRIPT, CITY_SCALE_MEASUREMENT_CONTRACT, calculateColdCityMetric,
  type ColdCityCaptureApi } from "./city-scale-cold-metric";
import { CITY_SCALE_PROFILES, cityScaleBudgets, distribution, localCityScaleUrl, type CityScaleFixture, type CityScaleProfile } from "./city-scale-benchmark-contract";

const base = localCityScaleUrl(process.env.CITY_SCALE_URL ?? "http://127.0.0.1:5311", "http:").origin;
assert.ok(process.env.CITY_SCALE_FIXTURE, "Pass the frozen fixture JSON");
const fixture = JSON.parse(await readFile(process.env.CITY_SCALE_FIXTURE, "utf8")) as CityScaleFixture;
const profileName = (process.env.CITY_SCALE_PROFILE ?? "desktop-chromium") as CityScaleProfile;
assert.ok(Object.hasOwn(CITY_SCALE_PROFILES, profileName), "Unknown declared performance profile");
const profile = CITY_SCALE_PROFILES[profileName];
const variant = process.env.CITY_SCALE_VARIANT ?? "baseline";
assert.match(variant, /^[a-zA-Z0-9_-]+$/);
const samplesCount = Number(process.env.CITY_SCALE_SAMPLES ?? 3);
assert.ok(Number.isInteger(samplesCount) && samplesCount >= 1 && samplesCount <= 10);
const churnCycles = Number(process.env.CITY_SCALE_CHURN ?? 20);
assert.ok(Number.isInteger(churnCycles) && churnCycles >= 0 && churnCycles <= 30);
const steadyMs = Number(process.env.CITY_SCALE_STEADY_MS ?? 8000);
assert.ok(Number.isInteger(steadyMs) && steadyMs >= 2000 && steadyMs <= 30_000);
const buildRoot = process.env.CITY_SCALE_BUILD_ROOT ?? process.cwd();
const sourceRevision = process.env.CITY_SCALE_SOURCE_REVISION ?? "unrecorded";
const root = process.env.CITY_SCALE_OUTPUT ?? `.builder/world-perf-20261016/${variant}-${fixture.tasks}-${profileName}`;
await mkdir(root, { recursive: true });
const serverHash = createHash("sha256").update(await readFile(join(buildRoot, "dist/server.mjs"))).digest("hex");
const expectedHtmlHash = createHash("sha256").update(await readFile(join(buildRoot, "dist/public/index.html"))).digest("hex");
const clientDigest = createHash("sha256");
for (const name of (await readdir(join(buildRoot, "dist/public/assets"))).filter(name => /\.(js|css)$/.test(name)).sort()) {
  clientDigest.update(name).update(await readFile(join(buildRoot, "dist/public/assets", name)));
}
const clientHash = clientDigest.digest("hex");
const browser = await ({ chromium, firefox, webkit })[profile.engine].launch({ headless: true,
  ...(profile.engine === "chromium" && platform() === "darwin" ? { args: ["--enable-gpu", "--use-angle=metal"] } : {}) });
const errors: string[] = [], results: Record<string, unknown>[] = [];
// Runner evidence survives a failed assertion and the original context cleanup.
const failureEvidence: Record<string, unknown>[] = [];
let failure: string | null = null;

async function ready(page: Page) {
  await expect(page.locator(".world-canvas")).toHaveAttribute("data-city-scene-commit", "atomic", { timeout: 90_000 });
  await expect(page.locator(".map-level-transition")).toHaveCount(0, { timeout: 90_000 });
}
async function planet(page: Page) {
  await page.getByRole("navigation", { name: "Уровень карты" }).getByRole("button", { name: "Планета", exact: true }).click();
  await expect(page.locator(".planet-atlas")).toHaveAttribute("data-planet-ready", "true", { timeout: 30_000 });
}
async function city(page: Page) {
  const target = page.locator(`.planet-city-targets [data-city-id="${fixture.cityId}"]`);
  await target.focus(); await page.keyboard.press("Enter"); await ready(page);
}
async function heap(cdp: CDPSession | null) {
  if (!cdp) return null;
  await cdp.send("HeapProfiler.collectGarbage");
  const metrics = (await cdp.send("Performance.getMetrics")).metrics;
  return Object.fromEntries(metrics.filter(metric => ["JSHeapUsedSize", "JSHeapTotalSize", "Documents", "Nodes"].includes(metric.name)).map(metric => [metric.name, metric.value]));
}
async function resources(page: Page) {
  return page.evaluate(() => {
    const app = (window as typeof window & { __cityScalePixi?: WeakRef<Application> }).__cityScalePixi?.deref();
    if (!app?.stage) return { available: false };
    let views = 0; const textures = new Set<Texture>(), sources = new Set<Texture["source"]>(), pending: Container[] = [app.stage];
    while (pending.length) {
      const node = pending.pop()!;
      if (node.destroyed) throw new Error("Destroyed display object retained in live stage");
      views++; const texture = (node as Container & { texture?: Texture }).texture;
      if (texture) { textures.add(texture); sources.add(texture.source); }
      pending.push(...node.children);
    }
    const managed = (app.renderer.texture as unknown as { managedTextures?: Array<Texture["source"] | null> }).managedTextures;
    const resident = managed?.filter((source): source is Texture["source"] => !!source);
    return { available: true, views, textureViews: textures.size, textureSources: sources.size,
      managedSources: resident?.length ?? null, slots: managed?.length ?? null,
      rgbaEstimateBytes: resident?.reduce((total, source) => total + source.pixelWidth * source.pixelHeight * 4, 0) ?? null };
  });
}
try {
  for (let index = 0; index < samplesCount; index++) {
    const context = await browser.newContext({ baseURL: base, viewport: profile.viewport, deviceScaleFactor: profile.dpr,
      hasTouch: profile.touch, isMobile: profile.touch, serviceWorkers: "block" });
    const consoleMessages: Array<{ at: number; type: string; text: string }> = [];
    const evidence: Record<string, unknown> = { sample: index, completed: false, lastCompletedStage: "context-created",
      console: consoleMessages, consoleTruncated: false, coldTelemetryCapturedBeforeMobilityWait: false };
    failureEvidence.push(evidence);
    let diagnosticPage: Page | undefined;
    try {
      const login = await context.request.post("/api/auth/login", { data: { email: fixture.email, password: "local-city-scale-fixture-only" } });
      assert.equal(login.status(), 200, "Dedicated fixture login must succeed");
      const page = await context.newPage();
      diagnosticPage = page;
      page.on("console", message => {
        if (message.type() !== "warning" && message.type() !== "error") return;
        if (consoleMessages.length < 128) consoleMessages.push({ at: Date.now(), type: message.type(), text: message.text().slice(0, 2000) });
        else evidence.consoleTruncated = true;
      });
      const paths: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      page.on("requestfailed", request => { if (!request.failure()?.errorText.includes("ERR_ABORTED")) errors.push(`${new URL(request.url()).pathname}: ${request.failure()?.errorText}`); });
      page.on("response", response => { if (response.status() >= 400) errors.push(`${response.status()} ${new URL(response.url()).pathname}`); });
      page.on("request", request => paths.push(new URL(request.url()).pathname));
      const initializePageMetrics = () => {
        const state = { longTasks: [] as Array<{ startTime: number; duration: number }>, input: [] as number[], recording: false };
        (window as typeof window & { __cityScale: typeof state }).__cityScale = state;
        performance.setResourceTimingBufferSize(5000);
        localStorage.setItem("tasktopia:world-preferences:v2", JSON.stringify({ cityLife: true, reduceMotion: false, quality: "NORMAL", sound: false }));
        if (PerformanceObserver.supportedEntryTypes.includes("longtask")) new PerformanceObserver(list => {
          for (const entry of list.getEntries()) state.longTasks.push({ startTime: entry.startTime, duration: entry.duration });
        }).observe({ type: "longtask", buffered: true });
        for (const type of ["pointerdown", "keydown"]) document.addEventListener(type, event => {
          if (!state.recording) return;
          const dispatchedAt = event.timeStamp > 1e12 ? event.timeStamp - performance.timeOrigin : event.timeStamp;
          requestAnimationFrame(() => requestAnimationFrame(() => state.input.push(performance.now() - dispatchedAt)));
        }, { capture: true });
        globalThis.__PIXI_APP_INIT__ = app => {
          if ("stage" in app) (window as typeof window & { __cityScalePixi?: WeakRef<Application> }).__cityScalePixi = new WeakRef(app);
        };
      };
      // Verbatim observer source is self-contained; serializing a nested TSX
      // callback could otherwise capture an unavailable __name helper.
      await page.addInitScript({ content: `${CITY_SCALE_COLD_OBSERVER_SCRIPT}\n(${initializePageMetrics.toString()})();` });
      const cdp = profile.engine === "chromium" ? await context.newCDPSession(page) : null;
      if (cdp) {
        await cdp.send("Performance.enable"); await cdp.send("Network.enable");
        if (profile.cpu > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: profile.cpu });
        if (profile.network) await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 60,
          downloadThroughput: 1_600_000 / 8, uploadThroughput: 750_000 / 8 });
      }
      const started = performance.now();
      const html = await page.goto("/", { waitUntil: "domcontentloaded" });
      assert.ok(html);
      assert.equal(createHash("sha256").update(await html.body()).digest("hex"), expectedHtmlHash,
        "The measured server must serve the declared build, not another checkout's HTML");
      await expect(page.locator(".planet-atlas")).toHaveAttribute("data-planet-ready", "true", { timeout: 90_000 });
      const sceneResponse = page.waitForResponse(response => new URL(response.url()).pathname === `/api/countries/${fixture.countryId}/cities/${fixture.cityId}/scene`, { timeout: 90_000 });
      const token = randomUUID();
      const cityStarted = performance.now();
      const coldClockStart = await page.evaluate(({ token, cityId }) => {
        const capture = (window as typeof window & { __cityScaleCold: ColdCityCaptureApi }).__cityScaleCold;
        return capture.begin(token, cityId);
      }, { token, cityId: fixture.cityId });
      const nodeClockSampleDoneMs = performance.now();
      const clockStart = coldClockStart.clockStart;
      Object.assign(evidence, { lastCompletedStage: "cold-clock-started", coldClockStart });
      await city(page);
      const legacyColdCityMs = performance.now() - cityStarted, totalAppToCityMs = performance.now() - started;
      const coldClockEnd = await page.evaluate(() =>
        (window as typeof window & { __cityScaleCold: ColdCityCaptureApi }).__cityScaleCold.read());
      const clockEnd = coldClockEnd.now;
      const coldMetricInput = { nodeStartedMs: cityStarted, nodeClockSampleDoneMs,
        nodeEndedMs: cityStarted + legacyColdCityMs, start: coldClockStart, end: coldClockEnd };
      const coldMetric = calculateColdCityMetric(coldMetricInput), coldCityMs = coldMetric.upperBoundMs;
      Object.assign(evidence, { lastCompletedStage: "city-first-atomic", coldMetricInput, coldMetric });
      const scene = await (await sceneResponse).json() as CitySceneDto;
      const canonicalTasks = [...new Map([...scene.chunks.flatMap(chunk => chunk.tasks), ...scene.completedDistrictSnapshots.flatMap(snapshot => snapshot.tasks)]
        .map(task => [task.id, task])).values()].sort((a, b) => a.taskNumber - b.taskNumber);
      assert.equal(canonicalTasks.length, fixture.tasks, "Every canonical task remains available despite viewport residency");
      const geometryHash = createHash("sha256").update(JSON.stringify({ city: scene.city, roads: scene.roadContext,
        tasks: canonicalTasks.map(task => ({ id: task.id, stage: task.stage, buildingType: task.buildingType, origin: task.origin, footprint: task.footprint, accessPath: task.accessPath })),
        chunks: scene.chunks.map(chunk => ({ x: chunk.chunkX, y: chunk.chunkY, roads: chunk.roadRuns, surfaces: chunk.surfaceRuns, districts: chunk.districts })) })).digest("hex");
      assert.equal(geometryHash, fixture.geometryHash, "Benchmark may not replace the frozen world geometry");
      const host = page.locator(".world-canvas");
      const coldTelemetry = await host.evaluate(el => ({ ...(el as HTMLElement).dataset }));
      Object.assign(evidence, { lastCompletedStage: "cold-telemetry", coldTelemetry, coldTelemetryCapturedBeforeMobilityWait: true,
        canonicalTasks: canonicalTasks.length, geometryHash, sceneChunks: scene.chunks.length });
      const renderer = await host.locator("canvas").evaluate(canvas => {
        const gl = (canvas as HTMLCanvasElement).getContext("webgl2") ?? (canvas as HTMLCanvasElement).getContext("webgl");
        const extension = gl?.getExtension("WEBGL_debug_renderer_info");
        return extension ? gl!.getParameter(extension.UNMASKED_RENDERER_WEBGL) as string : "unavailable";
      });
      await expect(host).toHaveAttribute("data-ground-bake-queue", "0", { timeout: 90_000 });
      evidence.lastCompletedStage = "ground-ready";
      await expect(host).toHaveAttribute("data-mobility-ready", "true", { timeout: 90_000 });
      evidence.lastCompletedStage = "mobility-ready";
      await page.waitForTimeout(3000);
      const warmedResources = await resources(page);
      const steadyStart = await page.evaluate(() => performance.now());
      const frames = await page.evaluate(duration => new Promise<number[]>(resolve => {
        const values: number[] = []; let previous = performance.now(); const start = previous;
        const loop = { frame(now: number) { values.push(now - previous); previous = now;
          if (now - start >= duration) resolve(values); else requestAnimationFrame(loop.frame); } };
        requestAnimationFrame(loop.frame);
      }), steadyMs);
      const steadyEnd = await page.evaluate(() => performance.now());
      const inputBefore = paths.length;
      await page.evaluate(() => { (window as typeof window & { __cityScale: { recording: boolean } }).__cityScale.recording = true; });
      const legend = page.locator(".map-toolbar-actions > nav > .map-legend:not(.world-preferences) > summary");
      // Desktop exposes the legend directly; narrow screens expose it in Menu.
      const mobileMenu = page.getByLabel("Меню", { exact: true });
      if (!await legend.isVisible()) await mobileMenu.click();
      const trigger = await legend.isVisible() ? legend : page.locator(".mobile-menu-tools .map-legend:not(.world-preferences) > summary");
      for (let event = 0; event < 20; event++) { await trigger.click(); await page.waitForTimeout(40); }
      await page.keyboard.press("Escape");
      await page.evaluate(() => { (window as typeof window & { __cityScale: { recording: boolean } }).__cityScale.recording = false; });
      const beforePan = paths.length;
      const box = (await host.locator("canvas").boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 - 120, box.y + box.height / 2, { steps: 8 }); await page.mouse.up();
      await page.waitForTimeout(600);
      const panReads = paths.slice(beforePan).filter(path => /\/scene$|\/world\/viewport|\/chunks\//.test(path));
      const heapBefore = await heap(cdp), canvas = await host.locator("canvas").elementHandle();
      await planet(page); const warmStart = performance.now(); await city(page); const warmCityMs = performance.now() - warmStart;
      const warmReadStart = paths.length;
      for (let cycle = 0; cycle < churnCycles; cycle++) {
        await planet(page); await city(page);
        assert.equal(await canvas!.evaluate(node => node === document.querySelector(".world-canvas canvas")), true, "Warm city returns must retain the same canvas");
      }
      await page.waitForTimeout(1000);
      const heapAfter = await heap(cdp), finalResources = await resources(page);
      const measures = await page.evaluate(({ coldStart, coldEnd, steadyStart, steadyEnd }) => {
        const state = (window as typeof window & { __cityScale: { longTasks: Array<{ startTime: number; duration: number }>; input: number[] } }).__cityScale;
        return { longTasksAvailable: PerformanceObserver.supportedEntryTypes.includes("longtask"), inputSamples: state.input,
          coldLongTasks: state.longTasks.filter(entry => entry.startTime >= coldStart && entry.startTime <= coldEnd),
          steadyLongTasks: state.longTasks.filter(entry => entry.startTime >= steadyStart && entry.startTime <= steadyEnd),
          marks: performance.getEntriesByType("mark").filter(entry => entry.name.startsWith("tasktopia:city-")).map(entry => ({ name: entry.name, startTime: entry.startTime })),
          resourceTiming: performance.getEntriesByType("resource").map(entry => entry.toJSON()) };
      }, { coldStart: clockStart, coldEnd: clockEnd, steadyStart, steadyEnd });
      const result = { sample: index, coldCityMs, legacyColdCityMs, coldMetric, coldMetricInput, totalAppToCityMs, warmCityMs, canonicalTasks: canonicalTasks.length,
        geometryHash, sceneChunks: scene.chunks.length, renderer, coldTelemetry, finalTelemetry: await host.evaluate(el => ({ ...(el as HTMLElement).dataset })),
        coldSceneRequests: paths.slice(0, inputBefore).filter(path => path.endsWith("/scene")).length,
        legacyRequests: paths.filter(path => /\/world\/viewport|\/chunks\//.test(path)), panReads,
        warmSceneReads: paths.slice(warmReadStart).filter(path => path.endsWith("/scene")),
        frames: distribution(frames.slice(1)), input: distribution(measures.inputSamples),
        heapBefore, heapAfter, heapGrowthBytes: heapAfter && heapBefore ? heapAfter.JSHeapUsedSize! - heapBefore.JSHeapUsedSize! : null,
        warmedResources, finalResources, ...measures,
        steadyWindow: { timeOrigin: coldClockStart.timeOrigin, start: steadyStart, end: steadyEnd } };
      results.push(result);
      Object.assign(evidence, { lastCompletedStage: "all-metrics-captured", completed: true });
      if (index === 0) await page.screenshot({ path: join(root, "city.png") });
      await writeFile(join(root, `sample-${index}.json`), JSON.stringify(result, null, 2) + "\n");
      console.log(JSON.stringify({ variant, tasks: fixture.tasks, profile: profileName, sample: index, coldCityMs,
        legacyColdCityMs, coldMetric, warmCityMs,
        frames: result.frames, input: result.input, heapGrowthBytes: result.heapGrowthBytes, errors: errors.length }));
    } catch (error) {
      Object.assign(evidence, { failedAt: Date.now(), failure: error instanceof Error ? error.message : String(error) });
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const read = diagnosticPage?.evaluate(() => {
          const host = document.querySelector<HTMLElement>(".world-canvas");
          const parents = [];
          for (let element = host; element && parents.length < 8; element = element.parentElement) {
            const style = getComputedStyle(element);
            parents.push({ tag: element.tagName, className: element.className, ariaHidden: element.getAttribute("aria-hidden"),
              hidden: element.hidden, display: style.display, visibility: style.visibility });
          }
          return { capturedAt: Date.now(), hidden: document.hidden, visibility: document.visibilityState,
            dataset: host ? { ...host.dataset } : null, parents,
            selectedMapButtons: [...document.querySelectorAll('.map-level-nav button[aria-current="page"]')].map(element => element.textContent),
            alerts: [...document.querySelectorAll('[role="alert"]')].slice(0, 8).map(element => element.textContent?.slice(0, 1000)),
            resourceTiming: performance.getEntriesByType("resource").slice(0, 1000).map(entry => entry.toJSON()) };
        }).then(data => ({ coverage: "captured", data }), readError => ({ coverage: "unavailable", reason: String(readError).slice(0, 1000) }));
        evidence.liveFailure = read ? await Promise.race([read, new Promise(resolve => {
          timer = setTimeout(() => resolve({ coverage: "unavailable", reason: "failure-read-timeout" }), 3000);
        })]) : { coverage: "unavailable", reason: "page-not-created" };
      } catch (captureError) {
        evidence.liveFailure = { coverage: "unavailable", reason: String(captureError).slice(0, 1000) };
      } finally { if (timer) clearTimeout(timer); }
      throw error;
    } finally { await context.close(); }
  }
  assert.deepEqual(errors, []);
} catch (error) { failure = error instanceof Error ? error.message : String(error); throw error; }
finally {
  const budgets = cityScaleBudgets(fixture.tasks, profileName);
  const violations = results.flatMap(sample => {
    const rows: string[] = [];
    for (const metric of ["coldCityMs", "warmCityMs"] as const) if (Number(sample[metric]) > budgets[metric]) rows.push(`${sample.sample}:${metric} exceeded ${budgets[metric]}`);
    if ((sample.input as ReturnType<typeof distribution>).p95! > budgets.inputP95Ms) rows.push(`${sample.sample}:input p95 exceeded ${budgets.inputP95Ms}`);
    if ((sample.frames as ReturnType<typeof distribution>).p95! > budgets.frameP95Ms) rows.push(`${sample.sample}:RAF p95 exceeded ${budgets.frameP95Ms}`);
    if (sample.longTasksAvailable && (sample.steadyLongTasks as unknown[]).length) rows.push(`${sample.sample}:steady long tasks`);
    if (Number(sample.heapGrowthBytes ?? 0) > budgets.retainedHeapBytes) rows.push(`${sample.sample}:post-GC retained heap growth`);
    if (sample.coldSceneRequests !== 1 || (sample.panReads as unknown[]).length || (sample.warmSceneReads as unknown[]).length || (sample.legacyRequests as unknown[]).length) rows.push(`${sample.sample}:scene request budget`);
    return rows;
  });
  const report = { variant, measurementContract: CITY_SCALE_MEASUREMENT_CONTRACT,
    sourceRevision, serverHash, clientHash, expectedHtmlHash, fixture, profile: profileName, parameters: profile, browser: browser.version(),
    host: { platform: platform(), cpu: cpus()[0]?.model, node: process.version }, expectedSamples: samplesCount,
    completed: failure === null && results.length === samplesCount, failure, budgets, budgetViolations: violations,
    network: profile.network ? { latencyMs: 60, downloadBps: 1_600_000, uploadBps: 750_000, method: "CDP" } : "local unrestricted",
    limits: ["Cold v2 is the browser first-ready DOM upper bound using the measured existing clock-RPC span; legacy Node elapsed is retained",
      "Browser clock quantization (about1ms in Firefox) is disclosed without padding; MutationObserver readiness is not compositor paint",
      "Browser emulation only; no physical phone or battery measurement", "CPU/network throttling is Chromium-only",
      "Post-GC JS heap is not native/GPU memory; RGBA sums estimate tracked texture sources, not measured VRAM",
      "Input metric is native event dispatch to the second RAF, an upper-bound responsiveness proxy, not full-session INP",
      "Three loading samples produce a median/range; no loading p95 claim", "Service workers blocked consistently in both variants"],
    summaries: { coldCityMs: distribution(results.map(value => Number(value.coldCityMs))), warmCityMs: distribution(results.map(value => Number(value.warmCityMs))) },
    results, errors, failureEvidence, generatedAt: new Date().toISOString() };
  await writeFile(join(root, "report.json"), JSON.stringify(report, null, 2) + "\n");
  await browser.close();
  // Baseline can legitimately miss an announced optimization budget. Candidate
  // acceptance opts into failure; never silently relax the report's budgets.
  if (process.env.CITY_SCALE_ENFORCE_BUDGETS === "true" && violations.length) process.exitCode = 1;
}
