import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { ViewsPointer, WhitelistSnapshot } from "@/lib/contracts";
import * as write from "@/lib/data/write";
import * as alert from "@/lib/observability/alert";
import * as health from "@/lib/observability/health";
import { QUEUE_ADVANCE_CONSUMER, QUEUE_ADVANCE_HEADER, QUEUE_SUCCESSOR_HEADER } from "@/lib/workers-host/queue-advance";
import * as lease from "@/lib/workflows/lease";
import * as owned from "@/lib/workflows/owned-write";
import { publishVersionWithDeps, type PublicationDeps } from "@/lib/workflows/publication-core";
import {
  requestPublishedViewsInvalidation,
  resolvePublicationInvalidationTarget,
  type InvalidationFetch,
} from "@/lib/workflows/publication-invalidation-request";
import { firstRefreshJob, type FullRefreshStepName, type RefreshStepJob } from "./types";
import { refreshStepCheckpointName, runRefreshStepRoute } from "./step-route";

const originalSecret = process.env.CRON_SECRET;
const originalRuntime = process.env.WORKFLOW_RUNTIME;

beforeEach(() => {
  process.env.CRON_SECRET = "secret";
  process.env.WORKFLOW_RUNTIME = "memory";
});

afterEach(() => {
  if (originalSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = originalSecret;
  if (originalRuntime === undefined) delete process.env.WORKFLOW_RUNTIME;
  else process.env.WORKFLOW_RUNTIME = originalRuntime;
});

function post(body: unknown, url = "https://gitstarclub.com/api/workflows/refresh/step"): Request {
  return new Request(url, {
    method: "POST",
    headers: { authorization: "Bearer secret", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("runRefreshStepRoute", () => {
  test("rejects missing bearer tokens", async () => {
    const response = await runRefreshStepRoute(
      new Request("https://gitstarclub.com/api/workflows/refresh/step", { method: "POST", body: "{}" }),
    );
    expect(response.status).toBe(401);
  });

  test("rejects fixture jobs on the HTTP route", async () => {
    const executeFixture = mock(async () => ({ name: "startRun" }));
    const response = await runRefreshStepRoute(post(firstRefreshJob("refresh-1", "fixture")), {
      recordCheckpoint: async () => {},
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: "Fixture refresh is not allowed on this runtime" });
    expect(executeFixture).not.toHaveBeenCalled();
  });

  test("rejects fixture jobs when DEPLOY_ENV=production", async () => {
    const executeFixture = mock(async () => ({ name: "startRun" }));
    const response = await runRefreshStepRoute(post(firstRefreshJob("refresh-1", "fixture")), {
      env: { NODE_ENV: "test", DEPLOY_ENV: "production" },
      executeFixture,
      recordCheckpoint: async () => {},
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: "Fixture refresh is not allowed on this runtime" });
    expect(executeFixture).not.toHaveBeenCalled();
  });

  test("rejects fixture jobs when HOSTING_TARGET=cf and DEPLOY_ENV is unset or invalid", async () => {
    const executeFixture = mock(async () => ({ name: "startRun" }));
    const unset = await runRefreshStepRoute(post(firstRefreshJob("refresh-1", "fixture")), {
      env: { NODE_ENV: "test", HOSTING_TARGET: "cf" },
      executeFixture,
      recordCheckpoint: async () => {},
    });
    expect(unset.status).toBe(400);
    expect(await unset.json()).toEqual({ ok: false, error: "Fixture refresh is not allowed on this runtime" });
    const misspelled = await runRefreshStepRoute(post(firstRefreshJob("refresh-1", "fixture")), {
      env: { NODE_ENV: "test", HOSTING_TARGET: "cf", DEPLOY_ENV: "staging" },
      executeFixture,
      recordCheckpoint: async () => {},
    });
    expect(misspelled.status).toBe(400);
    expect(executeFixture).not.toHaveBeenCalled();
  });

  test("runs a fixture step on HOSTING_TARGET=cf when DEPLOY_ENV=pre", async () => {
    const executeFixture = mock(async () => ({ name: "startRun" }));
    const response = await runRefreshStepRoute(post(firstRefreshJob("refresh-1", "fixture")), {
      env: { NODE_ENV: "test", HOSTING_TARGET: "cf", DEPLOY_ENV: "pre" },
      kind: "memory",
      executeFixture,
      recordCheckpoint: async () => {},
    });
    expect(response.status).toBe(200);
    expect(executeFixture).toHaveBeenCalledTimes(1);
  });

  test("runs a fixture step on DEPLOY_ENV=pre when an executor is configured", async () => {
    const executeFixture = mock(async () => ({ name: "startRun" }));
    const response = await runRefreshStepRoute(post(firstRefreshJob("refresh-1", "fixture")), {
      env: { NODE_ENV: "test", DEPLOY_ENV: "pre" },
      kind: "memory",
      executeFixture,
      recordCheckpoint: async () => {},
    });
    expect(response.status).toBe(200);
    expect(executeFixture).toHaveBeenCalledTimes(1);
  });

  test("executes one full step and completes it", async () => {
    const executeFull = mock(async () => ({ name: "startRun", startedAt: "2026-09-16T00:00:00.000Z", fencingToken: 4 }));
    const complete: string[] = [];
    const response = await runRefreshStepRoute(post(firstRefreshJob("refresh-1")), {
      kind: "memory",
      executeFull,
      recordCheckpoint: async (job) => {
        complete.push(`checkpoint:${job.name}`);
      },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, runId: "refresh-1", step: "startRun" });
    expect(executeFull).toHaveBeenCalledTimes(1);
    expect(complete).toEqual(["checkpoint:startRun"]);
  });

  test("names preflight checkpoints by bucket window", async () => {
    const names: string[] = [];
    const job = {
      v: 1 as const,
      graph: "full" as const,
      runId: "refresh-1",
      name: "preflight" as const,
      attempt: 0,
      cursor: { preflightOffset: 8 },
    };
    expect(refreshStepCheckpointName(job)).toBe("preflight-8");
    const response = await runRefreshStepRoute(post(job), {
      kind: "memory",
      executeFull: async () => ({ name: "preflight", nextPreflightOffset: 12 }),
      recordCheckpoint: async (current) => {
        names.push(refreshStepCheckpointName(current));
      },
    });
    expect(response.status).toBe(200);
    expect(names).toEqual(["preflight-8"]);
  });

  test("names recompute checkpoints by phase", () => {
    expect(
      refreshStepCheckpointName({
        v: 1,
        graph: "full",
        runId: "refresh-1",
        name: "recomputeRank",
        attempt: 0,
        cursor: {},
      }),
    ).toBe("recomputeRank-month-pack");
    expect(
      refreshStepCheckpointName({
        v: 1,
        graph: "full",
        runId: "refresh-1",
        name: "recomputeRank",
        attempt: 0,
        cursor: { recomputePhase: "monthOrg" },
      }),
    ).toBe("recomputeRank-monthOrg");
    expect(
      refreshStepCheckpointName({
        v: 1,
        graph: "full",
        runId: "refresh-1",
        name: "recomputeRank",
        attempt: 0,
        cursor: { recomputePhase: "week" },
      }),
    ).toBe("recomputeRank-week-pack");
    expect(
      refreshStepCheckpointName({
        v: 1,
        graph: "full",
        runId: "refresh-1",
        name: "recomputeRank",
        attempt: 0,
        cursor: { recomputePhase: "week", recomputeOffset: 8 },
      }),
    ).toBe("recomputeRank-week-8");
  });

  test("names whitelist Search hops by sequence", () => {
    expect(
      refreshStepCheckpointName({
        v: 1,
        graph: "full",
        runId: "refresh-1",
        name: "whitelist",
        attempt: 0,
        cursor: {},
      }),
    ).toBe("whitelist-0");
    expect(
      refreshStepCheckpointName({
        v: 1,
        graph: "full",
        runId: "refresh-1",
        name: "whitelist",
        attempt: 0,
        cursor: { whitelistSearchSeq: 2 },
      }),
    ).toBe("whitelist-2");
  });

  test("names fold checkpoints by phase and sequence", () => {
    expect(
      refreshStepCheckpointName({
        v: 1,
        graph: "full",
        runId: "refresh-1",
        name: "fold",
        attempt: 0,
        cursor: { foldPhase: "week", foldSeq: 3 },
      }),
    ).toBe("fold-week-3");
    expect(
      refreshStepCheckpointName({
        v: 1,
        graph: "full",
        runId: "refresh-1",
        name: "fold",
        attempt: 0,
        cursor: {},
      }),
    ).toBe("fold-month-0");
  });

  test("cf-queue consumer header skips completeStep after fold so the isolate does not POST /enqueue", async () => {
    const enqueues: unknown[] = [];
    const job = {
      v: 1 as const,
      graph: "full" as const,
      runId: "refresh-1",
      name: "fold" as const,
      attempt: 0,
      cursor: { startedAt: "2026-09-20T09:39:26.949Z", fencingToken: 22 },
    };
    const headers = {
      authorization: "Bearer secret",
      "content-type": "application/json",
      [QUEUE_ADVANCE_HEADER]: QUEUE_ADVANCE_CONSUMER,
    };
    const response = await runRefreshStepRoute(
      new Request("https://pre.gitstarclub.com/api/workflows/refresh/step", {
        method: "POST",
        headers,
        body: JSON.stringify(job),
      }),
      {
        kind: "cf-queue",
        env: {
          ...process.env,
          CRON_SECRET: "secret",
          WORKFLOW_QUEUE_ENQUEUE_URL: "https://pre.gitstarclub.com/enqueue",
        },
        fetchImpl: async (_url, init) => {
          enqueues.push(JSON.parse(String(init?.body)));
          return new Response("queued", { status: 200 });
        },
        executeFull: async () => ({ name: "fold", folded: ["2026-08"], foldedWeeks: [] }),
        recordCheckpoint: async () => {},
      },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, runId: "refresh-1", step: "fold" });
    expect(enqueues).toEqual([]);
    expect(JSON.parse(response.headers.get(QUEUE_SUCCESSOR_HEADER) ?? "null")).toMatchObject({
      name: "recomputeRank",
      runId: "refresh-1",
    });
  });

  test("cf-queue direct POST still completeSteps fold → recomputeRank", async () => {
    const enqueues: unknown[] = [];
    const job = {
      v: 1 as const,
      graph: "full" as const,
      runId: "refresh-1",
      name: "fold" as const,
      attempt: 0,
      cursor: { startedAt: "2026-09-20T09:39:26.949Z", fencingToken: 22 },
    };
    const response = await runRefreshStepRoute(post(job), {
      kind: "cf-queue",
      env: {
        ...process.env,
        CRON_SECRET: "secret",
        WORKFLOW_QUEUE_ENQUEUE_URL: "https://pre.gitstarclub.com/enqueue",
      },
      fetchImpl: async (_url, init) => {
        enqueues.push(JSON.parse(String(init?.body)));
        return new Response("queued", { status: 200 });
      },
      executeFull: async () => ({ name: "fold", folded: [], foldedWeeks: [] }),
      recordCheckpoint: async () => {},
    });
    expect(response.status).toBe(200);
    expect(enqueues).toEqual([
      {
        v: 1,
        graph: "full",
        runId: "refresh-1",
        name: "recomputeRank",
        attempt: 0,
        cursor: { startedAt: "2026-09-20T09:39:26.949Z", fencingToken: 22 },
      },
    ]);
  });

  test("records a failed full step after retries are exhausted", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await runRefreshStepRoute(post(firstRefreshJob("refresh-1")), {
        kind: "memory",
        retry: { retries: 0, delaysMs: [] },
        executeFull: async () => {
          throw new Error("boom");
        },
        recordCheckpoint: async () => {},
      });
      expect(response.status).toBe(500);
      expect(await response.json()).toMatchObject({ ok: false, runId: "refresh-1" });
    } finally {
      errorSpy.mockRestore();
    }
  });

  test("step response redacts punctuation and JSON-escaped assignments", async () => {
    const putSpy = spyOn(write, "putView").mockResolvedValue(undefined as never);
    try {
      const response = await runRefreshStepRoute(post(firstRefreshJob("refresh-1")), {
        kind: "memory",
        executeFull: async () => ({
          name: "startRun",
          error: [
            "GitHub GraphQL 502",
            "password=!CANARYpunctuation42",
            "token=CANARYstart:CANARYtail!",
            String.raw`password=\"!CANARYescaped42\"`,
          ].join(" "),
        }),
      });
      expect(response.status).toBe(200);
      const body = JSON.stringify(await response.json());
      const stored = JSON.stringify(putSpy.mock.calls);
      expect(body).toContain("GitHub GraphQL 502");
      expect(stored).toContain("GitHub GraphQL 502");
      expect(body).not.toContain("CANARY");
      expect(stored).not.toContain("CANARY");
    } finally {
      putSpy.mockRestore();
    }
  });

  test("step failure logs omit secret canaries and keep the failure category", async () => {
    const canary = "ghp_CANARYGITHUBTOKEN1234567890abcd";
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await runRefreshStepRoute(post(firstRefreshJob("refresh-1")), {
        kind: "memory",
        retry: { retries: 0, delaysMs: [] },
        executeFull: async () => {
          throw new Error(`GitHub GraphQL 502 Bearer CANARYBEARERTOKEN1234567890abcd ${canary}`);
        },
        recordCheckpoint: async () => {},
      });
      expect(response.status).toBe(500);
      const body = JSON.stringify(await response.json());
      const logged = JSON.stringify(errorSpy.mock.calls);
      expect(logged).toContain("GitHub GraphQL 502");
      expect(logged).not.toContain("CANARY");
      expect(body).not.toContain("CANARY");
      expect(body).toContain("Internal server error");
    } finally {
      errorSpy.mockRestore();
    }
  });

  test("step checkpoint JSON and the response omit secret canaries", async () => {
    const canary = "ghp_CANARYGITHUBTOKEN1234567890abcd";
    const putSpy = spyOn(write, "putView").mockResolvedValue(undefined as never);
    try {
      const response = await runRefreshStepRoute(post(firstRefreshJob("refresh-1")), {
        kind: "memory",
        executeFull: async () => ({
          name: "startRun",
          error: `GitHub GraphQL 502 Bearer CANARYBEARERTOKEN1234567890abcd ${canary}`,
        }),
      });
      expect(response.status).toBe(200);
      const body = JSON.stringify(await response.json());
      const stored = JSON.stringify(putSpy.mock.calls);
      expect(body).toContain("GitHub GraphQL 502");
      expect(stored).toContain("GitHub GraphQL 502");
      expect(body).not.toContain("CANARY");
      expect(stored).not.toContain("CANARY");
    } finally {
      putSpy.mockRestore();
    }
  });
});

describe("publish failures after the pointer commit", () => {
  const runId = "refresh-643";
  const startedAt = "2026-10-02T00:00:00.000Z";
  const fencingToken = 9;
  // Preview Worker vars (typed config env.pre): no NEXT_PUBLIC_SITE_URL, no VERCEL_URL.
  const previewEnv = {
    HOSTING_TARGET: "cf",
    DEPLOY_ENV: "pre",
    CF_CRON_ORIGIN: "https://pre.gitstarclub.com",
    CRON_SECRET: "secret",
  };

  let putOwned: ReturnType<typeof spyOn>;
  let release: ReturnType<typeof spyOn>;
  let sendAlert: ReturnType<typeof spyOn>;
  let recordHealth: ReturnType<typeof spyOn>;
  let consoleError: ReturnType<typeof spyOn>;
  let networkGuard: ReturnType<typeof spyOn>;

  beforeEach(() => {
    // Every callback goes through the injected fetch capture. A real network
    // call would mean the resolver ignored it, so fail instead of sending one.
    networkGuard = spyOn(globalThis, "fetch").mockImplementation((() => {
      throw new Error("unexpected network call from a publication test");
    }) as unknown as typeof fetch);
    putOwned = spyOn(owned, "putOwnedView").mockResolvedValue(undefined as never);
    release = spyOn(lease, "releaseWorkflowLease").mockResolvedValue(true);
    sendAlert = spyOn(alert, "sendAlert").mockResolvedValue(undefined as never);
    recordHealth = spyOn(health, "recordHealth").mockResolvedValue(undefined as never);
    consoleError = spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    networkGuard.mockRestore();
    putOwned.mockRestore();
    release.mockRestore();
    sendAlert.mockRestore();
    recordHealth.mockRestore();
    consoleError.mockRestore();
  });

  function job(name: FullRefreshStepName): RefreshStepJob {
    return { v: 1, graph: "full", runId, name, attempt: 0, cursor: { startedAt, fencingToken } };
  }

  function storedAt(suffix: string): Record<string, unknown> | undefined {
    const call = putOwned.mock.calls.find((args: unknown[]) => String(args[1]).endsWith(suffix));
    return call?.[2] as Record<string, unknown> | undefined;
  }

  function memoryPublication(invalidate: () => Promise<void>, checkInvalidationTarget: () => void = () => {}) {
    const snapshot: WhitelistSnapshot = {
      run_id: runId,
      generated_at: "2026-10-01T00:00:00.000Z",
      count: 1,
      entries: [{ id: 1, node_id: "node-1", full_name: "owner/repo-1", owner: "owner", name: "repo-1", stars: 10_001 }],
      diff: { added: [1], dropped: [] },
    };
    const state = {
      pointer: {
        version: "refresh-previous",
        run_id: "refresh-previous",
        published_at: "2026-09-27T00:00:00.000Z",
        prev_version: null,
        schema_ver: 1,
      } as ViewsPointer | null,
      intent: null as Parameters<PublicationDeps["createIntent"]>[1] | null,
      recoveryVersion: null as string | null,
    };
    const deps: PublicationDeps = {
      readPointer: async () => state.pointer,
      readIntent: async () => state.intent,
      createIntent: async (_operationId, intent) => {
        if (state.intent) return false;
        state.intent = structuredClone(intent);
        return true;
      },
      readWhitelistSnapshot: async (version) => (version === runId ? snapshot : null),
      writePointer: async (next) => {
        state.pointer = structuredClone(next);
      },
      writeRecovery: async (recovery) => {
        state.recoveryVersion = recovery.version;
      },
      writeWhitelistPointer: async () => {},
      ensureOwnership: async () => {},
      checkInvalidationTarget,
      invalidate,
      notifyIndexNow: async () => null,
      prepareRelease: async (intent) => ({
        id: intent.version, published_at: intent.published_at, prev_version: intent.prev_version,
        tracked_repo_count: 1, skipped_repo_count: 0, data_as_of: { seam_date: "2026-10-01" },
      }),
      appendRelease: async () => {},
      now: () => "2026-10-02T01:00:00.000Z",
    };
    return { state, deps };
  }

  function runPublish(deps: PublicationDeps) {
    return runRefreshStepRoute(post(job("publish")), {
      kind: "memory",
      retry: { retries: 1, delaysMs: [0] },
      recordCheckpoint: async () => {},
      executeFull: async (current) => ({
        name: current.name,
        ...(await publishVersionWithDeps(current.runId, current.cursor.fencingToken ?? -1, deps)),
      }),
    });
  }

  test("a permanent preview invalidation failure records the live version and failing step", async () => {
    const calls: string[] = [];
    const fetchImpl: InvalidationFetch = async (url) => {
      calls.push(url);
      return new Response("unavailable", { status: 503 });
    };
    const { state, deps } = memoryPublication(
      () => requestPublishedViewsInvalidation({ env: previewEnv, fetchImpl }),
      () => {
        resolvePublicationInvalidationTarget(previewEnv);
      },
    );

    const response = await runPublish(deps);

    expect(response.status).toBe(500);
    expect(calls).toEqual([
      "https://pre.gitstarclub.com/api/workflows/refresh/revalidate",
      "https://pre.gitstarclub.com/api/workflows/refresh/revalidate",
    ]);
    expect(state.pointer?.version).toBe(runId);
    expect(state.pointer?.prev_version).toBe("refresh-previous");
    expect(state.recoveryVersion).toBe(runId);
    expect(storedAt("/manifest.json")).toMatchObject({ run_id: runId, status: "failed", published_version: runId });
    expect(storedAt("/error.json")).toMatchObject({
      run_id: runId,
      phase: "post_commit",
      committed_version: runId,
      failed_step: "invalidate",
      error: `version ${runId} is live; post-commit invalidate failed: publication cache invalidation POST https://pre.gitstarclub.com/api/workflows/refresh/revalidate -> 503`,
    });
    expect(release).toHaveBeenCalledWith(runId, "failed", undefined, undefined, fencingToken);
    expect(sendAlert).toHaveBeenCalledWith(
      expect.objectContaining({ title: "managed refresh published; post-commit step failed", step: "invalidate" }),
    );
    expect(networkGuard).not.toHaveBeenCalled();
  });

  test("the in-step retry replays the intent and repairs a transient invalidation failure", async () => {
    const statuses = [503, 200];
    const calls: string[] = [];
    const fetchImpl: InvalidationFetch = async (url) => {
      calls.push(url);
      return new Response(null, { status: statuses.shift() ?? 500 });
    };
    const { state, deps } = memoryPublication(() => requestPublishedViewsInvalidation({ env: previewEnv, fetchImpl }));

    const response = await runPublish(deps);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, step: "publish", result: { version: runId } });
    expect(calls).toHaveLength(2);
    expect(state.pointer).toMatchObject({ version: runId, prev_version: "refresh-previous" });
    expect(storedAt("/manifest.json")).toBeUndefined();
    expect(storedAt("/error.json")).toBeUndefined();
    expect(release).not.toHaveBeenCalled();
  });

  test("a failure before the pointer commit keeps published_version null", async () => {
    const { state, deps } = memoryPublication(async () => {});
    deps.writePointer = async () => {
      throw new Error("pointer write 500");
    };

    const response = await runPublish(deps);

    expect(response.status).toBe(500);
    expect(state.pointer?.version).toBe("refresh-previous");
    expect(storedAt("/manifest.json")).toMatchObject({ status: "failed", published_version: null });
    expect(storedAt("/error.json")).toMatchObject({ phase: "pre_commit", error: "pointer write 500" });
    expect(storedAt("/error.json")).not.toHaveProperty("committed_version");
  });

  test.each([
    ["after the pointer write", false],
    ["after the recovery write", true],
  ])("a lease lost %s is not retried and records the live version", async (_label, afterRecovery) => {
    const { state, deps } = memoryPublication(async () => {});
    let writes = 0;
    const writePointer = deps.writePointer;
    deps.writePointer = async (next) => {
      writes++;
      return writePointer(next);
    };
    deps.ensureOwnership = async () => {
      const switched = state.pointer?.version === runId;
      if (switched && (!afterRecovery || state.recoveryVersion === runId)) {
        throw new lease.WorkflowLeaseOwnershipError(`lost fencing token ${fencingToken}`);
      }
    };

    const response = await runPublish(deps);

    expect(response.status).toBe(500);
    expect(writes).toBe(1);
    expect(state.pointer?.version).toBe(runId);
    expect(state.recoveryVersion).toBe(afterRecovery ? runId : null);
    expect(storedAt("/manifest.json")).toMatchObject({ status: "failed", published_version: runId });
    expect(storedAt("/error.json")).toMatchObject({
      phase: "post_commit",
      committed_version: runId,
      failed_step: "ownership",
    });
  });

  test("a lease lost before the pointer write stays a pre-commit failure", async () => {
    const { state, deps } = memoryPublication(async () => {});
    deps.ensureOwnership = async () => {
      throw new lease.WorkflowLeaseOwnershipError("lost fencing token");
    };

    const response = await runPublish(deps);

    expect(response.status).toBe(500);
    expect(state.pointer?.version).toBe("refresh-previous");
    expect(storedAt("/manifest.json")).toMatchObject({ status: "failed", published_version: null });
    expect(storedAt("/error.json")).toMatchObject({ phase: "pre_commit" });
  });

  test("a preview without CF_CRON_ORIGIN fails before the pointer switch and sends nothing", async () => {
    const brokenEnv = { HOSTING_TARGET: "cf", DEPLOY_ENV: "pre", CRON_SECRET: "secret" };
    const calls: string[] = [];
    const fetchImpl: InvalidationFetch = async (url) => {
      calls.push(url);
      return new Response(null, { status: 200 });
    };
    const { state, deps } = memoryPublication(
      () => requestPublishedViewsInvalidation({ env: brokenEnv, fetchImpl }),
      () => {
        resolvePublicationInvalidationTarget(brokenEnv);
      },
    );

    const response = await runPublish(deps);

    expect(response.status).toBe(500);
    expect(calls).toEqual([]);
    expect(state.pointer?.version).toBe("refresh-previous");
    expect(state.recoveryVersion).toBeNull();
    expect(storedAt("/manifest.json")).toMatchObject({ status: "failed", published_version: null });
    expect(storedAt("/error.json")).toMatchObject({ phase: "pre_commit" });
    expect(String(storedAt("/error.json")?.error)).toMatch(/CF_CRON_ORIGIN is required/);
  });

  test("an unreadable pointer after a failed pointer write records an unknown commit state", async () => {
    const { state, deps } = memoryPublication(async () => {});
    deps.writePointer = async (next) => {
      state.pointer = structuredClone(next);
      throw new Error("pointer write response lost");
    };
    let reads = 0;
    deps.readPointer = async () => {
      reads++;
      if (reads > 1) throw new Error("pointer read 503");
      return state.pointer;
    };

    const response = await runRefreshStepRoute(post(job("publish")), {
      kind: "memory",
      retry: { retries: 0, delaysMs: [] },
      recordCheckpoint: async () => {},
      executeFull: async (current) => ({
        name: current.name,
        ...(await publishVersionWithDeps(current.runId, current.cursor.fencingToken ?? -1, deps)),
      }),
    });

    expect(response.status).toBe(500);
    expect(storedAt("/manifest.json")).toMatchObject({ status: "failed", published_version: null });
    expect(storedAt("/error.json")).toMatchObject({
      phase: "commit_unknown",
      candidate_version: runId,
      failed_step: "pointer",
    });
  });

  for (const name of ["gc", "markPublished"] as const) {
    test(`a ${name} failure after publish records the run's version as committed`, async () => {
      const response = await runRefreshStepRoute(post(job(name)), {
        kind: "memory",
        retry: { retries: 0, delaysMs: [] },
        recordCheckpoint: async () => {},
        executeFull: async () => {
          throw new Error(`${name} blew up`);
        },
      });

      expect(response.status).toBe(500);
      expect(storedAt("/manifest.json")).toMatchObject({ status: "failed", published_version: runId });
      expect(storedAt("/error.json")).toMatchObject({
        phase: "post_commit",
        committed_version: runId,
        failed_step: name,
        error: `${name} blew up`,
      });
    });
  }

  test("an earlier step failure stays a pre-commit failure", async () => {
    const response = await runRefreshStepRoute(post(job("validate")), {
      kind: "memory",
      retry: { retries: 0, delaysMs: [] },
      recordCheckpoint: async () => {},
      executeFull: async () => {
        throw new Error("validate blew up");
      },
    });

    expect(response.status).toBe(500);
    expect(storedAt("/manifest.json")).toMatchObject({ status: "failed", published_version: null });
    expect(storedAt("/error.json")).toMatchObject({ phase: "pre_commit", error: "validate blew up" });
  });
});
