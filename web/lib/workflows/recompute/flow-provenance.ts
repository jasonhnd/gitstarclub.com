import { AGGREGATE_HISTORY_PROVENANCE, type StarHistoryProvenance } from "@/lib/contracts/star-history";

/** `none` means stock was carried without a flow observation in this period. */
export type FlowSource = "none" | "existing" | "aggregate" | "mixed";

export function mergeFlowSources(left: FlowSource, right: FlowSource): FlowSource {
  if (left === "none") return right;
  if (right === "none" || left === right) return left;
  return "mixed";
}

/** Only imported repo observations have the unknown-stock sentinel. */
export function repoFlowSource(stock: number): FlowSource {
  return stock < 0 ? "aggregate" : "existing";
}

export function flowProvenance(rows: ReadonlyArray<{ flowSource?: FlowSource }>): {
  provenance?: StarHistoryProvenance;
  provenance_scope?: "mixed";
} {
  const source = rows.reduce<FlowSource>((acc, row) => mergeFlowSources(acc, row.flowSource ?? "existing"), "none");
  if (source === "aggregate") return { provenance: AGGREGATE_HISTORY_PROVENANCE };
  if (source === "mixed") return { provenance: AGGREGATE_HISTORY_PROVENANCE, provenance_scope: "mixed" };
  return {};
}
