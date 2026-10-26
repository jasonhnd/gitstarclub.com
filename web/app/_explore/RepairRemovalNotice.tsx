import type { Dict } from "@/lib/i18n";
import { repairRemovalNoticeText, type RepairRemovalNotice as Notice } from "@/lib/repair-removal-notice";
import { SourceNote } from "./SourceNote";

export function RepairRemovalNotice({ window, entity, period, copy, notice }: {
  window: string;
  entity: string;
  period: string;
  copy: Pick<Dict["rankings"], "repairRemovalNotice">;
  notice?: Notice;
}) {
  return <SourceNote text={repairRemovalNoticeText(window, entity, period, copy.repairRemovalNotice, notice)} />;
}
