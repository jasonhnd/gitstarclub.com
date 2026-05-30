import type { MetadataRoute } from "next";
import { getReposLookup, getOrgsLookup, getMeta } from "@/lib/data";

// Enumerates every indexable URL so crawlers can discover the on-demand ISR long tail
// (SEO §3.1b / §4). ~9.6k URLs — under the 50k single-file limit; shard via generateSitemaps
// if it ever grows past that. lastModified is the stable pipeline date (not new Date()), per §3.3.
const BASE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://gitstarclub.com";
const FIRST_YEAR = 2015;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [repos, orgs, meta] = await Promise.all([getReposLookup(), getOrgsLookup(), getMeta()]);
  const lastModified = meta?.backfilled_at ? new Date(meta.backfilled_at) : new Date();
  const now = new Date();
  const curYear = now.getUTCFullYear();
  const at = (path: string) => ({ url: `${BASE}${path}`, lastModified });

  const entries: MetadataRoute.Sitemap = [at("/"), at("/rankings"), at("/trending"), at("/about")];
  for (let y = FIRST_YEAR; y <= curYear; y++) {
    entries.push(at(`/${y}`));
    const lastMonth = y === curYear ? now.getUTCMonth() + 1 : 12;
    for (let m = 1; m <= lastMonth; m++) entries.push(at(`/${y}/${m}`));
  }
  if (repos) for (const e of Object.values(repos)) entries.push(at(`/r/${e.full_name}`));
  if (orgs) for (const login of Object.keys(orgs)) entries.push(at(`/o/${login}`));
  return entries;
}
