import { z, type ZodType } from "zod";
import { PreviewHistoryAvailability } from "@/lib/contracts/canonical";
import { readAuthoritativeView } from "@/lib/data/source";
import { isPreDeployment } from "@/lib/runtime-config";

export const HISTORY_AVAILABILITY_KEY = "canonical/v2/history-availability.json";
export type HistoryAvailability = "strict" | PreviewHistoryAvailability;

/** Both canonical and publication gates use overlay-first, confirmed-404 fallback. */
export async function readCanonicalHistoryAvailability(
  runId: string,
  reader: (path: string, schema: ZodType) => Promise<unknown | null> =
    (path, schema) => readAuthoritativeView(path, schema, { bust: runId }),
): Promise<HistoryAvailability> {
  if (!isPreDeployment()) return "strict";
  // Decoded malformed declarations stay strict; transport/JSON failures block.
  return readHistoryAvailability(await reader(HISTORY_AVAILABILITY_KEY, z.unknown()));
}

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
