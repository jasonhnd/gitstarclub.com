import { describe, expect, test } from "bun:test";
import { PreviewHistoryAvailability } from "@/lib/contracts/canonical";
import { withWorkerEnv } from "@/lib/workers-host/runtime-env";
import { readHistoryAvailability } from "./history-availability";

const marker = {
  seed_date: "2026-10-19",
  monthly: "unavailable",
  prior_year_heatmap: "unavailable",
  set_at: "2026-10-25T09:00:00Z",
} as const;
const preview = { DEPLOY_ENV: "pre" };

const malformed: Array<[string, unknown]> = [
  ["empty object", {}],
  ["array", []],
  ["JSON string instead of decoded object", JSON.stringify(marker)],
  ["boolean", true],
  ["unknown field", { ...marker, weekly: "unavailable" }],
  ["wrong monthly declaration", { ...marker, monthly: "available" }],
  ["wrong heatmap declaration", { ...marker, prior_year_heatmap: false }],
  ["invalid seed date", { ...marker, seed_date: "2026-02-30" }],
  ["seed timestamp instead of date", { ...marker, seed_date: marker.set_at }],
  ["non-string seed date", { ...marker, seed_date: 20261019 }],
  ["invalid set timestamp", { ...marker, set_at: "not-a-timestamp" }],
  ["impossible set date", { ...marker, set_at: "2026-02-30T09:00:00Z" }],
  ["set timestamp without timezone", { ...marker, set_at: "2026-10-25T09:00:00" }],
  ["date instead of set timestamp", { ...marker, set_at: "2026-10-25" }],
];

describe("preview history availability", () => {
  test.each([undefined, null])("absent marker %p stays strict", (absent) => {
    expect(readHistoryAvailability(absent, preview)).toBe("strict");
  });

  test.each(malformed)("malformed marker fails closed: %s", (_label, value) => {
    expect(PreviewHistoryAvailability.safeParse(value).success).toBe(false);
    expect(readHistoryAvailability(value, preview)).toBe("strict");
  });

  test.each(Object.keys(marker))("requires the %s field", (key) => {
    const incomplete = Object.fromEntries(Object.entries(marker).filter(([name]) => name !== key));
    expect(PreviewHistoryAvailability.safeParse(incomplete).success).toBe(false);
    expect(readHistoryAvailability(incomplete, preview)).toBe("strict");
    expect(readHistoryAvailability({ ...marker, [key]: null }, preview)).toBe("strict");
  });

  test.each([
    {},
    { HOSTING_TARGET: "cf" },
    { VERCEL_ENV: "preview" },
    { DEPLOY_ENV: "" },
    { DEPLOY_ENV: "local" },
    { DEPLOY_ENV: "preview" },
    { DEPLOY_ENV: "invalid" },
    { DEPLOY_ENV: "production" },
    { DEPLOY_ENV: " PRODUCTION " },
    { VERCEL_ENV: "production" },
    { DEPLOY_ENV: "pre", VERCEL_ENV: "production" },
  ])("valid marker stays strict outside guarded preview: %p", (env) => {
    expect(readHistoryAvailability(marker, env)).toBe("strict");
  });

  test("valid preview marker returns exactly the declared coverage and provenance", () => {
    expect(PreviewHistoryAvailability.parse(marker)).toEqual(marker);
    const result = readHistoryAvailability(marker, preview);
    expect(result).toEqual(marker);
    expect(result).not.toBe(marker);
    expect(marker.monthly).toBe("unavailable");
  });

  test("uses the existing normalization of the preview deployment guard", () => {
    expect(readHistoryAvailability(marker, { DEPLOY_ENV: " PRE " })).toEqual(marker);
  });

  test("accepts real leap dates and timestamps with explicit offsets", () => {
    const declaration = { ...marker, seed_date: "2024-02-29", set_at: "2026-10-25T10:00:00+01:00" };
    expect(readHistoryAvailability(declaration, preview)).toEqual(declaration);
  });

  test("does not infer eligibility from empty families or fold watermarks", () => {
    expect(readHistoryAvailability({ monthly: {}, prior_year_heatmap: [] }, preview)).toBe("strict");
    expect(readHistoryAvailability({
      seam_date: marker.seed_date,
      folded_through: { month: "2026-09", week: "2026-W42" },
      schema_ver: 2,
    }, preview)).toBe("strict");
  });

  test("removed cold-start flags do not establish coverage", () => {
    expect(readHistoryAvailability(undefined, {
      ...preview,
      WORKFLOW_COLD_START: "1",
      PREFLIGHT_RELAX_EMPTY_SHARDS: "1",
    })).toBe("strict");
  });

  test("reads preview configuration from request-scoped Worker bindings", () => {
    withWorkerEnv({ DEPLOY_ENV: "pre", VERCEL_ENV: "preview" }, () => {
      expect(readHistoryAvailability(marker)).toEqual(marker);
      expect(readHistoryAvailability(marker, {})).toBe("strict");
      expect(readHistoryAvailability(marker, { DEPLOY_ENV: "production" })).toBe("strict");
    });
  });

  test("Worker production signals override a valid marker", () => {
    withWorkerEnv({ DEPLOY_ENV: "production" }, () => {
      expect(readHistoryAvailability(marker)).toBe("strict");
    });
    withWorkerEnv({ DEPLOY_ENV: "pre", VERCEL_ENV: "production" }, () => {
      expect(readHistoryAvailability(marker)).toBe("strict");
    });
  });
});
