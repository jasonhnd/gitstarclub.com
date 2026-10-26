import { beforeAll, describe, expect, test } from "bun:test";
import { WorkflowLease, WorkflowManifest, WorkflowValidation } from "@/lib/contracts";
import { QUEUE_ADVANCE_CONSUMER, QUEUE_ADVANCE_HEADER } from "@/lib/workers-host/queue-advance";
import { withWorkerEnv } from "@/lib/workers-host/runtime-env";
import { firstRefreshJob, isRefreshStepJob } from "@/lib/workflows/runtime/types";
import { installWorkflowHarness, SUBREQUEST_LIMIT_ERROR, TEST_RUN, workflowCompletedMetadataSeed, type FullJob } from "@/lib/workflows/test-support";
import { handleQueue } from "../../../workers/gitstarclub-web/src/shell";
import type { WorkerEnv } from "../../../workers/gitstarclub-web/src/env";
import { step } from "../../src/packages/p7/operations";

const REPOS = 5669;
const path = (relative: string) => `ops/workflows/${TEST_RUN}/${relative}`;
type Harness = ReturnType<typeof installWorkflowHarness>;

/** The exact consumer imported by Astro's entry calls its real P7 HTTP handler. */
function astroConsumer(harness: Harness) {
  const pending: FullJob[] = [];
  let limit = 1000;
  let loseBody = false;
  let output: Awaited<ReturnType<Harness["run"]>>;
  const env: WorkerEnv = {
    MEDIA: {}, CRON_SECRET: "workflow-test-only",
    REFRESH_STEP_URL: "https://workflow.test.invalid/api/workflows/refresh/step",
    JOBS: { async send(message) {
      expect(isRefreshStepJob(message)).toBe(true);
      expect(message.graph).toBe("full");
      pending.push(structuredClone(message) as FullJob);
    } },
    WORKER_SELF_REFERENCE: { async fetch(request) {
      expect(request.url).toBe(env.REFRESH_STEP_URL!);
      expect(request.method).toBe("POST");
      expect(request.headers.get(QUEUE_ADVANCE_HEADER)).toBe(QUEUE_ADVANCE_CONSUMER);
      const job = await request.clone().json() as FullJob;
      output = await harness.run(job, {
        subrequestLimit: limit, queueConsumer: true, request,
        route: (request) => step({ request, locals: {
          invalidatePaths: async () => { throw new Error("unexpected page invalidation hook"); },
          cfContext: { waitUntil: () => { throw new Error("consumer must advance through JOBS.send"); } },
        } }),
      });
      // A broken body must still deliver the failure successor from its header.
      return loseBody ? new Response("{", { headers: output.response.headers }) : output.response;
    } },
  };
  return {
    pending,
    async deliver(job: FullJob, subrequestLimit = 1000, unreadableBody = false) {
      limit = subrequestLimit;
      loseBody = unreadableBody;
      await withWorkerEnv(env, () => handleQueue({ messages: [{ body: job }] }, env));
      return output;
    },
  };
}

