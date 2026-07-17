import {
  rollbackVersionWithDeps,
  type PublicationResult,
} from "@/lib/workflows/publication-core";
import { productionPublicationDeps } from "@/lib/workflows/publication-deps";

/**
 * Roll a published pointer back under a separately acquired, fenced operation
 * lease. The rollback is replay-safe and uses the forward publication's cache
 * invalidation path.
 */
export async function rollbackVersion(
  operationId: string,
  fencingToken: number,
  targetVersion?: string,
): Promise<PublicationResult> {
  return rollbackVersionWithDeps(operationId, fencingToken, targetVersion, productionPublicationDeps);
}
