import { describe, expect, test } from "bun:test";
import type {
  LatestSuccess,
  PublishIntent,
  PublishedWhitelist,
  ViewsPointer,
  WhitelistSnapshot,
} from "@/lib/contracts";
import {
  publishVersionWithDeps,
  rollbackVersionWithDeps,
  type PublicationDeps,
} from "@/lib/workflows/publication-core";

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
