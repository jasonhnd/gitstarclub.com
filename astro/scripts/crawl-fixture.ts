import { p1FixtureRecords } from "../tests/p1/fixture";
import { FIRST_YEAR } from "../../web/lib/periods";
import { CATEGORY_DIMENSIONS } from "../../web/lib/categories/rules";

/** Complete the checked-in synthetic fixture's declared link graph, never real data. */
export function crawlFixtureRecords() {
  const records = p1FixtureRecords();
  const put = (key: string, value: unknown) => {
    const body = JSON.stringify(value);
    records.set(key, body); records.set(`views/fixture-v1/${key}`, body);
  };
  // Sitemaps and archive navigation declare the existing FIRST_YEAR..folded year range.
  // Seed a single synthetic example row for each declared year, not new repositories.
  const year = JSON.parse(records.get("rank/year/2026/repo/flow.json")!);
  for (let value = FIRST_YEAR; value <= 2026; value++) put(`rank/year/${value}/repo/flow.json`, {
    ...year, meta: { ...year.meta, period: String(value) },
  });
  // The category index always exposes all seven dimensions; the base fixture has one.
  const registry = JSON.parse(records.get("categories/registry.json")!);
  for (const dimension of CATEGORY_DIMENSIONS) if (!registry.dimensions.some((entry: { id: string }) => entry.id === dimension)) {
    registry.dimensions.push({ id: dimension, label: dimension, categories: [] });
  }
  put("categories/registry.json", registry);
  return records;
}
