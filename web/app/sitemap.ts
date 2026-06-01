import type { MetadataRoute } from "next";
import { getReposLookup, getOrgsLookup, getMeta } from "@/lib/data";

// Enumerates every canonical URL so crawlers discover the on-demand ISR long tail.
// Language is an in-page preference, not a URL dimension.
const BASE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://gitstarclub.com";
const FIRST_YEAR = 2015;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [repos, orgs, meta] = await Promise.all([getReposLookup(), getOrgsLookup(), getMeta()]);
  const lastModified = meta?.backfilled_at ? new Date(meta.backfilled_at) : new Date();
  const now = new Date();
  const curYear = now.getUTCFullYear();

  const paths: string[] = ["", "/pulse", "/rankings", "/about"]; // "" = home
  for (let y = FIRST_YEAR; y <= curYear; y++) {
    paths.push(`/rankings/${y}`);
    const lastMonth = y === curYear ? now.getUTCMonth() + 1 : 12;
    for (let m = 1; m <= lastMonth; m++) paths.push(`/rankings/${y}/${m}`);
  }
  if (repos) for (const e of Object.values(repos)) paths.push(`/${e.full_name}`);
  if (orgs) for (const login of Object.keys(orgs)) paths.push(`/o/${login}`);

  return paths.map((p) => ({ url: `${BASE}${p}`, lastModified }));
}
