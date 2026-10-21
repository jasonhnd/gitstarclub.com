import { beforeAll, describe, expect, spyOn, test } from "bun:test";
import * as github from "@/lib/github";
import * as source from "@/lib/data/source";
import * as indexnow from "@/lib/indexnow";
import { buildIndexNowPayloads, workflowPublishCanonicalPaths } from "@/lib/indexnow";
import { WorkflowLease, WorkflowManifest, WorkflowValidation, type WhitelistSnapshot } from "@/lib/contracts";
import { successorJobAfterRefreshStep, successorJobFromResponseHeaders } from "@/lib/workers-host/queue-advance";
import { repoBucket, REPO_BUCKETS } from "../buckets";
import { startRefreshWorkflowRoute } from "../start";
import { validateVersion } from "../steps/validate";
import { runPublishStep } from "../steps/publish";
import { installWorkflowHarness, SUBREQUEST_LIMIT_ERROR, TEST_NOW, TEST_RUN, workflowSeed, type FullJob } from "../test-support";
import { nextRefreshJob } from "./graph";
import { firstRefreshJob } from "./types";
import { withStepRetry } from "./retry";

const REPOS = 5669;
const path = (rel: string) => `ops/workflows/${TEST_RUN}/${rel}`;
type Boundary = { job: FullJob; artifacts: Record<string, string> };
let validation: Boundary;
let afterMetadata: Record<string, string>;
let publication: Boundary;
const counts = new Map<string, { hops: number; max: number; operations: Record<string, number> }>();
const publishCounts: Array<{ page: number; total: number; entityReads: number; operations: Record<string, number> }> = [];

/** Completed real-format metadata avoids unrelated GitHub pacing in the budget test. */
function completedMetadataSeed(): Record<string, string> {
  const seed = workflowSeed(REPOS, REPOS);
  const snapshot = JSON.parse(seed["canonical/v2/whitelist/discovery.json"]!) as WhitelistSnapshot;
  seed[`canonical/v2/whitelist/${TEST_RUN}.json`] = JSON.stringify({ ...snapshot, run_id: TEST_RUN });
  seed["ops/workflows/latest-unpublished-whitelist.json"] = JSON.stringify({ run_id: TEST_RUN, count: REPOS, recorded_at: TEST_NOW });
  for (let bucket = 0; bucket < REPO_BUCKETS; bucket++) {
    const fetched = Object.fromEntries(snapshot.entries.filter((row) => repoBucket(row.id) === bucket).map((row) => [String(row.id), {
      owner: row.owner, owner_type: "Organization", name: row.name, full_name: row.full_name,
      current_stars: row.stars, description: null, language: "TypeScript", languages: [], topics: [], created_at: "2025-01-01", is_archived: false,
    }]));
    seed[path(`metadata-${bucket}.json`)] = JSON.stringify({ v: 1, bucket, fetched, skipped: [], pending_pages: [], transient_attempts: 0, last_error: null });
  }
  // A large orphan version forces GC to yield rather than draining every batch.
  for (let id = 0; id < REPOS; id++) seed[`views/refresh-2026-08-01/entity/repo/${id}.json`] = "{}";
  return seed;
}

async function exhaust(h: ReturnType<typeof installWorkflowHarness>, job: FullJob, recording = false) {
  const limit = recording ? 1 : 8;
  const output = await h.run(job, {
    subrequestLimit: limit, queueConsumer: true,
    executeFull: async () => {
      if (recording) throw new Error("original deterministic failure");
      for (let i = 0; i < limit + 1; i++) await h.store.get("missing.json");
      throw new Error("unreachable");
    },
  });
  expect(output.response.status).toBe(200);
  expect(output.result?.deferredFailure).toBeDefined();
  const next = await successorJobAfterRefreshStep(job, output.response.clone()) as FullJob;
  expect(next).toEqual(successorJobFromResponseHeaders(output.response.headers) as FullJob);
  expect(next.cursor.failure?.message).toContain(recording ? "original deterministic failure" : SUBREQUEST_LIMIT_ERROR);
  expect(h.store.contents[path("error.json")]).toBeUndefined();
  expect(h.store.json(path("manifest.json"))).toMatchObject({ status: "running" });
  return next;
}

