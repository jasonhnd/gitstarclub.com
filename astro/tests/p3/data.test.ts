import { expect, test } from "bun:test";
import { fixtureRecords } from "../../scripts/fixture";
import { getCategoryRegistry, getMeta, resolveAvailableCategoryPages, withCategoryData } from "../../src/packages/p3/data";
import { categoryAllTimeRankPath } from "../../../web/lib/categories/rank-pages";

function reader(records = fixtureRecords()) {
  const calls: string[] = [];
  return { calls, async base<T>(path: string, schema: { parse(value: unknown): T }) {
    calls.push(path);
    const value = records.get(path);
    return value === undefined ? null : schema.parse(JSON.parse(value));
  } };
}

test("category availability follows published contiguous pages and never invents a gap", async () => {
  const records = fixtureRecords();
  const first = records.get(categoryAllTimeRankPath("language", "typescript"))!;
  records.set(categoryAllTimeRankPath("language", "typescript", 3), first);
  const data = reader(records);
  await withCategoryData(data, async () => {
    expect(await resolveAvailableCategoryPages("language", "typescript", 301)).toEqual({ totalRows: 301, totalPagesFromRegistry: 4, availablePages: [1] });
    expect(await resolveAvailableCategoryPages("language", "typescript", 0)).toEqual({ totalRows: 0, totalPagesFromRegistry: 1, availablePages: [1] });
    expect(await resolveAvailableCategoryPages("language", "missing", 100)).toEqual({ totalRows: 100, totalPagesFromRegistry: 1, availablePages: [] });
  });
  expect(data.calls).not.toContain(categoryAllTimeRankPath("language", "typescript", 3));
});

test("request memoization shares registry reads but keeps concurrent publications isolated", async () => {
  const left = reader(fixtureRecords("left", "2026-07-17T00:00:00.000Z"));
  const right = reader(fixtureRecords("right", "2026-10-21T00:00:00.000Z"));
  const dates = await Promise.all([left, right].map((data) => withCategoryData(data, async () => {
    await Promise.all([getCategoryRegistry(), getCategoryRegistry()]);
    await Bun.sleep(2);
    return (await getMeta())?.generated_at;
  })));
  expect(dates).toEqual(["2026-07-17T00:00:00.000Z", "2026-10-21T00:00:00.000Z"]);
  expect(left.calls.filter((path) => path === "categories/registry.json")).toHaveLength(1);
  expect(right.calls.filter((path) => path === "categories/registry.json")).toHaveLength(1);
  expect(() => getCategoryRegistry()).toThrow("request-scoped publication");
});
