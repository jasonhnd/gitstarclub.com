import { beforeAll, describe, expect, spyOn, test } from "bun:test";
import { RepoEntity, ViewsPointer, WorkflowLease, WorkflowManifest, WorkflowValidation } from "@/lib/contracts";
import { nextRefreshJob } from "./graph";
import { firstRefreshJob, FULL_REFRESH_STEPS } from "./types";
import { drainWorkflowStep, installWorkflowHarness, TEST_RUN, workflowSeed, type FullJob } from "../test-support";

/** First preview refresh: WORKFLOW_COLD_START=1, no views pointer, no canonical series history. */
function coldStartSeed(): Record<string, string> {
  const dropped = /^(canonical\/v2\/(repo-monthly|repo-weekly|repo-recent-daily|pending|site-daily|repos)\/|canonical\/v2\/meta\.json$|canonical\/v2\/whitelist\/refresh-|views\/(latest\.json$|refresh-2025))/;
  return Object.fromEntries(Object.entries(workflowSeed()).filter(([path]) => !dropped.test(path)));
}

let chain: Pick<ReturnType<typeof installWorkflowHarness>, "store" | "invalidations">;
let beforeValidate: { job: FullJob; artifacts: Record<string, string> };
const steps: string[] = [];
const relaxedChecks: unknown[][] = [];
let failedStep: string | null = null;
let remainingJob: FullJob | null;
const runPath = (rel: string) => `ops/workflows/${TEST_RUN}/${rel}`;
const historyFailures = ["entity/repo/1000: empty curve", "heatmap/year/2025.json: missing"];

async function atValidate(
  fn: (h: ReturnType<typeof installWorkflowHarness>) => Promise<void>,
  extraEnv: Record<string, string> = {},
) {
  const h = installWorkflowHarness(beforeValidate.artifacts, { WORKFLOW_COLD_START: "1", PREFLIGHT_RELAX_EMPTY_SHARDS: "1", ...extraEnv });
  try {
    await fn(h);
  } finally {
    h.restore();
  }
}

async function expectHistoryBlocked(h: ReturnType<typeof installWorkflowHarness>) {
  const pointerBefore = h.store.contents["views/latest.json"];
  const { response } = await drainWorkflowStep(h, beforeValidate.job);
  expect(response.status).toBe(500);
  expect(h.store.contents["views/latest.json"]).toBe(pointerBefore);
  const validation = WorkflowValidation.parse(h.store.json(runPath("validation.json")));
  expect(validation.ok).toBe(false);
  expect(validation.failures).toEqual(expect.arrayContaining(historyFailures));
  expect(validation.invariants).toMatchObject({ cold_start_empty_curve_relaxed: false, cold_start_missing_prior_year_heatmap_relaxed: false });
  expect(WorkflowManifest.parse(h.store.json(runPath("manifest.json"))).status).not.toBe("published");
}

