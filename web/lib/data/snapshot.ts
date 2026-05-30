import { cache } from "react";
import { HotSnapshot, CurrentMonth } from "@/lib/contracts";
import { readView } from "./source";

// Daily live tail (written by cron, M4). Read with ?v=<today> to dodge Blob's ≤60s
// same-path propagation window (OPS §Blob). Absent until cron runs → callers handle null.

const today = () => new Date().toISOString().slice(0, 10);

export const getHotSnapshot = cache(() => readView("hot-snapshot.json", HotSnapshot, { bust: today() }));
export const getCurrentMonth = cache(() => readView("current_month.json", CurrentMonth, { bust: today() }));
