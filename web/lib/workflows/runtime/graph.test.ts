import { describe, expect, test } from "bun:test";
import { nextRefreshJob } from "./graph";
import { firstRefreshJob, type RefreshStepJob } from "./types";

function full(name: RefreshStepJob["name"], cursor: RefreshStepJob["cursor"] = {}): Extract<RefreshStepJob, { graph: "full" }> {
  return { v: 1, graph: "full", runId: "refresh-test", name: name as Extract<RefreshStepJob, { graph: "full" }>["name"], attempt: 0, cursor };
}

describe("refresh step graph", () => {
  test("starts a full refresh at startRun", () => {
    expect(firstRefreshJob("refresh-1")).toEqual({
      v: 1,
      graph: "full",
      runId: "refresh-1",
      name: "startRun",
      attempt: 0,
      cursor: {},
    });
  });

  test("walks the full chain and splits metadata by bucket", () => {
    const names: string[] = [];
    let job: RefreshStepJob | null = firstRefreshJob("refresh-1");
    while (job) {
      names.push(job.name === "metadata" ? `metadata-${job.cursor.bucket ?? 0}` : job.name);
      job = nextRefreshJob(job, { name: job.name, startedAt: "2026-09-16T00:00:00.000Z", fencingToken: 2, repos: 1 }, 2);
    }
    expect(names).toEqual([
      "startRun",
      "preflight",
      "whitelist",
      "rename",
      "metadata-0",
      "metadata-1",
      "fold",
      "recomputeRank",
      "recomputeRepoEntities",
      "recomputeOrgEntities",
      "recomputeHeatmap",
      "aliases",
      "validate",
      "publish",
      "gc",
      "markPublished",
    ]);
  });

  test("carries fencing token and startedAt through later jobs", () => {
    const next = nextRefreshJob(full("startRun"), {
      name: "startRun",
      startedAt: "2026-09-16T06:00:00.000Z",
      fencingToken: 9,
    });
    expect(next?.cursor).toEqual({ startedAt: "2026-09-16T06:00:00.000Z", fencingToken: 9 });
  });

  test("fixture graph is the shrink-refresh path", () => {
    const names: string[] = [];
    let job: RefreshStepJob | null = firstRefreshJob("refresh-fixture", "fixture");
    while (job) {
      names.push(job.name);
      job = nextRefreshJob(job, { name: job.name, startedAt: "t", fencingToken: 1 });
    }
    expect(names).toEqual(["startRun", "writeViews", "complete"]);
  });
});
