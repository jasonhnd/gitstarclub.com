import { getRank, getReposLookup, joinRepoRank } from "@/lib/data";
import { rankingCard, OG_SIZE } from "@/lib/og-card";

// Per-year social card: "<Year>" + that year's top-3 repos by stars gained.
export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "GitHub star rankings";

export default async function Image({ params }: { params: Promise<{ year: string }> }) {
  const { year } = await params;
  const [flow, lookup] = await Promise.all([getRank("year", year, "repo", "flow"), getReposLookup()]);
  const rows = flow && lookup ? joinRepoRank(flow.items, lookup).slice(0, 3).map((r) => ({ full: `${r.owner}/${r.name}`, gained: r.value })) : [];
  return rankingCard(`${year}`, rows);
}
