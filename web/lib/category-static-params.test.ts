import { describe, expect, test } from "bun:test";
import {
  generateCategoryDetailPageStaticParams,
  generateCategoryDetailStaticParams,
  generateLocalizedCategoryDetailPageStaticParams,
  generateLocalizedCategoryDetailStaticParams,
} from "@/app/_localized/categories";
import { priorityLanguageStaticParams } from "@/app/categories/category-page-data";
import { NON_DEFAULT_LOCALES } from "@/lib/i18n/routing";

const CATEGORY_DETAIL_DEPLOY_ROUTE_BUDGET = 200;

describe("category deploy-time static params", () => {
  test("pre-renders only the finite priority-language set", () => {
    const english = generateCategoryDetailStaticParams();
    const localized = generateLocalizedCategoryDetailStaticParams();
    const priority = priorityLanguageStaticParams();

    expect(english).toEqual(priority);
    expect(localized).toHaveLength(priority.length * NON_DEFAULT_LOCALES.length);
    expect(english.length + localized.length).toBeLessThanOrEqual(CATEGORY_DETAIL_DEPLOY_ROUTE_BUDGET);
    expect(new Set(localized.map(({ locale, dimension, slug }) => `${locale}/${dimension}/${slug}`)).size).toBe(
      localized.length,
    );
  });

  test("leaves every page 2+ route to on-demand ISR", () => {
    expect(generateCategoryDetailPageStaticParams()).toEqual([]);
    expect(generateLocalizedCategoryDetailPageStaticParams()).toEqual([]);
  });
});
