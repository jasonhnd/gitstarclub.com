import { describe, expect, test } from "bun:test";
import { DEFAULT_CF_PREVIEW_ORIGIN } from "@/lib/runtime-config";
import { workersHostSmokeOrigin } from "./smoke-origin";

describe("workersHostSmokeOrigin", () => {
  test("prefers an explicit host origin", () => {
    expect(
      workersHostSmokeOrigin({ CF_WORKERS_HOST_ORIGIN: "https://preview.example.workers.dev/" }),
    ).toBe("https://preview.example.workers.dev");
  });

  test("defaults to local wrangler when Access is not configured", () => {
    expect(workersHostSmokeOrigin({})).toBe("http://127.0.0.1:8787");
    expect(workersHostSmokeOrigin({ CF_WORKERS_HOST_LOCAL: "1" })).toBe("http://127.0.0.1:8787");
  });

  test("uses the Access-protected workers.dev origin when a Service Token is present", () => {
    expect(
      workersHostSmokeOrigin({
        CF_ACCESS_CLIENT_ID: "gitstarclub-cca-ci",
        CF_PREVIEW_ORIGIN: DEFAULT_CF_PREVIEW_ORIGIN,
      }),
    ).toBe(DEFAULT_CF_PREVIEW_ORIGIN);
  });
});
