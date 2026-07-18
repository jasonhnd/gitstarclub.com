import { describe, expect, test } from "bun:test";
import {
  DEFAULT_PUBLIC_BLOB_BASE,
  KNOWN_MISSING_LIVE_WEEKS,
  isoWeeksInYear,
  liveGatesRequired,
  previousIsoWeek,
  recentClosedWeeks,
  resolveLiveGateConfig,
  withinPublicationScheduleGrace,
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

  test("W27 is no longer a documented missing live week after GH Archive backfill", () => {
    expect(KNOWN_MISSING_LIVE_WEEKS).not.toContain("2026-W27");
    // Continuity scan still includes the week itself as a period to check.
    const scanned = recentClosedWeeks(new Date("2026-07-15T00:00:00.000Z"), 4);
    expect(scanned).toContain("2026-W27");
  });
});

describe("ISO week math", () => {
  test("2026 has 53 ISO weeks; 2027-W01 rolls back to 2026-W53", () => {
    expect(isoWeeksInYear(2026)).toBe(53);
    expect(previousIsoWeek("2027-W01")).toBe("2026-W53");
    expect(recentClosedWeeks(new Date("2027-01-04T12:00:00.000Z"), 2)).toEqual(["2026-W53", "2026-W52"]);
  });

  test("52-week year rolls back to W52", () => {
    // 2025 has 52 ISO weeks
    expect(isoWeeksInYear(2025)).toBe(52);
    expect(previousIsoWeek("2026-W01")).toBe("2025-W52");
  });
});

describe("publication schedule grace", () => {
  test("Monday early UTC defers current week requirement", () => {
    const mon0100 = new Date("2026-07-20T01:00:00.000Z"); // Monday
    expect(withinPublicationScheduleGrace(mon0100)).toEqual({ weekGrace: true, monthGrace: false });
  });

  test("first of month early UTC defers current month requirement", () => {
    const first = new Date("2026-08-01T01:30:00.000Z"); // Saturday 1st
    expect(withinPublicationScheduleGrace(first)).toEqual({ weekGrace: false, monthGrace: true });
  });

  test("mid-day Monday requires current week", () => {
    const mon1200 = new Date("2026-07-20T12:00:00.000Z");
    expect(withinPublicationScheduleGrace(mon1200)).toEqual({ weekGrace: false, monthGrace: false });
  });
});
