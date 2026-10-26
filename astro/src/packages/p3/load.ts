import { CategoriesPageView, CategoryDimensionPageView, CategoryDetailPageView, generateCategoriesMetadata, generateCategoryDimensionMetadata, generateCategoryDetailMetadataForLocale } from "astro-p3:categories";
import { localizedPath, type Locale } from "../../lib/i18n";
import { parsePositivePage } from "../../../../web/lib/pagination";
import { categoryCatalogAsOf, categoryDetailAsOf, fallbackRegistry } from "../../../../web/app/categories/category-page-data";
import { getCategoryAllTimePage, getCategoryRegistry, getMeta } from "../../../../web/lib/data";
import type { pageData } from "../../lib/data";
import { withPublishedReaders } from "../../lib/published-readers";
import { CategoryNotFound } from "./navigation";
import { createElement } from "react";
import { AboutThisDataContent } from "../../components/AboutThisDataContent";
import { getDictionary } from "../../lib/i18n";

export async function loadCategoryPage(reader: ReturnType<typeof pageData>, params: { locale: Locale; dimension?: string; slug?: string; rawPage?: string }) {
  const { locale, dimension, slug, rawPage } = params;
  const page = rawPage === undefined ? 1 : parsePositivePage(rawPage);
  if (!page) return new Response("Not found", { status: 404 });
  const detailPath = `/categories/${dimension}/${slug}`;
  if (rawPage !== undefined && page === 1) return new Response(null, { status: 308, headers: { Location: localizedPath(locale, detailPath) } });
  const canonicalPath = slug ? `${detailPath}${page > 1 ? `/page/${page}` : ""}` : dimension ? `/categories/${dimension}` : "/categories";
  try {
    return await withPublishedReaders(reader, async () => {
      const [meta, dictionary] = await Promise.all([getMeta(), getDictionary(locale)]);
      const metadata = slug && dimension
        ? await generateCategoryDetailMetadataForLocale(locale, { dimension, slug, page: String(page) })
        : dimension ? await generateCategoryDimensionMetadata(locale, dimension) : await generateCategoriesMetadata(locale);
      const title = String(metadata.title);
      const canonicalUrl = new URL(localizedPath(locale, canonicalPath), "https://gitstarclub.com").href;
      const aboutThisData = createElement(AboutThisDataContent, {
        locale, dictionary, meta, releaseId: reader.publication.views?.version ?? null,
        layer: "currentTotals", pageTitle: title, canonicalUrl,
      });
      const body = slug && dimension ? await CategoryDetailPageView({ locale, dimension, slug, page, aboutThisData })
        : dimension ? await CategoryDimensionPageView({ locale, dimension, aboutThisData }) : await CategoriesPageView({ locale, aboutThisData });
      const registry = (await getCategoryRegistry()) ?? fallbackRegistry();
      const asOf = slug && dimension
        ? categoryDetailAsOf((await getCategoryAllTimePage(dimension, slug, page))?.meta.generated_at, registry, meta, locale)
        : categoryCatalogAsOf(registry, meta, locale);
      return { locale, canonicalPath, title, description: metadata.description ?? "", body, asOf };
    });
  } catch (error) {
    if (error instanceof CategoryNotFound) return new Response("Not found", { status: 404 });
    throw error;
  }
}
