import { describe, expect, spyOn, test } from "bun:test";
import { RELEASE_RETENTION, RELEASES_PATH, ReleaseRecord, Releases, type Meta, type MetadataBucketProgress, type PublishIntent } from "@/lib/contracts";
import * as source from "@/lib/data/source";
import * as storage from "@/lib/storage";
import { MemoryObjectStore, ObjectStorePreconditionFailedError } from "@/lib/storage";
import { appendReleaseRecord, prepareReleaseRecord } from "./releases";
import { REPO_BUCKETS } from "./buckets";

const owner = { runId: "refresh-test", fencingToken: 3 };
const record: ReleaseRecord = {
  id: owner.runId, published_at: "2026-10-26T01:00:00.000Z", prev_version: "refresh-previous",
  tracked_repo_count: 23, skipped_repo_count: 3,
  data_as_of: { seam_date: "2026-10-21", generated_at: "2026-10-26T00:00:00.000Z", folded_through: { month: "2026-09", week: "2026-W40" } },
};
const intent: PublishIntent = { operation: "publish", run_id: owner.runId, version: owner.runId, fencing_token: 3, published_at: record.published_at, prev_version: record.prev_version };
const ensureOwned = async () => {};
const append = (store: MemoryObjectStore, row = record) => appendReleaseRecord({ ...owner, runId: row.id }, row, store, ensureOwned);
async function history(store: MemoryObjectStore) {
  return Releases.parse(JSON.parse((await store.get(RELEASES_PATH))!.body));
}