describe("Astro consumer subrequest budget with 5,669 repositories and owners", () => {
  let validation: { job: FullJob; artifacts: Record<string, string>; cost: number };
  const counts = new Map<string, { hops: number; max: number }>();
  const publishCounts: number[] = [];

  beforeAll(async () => {
    const harness = installWorkflowHarness(workflowCompletedMetadataSeed(REPOS), { INDEXNOW_ENABLED: "1", WORKFLOW_RUNTIME: "cf-queue" });
    const consumer = astroConsumer(harness);
    try {
      let job: FullJob | undefined = firstRefreshJob(TEST_RUN) as FullJob;
      for (let hop = 0; job && hop < 1000; hop++) {
        if (job.name === "validate" && !validation) validation = { job: structuredClone(job), artifacts: { ...harness.store.contents }, cost: 0 };
        const { response, result } = await consumer.deliver(job);
        if (job.name === "validate" && !job.cursor.workOffset) validation.cost = harness.store.subrequests.total;
        expect(response.status).toBe(200);
        expect(result?.deferredFailure).toBeUndefined();
        // Include the parent's service fetch and queue send as extra headroom.
        const total = harness.store.subrequests.total + 2;
        expect(total, `${job.name}@${job.cursor.workOffset ?? 0}`).toBeLessThan(600);
        const count = counts.get(job.name) ?? { hops: 0, max: 0 };
        count.hops++;
        count.max = Math.max(count.max, total);
        counts.set(job.name, count);
        if (job.name === "publish") publishCounts.push(total);
        if (["recomputeRepoEntities", "recomputeOrgEntities", "validate", "publish", "gc"].includes(job.name)) {
          expect(harness.store.json(path(`steps/${job.name}-${job.cursor.workOffset ?? 0}.json`))).toMatchObject({ status: "ok" });
          if (result?.nextWorkOffset !== undefined) expect(harness.store.contents[path(`steps/${job.name}.json`)]).toBeUndefined();
          else expect(harness.store.json(path(`steps/${job.name}.json`))).toMatchObject({ status: "ok" });
        }
        expect(consumer.pending.length).toBeLessThanOrEqual(1);
        const next = consumer.pending.shift();
        if (typeof result?.nextWorkOffset === "number") {
          expect(next?.name).toBe(job.name);
          expect(next?.cursor.workOffset).toBe(result.nextWorkOffset);
        } else if (next && next.name !== job.name) expect(next.cursor.workOffset).toBeUndefined();
        job = next;
      }
      expect(job).toBeUndefined();
      expect(WorkflowValidation.parse(harness.store.json(path("validation.json")))).toMatchObject({ ok: true, failures: [], invariants: { entity_repos_checked: REPOS, entity_orgs_checked: REPOS } });
      expect(WorkflowManifest.parse(harness.store.json(path("manifest.json"))).status).toBe("published");
      expect(WorkflowLease.parse(harness.store.json("ops/workflows/active.json")).status).toBe("published");
      expect(harness.store.deletions.filter((key) => key.startsWith("views/refresh-2026-08-01/"))).toHaveLength(REPOS);
      expect(harness.indexNowSubmissions).toHaveLength(2);
      console.info("Astro consumer budget:", JSON.stringify(Object.fromEntries(counts)));
    } finally { harness.restore(); }
  }, 120_000);

  test("all growing steps yield, keep page checkpoints and finish publication", () => {
    for (const name of ["fold", "recomputeRank", "recomputeRepoEntities", "recomputeOrgEntities", "validate", "publish", "gc"]) {
      expect(counts.get(name)?.hops, name).toBeGreaterThan(1);
    }
    expect(publishCounts).toEqual([60, 452, 455]);
    expect(counts.get("publish")!.max).toBeLessThan(500);
  });

  for (const unreadableBody of [false, true]) {
    test(`exhaustion delivers diagnostics in a fresh invocation via ${unreadableBody ? "successor header" : "JSON body"}`, async () => {
      const harness = installWorkflowHarness(validation.artifacts, { WORKFLOW_RUNTIME: "cf-queue" });
      const consumer = astroConsumer(harness);
      try {
        // Exhaust the final checkpoint write, after authoritative reads succeed.
        const exhausted = await consumer.deliver(validation.job, validation.cost - 1, unreadableBody);
        expect(exhausted.result?.deferredFailure).toMatchObject({ message: SUBREQUEST_LIMIT_ERROR });
        expect(harness.store.contents[path("error.json")]).toBeUndefined();
        expect(harness.store.json(path("manifest.json"))).toMatchObject({ status: "running" });
        const failure = consumer.pending.shift()!;
        expect(failure.name).toBe("validate");
        expect(failure.cursor.failure?.message).toContain(SUBREQUEST_LIMIT_ERROR);
        // A failed diagnostic delivery must propagate so the Queue can retry it.
        await expect(consumer.deliver(failure, 1)).rejects.toThrow(SUBREQUEST_LIMIT_ERROR);
        expect(consumer.pending).toHaveLength(0);
        expect((await consumer.deliver(failure, 30)).response.status).toBe(200);
        expect(consumer.pending).toHaveLength(0);
        expect(harness.store.subrequests.total).toBeLessThan(20);
        expect(harness.store.json(path("manifest.json"))).toMatchObject({ status: "failed", published_version: null });
        expect(harness.store.json(path("error.json"))).toMatchObject({ phase: "pre_commit" });
        expect(harness.store.json("ops/workflows/active.json")).toMatchObject({ status: "failed" });
      } finally { harness.restore(); }
    });
  }
});
