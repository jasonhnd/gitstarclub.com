import type { MetadataRoute } from "next";
import { getReposLookup, getOrgsLookup, getMeta } from "@/lib/data";
import { LOCALES } from "@/lib/i18n";

// Enumerates every indexable URL (× 3 locales) so crawlers discover the on-demand ISR long
// tail (SEO §3.1b / §4). ~29k URLs — under the 50k single-file limit; shard via
// generateSitemaps if it grows past that. lastModified = stable pipeline date (§3.3).
const BASE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://gitstarclub.com";
const FIRST_YEAR = 2015;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [repos, orgs, meta] = await Promise.all([getReposLookup(), getOrgsLookup(), getMeta()]);
  const lastModified = meta?.backfilled_at ? new Date(meta.backfilled_at) : new Date();
  const now = new Date();
  const curYear = now.getUTCFullYear();

  const paths: string[] = ["", "/pulse", "/rankings", "/about"]; // "" = locale home
  for (let y = FIRST_YEAR; y <= curYear; y++) {
    paths.push(`/rankings/${y}`);
    const lastMonth = y === curYear ? now.getUTCMonth() + 1 : 12;
    for (let m = 1; m <= lastMonth; m++) paths.push(`/rankings/${y}/${m}`);
  }
  if (repos) for (const e of Object.values(repos)) paths.push(`/r/${e.full_name}`);
  if (orgs) for (const login of Object.keys(orgs)) paths.push(`/o/${login}`);

  const entries: MetadataRoute.Sitemap = [];
  for (const p of paths) for (const loc of LOCALES) entries.push({ url: `${BASE}/${loc}${p}`, lastModified });
  return entries;
}
