import type { SearchDoc } from "@/lib/contracts";
import type { SearchHit } from "@/lib/search/core";

export type SearchLoadState = "idle" | "loading" | "ready" | "error";
export type SearchWorkerErrorReason = "init-failed" | "query-failed" | "not-ready";

export type SearchWorkerInMessage =
  | { type: "init"; repos: SearchDoc[] }
  | { type: "query"; id: number; q: string; limit: number };

export type SearchWorkerOutMessage =
  | { type: "ready" }
  | { type: "results"; id: number; hits: SearchHit[] }
  | { type: "error"; id?: number; reason: SearchWorkerErrorReason; message: string };

export type SearchIndexPayloadResult = { ok: true; repos: SearchDoc[] } | { ok: false; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSearchDoc(value: unknown): value is SearchDoc {
  if (!isRecord(value)) return false;
  return (
    Number.isSafeInteger(value.id) &&
    typeof value.full_name === "string" &&
    typeof value.owner === "string" &&
    Number.isSafeInteger(value.current_stars) &&
    (value.language == null || typeof value.language === "string") &&
    (value.description == null || typeof value.description === "string")
  );
}

export function parseSearchIndexPayload(payload: unknown): SearchIndexPayloadResult {
  if (!isRecord(payload)) return { ok: false, message: "Search index payload is not an object." };
  if (!Array.isArray(payload.repos)) return { ok: false, message: "Search index payload is missing repos[]." };
  if (typeof payload.count === "number" && payload.count !== payload.repos.length) {
    return { ok: false, message: "Search index count does not match repos[]." };
  }

  const invalidIndex = payload.repos.findIndex((doc) => !isSearchDoc(doc));
  if (invalidIndex >= 0) return { ok: false, message: `Search index repo at ${invalidIndex} is invalid.` };

  return { ok: true, repos: payload.repos };
}

export function searchWorkerError(
  reason: SearchWorkerErrorReason,
  error: unknown,
  id?: number,
): Extract<SearchWorkerOutMessage, { type: "error" }> {
  const detail = error instanceof Error && error.message ? error.message : String(error || reason);
  return { type: "error", id, reason, message: detail };
}
