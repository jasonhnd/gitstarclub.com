import { cache } from "react";
import type { Window, Dim, Metric, RankItem, RepoLookupEntry, OrgLookupEntry } from "@/lib/contracts";
import { RankList } from "@/lib/contracts";
import { DAILY_BASE_VIEW_OPTS, DAILY_BASE_VIEW_TTL_MS, readView } from "./source";
import { isLiveOverlayPeriod } from "./watermark";

const today = () => new Date().toISOString().slice(0, 10);

function hasLiveRank(window: Window, dim: Dim, metric: Metric): boolean {
  if (dim !== "repo") return false;
  if (window === "month") return metric === "flow" || metric === "stock";
  if (window === "week") return metric === "flow";
  return false;
}

export const getRankBase = cache((window: Window, period: string, dim: Dim, metric: Metric) =>
  readView(`rank/${window}/${period}/${dim}/${metric}.json`, RankList, { base: true }),
);
export const getRankBaseDaily = cache((window: Window, period: string, dim: Dim, metric: Metric) =>
  readView(`rank/${window}/${period}/${dim}/${metric}.json`, RankList, DAILY_BASE_VIEW_OPTS),
);

export const getRank = cache(async (window: Window, period: string, dim: Dim, metric: Metric) => {
  const liveWindow = window === "month" || window === "week" ? window : null;
  if (liveWindow && hasLiveRank(window, dim, metric) && (await isLiveOverlayPeriod(liveWindow, period))) {
    const live = await readView(`live/rank/${window}/${period}/${dim}/${metric}.json`, RankList, { bust: today() });
    if (live) return live;
  }
  return getRankBase(window, period, dim, metric);
});
export const getRankDaily = cache(async (window: Window, period: string, dim: Dim, metric: Metric) => {
  const liveWindow = window === "month" || window === "week" ? window : null;
  if (liveWindow && hasLiveRank(window, dim, metric) && (await isLiveOverlayPeriod(liveWindow, period, DAILY_BASE_VIEW_TTL_MS))) {
    const live = await readView(`live/rank/${window}/${period}/${dim}/${metric}.json`, RankList, { bust: today() });
    if (live) return live;
  }
  return getRankBaseDaily(window, period, dim, metric);
});

export const getAllTime = cache((dim: Dim) => readView(`rank/all-time/${dim}/stock.json`, RankList, { base: true }));

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
