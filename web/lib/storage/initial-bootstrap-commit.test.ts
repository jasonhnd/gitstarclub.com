import { describe, expect, test } from "bun:test";
import {
  commitInitialBootstrapWithLease,
  stageBootstrapPhase,
} from "../../../pipeline/lib/bootstrap-publication.mjs";
import { createObjectStoreBootstrapAdapter, type BootstrapStoreAdapter } from "./bootstrap-adapter";
import { MemoryObjectStore } from "./memory-store";

const GENERATION = "bootstrap-initial-lease";
const ACTIVE = "ops/workflows/active.json";
const NOW = () => "2026-07-17T00:00:00.000Z";

const OTHER_POINTER = {
  schema_ver: 1,
  generation: "bootstrap-other-writer",
  prefix: "bootstrap/generations/bootstrap-other-writer",
  previous_generation: null,
  published_at: "2026-07-17T00:00:00.000Z",
  base_manifest_sha256: "a".repeat(64),
  canonical_manifest_sha256: "b".repeat(64),
};

async function stagedStore() {
  const memory = new MemoryObjectStore();
  const store = createObjectStoreBootstrapAdapter(memory);
  await stageBootstrapPhase({
    generation: GENERATION,
    phase: "base",
    store,
    items: [{ path: "views/meta.json", body: Buffer.from('{"ok":true}'), contentType: "application/json" }],
  });
  await stageBootstrapPhase({
    generation: GENERATION,
    phase: "canonical",
    store,
    items: [{ path: "canonical/v2/meta.json", body: Buffer.from('{"ok":true}'), contentType: "application/json" }],
  });
  return { memory, store };
}

function plantOnRenewal(store: BootstrapStoreAdapter, plant: () => Promise<unknown>) {
  let activeReads = 0;
  const original = store.readSnapshot.bind(store);
  store.readSnapshot = async (path: string) => {
    if (path === ACTIVE) {
      activeReads += 1;
      if (activeReads === 2) await plant();
    }
    return original(path);
  };
  return () => activeReads;
}

describe("initial bootstrap commit lease", () => {
  test("publishes an empty bucket and releases the shared workflow lease", async () => {
    const { store } = await stagedStore();
    const published = await commitInitialBootstrapWithLease({
      generation: GENERATION,
      store,
      now: NOW,
    });
    expect(published.status).toBe("published");
    expect(published.pointer.generation).toBe(GENERATION);
    expect(published.pointer.previous_generation).toBeNull();
    const lease = JSON.parse((await store.read(ACTIVE))?.toString("utf8") ?? "");
    expect(lease).toMatchObject({
      status: "published",
      run_id: `bootstrap-publish-${GENERATION}`,
      idempotency_key: `bootstrap:publish:${GENERATION}`,
      trigger: "bootstrap-cli",
    });
  });

  test("refuses while a running workflow lease is active", async () => {
    const { store } = await stagedStore();
    await store.createMutable(
      ACTIVE,
      Buffer.from(
        JSON.stringify({
          run_id: "refresh-active",
          status: "running",
          acquired_at: "2026-10-01T00:00:00.000Z",
          expires_at: "2099-01-01T00:00:00.000Z",
          fencing_token: 7,
        }),
      ),
    );
    await expect(
      commitInitialBootstrapWithLease({ generation: GENERATION, store, now: NOW }),
    ).rejects.toThrow("blocked by active workflow refresh-active");
    expect(await store.read("bootstrap/latest.json")).toBeNull();
    const lease = JSON.parse((await store.read(ACTIVE))?.toString("utf8") ?? "");
    expect(lease).toMatchObject({ run_id: "refresh-active", status: "running", fencing_token: 7 });
  });

  test("refuses when a published marker appears between the empty check and the create", async () => {
    const { memory, store } = await stagedStore();
    const activeReads = plantOnRenewal(store, () => memory.put("views/latest.json", "{}"));
    await expect(
      commitInitialBootstrapWithLease({ generation: GENERATION, store, now: NOW }),
    ).rejects.toThrow("views/latest.json already exists");
    expect(activeReads()).toBeGreaterThanOrEqual(2);
    expect(await store.read("bootstrap/latest.json")).toBeNull();
    const lease = JSON.parse((await store.read(ACTIVE))?.toString("utf8") ?? "");
    expect(lease.status).toBe("failed");
  });

  test("refuses when the pointer appears between the empty check and the create", async () => {
    const { memory, store } = await stagedStore();
    const activeReads = plantOnRenewal(store, () => memory.put("bootstrap/latest.json", JSON.stringify(OTHER_POINTER)));
    await expect(
      commitInitialBootstrapWithLease({ generation: GENERATION, store, now: NOW }),
    ).rejects.toThrow("bootstrap/latest.json already exists");
    expect(activeReads()).toBeGreaterThanOrEqual(2);
    const pointer = JSON.parse((await store.read("bootstrap/latest.json"))?.toString("utf8") ?? "");
    expect(pointer.generation).toBe("bootstrap-other-writer");
  });

  test("refuses when the workflow fencing token changes before publish", async () => {
    const { memory, store } = await stagedStore();
    plantOnRenewal(store, () =>
      memory.put(
        ACTIVE,
        JSON.stringify({
          run_id: "other-writer",
          status: "running",
          acquired_at: "2026-10-01T00:00:00.000Z",
          expires_at: "2099-01-01T00:00:00.000Z",
          fencing_token: 99,
        }),
      ),
    );
    await expect(
      commitInitialBootstrapWithLease({ generation: GENERATION, store, now: NOW }),
    ).rejects.toThrow(/workflow lease/);
    expect(await store.read("bootstrap/latest.json")).toBeNull();
  });
});
