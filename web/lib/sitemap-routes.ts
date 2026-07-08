import { CategoriesLookup, Meta, OrgsLookup, ReposLookup } from "@/lib/contracts";
import { readView } from "@/lib/data";
import type { Locale } from "@/lib/i18n";
import {
  buildLocaleSitemapEntries,
  buildSitemapIndexEntries,
  buildSitemapIndexXml,
  buildSitemapPaths,
  buildSitemapXml,
  resolveSitemapLastModified,
} from "@/lib/sitemap";

const SITEMAP_REVALIDATE_SECONDS = 86400;
const CACHE_CONTROL = `public, max-age=0, s-maxage=${SITEMAP_REVALIDATE_SECONDS}, stale-while-revalidate=${SITEMAP_REVALIDATE_SECONDS}`;
const XML_HEADERS = {
  "content-type": "application/xml; charset=utf-8",
  "cache-control": CACHE_CONTROL,
};

export async function sitemapIndexRoute(): Promise<Response> {
  const data = await readSitemapData();
  return xmlResponse(buildSitemapIndexXml(buildSitemapIndexEntries(data.lastModified)));
}

export function localeSitemapRoute(locale: Locale): () => Promise<Response> {
  return async () => {
    const data = await readSitemapData();
    const entries = buildLocaleSitemapEntries(locale, data.paths, {
      meta: data.meta,
      categories: data.categories,
    });
    return xmlResponse(buildSitemapXml(entries));
  };
}

async function readSitemapData() {
  const base = { base: true, versionTtlMs: SITEMAP_REVALIDATE_SECONDS * 1000 };
  const [repos, orgs, categories, meta] = await Promise.all([
    readView("lookup/repos.json", ReposLookup, base),
    readView("lookup/orgs.json", OrgsLookup, base),
    readView("lookup/categories.json", CategoriesLookup, base),
    readView("meta.json", Meta, base),
  ]);
  const lastModified = resolveSitemapLastModified(meta);
  const paths = buildSitemapPaths({ repos, orgs, categories, meta, now: lastModified });

  return { paths, categories, meta, lastModified };
}

function xmlResponse(body: string): Response {
  return new Response(body, { headers: XML_HEADERS });
}
