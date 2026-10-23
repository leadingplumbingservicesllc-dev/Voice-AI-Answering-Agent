import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "retain-on-failure",
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    },
  },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1000 },
      },
    },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
    },
  ],
  webServer: {
    command: "npm run build && npm start",
    url: "http://127.0.0.1:3100/healthz",
    reuseExistingServer: false,
    env: {
      APP_MODE: "demo",
      PORT: "3100",
      PUBLIC_BASE_URL: "http://127.0.0.1:3100",
      DATABASE_PATH: "/tmp/leading-e2e.sqlite",
    },
  },
});
