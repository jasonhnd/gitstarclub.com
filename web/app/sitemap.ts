import type { MetadataRoute } from "next";
import { CategoriesLookup, Meta, OrgsLookup, ReposLookup } from "@/lib/contracts";
import { readView } from "@/lib/data";
import { absoluteCanonicalUrl, buildSitemapPaths, sitemapChangeFrequency, sitemapLastModified, sitemapPriority, siteBaseUrl } from "@/lib/sitemap";

// Enumerates every canonical URL so crawlers discover the on-demand ISR long tail.
// Language is an in-page preference, not a URL dimension.
const BASE = siteBaseUrl();
const SITEMAP_REVALIDATE_SECONDS = 86400;

export const revalidate = 86400;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = { base: true, versionTtlMs: SITEMAP_REVALIDATE_SECONDS * 1000 };
  const [repos, orgs, categories, meta] = await Promise.all([
    readView("lookup/repos.json", ReposLookup, base),
    readView("lookup/orgs.json", OrgsLookup, base),
    readView("lookup/categories.json", CategoriesLookup, base),
    readView("meta.json", Meta, base),
  ]);
  const paths = buildSitemapPaths({ repos, orgs, categories });

  return paths.map((p) => ({
    url: absoluteCanonicalUrl(p, BASE),
    lastModified: sitemapLastModified(p, { meta, categories }),
    changeFrequency: sitemapChangeFrequency(p),
    priority: sitemapPriority(p),
  }));
}
