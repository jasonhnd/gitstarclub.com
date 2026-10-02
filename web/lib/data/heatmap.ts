import { cache } from "react";
import { isRankingPeriod } from "@/lib/public-params";
import { Heatmap } from "@/lib/contracts";
import { readAuthoritativeView, readView } from "./source";
import { isLiveOverlayPeriod } from "./watermark";

function validHeatmapPeriod(scope: "year" | "month", period: string): boolean {
  return (scope === "year" || scope === "month") && isRankingPeriod(scope, period);
}

const today = () => new Date().toISOString().slice(0, 10);

export const getHeatmapBase = cache(async (scope: "year" | "month", period: string) =>
  validHeatmapPeriod(scope, period) ? readView(`heatmap/${scope}/${period}.json`, Heatmap, { base: true }) : null,
);
/** Cron mutation input; only a confirmed 404 may initialize an empty heatmap base. */
export const getHeatmapBaseAuthoritative = (scope: "year" | "month", period: string) => {
  if (!validHeatmapPeriod(scope, period)) throw new Error("Invalid heatmap parameters");
  return readAuthoritativeView(`heatmap/${scope}/${period}.json`, Heatmap, { base: true });
};

export const getHeatmap = cache(async (scope: "year" | "month", period: string) => {
  if (!validHeatmapPeriod(scope, period)) return null;
  if (scope === "month" && (await isLiveOverlayPeriod("month", period))) {
    const path = `heatmap/${scope}/${period}.json`;
    const live = await readView(path, Heatmap, {
      live: true,
      liveHistory: true,
      legacyPath: `live/${path}`,
      bust: today(),
    });
    if (live) return live;
  }
  return getHeatmapBase(scope, period);
});
