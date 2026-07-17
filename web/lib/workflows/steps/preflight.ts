import { readCanonicalPreflight, type CanonicalPreflightResult } from "@/lib/workflows/canonical-preflight";

/** Parse the deployed canonical metadata before any canonical mutation step. */
export async function preflightCanonical(runId: string): Promise<CanonicalPreflightResult> {
  "use step";
  return readCanonicalPreflight(runId, "workflow");
}
