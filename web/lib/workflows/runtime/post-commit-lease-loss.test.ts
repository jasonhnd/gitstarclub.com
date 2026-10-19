import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { ViewsPointer, WhitelistSnapshot, WorkflowLease } from "@/lib/contracts";
import * as alert from "@/lib/observability/alert";
import * as health from "@/lib/observability/health";
import { MemoryObjectStore } from "@/lib/storage";
import * as storage from "@/lib/storage";
import { recordPostCommitLeaseLoss } from "@/lib/workflows/checkpoint";
import { renewWorkflowLease } from "@/lib/workflows/lease";
import { publishVersionWithDeps, type PublicationDeps } from "@/lib/workflows/publication-core";
import type { RefreshStepJob } from "./types";
import { runRefreshStepRoute } from "./step-route";

// A real lease loss after the pointer switch. putOwnedView, renewWorkflowLease,
// createView, and the lease store are the production code on an in-memory
// object store; only observability and the publication side effects are fakes.

const runId = "refresh-643";
const startedAt = "2026-10-02T00:00:00.000Z";
const fencingToken = 9;
const ACTIVE = "ops/workflows/active.json";
const RECORD = `ops/workflows/${runId}/post-commit-failure.json`;

function lease(overrides: Partial<WorkflowLease>): WorkflowLease {
  return {
    run_id: runId,
    status: "running",
    acquired_at: startedAt,
    expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    fencing_token: fencingToken,
    ...overrides,
  };
}

const successor = lease({ run_id: "refresh-successor", fencing_token: 10 });
const expired = lease({ expires_at: new Date(Date.now() - 60 * 1000).toISOString() });

describe("a real lease loss after the pointer switch", () => {
  let store: MemoryObjectStore;
  let sendAlert: ReturnType<typeof spyOn>;
  let recordHealth: ReturnType<typeof spyOn>;
  let consoleError: ReturnType<typeof spyOn>;
  let getStore: ReturnType<typeof spyOn>;
  const originalSecret = process.env.CRON_SECRET;

  beforeEach(() => {
    process.env.CRON_SECRET = "secret";
    store = new MemoryObjectStore({ [ACTIVE]: JSON.stringify(lease({})) });
    getStore = spyOn(storage, "getWriteObjectStore").mockReturnValue(store);
    sendAlert = spyOn(alert, "sendAlert").mockResolvedValue(undefined as never);
    recordHealth = spyOn(health, "recordHealth").mockResolvedValue(undefined as never);
    consoleError = spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = originalSecret;
    getStore.mockRestore();
    sendAlert.mockRestore();
    recordHealth.mockRestore();
    consoleError.mockRestore();
  });

  async function bodyOf(path: string): Promise<string | undefined> {
    return (await store.get(path))?.body;
  }

  function takeLease(replacement: WorkflowLease): Promise<unknown> {
    return store.put(ACTIVE, JSON.stringify(replacement), { allowOverwrite: true, contentType: "application/json" });
  }

  function publication(onWrite: { pointer?: () => Promise<unknown>; recovery?: () => Promise<unknown> }) {
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
      pointerWrites: 0,
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
        state.pointerWrites++;
        state.pointer = structuredClone(next);
        await onWrite.pointer?.();
      },
      writeRecovery: async () => {
        await onWrite.recovery?.();
      },
      writeWhitelistPointer: async () => {},
      // The production ownership check: a real lease renewal.
      ensureOwnership: async (owner) => {
        await renewWorkflowLease(owner.runId, owner.fencingToken);
      },
      checkInvalidationTarget: () => {},
      invalidate: async () => {},
      notifyIndexNow: async () => null,
      now: () => "2026-10-02T01:00:00.000Z",
    };
    return { state, deps };
  }

  function runPublish(deps: PublicationDeps) {
    const job: RefreshStepJob = {
      v: 1,
      graph: "full",
      runId,
      name: "publish",
      attempt: 0,
      cursor: { startedAt, fencingToken },
    };
    return runRefreshStepRoute(
      new Request("https://gitstarclub.com/api/workflows/refresh/step", {
        method: "POST",
        headers: { authorization: "Bearer secret", "content-type": "application/json" },
        body: JSON.stringify(job),
      }),
      {
        kind: "memory",
        retry: { retries: 2, delaysMs: [0, 0] },
        recordCheckpoint: async () => {},
        executeFull: async (current) => ({
          name: current.name,
          ...(await publishVersionWithDeps(current.runId, current.cursor.fencingToken ?? -1, deps)),
        }),
      },
    );
  }

  const cases: Array<[string, "pointer" | "recovery", string, WorkflowLease]> = [
    ["superseded after the pointer write", "pointer", "superseded", successor],
    ["expired after the pointer write", "pointer", "expired", expired],
    ["superseded after the recovery write", "recovery", "superseded", successor],
    ["expired after the recovery write", "recovery", "expired", expired],
  ];

  test.each(cases)("a lease %s leaves a run-scoped record and keeps the active lease", async (_label, when, _kind, lost) => {
    const { state, deps } = publication({ [when]: () => takeLease(lost) });
    const lostBody = JSON.stringify(lost);

    const response = await runPublish(deps);

    expect(response.status).toBe(500);
    expect(state.pointerWrites).toBe(1);
    expect(state.pointer?.version).toBe(runId);
    expect(JSON.parse((await bodyOf(RECORD)) ?? "null")).toMatchObject({
      run_id: runId,
      status: "failed",
      phase: "post_commit",
      published_version: runId,
      failed_step: "ownership",
    });
    expect(JSON.parse((await bodyOf(RECORD)) ?? "{}").error).toContain(`version ${runId} is live`);
    // Nothing else of this run, and nothing shared, was written or renewed.
    expect(await bodyOf(ACTIVE)).toBe(lostBody);
    expect(await bodyOf(`ops/workflows/${runId}/manifest.json`)).toBeUndefined();
    expect(await bodyOf(`ops/workflows/${runId}/error.json`)).toBeUndefined();
    expect(sendAlert).toHaveBeenCalledWith(
      expect.objectContaining({ title: "managed refresh published; post-commit step failed", step: "ownership" }),
    );
  });

  test("an existing record is kept", async () => {
    const first = await recordPostCommitLeaseLoss(runId, startedAt, "first", { phase: "post_commit", version: runId, step: "ownership" });
    const body = await bodyOf(RECORD);
    const second = await recordPostCommitLeaseLoss(runId, startedAt, "second", { phase: "post_commit", version: "other", step: "ownership" });

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(await bodyOf(RECORD)).toBe(body);
    expect(recordHealth).toHaveBeenCalledTimes(2);
  });
});
