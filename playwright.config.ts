import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173";
// Fixture safety checks in workers must see the same resolved target as the
// runner, including the default isolated server started by `test:e2e`.
process.env.E2E_BASE_URL = baseURL;
const seedCommand = process.env.E2E_SEED_COMMAND ?? "npm run seed:test";
const testDatabaseURL = process.env.TEST_DATABASE_URL
  ?? "postgres://tasktopia:tasktopia@127.0.0.1:55432/tasktopia_test";
const serverPort = new URL(baseURL).port || (baseURL.startsWith("https:") ? "443" : "80");
const webCommand = process.env.E2E_WEB_COMMAND
  ?? `${seedCommand} && npm run build && NODE_ENV=production PORT=${serverPort} SESSION_COOKIE_SECURE=false npm start`;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  // Hosted software renderers need longer for first-scene readiness. Explicit
  // performance budgets and fault-injection timeouts remain in their tests.
  expect: { timeout: process.env.CI ? 15_000 : 5_000 },
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
      // One local IP drives many independent users and reload journeys in CI.
      CITY_SCENE_RATE_LIMIT_MAX: "300",
      REGISTRATION_ENABLED: "true",
      DATABASE_URL: process.env.E2E_DATABASE_URL ?? testDatabaseURL,
      TEST_DATABASE_URL: testDatabaseURL,
      VAPID_SUBJECT: "mailto:e2e@tasktopia.local",
      VAPID_PUBLIC_KEY: "BJr0tc_HuCMQJu3JNPXyXdHtYn6BfvSw7C-gDbRQKwtFDGRg8dTM8kUJQTiG49l7O1AvdtGHst44gv-wfpFegZM",
      VAPID_PRIVATE_KEY: "gI87ZWE09zw6Mc76CD9oKQCpRsJGFjdgOWgLjmKDKUA",
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
    { name: "webkit-visual", testMatch: /(?:city-documents|world-digest|task-entry|atlas-transport|atlas-flight-geometry|atlas-pixel-zoom|planet-feedback|visual-consistency|visual-services|world-preferences|city-asset-overlap)\.spec\.ts/, use: { ...devices["Desktop Safari"], viewport: { width: 1440, height: 900 }, serviceWorkers: "block" } },
    { name: "mobile-chromium", testMatch: /mobile-pwa\.spec\.ts/, use: { ...devices["Pixel 7"] } },
    { name: "mobile-webkit", testMatch: /(?:mobile-pwa|pwa-update)\.spec\.ts/, use: { ...devices["iPhone 13"] } },
  ],
});
