import { beforeAll, describe, expect, test } from "bun:test";
import { BootstrapPublicationPointer, CanonicalMeta, ViewsPointer, WorkflowManifest, WorkflowValidation } from "@/lib/contracts";
import { PREVIEW_BUCKET } from "@/lib/aggregate-history/policy";
import { importAggregateHistory } from "../../../scripts/lib/aggregate-history-import";
import type { AggregateBundle } from "../../../scripts/lib/aggregate-history-input";
import { GAP_DAYS, gapSeries } from "../../../../pipeline/scripts/star-history-aggregate.mjs";
import { REPO_BUCKETS, repoBucket } from "../buckets";
import { PREFLIGHT_BUCKETS_PER_JOB } from "../steps/preflight";
import { nextRefreshJob } from "./graph";
import { firstRefreshJob, FULL_REFRESH_STEPS } from "./types";
import { installWorkflowHarness, TEST_NOW, TEST_RUN, workflowSeed, type FullJob } from "../test-support";

const IMPORT_GENERATION = "bootstrap-aggregate-history-free";
const STEADY_RUN = "refresh-2026-10-25-steady";
const MARKED_RUN = "refresh-2026-10-25-marked";
const AVAILABLE_RUN = "refresh-2026-10-25-available";
const STRICT_RUN = "refresh-2026-10-25-strict";
const FOLD_RUN = "refresh-2026-11-02-fold";
const FOLD_NOW = "2026-11-02T00:00:00.000Z";
const CLOSED_MONTH = "2026-10";
const FOLDED_FLOW = 7;
const PRIOR_YEAR = String(new Date(TEST_NOW).getUTCFullYear() - 1);
const OBSERVED_MONTH = `${PRIOR_YEAR}-12`;
const OBSERVED_FLOW = 100;
const OBSERVED_SITE_DAY = `${PRIOR_YEAR}-12-31`;
const OBSERVED_SITE_TOTAL = 100000;
const HISTORY_MARKER = {
  seed_date: "2026-10-02",
  monthly: "unavailable",
  prior_year_heatmap: "unavailable",
  set_at: "2026-10-25T09:00:00.000Z",
} as const;

/** Cold-start universe: no canonical series, meta, pointer, or prior managed views. */
function coldStartSeed(): Record<string, string> {
  const dropped = /^(canonical\/v2\/(repo-monthly|repo-weekly|repo-recent-daily|pending|site-daily|repos)\/|canonical\/v2\/meta\.json$|canonical\/v2\/whitelist\/refresh-|views\/(latest\.json$|refresh-2025))/;
  return Object.fromEntries(Object.entries(workflowSeed()).filter(([path]) => !dropped.test(path)));
}

function aggregateBundle(): AggregateBundle {
  const daily = Object.fromEntries([1, 2].map((id) => [String(id), GAP_DAYS.map((day: string): [string, number] => [day, id])]));
  return {
    sha256: "a".repeat(64),
    daily,
    weekly: Object.fromEntries(Object.entries(daily).map(([id, rows]) => [id, gapSeries({ status: "complete", daily: Object.fromEntries(rows) }).weekly.map((row): [string, number] => [String(row[0]), Number(row[1])])])),
    missing: [{ repo_id: 6, name: "missing/repo", status: "not_found_or_inaccessible" }],
  };
}

function readyForRefresh(contents: Record<string, string>): Record<string, string> {
  return {
    ...contents,
    // The published run owns the unpublished pointer. Point it back at discovery
    // so the next refresh reuses that snapshot instead of calling GitHub Search.
    "ops/workflows/latest-unpublished-whitelist.json": JSON.stringify({
      run_id: "discovery",
      count: 1000,
      recorded_at: TEST_NOW,
    }),
  };
}

function withMarker(contents: Record<string, string>, generation: string): Record<string, string> {
  return {
    ...readyForRefresh(contents),
    [`bootstrap/overlays/${generation}/canonical/v2/history-availability.json`]: JSON.stringify(HISTORY_MARKER),
  };
}

function withoutMarker(contents: Record<string, string>, generation: string): Record<string, string> {
  const next = { ...contents };
  delete next[`bootstrap/overlays/${generation}/canonical/v2/history-availability.json`];
  delete next[`bootstrap/generations/${generation}/canonical/v2/history-availability.json`];
  return next;
}

