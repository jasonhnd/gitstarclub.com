import { CanonicalMeta } from "@/lib/contracts";
import { readView } from "@/lib/data/source";

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
  const meta = await readView("canonical/v2/meta.json", CanonicalMeta, { bust: `${runId}-${phase}-preflight` });
  if (!meta) throw new Error("canonical/v2/meta.json missing");
  return {
    seam_date: meta.seam_date,
    schema_ver: meta.schema_ver,
    folded_through: meta.folded_through,
    generated_at: meta.generated_at ?? null,
  };
}
