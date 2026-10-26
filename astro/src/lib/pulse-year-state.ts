import type { HotSnapshot } from "../../../web/lib/contracts";
import type { AvailableRankPeriods } from "../../../web/lib/data/rank-periods";

export function pulseYearUnavailable(period: AvailableRankPeriods["yearLink"], snapshot: HotSnapshot | null): boolean {
  return period.kind !== "year" || snapshot?.freshness?.current_year === null;
}

export function pulseYearRows<T>(unavailable: boolean, rows: T[]): T[] {
  return unavailable ? [] : rows;
}
