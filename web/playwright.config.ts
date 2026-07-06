import { defineConfig, devices } from "@playwright/test";

const appPort = Number(process.env.PLAYWRIGHT_APP_PORT ?? 3100);
const blobPort = Number(process.env.PLAYWRIGHT_BLOB_PORT ?? 3101);
const appBaseUrl = `http://127.0.0.1:${appPort}`;
const blobBaseUrl = `http://127.0.0.1:${blobPort}`;
const webServerEnv = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
);

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /.*\.test\.ts/,
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: {
    timeout: 5_000,
  },
  use: {
    baseURL: appBaseUrl,
    serviceWorkers: "block",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      name: "blob-fixtures",
      command: `bun scripts/serve-playwright-blob-fixtures.mjs --port ${blobPort}`,
      url: `${blobBaseUrl}/__health`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      name: "next",
      command: `bun run build && bun run start -- --hostname 127.0.0.1 --port ${appPort}`,
      env: {
        ...webServerEnv,
        BLOB_BASE_URL: blobBaseUrl,
        NEXT_TELEMETRY_DISABLED: "1",
      },
      url: `${appBaseUrl}/pulse`,
      reuseExistingServer: !process.env.CI,
      timeout: 240_000,
    },
  ],
});
