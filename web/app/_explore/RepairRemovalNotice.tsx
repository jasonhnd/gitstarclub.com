import type { Locale } from "@/lib/i18n/locales";
import type { Dict } from "@/lib/i18n";
import { repairRemovalNoticeText, type RepairRemovalNotice as Notice } from "@/lib/repair-removal-notice";

export function RepairRemovalNotice({ window, entity, period, copy, locale, notice }: {
  locale: Locale;
  window: string;
  entity: string;
  period: string;
  copy: Pick<Dict["rankings"], "repairRemovalNotice">;
  notice?: Notice;
}) {
  const text = repairRemovalNoticeText(window, entity, period, copy.repairRemovalNotice, locale, notice);
  if (!text) return null;
  return <p className="mt-3 border-l-2 rounded-2xl border-outline bg-surface-variant px-4 py-3 text-base leading-relaxed text-pretty text-on-surface">{text}</p>;
}
