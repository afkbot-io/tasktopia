/** Explicit local benchmark. One fresh native WebGL context per selected
 * profile; no screenshot, video, trace, clock emulation or product writes. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { cpus, loadavg, platform } from "node:os";
import { join, resolve } from "node:path";
import { chromium, expect, type CDPSession, type Page } from "@playwright/test";
import type { CitySceneDto } from "../src/shared/city-scene-contract";
import { decodeCitySceneWire, CITY_SCENE_COMPACT_ACCEPT } from "../src/shared/city-scene-wire";
import { CITY_SCENE_DATA_BUDGET, estimateCitySceneDataWeight } from "../src/shared/city-scene-weight";
import { CITY_SCALE_COLD_OBSERVER_SCRIPT, CITY_SCALE_MEASUREMENT_CONTRACT,
  calculateColdCityMetric, type ColdCityCaptureApi } from "./city-scale-cold-metric";
import { assertCity10000Scene, city10000Budgets, city10000GeometryHash, city10000Metric,
  CITY_10000_PROFILES, type City10000Fixture, type City10000Profile, type City10000Target } from "./city-10000-contract";

type Metrics = { input: number[]; recording: boolean; longTasks: Array<{ startTime: number; duration: number }> };
const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const host = (page: Page) => page.locator(".world-canvas");
const telemetry = (page: Page) => host(page).evaluate(el => ({ ...(el as HTMLElement).dataset }));
const pose = (page: Page) => host(page).evaluate(el => ({ x: Number((el as HTMLElement).dataset.cameraWorldX),
  y: Number((el as HTMLElement).dataset.cameraWorldY), scale: Number((el as HTMLElement).dataset.renderScale) }));
async function ready(page: Page) {
  await expect(host(page)).toHaveAttribute("data-city-scene-commit", "atomic", { timeout: 90_000 });
  await expect(page.locator(".map-level-transition")).toHaveCount(0, { timeout: 90_000 });
}
async function presented(page: Page) {
  await expect(host(page)).toHaveAttribute("data-camera-presentation-pending", "false", { timeout: 15_000 });
  await expect(host(page)).toHaveAttribute("data-loading", "false", { timeout: 15_000 });
  await expect(host(page)).not.toHaveAttribute("data-load-error", "true");
  await expect(host(page)).toHaveAttribute("data-camera-padding-visible-untextured", "0");
}
async function heap(cdp: CDPSession) {
  await cdp.send("HeapProfiler.collectGarbage");
  return cdp.send("Runtime.getHeapUsage");
}
async function touchDrag(cdp: CDPSession, x: number, y: number, dx: number) {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, id: 1 }] });
  for (let n = 1; n <= 8; n++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + dx * n / 8, y, id: 1 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}
async function zoom(page: Page, cdp: CDPSession, mobile: boolean, target: number) {
  const canvas = host(page).locator("canvas"), box = (await canvas.boundingBox())!, before = await pose(page);
  if (mobile) {
    const factor = target / before.scale, radius = Math.min(40, 70 / factor), x = box.x + box.width / 2, y = box.y + box.height / 2;
    const points = (r: number) => [{ x: x - r, y, id: 1 }, { x: x + r, y, id: 2 }];
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: points(radius) });
    for (let n = 1; n <= 8; n++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: points(radius * (1 + (factor - 1) * n / 8)) });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } else if (target === .8) {
    // Wheel reaching the minimum intentionally navigates to PLANET. Native
    // keyboard zoom exercises the CITY minimum without invoking that journey.
    await canvas.focus();
    for (let n = 0; n < 20; n++) {
      await expect(host(page)).toHaveAttribute("data-map-active", "true");
      const previous = await pose(page); if (previous.scale <= target + .005) break;
      await page.keyboard.press("-"); await presented(page);
      assert.ok((await pose(page)).scale < previous.scale, "Native minus key must visibly lower CITY scale");
    }
  } else { await canvas.hover(); await page.mouse.wheel(0, Math.log(before.scale / target) / .0015); }
  await expect(host(page)).toHaveAttribute("data-map-active", "true");
  await expect.poll(async () => (await pose(page)).scale, { timeout: 15_000 }).toBeCloseTo(target, 2);
  await presented(page);
}
async function main() {
  assert.deepEqual(process.argv.slice(2), ["--run"], "Explicit --run required");
  const base = new URL(process.env.CITY_10000_URL ?? "http://127.0.0.1:5355");
  assert.equal(base.protocol, "http:"); assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(base.hostname));
  assert.equal(base.username + base.password + base.search + base.hash, ""); assert.equal(base.pathname, "/");
  const fixturePath = process.env.CITY_10000_FIXTURE ?? ".builder/city-10000-20261028/fixture-v2/fixture.json";
  assert.equal((await stat(fixturePath)).mode & 0o777, 0o600);
  const fixtureBytes = await readFile(fixturePath); assert.equal(digest(fixtureBytes), process.env.CITY_10000_FIXTURE_SHA256);
  const fixture = JSON.parse(fixtureBytes.toString()) as City10000Fixture;
  assert.equal(fixture.status, "REAL_GEOMETRY_READY"); assert.equal(fixture.tasks, 10000); assert.ok(fixture.chunks > 256);
  assert.equal(fixture.auditViolations, 0); assert.equal(fixture.targets.length, 20);
  const names = (process.env.CITY_10000_PROFILES ?? "desktop,tall,mobile").split(",") as City10000Profile[];
  assert.ok(names.length && new Set(names).size === names.length && names.every(name => Object.hasOwn(CITY_10000_PROFILES, name)));
  assert.ok(process.env.CITY_10000_BUILD_ROOT && process.env.CITY_10000_SOURCE_REVISION);
  assert.match(process.env.CITY_10000_SOURCE_REVISION, /^[a-f0-9]{40}$/);
  const build = resolve(process.env.CITY_10000_BUILD_ROOT), runId = process.env.CITY_10000_RUN_ID ?? "browser-first";
  assert.match(runId, /^[a-z0-9-]+$/);
  const output = `.builder/city-10000-20261028/${runId}`; process.umask(0o077); await mkdir(output, { mode: 0o700 });
  const sourcePaths = ["scripts/measure-city-10000.ts", "scripts/city-10000-contract.ts", "scripts/city-scale-cold-metric.ts", "src/shared/city-scene-weight.ts", "src/shared/city-scene-wire.ts"];
  const sourceHashes = Object.fromEntries(await Promise.all(sourcePaths.map(async path => [path, digest(await readFile(path))])));
  const serverHash = digest(await readFile(join(build, "dist/server.mjs"))), htmlHash = digest(await readFile(join(build, "dist/public/index.html")));
  const client = createHash("sha256");
  for (const file of (await readdir(join(build, "dist/public/assets"))).filter(file => /\.(js|css)$/.test(file)).sort()) client.update(file).update(await readFile(join(build, "dist/public/assets", file)));
  const clientHash = client.digest("hex"), browser = await chromium.launch({ headless: true,
    ...(platform() === "darwin" ? { args: ["--enable-gpu", "--use-angle=metal"] } : {}) });
  const results: Record<string, unknown>[] = [], violations: string[] = [], failures: Record<string, unknown>[] = [];
  let failure: string | null = null;
  const deadline = setTimeout(() => { failure = "Owned benchmark12-minute deadline exceeded"; void browser.close(); }, 12 * 60_000);
  const hostBefore = { platform: platform(), cpu: cpus()[0]?.model, loadavg: loadavg(), node: process.version };
  try {
    for (const name of names) {
      const profile = CITY_10000_PROFILES[name], budgets = city10000Budgets(name), context = await browser.newContext({
        baseURL: base.origin, viewport: profile.viewport, deviceScaleFactor: profile.dpr, hasTouch: profile.touch, isMobile: profile.touch, serviceWorkers: "block" });
      const paths: string[] = [], origins = new Set<string>(), errors: string[] = [], warnings: string[] = [], requestFailures: Record<string, unknown>[] = [];
      const evidence: Record<string, unknown> = { profile: name };
      let phase = "login", truncated = false, diagnosticPage: Page | undefined;
      const recordError = (value: string) => { if (errors.length < 128) errors.push(value.slice(0, 1500)); else truncated = true; };
      try {
        assert.equal((await context.request.post("/api/auth/login", { data: { email: fixture.email, password: "local-city-10000-fixture-only" } })).status(), 200);
        const page = await context.newPage(); diagnosticPage = page;
        page.on("pageerror", error => recordError(`pageerror:${phase}:${error.message}`));
        page.on("console", message => { if (message.type() === "error") recordError(`console:${phase}:${message.text()}`);
          else if (message.type() === "warning") { if (warnings.length < 128) warnings.push(message.text().slice(0, 1500)); else truncated = true; } });
        page.on("response", response => { if (response.status() >= 400) recordError(`HTTP${response.status()}:${new URL(response.url()).pathname}`); });
        page.on("requestfailed", request => { const row = { phase, path: new URL(request.url()).pathname, error: request.failure()?.errorText ?? "unknown" };
          if (requestFailures.length < 128) requestFailures.push(row); else truncated = true; recordError(`requestfailed:${row.phase}:${row.path}:${row.error}`); });
        page.on("request", request => { const url = new URL(request.url()); origins.add(url.origin);
          if (url.origin !== base.origin && url.origin !== "null" && !(url.protocol === "ws:" && url.host === base.host)) recordError(`unexpected-external-origin:${url.origin}`);
          if (paths.length < 20_000) paths.push(url.pathname); else truncated = true; });
        const initialize = () => {
          const state: Metrics = { input: [], recording: false, longTasks: [] };
          (window as typeof window & { __city10000: Metrics }).__city10000 = state;
          performance.setResourceTimingBufferSize(10_000);
          localStorage.setItem("tasktopia:world-preferences:v2", JSON.stringify({ cityLife: true, reduceMotion: false, quality: "NORMAL", sound: false }));
          if (PerformanceObserver.supportedEntryTypes.includes("longtask")) new PerformanceObserver(list => {
            for (const entry of list.getEntries()) state.longTasks.push({ startTime: entry.startTime, duration: entry.duration });
          }).observe({ type: "longtask", buffered: true });
          for (const type of ["pointerdown", "keydown"]) document.addEventListener(type, event => {
            if (!state.recording || !event.isTrusted) return;
            const at = event.timeStamp > 1e12 ? event.timeStamp - performance.timeOrigin : event.timeStamp;
            requestAnimationFrame(() => requestAnimationFrame(() => state.input.push(performance.now() - at)));
          }, { capture: true });
        };
        await page.addInitScript({ content: `${CITY_SCALE_COLD_OBSERVER_SCRIPT}\n(${initialize.toString()})();` });
        const cdp = await context.newCDPSession(page); await cdp.send("Network.enable");
        const scenePath = `/api/countries/${fixture.countryId}/cities/${fixture.cityId}/scene`;
        if (profile.cpu > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: profile.cpu });
        if (profile.network) await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 60,
          downloadThroughput: 1_600_000 / 8, uploadThroughput: 750_000 / 8 });
        phase = "app-open"; const html = await page.goto("/", { waitUntil: "domcontentloaded" }); assert.ok(html); assert.equal(digest(await html.body()), htmlHash);
        await expect(page.locator(".planet-atlas")).toHaveAttribute("data-planet-ready", "true", { timeout: 90_000 });
        const openCity = async () => { const target = page.locator(`.planet-city-targets [data-city-id="${fixture.cityId}"]`);
          await target.focus(); await page.keyboard.press("Enter"); await ready(page); };
        const planet = async () => { await page.getByRole("navigation", { name: "Уровень карты" }).getByRole("button", { name: "Планета", exact: true }).click();
          await expect(page.locator(".planet-atlas")).toHaveAttribute("data-planet-ready", "true"); };
        phase = "cold-city";
        const response = page.waitForResponse(r => r.url() === base.origin + scenePath, { timeout: 90_000 });
        const started = performance.now(), start = await page.evaluate(({ token, cityId }) =>
          (window as typeof window & { __cityScaleCold: ColdCityCaptureApi }).__cityScaleCold.begin(token, cityId), { token: randomUUID(), cityId: fixture.cityId });
        const nodeClockSampleDoneMs = performance.now(); await openCity(); const nodeEndedMs = performance.now();
        const end = await page.evaluate(() => (window as typeof window & { __cityScaleCold: ColdCityCaptureApi }).__cityScaleCold.read());
        const coldInput = { nodeStartedMs: started, nodeClockSampleDoneMs, nodeEndedMs, start, end }, cold = calculateColdCityMetric(coldInput);
        const coldTelemetry = await telemetry(page), sceneResponse = await response; assert.equal(sceneResponse.status(), 200);
        Object.assign(evidence, { cold, coldInput, coldTelemetry });
        if (cold.upperBoundMs > budgets.coldCityMs) violations.push(`${name}:cold ${cold.upperBoundMs}>${budgets.coldCityMs}`);
        const actualAccept = await sceneResponse.request().headerValue("accept"), headers = sceneResponse.headers();
        assert.equal(actualAccept, CITY_SCENE_COMPACT_ACCEPT, "Actual browser must negotiate the compact wire contract");
        assert.equal(headers["content-type"]?.split(";", 1)[0], "application/vnd.tasktopia.city-scene+json");
        assert.ok(headers.etag); assert.match(coldTelemetry.citySceneRevision ?? "", /^[a-f0-9]{64}$/);
        const decodedBytes = Number(coldTelemetry.citySceneDecodedBytes), initialFocus = { x: Number(coldTelemetry.focusX), y: Number(coldTelemetry.focusY) };
        const sceneTimings = await page.evaluate(url => performance.getEntriesByName(url, "resource").map(entry => {
          const r = entry as PerformanceResourceTiming;
          return { startTime: r.startTime, requestStart: r.requestStart, responseStart: r.responseStart, responseEnd: r.responseEnd,
            encodedBodySize: r.encodedBodySize, decodedBodySize: r.decodedBodySize, transferSize: r.transferSize, nextHopProtocol: r.nextHopProtocol };
        }), base.origin + scenePath);
        assert.equal(sceneTimings.length, 1); const sceneTiming = sceneTimings[0]!;
        assert.ok(Object.entries(sceneTiming).every(([key, value]) => key === "nextHopProtocol" || typeof value === "number" && Number.isFinite(value) && value >= 0));
        assert.ok(sceneTiming.requestStart >= sceneTiming.startTime && sceneTiming.responseStart >= sceneTiming.requestStart && sceneTiming.responseEnd >= sceneTiming.responseStart);
        assert.ok(sceneTiming.encodedBodySize > 0 && sceneTiming.transferSize >= sceneTiming.encodedBodySize);
        assert.equal(sceneTiming.decodedBodySize, decodedBytes);
        assert.equal(decodedBytes, fixture.rawSceneBytes); assert.equal(Number(coldTelemetry.citySceneChunks), fixture.chunks);
        assert.equal(Number(coldTelemetry.canonicalTaskCount), 10000); assert.ok(Number.isFinite(initialFocus.x) && Number.isFinite(initialFocus.y));
        Object.assign(evidence, { rawSceneBytes: decodedBytes, sceneChunks: fixture.chunks, sceneResponse: { status: sceneResponse.status(), actualAccept,
          sceneRevision: coldTelemetry.citySceneRevision, metadataOnly: true, resourceTiming: sceneTiming,
          headers: Object.fromEntries(["content-type", "content-length", "content-encoding", "etag", "vary"].map(key => [key, headers[key] ?? null])) } });
        if (decodedBytes > budgets.rawSceneBytes) violations.push(`${name}:raw scene exceeds declared48MiB`);
        const renderer = await host(page).locator("canvas").evaluate(canvas => { const gl = (canvas as HTMLCanvasElement).getContext("webgl2") ?? (canvas as HTMLCanvasElement).getContext("webgl");
          if (!gl) throw new Error("Native WebGL context missing"); const ext = gl.getExtension("WEBGL_debug_renderer_info");
          return { version: gl.getParameter(gl.VERSION) as string, renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) as string : "unavailable" }; });
        const rendererClass = /swiftshader|llvmpipe|software/i.test(renderer.renderer) ? "software-reported" : renderer.renderer === "unavailable" ? "unknown" : "hardware-reported";
        phase = "canonical-physical-ready"; const canonicalWaitStarted = performance.now();
        await expect(host(page)).toHaveAttribute("data-canonical-decoded-chunks", String(fixture.chunks), { timeout: 90_000 });
        await expect(host(page)).toHaveAttribute("data-canonical-snapshot-pending", "false", { timeout: 90_000 });
        const canonicalReadyObserved = performance.now(), canonicalTelemetry = await telemetry(page);
        const canonicalPrepareMs = Number(canonicalTelemetry.canonicalPrepareMs); assert.ok(Number.isFinite(canonicalPrepareMs) && canonicalPrepareMs >= 0);
        const canonicalPhysical = { observationWaitMs: canonicalReadyObserved - canonicalWaitStarted,
          sinceCityEntryUpperBoundMs: canonicalReadyObserved - started, afterAtomicUpperBoundMs: canonicalReadyObserved - nodeEndedMs,
          clientPrepareMs: canonicalPrepareMs, telemetry: canonicalTelemetry };
        Object.assign(evidence, { canonicalPhysical });
        phase = "mobility-ready"; await presented(page); await expect(host(page)).toHaveAttribute("data-mobility-ready", "true", { timeout: 90_000 });
        const mobility = { sinceCityEntryUpperBoundMs: performance.now() - started,
          afterCanonicalObservationMs: performance.now() - canonicalReadyObserved, telemetry: await telemetry(page) };
        Object.assign(evidence, { mobility });
        await expect(host(page)).toHaveAttribute("data-living-world-frame-samples", "120", { timeout: 30_000 });
        const canvas = await host(page).locator("canvas").elementHandle(); assert.ok(canvas);
        const afterColdReads = paths.length, windows: Record<string, unknown>[] = [];
        evidence.windows = windows;
        for (let windowIndex = 0; windowIndex < 3; windowIndex++) {
          phase = `window-${windowIndex}`; await planet(); const warmStarted = performance.now(); await openCity(); const warmMs = performance.now() - warmStarted;
          assert.equal(await canvas.evaluate(el => el === document.querySelector(".world-canvas canvas")), true);
          const frameWindow = await page.evaluate(() => new Promise<{ values: number[]; start: number; end: number }>(resolveFrames => {
            const values: number[] = [], start = performance.now(); let previous = start;
            const loop = { frame(now: number) { values.push(now - previous); previous = now;
              if (now - start >= 8000) resolveFrames({ values, start, end: now }); else requestAnimationFrame(loop.frame); } };
            requestAnimationFrame(loop.frame); }));
          const cpuTelemetry = await telemetry(page), cpu = Number(cpuTelemetry.livingWorldFrameCpuP95Ms);
          assert.equal(cpuTelemetry.livingWorldFrameSamples, "120");
          assert.ok(Number.isFinite(cpu) && cpu >= 0); const frameMetric = city10000Metric(frameWindow.values.slice(1), 20);
          const steadyLongTasks = await page.evaluate(({ start, end }) => (window as typeof window & { __city10000: Metrics }).__city10000.longTasks
            .filter(task => task.startTime < end && task.startTime + task.duration > start), frameWindow);
          await page.evaluate(() => { const s = (window as typeof window & { __city10000: Metrics }).__city10000; s.input = []; s.recording = true; });
          let trigger = page.locator(".map-toolbar-actions > nav > .map-legend:not(.world-preferences) > summary");
          if (!await trigger.isVisible()) { await page.getByLabel("Меню", { exact: true }).click(); trigger = page.locator(".mobile-menu-tools .map-legend:not(.world-preferences) > summary"); }
          for (let n = 0; n < 20; n++) { if (profile.touch) await trigger.tap(); else await trigger.click(); await page.waitForTimeout(40); }
          await page.keyboard.press("Escape"); await page.waitForTimeout(100);
          const input = await page.evaluate(() => { const s = (window as typeof window & { __city10000: Metrics }).__city10000; s.recording = false; return s.input; });
          const inputMetric = city10000Metric(input, 20);
          if (warmMs > budgets.warmCityMs) violations.push(`${name}/${windowIndex}:warm`);
          if (frameMetric.p95! > budgets.frameP95Ms) violations.push(`${name}/${windowIndex}:RAF`);
          if (inputMetric.p95! > budgets.inputP95Ms) violations.push(`${name}/${windowIndex}:input`);
          if (cpu > budgets.livingCpuP95Ms) violations.push(`${name}/${windowIndex}:livingCPU`);
          if (steadyLongTasks.length) violations.push(`${name}/${windowIndex}:steady long tasks`);
          windows.push({ window: windowIndex, warmMs, frames: frameMetric, input: inputMetric, livingCpuP95Ms: cpu,
            steadyStart: frameWindow.start, steadyEnd: frameWindow.end, steadyLongTasks });
        }
        phase = "far-search-and-cards";
        const search = page.getByRole("combobox", { name: "Поиск здания по номеру или названию" });
        const last = fixture.targets.at(-1)!;
        const targets = [...new Map([fixture.farTarget, last, ...fixture.targets].map(target => [target.id, target])).values()].slice(0, 20);
        const cards: Array<{ taskNumber: number; searchMs: number; cardMs: number; mapFocusReadyMs: number }> = [];
        evidence.cards = cards;
        const card = async (target: City10000Target) => {
          const searchStarted = performance.now(); await search.fill(String(target.taskNumber));
          const option = page.getByRole("listbox", { name: "Найденные задачи" }).getByRole("option").filter({ has: page.locator("strong", { hasText: new RegExp(`^#${target.taskNumber}$`) }) });
          await expect(option).toHaveCount(1); await expect(option).toBeVisible(); const searchMs = performance.now() - searchStarted;
          const cardStarted = performance.now(); if (profile.touch) await option.tap(); else await option.click();
          await expect(page.getByRole("dialog").getByRole("heading", { name: target.title, exact: true })).toBeVisible();
          const cardMs = performance.now() - cardStarted; if (cardMs > budgets.cardMs) violations.push(`${name}:card#${target.taskNumber}`);
          // The card may paint before its background camera work. Verify that
          // actual far-task focus completes before closing can cancel it.
          await expect(host(page)).toHaveAttribute("data-focus-x", String(target.origin.x));
          await expect(host(page)).toHaveAttribute("data-focus-y", String(target.origin.y));
          await presented(page); const mapFocusReadyMs = performance.now() - cardStarted;
          await page.getByRole("button", { name: "Закрыть", exact: true }).click(); await presented(page);
          cards.push({ taskNumber: target.taskNumber, searchMs, cardMs, mapFocusReadyMs });
        };
        for (const target of targets) await card(target); assert.equal(cards.length, 20);
        phase = "filters"; const beforeFilter = await pose(page), rebakes = (await telemetry(page)).groundRebuilds;
        await page.getByLabel("Фильтры", { exact: true }).click(); const filters = page.getByRole("navigation", { name: "Фильтры построек" });
        await filters.getByRole("button", { name: "Мои объекты", exact: true }).click();
        await expect(filters.getByRole("status")).toHaveText("Найдено: 3334");
        await filters.getByRole("button", { name: "Приёмка", exact: true }).click(); await expect(filters.getByRole("status")).toHaveText("Найдено: 0");
        await filters.getByRole("button", { name: "Приёмка", exact: true }).click(); await filters.getByRole("button", { name: "Мои объекты", exact: true }).click();
        assert.deepEqual(await pose(page), beforeFilter); assert.equal((await telemetry(page)).groundRebuilds, rebakes);
        await page.keyboard.press("Escape");
        phase = "zoom-and-pan"; await zoom(page, cdp, profile.touch, .8); const beforePan = await pose(page), box = (await host(page).locator("canvas").boundingBox())!;
        // Pan towards the observed initial city focus; this is not an inferred authoritative city center.
        const direction = beforePan.x > initialFocus.x ? 1 : -1, panTimingsMs: number[] = [];
        for (let n = 0; n < 3; n++) {
          const panStarted = performance.now();
          const x = box.x + box.width * (direction > 0 ? .2 : .8), y = box.y + box.height / 2, dx = box.width * .6 * direction;
          if (profile.touch) await touchDrag(cdp, x, y, dx);
          else { await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + dx, y, { steps: 8 }); await page.mouse.up(); }
          await presented(page); panTimingsMs.push(performance.now() - panStarted);
        }
        const afterPan = await pose(page); assert.ok(Math.abs(afterPan.x - beforePan.x) > 64, "Real long pan must cross a chunk boundary");
        await zoom(page, cdp, profile.touch, 4); await zoom(page, cdp, profile.touch, .8);
        const retainedPose = await pose(page), heapBefore = await heap(cdp);
        phase = "retained-churn";
        for (let n = 0; n < 10; n++) { await planet(); await openCity(); assert.equal(await canvas.evaluate(el => el === document.querySelector(".world-canvas canvas")), true); }
        assert.deepEqual(await pose(page), retainedPose); const heapAfter = await heap(cdp), growth = heapAfter.usedSize - heapBefore.usedSize;
        if (growth > budgets.retainedHeapBytes) violations.push(`${name}:retained heap growth`);
        const resources = await page.evaluate(() => performance.getEntriesByType("resource").map(entry => entry.toJSON()));
        const finalTelemetry = await telemetry(page), noExtraSceneReads = paths.slice(afterColdReads).filter(path => /\/scene$|\/world\/viewport|\/chunks\//.test(path));
        assert.equal(finalTelemetry.canonicalTaskCount, "10000");
        const residentChunks = Number(finalTelemetry.residentChunks), residentBudget = Number(finalTelemetry.cityResidentChunkBudget);
        assert.ok(Number.isFinite(residentChunks) && residentChunks > 0 && Number.isFinite(residentBudget) && residentBudget > 0 && residentChunks <= residentBudget);
        assert.ok(Number(finalTelemetry.taskBuildingViews) > 0 && Number(finalTelemetry.taskBuildingViews) < 10000, "Only resident building views should be materialized");
        const scenes = paths.filter(path => path.endsWith("/scene")), legacy = paths.filter(path => /\/world\/viewport|\/chunks\//.test(path));
        if (scenes.length !== 1 || noExtraSceneReads.length || legacy.length) violations.push(`${name}:one-full-scene network budget`);
        phase = "auxiliary-scene-validation-after-timed-phases";
        const auxiliary = await context.request.get(scenePath, { headers: { accept: CITY_SCENE_COMPACT_ACCEPT }, timeout: 90_000, maxRedirects: 0, maxRetries: 0 });
        assert.equal(auxiliary.status(), 200); const auxiliaryHeaders = auxiliary.headers();
        assert.equal(auxiliaryHeaders["content-type"]?.split(";", 1)[0], "application/vnd.tasktopia.city-scene+json");
        assert.equal(auxiliaryHeaders.etag, headers.etag, "Auxiliary validation must describe the exact browser scene revision");
        const body = await auxiliary.body(); assert.equal(body.length, decodedBytes);
        const scene = decodeCitySceneWire(JSON.parse(body.toString())) as CitySceneDto;
        assert.equal(scene.sceneRevision, coldTelemetry.citySceneRevision); assertCity10000Scene(scene, fixture.cityId, fixture.chunkLimit);
        assert.deepEqual(scene.city.center, initialFocus, "Auxiliary scene must verify that the observed initial focus was the authoritative city center");
        assert.equal(city10000GeometryHash(scene), fixture.geometryHash); const cacheWeight = estimateCitySceneDataWeight(scene);
        const auxiliarySceneValidation = { requests: 1, owner: "APIRequestContext", phase: "after-all-timed-phases-before-logout",
          status: auxiliary.status(), etag: auxiliaryHeaders.etag, sceneRevision: scene.sceneRevision, rawSceneBytes: body.length,
          geometryHash: city10000GeometryHash(scene), nativeGeometryMatched: true, initialFocusMatchesCityCenter: true };
        Object.assign(evidence, { auxiliarySceneValidation }); await auxiliary.dispose();
        phase = "logout-teardown"; const released = await host(page).elementHandle(); assert.ok(released); await canvas.dispose();
        if (profile.touch) { await page.getByLabel("Меню", { exact: true }).click(); await page.getByRole("button", { name: "Аккаунт и настройки", exact: true }).click(); }
        else await page.getByRole("button", { name: /^Настройки аккаунта/ }).click();
        await page.getByRole("button", { name: "Выйти из аккаунта", exact: true }).click();
        await expect(page.getByLabel("Email", { exact: true })).toBeVisible(); await expect(host(page)).toHaveCount(0);
        await expect.poll(() => released.evaluate(el => (el as HTMLElement).dataset.assetLease)).toBe("released");
        assert.equal(await released.evaluate(el => (el as HTMLElement).dataset.leasedAssets), "0"); await released.dispose();
        const heapAfterLogout = await heap(cdp); await cdp.detach(); assert.deepEqual(errors, []); assert.equal(truncated, false);
        results.push({ profile: name, parameters: profile, budgets, cold, coldInput, coldTelemetry, rawSceneBytes: body.length,
          gzipSceneBytes: fixture.gzipSceneBytes, legacyRawSceneBytes: fixture.legacyRawSceneBytes,
          legacyGzipSceneBytes: fixture.legacyGzipSceneBytes, compactAccept: CITY_SCENE_COMPACT_ACCEPT, sceneResponse: evidence.sceneResponse,
          wireTransfer: { contentEncoding: headers["content-encoding"] ?? "identity", encodedBodyBytes: sceneTiming.encodedBodySize,
            decodedBodyBytes: sceneTiming.decodedBodySize, transferBytes: sceneTiming.transferSize, resourceTiming: sceneTiming,
            fixtureGzipComparisonBytes: fixture.gzipSceneBytes, gzipScope: "Offline fixture comparison; not the browser's actual encoded bytes" },
          sceneChunks: scene.chunks.length, canonicalTasks: 10000, canonicalPhysical, mobility, renderer, rendererClass,
          cachePolicy: { estimatedWeightBytes: cacheWeight, retainedHeuristicBudgetBytes: CITY_SCENE_DATA_BUDGET,
            predictedBypass: cacheWeight > CITY_SCENE_DATA_BUDGET, directAdmissionTelemetry: false },
          windows, cards, beforePan, afterPan, panTimingsMs, retainedPose, heapBefore, heapAfter, heapGrowthBytes: growth, heapAfterLogout,
          residentHeapTarget: { usedBytes: heapAfter.usedSize, targetBytes: budgets.residentHeapTargetBytes,
            withinTarget: heapAfter.usedSize <= budgets.residentHeapTargetBytes, status: "MEASURED_TARGET_REQUIRES_ROOT_REVIEW" },
          browserSceneRequests: scenes.length, auxiliarySceneValidation, panReference: { source: "observed-initial-focus", ...initialFocus },
          noExtraSceneReads, legacy, origins: [...origins], finalTelemetry, resources, errors, warnings, requestFailures, truncated,
          teardown: { hostRemoved: true, assetLeaseReleased: true, activeLeases: 0 } });
      } catch (error) {
        let current: unknown = null, timer: ReturnType<typeof setTimeout> | undefined;
        try { current = diagnosticPage ? await Promise.race([telemetry(diagnosticPage), new Promise(resolveCapture => {
          timer = setTimeout(() => resolveCapture({ coverage: "unavailable", reason: "3s failure read deadline" }), 3000);
        })]) : null; } catch { current = { coverage: "unavailable", reason: "Page closed or detached" }; }
        finally { clearTimeout(timer); }
        failures.push({ profile: name, phase, evidence, error: error instanceof Error ? error.message : String(error), current, errors, warnings, requestFailures, truncated, paths });
        throw error;
      } finally { await context.close(); }
    }
    for (const [path, hash] of Object.entries(sourceHashes)) assert.equal(digest(await readFile(path)), hash, "Benchmark source changed while running");
  } catch (error) { failure = error instanceof Error ? error.message : String(error); }
  finally {
    try {
    const report = { status: !failure && !violations.length && results.length === names.length ? "MEASURED_STRICT_BUDGETS_PASS_HEAP_TARGET_PENDING_REVIEW" : "FAIL_OR_INCOMPLETE",
      sourceRevision: process.env.CITY_10000_SOURCE_REVISION, sourceHashes, serverHash, htmlHash, clientHash,
      fixturePath, fixtureSha256: digest(fixtureBytes), fixtureSourceRevision: fixture.sourceRevision, geometryHash: fixture.geometryHash,
      measurementContract: CITY_SCALE_MEASUREMENT_CONTRACT, browser: browser.version(), hostBefore, hostAfter: { loadavg: loadavg() },
      profilesRequested: names, results, failures, failure, violations,
      mobileNetwork: { latencyMs: 60, downloadBitsPerSecond: 1_600_000, uploadBitsPerSecond: 750_000,
        cdpDownloadBytesPerSecond: 200_000, cdpUploadBytesPerSecond: 93_750 },
      limitations: ["Один fresh cold sample на профиль; 3 отдельных warm/input/8sRAF окна. Loading p95 не заявляется.",
        "Эмуляция Chromium, не физический телефон. WebGL renderer и класс указаны фактически; hardware и software не смешиваются.",
        "Cold v2 — DOM upper bound первого atomic frame после app.render, не compositor paint и не ожидание всего halo.",
        "Canonical physical и mobility readiness измеряются отдельно от cold. Node observation upper bounds включают контрольные RPC/polling; clientPrepareMs — собственная telemetry клиента.",
        "Body не читается из browser inspector. Один отдельный APIRequestContext GET после всех timed phases проверяет тот же ETag/revision/native geometry. Browser scene requests и auxiliary request указаны раздельно; один общий HTTP GET не заявляется.",
        "Input — native trusted event→secondRAF proxy, не full-session INP; card time — отдельная end-to-end верхняя граница.",
        "48MiB raw JSON — новый workload budget; отдельный48MiB RevisionCache использует retained-heap эвристику, это не transport cap.",
        "Прямого cache-bypass telemetry нет: наблюдаются реальные scene requests и сохранение canvas; reason bypass не угадывается.",
        "Post-GC JS heap не измеряет GPU/native memory. Resident256MiB — target для отдельного root review после измерения.",
        "Immediate lease release не доказывает истечение30s decoded-asset grace. Нет screenshot/trace/video/readPixels внутри timing."], generatedAt: new Date().toISOString() };
    await writeFile(join(output, "report.json"), JSON.stringify(report, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    console.log(JSON.stringify({ status: report.status, output, profilesCompleted: results.length, violations, failure }));
    if (failure || violations.length) process.exitCode = 1;
    } finally {
      try { await browser.close(); } finally { clearTimeout(deadline); }
    }
  }
}
await main().catch(error => { console.error(JSON.stringify({ status: "BENCHMARK_SETUP_FAILED", errorName: error instanceof Error ? error.name : "UnknownError" })); process.exitCode = 1; });
