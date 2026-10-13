import { getRankDaily, getReposLookupDaily, joinRepoRank } from "@/lib/data";
import { monthLabel } from "@/lib/format";
import { rankingRoutePeriod, githubRepoFullName } from "@/lib/public-params";
import { rankingCard, siteCard, OG_SIZE } from "@/lib/og-card";

// Per-period social card: "<Month Year>" / "<Year> · Week N" + that period's top-3 by gain.
export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "GitHub star rankings";
export const revalidate = 86400;

export default async function Image({ params }: { params: Promise<{ year: string; period: string }> }) {
  const { year, period } = await params;
  const parsed = rankingRoutePeriod(year, period);
  if (!parsed || parsed.window === "year") return siteCard();
  const label = parsed.window === "week"
    ? `${parsed.year} · Week ${parsed.week}`
    : `${monthLabel("en", parsed.month, "long")} ${parsed.year}`;
  const [flow, lookup] = await Promise.all([getRankDaily(parsed.window, parsed.period, "repo", "flow"), getReposLookupDaily()]);
  if (!flow || !lookup) return siteCard();
  const rows = joinRepoRank(flow.items, lookup)
    .filter((r) => githubRepoFullName(r.owner, r.name) !== null)
    .slice(0, 3).map((r) => ({ full: `${r.owner}/${r.name}`, gained: r.value }));
  return rankingCard(label, rows);
}
