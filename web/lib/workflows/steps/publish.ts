import {
  publishVersionWithDeps,
  type PublicationResult,
} from "@/lib/workflows/publication-core";
import { productionPublicationDeps } from "@/lib/workflows/publication-deps";

// Publish step: persist the original rollback target before the atomic pointer
// switch, then make every recovery artifact replay-safe. Only a confirmed 404
// from readView is interpreted as first publication; transport/schema errors
// propagate and cannot erase rollback metadata.
export async function publishVersion(
  runId: string,
  fencingToken: number,
): Promise<PublicationResult> {
  "use step";

  return publishVersionWithDeps(runId, fencingToken, productionPublicationDeps);
}
