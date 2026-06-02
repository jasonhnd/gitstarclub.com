import { cache } from "react";
import type { Window, Dim, Metric, RankItem, RepoLookupEntry, OrgLookupEntry } from "@/lib/contracts";
import { RankList } from "@/lib/contracts";
import { readView } from "./source";
import { currentUtcPeriods } from "@/lib/periods";

const today = () => new Date().toISOString().slice(0, 10);

export const getRankBase = cache((window: Window, period: string, dim: Dim, metric: Metric) =>
  readView(`rank/${window}/${period}/${dim}/${metric}.json`, RankList),
);

export const getRank = cache(async (window: Window, period: string, dim: Dim, metric: Metric) => {
  if (isLivePeriod(window, period)) {
    const live = await readView(`live/rank/${window}/${period}/${dim}/${metric}.json`, RankList, { bust: today() });
    if (live) return live;
  }
  return getRankBase(window, period, dim, metric);
});

export const getAllTime = cache((dim: Dim) => readView(`rank/all-time/${dim}/stock.json`, RankList));

// lookup-join: rank items carry only id/login + value; merge display fields from lookup/*.
// Entries missing from lookup are dropped (referential integrity is enforced upstream).

export type RankedRepo = RankItem & RepoLookupEntry & { id: number };
export type RankedOrg = RankItem & OrgLookupEntry;

export function joinRepoRank(items: RankItem[], lookup: Record<string, RepoLookupEntry>): RankedRepo[] {
  return items.flatMap((item) => {
    const meta = item.id != null ? lookup[String(item.id)] : undefined;
    return meta ? [{ ...item, ...meta, id: item.id! }] : [];
  });
}

export function joinOrgRank(items: RankItem[], lookup: Record<string, OrgLookupEntry>): RankedOrg[] {
  return items.flatMap((item) => {
    const meta = item.login != null ? lookup[item.login] : undefined;
    return meta ? [{ ...item, ...meta }] : [];
  });
}

function isLivePeriod(window: Window, period: string): boolean {
  const current = currentUtcPeriods();
  if (window === "month") return period === current.monthPeriod;
  if (window === "week") return period === current.weekPeriod;
  return false;
}
