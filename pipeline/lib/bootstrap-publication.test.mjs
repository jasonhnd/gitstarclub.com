// @ts-nocheck -- Bun's test globals are intentionally outside the production JS typecheck roots.
import { describe, expect, test } from "bun:test";
import {
  BOOTSTRAP_POINTER_PATH,
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
  creates = 0;
  failCreateAt = null;
  failPutAfterWrite = false;

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

  test("one pointer commit is resumable and rollback restores the previous generation", async () => {
    const store = new MemoryStore();
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
      rollbackBootstrapGeneration({ store, targetGeneration: "bootstrap-network" }),
    ).rejects.toThrow("response loss");
    const rollbackReplay = await rollbackBootstrapGeneration({
      store,
      targetGeneration: "bootstrap-network",
    });
    expect(rollbackReplay.status).toBe("already-rolled-back");
    expect(rollbackReplay.pointer.previous_generation).toBe("bootstrap-next");
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
