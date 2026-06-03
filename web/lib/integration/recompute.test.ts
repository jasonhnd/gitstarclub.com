// Offline parity gate as a bun:test suite (port of scripts/parity-recompute.ts).
// Recomputes EVERY view from the local canonical/v2 shards with the pure-JS recompute core and
// structurally diffs each one against the DuckDB precompute output under pipeline/data/views.
// This is the Phase-4 equivalence proof: the JS recompute must reproduce the legacy pipeline
// byte-for-byte (maxΔ 0) under three documented normalizations:
//   • ignore the generated_at / backfilled_at timestamps,
//   • entity/org members[] compared as a set (recompute is id-ascending; legacy used insertion order),
//   • */repo/new.json newcomers canonicalised to (value desc, id asc) (legacy kept repos.json order).
// It reads REAL local files (an integration test); when pipeline/data is absent the whole suite
// is skipped rather than failing.  Run:  bun test lib/integration/recompute.test.ts
import { test, expect, describe } from "bun:test";
import { buildModel } from "../workflows/recompute/model";
import { computeAllViews } from "../workflows/recompute";
import {
  CANON,
  VIEWS,
  LOCAL_DATA_PRESENT,
  loadCanonMeta,
  loadRawShards,
  readView,
  walk,
} from "./local-data";
import { existsSync } from "node:fs";

// ── structural diff (ignores generated_at/backfilled_at; order-insensitive on object keys) ──────
// `inflections` is a v0.2-derived entity field with no DuckDB-precompute counterpart on disk;
// exclude it from byte-parity (the algorithm is covered by inflections.test.ts).
const IGNORE = new Set(["generated_at", "backfilled_at", "inflections"]);
interface Leaf {
  path: string;
  a: unknown;
  b: unknown;
  numeric: boolean;
}
function diff(a: unknown, b: unknown, path: string, out: Leaf[]): void {
  if (a === b) return;
  const ta = Array.isArray(a) ? "array" : a === null ? "null" : typeof a;
  const tb = Array.isArray(b) ? "array" : b === null ? "null" : typeof b;
  if (ta !== tb) {
    out.push({ path, a, b, numeric: false });
    return;
  }
  if (ta === "array") {
    const aa = a as unknown[],
      bb = b as unknown[];
    if (aa.length !== bb.length) {
      out.push({ path: `${path}.length`, a: aa.length, b: bb.length, numeric: false });
      return;
    }
    for (let i = 0; i < aa.length; i++) diff(aa[i], bb[i], `${path}[${i}]`, out);
  } else if (ta === "object") {
    const ao = a as Record<string, unknown>,
      bo = b as Record<string, unknown>;
    const keys = new Set([...Object.keys(ao), ...Object.keys(bo)].filter((k) => !IGNORE.has(k)));
    for (const k of keys) {
      if (!(k in ao) || !(k in bo)) {
        out.push({ path: `${path}.${k}`, a: ao[k], b: bo[k], numeric: false });
        continue;
      }
      diff(ao[k], bo[k], `${path}.${k}`, out);
    }
  } else {
    out.push({ path, a, b, numeric: ta === "number" });
  }
}

// meta.json: compare only seam_date + schema_ver (folded_through + timestamps are Phase-4 additions).
function compareView(rel: string, produced: unknown, disk: unknown): Leaf[] {
  if (rel === "meta.json") {
    const p = produced as Record<string, unknown>,
      d = disk as Record<string, unknown>;
    const out: Leaf[] = [];
    diff(p.seam_date, d.seam_date, "seam_date", out);
    diff(p.schema_ver, d.schema_ver, "schema_ver", out);
    return out;
  }
  // newcomers tie-break: precompute keeps repos.json insertion order for equal current_stars;
  // recompute uses deterministic (value desc, id asc). Canonicalize both, then compare.
  if (rel.endsWith("/repo/new.json")) {
    const norm = (v: unknown) => {
      const o = { ...(v as { items: Array<{ value: number; id: number }> }) };
      o.items = [...o.items].sort((a, b) => b.value - a.value || a.id - b.id).map((it, i) => ({ ...it, rank: i + 1 }));
      return o;
    };
    produced = norm(produced);
    disk = norm(disk);
  }
  // members[] order is intentionally id-ascending now (deterministic); the old run used
  // repos.json insertion order. Compare as a set.
  if (rel.startsWith("entity/org/")) {
    const norm = (v: unknown) => {
      const o = { ...(v as Record<string, unknown>) };
      if (Array.isArray(o.members)) o.members = [...o.members].sort((a, b) => Number(a) - Number(b));
      return o;
    };
    produced = norm(produced);
    disk = norm(disk);
  }
  const out: Leaf[] = [];
  diff(produced, disk, "", out);
  return out;
}

// live-cron artifacts the offline recompute intentionally does not reproduce.
const LIVE_ARTIFACTS = new Set(["hot-snapshot.json", "current_month.json"]);