function publishedTopRepoId(contents: Record<string, string>): number {
  const version = ViewsPointer.parse(JSON.parse(contents["views/latest.json"]!)).version;
  const rank = JSON.parse(contents[`views/${version}/rank/all-time/repo/stock.json`]!) as { items: Array<{ id?: number }> };
  const id = rank.items[0]?.id;
  if (id == null) throw new Error("published all-time rank has no repository");
  return id;
}

/** Observed monthly point and prior-year site total. Recompute turns the site total into the heatmap publication checks. */
function supplyObservedHistory(contents: Record<string, string>, generation: string, repoId: number): void {
  const bucket = repoBucket(repoId);
  const shard = monthlyShard(contents, generation, bucket);
  shard[String(repoId)] = [[OBSERVED_MONTH, OBSERVED_FLOW]];
  contents[`bootstrap/overlays/${generation}/canonical/v2/repo-monthly/${bucket}.json`] = JSON.stringify(shard);
  contents[`bootstrap/overlays/${generation}/canonical/v2/site-daily/${PRIOR_YEAR}.json`] = JSON.stringify({
    year: PRIOR_YEAR,
    cells: [[OBSERVED_SITE_DAY, OBSERVED_SITE_TOTAL]],
  });
}

function canonicalBody(contents: Record<string, string>, generation: string, path: string): unknown {
  const overlay = `bootstrap/overlays/${generation}/${path}`;
  const sealed = `bootstrap/generations/${generation}/${path}`;
  const body = contents[overlay] ?? contents[sealed];
  if (body === undefined) throw new Error(`missing canonical object ${path}`);
  return JSON.parse(body);
}

function monthlyShard(contents: Record<string, string>, generation: string, bucket: number): Record<string, unknown> {
  return canonicalBody(contents, generation, `canonical/v2/repo-monthly/${bucket}.json`) as Record<string, unknown>;
}

async function drainRefresh(contents: Record<string, string>, runId: string, now?: string) {
  delete process.env.WORKFLOW_COLD_START;
  delete process.env.PREFLIGHT_RELAX_EMPTY_SHARDS;
  const harness = installWorkflowHarness(contents, {}, { now });
  const steps: string[] = [];
  try {
    let job = firstRefreshJob(runId) as FullJob | null;
    for (let hops = 0; job && hops < 800; hops++) {
      const { response, result } = await harness.run(job);
      if (!response.ok || !result) {
        const body = await response.clone().json().catch(() => null);
        return { harness, steps, failedStep: job.name, status: response.status, body, remaining: job };
      }
      steps.push(job.name);
      job = nextRefreshJob(job, result) as FullJob | null;
    }
    return { harness, steps, failedStep: job?.name ?? null, status: job ? 0 : 200, body: null, remaining: job };
  } catch (error) {
    harness.restore();
    throw error;
  }
}

let seeded: Record<string, string>;
let generation = "";

