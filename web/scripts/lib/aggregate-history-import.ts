import {
  BootstrapPublicationPointer, CanonicalMeta, Meta, OrgEntity, RankList,
  RepoEntity, RepoMonthlyShard, RepoRecentDailyShard, ReposLookup, ReposShard,
  RepoWeeklyShard, ViewsPointer,
} from "../../lib/contracts";
import { AGGREGATE_HISTORY_PROVENANCE } from "../../lib/contracts/star-history";
import type { ObjectStore } from "../../lib/storage/types";
import { createObjectStoreBootstrapAdapter } from "../../lib/storage/bootstrap-adapter";
import { buildModel, type RawShards } from "../../lib/workflows/recompute/model";
import { computeOrgWindow, computeRepoWindow } from "../../lib/workflows/recompute/windows";
import { orgRankMatrix, repoRankMatrix } from "../../lib/workflows/recompute/ranks";
import { withBootstrapPublicationLease } from "../../../pipeline/lib/bootstrap-lease.mjs";
import { assertBootstrapGeneration, commitBootstrapGeneration, stageBootstrapPhase, verifyBootstrapGeneration } from "../../../pipeline/lib/bootstrap-publication.mjs";
import { digest, type AggregateBundle, type GapSeries } from "./aggregate-history-input";

export { PREVIEW_BUCKET } from "../../lib/aggregate-history/policy";
import { PREVIEW_BUCKET } from "../../lib/aggregate-history/policy";
const SOURCE = AGGREGATE_HISTORY_PROVENANCE;
const START = SOURCE.start;
const END = SOURCE.end_inclusive;
const json = (body: Buffer): unknown => JSON.parse(body.toString("utf8"));
const encoded = (value: unknown): Buffer => Buffer.from(JSON.stringify(value));
const gapDay = (day: string): boolean => day >= START && day <= END;

export type ImportReport = {
  source_manifest_sha256: string;
  generation: string;
  imported: Array<{ repo_id: number; name: string; daily_added: number; weekly_added: number }>;
  skipped: Array<{ repo_id: number; name: string; reason: string }>;
  edge_weeks_skipped: Array<{ repo_id: number; week: string; missing_days: string[] }>;
  counts?: { repositories_imported: number; repositories_skipped: number; daily_added: number; weekly_added: number; edge_weeks_skipped: number };
};

export type AggregateImportResult = { status: string; report?: ImportReport };
export type AggregateImportPublisher = {
  withLease(run: (renew: () => Promise<void>) => Promise<AggregateImportResult>): Promise<AggregateImportResult>;
  stage(generation: string, phase: "canonical" | "base", items: Array<{ path: string; body: Buffer; contentType?: string }>): Promise<void>;
  commit(recoveryGeneration?: string): Promise<void>;
};

export function weekDays(week: string): string[] {
  const jan4 = new Date(Date.UTC(Number(week.slice(0, 4)), 0, 4));
  const monday = jan4.getTime() - ((jan4.getUTCDay() + 6) % 7) * 86_400_000 + (Number(week.slice(-2)) - 1) * 7 * 86_400_000;
  return Array.from({ length: 7 }, (_, day) => new Date(monday + day * 86_400_000).toISOString().slice(0, 10));
}

function sorted(series: Map<string, number>): GapSeries {
  return [...series].sort(([left], [right]) => left.localeCompare(right));
}

