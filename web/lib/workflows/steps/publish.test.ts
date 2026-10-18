import { describe, expect, test } from "bun:test";
import type {
  LatestSuccess,
  PublishIntent,
  PublishedWhitelist,
  ViewsPointer,
  WhitelistSnapshot,
} from "@/lib/contracts";
import {
  PublicationCommitUnknownError,
  PublicationPostCommitError,
  PublicationPostCommitLeaseLostError,
  publishVersionWithDeps,
  rollbackVersionWithDeps,
  type PublicationDeps,
} from "@/lib/workflows/publication-core";
import { WorkflowLeaseOwnershipError } from "@/lib/workflows/lease";

type WriteName = "intent" | "pointer" | "recovery" | "whitelist";
type Failure = { write: WriteName; timing: "before" | "after" } | null;

function snapshot(runId: string, ids = [1, 2]): WhitelistSnapshot {
  return {
    run_id: runId,
    generated_at: "2026-07-17T00:00:00.000Z",
    count: ids.length,
    entries: ids.map((id) => ({
      id,
      node_id: `node-${id}`,
      full_name: `owner/repo-${id}`,
      owner: "owner",
      name: `repo-${id}`,
      stars: 10_000 + id,
    })),
    diff: { added: ids, dropped: [] },
  };
}

function pointer(version: string, prevVersion: string | null): ViewsPointer {
  return {
    version,
    run_id: version,
    published_at: "2026-07-16T00:00:00.000Z",
    prev_version: prevVersion,
    schema_ver: 1,
  };
}

function fakePublication(initialPointer: ViewsPointer | null, failure: Failure = null) {
  const state: {
    pointer: ViewsPointer | null;
    intent: PublishIntent | null;
    recovery: LatestSuccess | null;
    whitelist: PublishedWhitelist | null;
    snapshots: Map<string, WhitelistSnapshot>;
    invalidations: number;
    visibleVersion: string | null;
    failure: Failure;
    writes: WriteName[];
  } = {
    pointer: initialPointer,
    intent: null,
    recovery: null,
    whitelist: null,
    snapshots: new Map(),
    invalidations: 0,
    visibleVersion: initialPointer?.version ?? null,
    failure,
    writes: [],
  };

  const fault = (write: WriteName, timing: "before" | "after") => {
    if (state.failure?.write === write && state.failure.timing === timing) {
      state.failure = null;
      throw new Error(`injected ${timing} ${write}`);
    }
  };

  const deps: PublicationDeps = {
    readPointer: async () => state.pointer,
    readIntent: async () => state.intent,
    createIntent: async (_operationId, intent) => {
      fault("intent", "before");
      if (state.intent) return false;
      state.intent = structuredClone(intent);
      state.writes.push("intent");
      fault("intent", "after");
      return true;
    },
    readWhitelistSnapshot: async (runId) => state.snapshots.get(runId) ?? null,
    writePointer: async (next) => {
      fault("pointer", "before");
      state.pointer = structuredClone(next);
      state.writes.push("pointer");
      fault("pointer", "after");
    },
    writeRecovery: async (next) => {
      fault("recovery", "before");
      state.recovery = structuredClone(next);
      state.writes.push("recovery");
      fault("recovery", "after");
    },
    writeWhitelistPointer: async (next) => {
      fault("whitelist", "before");
      state.whitelist = structuredClone(next);
      state.writes.push("whitelist");
      fault("whitelist", "after");
    },
    ensureOwnership: async () => {},
    checkInvalidationTarget: () => {},
    invalidate: async () => {
      state.invalidations++;
      state.visibleVersion = state.pointer?.version ?? null;
    },
    notifyIndexNow: async () => null,
    now: () => "2026-07-17T01:02:03.000Z",
  };
  return { state, deps };
}

