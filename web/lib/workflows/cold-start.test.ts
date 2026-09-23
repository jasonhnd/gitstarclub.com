import { beforeEach, describe, expect, test } from "bun:test";
import {
  buildColdStartCanonicalMeta,
  buildEmptyFrozenPending,
  coldStartPreflightFromMeta,
} from "./cold-start";

beforeEach(() => {
  delete process.env.WORKFLOW_COLD_START;
  delete process.env.VERCEL_ENV;
});

describe("workflow cold-start (#519)", () => {
  test("buildColdStartCanonicalMeta uses the bootstrap day as seam and prior fold watermarks", () => {
    const metaValue = buildColdStartCanonicalMeta(new Date("2026-09-22T12:00:00.000Z"));
    expect(metaValue.seam_date).toBe("2026-09-22");
    expect(metaValue.schema_ver).toBe(2);
    expect(metaValue.folded_through).toEqual({ month: "2026-08", week: "2026-W36" });
    expect(metaValue.generated_at).toBe("2026-09-22T12:00:00.000Z");
  });

  test("buildEmptyFrozenPending is a valid honest empty frozen month", () => {
    const pending = buildEmptyFrozenPending("2026-08");
    expect(pending.period).toBe("2026-08");
    expect(pending.frozen_at).toBe("2026-09-01T00:00:00.000Z");
    expect(pending.daily_totals).toEqual([]);
    expect(pending.per_repo).toEqual({});
  });

  test("coldStartPreflightFromMeta maps meta fields", () => {
    const meta = buildColdStartCanonicalMeta(new Date("2026-09-22T12:00:00.000Z"));
    expect(coldStartPreflightFromMeta(meta)).toEqual({
      seam_date: "2026-09-22",
      schema_ver: 2,
      folded_through: { month: "2026-08", week: "2026-W36" },
      generated_at: "2026-09-22T12:00:00.000Z",
    });
  });
});
