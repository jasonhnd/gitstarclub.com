import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { parseBootstrapPhaseManifest } from "../../pipeline/lib/bootstrap-publication.mjs";
import { importDigest } from "../lib/aggregate-history/protocol";
import { AggregateHistoryWorkerClient } from "./lib/aggregate-history-worker-client";
import { loadAggregateBundle, type AggregateBundle } from "./lib/aggregate-history-input";
import type { ImportReport } from "./lib/aggregate-history-import";
import { BootstrapPublicationPointer, ReposLookup, RepoEntity, RepoWeeklyShard, ReposShard } from "../lib/contracts";
import { AGGREGATE_HISTORY_PROVENANCE } from "../lib/contracts/star-history";

/** Origin reads and ordinary preview page GETs only. Never acquires a writer lease. */
export async function verifyPreviewAggregate(source: string, secretFile: string, generation: string, options: { client?: AggregateHistoryWorkerClient; bundle?: AggregateBundle; fetchImpl?: typeof fetch } = {}) {
  const bundle = options.bundle ?? loadAggregateBundle(source);
  const client = options.client ?? new AggregateHistoryWorkerClient({ origin: "https://pre.gitstarclub.com", generation, secret: readFileSync(secretFile, "utf8").trim() });
  const read = async (path: string): Promise<unknown> => {
    const value = await client.store.get(path);
    assert(value, `Missing preview artifact: ${path}`);
    return JSON.parse(value.body);
  };
  const pointer = BootstrapPublicationPointer.parse(await read("bootstrap/latest.json"));
  assert.equal(pointer.generation, generation, "Expected import must still be current");
  assert(pointer.previous_generation, "A sealed recovery generation is required");
  const previous = `bootstrap/generations/${pointer.previous_generation}`;
  for (const target of [generation, pointer.previous_generation]) {
    for (const phase of ["base", "canonical"] as const) {
      const path = `bootstrap/generations/${target}/manifests/${phase}.json`;
      const value = await client.store.getBytes!(path);
      assert(value, `Missing sealed manifest: ${path}`);
      parseBootstrapPhaseManifest(Buffer.from(value.body), target, phase);
      if (target === generation) assert.equal(importDigest(value.body), phase === "base" ? pointer.base_manifest_sha256 : pointer.canonical_manifest_sha256);
    }
  }
  const report = await read(`${pointer.prefix}/views/aggregate-history-import.json`) as ImportReport;
  assert.equal(report.source_manifest_sha256, bundle.sha256);
  assert.equal(report.generation, generation);
  assert(report.counts && report.imported.length === report.counts.repositories_imported);
  const lookup = ReposLookup.parse(await read(`${pointer.prefix}/views/lookup/repos.json`));
  const react = report.imported.find((repo) => repo.repo_id === 10270250 || repo.name.toLowerCase().endsWith("/react"));
  assert(react, "React must be imported; investigate a skip before selecting another sample");
  const small = report.imported.filter((repo) => repo.repo_id !== react.repo_id).sort((a, b) => lookup[String(a.repo_id)]!.current_stars - lookup[String(b.repo_id)]!.current_stars).slice(0, 2);
  assert.equal(small.length, 2);
  const samples = [];
  for (const entry of [react, ...small]) {
    const id = String(entry.repo_id);
    const path = `views/entity/repo/${id}.json`;
    const entity = RepoEntity.parse(await read(`${pointer.prefix}/${path}`));
    const prior = RepoEntity.parse(await read(`${previous}/${path}`));
    assert.equal(entity.current_stars, prior.current_stars);
    assert(entity.current_stars > 0);
    assert.deepEqual(entity.curve.monthly, prior.curve.monthly);
    assert.deepEqual(entity.monthly_table, prior.monthly_table);
    assert.deepEqual(entity.curve.provenance, AGGREGATE_HISTORY_PROVENANCE);
    const daily = new Map(entity.curve.recent_daily);
    assert.deepEqual(bundle.daily[id]!.map(([day]) => [day, daily.get(day)]), bundle.daily[id]);
    const bucket = entry.repo_id % 32;
    const repos = ReposShard.parse(await read(`${pointer.prefix}/canonical/v2/repos/${bucket}.json`));
    const weeks = RepoWeeklyShard.parse(await read(`${pointer.prefix}/canonical/v2/repo-weekly/${bucket}.json`));
    const observed = new Map(weeks[id]);
    const priorRepos = ReposShard.parse(await read(`${previous}/canonical/v2/repos/${bucket}.json`));
    const priorWeeks = RepoWeeklyShard.parse(await read(`${previous}/canonical/v2/repo-weekly/${bucket}.json`));
    assert.equal(repos[id]!.d, priorRepos[id]!.d);
    for (const [week, count] of priorWeeks[id] ?? []) assert.equal(observed.get(week), count);
    const importedWeeks = repos[id]!.aggregate_history!.weeks;
    for (const [week, count] of bundle.weekly[id]!) if (importedWeeks.includes(week)) assert.equal(observed.get(week), count);
    const monthlySums: Record<string, number> = {};
    for (const [day, count] of bundle.daily[id]!) monthlySums[day.slice(0, 7)] = (monthlySums[day.slice(0, 7)] ?? 0) + count;
    const pages = [];
    for (const locale of ["en", "ja"]) {
      const url = `https://pre.gitstarclub.com/${locale === "en" ? "" : "ja/"}${entity.full_name}`;
      const response = await (options.fetchImpl ?? fetch)(url, { redirect: "error" });
      assert.equal(response.status, 200, url);
      const html = await response.text();
      assert(html.includes(`lang="${locale}"`), url);
      assert(/name="robots"[^>]*noindex/.test(html), url);
      pages.push({ url, status: response.status, bytes: Buffer.byteLength(html) });
    }
    samples.push({ repo_id: entry.repo_id, name: entity.full_name, daily_observations: bundle.daily[id]!.length, verified_complete_weeks: importedWeeks.filter((week) => bundle.weekly[id]!.some(([label]) => label === week)).length, aggregate_daily_sums: monthlySums, current_stars: entity.current_stars, monthly_history_preserved: true, pages });
  }
  for (const missing of bundle.missing) assert(report.skipped.some((repo) => repo.repo_id === missing.repo_id && repo.reason === missing.status));
  const lease = await client.store.get("ops/workflows/active.json");
  assert(lease && JSON.parse(lease.body).status === "published", "Import lease must be released");
  return { pointer, counts: report.counts, samples, skipped: report.skipped, unavailable: bundle.missing };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [source, secretFile, generation] = process.argv.slice(2);
  if (!source || !secretFile || !generation) throw new Error("Usage: verify-preview-aggregate.ts SOURCE SECRET_FILE GENERATION");
  console.log(JSON.stringify(await verifyPreviewAggregate(source, secretFile, generation), null, 2));
}
