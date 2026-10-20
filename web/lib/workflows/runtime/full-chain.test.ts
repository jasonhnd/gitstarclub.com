import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { CanonicalGenerationManifest, CategoryRegistry, RankList, ViewsPointer, WorkflowLease, WorkflowManifest, WorkflowStepCheckpoint, WorkflowValidation } from "@/lib/contracts";
import { CATEGORY_RANK_PAGE_SIZE, categoryAllTimeRankPath } from "@/lib/categories/rank-pages";
import { nextRefreshJob } from "./graph";
import { firstRefreshJob, FULL_REFRESH_STEPS } from "./types";
import { refreshStepCheckpointName } from "./step-route";
import { installWorkflowHarness, PREVIOUS_RUN, TEST_RUN, type FullJob } from "../test-support";

type Boundary = { job: FullJob; artifacts: Record<string, string> };
const boundaries = new Map<string, Boundary>();
let harness: ReturnType<typeof installWorkflowHarness>;

function resetAt(name: string) {
  harness.restore();
  const boundary = boundaries.get(name)!;
  harness = installWorkflowHarness(boundary.artifacts);
  return boundary.job;
}

async function expectGateFailure(job: FullJob, failure: string) {
  const { response } = await harness.run(job);
  expect(response.status).toBe(500);
  expect(response.headers.get("x-gitstarclub-queue-successor")).toBeNull();
  expect(ViewsPointer.parse(harness.store.json("views/latest.json")).version).toBe(PREVIOUS_RUN);
  const validation = WorkflowValidation.parse(harness.store.json(`ops/workflows/${TEST_RUN}/validation.json`));
  expect(validation.ok).toBe(false);
  expect(validation.failures.some((message) => message.includes(failure))).toBe(true);
  expect(WorkflowLease.parse(harness.store.json("ops/workflows/active.json")).status).toBe("failed");
}

