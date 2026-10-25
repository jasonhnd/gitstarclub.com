import { PreviewHistoryAvailability } from "@/lib/contracts/canonical";
import { isPreDeployment } from "@/lib/runtime-config";

export const HISTORY_AVAILABILITY_KEY = "canonical/v2/history-availability.json";
export type HistoryAvailability = "strict" | PreviewHistoryAvailability;

/**
 * Read a decoded marker without I/O or changes to validation. Missing or invalid
 * data and non-preview deployments stay strict; shard contents and fold
 * watermarks never establish unavailable coverage.
 */
export function readHistoryAvailability(
  marker: unknown,
  env?: Parameters<typeof isPreDeployment>[0],
): HistoryAvailability {
  if (!isPreDeployment(env)) return "strict";
  const parsed = PreviewHistoryAvailability.safeParse(marker);
  return parsed.success ? parsed.data : "strict";
}
