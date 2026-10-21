import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AGGREGATE_HISTORY_PROVENANCE, StarHistoryProvenance } from "../../lib/contracts/star-history";
import { RepoRecentDailyShard, RepoWeeklyShard } from "../../lib/contracts/canonical";
import { GAP_DAYS, gapSeries } from "../../../pipeline/scripts/star-history-aggregate.mjs";

export const AGGREGATE_MANIFEST_SHA256 = "b9015837a501fa732192f3d43d27114a8f6ef46f627a9c68569d4a0b3fff0f49";
export const digest = (body: string | Uint8Array): string => createHash("sha256").update(body).digest("hex");
export type GapSeries = Array<[string, number]>;
export type MissingRepository = { repo_id: number; name: string; status: string };
export type AggregateBundle = {
  sha256: string;
  daily: Record<string, GapSeries>;
  weekly: Record<string, GapSeries>;
  missing: MissingRepository[];
};

type ExportManifest = {
  version: number;
  provenance: unknown;
  fetch_finished: boolean;
  monthly_files: string[];
  daily_rows: number;
  complete_week_rows: number;
  files: Array<{ path: string; bytes: number; sha256: string; rows: number }>;
  checkpoints: Array<{ repo_id: number; status: string; raw_replay_verified: boolean }>;
  missing: MissingRepository[];
};

/** The original private manifest is read locally only; none of its paths are published. */
export function loadAggregateBundle(root: string, expectedHash = AGGREGATE_MANIFEST_SHA256): AggregateBundle {
  const bytes = readFileSync(join(root, "inputs/manifest.json"));
  if (digest(bytes) !== expectedHash) throw new Error("Aggregate export manifest checksum mismatch");
  const manifest = JSON.parse(bytes.toString("utf8")) as ExportManifest;
  StarHistoryProvenance.parse(manifest.provenance);
  if (manifest.version !== 1 || !manifest.fetch_finished || manifest.monthly_files.length ||
      manifest.checkpoints.length !== 5249 || new Set(manifest.checkpoints.map((repo) => repo.repo_id)).size !== 5249 ||
      manifest.checkpoints.some((repo) => !repo.raw_replay_verified)) throw new Error("Unsealed aggregate export");
  const expectedPaths = new Set(["partial-iso-weeks.json", ...Array.from({ length: 32 }, (_, bucket) => [
    `canonical/v2/repo-recent-daily/${bucket}.json`, `canonical/v2/repo-weekly/${bucket}.json`,
  ]).flat()]);
  const daily: AggregateBundle["daily"] = {};
  const weekly: AggregateBundle["weekly"] = {};
  let partial: Record<string, unknown> = {};
  for (const file of manifest.files) {
    if (!expectedPaths.delete(file.path)) throw new Error("Unexpected or duplicate aggregate file");
    const body = readFileSync(join(root, "inputs", file.path));
    if (body.length !== file.bytes || digest(body) !== file.sha256) throw new Error(`Aggregate input checksum mismatch: ${file.path}`);
    const value: unknown = JSON.parse(body.toString("utf8"));
    if (file.path === "partial-iso-weeks.json") partial = value as Record<string, unknown>;
    else {
      const target = file.path.includes("repo-weekly") ? weekly : daily;
      const parsed = (target === weekly ? RepoWeeklyShard : RepoRecentDailyShard).parse(value);
      const bucket = Number(file.path.match(/\/(\d+)\.json$/)![1]);
      for (const [id, rows] of Object.entries(parsed)) {
        if (!/^\d+$/.test(id) || Number(id) % 32 !== bucket || target[id]) throw new Error("Invalid aggregate bucket membership");
        target[id] = rows;
      }
      if (Object.values(parsed).reduce((n, rows) => n + rows.length, 0) !== file.rows) throw new Error("Aggregate row count mismatch");
    }
  }
  if (expectedPaths.size) throw new Error("Incomplete aggregate file inventory");
  const complete = manifest.checkpoints.filter((repo) => repo.status === "complete").map((repo) => String(repo.repo_id)).sort();
  for (const series of [daily, weekly, partial]) {
    if (JSON.stringify(Object.keys(series).sort()) !== JSON.stringify(complete)) throw new Error("Aggregate repository membership mismatch");
  }
  for (const id of complete) {
    const rows = daily[id]!;
    if (JSON.stringify(rows.map(([day]) => day)) !== JSON.stringify(GAP_DAYS) ||
        rows.some(([, count]) => !Number.isSafeInteger(count) || count < 0)) throw new Error("Invalid aggregate daily coverage");
    const recomputed = gapSeries({ status: "complete", daily: Object.fromEntries(rows) });
    if (JSON.stringify(weekly[id]) !== JSON.stringify(recomputed.weekly) ||
        JSON.stringify(partial[id]) !== JSON.stringify(recomputed.partialWeeks)) throw new Error("Aggregate ISO-week arithmetic mismatch");
  }
  if (Object.values(daily).reduce((n, rows) => n + rows.length, 0) !== manifest.daily_rows ||
      Object.values(weekly).reduce((n, rows) => n + rows.length, 0) !== manifest.complete_week_rows) throw new Error("Aggregate export totals mismatch");
  const unavailable = manifest.checkpoints.filter((repo) => repo.status !== "complete").map((repo) => repo.repo_id).sort((a, b) => a - b);
  if (JSON.stringify(manifest.missing.map((repo) => repo.repo_id).sort((a, b) => a - b)) !== JSON.stringify(unavailable)) {
    throw new Error("Aggregate missing repository list mismatch");
  }
  // Use the accepted literal rather than serializing the private source manifest.
  StarHistoryProvenance.parse(AGGREGATE_HISTORY_PROVENANCE);
  return { sha256: expectedHash, daily, weekly, missing: manifest.missing };
}
