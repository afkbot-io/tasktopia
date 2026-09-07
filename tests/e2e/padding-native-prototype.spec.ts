import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { expect, test } from "@playwright/test";
import type { runPaddingNativePrototype } from "./helpers/padding-native-prototype";

test.skip(process.env.E2E_PADDING_NATIVE_PROTOTYPE !== "true", "Explicit isolated renderer prototype only, not an app acceptance test");
test.use({ viewport: { width: 1600, height: 2800 } });
test("measures bounded missing-region native atlas approaches without changing the live CITY renderer", async ({ page }, info) => {
  test.setTimeout(90_000);
  const bundle = await build({ entryPoints: ["tests/e2e/helpers/padding-native-prototype.ts"], bundle: true, write: false,
    format: "iife", platform: "browser", target: "es2022", minify: true });
  const manifest = JSON.parse(await readFile("assets/pixel-city-pack/manifest.json", "utf8")) as { assetRevision: string };
  await page.route("**/padding-native-prototype.js", route => route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0]!.text }));
  await page.route("**/padding-native-prototype.html", route => route.fulfill({ contentType: "text/html",
    body: '<!doctype html><html><body style="margin:0"><script src="/padding-native-prototype.js"></script></body></html>' }));
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("response", response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  await page.goto("/padding-native-prototype.html");
  const report = await page.evaluate(revision => (window as typeof window & { runPaddingNativePrototype: typeof runPaddingNativePrototype }).runPaddingNativePrototype(revision), manifest.assetRevision);
  await info.attach("native-padding-prototype", { body: JSON.stringify(report), contentType: "application/json" });
  for (const sample of report.reports) { expect(sample.sampled).toBeGreaterThan(1000); expect(sample.matching).toBe(sample.sampled); }
  expect(report.reports.find(item => item.name === "actual-B-visible-miss")!.rects).toHaveLength(4);
  expect(errors).toEqual([]);
});
