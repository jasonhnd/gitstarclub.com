import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { ZodType } from "zod";
import * as source from "@/lib/data/source";
import * as storage from "@/lib/storage";
import { MemoryObjectStore } from "@/lib/storage/memory-store";
import type { ObjectListOptions, ObjectListResult } from "@/lib/storage/types";
import * as lease from "@/lib/workflows/lease";
import { gcVersions } from "./gc";

const RUN = "caller-current";
const versions = Array.from({ length: 8 }, (_, i) => `v0${i + 1}`);

function gcFixture(pages: string[][] = [versions]) {
  const store = new MemoryObjectStore(Object.fromEntries(
    [...new Set(pages.flat())].map((version) => [`views/${version}/data.json`, "{}"]),
  ));
  const state = {
    listing: [] as ObjectListOptions[],
    deletes: [] as string[][],
    renewals: 0,
    loseLeaseAt: Infinity,
    failPage: -1,
    failVersion: "",
    failChunk: -1,
    failProtection: false,
    beforeRenew: null as ((call: number) => Promise<void>) | null,
    overridePage: null as ((index: number, page: ObjectListResult) => ObjectListResult) | null,
  };
  const list = store.list.bind(store);
  spyOn(store, "list").mockImplementation(async (options) => {
    state.listing.push(options);
    if (options.prefix !== "views/" || options.mode !== "folded") return list(options);
    const index = options.cursor ? Number(options.cursor.replace("page-", "")) : 0;
    if (index === state.failPage) throw new Error("injected version listing failure");
    const hasMore = index + 1 < pages.length;
    const existing = new Set((await list({ prefix: "views/", mode: "folded" })).folders);
    const page = {
      blobs: [], folders: (pages[index] ?? []).map((v) => `views/${v}/`).filter((folder) => existing.has(folder)),
      hasMore, cursor: hasMore ? `page-${index + 1}` : undefined,
    };
    return state.overridePage?.(index, page) ?? page;
  });
  const del = store.del.bind(store);
  spyOn(store, "del").mockImplementation(async (paths) => {
    const urls = Array.isArray(paths) ? paths : [paths];
    state.deletes.push(urls);
    if (state.deletes.length === state.failChunk || urls.some((url) => url.startsWith(`views/${state.failVersion}/`))) {
      throw new Error("injected delete failure");
    }
    await del(paths);
  });
  spyOn(storage, "getWriteObjectStore").mockReturnValue(store);
  spyOn(source, "readAuthoritativeView").mockImplementation(async <T>(path: string, schema: ZodType<T>) => {
    if (state.failProtection) throw new Error("injected protection read failure");
    const object = await store.get(path);
    return object === null ? null : schema.parse(JSON.parse(object.body));
  });
  spyOn(lease, "renewWorkflowLease").mockImplementation(async (runId, token) => {
    expect(runId).toBe(RUN);
    expect(token).toBe(7);
    state.renewals++;
    await state.beforeRenew?.(state.renewals);
    if (state.renewals >= state.loseLeaseAt) throw new lease.WorkflowLeaseOwnershipError("injected lost lease");
    return {
      run_id: RUN, fencing_token: 7, status: "running",
      acquired_at: new Date().toISOString(), expires_at: new Date(Date.now() + 60_000).toISOString(),
    };
  });
  const pointer = async (current: string, rollback: string | null) => store.put("views/latest.json", JSON.stringify({
    version: current, prev_version: rollback, run_id: current, schema_ver: 1,
    published_at: "2026-10-01T00:00:00.000Z",
  }));
  const active = async (runId: string, status: "running" | "published", expiresAt: string) => store.put(
    "ops/workflows/active.json", JSON.stringify({
      run_id: runId, status, acquired_at: "2026-10-01T00:00:00.000Z", expires_at: expiresAt, fencing_token: 7,
    }),
  );
  return { store, state, pointer, active };
}

afterEach(() => mock.restore());