describe("managed publication retries", () => {
  for (const write of ["intent", "pointer", "recovery", "whitelist"] as const) {
    for (const timing of ["before", "after"] as const) {
      test(`recovers from a failure ${timing} ${write} without changing rollback metadata`, async () => {
        const { state, deps } = fakePublication(pointer("version-old", "version-older"), { write, timing });
        state.snapshots.set("version-new", snapshot("version-new"));

        await expect(publishVersionWithDeps("version-new", 7, deps)).rejects.toThrow(`injected ${timing} ${write}`);
        const result = await publishVersionWithDeps("version-new", 7, deps);

        expect(result).toEqual({
          version: "version-new",
          prev_version: "version-old",
          published_at: "2026-07-17T01:02:03.000Z",
        });
        expect(state.intent?.prev_version).toBe("version-old");
        expect(state.pointer?.prev_version).toBe("version-old");
        expect(state.pointer?.prev_version).not.toBe(state.pointer?.version);
        expect(state.recovery?.version).toBe("version-new");
        expect(state.whitelist).toEqual({ run_id: "version-new", ids: [1, 2] });
        expect(state.invalidations).toBe(1);
      });
    }
  }

  test("preserves the pointer's original prev_version when retry starts after the switch", async () => {
    const { state, deps } = fakePublication(pointer("version-new", "version-old"));
    state.snapshots.set("version-new", snapshot("version-new"));

    const result = await publishVersionWithDeps("version-new", 3, deps);

    expect(result.prev_version).toBe("version-old");
    expect(state.intent?.prev_version).toBe("version-old");
    expect(state.pointer?.prev_version).toBe("version-old");
  });

  test("does not advance recovery or whitelist state before the live pointer commits", async () => {
    const { state, deps } = fakePublication(pointer("version-old", "version-older"), {
      write: "pointer",
      timing: "before",
    });
    state.snapshots.set("version-new", snapshot("version-new"));

    await expect(publishVersionWithDeps("version-new", 3, deps)).rejects.toThrow("injected before pointer");

    expect(state.pointer?.version).toBe("version-old");
    expect(state.recovery).toBeNull();
    expect(state.whitelist).toBeNull();
  });

  test("surfaces a transient pointer read and writes no intent or recovery state", async () => {
    const { state, deps } = fakePublication(pointer("version-old", null));
    state.snapshots.set("version-new", snapshot("version-new"));
    deps.readPointer = async () => {
      throw new Error("Blob 503");
    };

    await expect(publishVersionWithDeps("version-new", 2, deps)).rejects.toThrow("Blob 503");
    expect(state.intent).toBeNull();
    expect(state.writes).toEqual([]);
  });

  test("replays a persisted intent without rereading an unavailable pointer", async () => {
    const { state, deps } = fakePublication(pointer("version-old", null), { write: "pointer", timing: "before" });
    state.snapshots.set("version-new", snapshot("version-new"));
    await expect(publishVersionWithDeps("version-new", 2, deps)).rejects.toThrow("injected before pointer");
    deps.readPointer = async () => {
      throw new Error("pointer unavailable during retry");
    };

    const result = await publishVersionWithDeps("version-new", 2, deps);

    expect(result.prev_version).toBe("version-old");
    expect(state.pointer?.version).toBe("version-new");
  });

  test("a missing pointer is treated as first publication, not a transport catch-all", async () => {
    const { state, deps } = fakePublication(null);
    state.snapshots.set("version-first", snapshot("version-first"));

    const result = await publishVersionWithDeps("version-first", 1, deps);

    expect(result.prev_version).toBeNull();
    expect(state.pointer?.prev_version).toBeNull();
  });
});

describe("managed rollback", () => {
  test("uses a fenced intent, restores the previous version, and invalidates a warmed read", async () => {
    const { state, deps } = fakePublication(pointer("version-current", "version-previous"));
    state.snapshots.set("version-previous", snapshot("version-previous", [9]));
    expect(state.visibleVersion).toBe("version-current");

    const result = await rollbackVersionWithDeps("rollback-1", 12, undefined, deps);

    expect(result).toEqual({
      version: "version-previous",
      prev_version: "version-current",
      published_at: "2026-07-17T01:02:03.000Z",
    });
    expect(state.pointer).toMatchObject({ version: "version-previous", prev_version: "version-current" });
    expect(state.recovery).toMatchObject({ run_id: "version-previous", version: "version-previous" });
    expect(state.whitelist).toEqual({ run_id: "version-previous", ids: [9] });
    expect(state.visibleVersion).toBe("version-previous");
    expect(state.invalidations).toBe(1);
  });

  test("an ownership failure prevents a superseded run from switching the pointer", async () => {
    const { state, deps } = fakePublication(pointer("version-current", "version-previous"));
    state.snapshots.set("version-previous", snapshot("version-previous"));
    deps.ensureOwnership = async () => {
      throw new Error("lost fencing token");
    };

    await expect(rollbackVersionWithDeps("rollback-stale", 4, undefined, deps)).rejects.toThrow("lost fencing token");
    expect(state.pointer?.version).toBe("version-current");
    expect(state.intent).toBeNull();
  });
});

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected the promise to reject");
}