describe("history-free preview steady state", () => {
  beforeAll(async () => {
    const harness = installWorkflowHarness(coldStartSeed(), { WORKFLOW_COLD_START: "1", PREFLIGHT_RELAX_EMPTY_SHARDS: "1" });
    try {
      let job = firstRefreshJob(TEST_RUN) as FullJob | null;
      for (let hops = 0; job && hops < 800; hops++) {
        const { response, result } = await harness.run(job);
        if (!response.ok || !result) throw new Error(`cold start stopped at ${job.name} (${response.status})`);
        job = nextRefreshJob(job, result) as FullJob | null;
      }
      if (job) throw new Error(`cold start did not finish at ${job.name}`);
      await harness.store.set("_meta/bucket-identity.json", { bucket: PREVIEW_BUCKET, deploy_env: "pre" });
    } finally {
      harness.restore();
    }
    const imported = await importAggregateHistory({
      store: harness.store,
      bundle: aggregateBundle(),
      generation: IMPORT_GENERATION,
      execute: true,
    });
    if (imported.status !== "published") throw new Error(`aggregate import status ${imported.status}`);
    seeded = { ...harness.store.contents };
    generation = BootstrapPublicationPointer.parse(JSON.parse(seeded["bootstrap/latest.json"]!)).generation;
  }, 300_000);

  test("aggregate import keeps every monthly shard empty", () => {
    expect(generation).toBe(IMPORT_GENERATION);
    for (let bucket = 0; bucket < REPO_BUCKETS; bucket++) {
      expect(monthlyShard(seeded, generation, bucket)).toEqual({});
    }
    const weekly = canonicalBody(seeded, generation, "canonical/v2/repo-weekly/1.json") as Record<string, unknown[]>;
    const daily = canonicalBody(seeded, generation, "canonical/v2/repo-recent-daily/1.json") as Record<string, unknown[]>;
    expect(weekly["1"]!.length).toBeGreaterThan(0);
    expect(daily["1"]!.length).toBeGreaterThan(0);
    expect(daily["2"]).toBeUndefined();
  });

  test("a second managed refresh publishes after the flags are removed and the marker is set", async () => {
    const run = await drainRefresh(withMarker(seeded, generation), STEADY_RUN);
    try {
      expect(run.failedStep).toBeNull();
      expect(run.remaining).toBeNull();
      expect([...new Set(run.steps)]).toEqual([...FULL_REFRESH_STEPS]);
      expect(ViewsPointer.parse(run.harness.store.json("views/latest.json"))).toMatchObject({
        version: STEADY_RUN,
        run_id: STEADY_RUN,
        prev_version: TEST_RUN,
      });
      expect(WorkflowManifest.parse(run.harness.store.json(`ops/workflows/${STEADY_RUN}/manifest.json`))).toMatchObject({
        status: "published",
        published_version: STEADY_RUN,
      });
      expect(WorkflowValidation.parse(run.harness.store.json(`ops/workflows/${STEADY_RUN}/validation.json`))).toMatchObject({
        ok: true,
        failures: [],
        invariants: {
          cold_start_empty_curve_relaxed: false,
          cold_start_missing_prior_year_heatmap_relaxed: false,
          history_unavailable_empty_curve_relaxed: true,
          history_unavailable_missing_prior_year_heatmap_relaxed: true,
        },
      });
      for (let bucket = 0; bucket < REPO_BUCKETS; bucket++) {
        expect(monthlyShard(run.harness.store.contents, generation, bucket)).toEqual({});
      }
    } finally {
      run.harness.restore();
    }
  }, 300_000);

  test("removing the marker returns the strict monthly failure", async () => {
    const before = JSON.parse(seeded["views/latest.json"]!);
    const run = await drainRefresh(readyForRefresh(seeded), STRICT_RUN);
    try {
      expect(run.failedStep).toBe("preflight");
      expect(run.status).toBe(500);
      // Earlier windows only count shards. The empty-family rejection is the final window, before any mutation step.
      const successfulWindows = Math.ceil(REPO_BUCKETS / PREFLIGHT_BUCKETS_PER_JOB) - 1;
      expect(run.steps).toEqual(["startRun", ...Array.from({ length: successfulWindows }, () => "preflight")]);
      const error = run.harness.store.json<{ error: string }>(`ops/workflows/${STRICT_RUN}/error.json`);
      expect(error.error).toContain("canonical/v2/repo-monthly: no repository records for 1000 canonical repo(s)");
      expect(WorkflowManifest.parse(run.harness.store.json(`ops/workflows/${STRICT_RUN}/manifest.json`)).status).toBe("failed");
      expect(JSON.parse(run.harness.store.contents["views/latest.json"]!)).toEqual(before);
      for (let bucket = 0; bucket < REPO_BUCKETS; bucket++) {
        expect(monthlyShard(run.harness.store.contents, generation, bucket)).toEqual({});
      }
    } finally {
      run.harness.restore();
    }
  }, 120_000);

  test("history becomes available and the next refresh publishes with every exception indicator false", async () => {
    const marked = await drainRefresh(withMarker(seeded, generation), MARKED_RUN);
    let available: Awaited<ReturnType<typeof drainRefresh>> | undefined;
    let releasedMarked = false;
    try {
      expect({ failedStep: marked.failedStep, status: marked.status, body: marked.body }).toEqual({
        failedStep: null,
        status: 200,
        body: null,
      });
      const published = { ...marked.harness.store.contents };
      expect(canonicalBody(published, generation, "canonical/v2/history-availability.json")).toEqual(HISTORY_MARKER);
      const topId = publishedTopRepoId(published);
      supplyObservedHistory(published, generation, topId);
      const contents = readyForRefresh(withoutMarker(published, generation));
      expect(contents[`bootstrap/overlays/${generation}/canonical/v2/history-availability.json`]).toBeUndefined();
      expect(contents[`bootstrap/generations/${generation}/canonical/v2/history-availability.json`]).toBeUndefined();
      marked.harness.restore();
      releasedMarked = true;
      available = await drainRefresh(contents, AVAILABLE_RUN);
      expect({
        failedStep: available.failedStep,
        status: available.status,
        body: available.body,
        remaining: available.remaining?.name ?? null,
      }).toEqual({ failedStep: null, status: 200, body: null, remaining: null });
      expect([...new Set(available.steps)]).toEqual([...FULL_REFRESH_STEPS]);
      expect(ViewsPointer.parse(available.harness.store.json("views/latest.json"))).toMatchObject({
        version: AVAILABLE_RUN,
        run_id: AVAILABLE_RUN,
        prev_version: MARKED_RUN,
      });
      expect(WorkflowManifest.parse(available.harness.store.json(`ops/workflows/${AVAILABLE_RUN}/manifest.json`))).toMatchObject({
        status: "published",
        published_version: AVAILABLE_RUN,
      });
      const validation = WorkflowValidation.parse(available.harness.store.json(`ops/workflows/${AVAILABLE_RUN}/validation.json`));
      expect(validation).toMatchObject({
        ok: true,
        failures: [],
        invariants: {
          cold_start_empty_curve_relaxed: false,
          cold_start_missing_prior_year_heatmap_relaxed: false,
          history_unavailable_empty_curve_relaxed: false,
          history_unavailable_missing_prior_year_heatmap_relaxed: false,
        },
      });
      expect(validation.invariants.sample_curve_months).toBeGreaterThan(0);
      const heatmap = available.harness.store.json<{ cells: unknown[] }>(`views/${AVAILABLE_RUN}/heatmap/year/${PRIOR_YEAR}.json`);
      expect(heatmap.cells.length).toBeGreaterThan(0);
      expect(monthlyShard(available.harness.store.contents, generation, repoBucket(topId))[String(topId)]).toEqual([
        [OBSERVED_MONTH, OBSERVED_FLOW],
      ]);
      expect(available.harness.store.contents[`bootstrap/overlays/${generation}/canonical/v2/history-availability.json`]).toBeUndefined();
      expect(available.harness.store.contents[`bootstrap/generations/${generation}/canonical/v2/history-availability.json`]).toBeUndefined();
    } finally {
      if (!releasedMarked) marked.harness.restore();
      available?.harness.restore();
    }
  }, 600_000);

  test("a closed month still folds from its pending snapshot while the marker is set", async () => {
    const pending = {
      period: CLOSED_MONTH,
      frozen_at: "2026-11-01T00:00:00.000Z",
      daily_totals: [["2026-10-05", 3], ["2026-10-06", 4]],
      per_repo: { "1": [["2026-10-05", 3], ["2026-10-06", 4]] },
    };
    const contents = withMarker(seeded, generation);
    contents[`bootstrap/overlays/${generation}/canonical/v2/pending/${CLOSED_MONTH}.json`] = JSON.stringify(pending);
    const run = await drainRefresh(contents, FOLD_RUN, FOLD_NOW);
    try {
      expect(run.failedStep).toBeNull();
      expect(run.remaining).toBeNull();
      expect(monthlyShard(run.harness.store.contents, generation, repoBucket(1))).toEqual({ "1": [[CLOSED_MONTH, FOLDED_FLOW]] });
      for (let bucket = 0; bucket < REPO_BUCKETS; bucket++) {
        if (bucket === repoBucket(1)) continue;
        expect(monthlyShard(run.harness.store.contents, generation, bucket)).toEqual({});
      }
      expect(CanonicalMeta.parse(canonicalBody(run.harness.store.contents, generation, "canonical/v2/meta.json"))).toMatchObject({
        folded_through: { month: CLOSED_MONTH },
      });
      expect(canonicalBody(run.harness.store.contents, generation, "canonical/v2/history-availability.json")).toEqual(HISTORY_MARKER);
      expect(WorkflowValidation.parse(run.harness.store.json(`ops/workflows/${FOLD_RUN}/validation.json`))).toMatchObject({
        ok: true,
        invariants: { history_unavailable_empty_curve_relaxed: true },
      });
      expect(ViewsPointer.parse(run.harness.store.json("views/latest.json")).version).toBe(FOLD_RUN);
    } finally {
      run.harness.restore();
    }
  }, 300_000);
});
