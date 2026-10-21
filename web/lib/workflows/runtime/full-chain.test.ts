import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { CanonicalGenerationManifest, RankList, ViewsPointer, WorkflowLease, WorkflowManifest, WorkflowStepCheckpoint, WorkflowValidation } from "@/lib/contracts";
import { nextRefreshJob } from "./graph";
import { firstRefreshJob, FULL_REFRESH_STEPS } from "./types";
import { refreshStepCheckpointName } from "./step-route";
import { drainWorkflowStep, installWorkflowHarness, PREVIOUS_RUN, TEST_RUN, type FullJob } from "../test-support";

type Boundary = { job: FullJob; artifacts: Record<string, string> };
const boundaries = new Map<string, Boundary>();
const rankHops: string[] = [];
let chain: Pick<ReturnType<typeof installWorkflowHarness>, "store" | "invalidations">;

/** Run `fn` against a fresh harness restored to the artifacts present just before `step` first ran. */
async function atBoundary<T>(step: string, fn: (h: ReturnType<typeof installWorkflowHarness>, boundary: Boundary) => Promise<T>): Promise<T> {
  const boundary = boundaries.get(step)!;
  const h = installWorkflowHarness(boundary.artifacts);
  try {
    return await fn(h, boundary);
  } finally {
    h.restore();
  }
}

const runPath = (rel: string) => `ops/workflows/${TEST_RUN}/${rel}`;
const pointerVersion = (store: { json: <T>(p: string) => T }) => ViewsPointer.parse(store.json("views/latest.json")).version;