describe("refresh subrequest budget at 5,669 repositories and owners", () => {
  beforeAll(async () => {
    const h = installWorkflowHarness(completedMetadataSeed(), { INDEXNOW_ENABLED: "1" });
    try {
      let job = firstRefreshJob(TEST_RUN) as FullJob | null;
      for (let hop = 0; job && hop < 1000; hop++) {
        if (job.name === "fold" && !afterMetadata) afterMetadata = { ...h.store.contents };
        if (job.name === "validate" && !validation) validation = { job: structuredClone(job), artifacts: { ...h.store.contents } };
        if (job.name === "publish" && !publication) publication = { job: structuredClone(job), artifacts: { ...h.store.contents } };
        const readsBefore = h.store.reads.length;
        const { response, result } = await h.run(job, { subrequestLimit: 1000, queueConsumer: true });
        expect(response.status, `${job.name}@${job.cursor.workOffset ?? 0}`).toBe(200);
        expect(result?.deferredFailure).toBeUndefined();
        // Parent queue consumer: one service fetch and one JOBS.send. Its
        // budget is separate, but include both as conservative overhead here.
        const total = h.store.subrequests.total + 2;
        expect(total, `${job.name}@${job.cursor.recomputePhase ?? job.cursor.workOffset ?? 0}`).toBeLessThan(600);
        if (job.name === "publish") publishCounts.push({
          page: job.cursor.workOffset ?? 0, total,
          entityReads: h.store.reads.slice(readsBefore).filter((rel) => rel.includes("/entity/")).length,
          operations: { ...h.store.subrequests.counts, fetchStep: 1, queueSend: 1 },
        });
        const summary = counts.get(job.name) ?? { hops: 0, max: 0, operations: {} };
        summary.hops++;
        if (total > summary.max) {
          summary.max = total;
          summary.operations = { ...h.store.subrequests.counts, fetchStep: 1, queueSend: 1 };
        }
        counts.set(job.name, summary);
        const next = await successorJobAfterRefreshStep(job, response.clone());
        expect(next).toEqual(nextRefreshJob(job, result!));
        job = next as FullJob | null;
      }
      expect(job).toBeNull();
      expect(WorkflowValidation.parse(h.store.json(path("validation.json")))).toMatchObject({ ok: true, failures: [], invariants: { entity_repos_checked: REPOS, entity_orgs_checked: REPOS, period_rank_files_checked: 88 } });
      expect(WorkflowManifest.parse(h.store.json(path("manifest.json")))).toMatchObject({ status: "published" });
      expect(WorkflowLease.parse(h.store.json("ops/workflows/active.json")).status).toBe("published");
      expect(h.store.deletions.filter((p) => p.startsWith("views/refresh-2026-08-01/"))).toHaveLength(REPOS);
      expect(h.indexNowSubmissions).toHaveLength(2);
    } finally {
      h.restore();
    }
  }, 120000);

  test("all growing steps span multiple invocations", () => {
    for (const step of ["fold", "recomputeRank", "recomputeRepoEntities", "recomputeOrgEntities", "validate", "gc"]) {
      expect(counts.get(step)!.hops, step).toBeGreaterThan(1);
    }
  });

  test("publish leaves transport headroom, including both IndexNow POSTs", () => {
    expect(counts.get("publish")!.hops).toBe(3);
    expect(counts.get("publish")!.max).toBeLessThan(500);
    expect(publishCounts.map(({ page, total, entityReads }) => ({ page, total, entityReads }))).toEqual([
      { page: 0, total: 23, entityReads: 0 },
      { page: 1, total: 452, entityReads: 400 },
      { page: 2, total: 455, entityReads: 400 },
    ]);
    expect(publishCounts[0]!.operations.fetchInvalidation).toBe(1);
    expect(publishCounts[2]!.operations.fetchIndexNow).toBe(2);
  });

  test("publish pages reproduce the original notification candidates and replay without side effects", async () => {
    const h = installWorkflowHarness(publication.artifacts, { INDEXNOW_ENABLED: "1" });
    try {
      let job = publication.job;
      const pointerBefore = h.store.contents["views/latest.json"];
      let committed: string | undefined;
      for (let page = 0; page < 3; page++) {
        const first = await h.run(job, { subrequestLimit: 500 });
        expect(first.response.status).toBe(200);
        expect(h.store.json(path(`steps/publish-${page}.json`))).toMatchObject({ status: "ok" });
        if (page === 0) {
          committed = h.store.contents["views/latest.json"];
          expect(committed).not.toBe(pointerBefore);
          expect(h.indexNowSubmissions).toHaveLength(0);
          expect(h.store.contents[path("steps/publish.json")]).toBeUndefined();
        }
        const progress = h.store.contents[path(`publish/progress-${page}.json`)];
        const writes = h.store.writes.length;
        const submissions = h.indexNowSubmissions.length;
        const invalidations = h.invalidations.length;
        const replay = await h.run(job, { subrequestLimit: 30 });
        expect(replay.result).toEqual(first.result);
        expect(h.store.contents[path(`publish/progress-${page}.json`)]).toBe(progress);
        expect(h.store.writes.slice(writes).every((rel) => rel.endsWith("/active.json") || rel.includes("/steps/"))).toBe(true);
        expect(h.indexNowSubmissions).toHaveLength(submissions);
        expect(h.invalidations).toHaveLength(invalidations);
        expect(h.store.contents["views/latest.json"]).toBe(committed!);
        job = nextRefreshJob(job, first.result!) as FullJob;
      }
      expect(job.name).toBe("gc");
      h.store.subrequests.reset();
      const pointer = JSON.parse(committed!);
      const expectedPaths = await workflowPublishCanonicalPaths({ runId: TEST_RUN, prevVersion: pointer.prev_version, publishedAt: pointer.published_at });
      expect(h.store.json(path("publish/progress-2.json"))).toMatchObject({ paths: expectedPaths });
      expect(h.indexNowSubmissions).toEqual(buildIndexNowPayloads(expectedPaths).payloads);
    } finally { h.restore(); }
  });

  test("a lost first-page progress write replays the immutable intent and rollback target", async () => {
    const h = installWorkflowHarness(publication.artifacts);
    try {
      h.store.failWrite = (rel) => rel.endsWith("/publish/progress-0.json");
      const token = publication.job.cursor.fencingToken!;
      await expect(runPublishStep(TEST_RUN, token)).rejects.toThrow("is live; post-commit");
      const pointer = h.store.contents["views/latest.json"];
      const intent = h.store.contents[path("publish-intent.json")];
      h.store.failWrite = undefined;
      expect(await runPublishStep(TEST_RUN, token)).toMatchObject({ version: TEST_RUN, nextWorkOffset: 1 });
      expect(h.store.contents["views/latest.json"]).toBe(pointer);
      expect(h.store.contents[path("publish-intent.json")]).toBe(intent);
    } finally { h.restore(); }
  });

  for (const failedPage of [1, 2]) {
    test(`a derivation failure on page ${failedPage} preserves best-effort publication without partial submission`, async () => {
      const h = installWorkflowHarness(publication.artifacts, { INDEXNOW_ENABLED: "1" });
      const readView = source.readView;
      const read = spyOn(source, "readView").mockImplementation(async (rel, schema, opts) => {
        if (rel.includes(`/entity/${failedPage === 1 ? "repo" : "org"}/`)) throw new Error("injected entity read failure");
        return readView(rel, schema, opts);
      });
      try {
        let job = publication.job;
        for (let page = 0; page < 3; page++) {
          const output = await h.run(job, { subrequestLimit: 500 });
          expect(output.response.status).toBe(200);
          job = nextRefreshJob(job, output.result!) as FullJob;
        }
        expect(job.name).toBe("gc");
        expect(h.store.json(path("publish/progress-2.json"))).toMatchObject({ paths: null });
        expect(h.store.json("views/latest.json")).toMatchObject({ version: TEST_RUN });
        expect(h.indexNowSubmissions).toHaveLength(0);
      } finally { read.mockRestore(); h.restore(); }
    });
  }

  test("an unexpected submission error retains best-effort publication", async () => {
    const h = installWorkflowHarness(publication.artifacts, { INDEXNOW_ENABLED: "1" });
    const submit = spyOn(indexnow, "submitIndexNowUrls").mockRejectedValue(new Error("injected submission setup failure"));
    try {
      const { drainWorkflowStep } = await import("../test-support");
      expect((await drainWorkflowStep(h, publication.job)).response.status).toBe(200);
      expect(h.store.json("views/latest.json")).toMatchObject({ version: TEST_RUN });
      expect(h.store.json(path("steps/publish.json"))).toMatchObject({ status: "ok" });
      expect(submit).toHaveBeenCalledTimes(1);
    } finally { submit.mockRestore(); h.restore(); }
  });

  test("a missing publish predecessor fails after commit without repointing the version", async () => {
    const h = installWorkflowHarness(publication.artifacts);
    try {
      const first = await h.run(publication.job);
      const page = nextRefreshJob(publication.job, first.result!) as FullJob;
      const pointer = h.store.contents["views/latest.json"];
      await h.store.del(path("publish/progress-0.json"));
      expect((await h.run(page)).response.status).toBe(500);
      expect(h.store.contents["views/latest.json"]).toBe(pointer);
      expect(h.store.json(path("manifest.json"))).toMatchObject({ status: "failed", published_version: TEST_RUN });
      expect(h.store.json(path("error.json"))).toMatchObject({ phase: "post_commit", committed_version: TEST_RUN });
      expect(h.indexNowSubmissions).toHaveLength(0);
    } finally { h.restore(); }
  });

  test("a successor's fencing token prevents post-commit derivation and submission", async () => {
    const h = installWorkflowHarness(publication.artifacts);
    try {
      const first = await h.run(publication.job);
      const page = nextRefreshJob(publication.job, first.result!) as FullJob;
      const lease = h.store.json<Record<string, unknown>>("ops/workflows/active.json");
      await h.store.set("ops/workflows/active.json", { ...lease, run_id: "successor", fencing_token: 99 });
      const successor = h.store.contents["ops/workflows/active.json"];
      expect((await h.run(page)).response.status).toBe(500);
      expect(h.store.contents["ops/workflows/active.json"]).toBe(successor);
      expect(h.store.contents[path("publish/progress-1.json")]).toBeUndefined();
      expect(h.store.json(path("post-commit-failure.json"))).toMatchObject({ phase: "post_commit", published_version: TEST_RUN });
      expect(h.indexNowSubmissions).toHaveLength(0);
    } finally { h.restore(); }
  });

  test("lease takeover during organization comparison prevents submission", async () => {
    const h = installWorkflowHarness(publication.artifacts, { INDEXNOW_ENABLED: "1" });
    let read: ReturnType<typeof spyOn> | undefined;
    try {
      const committed = await h.run(publication.job);
      const repoJob = nextRefreshJob(publication.job, committed.result!) as FullJob;
      const repos = await h.run(repoJob);
      const orgJob = nextRefreshJob(repoJob, repos.result!) as FullJob;
      const lease = h.store.json<Record<string, unknown>>("ops/workflows/active.json");
      let successor: string | undefined;
      const readView = source.readView;
      read = spyOn(source, "readView").mockImplementation(async (rel, schema, opts) => {
        if (rel.includes("/entity/org/") && !successor) {
          successor = JSON.stringify({ ...lease, run_id: "successor", fencing_token: 99 });
          await h.store.put("ops/workflows/active.json", successor, { allowOverwrite: true });
        }
        return readView(rel, schema, opts);
      });
      expect((await h.run(orgJob, { subrequestLimit: 500 })).response.status).toBe(500);
      expect(successor).toBeDefined();
      expect(h.store.contents["ops/workflows/active.json"]).toBe(successor!);
      expect(h.store.contents[path("publish/progress-2.json")]).toBeUndefined();
      expect(h.store.json(path("post-commit-failure.json"))).toMatchObject({ phase: "post_commit", published_version: TEST_RUN });
      expect(h.indexNowSubmissions).toHaveLength(0);
    } finally { read?.mockRestore(); h.restore(); }
  });

  test("the original unsliced validation needs more than 10,000 physical operations", async () => {
    const h = installWorkflowHarness(validation.artifacts);
    try {
      h.store.subrequests.reset();
      await validateVersion(TEST_RUN, validation.job.cursor.fencingToken);
      expect(h.store.subrequests.total).toBeGreaterThan(10_000);
      expect(h.store.subrequests.counts.fetchRead).toBeGreaterThan(10_000);
    } finally { h.restore(); }
  });

  test("validation page replay preserves the report and a missing predecessor fails closed", async () => {
    const h = installWorkflowHarness(validation.artifacts);
    try {
      const start = await h.run(validation.job);
      const page = nextRefreshJob(validation.job, start.result!) as FullJob;
      const first = await h.run(page, { subrequestLimit: 300 });
      const persisted = h.store.contents[path("validate/progress-1.json")];
      expect((await h.run(page, { subrequestLimit: 300 })).result).toEqual(first.result);
      expect(h.store.contents[path("validate/progress-1.json")]).toBe(persisted);
      await h.store.del(path("validate/progress-1.json"));
      const next = nextRefreshJob(page, first.result!) as FullJob;
      expect((await h.run(next)).response.status).toBe(500);
      expect(h.store.json(path("manifest.json"))).toMatchObject({ status: "failed" });
    } finally { h.restore(); }
  });

  for (const recording of [false, true]) {
    test(`exhaustion during ${recording ? "failure recording" : "step work"} moves diagnostics to a fresh invocation`, async () => {
      const h = installWorkflowHarness(validation.artifacts);
      try {
        const failure = await exhaust(h, validation.job, recording);
        const output = await h.run(failure, { subrequestLimit: 1000, queueConsumer: true });
        expect(output.response.status).toBe(200);
        expect(nextRefreshJob(failure, output.result!)).toBeNull();
        expect(h.store.subrequests.total).toBeLessThan(20);
        expect(h.store.json(path("manifest.json"))).toMatchObject({ status: "failed", published_version: null });
        expect(h.store.json(path("error.json"))).toMatchObject({ phase: "pre_commit" });
        expect(h.store.json("ops/workflows/active.json")).toMatchObject({ status: "failed", run_id: TEST_RUN });
        expect(h.store.contents[path("steps/validate-0.json")]).toBeUndefined();
      } finally { h.restore(); }
    });
  }

  test("deferred recording releases an expired lease without renewing it", async () => {
    const h = installWorkflowHarness(validation.artifacts);
    try {
      const failure = await exhaust(h, validation.job);
      h.store.subrequests.reset();
      const lease = h.store.json<Record<string, unknown>>("ops/workflows/active.json");
      await h.store.set("ops/workflows/active.json", { ...lease, expires_at: "2026-10-01T00:00:00.000Z" });
      expect((await h.run(failure)).response.status).toBe(200);
      expect(h.store.json(path("manifest.json"))).toMatchObject({ status: "failed" });
      expect(h.store.json("ops/workflows/active.json")).toMatchObject({ status: "failed" });
    } finally { h.restore(); }
  });

  test("deferred failure cannot release a successor's lease and is replay safe", async () => {
    const h = installWorkflowHarness(validation.artifacts);
    try {
      const failure = await exhaust(h, validation.job);
      h.store.subrequests.reset();
      const lease = h.store.json<Record<string, unknown>>("ops/workflows/active.json");
      await h.store.set("ops/workflows/active.json", { ...lease, run_id: "successor", fencing_token: 99 });
      const successor = h.store.contents["ops/workflows/active.json"];
      for (let i = 0; i < 2; i++) expect((await h.run(failure)).response.status).toBe(200);
      expect(h.store.contents["ops/workflows/active.json"]).toBe(successor);
      expect(h.store.json(path("error.json"))).toMatchObject({ error: SUBREQUEST_LIMIT_ERROR });
      await h.store.set(path("manifest.json"), { ...h.store.json<Record<string, unknown>>(path("manifest.json")), status: "published", published_version: TEST_RUN });
      expect((await h.run(failure)).response.status).toBe(200);
      expect(h.store.json(path("manifest.json"))).toMatchObject({ status: "published" });
    } finally { h.restore(); }
  });

  test("a corrupt entity in the final page still prevents publication", async () => {
    const h = installWorkflowHarness(validation.artifacts);
    try {
      await h.store.set(`views/${TEST_RUN}/entity/org/owner-999.json`, { invalid: true });
      const { drainWorkflowStep } = await import("../test-support");
      const output = await drainWorkflowStep(h, validation.job);
      expect(output.response.status).toBe(500);
      expect(WorkflowValidation.parse(h.store.json(path("validation.json")))).toMatchObject({ ok: false, schema_failures: 1 });
      expect(h.store.json(path("manifest.json"))).toMatchObject({ status: "failed", published_version: null });
    } finally { h.restore(); }
  });

  test("failure recording itself can be retried on a fresh queue delivery", async () => {
    const h = installWorkflowHarness(validation.artifacts);
    try {
      const failure = await exhaust(h, validation.job);
      await expect(h.run(failure, { subrequestLimit: 1, queueConsumer: true })).rejects.toThrow(SUBREQUEST_LIMIT_ERROR);
      expect((await h.run(failure, { subrequestLimit: 30, queueConsumer: true })).response.status).toBe(200);
      expect(h.store.json(path("manifest.json"))).toMatchObject({ status: "failed" });
      expect(h.store.json(path("error.json"))).toMatchObject({ error: SUBREQUEST_LIMIT_ERROR });
      expect(h.store.json("ops/workflows/active.json")).toMatchObject({ status: "failed" });
    } finally { h.restore(); }
  });

  test("an exhausted publication records the committed version from a fresh pointer read", async () => {
    const h = installWorkflowHarness(validation.artifacts);
    try {
      const failure = await exhaust(h, { ...validation.job, name: "publish" });
      h.store.subrequests.reset();
      await h.store.set("views/latest.json", { version: TEST_RUN, run_id: TEST_RUN, published_at: TEST_NOW, prev_version: null, schema_ver: 1 });
      expect((await h.run(failure)).response.status).toBe(200);
      expect(h.store.json(path("manifest.json"))).toMatchObject({ status: "failed", published_version: TEST_RUN });
      expect(h.store.json(path("error.json"))).toMatchObject({ phase: "post_commit", committed_version: TEST_RUN });
    } finally { h.restore(); }
  });

  test("a /start borrows all 32 completed buckets from an expired running manifest", async () => {
    const initial = { ...afterMetadata };
    const active = JSON.parse(initial["ops/workflows/active.json"]!);
    initial["ops/workflows/active.json"] = JSON.stringify({ ...active, expires_at: "2026-10-01T00:00:00.000Z" });
    const h = installWorkflowHarness(initial, { GITHUB_TOKEN: "test-only-github-token", STORAGE_WRITE_DRIVER: "blob", BLOB_READ_WRITE_TOKEN: "test-only-blob-token" });
    const fetchMetadata = spyOn(github, "fetchRepositoryMetadata").mockRejectedValue(new Error("completed metadata must not be fetched again"));
    let first: FullJob | undefined;
    try {
      const response = await startRefreshWorkflowRoute(new Request("https://workflow.test.invalid/api/workflows/refresh/start", { method: "POST", headers: { authorization: "Bearer workflow-test-only" } }), async (runId) => { first = firstRefreshJob(runId) as FullJob; }, { now: new Date(TEST_NOW) });
      expect(response.status).toBe(200);
      let job = first as FullJob | null;
      while (job && job.name !== "fold") {
        const output = await h.run(job, { subrequestLimit: 1000 });
        expect(output.response.status).toBe(200);
        job = nextRefreshJob(job, output.result!) as FullJob | null;
      }
      expect(job?.name).toBe("fold");
      const runId = first!.runId;
      expect(h.store.json(`canonical/v2/whitelist/${runId}.json`)).toMatchObject({ metadata_resume_run_id: TEST_RUN });
      for (let bucket = 0; bucket < REPO_BUCKETS; bucket++) {
        expect(h.store.json(`ops/workflows/${runId}/metadata-${bucket}.json`)).toEqual(h.store.json(path(`metadata-${bucket}.json`)));
      }
      expect(fetchMetadata).not.toHaveBeenCalled();
      expect(h.store.json(path("manifest.json"))).toMatchObject({ status: "running" });
    } finally { h.restore(); }
  });
});

test("an exhausted invocation is never retried in the same budget", async () => {
  let attempts = 0;
  await expect(withStepRetry("validate", async () => { attempts++; throw new Error(SUBREQUEST_LIMIT_ERROR); }, undefined, async () => {})).rejects.toThrow(SUBREQUEST_LIMIT_ERROR);
  expect(attempts).toBe(1);
});
