/** Local fixture only. Real pointer input; no mocked renderer or map responses. */
import { chromium } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const base = process.env.PERF_BASE_URL ?? "http://127.0.0.1:5196";
if (!["127.0.0.1", "localhost", "::1"].includes(new URL(base).hostname)) throw new Error("Local benchmark only");
const variant = process.env.PERF_VARIANT ?? "candidate", size = process.env.LIVING_WORLD_SIZE ?? "M";
const mobile = process.env.PERF_MOBILE === "true", dpr = mobile ? 2 : Number(process.env.PERF_DPR ?? 1);
const fixture = JSON.parse(await readFile(`tmp/living-world/performance/fixture-${size}.json`, "utf8"));
const gpu = process.env.PERF_GPU ?? "default";
if (!["default", "metal"].includes(gpu)) throw new Error("Unknown GPU profile");
const browser = await chromium.launch(gpu === "metal" ? { args: ["--use-angle=metal", "--enable-gpu"] } : {});
let renderer = "not-observed";
const reports: unknown[] = [], errors: string[] = [];
try {
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }, deviceScaleFactor: dpr, serviceWorkers: "block" });
  const login = await context.request.post(`${base}/api/auth/login`, { data: { email: fixture.email, password: "living-world-local-performance" } });
  if (!login.ok()) throw new Error(`Login: ${login.status()}`);
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 80, downloadThroughput: 50_000_000 / 8, uploadThroughput: 50_000_000 / 8 });
  if (mobile) await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await cdp.send("Performance.enable");
  await page.goto(base);
  let requests = 0;
  page.on("request", request => { if (/\/(scene|overview|planet-atlas)(?:\?|$)/.test(request.url())) requests++; });
  for (const [mode, label, selector, attribute, value] of [
    ["CITY", "Город", ".world-canvas", "data-city-scene-commit", "atomic"],
    ["COUNTRY", "Страна", ".country-overview", "data-country-ready", "true"],
    ["PLANET", "Планета", ".planet-atlas", "data-planet-ready", "true"],
  ]) {
    if (process.env.PERF_MODE && process.env.PERF_MODE !== mode) continue;
    await page.getByRole("button", { name: label!, exact: true }).click();
    await page.locator(selector!).waitFor({ state: "visible" });
    await page.waitForFunction(({ selector, attribute, value }) => document.querySelector(selector!)?.getAttribute(attribute!) === value,
      { selector, attribute, value }, { timeout: 60_000 });
    if (mode === "CITY") {
      renderer = await page.locator(`${selector} canvas`).evaluate(canvas => {
        const surface = canvas as HTMLCanvasElement;
        const gl = surface.getContext("webgl2") ?? surface.getContext("webgl");
        if (!gl) return "unavailable";
        const info = gl.getExtension("WEBGL_debug_renderer_info");
        return info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "unreported";
      });
      if (gpu === "metal" && !renderer.includes("Metal Renderer")) throw new Error(`Hardware profile unavailable: ${renderer}`);
    }
    // Let entrance animation and its queued work finish before pointer trials.
    await page.waitForTimeout(1000);
    if (label === "Страна" || (mobile && label === "Город")) {
      const bounds = (await page.locator(selector!).boundingBox())!;
      await page.mouse.move(bounds.x + bounds.width*.2, bounds.y + bounds.height*.3);
      // Keep the measured gesture inside one mode. COUNTRY and the fitted
      // mobile CITY can start at their intentional parent-navigation threshold.
      await page.mouse.wheel(0, -240);
      await page.waitForTimeout(500);
    }
    const beforeRequests = requests, metricsBefore = await cdp.send("Performance.getMetrics");
    if (process.env.PERF_PROFILE_CPU === "true") {
      await cdp.send("Profiler.enable");
      await cdp.send("Profiler.setSamplingInterval", { interval: 1000 });
      await cdp.send("Profiler.start");
    }
    await page.evaluate(`(() => {
      window.__motionFrames=[];window.__motionRunning=true;let previous=null;
      function frame(now){if(previous!==null)window.__motionFrames.push(now-previous);previous=now;if(window.__motionRunning)requestAnimationFrame(frame);}
      requestAnimationFrame(frame);
    })()`);
    const box = (await page.locator(selector!).boundingBox())!;
    const x = box.x + box.width * .5, y = box.y + box.height * .45;
    for (let cycle = 0; cycle < 6; cycle++) {
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + Math.min(120, box.width * .2), y + 40, { steps: 24 });
      await page.mouse.move(x, y, { steps: 24 });
      await page.mouse.up();
      await page.mouse.wheel(0, -80);
      await page.waitForTimeout(180);
      await page.mouse.wheel(0, 80);
      await page.waitForTimeout(180);
      if (!await page.locator(selector!).isVisible()) throw new Error(`Motion left ${label}`);
    }
    const frames = await page.evaluate<number[]>("window.__motionRunning=false;window.__motionFrames");
    const metricsAfter = await cdp.send("Performance.getMetrics");
    const sceneTelemetry = mode === "CITY" ? await page.locator(selector!).evaluate(node => {
      const data = (node as HTMLElement).dataset;
      return Object.fromEntries(["livingWorldFrameCpuP95Ms", "livingWorldFrameCpuMaxMs", "livingWorldFrameSamples",
        "constructionWorkers", "constructionMaterials", "developmentFences", "worldQuality", "agentSession"]
        .map(key => [key, data[key] ?? null]));
    }) : undefined;
    if (process.env.PERF_PROFILE_CPU === "true") {
      const { profile } = await cdp.send("Profiler.stop");
      await writeFile(`tmp/living-world/performance/${variant}-${size}-${mode}.cpuprofile`, JSON.stringify(profile));
    }
    const delta = (name: string) => metricsAfter.metrics.find(m => m.name === name)!.value - metricsBefore.metrics.find(m => m.name === name)!.value;
    const sorted = [...frames].sort((a,b) => a-b);
    let current = 0, longest = 0;
    for (const frame of frames) { current = frame > 100 ? current + 1 : 0; longest = Math.max(longest, current); }
    reports.push({ mode: label, sceneTelemetry, samples: frames.length, p50: sorted[Math.ceil(sorted.length*.5)-1], p95: sorted[Math.ceil(sorted.length*.95)-1],
      max: Math.max(...frames), framesOver100Ms: frames.filter(n=>n>100).length, longestOver100Ms: longest,
      mainThreadMs: delta("TaskDuration")*1000, elapsedMs: delta("Timestamp")*1000, sceneRequests: requests-beforeRequests, frames });
  }
  const buildRoot=process.env.PERF_BUILD_ROOT??process.cwd();
  const buildSha256=createHash("sha256").update(await readFile(`${buildRoot}/dist/server.mjs`)).digest("hex");
  const suffix=(process.env.PERF_MODE ? `-${process.env.PERF_MODE}` : "")+(process.env.PERF_PROFILE_CPU === "true" ? "-profile" : "");
  await writeFile(`tmp/living-world/performance/${variant}-${size}-motion-${mobile?"mobile":"desktop"}-dpr${dpr}${suffix}.json`, JSON.stringify({variant,size,fixture,buildSha256,
    browser:browser.version(),gpu,renderer,dpr,cpu:mobile?4:1,profiling:process.env.PERF_PROFILE_CPU === "true",network:{mbps:50,rttMs:80},reports,errors},null,2));
  console.log(JSON.stringify({reports:reports.map(report=>({...report as object,frames:undefined})),errors}));
  if(errors.length)process.exitCode=1;
} finally { await browser.close(); }
