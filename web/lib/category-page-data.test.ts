import { describe, expect, test } from "bun:test";
import type { CategoryRegistryEntry } from "@/lib/contracts";
import {
  RELATED_PUBLIC_CATEGORY_LIMIT,
  THIN_CATEGORY_REPO_COUNT,
  isThinCategoryCount,
  relatedPublicCategories,
} from "@/app/categories/category-page-data";

describe("isThinCategoryCount", () => {
  test("treats small positive registry counts as thin slices", () => {
    expect(isThinCategoryCount(0)).toBe(false);
    expect(isThinCategoryCount(1)).toBe(true);
    expect(isThinCategoryCount(THIN_CATEGORY_REPO_COUNT)).toBe(true);
    expect(isThinCategoryCount(THIN_CATEGORY_REPO_COUNT + 1)).toBe(false);
  });
});

describe("relatedPublicCategories", () => {
  test("keeps only public siblings and stays bounded", () => {
    const siblings = relatedPublicCategories(
      [
        entry("language/python", true),
        entry("language/hidden", false),
        entry("language/go", true),
        entry("language/rust", true),
        ...Array.from({ length: 10 }, (_, index) => entry(`language/extra-${index}`, true)),
      ],
      "language/python",
    );

    expect(siblings.every((category) => category.public)).toBe(true);
    expect(siblings.map((category) => category.id)).not.toContain("language/python");
    expect(siblings.map((category) => category.id)).not.toContain("language/hidden");
    expect(siblings).toHaveLength(RELATED_PUBLIC_CATEGORY_LIMIT);
  });
});

function entry(id: string, isPublic: boolean): CategoryRegistryEntry {
  const [, slug] = id.split("/");
  return {
    id,
    dimension: "language",
    slug,
    label: slug,
    count: isPublic ? 3 : 1,
    public: isPublic,
    sitemap: isPublic,
    minimum_repo_count: 1,
  };
}
