import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  use: { baseURL: "http://localhost:3100" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" } },
  ],
  webServer: {
    command: "npm run dev -- --port 3100",
    url: "http://localhost:3100/api/ready",
    reuseExistingServer: !process.env.CI,
    timeout: 90000,
    env: { APP_URL: "http://localhost:3100", NEXT_DIST_DIR: ".next-e2e" },
  },
});