describe("release contract and rolling history", () => {
  test("rejects unknown versions, duplicate ids, excessive retention and invalid record fields", () => {
    expect(Releases.safeParse({ schema_ver: 2, releases: [] }).success).toBe(false);
    expect(Releases.safeParse({ schema_ver: 1, releases: [record, record] }).success).toBe(false);
    expect(Releases.safeParse({ schema_ver: 1, releases: Array(RELEASE_RETENTION + 1).fill(record) }).success).toBe(false);
    for (const patch of [{ id: "" }, { skipped_repo_count: -1 }, { tracked_repo_count: 1.5 }, { published_at: "yesterday" }, { extra: true }, { data_as_of: { seam_date: "2026-02-30" } }]) {
      expect(ReleaseRecord.safeParse({ ...record, ...patch }).success).toBe(false);
    }
  });

  test("appends runs in newest-first order and never rewrites an existing record", async () => {
    const store = new MemoryObjectStore();
    await append(store);
    const newer = { ...record, id: "refresh-next", published_at: "2026-10-27T01:00:00.000Z", prev_version: record.id };
    await append(store, newer);
    expect((await history(store)).releases).toEqual([newer, record]);
    const bytes = (await store.get(RELEASES_PATH))!.body;
    await append(store, { ...record, skipped_repo_count: 999 });
    expect((await store.get(RELEASES_PATH))!.body).toBe(bytes);
  });

  test("retains the newest 100 by publication time and drops only the oldest", async () => {
    const existing = Array.from({ length: RELEASE_RETENTION }, (_, i) => ({ ...record, id: `refresh-${i}`, published_at: new Date(Date.UTC(2026, 0, i + 1)).toISOString() }));
    const store = new MemoryObjectStore({ [RELEASES_PATH]: JSON.stringify({ schema_ver: 1, releases: existing }) });
    await append(store);
    const retained = (await history(store)).releases;
    expect(retained).toHaveLength(100);
    expect(retained[0]).toEqual(record);
    expect(retained.slice(1)).toEqual(existing.slice(1).reverse());
  });

  for (const publishedAt of ["2025-01-01T00:00:00.000Z", record.published_at]) {
    test(`rejects a new release excluded by retention at ${publishedAt} without writing`, async () => {
      const existing = Array.from({ length: RELEASE_RETENTION }, (_, i) => ({ ...record, id: `a-${i}` }));
      const bytes = JSON.stringify({ schema_ver: 1, releases: existing });
      const store = new MemoryObjectStore({ [RELEASES_PATH]: bytes });
      const put = spyOn(store, "put");
      try {
        await expect(append(store, { ...record, published_at: publishedAt })).rejects.toThrow("falls outside the newest 100");
        expect(put).not.toHaveBeenCalled();
        expect((await store.get(RELEASES_PATH))!.body).toBe(bytes);
      } finally { put.mockRestore(); }
    });
  }

  for (const present of [false, true]) {
    test(`concurrent ${present ? "updates" : "creates"} preserve distinct releases and same-run retries`, async () => {
      const store = new MemoryObjectStore(present ? { [RELEASES_PATH]: JSON.stringify({ schema_ver: 1, releases: [record] }) } : {});
      const other = { ...record, id: "refresh-other" };
      await Promise.all([append(store), append(store), append(store, other)]);
      expect((await history(store)).releases.map((row) => row.id).sort()).toEqual([other.id, record.id].sort());
    });
  }

  test("uses origin history instead of stale public reads", async () => {
    const store = new MemoryObjectStore({ [RELEASES_PATH]: JSON.stringify({ schema_ver: 1, releases: [record] }) });
    const origin = store.get.bind(store);
    Object.assign(store, { getOrigin: origin });
    const get = spyOn(store, "get").mockRejectedValue(new Error("stale public read"));
    try {
      await append(store, { ...record, id: "refresh-next" });
      expect(get).not.toHaveBeenCalled();
      expect(Releases.parse(JSON.parse((await origin(RELEASES_PATH))!.body)).releases).toHaveLength(2);
    } finally { get.mockRestore(); }
  });

  test("fails closed on malformed history, unavailable reads, absent ETag and lost ownership", async () => {
    const store = new MemoryObjectStore({ [RELEASES_PATH]: "{}" });
    await expect(append(store)).rejects.toThrow();
    expect((await store.get(RELEASES_PATH))!.body).toBe("{}");
    const get = spyOn(store, "get").mockRejectedValue(new Error("read unavailable"));
    try {
      await expect(append(store)).rejects.toThrow("read unavailable");
      get.mockResolvedValue({ body: JSON.stringify({ schema_ver: 1, releases: [] }), etag: null });
      await expect(append(store)).rejects.toThrow("no origin ETag");
    } finally { get.mockRestore(); }
    const empty = new MemoryObjectStore();
    await expect(appendReleaseRecord(owner, record, empty, async () => { throw new Error("lost ownership"); })).rejects.toThrow("lost ownership");
    expect(await empty.get(RELEASES_PATH)).toBeNull();
    await expect(appendReleaseRecord({ ...owner, runId: "wrong" }, record, empty, ensureOwned)).rejects.toThrow("match publication owner");
  });

  test("propagates write outages and bounds conflict retries", async () => {
    const store = new MemoryObjectStore();
    const put = spyOn(store, "put").mockRejectedValue(new Error("storage unavailable"));
    try {
      await expect(append(store)).rejects.toThrow("storage unavailable");
      put.mockRejectedValue(new ObjectStorePreconditionFailedError());
      await expect(append(store)).rejects.toThrow("exhausted retries");
      expect(put).toHaveBeenCalledTimes(6);
    } finally { put.mockRestore(); }
  });
});

