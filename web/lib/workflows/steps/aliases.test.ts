import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { ZodType } from "zod";
import * as source from "@/lib/data/source";
import * as storage from "@/lib/storage";
import { MemoryObjectStore } from "@/lib/storage/memory-store";
import type { ObjectListOptions, ObjectListResult } from "@/lib/storage/types";
import * as ownedWrite from "@/lib/workflows/owned-write";
import { buildAliases } from "./aliases";

const RUN = "aliases-current";
const OUTPUT = `views/${RUN}/lookup/aliases.json`;

function aliasFixture(pages: string[][] = [["ops/workflows/history-a/"]]) {
  const lookup = Object.fromEntries([1, 2].map((id) => [String(id), {
    owner: "current", name: `repo-${id}`, full_name: `current/repo-${id}`,
    owner_type: "User", language: null, current_stars: 10_000,
  }]));
  const store = new MemoryObjectStore({ [`views/${RUN}/lookup/repos.json`]: JSON.stringify(lookup) });
  const state = {
    listing: [] as ObjectListOptions[],
    reads: [] as string[],
    activeReads: 0,
    peakReads: 0,
    failRead: "",
    failPage: -1,
    overridePage: null as ((index: number, page: ObjectListResult) => ObjectListResult) | null,
  };
  const list = store.list.bind(store);
  spyOn(store, "list").mockImplementation(async (options) => {
    if (options.prefix !== "ops/workflows/" || options.mode !== "folded") return list(options);
    state.listing.push(options);
    const index = options.cursor ? Number(options.cursor.replace("page-", "")) : 0;
    if (index === state.failPage) throw new Error("injected listing failure");
    const hasMore = index + 1 < pages.length;
    const page = { blobs: [], folders: pages[index] ?? [], hasMore, cursor: hasMore ? `page-${index + 1}` : undefined };
    return state.overridePage?.(index, page) ?? page;
  });
  const read = async <T>(path: string, schema: ZodType<T>): Promise<T | null> => {
    if (path.endsWith("/renames.json")) {
      state.reads.push(path);
      state.activeReads++;
      state.peakReads = Math.max(state.peakReads, state.activeReads);
      try {
        await new Promise((resolve) => setTimeout(resolve, 1));
        if (path === state.failRead) throw new Error("injected rename read failure");
        const object = await store.get(path);
        return object === null ? null : schema.parse(JSON.parse(object.body));
      } finally {
        state.activeReads--;
      }
    }
    const object = await store.get(path);
    return object === null ? null : schema.parse(JSON.parse(object.body));
  };
  spyOn(storage, "getWriteObjectStore").mockReturnValue(store);
  spyOn(source, "readAuthoritativeView").mockImplementation(read);
  spyOn(source, "readRequiredView").mockImplementation(async <T>(path: string, schema: ZodType<T>) => {
    const value = await read(path, schema);
    if (value === null) throw new Error(`${path} missing`);
    return value;
  });
  const write = spyOn(ownedWrite, "putOwnedView").mockImplementation(async (owner, path, data) => {
    expect(owner).toEqual({ runId: RUN, fencingToken: 7 });
    await store.put(path, JSON.stringify(data));
  });
  const rename = async (folder: string, oldName: string, id = 1) => store.put(`${folder}renames.json`, JSON.stringify({
    run_id: folder.split("/")[2], generated_at: "2026-10-01T00:00:00.000Z",
    renames: [{ id, old_full_name: oldName, new_full_name: `current/repo-${id}` }],
  }));
  return { store, state, rename, write };
}

afterEach(() => mock.restore());

