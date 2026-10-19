import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { WorkflowValidation } from "@/lib/contracts";
import { nextRefreshJob } from "./graph";
import { firstRefreshJob } from "./types";
import { installWorkflowHarness, TEST_RUN, workflowSeed, type FullJob } from "../test-support";

/** First preview refresh: WORKFLOW_COLD_START=1, no views pointer, no canonical series history. */
function coldStartSeed(): Record<string, string> {
  const dropped = /^(canonical\/v2\/(repo-monthly|repo-weekly|repo-recent-daily|pending|site-daily|repos)\/|canonical\/v2\/meta\.json$|canonical\/v2\/whitelist\/refresh-|views\/(latest\.json$|refresh-2025))/;
  return Object.fromEntries(Object.entries(workflowSeed()).filter(([path]) => !dropped.test(path)));
}

let harness: ReturnType<typeof installWorkflowHarness>;
const steps: string[] = [];
let failedStep: string | null = null;

describe("preview cold-start refresh with an empty period inventory", () => {
  beforeAll(async () => {
    harness = installWorkflowHarness(coldStartSeed(), { WORKFLOW_COLD_START: "1", PREFLIGHT_RELAX_EMPTY_SHARDS: "1" });
    let job = firstRefreshJob(TEST_RUN) as FullJob | null;
    for (let hops = 0; job && hops < 400; hops++) {
      const { response, result } = await harness.run(job);
      if (response.status !== 200) {
        failedStep = job.name;
        break;
      }
      steps.push(job.name);
      job = nextRefreshJob(job, result!) as FullJob | null;
    }
  }, 60000);
  afterAll(() => harness?.restore());

  test("recompute finishes with empty month, week, and year inventories", () => {
    expect(harness.store.contents["views/latest.json"]).toBeUndefined();
    for (const kind of ["month", "week", "year"]) {
      expect(harness.store.json(`ops/workflows/${TEST_RUN}/recompute/${kind}-win/meta.json`)).toMatchObject({ kind, periods: [], complete: true });
    }
    expect(Object.keys(harness.store.contents).filter((path) => /\/rank\/(month|week|year)\//.test(path))).toEqual([]);
  });

  test("the period-rank gate accepts the empty inventory and does not block validate", () => {
    expect(steps).toContain("aliases");
    expect(failedStep).toBe("validate");
    const validation = WorkflowValidation.parse(harness.store.json(`ops/workflows/${TEST_RUN}/validation.json`));
    expect(validation.invariants).toMatchObject({ period_rank_files_checked: 0 });
    expect(validation.failures.filter((item) => /period inventory|\/recompute\/|^rank\/(month|week|year)\//.test(item))).toEqual([]);
  });

  // Not part of the period-rank gate: an empty-history universe still trips these two
  // pre-existing `validate` checks (top repo curve, prior-year heatmap). Recorded so a
  // later change that supplies history must update this expectation deliberately.
  test("cold start still stops at two pre-existing validate checks outside this gate", () => {
    const validation = WorkflowValidation.parse(harness.store.json(`ops/workflows/${TEST_RUN}/validation.json`));
    expect(validation.ok).toBe(false);
    expect(validation.failures).toEqual(["entity/repo/1000: empty curve", "heatmap/year/2025.json: missing"]);
  });
});
