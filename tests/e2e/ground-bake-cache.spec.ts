import { build } from "esbuild";
import { expect, test } from "@playwright/test";
import type { runGroundBakeCache } from "./helpers/ground-bake-cache";

test.skip(process.env.E2E_GROUND_BAKE_CACHE !== "true", "Explicit installed-Pixi ground bake cache regression");
test("keeps one ground instruction set across disposable sequential sources", async ({ page }, info) => {
  const bundle = await build({ entryPoints: ["tests/e2e/helpers/ground-bake-cache.ts"], bundle: true, write: false,
    format: "iife", platform: "browser", target: "es2022", minify: true });
  await page.route("**/ground-bake-cache.js", route => route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0]!.text }));
  await page.route("**/ground-bake-cache.html", route => route.fulfill({ contentType: "text/html", body: '<!doctype html><script src="/ground-bake-cache.js"></script>' }));
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto("/ground-bake-cache.html");
  const cases = await page.evaluate(() => (window as typeof window & { runGroundBakeCache: typeof runGroundBakeCache }).runGroundBakeCache());
  await info.attach("installed-pixi-ground-cache", { body: JSON.stringify(cases), contentType: "application/json" });
  const legacy = cases.find(item => !item.reusable)!, current = cases.find(item => item.reusable)!;
  expect(legacy.counts.at(-1)).toBeGreaterThan(legacy.counts[0]! + 10);
  expect(new Set(current.counts).size).toBe(1);
  for (const item of cases) {
    expect(item.sourceStates.every(Boolean)).toBe(true);
    for (const [index, pixel] of item.pixels.entries()) expect(pixel).toEqual(index % 2 ? [51, 102, 153, 255] : [153, 102, 51, 255]);
  }
  expect(errors).toEqual([]);
});
