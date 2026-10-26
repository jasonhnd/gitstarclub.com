import { fixtureRecords } from "../../scripts/fixture";
import { fallbackRegistry } from "../../../web/app/categories/category-page-data";
import { categoryAllTimeRankPath } from "../../../web/lib/categories/rank-pages";

/** Synthetic local coverage only; no published object or data coverage changes. */
export function categoryFixture() {
  const records = fixtureRecords();
  const meta = JSON.parse(records.get("views/fixture-v1/meta.json")!);
  meta.active_repo_count = 7654;
  records.set("views/fixture-v1/meta.json", JSON.stringify(meta));
  records.set("meta.json", JSON.stringify(meta));
  const registry = fallbackRegistry();
  registry.generated_at = "2026-07-17T00:00:00.000Z";
  registry.rules_version = "fixture-v1";
  const category = registry.dimensions.find((entry) => entry.id === "language")!.categories.find((entry) => entry.slug === "typescript")!;
  category.count = 101;
  const body = JSON.stringify(registry);
  records.set("categories/registry.json", body);
  records.set("views/fixture-v1/categories/registry.json", body);
  const pageTwo = categoryAllTimeRankPath("language", "typescript", 2);
  const first = JSON.parse(records.get(categoryAllTimeRankPath("language", "typescript"))!);
  first.items[0].rank = 101;
  for (const prefix of ["", "views/fixture-v1/"]) records.set(`${prefix}${pageTwo}`, JSON.stringify(first));
  return records;
}
