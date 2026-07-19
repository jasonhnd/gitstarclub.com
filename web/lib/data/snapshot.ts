import { cache } from "react";
import { HotSnapshot, CurrentMonth } from "@/lib/contracts";
import { readView } from "./source";

// Daily live tail (written by cron, M4). All reads resolve through the same
// live/latest.json generation pointer. A missing pointer falls back to the old
// flat layout only during migration.

const today = () => new Date().toISOString().slice(0, 10);

export const getHotSnapshot = cache(() =>
  readView("hot-snapshot.json", HotSnapshot, { live: true, legacyPath: "hot-snapshot.json", bust: today() }),
);
export const getCurrentMonth = cache(() =>
  readView("current_month.json", CurrentMonth, { live: true, legacyPath: "current_month.json", bust: today() }),
);
