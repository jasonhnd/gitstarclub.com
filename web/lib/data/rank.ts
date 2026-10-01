import { cache } from "react";
import { isRankingPeriod } from "@/lib/public-params";
import type { Window, Dim, Metric, RankItem, RepoLookupEntry, OrgLookupEntry } from "@/lib/contracts";
import { RankList } from "@/lib/contracts";
import {
  DAILY_BASE_VIEW_OPTS,
  DAILY_BASE_VIEW_TTL_MS,
  readAuthoritativeView,
  readView,
} from "./source";
import { isLiveOverlayPeriod } from "./watermark";

const today = () => new Date().toISOString().slice(0, 10);

function hasLiveRank(window: Window, dim: Dim, metric: Metric): boolean {
  if (dim !== "repo") return false;
  if (window === "month") return metric === "flow" || metric === "stock";
  if (window === "week") return metric === "flow";
  return false;
}

function rankPath(window: Window, period: string, dim: Dim, metric: Metric): string | null {
  if (!isRankingPeriod(window, period) || !["repo", "org"].includes(dim) || !["flow", "stock", "growth", "new"].includes(metric)) return null;
  return `rank/${window}/${period}/${dim}/${metric}.json`;
}

export const getRankBase = cache(async (window: Window, period: string, dim: Dim, metric: Metric) => {
  const path = rankPath(window, period, dim, metric);
  return path ? readView(path, RankList, { base: true }) : null;
});
export const getRankBaseDaily = cache(async (window: Window, period: string, dim: Dim, metric: Metric) => {
  const path = rankPath(window, period, dim, metric);
  return path ? readView(path, RankList, DAILY_BASE_VIEW_OPTS) : null;
});
/** Cron mutation input; never reinterpret invalid input or a transport error as a missing base rank. */
export const getRankBaseAuthoritative = (window: Window, period: string, dim: Dim, metric: Metric) => {
  const path = rankPath(window, period, dim, metric);
  if (!path) throw new Error("Invalid ranking parameters");
  return readAuthoritativeView(path, RankList, { base: true });
};

async function readLiveRank(window: "week" | "month", period: string, dim: Dim, metric: Metric, versionTtlMs?: number) {
  const path = rankPath(window, period, dim, metric);
  if (!path) return null;
  return readView(path, RankList, {
    live: true,
    liveHistory: true,
    legacyPath: `live/${path}`,
    bust: today(),
    ...(versionTtlMs != null ? { liveTtlMs: versionTtlMs } : {}),
  });
}

/**
 * Prefer live overlay while the period is still open relative to folded_through.
 * If the fold watermark has advanced but base still has no view (e.g. 2026-W27
 * GH Archive recovery with no pending fold input), keep serving the live shard
 * so recovered weeks do not 404 after July freeze.
 *
 * Pure selection is exported for unit tests so recovered-week durability does not
 * require mock.module on source/watermark (those mocks leak across Bun's process).
 */
export function selectRankPayload<T>(args: {
  live: T | null | undefined;
  base: T | null | undefined;
  isLiveOverlay: boolean;
}): T | null {
  const { live, base, isLiveOverlay } = args;
  if (live && isLiveOverlay) return live;
  if (live && !base) return live;
  return base ?? null;
}

/**
 * Live-capable periods only:
 * 1. While still open relative to folded_through → read live first.
 * 2. After fold advances → read base first (no live hop for normal history).
 * 3. If base is missing after fold (recovered live-only weeks) → fall back to live.
 */
export const getRank = cache(async (window: Window, period: string, dim: Dim, metric: Metric) => {
  if (!rankPath(window, period, dim, metric)) return null;
  const liveWindow = window === "month" || window === "week" ? window : null;
  if (liveWindow && hasLiveRank(window, dim, metric)) {
    const isLiveOverlay = await isLiveOverlayPeriod(liveWindow, period);
    if (isLiveOverlay) {
      const live = await readLiveRank(liveWindow, period, dim, metric);
      if (live) return live;
      return getRankBase(window, period, dim, metric);
    }
    const base = await getRankBase(window, period, dim, metric);
    if (base) return base;
    const live = await readLiveRank(liveWindow, period, dim, metric);
    return selectRankPayload({ live, base: null, isLiveOverlay: false });
  }
  return getRankBase(window, period, dim, metric);
});
export const getRankDaily = cache(async (window: Window, period: string, dim: Dim, metric: Metric) => {
  if (!rankPath(window, period, dim, metric)) return null;
  const liveWindow = window === "month" || window === "week" ? window : null;
  if (liveWindow && hasLiveRank(window, dim, metric)) {
    const isLiveOverlay = await isLiveOverlayPeriod(liveWindow, period, DAILY_BASE_VIEW_TTL_MS);
    if (isLiveOverlay) {
      const live = await readLiveRank(liveWindow, period, dim, metric, DAILY_BASE_VIEW_TTL_MS);
      if (live) return live;
      return getRankBaseDaily(window, period, dim, metric);
    }
    const base = await getRankBaseDaily(window, period, dim, metric);
    if (base) return base;
    const live = await readLiveRank(liveWindow, period, dim, metric, DAILY_BASE_VIEW_TTL_MS);
    return selectRankPayload({ live, base: null, isLiveOverlay: false });
  }
  return getRankBaseDaily(window, period, dim, metric);
});

export const getAllTime = cache(async (dim: Dim) =>
  ["repo", "org"].includes(dim) ? readView(`rank/all-time/${dim}/stock.json`, RankList, { base: true }) : null,
);

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