/** Fill only unobserved history. Mixed daily sources are conservatively left untouched. */
export function mergeAggregateBucket(
  repos: ReposShard, daily: RepoRecentDailyShard, weekly: RepoWeeklyShard,
  bundle: AggregateBundle, report: ImportReport,
): void {
  for (const [id, incoming] of Object.entries(bundle.daily)) {
    const meta = repos[id];
    if (!meta) continue;
    const days = new Map(daily[id] ?? []);
    if (meta.aggregate_history) {
      if (incoming.some(([day, count]) => days.get(day) !== count)) throw new Error(`Imported history changed for repository ${id}`);
      report.skipped.push({ repo_id: meta.id, name: meta.full_name, reason: "already_imported" });
      continue;
    }
    // The accepted UI provenance marks the entire gap. Do not mislabel an
    // existing observation or mix incompatible metrics inside that interval.
    if ([...days.keys()].some(gapDay)) {
      report.skipped.push({ repo_id: meta.id, name: meta.full_name, reason: "existing_gap_daily_observations" });
      continue;
    }
    for (const [day, count] of incoming) days.set(day, count);
    const weeks = new Map(weekly[id] ?? []);
    const importedWeeks: string[] = [];
    for (const [week, count] of bundle.weekly[id] ?? []) {
      if (!weeks.has(week)) { weeks.set(week, count); importedWeeks.push(week); }
    }
    for (const week of ["2026-W22", "2026-W40"]) {
      if (weeks.has(week)) continue;
      const labels = weekDays(week);
      const missing = labels.filter((day) => !days.has(day));
      if (missing.length) report.edge_weeks_skipped.push({ repo_id: meta.id, week, missing_days: missing });
      else {
        weeks.set(week, labels.reduce((sum, day) => sum + days.get(day)!, 0));
        importedWeeks.push(week);
      }
    }
    daily[id] = sorted(days);
    weekly[id] = sorted(weeks);
    meta.aggregate_history = { provenance: SOURCE, weeks: importedWeeks.sort() };
    report.imported.push({ repo_id: meta.id, name: meta.full_name, daily_added: incoming.length, weekly_added: importedWeeks.length });
  }
}

type Snapshot = { canonical: Map<string, Buffer>; base: Map<string, Buffer>; bootstrap: Buffer | null; managed: Buffer | null };

async function readPrefix(store: ObjectStore, prefix: string, into: Map<string, Buffer>, renew: () => Promise<void>): Promise<void> {
  let cursor: string | undefined;
  const cursors = new Set<string>();
  do {
    await renew();
    const page = await store.list({ prefix, cursor, limit: 1000 });
    for (let offset = 0; offset < page.blobs.length; offset += 8) {
      await Promise.all(page.blobs.slice(offset, offset + 8).map(async (item) => {
        if (!item.pathname.startsWith(prefix)) throw new Error("Object listing escaped the snapshot prefix");
        await renew();
        const value = await store.getBytes!(item.pathname);
        if (!value) throw new Error(`Snapshot object disappeared: ${item.pathname}`);
        into.set(item.pathname.slice(prefix.length), Buffer.from(value.body));
      }));
    }
    if (!page.hasMore) break;
    if (!page.cursor || cursors.has(page.cursor)) throw new Error("Truncated or repeated snapshot listing");
    cursors.add(page.cursor);
    cursor = page.cursor;
  } while (true);
}

async function captureSnapshot(store: ObjectStore, renew: () => Promise<void>): Promise<Snapshot> {
  const adapter = createObjectStoreBootstrapAdapter(store);
  const bootstrap = await adapter.read("bootstrap/latest.json");
  const managed = await adapter.read("views/latest.json");
  const boot = bootstrap ? BootstrapPublicationPointer.parse(json(bootstrap)) : null;
  if (boot && boot.prefix !== `bootstrap/generations/${boot.generation}`) throw new Error("Invalid bootstrap snapshot prefix");
  const view = managed ? ViewsPointer.parse(json(managed)) : null;
  const canonical = new Map<string, Buffer>();
  if (boot) {
    await readPrefix(store, `${boot.prefix}/canonical/v2/`, canonical, renew);
    await readPrefix(store, `bootstrap/overlays/${boot.generation}/canonical/v2/`, canonical, renew);
  } else await readPrefix(store, "canonical/v2/", canonical, renew);
  const base = new Map<string, Buffer>();
  if (boot && (!view || Date.parse(boot.published_at) > Date.parse(view.published_at))) {
    await readPrefix(store, `${boot.prefix}/views/`, base, renew);
  } else if (view) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(view.version)) throw new Error("Invalid managed snapshot prefix");
    await readPrefix(store, `views/${view.version}/`, base, renew);
  } else throw new Error("A published preview snapshot is required before aggregate repair");
  return { canonical, base, bootstrap, managed };
}

function readRequired(map: Map<string, Buffer>, path: string): unknown {
  const body = map.get(path);
  if (!body) throw new Error(`Incomplete preview snapshot: ${path}`);
  return json(body);
}