describe("release inputs", () => {
  async function inputs() {
    const meta: Meta = { schema_ver: 1, active_repo_count: 23, historical_repo_count: 4, ...record.data_as_of, backfilled_at: "2026-10-21T00:00:00.000Z" };
    const buckets = Array.from({ length: REPO_BUCKETS }, (_, bucket): MetadataBucketProgress => ({
      v: 1, bucket, fetched: {}, pending_pages: [], transient_attempts: 0,
      skipped: [1, 2, 34].filter((id) => id % REPO_BUCKETS === bucket).map((id) => ({ id, node_id: `node-${id}`, full_name: `owner/repo-${id}`, reason: "not_returned", value_status: "retained" })),
    }));
    const store = new MemoryObjectStore();
    const save = async () => {
      await store.put(`views/${owner.runId}/meta.json`, JSON.stringify(meta));
      for (let bucket = 0; bucket < REPO_BUCKETS; bucket++) {
        const path = `ops/workflows/${owner.runId}/metadata-${bucket}.json`;
        if (buckets[bucket] === undefined) await store.del(path);
        else await store.put(path, JSON.stringify(buckets[bucket]));
      }
    };
    await save();
    return { meta, buckets, store, save };
  }

  test("sums every bucket's skips and copies every available date from that version's meta", async () => {
    const { meta, store } = await inputs();
    const read = spyOn(store, "get");
    try {
      expect(await prepareReleaseRecord(intent, store)).toEqual({ ...record, data_as_of: { ...record.data_as_of, backfilled_at: meta.backfilled_at } });
      expect(read).toHaveBeenCalledTimes(33);
      expect(read.mock.calls[0][0]).toBe(`views/${owner.runId}/meta.json`);
      expect(read.mock.calls.slice(1).map(([path]) => path)).toEqual(Array.from({ length: 32 }, (_, i) => `ops/workflows/${owner.runId}/metadata-${i}.json`));
    } finally { read.mockRestore(); }
  });

  test("reads all inputs from the write origin despite unavailable public reads", async () => {
    const { meta, store } = await inputs();
    const origin = store.get.bind(store);
    Object.assign(store, { getOrigin: origin });
    const getStore = spyOn(storage, "getWriteObjectStore").mockReturnValue(store);
    const get = spyOn(store, "get").mockRejectedValue(new Error("public read unavailable"));
    const read = spyOn(source, "readRequiredView").mockRejectedValue(new Error("public fetch unavailable"));
    try {
      expect(await prepareReleaseRecord(intent)).toEqual({ ...record, data_as_of: { ...record.data_as_of, backfilled_at: meta.backfilled_at } });
      expect(get).not.toHaveBeenCalled();
      expect(read).not.toHaveBeenCalled();
      await store.del(`ops/workflows/${owner.runId}/metadata-31.json`);
      get.mockResolvedValue({ body: JSON.stringify({ v: 1, bucket: 31, fetched: {}, pending_pages: [], skipped: [], transient_attempts: 0 }), etag: null });
      await expect(prepareReleaseRecord(intent)).rejects.toThrow("metadata-31.json missing");
      expect(get).not.toHaveBeenCalled();
    } finally { getStore.mockRestore(); get.mockRestore(); read.mockRestore(); }
  });

  test("fails on missing meta, malformed origin JSON and origin outages", async () => {
    const { store } = await inputs();
    await store.del(`views/${owner.runId}/meta.json`);
    await expect(prepareReleaseRecord(intent, store)).rejects.toThrow("meta.json missing");
    await store.put(`views/${owner.runId}/meta.json`, "{");
    await expect(prepareReleaseRecord(intent, store)).rejects.toThrow();
    const getOrigin = spyOn(store, "get").mockRejectedValue(new Error("origin unavailable"));
    try { await expect(prepareReleaseRecord(intent, store)).rejects.toThrow("origin unavailable"); }
    finally { getOrigin.mockRestore(); }
  });

  test("preserves unavailable layer dates and rejects a missing tracked count", async () => {
    const { meta, store, save } = await inputs();
    delete meta.generated_at;
    delete meta.backfilled_at;
    delete meta.folded_through;
    await save();
    expect(JSON.parse(JSON.stringify((await prepareReleaseRecord(intent, store)).data_as_of))).toEqual({ seam_date: "2026-10-21" });
    delete meta.active_repo_count;
    await save();
    await expect(prepareReleaseRecord(intent, store)).rejects.toThrow();
  });

  for (const failure of ["missing", "pending", "bucket", "unknown skips", "unknown completion"] as const) {
    test(`rejects ${failure} metadata instead of claiming zero skips`, async () => {
      const { buckets, store, save } = await inputs();
      if (failure === "missing") buckets[31] = undefined as unknown as MetadataBucketProgress;
      if (failure === "pending") buckets[31].pending_pages = [[31]];
      if (failure === "bucket") buckets[31].bucket = 0;
      if (failure === "unknown skips") delete buckets[31].skipped;
      if (failure === "unknown completion") delete buckets[31].pending_pages;
      await save();
      await expect(prepareReleaseRecord(intent, store)).rejects.toThrow();
    });
  }
});
