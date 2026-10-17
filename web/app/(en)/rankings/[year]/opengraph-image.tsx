import { getRankDaily, getReposLookupDaily, joinRepoRank } from "@/lib/data";
import { rankingRoutePeriod, githubRepoFullName } from "@/lib/public-params";
import { rankingCard, siteCard, OG_SIZE } from "@/lib/og-card";

// Per-year social card: "<Year>" + that year's top-3 repos by stars gained.
export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "GitHub star rankings";
export const revalidate = 86400;

export default async function Image({ params }: { params: Promise<{ year: string }> }) {
  const { year } = await params;
  const parsed = rankingRoutePeriod(year);
  if (!parsed) return siteCard();
  const [flow, lookup] = await Promise.all([getRankDaily("year", parsed.period, "repo", "flow"), getReposLookupDaily()]);
  if (!flow || !lookup) return siteCard();
  const rows = joinRepoRank(flow.items, lookup)
    .filter((r) => githubRepoFullName(r.owner, r.name) !== null)
    .slice(0, 3).map((r) => ({ full: `${r.owner}/${r.name}`, gained: r.value }));
  return rankingCard(String(parsed.year), rows);
}
