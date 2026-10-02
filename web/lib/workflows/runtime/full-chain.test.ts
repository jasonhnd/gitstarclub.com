import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { CanonicalGenerationManifest, ViewsPointer, WorkflowLease, WorkflowManifest, WorkflowStepCheckpoint, WorkflowValidation } from "@/lib/contracts";
import { nextRefreshJob } from "./graph";
import { firstRefreshJob, FULL_REFRESH_STEPS } from "./types";
import { refreshStepCheckpointName } from "./step-route";
import { installWorkflowHarness, PREVIOUS_RUN, TEST_RUN, type FullJob } from "../test-support";

type Boundary = { job: FullJob; artifacts: Record<string, string> };
const boundaries = new Map<string, Boundary>();
let harness: ReturnType<typeof installWorkflowHarness>;

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
    harness.restore();
    const boundary = boundaries.get("validate")!;
    harness = installWorkflowHarness(boundary.artifacts);
    const path = `views/${TEST_RUN}/rank/month/2026-09/repo/stock.json`;
    expect(harness.store.contents[path]).toBeDefined();
    await harness.store.del(path);
    const { response } = await harness.run(boundary.job);
    expect(response.status).toBe(500);
    expect(ViewsPointer.parse(harness.store.json("views/latest.json")).version).toBe(PREVIOUS_RUN);
    const validation = WorkflowValidation.parse(harness.store.json(`ops/workflows/${TEST_RUN}/validation.json`));
    expect(validation.ok).toBe(false);
    expect(validation.failures).toContain("rank/month/2026-09/repo/stock.json: missing");
  });
});
