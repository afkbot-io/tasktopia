import { mkdir, writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { createDb } from "../../src/server/db";
import { AppService } from "../../src/server/app-service";
import type { CitySceneDto } from "../../src/shared/city-scene-contract";
import type { TaskStatus } from "../../src/shared/contracts";

test.skip(process.env.E2E_LANDMARK_ART !== "true", "Изолированный сценарий seed-landmark-preview");
test("пять стадий торгового центра на одном участке открывают одну задачу", async ({ page }) => {
  test.setTimeout(120_000);
  const url = new URL(process.env.E2E_DATABASE_URL!);
  expect(["127.0.0.1", "localhost"]).toContain(url.hostname);
  expect(url.pathname).toBe("/tasktopia_test");
  expect(url.searchParams.get("options")).toMatch(/^-csearch_path=landmark_preview_[a-f0-9]{32}$/);
  await page.clock.setFixedTime(new Date("2026-09-09T09:00:00Z"));
  const errors: string[] = [], loaded = new Set<string>(), evidence = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", e => { if (e.type() === "error") errors.push(e.text()); });
  page.on("response", r => {
    if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`);
    if (r.ok() && /compact-city-mall-v1\/stage-[345]\.png$/.test(r.url())) loaded.add(r.url());
  });
  expect((await page.request.post("/api/auth/login", { data: { email: "demo@tasktopia.local", password: "tasktopia-demo" } })).ok()).toBe(true);
  const bootstrap = await (await page.request.get("/api/bootstrap")).json();
  const endpoint = `/api/countries/${bootstrap.country.id}/cities/${bootstrap.initialCity.id}/scene`;
  const readScene = async () => await (await page.request.get(endpoint, {
    headers: { accept: "application/vnd.tasktopia.city-scene+json; version=4" },
  })).json() as CitySceneDto;
  const initial = await readScene();
  expect(initial.city.name).toBe("Торговый центр — стадии");
  const mall = initial.chunks.flatMap(c => c.tasks).find(t => t.buildingType === "compact-city-mall-v1")!;
  expect(mall).toBeDefined(); expect(mall.footprint).toHaveLength(72);
  const db = await createDb(url.toString(), { migrate: false });
  const service = new AppService(db);
  const statuses: TaskStatus[] = ["STARTED", "IN_PROGRESS", "TESTING", "COMPLETED"];
  await mkdir("screenshots/city-landmarks", { recursive: true });
  try {
    for (let stage = 1; stage <= 5; stage++) {
      if (stage > 1) await service.updateTaskStatus(bootstrap.country.id, { taskId: mall.id,
        status: statuses[stage - 2]!, idempotencyKey: `mall-art-stage-${stage}` });
      await page.goto("/");
      const host = page.locator(".world-canvas");
      await expect(host).toHaveAttribute("data-city-scene-commit", "atomic", { timeout: 45000 });
      await expect(host).toHaveAttribute("data-ground-bake-queue", "0");
      const scene = await readScene();
      const current = scene.chunks.flatMap(c => c.tasks).find(t => t.id === mall.id)!;
      expect(current.stage).toBe(stage); expect(current.footprint).toEqual(mall.footprint);
      const canvas = page.locator("canvas[aria-label='Интерактивная карта города']");
      await canvas.hover(); await page.mouse.wheel(0, -1200);
      await expect.poll(async () => Number(await host.getAttribute("data-render-scale"))).toBeGreaterThan(3.8);
      const box = (await canvas.boundingBox())!;
      const target = { x: mall.origin.x + 6, y: mall.origin.y + 3 };
      for (let i = 0; i < 25; i++) {
        const scale = Number(await host.getAttribute("data-render-scale"));
        const dx = (Number(await host.getAttribute("data-camera-world-x")) - target.x) * 8 * scale;
        const dy = (Number(await host.getAttribute("data-camera-world-y")) - target.y) * 8 * scale;
        if (Math.abs(dx) < 2 && Math.abs(dy) < 2) break;
        const fraction = Math.min(1, box.width * .4 / Math.max(1, Math.abs(dx)), box.height * .4 / Math.max(1, Math.abs(dy)));
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
        await page.mouse.move(box.x + box.width / 2 + dx * fraction, box.y + box.height / 2 + dy * fraction, { steps: 4 }); await page.mouse.up();
      }
      await page.waitForTimeout(520); // Existing post-pan click suppression.
      await page.mouse.move(10, 20);
      const path = `screenshots/city-landmarks/mall-stage-${stage}.png`;
      await page.screenshot({ path });
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await expect(page.getByRole("dialog").locator("#task-title")).toHaveText(mall.title);
      evidence.push({ stage, path, footprint: current.footprint, taskId: current.id });
    }
    expect(loaded.size).toBe(3); expect(errors).toEqual([]);
    await writeFile("screenshots/city-landmarks/evidence.json", JSON.stringify({ evidence, loaded: [...loaded], errors }, null, 2));
  } finally { await db.close(); }
});