describe("production refresh chain in memory", () => {
  beforeAll(async () => {
    harness = installWorkflowHarness();
    let job = firstRefreshJob(TEST_RUN) as FullJob | null;
    for (let hops = 0; job && hops < 400; hops++) {
      if (!boundaries.has(job.name)) boundaries.set(job.name, { job: structuredClone(job), artifacts: { ...harness.store.contents } });
      const { response, result } = await harness.run(job);
      expect(response.status).toBe(200);
      expect(result).toBeDefined();
      const checkpoint = WorkflowStepCheckpoint.parse(harness.store.json(`ops/workflows/${TEST_RUN}/steps/${refreshStepCheckpointName(job)}.json`));
      expect(checkpoint.status).toBe("ok");
      job = nextRefreshJob(job, result!) as FullJob | null;
    }
    expect(job).toBeNull();
  }, 30000);
  afterAll(() => harness?.restore());

  test("executes every real handler, default checkpoint, publish, and GC", () => {
    expect([...boundaries.keys()]).toEqual([...FULL_REFRESH_STEPS]);
    expect(WorkflowManifest.parse(harness.store.json(`ops/workflows/${TEST_RUN}/manifest.json`))).toMatchObject({ status: "published", published_version: TEST_RUN });
    expect(WorkflowLease.parse(harness.store.json("ops/workflows/active.json"))).toMatchObject({ status: "published", run_id: TEST_RUN });
    expect(ViewsPointer.parse(harness.store.json("views/latest.json"))).toMatchObject({ version: TEST_RUN, prev_version: PREVIOUS_RUN });
    expect(WorkflowValidation.parse(harness.store.json(`ops/workflows/${TEST_RUN}/validation.json`))).toMatchObject({ ok: true, schema_failures: 0, failures: [], invariants: { entity_repos_checked: 1000, entity_orgs_checked: 1 } });
    expect(CanonicalGenerationManifest.parse(harness.store.json(`ops/workflows/${TEST_RUN}/canonical-manifest.json`)).complete).toBe(true);
    expect(harness.store.json(`ops/workflows/${TEST_RUN}/recompute-enqueued.json`)).toMatchObject({ from: "fold", to: "recomputeRank" });
    expect(harness.store.deletions).toContain("views/refresh-2026-09-20/orphan.json");
    expect(harness.store.contents[`views/${PREVIOUS_RUN}/meta.json`]).toBeDefined();
    expect(harness.store.deletions.every((path) => path.startsWith("views/refresh-2026-09-"))).toBe(true);
    expect(harness.invalidations).toHaveLength(1);
  });

  test("rejects a missing period-ranking artifact before publication", async () => {
    const job = resetAt("validate");
    const path = `views/${TEST_RUN}/rank/month/2026-09/repo/stock.json`;
    expect(harness.store.contents[path]).toBeDefined();
    await harness.store.del(path);
    await expectGateFailure(job, "rank/month/2026-09/repo/stock.json: missing");
  });

  for (const [kind, period] of [["month", "2026-01"], ["week", "2026-W39"], ["year", "2025"]] as const) {
    for (const dim of ["repo", "org"] as const) {
      for (const metric of ["flow", "stock"] as const) {
        test(`requires ${kind}/${period}/${dim}/${metric} from the real inventory`, async () => {
          const job = resetAt("validate");
          const relative = `rank/${kind}/${period}/${dim}/${metric}.json`;
          expect(harness.store.contents[`views/${TEST_RUN}/${relative}`]).toBeDefined();
          await harness.store.del(`views/${TEST_RUN}/${relative}`);
          await expectGateFailure(job, `${relative}: missing`);
        });
      }
    }
  }

  for (const kind of ["month", "week", "year"] as const) {
    test(`refuses a missing ${kind} period inventory`, async () => {
      const job = resetAt("validate");
      await harness.store.del(`ops/workflows/${TEST_RUN}/recompute/${kind}-win/meta.json`);
      await expectGateFailure(job, `${kind}-win/meta.json: missing or invalid period inventory`);
    });
  }

  test("rejects period rank schema, order, references, and mismatched metadata", async () => {
    for (const [change, message] of [
      [(rank: RankList) => { rank.items[0]!.rank = 0; }, ": schema"],
      [(rank: RankList) => { rank.items[0]!.rank = 2; }, "ranks are not sequential"],
      [(rank: RankList) => { rank.items[0]!.value = -1; }, "values not descending"],
      [(rank: RankList) => { rank.items[1]!.id = rank.items[0]!.id; }, "duplicate item id/login"],
      [(rank: RankList) => { rank.items[0]!.id = 99999; }, "missing id/login reference"],
      [(rank: RankList) => { rank.meta.period = "2026-07"; }, "metadata does not match"],
    ] as const) {
      const job = resetAt("validate");
      const path = `views/${TEST_RUN}/rank/month/2026-09/repo/stock.json`;
      const rank = RankList.parse(harness.store.json(path));
      change(rank);
      await harness.store.set(path, rank);
      await expectGateFailure(job, message);
    }
  });

  for (const relative of ["entity/repo/1000.json", "entity/org/example.json", "categories/assignments/shards/31.json"] as const) {
    test(`refuses missing ${relative}`, async () => {
      const job = resetAt("validate");
      await harness.store.del(`views/${TEST_RUN}/${relative}`);
      await expectGateFailure(job, `${relative}: missing`);
    });
  }

  test("records an incomplete checksummed canonical receipt", async () => {
    const job = resetAt("validate");
    await harness.store.del("canonical/v2/repo-monthly/31.json");
    await expectGateFailure(job, "canonical/v2/repo-monthly/31.json: missing");
    const manifest = CanonicalGenerationManifest.parse(harness.store.json(`ops/workflows/${TEST_RUN}/canonical-manifest.json`));
    expect(manifest.complete).toBe(false);
    expect(manifest.validated_shards).toBe(manifest.expected_shards - 1);
  });

  test("checks the actual second category page", async () => {
    const job = resetAt("validate");
    const registry = CategoryRegistry.parse(harness.store.json(`views/${TEST_RUN}/categories/registry.json`));
    const category = registry.dimensions.flatMap((dimension) => dimension.categories).find((category) => category.public)!;
    expect(category.count).toBeGreaterThan(CATEGORY_RANK_PAGE_SIZE);
    const relative = categoryAllTimeRankPath(category.dimension, category.slug, 2);
    const path = `views/${TEST_RUN}/${relative}`;
    const page = harness.store.json<{ items: Array<{ rank: number }> }>(path);
    expect(page.items[0]!.rank).toBe(CATEGORY_RANK_PAGE_SIZE + 1);
    page.items[0]!.rank = 1;
    await harness.store.set(path, page);
    await expectGateFailure(job, "/page/2: rank[0] does not continue");
  });

  for (const name of FULL_REFRESH_STEPS) {
    test(`does not enqueue a successor after a ${name} boundary write fails`, async () => {
      const job = resetAt(name);
      // Most boundaries fail after the real handler and before advancement.
      // markPublished writes/releases the lease, so fail its manifest first.
      const path = name === "markPublished"
        ? `ops/workflows/${TEST_RUN}/manifest.json`
        : `ops/workflows/${TEST_RUN}/steps/${refreshStepCheckpointName(job)}.json`;
      harness.store.failWrite = (candidate) => candidate === path;
      const { response } = await harness.run(job);
      expect(response.status).toBe(500);
      expect(response.headers.get("x-gitstarclub-queue-successor")).toBeNull();
      const committed = ["publish", "gc", "markPublished"].includes(name);
      expect(ViewsPointer.parse(harness.store.json("views/latest.json")).version).toBe(committed ? TEST_RUN : PREVIOUS_RUN);
      if (name === "startRun") {
        // Failure of the initial checkpoint has no incoming ownership cursor;
        // the same real start attaches and recovers without a second lease.
        const token = WorkflowLease.parse(harness.store.json("ops/workflows/active.json")).fencing_token;
        expect((await harness.run(job)).response.status).toBe(200);
        expect(WorkflowLease.parse(harness.store.json("ops/workflows/active.json")).fencing_token).toBe(token);
      } else {
        const manifest = WorkflowManifest.parse(harness.store.json(`ops/workflows/${TEST_RUN}/manifest.json`));
        expect(manifest.status).toBe("failed");
        // S1 will retain the committed version in this failure record.
        expect(manifest.published_version).toBe(committed ? TEST_RUN : null);
        expect(WorkflowLease.parse(harness.store.json("ops/workflows/active.json")).status).toBe("failed");
      }
    });
  }

  test("GC deletion failures are recorded but still allow completion", async () => {
    const job = resetAt("gc");
    harness.store.failDelete = true;
    const { response, result } = await harness.run(job);
    expect(response.status).toBe(200);
    expect(result?.error).toContain("injected delete failure");
    expect(WorkflowStepCheckpoint.parse(harness.store.json(`ops/workflows/${TEST_RUN}/steps/gc.json`)).status).toBe("error");
    expect(harness.store.contents["views/refresh-2026-09-20/orphan.json"]).toBeDefined();
    const next = nextRefreshJob(job, result!) as FullJob;
    expect(next.name).toBe("markPublished");
    expect((await harness.run(next)).response.status).toBe(200);
    expect(WorkflowManifest.parse(harness.store.json(`ops/workflows/${TEST_RUN}/manifest.json`)).status).toBe("published");
  });

  test("a post-commit invalidation failure retains the published pointer and diagnostics", async () => {
    const job = resetAt("publish");
    harness.setInvalidationStatus(503);
    const { response } = await harness.run(job);
    expect(response.status).toBe(500);
    expect(ViewsPointer.parse(harness.store.json("views/latest.json"))).toMatchObject({ version: TEST_RUN, prev_version: PREVIOUS_RUN });
    expect(harness.store.json(`ops/workflows/${TEST_RUN}/manifest.json`)).toMatchObject({ status: "failed", published_version: TEST_RUN });
    expect(harness.store.json(`ops/workflows/${TEST_RUN}/error.json`)).toMatchObject({ run_id: TEST_RUN, error: expect.stringContaining("invalidation") });
    expect(harness.store.json(`ops/workflows/${TEST_RUN}/publish-intent.json`)).toMatchObject({ prev_version: PREVIOUS_RUN });
  });
});
