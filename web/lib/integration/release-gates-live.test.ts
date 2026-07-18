import { describe, expect, test } from "bun:test";
import {
  DEFAULT_PUBLIC_BLOB_BASE,
  KNOWN_MISSING_LIVE_WEEKS,
  liveGatesRequired,
  recentClosedWeeks,
  resolveLiveGateConfig,
} from "./release-gates-live";

describe("release-gates-live config", () => {
  test("require flag is off by default", () => {
    expect(liveGatesRequired({})).toBe(false);
    expect(liveGatesRequired({ RELEASE_GATE_REQUIRE_LIVE: "1" })).toBe(true);
  });

  test("rejects missing site when resolving config", () => {
    const resolved = resolveLiveGateConfig({ BLOB_BASE_URL: DEFAULT_PUBLIC_BLOB_BASE });
    expect("error" in resolved).toBe(true);
  });

  test("rejects fixture blob hosts", () => {
    const resolved = resolveLiveGateConfig({
      RELEASE_GATE_SITE: "https://gitstarclub.com",
      BLOB_BASE_URL: "https://blob.example.com",
    });
    expect("error" in resolved).toBe(true);
  });

  test("accepts site + public default blob", () => {
    const resolved = resolveLiveGateConfig({ RELEASE_GATE_SITE: "https://gitstarclub.com" });
    expect("error" in resolved).toBe(false);
    if ("error" in resolved) return;
    expect(resolved.siteBase).toBe("https://gitstarclub.com");
    expect(resolved.blobBase).toBe(DEFAULT_PUBLIC_BLOB_BASE);
  });

  test("documents the W27 outage gap explicitly", () => {
    expect(KNOWN_MISSING_LIVE_WEEKS).toContain("2026-W27");
    const scanned = recentClosedWeeks(new Date("2026-07-15T00:00:00.000Z"), 4);
    expect(scanned).toContain("2026-W27");
  });
});
