import { expect, test } from "bun:test";
import { fixtureRecords } from "../../scripts/fixture";
import { fetchWithTimeout, withPublishedReaders } from "../../src/lib/published-readers";
import type { pageData } from "../../src/lib/data";
import { CategoryRegistry, CategoryRankList, Meta } from "../../../web/lib/contracts";
import { categoryAllTimeRankPath } from "../../../web/lib/categories/rank-pages";
import { publicationScope } from "../../../web/lib/workers-host/publication-fence";

type Data = ReturnType<typeof pageData>;
function nativeData(id: string, records = fixtureRecords(id)) {
  const calls: string[] = [];
  const data: Data = {
    publication: { id, views: null, bootstrap: null, live: null },
    base: async () => { throw new Error("The original readers select published paths"); },
    async raw(key, schema) {
      calls.push(key);
      const value = records.get(key);
      return value === undefined ? null : schema.parse(JSON.parse(value));
    },
  };
  return { data, calls };
}
const origin = (id: string) => `https://${id}.astro-data.invalid`;

test("category contracts use the shared captured-publication transport", async () => {
  const { data, calls } = nativeData("category");
  const rankPath = categoryAllTimeRankPath("language", "typescript");
  const previousFetch = globalThis.fetch;
  await withPublishedReaders(data, async () => {
    const registry = CategoryRegistry.parse(await (await fetchWithTimeout(`${origin("category")}/views/category/categories/registry.json`)).json());
    const rank = CategoryRankList.parse(await (await fetchWithTimeout(`${origin("category")}/views/category/${rankPath}`)).json());
    expect(registry.dimensions[0].categories[0].slug).toBe("typescript");
    expect(rank.items.map((item) => item.id)).toEqual([1]);
    expect((await fetchWithTimeout(`${origin("category")}/views/category/${categoryAllTimeRankPath("language", "typescript", 2)}`)).status).toBe(404);
  });
  expect(calls).toEqual(["views/category/categories/registry.json", `views/category/${rankPath}`, `views/category/${categoryAllTimeRankPath("language", "typescript", 2)}`]);
  expect(globalThis.fetch).toBe(previousFetch);
});

test("simultaneous category publications stay isolated through the common scope", async () => {
  const dates = await Promise.all([
    ["left", "2026-07-17T00:00:00.000Z"],
    ["right", "2026-10-21T00:00:00.000Z"],
  ].map(([id, date]) => {
    const { data } = nativeData(id, fixtureRecords(id, date));
    return withPublishedReaders(data, async () => {
      await Bun.sleep(id === "left" ? 5 : 1);
      expect(publicationScope.getStore()?.id).toBe(id);
      const response = await fetchWithTimeout(`${origin(id)}/views/${id}/meta.json`);
      return Meta.parse(await response.json()).generated_at;
    });
  }));
  expect(dates).toEqual(["2026-07-17T00:00:00.000Z", "2026-10-21T00:00:00.000Z"]);
  expect(publicationScope.getStore()).toBeUndefined();
});