describe("buildAliases paginated history", () => {
  test("unions rename deltas from two pages and threads the cursor", async () => {
    const f = aliasFixture([["ops/workflows/history-a/"], ["ops/workflows/history-b/"]]);
    await f.rename("ops/workflows/history-a/", "old-a/repo");
    await f.rename("ops/workflows/history-b/", "old-b/repo", 2);

    expect(await buildAliases(RUN, 7)).toEqual({ aliases: 2, runs_scanned: 2 });
    expect(JSON.parse((await f.store.get(OUTPUT))!.body)).toEqual({ "old-a/repo": 1, "old-b/repo": 2 });
    expect(f.state.listing.map((options) => options.cursor)).toEqual([undefined, "page-1"]);
  });

  test("continues through an empty page when hasMore is true", async () => {
    const f = aliasFixture([[], ["ops/workflows/history-b/"]]);
    await f.rename("ops/workflows/history-b/", "old-b/repo");
    expect(await buildAliases(RUN, 7)).toEqual({ aliases: 1, runs_scanned: 1 });
  });

  test("de-duplicates folders within and across pages before reading", async () => {
    const folder = "ops/workflows/history-a/";
    const f = aliasFixture([[folder, folder], [folder]]);
    await f.rename(folder, "old-a/repo");
    expect(await buildAliases(RUN, 7)).toEqual({ aliases: 1, runs_scanned: 1 });
    expect(f.state.reads).toEqual([`${folder}renames.json`]);
  });

  test("accepts an empty terminal page and a missing historical delta", async () => {
    const f = aliasFixture([["ops/workflows/no-delta/"], []]);
    expect(await buildAliases(RUN, 7)).toEqual({ aliases: 0, runs_scanned: 1 });
    expect(f.state.listing).toHaveLength(2);
    expect(JSON.parse((await f.store.get(OUTPUT))!.body)).toEqual({});
  });

  test("writes an empty alias map for an empty inventory", async () => {
    aliasFixture([[]]);
    expect(await buildAliases(RUN, 7)).toEqual({ aliases: 0, runs_scanned: 0 });
  });

  test("caps concurrent delta reads at eight while consuming all folders", async () => {
    const folders = Array.from({ length: 25 }, (_, i) => `ops/workflows/history-${i}/`);
    const f = aliasFixture([folders]);
    for (let i = 0; i < folders.length; i++) await f.rename(folders[i], `old-${i}/repo`);
    expect(await buildAliases(RUN, 7)).toEqual({ aliases: 25, runs_scanned: 25 });
    expect(f.state.peakReads).toBeGreaterThan(1);
    expect(f.state.peakReads).toBeLessThanOrEqual(8);
    expect(f.state.activeReads).toBe(0);
  });

  test("fails without publishing aliases when a later-page delta cannot be read", async () => {
    const f = aliasFixture([[], ["ops/workflows/history-b/"]]);
    f.state.failRead = "ops/workflows/history-b/renames.json";
    await expect(buildAliases(RUN, 7)).rejects.toThrow("injected rename read failure");
    expect(f.write).not.toHaveBeenCalled();
  });

  test("fails on malformed rename data rather than treating it as absent", async () => {
    const f = aliasFixture();
    await f.store.put("ops/workflows/history-a/renames.json", JSON.stringify({ renames: "invalid" }));
    await expect(buildAliases(RUN, 7)).rejects.toThrow();
    expect(f.write).not.toHaveBeenCalled();
  });

  test("fails before reading or writing when a later inventory page fails", async () => {
    const f = aliasFixture([["ops/workflows/history-a/"], []]);
    f.state.failPage = 1;
    await expect(buildAliases(RUN, 7)).rejects.toThrow("injected listing failure");
    expect(f.state.reads).toEqual([]);
    expect(f.write).not.toHaveBeenCalled();
  });

  for (const invalid of ["missing", "repeated"] as const) {
    test(`fails closed on a ${invalid} continuation cursor`, async () => {
      const f = aliasFixture([[], [], []]);
      f.state.overridePage = (_index, page) => ({ ...page, cursor: invalid === "missing" ? undefined : "page-1" });
      await expect(buildAliases(RUN, 7)).rejects.toThrow(/pagination cursor/);
      expect(f.write).not.toHaveBeenCalled();
      expect(f.state.listing.length).toBeLessThanOrEqual(2);
    });
  }
});
