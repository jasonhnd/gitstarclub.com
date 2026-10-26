export type RepairRemovalNotice = Readonly<{ date: string | null; count: number }>;

/** Set the ISO publish date in the go-live PR; null keeps the notice disabled. */
export const REPAIR_REMOVAL_NOTICE: RepairRemovalNotice = { date: null, count: 4 };

/** The removal affects historical monthly repository rankings through its month. */
export function repairRemovalNoticeText(
  window: string,
  entity: string,
  period: string,
  template: string,
  notice: RepairRemovalNotice = REPAIR_REMOVAL_NOTICE,
): string | undefined {
  if (!notice.date || window !== "month" || entity !== "repo") return undefined;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period) || period > notice.date.slice(0, 7)) return undefined;
  return template.replace(/\{(date|count)\}/g, (_, key: "date" | "count") => String(notice[key]));
}
