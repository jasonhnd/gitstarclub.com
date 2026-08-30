import { defineConfig, devices } from "@playwright/test";
import { vercelProtectionBypassHeaders } from "./lib/vercel-protection-bypass";

const baseURL = process.env.BASE_URL ?? process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";
const bypassHeaders = vercelProtectionBypassHeaders();

export default defineConfig({
  testDir: "./e2e",
  outputDir: "test-results/playwright",
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]] : "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    extraHTTPHeaders: Object.keys(bypassHeaders).length > 0 ? bypassHeaders : undefined,
    serviceWorkers: "block",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
});
