import { cache } from "react";
import { Heatmap } from "@/lib/contracts";
import { readView } from "./source";
import { currentUtcPeriods } from "@/lib/periods";

const today = () => new Date().toISOString().slice(0, 10);

export const getHeatmapBase = cache((scope: "year" | "month", period: string) =>
  readView(`heatmap/${scope}/${period}.json`, Heatmap, { base: true }),
);

export const getHeatmap = cache(async (scope: "year" | "month", period: string) => {
  if (scope === "month" && period === currentUtcPeriods().monthPeriod) {
    const live = await readView(`live/heatmap/${scope}/${period}.json`, Heatmap, { bust: today() });
    if (live) return live;
  }
  return getHeatmapBase(scope, period);
});
