import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173";
const seedCommand = process.env.E2E_SEED_COMMAND ?? "npm run seed:test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  webServer: {
    command: `${seedCommand} && npm run dev`,
    url: baseURL,
    // `localhost` and `127.0.0.1` are distinct origins. Tie the API's CSRF
    // allow-list to the exact origin Playwright opens in every environment.
    env: { APP_ORIGIN: baseURL },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
  ],
});