/** Snapshot repair is deliberately not a bootstrap recompute of monthly history. */
export function repairSnapshot(snapshot: Snapshot, bundle: AggregateBundle, generation: string): ImportReport {
  const canonicalMeta = CanonicalMeta.parse(readRequired(snapshot.canonical, "meta.json"));
  const baseMeta = Meta.parse(readRequired(snapshot.base, "meta.json"));
  const generatedAt = baseMeta.generated_at ?? baseMeta.backfilled_at;
  if (!generatedAt) throw new Error("Preview snapshot has no generation timestamp");
  const lookup = ReposLookup.parse(readRequired(snapshot.base, "lookup/repos.json"));
  const report: ImportReport = { source_manifest_sha256: bundle.sha256, generation, imported: [], skipped: [], edge_weeks_skipped: [] };
  const raw: RawShards = { repos: {}, monthly: {}, weekly: {}, recentDaily: {}, siteDailyByYear: {} };
  for (let bucket = 0; bucket < 32; bucket++) {
    const repoPath = `repos/${bucket}.json`;
    const dailyPath = `repo-recent-daily/${bucket}.json`;
    const weeklyPath = `repo-weekly/${bucket}.json`;
    const monthlyPath = `repo-monthly/${bucket}.json`;
    const repos = ReposShard.parse(readRequired(snapshot.canonical, repoPath));
    const daily = RepoRecentDailyShard.parse(snapshot.canonical.has(dailyPath) ? readRequired(snapshot.canonical, dailyPath) : {});
    const weekly = RepoWeeklyShard.parse(snapshot.canonical.has(weeklyPath) ? readRequired(snapshot.canonical, weeklyPath) : {});
    const monthly = RepoMonthlyShard.parse(snapshot.canonical.has(monthlyPath) ? readRequired(snapshot.canonical, monthlyPath) : {});
    for (const [id, meta] of Object.entries(repos)) {
      if (Number(id) !== meta.id || meta.id % 32 !== bucket) throw new Error("Invalid canonical repository bucket");
      if (!lookup[id]) throw new Error(`Canonical repository ${id} is absent from the published lookup`);
      const entity = RepoEntity.parse(readRequired(snapshot.base, `entity/repo/${id}.json`));
      if (!snapshot.canonical.has(monthlyPath) && entity.curve.monthly.length) {
        throw new Error(`Published monthly history for ${id} has no canonical source; repair it separately`);
      }
      // A published tail is an existing observation too, even if a cold-start
      // canonical shard was never materialized. Preserve it before gap merging.
      const observed = new Map(daily[id] ?? []);
      for (const [day, count] of entity.curve.recent_daily) {
        if (observed.has(day) && observed.get(day) !== count) throw new Error(`Published daily history differs from canonical for ${id}`);
        observed.set(day, count);
      }
      daily[id] = sorted(observed);
    }
    mergeAggregateBucket(repos, daily, weekly, bundle, report);
    Object.assign(raw.repos, repos); Object.assign(raw.weekly, weekly); Object.assign(raw.recentDaily, daily);
    snapshot.canonical.set(repoPath, encoded(repos));
    snapshot.canonical.set(dailyPath, encoded(daily));
    snapshot.canonical.set(weeklyPath, encoded(weekly));
    // A cold start can lack this family. An empty shard asserts no observations,
    // rather than deriving zeros or monthly totals from the aggregate series.
    if (!snapshot.canonical.has(monthlyPath)) snapshot.canonical.set(monthlyPath, encoded(monthly));
  }
  for (const [id, entry] of Object.entries(lookup)) {
    if (!raw.repos[id]) throw new Error(`Published repository ${entry.full_name} is absent from canonical metadata`);
  }
  for (const id of Object.keys(bundle.daily)) {
    if (!raw.repos[id]) report.skipped.push({ repo_id: Number(id), name: "", reason: "not_in_preview_membership" });
  }
  report.skipped.push(...bundle.missing.map((repo) => ({ repo_id: repo.repo_id, name: repo.name, reason: repo.status })));
  for (const id of Object.keys(raw.repos)) {
    if (!bundle.daily[id] && !bundle.missing.some((repo) => repo.repo_id === Number(id))) {
      report.skipped.push({ repo_id: Number(id), name: raw.repos[id]!.full_name, reason: "outside_fixed_source_whitelist" });
    }
  }
  for (const imported of report.imported) {
    const path = `entity/repo/${imported.repo_id}.json`;
    const entity = RepoEntity.parse(readRequired(snapshot.base, path));
    entity.curve.recent_daily = raw.recentDaily[String(imported.repo_id)]!.map(([day, count]) => [day, count]);
    entity.curve.provenance = SOURCE;
    snapshot.base.set(path, encoded(RepoEntity.parse(entity)));
  }
  // Refresh org daily contributions with the same active-member policy used by
  // normal recompute; retain every org's existing monthly curve byte-for-value.
  const affectedOwners = new Set(report.imported.map((repo) => raw.repos[String(repo.repo_id)]!.owner));
  for (const owner of affectedOwners) {
    const path = `entity/org/${owner}.json`;
    if (!snapshot.base.has(path)) continue;
    const entity = OrgEntity.parse(readRequired(snapshot.base, path));
    const days = new Map<string, number>();
    for (const id of entity.members) {
      for (const [day, count] of raw.recentDaily[String(id)] ?? []) days.set(day, (days.get(day) ?? 0) + count);
    }
    entity.curve.recent_daily = sorted(days);
    entity.curve.provenance = SOURCE;
    snapshot.base.set(path, encoded(OrgEntity.parse(entity)));
  }
  const model = buildModel(raw, canonicalMeta.seam_date);
  const window = computeRepoWindow(model, "week");
  const repairedWeeks = new Set(report.imported.flatMap((repo) => raw.repos[String(repo.repo_id)]!.aggregate_history!.weeks));
  for (const views of [repoRankMatrix(window, "week", generatedAt), orgRankMatrix(computeOrgWindow(model, window), "week", generatedAt)]) {
    for (const [path, view] of views) {
      if (repairedWeeks.has(view.meta.period)) snapshot.base.set(path, encoded(RankList.parse(view)));
    }
  }
  report.imported.sort((a, b) => a.repo_id - b.repo_id);
  report.skipped.sort((a, b) => a.repo_id - b.repo_id);
  report.counts = {
    repositories_imported: report.imported.length, repositories_skipped: report.skipped.length,
    daily_added: report.imported.reduce((sum, repo) => sum + repo.daily_added, 0),
    weekly_added: report.imported.reduce((sum, repo) => sum + repo.weekly_added, 0),
    edge_weeks_skipped: report.edge_weeks_skipped.length,
  };
  snapshot.base.set("aggregate-history-import.json", encoded(report));
  return report;
}

