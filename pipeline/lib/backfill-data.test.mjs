// @ts-nocheck -- Bun test globals are outside the production JS typecheck roots.
import { describe, expect, test } from "bun:test";
import {
  BACKFILL_BUCKETS,
  addDays,
  assertLocalManifestMatches,
  bucketOf,
  bucketSeries,
  drain,
  groupBy,
  num,
  timestampFromGeneration,
} from "./backfill-data.mjs";
import { buildBootstrapPhaseManifest, sha256Bytes } from "./bootstrap-publication.mjs";
import { buildCanonicalMeta } from "./canonical-meta.mjs";
import { renderExtractSql } from "./extract-sql.mjs";

describe("backfill data transformations", () => {
  test("DuckDB bigints become numbers while other values retain their identity", () => {
    const object = {};
    expect(num(100_000n)).toBe(100_000);
    expect(num(-5n)).toBe(-5);
    for (const value of [0, 1.25, null, undefined, "2026-01", object]) {
      expect(num(value)).toBe(value);
    }
  });

  test("grouping preserves first-key order and row order without mutating input", () => {
    const rows = [{ owner: "b", id: 1 }, { owner: "a", id: 2 }, { owner: "b", id: 3 }];
    const groups = groupBy(rows, (row) => row.owner);
    expect([...groups.keys()]).toEqual(["b", "a"]);
    expect(groups.get("b")).toEqual([rows[0], rows[2]]);
    expect(groups.get("a")).toEqual([rows[1]]);
    expect(rows.map((row) => row.id)).toEqual([1, 2, 3]);
    expect(groupBy([], () => "unused").size).toBe(0);
  });

  test("draining sorted numeric and bigint ids advances only over the requested repo", () => {
    const rows = [{ repo_id: 1n, flow: 4n }, { repo_id: 1, flow: -1n }, { repo_id: 3n, flow: 8n }];
    const ptr = { i: 0 };
    expect(drain(rows, ptr, 1)).toEqual(rows.slice(0, 2));
    expect(ptr.i).toBe(2);
    expect(drain(rows, ptr, 2)).toEqual([]);
    expect(ptr.i).toBe(2);
    expect(drain(rows, ptr, 3)).toEqual([rows[2]]);
    expect(ptr.i).toBe(3);
    expect(drain(rows, ptr, 4)).toEqual([]);
    expect(drain([], { i: 0 }, 1)).toEqual([]);
  });

  for (const [day, offset, expected] of [
    ["2024-02-28", 1, "2024-02-29"],
    ["2024-02-29", 1, "2024-03-01"],
    ["2025-02-28", 1, "2025-03-01"],
    ["2025-12-31", 1, "2026-01-01"],
    ["2026-01-01", -90, "2025-10-03"],
    ["2026-05-31", 0, "2026-05-31"],
  ]) {
    test(`UTC date offset ${day} by ${offset} days gives ${expected}`, () => {
      expect(addDays(day, offset)).toBe(expected);
    });
  }

  test("an invalid day retains the exporter's RangeError failure", () => {
    expect(() => addDays("not-a-date", 1)).toThrow(RangeError);
  });

  test("generation timestamps accept a suffix while non-dated ids have no implicit timestamp", () => {
    expect(timestampFromGeneration("bootstrap-20260717T123456Z")).toBe("2026-07-17T12:34:56.000Z");
    expect(timestampFromGeneration("bootstrap-20260717T123456Z-retry")).toBe("2026-07-17T12:34:56.000Z");
    for (const value of [undefined, null, "bootstrap-test", "20260717T123456Z", "bootstrap-20260717T123456Zextra"]) {
      expect(timestampFromGeneration(value)).toBeNull();
    }
    // Parsing the generation is structural; the CLI separately validates Date.parse.
    expect(Number.isFinite(Date.parse(timestampFromGeneration("bootstrap-20261317T123456Z")))).toBe(false);
  });

  test("canonical buckets keep colliding ids separate and preserve signed series values", () => {
    const rows = [
      { repo_id: 1n, period: "2025-12", flow: 10n },
      { repo_id: 33n, period: "2025-12", flow: 3n },
      { repo_id: 1n, period: "2026-01", flow: -2n },
      { repo_id: 32n, period: "2026-01", flow: 0n },
    ];
    const buckets = bucketSeries(rows, (row) => [row.period, num(row.flow)]);
    expect(BACKFILL_BUCKETS).toBe(32);
    expect(bucketOf(31)).toBe(31);
    expect(bucketOf(32)).toBe(0);
    expect(bucketOf(33)).toBe(1);
    expect([...buckets.keys()]).toEqual([1, 0]);
    expect(buckets.get(1)).toEqual({ 1: [["2025-12", 10], ["2026-01", -2]], 33: [["2025-12", 3]] });
    expect(buckets.get(0)).toEqual({ 32: [["2026-01", 0]] });
    expect(bucketSeries([], () => null).size).toBe(0);
  });

  test("canonical metadata retains both folded periods and the deterministic timestamp", () => {
    expect(buildCanonicalMeta({
      seamDate: "2026-01-01", schemaVer: 1, foldedThroughMonth: "2025-12",
      foldedThroughWeek: "2026-W01", generatedAt: "2026-07-17T12:00:00.000Z",
    })).toEqual({
      seam_date: "2026-01-01", schema_ver: 1, folded_through: { month: "2025-12", week: "2026-W01" },
      generated_at: "2026-07-17T12:00:00.000Z",
    });
  });
});

