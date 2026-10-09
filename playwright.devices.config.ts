import { defineConfig, devices } from "@playwright/test";
import base from "./playwright.config";

/** Explicit extended device audit; the regular CI gate keeps its own matrix. */
export default defineConfig({
  ...base,
  testDir: "./tests/e2e",
  testMatch: /device-compatibility\.spec\.ts/,
  projects: [
    { name: "desktop-firefox", use: { ...devices["Desktop Firefox"], viewport: { width: 1366, height: 768 }, serviceWorkers: "block" } },
    { name: "desktop-4k", use: { ...devices["Desktop Chrome"], viewport: { width: 3840, height: 2160 }, deviceScaleFactor: 1, serviceWorkers: "block" } },
    { name: "android-small", use: { ...devices["Pixel 7"], viewport: { width: 360, height: 780 }, serviceWorkers: "block" } },
    { name: "iphone-portrait", use: { ...devices["iPhone 13"], serviceWorkers: "block" } },
    { name: "ipad-portrait", use: { ...devices["iPad (gen 7)"], serviceWorkers: "block" } },
    { name: "ipad-landscape", use: { ...devices["iPad (gen 7) landscape"], serviceWorkers: "block" } },
  ],
});
