import { cache } from "react";
import { Heatmap } from "@/lib/contracts";
import { readAuthoritativeView, readView } from "./source";
import { isLiveOverlayPeriod } from "./watermark";

const today = () => new Date().toISOString().slice(0, 10);

export const getHeatmapBase = cache((scope: "year" | "month", period: string) =>
  readView(`heatmap/${scope}/${period}.json`, Heatmap, { base: true }),
);
/** Cron mutation input; only a confirmed 404 may initialize an empty heatmap base. */
export const getHeatmapBaseAuthoritative = (scope: "year" | "month", period: string) =>
  readAuthoritativeView(`heatmap/${scope}/${period}.json`, Heatmap, { base: true });

export const getHeatmap = cache(async (scope: "year" | "month", period: string) => {
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