async function assertIdle(store: ObjectStore, resumableGeneration?: string): Promise<void> {
  const lease = await store.get("ops/workflows/active.json");
  if (!lease) return;
  const value = JSON.parse(lease.body) as { status: string; expires_at: string; fencing_token: number; run_id?: string };
  if (!["running", "published", "failed"].includes(value.status) || !Number.isFinite(Date.parse(value.expires_at)) || !Number.isInteger(value.fencing_token)) {
    throw new Error("Invalid preview workflow lease");
  }
  if (resumableGeneration && value.run_id === `bootstrap-publish-${resumableGeneration}`) return;
  if (value.status === "running" && Date.parse(value.expires_at) > Date.now()) throw new Error("Preview refresh lease is active; retry after it finishes");
}

export async function importAggregateHistory(options: {
  store: ObjectStore; bundle: AggregateBundle; generation: string; execute: boolean; publisher?: AggregateImportPublisher;
}): Promise<AggregateImportResult> {
  const { store, bundle, generation, execute, publisher } = options;
  assertBootstrapGeneration(generation);
  if (!generation.startsWith("bootstrap-aggregate-")) throw new Error("Use a dedicated bootstrap-aggregate-<id> generation");
  const identity = await store.get("_meta/bucket-identity.json");
  const marker = identity ? JSON.parse(identity.body) as { bucket: string; deploy_env: string } : null;
  if (marker?.bucket !== PREVIEW_BUCKET || marker.deploy_env !== "pre") throw new Error("Aggregate import requires the exact preview bucket identity");
  if (!store.getBytes) throw new Error("Aggregate import requires binary snapshot reads");
  await assertIdle(store, execute && publisher ? generation : undefined);
  const adapter = createObjectStoreBootstrapAdapter(store);
  const current = await adapter.read("bootstrap/latest.json");
  if (current && BootstrapPublicationPointer.parse(json(current)).generation === generation) {
    const pointer = BootstrapPublicationPointer.parse(json(current));
    const verified = await verifyBootstrapGeneration({ generation, store: adapter });
    if (pointer.base_manifest_sha256 !== verified.base.sha256 || pointer.canonical_manifest_sha256 !== verified.canonical.sha256) {
      throw new Error("Published aggregate generation manifest changed");
    }
    const report = json((await adapter.read(`bootstrap/generations/${generation}/views/aggregate-history-import.json`)) ?? Buffer.from("null")) as ImportReport | null;
    if (report?.source_manifest_sha256 !== bundle.sha256) throw new Error("Published aggregate generation uses a different source");
    return { status: "already-published", report };
  }
  const run = async (assertCanCommit?: () => Promise<void>) => {
    if (assertCanCommit) await assertCanCommit();
    let nextRenew = Date.now() + 30_000;
    let pendingRenew: Promise<void> | undefined;
    const renew = async () => {
      if (!assertCanCommit || Date.now() < nextRenew) return;
      pendingRenew ??= assertCanCommit().then(() => { nextRenew = Date.now() + 30_000; }).finally(() => { pendingRenew = undefined; });
      await pendingRenew;
    };
    const snapshot = await captureSnapshot(store, renew);
    // A managed cold start has neither legacy flat views nor historical shard
    // files. Seal its unchanged published base plus explicit empty families as
    // the prior generation, without switching any pointer to it first.
    const recovery = !snapshot.bootstrap ? { base: new Map(snapshot.base), canonical: new Map(snapshot.canonical) } : null;
    if (recovery) {
      for (let bucket = 0; bucket < 32; bucket++) {
        for (const family of ["repo-monthly", "repo-weekly", "repo-recent-daily"]) {
          const path = `${family}/${bucket}.json`;
          if (!recovery.canonical.has(path)) recovery.canonical.set(path, encoded({}));
        }
        const dailyPath = `repo-recent-daily/${bucket}.json`;
        const priorDaily = RepoRecentDailyShard.parse(readRequired(recovery.canonical, dailyPath));
        for (const id of Object.keys(ReposShard.parse(readRequired(recovery.canonical, `repos/${bucket}.json`)))) {
          const entity = RepoEntity.parse(readRequired(recovery.base, `entity/repo/${id}.json`));
          priorDaily[id] = sorted(new Map([...(priorDaily[id] ?? []), ...entity.curve.recent_daily]));
        }
        recovery.canonical.set(dailyPath, encoded(priorDaily));
      }
    }
    const report = repairSnapshot(snapshot, bundle, generation);
    for (const [path, before] of [["bootstrap/latest.json", snapshot.bootstrap], ["views/latest.json", snapshot.managed]] as const) {
      const after = await adapter.read(path);
      if (digest(after ?? "") !== digest(before ?? "")) throw new Error("Preview publication changed while preparing the repair; retry with a new generation");
    }
    if (!execute) { await assertIdle(store); return { status: "dry-run", report }; }
    if (!report.imported.length) return { status: "nothing-to-import", report };
    // Existing helpers seal create-only objects and verify both manifests. The
    // guarded adapter also heartbeats during long staging/readback loops.
    const guarded = {
      ...adapter,
      read: async (path: string) => { await renew(); return adapter.read(path); },
      create: async (path: string, body: Buffer, contentType?: string) => { await renew(); return adapter.create(path, body, contentType); },
    };
    const recoveryGeneration = recovery ? `bootstrap-aggregate-recovery-${digest(generation).slice(0, 16)}` : undefined;
    for (const [target, data] of [...(recovery ? [[recoveryGeneration!, recovery] as const] : []), [generation, snapshot] as const]) {
      for (const [phase, files] of [["canonical", data.canonical], ["base", data.base]] as const) {
        const items = [...files].map(([path, body]) => ({ path: phase === "base" ? `views/${path}` : `canonical/v2/${path}`, body, contentType: "application/json" }));
        if (publisher) await publisher.stage(target, phase, items);
        else await stageBootstrapPhase({ generation: target, phase, items, store: guarded });
      }
    }
    if (publisher) await publisher.commit(recoveryGeneration);
    else await commitBootstrapGeneration({ generation, store: guarded, assertCanCommit, recoveryGeneration });
    return { status: "published", report };
  };
  if (execute && publisher) return publisher.withLease(run);
  return execute ? withBootstrapPublicationLease({ store: adapter, generation, operation: "publish", run }) : run();
}