describe("preview cold-start refresh with an empty period inventory", () => {
  beforeAll(async () => {
    const harness = installWorkflowHarness(coldStartSeed(), { WORKFLOW_COLD_START: "1", PREFLIGHT_RELAX_EMPTY_SHARDS: "1" });
    const log = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      if (args[0] === "[workflow-refresh] cold-start validation relaxed") relaxedChecks.push(args);
    });
    try {
      let job = firstRefreshJob(TEST_RUN) as FullJob | null;
      for (let hops = 0; job && hops < 400; hops++) {
        if (job.name === "validate" && !beforeValidate) beforeValidate = { job: structuredClone(job), artifacts: { ...harness.store.contents } };
        const { response, result } = await harness.run(job);
        if (response.status !== 200) {
          failedStep = job.name;
          break;
        }
        steps.push(job.name);
        job = nextRefreshJob(job, result!) as FullJob | null;
      }
      remainingJob = job;
      chain = { store: harness.store, invalidations: harness.invalidations };
    } finally {
      log.mockRestore();
      harness.restore();
    }
  }, 60000);

  test("publishes the first views pointer and marks the run published", () => {
    expect(chain.store.contents["views/latest.json"]).toBeDefined();
    expect(ViewsPointer.parse(chain.store.json("views/latest.json"))).toMatchObject({ version: TEST_RUN, run_id: TEST_RUN, prev_version: null });
    expect(WorkflowManifest.parse(chain.store.json(runPath("manifest.json")))).toMatchObject({ status: "published", published_version: TEST_RUN });
    expect(WorkflowLease.parse(chain.store.json("ops/workflows/active.json"))).toMatchObject({ status: "published", run_id: TEST_RUN });
    expect([...new Set(steps)]).toEqual([...FULL_REFRESH_STEPS]);
    expect(failedStep).toBeNull();
    expect(remainingJob).toBeNull();
    expect(chain.invalidations).toHaveLength(1);
  });

  test("recompute finishes with empty month, week, and year inventories", () => {
    expect(beforeValidate.artifacts["views/latest.json"]).toBeUndefined();
    for (const kind of ["month", "week", "year"]) {
      expect(chain.store.json(runPath(`recompute/${kind}-win/meta.json`))).toMatchObject({ kind, periods: [], complete: true });
    }
    expect(Object.keys(chain.store.contents).filter((path) => /\/rank\/(month|week|year)\//.test(path))).toEqual([]);
    expect(RepoEntity.parse(chain.store.json(`views/${TEST_RUN}/entity/repo/1000.json`)).curve.monthly).toEqual([]);
    expect(chain.store.contents[`views/${TEST_RUN}/heatmap/year/2025.json`]).toBeUndefined();
  });

  test("the period-rank gate accepts the empty inventory and does not block validate", () => {
    expect(steps).toContain("aliases");
    expect(steps).toContain("validate");
    const validation = WorkflowValidation.parse(chain.store.json(runPath("validation.json")));
    expect(validation.invariants).toMatchObject({ period_rank_files_checked: 0 });
    expect(validation.failures.filter((item) => /period inventory|\/recompute\/|^rank\/(month|week|year)\//.test(item))).toEqual([]);
  });

  test("records and logs exactly the two honest missing-history exceptions", () => {
    const validation = WorkflowValidation.parse(chain.store.json(runPath("validation.json")));
    expect(validation).toMatchObject({ ok: true, schema_failures: 0, failures: [], invariants: { sample_curve_months: 0, cold_start_empty_curve_relaxed: true, cold_start_missing_prior_year_heatmap_relaxed: true } });
    expect(relaxedChecks).toEqual(historyFailures.map((check) => ["[workflow-refresh] cold-start validation relaxed", { run_id: TEST_RUN, check }]));
  });

  test("available history passes without reporting either exception", () => atValidate(async (h) => {
    const entityPath = `views/${TEST_RUN}/entity/repo/1000.json`;
    const entity = RepoEntity.parse(h.store.json(entityPath));
    await h.store.set(entityPath, { ...entity, curve: { ...entity.curve, monthly: [["2026-09", 1, 1]] } });
    await h.store.set(`views/${TEST_RUN}/heatmap/year/2025.json`, { meta: { scope: "year", period: "2025", generated_at: "2026-10-02T00:00:00.000Z" }, cells: [["2025-12", 1]] });
    const log = spyOn(console, "log");
    try {
      expect((await drainWorkflowStep(h, beforeValidate.job)).response.status).toBe(200);
      expect(WorkflowValidation.parse(h.store.json(runPath("validation.json")))).toMatchObject({ ok: true, invariants: { cold_start_empty_curve_relaxed: false, cold_start_missing_prior_year_heatmap_relaxed: false } });
      expect(log.mock.calls.some(([message]) => message === "[workflow-refresh] cold-start validation relaxed")).toBe(false);
    } finally {
      log.mockRestore();
    }
  }));

  for (const [label, env] of [
    ["normal refresh without the flag", { WORKFLOW_COLD_START: "" }],
    ["disabled cold start", { WORKFLOW_COLD_START: "0" }],
    ["non-exact flag value", { WORKFLOW_COLD_START: "true" }],
    ["production despite both flags", { DEPLOY_ENV: "production" }],
    ["conflicting production signal", { VERCEL_ENV: "production" }],
    ["unset deployment environment", { DEPLOY_ENV: "" }],
  ] as Array<[string, Record<string, string>]>) {
    test(`${label} still blocks empty curves and the missing prior-year heatmap`, () => atValidate(expectHistoryBlocked, env));
  }

  test("an existing pointer disarms the exceptions even with both flags", () => atValidate(async (h) => {
    await h.store.set("views/latest.json", ViewsPointer.parse(chain.store.json("views/latest.json")));
    await expectHistoryBlocked(h);
  }));

  test("a malformed pointer cannot arm the exceptions", () => atValidate(async (h) => {
    await h.store.set("views/latest.json", { version: TEST_RUN });
    const pointerBefore = h.store.contents["views/latest.json"];
    expect((await drainWorkflowStep(h, beforeValidate.job)).response.status).toBe(500);
    expect(h.store.contents["views/latest.json"]).toBe(pointerBefore);
    expect(h.store.contents[runPath("validation.json")]).toBeUndefined();
  }));

  test("a pointer read failure cannot arm the exceptions", () => atValidate(async (h) => {
    h.store.failRead = true;
    expect((await drainWorkflowStep(h, beforeValidate.job)).response.status).toBe(500);
    expect(h.store.contents["views/latest.json"]).toBeUndefined();
    expect(h.store.contents[runPath("validation.json")]).toBeUndefined();
  }));

  for (const [label, rel, invalidValue] of [
    ["missing repository entity", "entity/repo/1000.json", undefined],
    ["missing non-exempt view", "search/index.json", undefined],
    ["malformed prior-year heatmap", "heatmap/year/2025.json", { cells: [] }],
  ] as const) {
    test(`cold start still rejects a ${label}`, () => atValidate(async (h) => {
      const path = `views/${TEST_RUN}/${rel}`;
      if (invalidValue === undefined) await h.store.del(path);
      else await h.store.set(path, invalidValue);
      expect((await drainWorkflowStep(h, beforeValidate.job)).response.status).toBe(500);
      expect(h.store.contents["views/latest.json"]).toBeUndefined();
      const validation = WorkflowValidation.parse(h.store.json(runPath("validation.json")));
      expect(validation.ok).toBe(false);
      expect(validation.failures.some((failure) => failure.startsWith(`${rel}: ${invalidValue === undefined ? "missing" : "schema"}`))).toBe(true);
      if (invalidValue !== undefined) {
        expect(validation.schema_failures).toBeGreaterThan(0);
        expect(validation.invariants.cold_start_missing_prior_year_heatmap_relaxed).toBe(false);
      }
    }));
  }
});