describe("post-commit publication failures", () => {
  const injectedWrites = [
    { write: "recovery", step: "recovery" },
    { write: "whitelist", step: "whitelist_pointer" },
  ] as const;
  for (const { write, step } of injectedWrites) {
    for (const timing of ["before", "after"] as const) {
      test(`a failure ${timing} ${write} reports the live version and step ${step}`, async () => {
        const { state, deps } = fakePublication(pointer("version-old", "version-older"), { write, timing });
        state.snapshots.set("version-new", snapshot("version-new"));

        const error = await rejectionOf(publishVersionWithDeps("version-new", 7, deps));

        expect(error).toBeInstanceOf(PublicationPostCommitError);
        const postCommit = error as PublicationPostCommitError;
        expect(postCommit.version).toBe("version-new");
        expect(postCommit.step).toBe(step);
        expect(postCommit.message).toBe(`version version-new is live; post-commit ${step} failed: injected ${timing} ${write}`);
        expect((postCommit.cause as Error).message).toBe(`injected ${timing} ${write}`);
        expect(state.pointer?.version).toBe("version-new");
      });
    }
  }

  test("a permanent invalidation failure reports the live version and step invalidate", async () => {
    const { state, deps } = fakePublication(pointer("version-old", "version-older"));
    state.snapshots.set("version-new", snapshot("version-new"));
    const cause = new Error("publication cache invalidation POST https://pre.gitstarclub.com/x -> 503");
    deps.invalidate = async () => {
      throw cause;
    };

    const error = await rejectionOf(publishVersionWithDeps("version-new", 7, deps));

    expect(error).toBeInstanceOf(PublicationPostCommitError);
    expect(error).toMatchObject({ name: "PublicationPostCommitError", version: "version-new", step: "invalidate", cause });
    expect(state.pointer?.version).toBe("version-new");
    expect(state.recovery?.version).toBe("version-new");
    expect(state.whitelist?.run_id).toBe("version-new");
  });

  test("an IndexNow failure after invalidation reports step indexnow", async () => {
    const { state, deps } = fakePublication(pointer("version-old", "version-older"));
    state.snapshots.set("version-new", snapshot("version-new"));
    deps.notifyIndexNow = async () => {
      throw new Error("IndexNow 500");
    };

    const error = await rejectionOf(publishVersionWithDeps("version-new", 7, deps));

    expect(error).toMatchObject({ version: "version-new", step: "indexnow" });
    expect(state.invalidations).toBe(1);
  });

  test("a pointer write whose response is lost after it landed counts as committed", async () => {
    const { state, deps } = fakePublication(pointer("version-old", "version-older"), {
      write: "pointer",
      timing: "after",
    });
    state.snapshots.set("version-new", snapshot("version-new"));

    const error = await rejectionOf(publishVersionWithDeps("version-new", 7, deps));

    expect(error).toMatchObject({ version: "version-new", step: "pointer" });
    expect(state.recovery).toBeNull();
  });

  test("a pointer write that never landed stays a plain pre-commit error", async () => {
    const { state, deps } = fakePublication(pointer("version-old", "version-older"), {
      write: "pointer",
      timing: "before",
    });
    state.snapshots.set("version-new", snapshot("version-new"));

    const error = await rejectionOf(publishVersionWithDeps("version-new", 7, deps));

    expect(error).not.toBeInstanceOf(PublicationPostCommitError);
    expect((error as Error).message).toBe("injected before pointer");
    expect(state.pointer?.version).toBe("version-old");
  });

  test("an unreadable pointer after a failed write reports an unknown commit state", async () => {
    const { state, deps } = fakePublication(pointer("version-old", "version-older"), {
      write: "pointer",
      timing: "after",
    });
    state.snapshots.set("version-new", snapshot("version-new"));
    const readPointer = deps.readPointer;
    let reads = 0;
    deps.readPointer = async () => {
      reads++;
      if (reads > 1) throw new Error("pointer read 503");
      return readPointer();
    };

    const error = await rejectionOf(publishVersionWithDeps("version-new", 7, deps));

    expect(error).toBeInstanceOf(PublicationCommitUnknownError);
    expect(error).not.toBeInstanceOf(PublicationPostCommitError);
    expect(error).toMatchObject({ name: "PublicationCommitUnknownError", version: "version-new", step: "pointer" });
    expect((error as Error).message).toBe(
      "version version-new may be live; pointer failed and the live pointer could not be read: injected after pointer",
    );
    expect(((error as Error).cause as Error).message).toBe("injected after pointer");
  });

  test("a pointer that holds a different publication is not mistaken for this commit", async () => {
    const { state, deps } = fakePublication(pointer("version-old", "version-older"));
    state.snapshots.set("version-new", snapshot("version-new"));
    deps.writePointer = async () => {
      state.pointer = { ...pointer("version-new", "version-old"), published_at: "2026-07-01T00:00:00.000Z" };
      throw new Error("pointer write 500");
    };

    const error = await rejectionOf(publishVersionWithDeps("version-new", 7, deps));

    expect(error).not.toBeInstanceOf(PublicationPostCommitError);
    expect((error as Error).message).toBe("pointer write 500");
  });

  test("a replay that fails before rewriting an already-live pointer is still post-commit", async () => {
    const { state, deps } = fakePublication(pointer("version-old", "version-older"));
    state.snapshots.set("version-new", snapshot("version-new"));
    deps.invalidate = async () => {
      throw new Error("invalidate 503");
    };
    await expect(publishVersionWithDeps("version-new", 7, deps)).rejects.toThrow("invalidate 503");
    deps.readWhitelistSnapshot = async () => {
      throw new Error("whitelist snapshot 503");
    };

    const error = await rejectionOf(publishVersionWithDeps("version-new", 7, deps));

    expect(error).toMatchObject({ version: "version-new", step: "whitelist_snapshot" });
    expect((error as Error).message).toContain("whitelist snapshot 503");
  });

  test("a first-attempt whitelist snapshot failure is pre-commit without reading the pointer", async () => {
    const { state, deps } = fakePublication(pointer("version-old", "version-older"));
    let pointerReads = 0;
    const readPointer = deps.readPointer;
    deps.readPointer = async () => {
      pointerReads++;
      return readPointer();
    };

    const error = await rejectionOf(publishVersionWithDeps("version-new", 7, deps));

    expect(error).not.toBeInstanceOf(PublicationPostCommitError);
    expect((error as Error).message).toBe("whitelist snapshot for published version version-new not found");
    expect(pointerReads).toBe(1);
    expect(state.pointer?.version).toBe("version-old");
  });

  test("a replay that cannot read the pointer after a failed step reports an unknown commit state", async () => {
    const { state, deps } = fakePublication(pointer("version-old", "version-older"));
    state.snapshots.set("version-new", snapshot("version-new"));
    deps.invalidate = async () => {
      throw new Error("invalidate 503");
    };
    await expect(publishVersionWithDeps("version-new", 7, deps)).rejects.toBeInstanceOf(PublicationPostCommitError);
    deps.readWhitelistSnapshot = async () => {
      throw new Error("store 503");
    };
    deps.readPointer = async () => {
      throw new Error("store 503");
    };

    const error = await rejectionOf(publishVersionWithDeps("version-new", 7, deps));

    expect(error).toBeInstanceOf(PublicationCommitUnknownError);
    expect(error).toMatchObject({ version: "version-new", step: "whitelist_snapshot" });
  });

  test("a misconfigured invalidation target fails before the pointer switch", async () => {
    const { state, deps } = fakePublication(pointer("version-old", "version-older"));
    state.snapshots.set("version-new", snapshot("version-new"));
    let invalidateCalls = 0;
    deps.checkInvalidationTarget = () => {
      throw new Error("CF_CRON_ORIGIN is required for publication cache invalidation on Cloudflare");
    };
    deps.invalidate = async () => {
      invalidateCalls++;
    };

    const error = await rejectionOf(publishVersionWithDeps("version-new", 7, deps));

    expect(error).not.toBeInstanceOf(PublicationPostCommitError);
    expect((error as Error).message).toMatch(/CF_CRON_ORIGIN is required/);
    expect(state.pointer?.version).toBe("version-old");
    expect(state.recovery).toBeNull();
    expect(state.writes).toEqual(["intent"]);
    expect(invalidateCalls).toBe(0);
  });

  test("a replay whose invalidation target broke after the commit is post-commit invalidate", async () => {
    const { state, deps } = fakePublication(pointer("version-old", "version-older"));
    state.snapshots.set("version-new", snapshot("version-new"));
    deps.invalidate = async () => {
      throw new Error("invalidate 503");
    };
    await expect(publishVersionWithDeps("version-new", 7, deps)).rejects.toBeInstanceOf(PublicationPostCommitError);
    deps.checkInvalidationTarget = () => {
      throw new Error("CF_CRON_ORIGIN is required");
    };

    const error = await rejectionOf(publishVersionWithDeps("version-new", 7, deps));

    expect(error).toBeInstanceOf(PublicationPostCommitError);
    expect(error).toMatchObject({ version: "version-new", step: "invalidate" });
  });

  test("intent failures before the commit stay plain errors", async () => {
    for (const timing of ["before", "after"] as const) {
      const { state, deps } = fakePublication(pointer("version-old", "version-older"), { write: "intent", timing });
      state.snapshots.set("version-new", snapshot("version-new"));

      const error = await rejectionOf(publishVersionWithDeps("version-new", 7, deps));

      expect(error).not.toBeInstanceOf(PublicationPostCommitError);
      expect(state.pointer?.version).toBe("version-old");
    }
  });

  test("lost ownership after the commit stays non-retryable and names the live version", async () => {
    const { state, deps } = fakePublication(pointer("version-old", "version-older"));
    state.snapshots.set("version-new", snapshot("version-new"));
    const lost = new WorkflowLeaseOwnershipError("lost fencing token");
    let checks = 0;
    deps.ensureOwnership = async () => {
      checks++;
      if (checks > 1) throw lost;
    };

    const error = await rejectionOf(publishVersionWithDeps("version-new", 7, deps));

    expect(error).toBeInstanceOf(WorkflowLeaseOwnershipError);
    expect(error).toBeInstanceOf(PublicationPostCommitLeaseLostError);
    expect(error).toMatchObject({ version: "version-new", step: "ownership", cause: lost });
    expect(state.pointer?.version).toBe("version-new");
    expect(state.recovery).toBeNull();
  });

  test("a non-lease ownership failure after the commit is a post-commit error", async () => {
    const { state, deps } = fakePublication(pointer("version-old", "version-older"));
    state.snapshots.set("version-new", snapshot("version-new"));
    let checks = 0;
    deps.ensureOwnership = async () => {
      checks++;
      if (checks > 1) throw new Error("lease read 500");
    };

    const error = await rejectionOf(publishVersionWithDeps("version-new", 7, deps));

    expect(error).toBeInstanceOf(PublicationPostCommitError);
    expect(error).toMatchObject({ version: "version-new", step: "ownership" });
  });

  test("lost ownership before the commit stays a plain lease error", async () => {
    const { state, deps } = fakePublication(pointer("version-old", "version-older"));
    state.snapshots.set("version-new", snapshot("version-new"));
    deps.ensureOwnership = async () => {
      throw new WorkflowLeaseOwnershipError("lost fencing token");
    };

    const error = await rejectionOf(publishVersionWithDeps("version-new", 7, deps));

    expect(error).toBeInstanceOf(WorkflowLeaseOwnershipError);
    expect(error).not.toBeInstanceOf(PublicationPostCommitLeaseLostError);
    expect(state.pointer?.version).toBe("version-old");
  });

  test("a replay after a permanent invalidation failure repairs the publication", async () => {
    const { state, deps } = fakePublication(pointer("version-old", "version-older"));
    state.snapshots.set("version-new", snapshot("version-new"));
    const invalidate = deps.invalidate;
    let failing = true;
    deps.invalidate = async () => {
      if (failing) throw new Error("invalidate 503");
      return invalidate();
    };
    await expect(publishVersionWithDeps("version-new", 7, deps)).rejects.toBeInstanceOf(PublicationPostCommitError);
    expect(state.visibleVersion).toBe("version-old");

    failing = false;
    const result = await publishVersionWithDeps("version-new", 7, deps);

    expect(result).toEqual({
      version: "version-new",
      prev_version: "version-old",
      published_at: "2026-07-17T01:02:03.000Z",
    });
    expect(state.pointer?.prev_version).toBe("version-old");
    expect(state.visibleVersion).toBe("version-new");
    expect(state.invalidations).toBe(1);
  });

  test("a rollback reports the restored version, not the operation id", async () => {
    const { state, deps } = fakePublication(pointer("version-current", "version-previous"));
    state.snapshots.set("version-previous", snapshot("version-previous"));
    deps.invalidate = async () => {
      throw new Error("invalidate 503");
    };

    const error = await rejectionOf(rollbackVersionWithDeps("rollback-643", 12, undefined, deps));

    expect(error).toMatchObject({ version: "version-previous", step: "invalidate" });
    expect(state.pointer?.version).toBe("version-previous");
  });
});
