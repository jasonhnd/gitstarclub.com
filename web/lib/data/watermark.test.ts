import { test, expect, describe, mock, beforeEach } from "bun:test";
import type { Meta } from "@/lib/contracts";

// --- Controllable mocks -----------------------------------------------------
// `watermark.ts` reads the fold watermark via getMeta() (which fetches Blob) and
// falls back to currentUtcPeriods() when meta has no folded_through. We mock both
// so the tested logic is exercised against fully controlled inputs (no network).

let metaValue: Meta | null = null;
let currentValue = { monthPeriod: "2026-06", weekPeriod: "2026-W23" };

mock.module("./meta", () => ({
  getMeta: () => Promise.resolve(metaValue),
}));

mock.module("@/lib/periods", () => ({
  currentUtcPeriods: () => currentValue,
}));

// Import AFTER registering mocks so the SUT binds to the mocked deps.
const { isLiveOverlayPeriod } = await import("./watermark");

const metaWithFold = (month: string, week: string): Meta => ({
  seam_date: "2020-01-01",
  schema_ver: 1,
  folded_through: { month, week },
});

const metaNoFold = (): Meta => ({
  seam_date: "2020-01-01",
  schema_ver: 1,
});

beforeEach(() => {
  metaValue = null;
  currentValue = { monthPeriod: "2026-06", weekPeriod: "2026-W23" };
});

describe("isLiveOverlayPeriod — folded_through present", () => {
  describe("window=month", () => {
    test("period > folded_through.month → true (live overlay)", async () => {
      metaValue = metaWithFold("2026-05", "2026-W20");
      expect(await isLiveOverlayPeriod("month", "2026-06")).toBe(true);
    });

    test("period == folded_through.month → false (served from base)", async () => {
      metaValue = metaWithFold("2026-05", "2026-W20");
      expect(await isLiveOverlayPeriod("month", "2026-05")).toBe(false);
    });

    test("period < folded_through.month → false (served from base)", async () => {
      metaValue = metaWithFold("2026-05", "2026-W20");
      expect(await isLiveOverlayPeriod("month", "2026-04")).toBe(false);
    });
  });

  describe("window=week", () => {
    test("period > folded_through.week → true (live overlay)", async () => {
      metaValue = metaWithFold("2026-05", "2026-W20");
      expect(await isLiveOverlayPeriod("week", "2026-W21")).toBe(true);
    });

    test("period == folded_through.week → false (served from base)", async () => {
      metaValue = metaWithFold("2026-05", "2026-W20");
      expect(await isLiveOverlayPeriod("week", "2026-W20")).toBe(false);
    });

    test("period < folded_through.week → false (served from base)", async () => {
      metaValue = metaWithFold("2026-05", "2026-W20");
      expect(await isLiveOverlayPeriod("week", "2026-W19")).toBe(false);
    });

    test("uses the per-window key (month fold does not gate week)", async () => {
      // month folded far ahead, week barely folded: a week period after the week
      // watermark must still be live regardless of the month watermark.
      metaValue = metaWithFold("2030-01", "2026-W20");
      expect(await isLiveOverlayPeriod("week", "2026-W21")).toBe(true);
    });
  });
});

describe("isLiveOverlayPeriod — no folded_through (flat bootstrap meta)", () => {
  test("month: matches current month period → true", async () => {
    metaValue = metaNoFold();
    currentValue = { monthPeriod: "2026-06", weekPeriod: "2026-W23" };
    expect(await isLiveOverlayPeriod("month", "2026-06")).toBe(true);
  });

  test("month: non-current month period → false", async () => {
    metaValue = metaNoFold();
    currentValue = { monthPeriod: "2026-06", weekPeriod: "2026-W23" };
    expect(await isLiveOverlayPeriod("month", "2026-05")).toBe(false);
  });

  test("week: matches current week period → true", async () => {
    metaValue = metaNoFold();
    currentValue = { monthPeriod: "2026-06", weekPeriod: "2026-W23" };
    expect(await isLiveOverlayPeriod("week", "2026-W23")).toBe(true);
  });

  test("week: non-current week period → false", async () => {
    metaValue = metaNoFold();
    currentValue = { monthPeriod: "2026-06", weekPeriod: "2026-W23" };
    expect(await isLiveOverlayPeriod("week", "2026-W22")).toBe(false);
  });
});

describe("isLiveOverlayPeriod — null meta (absent meta.json)", () => {
  test("falls back to current-period check when getMeta returns null", async () => {
    metaValue = null;
    currentValue = { monthPeriod: "2026-06", weekPeriod: "2026-W23" };
    expect(await isLiveOverlayPeriod("month", "2026-06")).toBe(true);
    expect(await isLiveOverlayPeriod("month", "2026-05")).toBe(false);
  });
});
