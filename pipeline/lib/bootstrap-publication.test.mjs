// @ts-nocheck -- Bun's test globals are intentionally outside the production JS typecheck roots.
import { describe, expect, test } from "bun:test";
import {
  BOOTSTRAP_POINTER_PATH,
  LEGACY_FLAT_REQUIRED_PATHS,
  LEGACY_FLAT_TARGET,
  commitBootstrapGeneration,
  rollbackBootstrapGeneration,
  stageBootstrapPhase,
} from "./bootstrap-publication.mjs";
import {
  ACTIVE_WORKFLOW_PATH,
  acquireBootstrapLease,
  withBootstrapPublicationLease,
} from "./bootstrap-lease.mjs";

class MemoryStore {
  objects = new Map();
  etags = new Map();
  version = 0;
  creates = 0;
  failCreateAt = null;
  failPutAfterWrite = false;
  failDeleteAfterWrite = false;

  async read(path) {
    const value = this.objects.get(path);
    return value ? Buffer.from(value) : null;
  }

  async create(path, body) {
    this.creates++;
    if (this.failCreateAt === this.creates) throw new Error(`injected create failure ${this.creates}`);
    if (this.objects.has(path)) return false;
    this.objects.set(path, Buffer.from(body));
    return true;
  }

  async put(path, body) {
    this.objects.set(path, Buffer.from(body));
    if (this.failPutAfterWrite) {
      this.failPutAfterWrite = false;
      throw new Error("injected response loss after pointer write");
    }
  }

  async delete(path) {
    this.objects.delete(path);
    if (this.failDeleteAfterWrite) {
      this.failDeleteAfterWrite = false;
      throw new Error("injected response loss after pointer delete");
    }
  }

  async readSnapshot(path) {
    return {
      body: await this.read(path),
      etag: this.etags.get(path) ?? null,
    };
  }

  async createMutable(path, body) {
    if (this.objects.has(path)) return false;
    this.objects.set(path, Buffer.from(body));
    this.etags.set(path, `etag-${++this.version}`);
    return true;
  }

  async compareAndSet(path, etag, body) {
    if (this.etags.get(path) !== etag) return false;
    this.objects.set(path, Buffer.from(body));
    this.etags.set(path, `etag-${++this.version}`);
    return true;
  }
}

class LeaseStore {
  body = null;
  etag = null;
  version = 0;

  async readSnapshot() {
    return { body: this.body ? Buffer.from(this.body) : null, etag: this.etag };
  }

  async createMutable(_path, body) {
    if (this.body) return false;
    this.body = Buffer.from(body);
    this.etag = `etag-${++this.version}`;
    return true;
  }

  async compareAndSet(_path, etag, body) {
    if (etag !== this.etag) return false;
    this.body = Buffer.from(body);
    this.etag = `etag-${++this.version}`;
    return true;
  }
}

const items = (phase, suffix = "") => {
  const prefix = phase === "canonical" ? "canonical/v2" : phase;
  return [
    { path: `${prefix}/a${suffix}.json`, body: Buffer.from('{"ok":true}'), contentType: "application/json" },
    { path: `${prefix}/b${suffix}.json`, body: Buffer.from('{"ok":false}'), contentType: "application/json" },
  ];
};

async function stageComplete(store, generation) {
  await stageBootstrapPhase({ generation, phase: "base", items: items("views"), store, concurrency: 1 });
  await stageBootstrapPhase({ generation, phase: "canonical", items: items("canonical"), store, concurrency: 1 });
}

function seedLegacyFlat(store) {
  for (const path of LEGACY_FLAT_REQUIRED_PATHS) {
    let value = { path };
    if (path === "meta.json" || path === "canonical/v2/meta.json") {
      value = { seam_date: "2026-07-01", schema_ver: 1 };
    } else if (path.startsWith("lookup/")) {
      value = { one: { ok: true } };
    } else if (path.startsWith("rank/")) {
      value = { items: [] };
    }
    store.objects.set(path, Buffer.from(JSON.stringify(value)));
  }
}

