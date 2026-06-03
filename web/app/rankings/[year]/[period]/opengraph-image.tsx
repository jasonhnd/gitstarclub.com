import { getRank, getReposLookup, joinRepoRank } from "@/lib/data";
import { monthLabel } from "@/lib/format";
import { rankingCard, OG_SIZE } from "@/lib/og-card";

// Per-period social card: "<Month Year>" / "<Year> · Week N" + that period's top-3 by gain.
export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "GitHub star rankings";

export default async function Image({ params }: { params: Promise<{ year: string; period: string }> }) {
  const { year, period } = await params;
  const week = /^W(\d{1,2})$/i.exec(period);
  const win = week ? "week" : "month";
  const p = week ? `${year}-W${String(Number(week[1])).padStart(2, "0")}` : `${year}-${String(Number(period)).padStart(2, "0")}`;
  const label = week ? `${year} · Week ${Number(week[1])}` : `${monthLabel("en", Number(period), "long")} ${year}`;
  const [flow, lookup] = await Promise.all([getRank(win, p, "repo", "flow"), getReposLookup()]);
  const rows = flow && lookup ? joinRepoRank(flow.items, lookup).slice(0, 3).map((r) => ({ full: `${r.owner}/${r.name}`, gained: r.value })) : [];
  return rankingCard(label, rows);
}
