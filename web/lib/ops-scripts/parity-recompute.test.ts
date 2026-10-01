import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  classifyParityLeaves,
  compareParityView,
  excludeParityLiveArtifacts,
  parityIsOk,
  walkParityFiles,
} from "../../scripts/lib/parity-diff";

describe("parity-recompute diff", () => {
  test("ignores timestamps and compares only meta seam fields", () => {
    expect(
      compareParityView(
        "rank/week.json",
        { generated_at: "a", backfilled_at: "b", value: 1 },
        { generated_at: "c", backfilled_at: "d", value: 1 },
      ),
    ).toEqual([]);
    expect(
      compareParityView(
        "meta.json",
        { seam_date: "2024-01-01", schema_ver: 2, folded_through: { week: "later" } },
        { seam_date: "2024-01-01", schema_ver: 2, folded_through: { week: "earlier" } },
      ),
    ).toEqual([]);
    expect(
      compareParityView("meta.json", { seam_date: "2024-01-01", schema_ver: 2 }, { seam_date: "2024-01-02", schema_ver: 2 }),
    ).toEqual([{ path: "seam_date", a: "2024-01-01", b: "2024-01-02", numeric: false }]);
  });

  test("canonicalizes newcomer order and org member order before comparing", () => {
    const produced = { items: [{ id: 2, value: 5, rank: 9 }, { id: 1, value: 5, rank: 8 }] };
    const disk = { items: [{ id: 1, value: 5, rank: 1 }, { id: 2, value: 5, rank: 2 }] };
    expect(compareParityView("rank/repo/new.json", produced, disk)).toEqual([]);
    expect(
      compareParityView("entity/org/1.json", { members: [10, 2], name: "a" }, { members: [2, 10], name: "a" }),
    ).toEqual([]);
    expect(
      compareParityView(
        "entity/org/repo/new.json",
        { members: [3, 1], items: [{ id: 2, value: 1, rank: 0 }] },
        { members: [1, 3], items: [{ id: 2, value: 1, rank: 4 }] },
      ),
    ).toEqual([]);
  });

  test("classifies exact, ±1 rounding, and structural mismatch", () => {
    expect(classifyParityLeaves("v.json", [])).toEqual({ kind: "exact", maxDelta: 0, maxDeltaWhere: "", sample: "" });
    const rounding = classifyParityLeaves("v.json", [
      { path: ".n", a: 10, b: 11, numeric: true },
      { path: ".m", a: 4, b: 4.5, numeric: true },
    ]);
    expect(rounding.kind).toBe("rounding");
    expect(rounding.maxDelta).toBe(1);
    expect(rounding.maxDeltaWhere).toBe("v.json.n: 10 vs 11");
    expect(rounding.sample).toContain("Δ@.n: 10 vs 11 (2 leaves)");
    const mismatch = classifyParityLeaves("v.json", [
      { path: ".name", a: "left", b: "right", numeric: false },
      { path: ".n", a: 1, b: 4, numeric: true },
    ]);
    expect(mismatch.kind).toBe("mismatch");
    expect(mismatch.maxDelta).toBe(3);
    expect(mismatch.sample).toContain('"left"');
    expect(
      compareParityView("a.json", { items: [1] }, { items: [1, 2] })[0],
    ).toMatchObject({ path: ".items.length", numeric: false });
    expect(compareParityView("a.json", { extra: 1 }, { extra: 1, missing: 2 })).toEqual([
      { path: ".missing", a: undefined, b: 2, numeric: false },
    ]);
  });

  test("the pass rule allows ±1 and drops live artifacts", () => {
    expect(parityIsOk({ mismatch: 0, missingOnDisk: 0, notProduced: 0, maxDelta: 1 })).toBe(true);
    expect(parityIsOk({ mismatch: 1, missingOnDisk: 0, notProduced: 0, maxDelta: 0 })).toBe(false);
    expect(parityIsOk({ mismatch: 0, missingOnDisk: 0, notProduced: 0, maxDelta: 2 })).toBe(false);
    expect(excludeParityLiveArtifacts(["hot-snapshot.json", "rank/a.json", "current_month.json"])).toEqual([
      "rank/a.json",
    ]);
    const dir = mkdtempSync(join(tmpdir(), "parity-walk-"));
    try {
      mkdirSync(join(dir, "rank"));
      writeFileSync(join(dir, "hot-snapshot.json"), "{}\n");
      writeFileSync(join(dir, "rank", "a.json"), "{}\n");
      expect(walkParityFiles(dir).toSorted()).toEqual(["hot-snapshot.json", "rank/a.json"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
