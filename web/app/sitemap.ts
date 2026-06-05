import type { MetadataRoute } from "next";
import { getCategoriesLookup, getReposLookup, getOrgsLookup, getMeta } from "@/lib/data";
import { buildSitemapPaths, resolveSitemapLastModified } from "@/lib/sitemap";

// Enumerates every canonical URL so crawlers discover the on-demand ISR long tail.
// Language is an in-page preference, not a URL dimension.
const BASE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://gitstarclub.com";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [repos, orgs, categories, meta] = await Promise.all([getReposLookup(), getOrgsLookup(), getCategoriesLookup(), getMeta()]);
  const lastModified = resolveSitemapLastModified(meta);
  const paths = buildSitemapPaths({ repos, orgs, categories });

  return paths.map((p) => ({ url: `${BASE}${p}`, lastModified }));
}
