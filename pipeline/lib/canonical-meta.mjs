/**
 * Build the canonical/v2 metadata object emitted by the one-time bootstrap.
 * CanonicalMeta in web/lib/contracts/canonical.ts is the authoritative reader;
 * its contract test imports this producer to prevent the two shapes drifting.
 */
export function buildCanonicalMeta({ seamDate, schemaVer, foldedThroughMonth, foldedThroughWeek, generatedAt }) {
  return {
    seam_date: seamDate,
    schema_ver: schemaVer,
    folded_through: { month: foldedThroughMonth, week: foldedThroughWeek },
    generated_at: generatedAt,
  };
}
