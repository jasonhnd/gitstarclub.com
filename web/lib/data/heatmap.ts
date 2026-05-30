import { cache } from "react";
import { Heatmap } from "@/lib/contracts";
import { readView } from "./source";

export const getHeatmap = cache((scope: "year" | "month", period: string) =>
  readView(`heatmap/${scope}/${period}.json`, Heatmap),
);
