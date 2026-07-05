// Shared local-data loader for the integration test suite (lib/integration/*.test.ts).
// These tests read the REAL local pipeline shards (pipeline/data/v2/canonical/v2 + the DuckDB
// view output under pipeline/data/views) and exercise the pure-JS recompute/fold cores against
// them. The path from lib/integration/ up to the repo's pipeline/data is three levels:
//   web/lib/integration/  ->  web/lib/  ->  web/  ->  <repo>/  ->  <repo>/pipeline/data
// resolved off import.meta.url so it works regardless of CWD. When the local data is absent
// (e.g. a clean checkout / CI without the pipeline output), callers should test.skipIf on
// LOCAL_DATA_PRESENT rather than hard-failing.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { RawShards } from "../workflows/recompute/model";

/** Absolute path to <repo>/pipeline/data (resolved from this file, CWD-independent). */
export const DATA_ROOT = fileURLToPath(new URL("../../../pipeline/data", import.meta.url));
export const CANON = `${DATA_ROOT}/v2/canonical/v2`;
export const VIEWS = `${DATA_ROOT}/views`;
export const BUCKETS = 32;

/** A known anchor file every loader depends on; its presence gates the integration tests. */
export const CANON_META = `${CANON}/meta.json`;
export const LOCAL_DATA_PRESENT = existsSync(CANON_META) && existsSync(VIEWS);

const J = (f: string): unknown => JSON.parse(readFileSync(f, "utf8"));

/** Read + JSON.parse a single canonical file (path relative to CANON). */
export function readCanon<T = unknown>(rel: string): T {
  return J(`${CANON}/${rel}`) as T;
}

/** Read + JSON.parse a single view file (path relative to VIEWS). */
export function readView<T = unknown>(rel: string): T {
  return J(`${VIEWS}/${rel}`) as T;
}

export interface CanonMeta {
  seam_date: string;
  schema_ver: number;
  folded_through: { month: string; week: string };
  generated_at: string;
}

export function loadCanonMeta(): CanonMeta {
  return readCanon<CanonMeta>("meta.json");
}

/** Merge the 32 hash buckets of a canonical sub-table into one id→record map. */
export function mergeBuckets<T>(sub: string): Record<string, T> {
  const out: Record<string, T> = {};
  for (let b = 0; b < BUCKETS; b++) Object.assign(out, J(`${CANON}/${sub}/${b}.json`));
  return out;
}

/** Assemble the full RawShards (repos + month/week/recent-daily + per-year site-daily). */
export function loadRawShards(): RawShards {
  const siteDailyByYear: RawShards["siteDailyByYear"] = {};
  for (const f of readdirSync(`${CANON}/site-daily`)) {
    const o = J(`${CANON}/site-daily/${f}`) as RawShards["siteDailyByYear"][string];
    siteDailyByYear[o.year] = o;
  }
  return {
    repos: mergeBuckets("repos"),
    monthly: mergeBuckets("repo-monthly"),
    weekly: mergeBuckets("repo-weekly"),
    recentDaily: mergeBuckets("repo-recent-daily"),
    siteDailyByYear,
  };
}

/** Recursively list every file under a dir, as "/"-joined paths relative to it. */
export function walk(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${name.name}` : name.name;
    if (name.isDirectory()) out.push(...walk(`${dir}/${name.name}`, rel));
    else out.push(rel);
  }
  return out;
}
