import { CompareCurve as CompareCurveSchema, type CompareCurve, type SearchDoc } from "@/lib/contracts";

export type CompareCurveLoadReason = "missing-repo" | "http-error" | "invalid-response" | "request-failed";

export interface CompareCurveLoadFailure {
  repo: string;
  reason: CompareCurveLoadReason;
  message: string;
  status?: number;
}

export type CompareCurveLoadResult =
  | { ok: true; repo: string; curve: CompareCurve }
  | { ok: false; repo: string; error: CompareCurveLoadFailure };

type Fetcher = typeof fetch;

function failure(repo: string, reason: CompareCurveLoadReason, message: string, status?: number): CompareCurveLoadResult {
  return { ok: false, repo, error: { repo, reason, message, status } };
}

export async function loadCompareCurve(
  repo: string,
  doc: SearchDoc | undefined,
  fetcher: Fetcher = fetch,
): Promise<CompareCurveLoadResult> {
  if (!doc) return failure(repo, "missing-repo", `${repo} is not in the search index.`);

  try {
    const res = await fetcher(`/repo-curve?id=${doc.id}`, { cache: "force-cache" });
    if (!res.ok) return failure(repo, "http-error", `${repo} curve request failed with HTTP ${res.status}.`, res.status);

    const parsed = CompareCurveSchema.safeParse(await res.json());
    if (!parsed.success) return failure(repo, "invalid-response", `${repo} curve response did not match the expected shape.`);

    return { ok: true, repo, curve: parsed.data };
  } catch (error) {
    const detail = error instanceof Error && error.message ? ` ${error.message}` : "";
    return failure(repo, "request-failed", `${repo} curve request could not complete.${detail}`);
  }
}
