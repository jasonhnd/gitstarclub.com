import { CanonicalMeta } from "@/lib/contracts";
import { readRequiredView } from "@/lib/data/source";
import { validateCanonicalGeneration } from "@/lib/workflows/canonical-validation";

export interface CanonicalPreflightResult {
  seam_date: string;
  schema_ver: number;
  folded_through: { month: string; week: string };
  generated_at: string | null;
}

/** Read and parse the deployed canonical metadata without mutating Blob state. */
export async function readCanonicalPreflight(
  runId: string,
  phase: "route" | "workflow" = "route",
): Promise<CanonicalPreflightResult> {
  const bust = `${runId}-${phase}-preflight`;
  const meta = await readRequiredView("canonical/v2/meta.json", CanonicalMeta, { bust });
  // Keep the synchronous route gate bounded to the relatively small repos
  // inventory while still rejecting legacy rows that the current model cannot
  // consume. The Workflow step rechecks all 128 shards before any mutation.
  const canonical = await validateCanonicalGeneration(bust, {
    scope: phase === "route" ? "repositories" : "full",
  });
  if (!canonical.manifest.complete) {
    throw new Error(
      `canonical preflight failed (${canonical.failures.length}): ${canonical.failures.slice(0, 5).join("; ")}`,
    );
  }
  return {
    seam_date: meta.seam_date,
    schema_ver: meta.schema_ver,
    folded_through: meta.folded_through,
    generated_at: meta.generated_at ?? null,
  };
}