// v0.2 views recompute derives but the DuckDB bootstrap never exported, so there is no disk
// reference to diff against. Correctness is covered by entities.test.ts / search/core.test.ts.
const NO_DISK_REF = new Set(["search/index.json"]);

interface ParityResult {
  viewCount: number;
  diskCount: number;
  exact: number;
  rounding: number;
  mismatch: number;
  missingOnDisk: number;
  notProduced: number;
  maxDelta: number;
  maxDeltaWhere: string;
  mismatchSamples: string[];
  notProducedSamples: string[];
}

/** Recompute every view and diff vs disk — the body of the old parity-recompute.ts main(). */
function runParity(): ParityResult {
  const canonMeta = loadCanonMeta();
  const raw = loadRawShards();
  const model = buildModel(raw, canonMeta.seam_date);
  const { views } = computeAllViews(model, {
    gen: "PARITY",
    seamDate: canonMeta.seam_date,
    foldedThrough: canonMeta.folded_through,
  });

  let exact = 0,
    rounding = 0,
    mismatch = 0,
    missingOnDisk = 0,
    maxDelta = 0;
  let maxDeltaWhere = "";
  const mismatchSamples: string[] = [];

  for (const [rel, produced] of views) {
    if (NO_DISK_REF.has(rel)) continue; // new-in-v0.2 artifact, no bootstrap reference to diff
    if (!existsSync(`${VIEWS}/${rel}`)) {
      missingOnDisk++;
      if (mismatchSamples.length < 12) mismatchSamples.push(`MISSING ON DISK: ${rel}`);
      continue;
    }
    const leaves = compareView(rel, produced, readView(rel));
    if (leaves.length === 0) {
      exact++;
      continue;
    }
    const allNumericTiny = leaves.every((l) => l.numeric && Math.abs(Number(l.a) - Number(l.b)) <= 1);
    for (const l of leaves) {
      if (!l.numeric) continue;
      const d = Math.abs(Number(l.a) - Number(l.b));
      if (d > maxDelta) {
        maxDelta = d;
        maxDeltaWhere = `${rel}${l.path}: ${l.a} vs ${l.b}`;
      }
    }
    if (allNumericTiny) {
      rounding++;
    } else {
      mismatch++;
      if (mismatchSamples.length < 12)
        mismatchSamples.push(
          `${rel}  [${leaves.length} diffs] e.g. ${leaves[0].path}: ${JSON.stringify(leaves[0].a)} vs ${JSON.stringify(leaves[0].b)}`,
        );
    }
  }

  // coverage: disk view files recompute did NOT produce (excluding live-cron artifacts).
  const onDisk = walk(VIEWS).filter((f) => !LIVE_ARTIFACTS.has(f));
  const producedSet = new Set(views.keys());
  const notProduced = onDisk.filter((f) => !producedSet.has(f));

  return {
    viewCount: views.size,
    diskCount: onDisk.length,
    exact,
    rounding,
    mismatch,
    missingOnDisk,
    notProduced: notProduced.length,
    maxDelta,
    maxDeltaWhere,
    mismatchSamples,
    notProducedSamples: notProduced.slice(0, 12),
  };
}

const describeOrSkip = LOCAL_DATA_PRESENT ? describe : describe.skip;
if (!LOCAL_DATA_PRESENT) {
  // eslint-disable-next-line no-console
  console.warn(`[recompute.test] SKIP: local pipeline data not found under ${CANON} — integration parity not run.`);
}

describeOrSkip("recompute parity vs DuckDB precompute (offline gate)", () => {
  // Recompute + diff once; every assertion reads from this single result.
  const r = runParity();

  test("recompute produces the full view matrix (non-trivial count)", () => {
    expect(r.viewCount).toBeGreaterThan(10_000);
  });

  test("every recomputed view exists on disk (no MISSING ON DISK)", () => {
    expect({ missingOnDisk: r.missingOnDisk, samples: r.mismatchSamples.filter((s) => s.startsWith("MISSING")) }).toEqual({
      missingOnDisk: 0,
      samples: [],
    });
  });

  test("no disk view is left un-produced (full coverage, excl. live artifacts)", () => {
    expect({ notProduced: r.notProduced, samples: r.notProducedSamples }).toEqual({ notProduced: 0, samples: [] });
  });

  test("zero structural mismatches across all views", () => {
    expect({ mismatch: r.mismatch, samples: r.mismatchSamples }).toEqual({ mismatch: 0, samples: [] });
  });

  test("byte-exact parity: maxΔ is 0 (no rounding drift either)", () => {
    expect({ maxDelta: r.maxDelta, rounding: r.rounding, where: r.maxDeltaWhere }).toEqual({
      maxDelta: 0,
      rounding: 0,
      where: "",
    });
  });

  test("overall PARITY OK — all disk views accounted for and exact", () => {
    // exact + rounding(=0) + mismatch(=0) + missing(=0) covers exactly the on-disk view set.
    expect(r.exact + r.rounding + r.mismatch + r.missingOnDisk).toBe(r.diskCount);
    expect(r.exact).toBe(r.diskCount);
  });
});