describe("gcVersions in-memory inventory and progress", () => {
  test("collects two pages before choosing the newest four versions", async () => {
    const f = gcFixture([versions.slice(0, 4), versions.slice(4)]);
    const result = await gcVersions(RUN, 7);
    expect(result).toEqual({ deleted: ["v04", "v03", "v02", "v01"], kept: 4, failed: [] });
    expect(f.state.listing.filter((o) => o.mode === "folded").map((o) => o.cursor)).toEqual([undefined, "page-1"]);
    for (const version of versions.slice(4)) expect(await f.store.get(`views/${version}/data.json`)).not.toBeNull();
  });

  test("continues through empty pages and de-duplicates version folders", async () => {
    const f = gcFixture([[], versions, ["v01", "v01"]]);
    expect(await gcVersions(RUN, 7)).toEqual({ deleted: ["v04", "v03", "v02", "v01"], kept: 4, failed: [] });
    expect(f.state.deletes).toHaveLength(4);
  });

  test("handles an empty version inventory without deletion", async () => {
    const f = gcFixture([[]]);
    expect(await gcVersions(RUN, 7)).toEqual({ deleted: [], kept: 0, failed: [] });
    expect(f.state.deletes).toEqual([]);
  });

  test("protects current, rollback, active and caller versions outside the newest four", async () => {
    const f = gcFixture([[...versions, RUN, "older-active"]]);
    await f.pointer("v01", "v02");
    await f.active("older-active", "running", new Date(Date.now() + 60_000).toISOString());
    expect(await gcVersions(RUN, 7)).toEqual({ deleted: ["v04", "v03"], kept: 8, failed: [] });
    for (const version of ["v01", "v02", "older-active", RUN, ...versions.slice(4)]) {
      expect(await f.store.get(`views/${version}/data.json`)).not.toBeNull();
    }
  });

  for (const status of ["expired", "published"] as const) {
    test(`does not retain an ${status} active run solely because it appears in active.json`, async () => {
      const f = gcFixture();
      await f.active("v01", status === "expired" ? "running" : "published",
        new Date(Date.now() + (status === "expired" ? -60_000 : 60_000)).toISOString());
      expect((await gcVersions(RUN, 7)).deleted).toContain("v01");
    });
  }

  test("fails closed without deleting when a later version page fails", async () => {
    const f = gcFixture([versions.slice(0, 4), versions.slice(4)]);
    f.state.failPage = 1;
    expect(await gcVersions(RUN, 7)).toMatchObject({ deleted: [], failed: [], error: "injected version listing failure" });
    expect(f.state.deletes).toEqual([]);
  });

  for (const invalid of ["missing", "repeated"] as const) {
    test(`refuses deletion on a ${invalid} continuation cursor`, async () => {
      const f = gcFixture([versions, [], []]);
      f.state.overridePage = (_index, page) => ({ ...page, cursor: invalid === "missing" ? undefined : "page-1" });
      expect((await gcVersions(RUN, 7)).error).toMatch(/pagination cursor/);
      expect(f.state.deletes).toEqual([]);
    });
  }

  test("does not delete if ownership is already lost", async () => {
    const f = gcFixture();
    f.state.loseLeaseAt = 1;
    expect(await gcVersions(RUN, 7)).toMatchObject({ deleted: [], failed: [], error: "injected lost lease" });
    expect(f.state.listing).toEqual([]);
    expect(f.state.deletes).toEqual([]);
  });

  test("retains progress and stops before deletion after a lease takeover", async () => {
    const f = gcFixture();
    f.state.loseLeaseAt = 5;
    expect(await gcVersions(RUN, 7)).toEqual({
      deleted: ["v04"], kept: 7, failed: [{ version: "v03", error: "injected lost lease" }], error: "injected lost lease",
    });
    expect(f.state.deletes).toEqual([["views/v04/data.json"]]);
    expect(await f.store.get("views/v03/data.json")).not.toBeNull();
  });

  test("rechecks protection immediately before a deletion chunk", async () => {
    const f = gcFixture();
    f.state.beforeRenew = async (call) => {
      if (call === 2) await f.pointer("v04", null);
    };
    const result = await gcVersions(RUN, 7);
    expect(result.deleted).toEqual([]);
    expect(result.kept).toBe(8);
    expect(result.failed).toEqual([{ version: "v04", error: expect.stringContaining("protected Blob prefix") }]);
    expect(f.state.deletes).toEqual([]);
  });

  test("reports completed and failed versions separately and retries remaining versions", async () => {
    const f = gcFixture();
    f.state.failVersion = "v03";
    expect(await gcVersions(RUN, 7)).toEqual({
      deleted: ["v04"], kept: 7, failed: [{ version: "v03", error: "injected delete failure" }], error: "injected delete failure",
    });
    expect(await f.store.get("views/v04/data.json")).toBeNull();
    expect(await f.store.get("views/v03/data.json")).not.toBeNull();
    f.state.failVersion = "";
    const retried = await gcVersions(RUN, 7);
    expect(retried.error).toBeUndefined();
    expect(retried.failed).toEqual([]);
    for (const version of versions.slice(0, 4)) expect(await f.store.get(`views/${version}/data.json`)).toBeNull();
  });

  test("does not report a version as deleted after only its first chunk succeeds", async () => {
    const f = gcFixture([versions.slice(0, 5)]);
    for (let i = 0; i < 100; i++) await f.store.put(`views/v01/extra-${i}.json`, "{}");
    f.state.failChunk = 2;
    expect(await gcVersions(RUN, 7)).toEqual({
      deleted: [], kept: 5, failed: [{ version: "v01", error: "injected delete failure" }], error: "injected delete failure",
    });
    expect((await f.store.list({ prefix: "views/v01/" })).blobs).toHaveLength(1);
    f.state.failChunk = -1;
    expect(await gcVersions(RUN, 7)).toEqual({ deleted: ["v01"], kept: 4, failed: [] });
    expect((await f.store.list({ prefix: "views/v01/" })).blobs).toEqual([]);
  });

  test("does not delete when authoritative protection reads fail", async () => {
    const f = gcFixture();
    f.state.failProtection = true;
    expect(await gcVersions(RUN, 7)).toMatchObject({ deleted: [], failed: [], error: "injected protection read failure" });
    expect(f.state.deletes).toEqual([]);
  });
});
