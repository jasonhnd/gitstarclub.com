/** Empty copy for the Pulse “On this day” panel.
 * A timestamp means the writer verified milestone history for this month/day.
 * Null or absent freshness means that history was never established, so a
 * later refresh cannot be described as the thing that will fill the panel.
 */
export function onThisDayEmptyMessage(
  sectionAsOf: string | null | undefined,
  copy: { unavailable: string; noneToday: string },
): string {
  return sectionAsOf ? copy.noneToday : copy.unavailable;
}
