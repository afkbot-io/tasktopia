/** Bounded paired browser measurement against one saved local city. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { cpus, platform } from "node:os";
import { chromium, expect } from "@playwright/test";
import { openMapCity } from "../tests/e2e/map-navigation";

const targets = [
  { name: "baseline", url: process.env.DIVERSITY_BASELINE_URL! },
  { name: "candidate", url: process.env.DIVERSITY_CANDIDATE_URL! },
];
for (const target of targets) assert.ok(["127.0.0.1", "localhost"].includes(new URL(target.url).hostname));
const browser = await chromium.launch({ headless: true });
const samples: unknown[] = [];
const errors: string[] = [];
try {
  for (let pair = 0; pair < 3; pair++) for (const target of pair % 2 ? [...targets].reverse() : targets) {
    const context = await browser.newContext({ baseURL: target.url, viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, serviceWorkers: "block" });
    try {
      const login = await context.request.post(`${target.url}/api/auth/login`, { data: { email: "demo@tasktopia.local", password: "tasktopia-demo" } });
      assert.equal(login.status(), 200);
      const page = await context.newPage();
      page.on("pageerror", error => errors.push(error.message));
      page.on("requestfailed", request => errors.push(request.url()));
      page.on("response", response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
      await page.clock.setFixedTime(new Date("2026-09-06T09:00:00Z"));
      const response = page.waitForResponse(response => /\/cities\/[^/]+\/scene$/.test(new URL(response.url()).pathname));
      const start = performance.now();
      await page.goto(target.url); await openMapCity(page);
      const host = page.locator(".world-canvas");
      await expect(host).toHaveAttribute("data-city-scene-commit", "atomic", { timeout: 60_000 });
      await expect(host).toHaveAttribute("data-ground-bake-queue", "0");
      await expect(host).toHaveAttribute("data-mobility-ready", "true");
      const loadMs = performance.now() - start;
      const scene = await (await response).json();
      const tasks = [...new Map(scene.chunks.flatMap((chunk: { tasks: Array<{ id: string }> }) => chunk.tasks).map((task: { id: string }) => [task.id, task])).values()];
      const geometryHash = createHash("sha256").update(JSON.stringify(tasks)).digest("hex");
      await page.waitForTimeout(3000); // Declared warmup; excluded from samples.
      const frames = await page.evaluate<number[]>(`new Promise(resolve => {
        const values = []; let previous = performance.now();
        const start = previous;
        const frame = (now) => {
          values.push(now - previous); previous = now;
          if (now - start >= 8000) resolve(values); else requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      })`);
      const cdp = await context.newCDPSession(page);
      await cdp.send("Performance.enable"); await cdp.send("HeapProfiler.collectGarbage");
      const metrics = (await cdp.send("Performance.getMetrics")).metrics;
      const sorted = frames.slice(1).sort((a, b) => a - b);
      const sample = { variant: target.name, pair, taskCount: tasks.length, geometryHash, loadMs,
        frameCount: sorted.length, p50Ms: sorted[Math.floor(sorted.length * .5)], p95Ms: sorted[Math.floor(sorted.length * .95)],
        heapBytes: metrics.find(metric => metric.name === "JSHeapUsedSize")!.value,
        telemetry: await host.evaluate(element => ({ ...(element as HTMLElement).dataset })) };
      samples.push(sample); console.log(JSON.stringify(sample));
    } finally { await context.close(); }
  }
  await mkdir("tmp/building-diversity", { recursive: true });
  await writeFile("tmp/building-diversity/performance.json", JSON.stringify({
    workload: "One unchanged saved city, three alternating pairs, 3s warmup and 8s frame sample, desktop 1440×1000 DPR1",
    budget: "candidate median p95 <= baseline median p95 × 1.10", host: { platform: platform(), cpu: cpus()[0]?.model },
    browser: browser.version(), samples, errors,
  }, null, 2));
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
