import { getMeta } from "./meta";
import { currentUtcPeriods } from "@/lib/periods";

// Live-overlay watermark (VERCEL-DATA-OPERATIONS §7.2). A week/month period is served by the live overlay while it
// is NOT yet folded into the base, i.e. period > folded_through. This keeps a just-closed
// period reading its frozen-complete live snapshot until the fold moves it into canonical —
// without it, a period vanishes the moment it stops being "current" but before it is folded.
// Falls back to "is current period" when meta has no folded_through (flat bootstrap meta).

export async function isLiveOverlayPeriod(window: "week" | "month", period: string, versionTtlMs?: number): Promise<boolean> {
  const meta = await getMeta(versionTtlMs);
  const fold = meta?.folded_through;
  if (fold) return period > fold[window];
  const current = currentUtcPeriods();
  return window === "month" ? period === current.monthPeriod : period === current.weekPeriod;
}
