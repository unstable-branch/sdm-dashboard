import { defineConfig, devices } from "@playwright/test";

const CI = !!process.env.CI;
const loopbackHttps = process.env.SDM_CI_LOOPBACK_HTTPS === "1";
if (
  loopbackHttps &&
  !/^https:\/\/127\.0\.0\.1(?::\d+)?(?:\/|$)/.test(process.env.E2E_BASE_URL || "")
) {
  throw new Error("SDM_CI_LOOPBACK_HTTPS requires an explicit IPv4 loopback HTTPS E2E_BASE_URL");
}

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 2 : 0,
  workers: CI ? 1 : undefined,
  reporter: CI
    ? [["html"], ["json", { outputFile: "test-results/results.json" }]]
    : "html",
  timeout: 30000,
  expect: {
    timeout: 10000,
  },
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://127.0.0.1:3000",
    ignoreHTTPSErrors: loopbackHttps,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: CI ? "on-first-retry" : "off",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 5"] },
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npm run dev",
        url: "http://127.0.0.1:3000",
        reuseExistingServer: true,
        timeout: 60000,
        stdout: "pipe",
        stderr: "pipe",
      },
});