describe("production refresh chain in memory", () => {
  beforeAll(async () => {
    const harness = installWorkflowHarness();
    try {
      let job = firstRefreshJob(TEST_RUN) as FullJob | null;
      for (let hops = 0; job && hops < 400; hops++) {
        if (job.name === "recomputeRank") rankHops.push(`${job.cursor.recomputePhase ?? "pack"}@${job.cursor.recomputeOffset ?? 0}`);
        if (!boundaries.has(job.name)) boundaries.set(job.name, { job: structuredClone(job), artifacts: { ...harness.store.contents } });
        const { response, result } = await harness.run(job);
        expect(response.status).toBe(200);
        expect(result).toBeDefined();
        const checkpoint = WorkflowStepCheckpoint.parse(harness.store.json(`ops/workflows/${TEST_RUN}/steps/${refreshStepCheckpointName(job)}.json`));
        expect(checkpoint.status).toBe("ok");
        job = nextRefreshJob(job, result!) as FullJob | null;
      }
      expect(job).toBeNull();
      chain = { store: harness.store, invalidations: harness.invalidations };
    } finally {
      harness.restore();
    }
  }, 30000);
  afterAll(() => undefined);

  test("executes every real handler, default checkpoint, publish, and GC", () => {
    const { store } = chain;
    expect([...boundaries.keys()]).toEqual([...FULL_REFRESH_STEPS]);
    expect(WorkflowManifest.parse(store.json(runPath("manifest.json")))).toMatchObject({ status: "published", published_version: TEST_RUN });
    expect(WorkflowLease.parse(store.json("ops/workflows/active.json"))).toMatchObject({ status: "published", run_id: TEST_RUN });
    expect(ViewsPointer.parse(store.json("views/latest.json"))).toMatchObject({ version: TEST_RUN, prev_version: PREVIOUS_RUN });
    expect(WorkflowValidation.parse(store.json(runPath("validation.json")))).toMatchObject({ ok: true, schema_failures: 0, failures: [], invariants: { entity_repos_checked: 1000, entity_orgs_checked: 1 } });
    expect(CanonicalGenerationManifest.parse(store.json(runPath("canonical-manifest.json"))).complete).toBe(true);
    expect(store.json(runPath("recompute-enqueued.json"))).toMatchObject({ from: "fold", to: "recomputeRank" });
    expect(store.deletions).toContain("views/refresh-2026-09-20/orphan.json");
    expect(store.contents[`views/${PREVIOUS_RUN}/meta.json`]).toBeDefined();
    expect(store.deletions.every((path) => path.startsWith("views/refresh-2026-09-"))).toBe(true);
    expect(chain.invalidations).toHaveLength(1);
    const invalidation = chain.invalidations[0]!;
    expect(invalidation.url).toBe("https://workflow-cron.test.invalid/api/workflows/refresh/revalidate");
    expect(invalidation.init?.method).toBe("POST");
    expect(new Headers(invalidation.init?.headers).get("authorization")).toBe("Bearer workflow-test-only");
    expect(invalidation.init?.cache).toBe("no-store");
    expect(invalidation.init?.signal).toBeInstanceOf(AbortSignal);
  });

  test("rank hops follow the production successors and write every window's artifacts", () => {
    const { store } = chain;
    const prefix = ["pack@0", "month@0", "month@8", "monthOrg@0", "monthOrg@8", "year@0", "year@0", "yearOrg@0", "week@0", "week@0", "week@8", "weekOrg@0", "weekOrg@8"];
    expect(rankHops.slice(0, prefix.length)).toEqual(prefix);
    const rest = rankHops.slice(prefix.length);
    expect(rest.length).toBeGreaterThan(0);
    expect(rest).toEqual(rest.map((_, index) => `rest@${index}`));
    for (const carry of ["month-repo", "month-org", "week-repo", "week-org", "rest"]) expect(store.contents[runPath(`recompute/${carry}-carry.json`)]).toBeDefined();
    for (const kind of ["month", "week", "year"] as const) {
      const meta = store.json<{ periods: string[] }>(runPath(`recompute/${kind}-win/meta.json`));
      for (const period of meta.periods) {
        for (const dim of ["repo", "org"]) {
          for (const metric of ["flow", "stock"]) {
            const rank = RankList.parse(store.json(`views/${TEST_RUN}/rank/${kind}/${period}/${dim}/${metric}.json`));
            expect(rank.meta).toMatchObject({ window: kind, period, dim, metric });
          }
        }
      }
    }
  });

  test("carry state survives the eight-period hop boundary", () => {
    const { store } = chain;
    const item = (path: string) => RankList.parse(store.json(`views/${TEST_RUN}/rank/${path}.json`)).items[0]!;
    // Month hop 2 starts at 2026-08: stock 170 at 2026-07 carries in (+10) and the previous rank survives.
    expect(item("month/2025-12/repo/stock")).toMatchObject({ value: 100, prev_rank: null });
    expect(item("month/2026-07/repo/stock")).toMatchObject({ value: 170 });
    expect(item("month/2026-08/repo/stock")).toMatchObject({ value: 180, prev_rank: 1 });
    expect(item("month/2026-09/repo/stock")).toMatchObject({ value: 184, prev_rank: 1 });
    expect(item("week/2026-W30/repo/stock")).toMatchObject({ prev_rank: null });
    expect(item("week/2026-W39/repo/stock")).toMatchObject({ value: 18, prev_rank: 1 });
  });

  describe("a single injected write failure at each step boundary", () => {
    for (const step of FULL_REFRESH_STEPS) {
      test(`${step} fails closed and never moves the pointer or records an ok checkpoint`, () =>
        atBoundary(step, async (h, { job }) => {
          const pointerBefore = h.store.contents["views/latest.json"];
          h.store.failWrite = () => true;
          const { response, result } = await drainWorkflowStep(h, job);
          expect(h.store.contents["views/latest.json"]).toBe(pointerBefore);
          if (step === "gc") {
            // Version GC is best-effort by design: it reports the error instead of failing a published run.
            expect(response.status).toBe(200);
            expect(result?.error).toContain("injected write failure");
            return;
          }
          expect(response.status).toBe(500);
          expect(h.store.contents[runPath(`steps/${refreshStepCheckpointName(job)}.json`)]).toBeUndefined();
        }));
    }

    test("a failed pre-publish step marks the run failed, not published", () =>
      atBoundary("aliases", async (h, { job }) => {
        h.store.failWrite = (path) => path.endsWith("/steps/aliases.json");
        const { response } = await drainWorkflowStep(h, job);
        expect(response.status).toBe(500);
        expect(WorkflowManifest.parse(h.store.json(runPath("manifest.json"))).status).not.toBe("published");
        expect(pointerVersion(h.store)).toBe(PREVIOUS_RUN);
      }));
  });

  describe("other fault injection", () => {
    test("a corrupt read during validate fails the run before publication", () =>
      atBoundary("validate", async (h, { job }) => {
        h.store.failRead = true;
        const { response } = await drainWorkflowStep(h, job);
        expect(response.status).toBe(500);
        expect(pointerVersion(h.store)).toBe(PREVIOUS_RUN);
      }));

    test("a failed storage delete during gc is reported but leaves the published run intact", () =>
      atBoundary("gc", async (h, { job }) => {
        h.store.failDelete = true;
        const { response, result } = await drainWorkflowStep(h, job);
        expect(response.status).toBe(200);
        expect(result?.error).toContain("injected delete failure");
        expect(pointerVersion(h.store)).toBe(TEST_RUN);
        expect(h.store.deletions).toEqual([]);
      }));

    test("a failing publication-cache callback does not unpublish", () =>
      atBoundary("publish", async (h, { job }) => {
        h.setInvalidationStatus(500);
        const { response } = await drainWorkflowStep(h, job);
        expect(response.status).toBe(500);
        expect(pointerVersion(h.store)).toBe(TEST_RUN);
        expect(h.invalidations).toHaveLength(1);
        expect(h.invalidations[0]?.url).toBe("https://workflow-cron.test.invalid/api/workflows/refresh/revalidate");
      }));
  });

  describe("period-rank completeness gate", () => {
    test("rejects a missing period-ranking artifact before publication", () =>
      atBoundary("validate", async (h, { job }) => {
        const path = `views/${TEST_RUN}/rank/month/2026-09/repo/stock.json`;
        expect(h.store.contents[path]).toBeDefined();
        await h.store.del(path);
        const { response } = await drainWorkflowStep(h, job);
        expect(response.status).toBe(500);
        expect(pointerVersion(h.store)).toBe(PREVIOUS_RUN);
        const validation = WorkflowValidation.parse(h.store.json(runPath("validation.json")));
        expect(validation.ok).toBe(false);
        expect(validation.failures).toContain("rank/month/2026-09/repo/stock.json: missing");
      }));

    test("rejects rank metadata that disagrees with the artifact path", () =>
      atBoundary("validate", async (h, { job }) => {
        const path = `views/${TEST_RUN}/rank/week/2026-W39/org/flow.json`;
        const rank = h.store.json<{ meta: Record<string, string> }>(path);
        await h.store.set(path, { ...rank, meta: { ...rank.meta, period: "2026-W38" } });
        const { response } = await drainWorkflowStep(h, job);
        expect(response.status).toBe(500);
        expect(WorkflowValidation.parse(h.store.json(runPath("validation.json"))).failures).toContain("rank/week/2026-W39/org/flow.json: metadata does not match artifact path");
      }));

    test("rejects a missing period inventory", () =>
      atBoundary("validate", async (h, { job }) => {
        await h.store.del(runPath("recompute/year-win/meta.json"));
        const { response } = await drainWorkflowStep(h, job);
        expect(response.status).toBe(500);
        expect(pointerVersion(h.store)).toBe(PREVIOUS_RUN);
        const failures = WorkflowValidation.parse(h.store.json(runPath("validation.json"))).failures;
        expect(failures.some((item) => item.includes("year-win/meta.json") && item.includes("missing or invalid period inventory"))).toBe(true);
      }));

    test("accepts a valid but empty period inventory because there is nothing to require", () =>
      atBoundary("validate", async (h, { job }) => {
        for (const kind of ["month", "week", "year"]) {
          const path = runPath(`recompute/${kind}-win/meta.json`);
          await h.store.set(path, { ...h.store.json<Record<string, unknown>>(path), periods: [] });
        }
        const { response } = await drainWorkflowStep(h, job);
        expect(response.status).toBe(200);
        expect(WorkflowValidation.parse(h.store.json(runPath("validation.json")))).toMatchObject({ ok: true, invariants: { period_rank_files_checked: 0 } });
      }));
  });
});