describe("step 07 local validation binds to sealed manifest bytes", () => {
  const generation = "bootstrap-20260717T120000Z";
  const items = [{ path: "views/b.json", body: "{}" }, { path: "views/a.json", body: "{\"ok\":true}" }];
  const remote = { sha256: sha256Bytes(Buffer.from(JSON.stringify(buildBootstrapPhaseManifest(generation, "base", items)))) };

  test("input order and buffer representation do not change a matching manifest", () => {
    expect(() => assertLocalManifestMatches(generation, "base", [...items].reverse().map((item) => ({
      ...item, body: Buffer.from(item.body),
    })), remote)).not.toThrow();
  });

  for (const [label, changed] of [
    ["object bytes", [{ ...items[0], body: "{\"changed\":true}" }, items[1]]],
    ["object name", [{ ...items[0], path: "views/c.json" }, items[1]]],
    ["object count", [items[0]]],
  ]) {
    test(`changed ${label} cannot pass the sealed manifest gate`, () => {
      expect(() => assertLocalManifestMatches(generation, "base", changed, remote)).toThrow(
        "base local validation input does not match sealed remote manifest",
      );
    });
  }

  test("generation, phase, duplicate paths, and traversal still fail validation", () => {
    expect(() => assertLocalManifestMatches("bootstrap-other", "base", items, remote)).toThrow("does not match");
    expect(() => assertLocalManifestMatches(generation, "canonical", items, remote)).toThrow("cannot stage object");
    expect(() => assertLocalManifestMatches(generation, "base", [items[0], items[0]], remote)).toThrow("duplicate staged");
    expect(() => assertLocalManifestMatches(generation, "base", [{ path: "views/../meta.json", body: "{}" }], remote)).toThrow(
      "invalid staged object path",
    );
  });
});

describe("step 02 SQL rendering failure paths", () => {
  const template = "@@DESTINATION_TABLE@@ @@CUTOFF_SUFFIX@@ @@DESTINATION_TABLE@@";
  const destination = "gitstarclub.star_daily_gross_260531";

  test("trims and unquotes a dated destination and replaces every placeholder", () => {
    expect(renderExtractSql(template, { cutoffSuffix: "260531", destination: ` \`${destination}\` ` })).toBe(
      `${destination} 260531 ${destination}`,
    );
  });

  for (const cutoffSuffix of [undefined, "", "26053", "2605310", "26053x", "260531 OR 1=1"]) {
    test(`invalid cutoff ${JSON.stringify(cutoffSuffix)} is refused`, () => {
      expect(() => renderExtractSql(template, { cutoffSuffix, destination })).toThrow("6-digit YYMMDD");
    });
  }

  test("empty, unsafe, and unsuffixed destinations cannot overwrite a table", () => {
    for (const target of [undefined, "", "   "]) {
      expect(() => renderExtractSql(template, { cutoffSuffix: "260531", destination: target })).toThrow("--destination is required");
    }
    for (const target of ["other.star_daily_gross_260531", `${destination}; DROP TABLE x`, "gitstarclub.star_daily_gross_"]) {
      expect(() => renderExtractSql(template, { cutoffSuffix: "260531", destination: target })).toThrow("must look like");
    }
    expect(() => renderExtractSql(template, { cutoffSuffix: "260531", destination: "gitstarclub.star_daily_gross" })).toThrow(
      "refusing to overwrite",
    );
  });

  test("a template missing either placeholder is refused", () => {
    for (const broken of ["", "@@DESTINATION_TABLE@@", "@@CUTOFF_SUFFIX@@"]) {
      expect(() => renderExtractSql(broken, { cutoffSuffix: "260531", destination })).toThrow("is missing");
    }
  });
});
