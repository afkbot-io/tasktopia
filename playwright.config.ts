import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173";
const seedCommand = process.env.E2E_SEED_COMMAND ?? "npm run seed:test";
const testDatabaseURL = process.env.TEST_DATABASE_URL
  ?? "postgres://tasktopia:tasktopia@127.0.0.1:55432/tasktopia_test";
const serverPort = new URL(baseURL).port || (baseURL.startsWith("https:") ? "443" : "80");
const webCommand = process.env.E2E_WEB_COMMAND
  ?? `${seedCommand} && npm run build && NODE_ENV=production PORT=${serverPort} SESSION_COOKIE_SECURE=false npm start`;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  // Stateful UI scenarios intentionally share one seeded country. Running
  // them concurrently makes tests rename/delete data underneath each other.
  workers: 1,
  webServer: {
    command: webCommand,
    url: baseURL,
    // `localhost` and `127.0.0.1` are distinct origins. Tie the API's CSRF
    // allow-list to the exact origin Playwright opens in every environment.
    env: {
      APP_ORIGIN: baseURL,
      AUTH_RATE_LIMIT_MAX: "100",
      REGISTRATION_ENABLED: "true",
      DATABASE_URL: process.env.E2E_DATABASE_URL ?? testDatabaseURL,
      TEST_DATABASE_URL: testDatabaseURL,
    },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      testIgnore: /mobile-pwa\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        // Desktop regression tests deliberately intercept lazy chunks. Keep
        // the PWA cache isolated to the dedicated mobile PWA project.
        serviceWorkers: "block",
      },
    },
    { name: "mobile-chromium", testMatch: /mobile-pwa\.spec\.ts/, use: { ...devices["Pixel 7"] } },
    { name: "mobile-webkit", testMatch: /mobile-pwa\.spec\.ts/, use: { ...devices["iPhone 13"] } },
  ],
});