describe("bootstrap publication", () => {
  test("rejects empty or cross-phase staged payloads", async () => {
    const store = new MemoryStore();
    await expect(
      stageBootstrapPhase({ generation: "bootstrap-empty", phase: "base", items: [], store }),
    ).rejects.toThrow("cannot be empty");
    await expect(
      stageBootstrapPhase({
        generation: "bootstrap-wrong-phase",
        phase: "canonical",
        items: items("views"),
        store,
      }),
    ).rejects.toThrow("cannot stage object path");
  });

  test("resumes byte-identical immutable uploads after failures at multiple points", async () => {
    for (const failCreateAt of [1, 2, 3]) {
      const store = new MemoryStore();
      store.failCreateAt = failCreateAt;
      await expect(
        stageBootstrapPhase({
          generation: `bootstrap-resume-${failCreateAt}`,
          phase: "base",
          items: items("views"),
          store,
          concurrency: 1,
        }),
      ).rejects.toThrow("injected create failure");
      store.failCreateAt = null;

      const resumed = await stageBootstrapPhase({
        generation: `bootstrap-resume-${failCreateAt}`,
        phase: "base",
        items: items("views"),
        store,
        concurrency: 1,
      });

      expect(resumed.manifest.object_count).toBe(2);
      expect(resumed.created + resumed.reused).toBe(2);
    }
  });

  test("rejects reuse of a sealed generation with different bytes", async () => {
    const store = new MemoryStore();
    await stageBootstrapPhase({ generation: "bootstrap-sealed", phase: "base", items: items("views"), store });
    await expect(
      stageBootstrapPhase({ generation: "bootstrap-sealed", phase: "base", items: items("views", "-changed"), store }),
    ).rejects.toThrow("sealed with different content");
  });

  test("validation failure leaves the production pointer unchanged", async () => {
    const store = new MemoryStore();
    await stageComplete(store, "bootstrap-candidate");
    store.objects.set(BOOTSTRAP_POINTER_PATH, Buffer.from(JSON.stringify({
      schema_ver: 1,
      generation: "bootstrap-existing",
      prefix: "bootstrap/generations/bootstrap-existing",
      previous_generation: null,
      published_at: "2026-07-17T00:00:00.000Z",
      base_manifest_sha256: "a".repeat(64),
      canonical_manifest_sha256: "b".repeat(64),
    })));
    const before = await store.read(BOOTSTRAP_POINTER_PATH);

    await expect(
      commitBootstrapGeneration({
        generation: "bootstrap-candidate",
        store,
        validate: async () => {
          throw new Error("schema validation failed");
        },
      }),
    ).rejects.toThrow("schema validation failed");

    expect(await store.read(BOOTSTRAP_POINTER_PATH)).toEqual(before);
  });

  test("first publication requires a verified legacy-flat rollback target", async () => {
    const store = new MemoryStore();
    await stageComplete(store, "bootstrap-requires-legacy");
    await expect(
      withBootstrapPublicationLease({
        store,
        generation: "bootstrap-requires-legacy",
        operation: "publish",
        run: (assertCanCommit) =>
          commitBootstrapGeneration({
            generation: "bootstrap-requires-legacy",
            store,
            assertCanCommit,
          }),
      }),
    ).rejects.toThrow("required legacy-flat recovery artifact is missing");
    expect(await store.read(BOOTSTRAP_POINTER_PATH)).toBeNull();

    seedLegacyFlat(store);
    const published = await withBootstrapPublicationLease({
      store,
      generation: "bootstrap-requires-legacy",
      operation: "publish",
      run: (assertCanCommit) =>
        commitBootstrapGeneration({
          generation: "bootstrap-requires-legacy",
          store,
          assertCanCommit,
        }),
    });
    expect(published.status).toBe("published");
    expect(published.pointer.previous_generation).toBeNull();
  });

  test("one pointer commit is resumable and rollback restores the previous generation", async () => {
    const store = new MemoryStore();
    seedLegacyFlat(store);
    await stageComplete(store, "bootstrap-one");
    const first = await commitBootstrapGeneration({
      generation: "bootstrap-one",
      store,
      now: () => "2026-07-17T01:00:00.000Z",
    });
    expect(first.pointer.previous_generation).toBeNull();

    await stageComplete(store, "bootstrap-two");
    const second = await commitBootstrapGeneration({
      generation: "bootstrap-two",
      store,
      now: () => "2026-07-17T02:00:00.000Z",
    });
    expect(second.pointer.previous_generation).toBe("bootstrap-one");

    const replay = await commitBootstrapGeneration({ generation: "bootstrap-two", store });
    expect(replay.status).toBe("already-published");
    expect(replay.pointer.previous_generation).toBe("bootstrap-one");

    const rollback = await rollbackBootstrapGeneration({
      store,
      targetGeneration: "bootstrap-one",
      now: () => "2026-07-17T03:00:00.000Z",
    });
    expect(rollback.pointer.generation).toBe("bootstrap-one");
    expect(rollback.pointer.previous_generation).toBe("bootstrap-two");
    const replayRollback = await rollbackBootstrapGeneration({
      store,
      targetGeneration: "bootstrap-one",
    });
    expect(replayRollback.status).toBe("already-rolled-back");
    expect(replayRollback.pointer.previous_generation).toBe("bootstrap-two");
  });

  test("retries safely when the pointer write succeeded but its response was lost", async () => {
    const store = new MemoryStore();
    seedLegacyFlat(store);
    await stageComplete(store, "bootstrap-network");
    store.failPutAfterWrite = true;
    await expect(
      commitBootstrapGeneration({ generation: "bootstrap-network", store }),
    ).rejects.toThrow("response loss");
    const publishReplay = await commitBootstrapGeneration({ generation: "bootstrap-network", store });
    expect(publishReplay.status).toBe("already-published");

    await stageComplete(store, "bootstrap-next");
    await commitBootstrapGeneration({ generation: "bootstrap-next", store });
    store.failPutAfterWrite = true;
    await expect(
      withBootstrapPublicationLease({
        store,
        generation: "bootstrap-network",
        operation: "rollback",
        run: (assertCanCommit) =>
          rollbackBootstrapGeneration({
            store,
            targetGeneration: "bootstrap-network",
            assertCanCommit,
          }),
      }),
    ).rejects.toThrow("response loss");
    const rollbackReplay = await withBootstrapPublicationLease({
      store,
      generation: "bootstrap-network",
      operation: "rollback",
      run: (assertCanCommit) =>
        rollbackBootstrapGeneration({
          store,
          targetGeneration: "bootstrap-network",
          assertCanCommit,
        }),
    });
    expect(rollbackReplay.status).toBe("already-rolled-back");
    expect(rollbackReplay.pointer.previous_generation).toBe("bootstrap-next");
  });

  test("first publication can roll back to legacy-flat and retry a response-lost pointer delete", async () => {
    const store = new MemoryStore();
    seedLegacyFlat(store);
    await stageComplete(store, "bootstrap-first");
    const first = await commitBootstrapGeneration({ generation: "bootstrap-first", store });
    expect(first.pointer.previous_generation).toBeNull();

    store.failDeleteAfterWrite = true;
    await expect(
      withBootstrapPublicationLease({
        store,
        generation: LEGACY_FLAT_TARGET,
        operation: "rollback",
        run: (assertCanCommit) =>
          rollbackBootstrapGeneration({
            store,
            targetGeneration: LEGACY_FLAT_TARGET,
            assertCanCommit,
          }),
      }),
    ).rejects.toThrow("response loss after pointer delete");
    expect(await store.read(BOOTSTRAP_POINTER_PATH)).toBeNull();

    const replay = await withBootstrapPublicationLease({
      store,
      generation: LEGACY_FLAT_TARGET,
      operation: "rollback",
      run: (assertCanCommit) =>
        rollbackBootstrapGeneration({
          store,
          targetGeneration: LEGACY_FLAT_TARGET,
          assertCanCommit,
        }),
    });
    expect(replay.status).toBe("already-rolled-back");
    expect(replay.target).toBe(LEGACY_FLAT_TARGET);
    expect(replay.pointer).toBeNull();
    expect(replay.verified.objectCount).toBe(LEGACY_FLAT_REQUIRED_PATHS.length);
  });

  test("shares the active Workflow lease across bootstrap commit and release", async () => {
    const now = Date.parse("2026-07-17T04:00:00.000Z");
    const blocked = new LeaseStore();
    blocked.body = Buffer.from(JSON.stringify({
      run_id: "refresh-active",
      status: "running",
      acquired_at: "2026-07-17T03:59:00.000Z",
      expires_at: "2026-07-17T04:30:00.000Z",
      fencing_token: 7,
    }));
    blocked.etag = "etag-active";
    await expect(
      acquireBootstrapLease({ store: blocked, generation: "bootstrap-three", operation: "publish", now }),
    ).rejects.toThrow("blocked by active workflow refresh-active");

    const store = new LeaseStore();
    const value = await withBootstrapPublicationLease({
      store,
      generation: "bootstrap-three",
      operation: "publish",
      run: async (assertCanCommit) => {
        await assertCanCommit();
        expect(JSON.parse(store.body.toString()).status).toBe("running");
        return 42;
      },
    });
    expect(value).toBe(42);
    expect(JSON.parse(store.body.toString())).toMatchObject({
      status: "published",
      idempotency_key: "bootstrap:publish:bootstrap-three",
    });
    expect(ACTIVE_WORKFLOW_PATH).toBe("ops/workflows/active.json");
  });
});
