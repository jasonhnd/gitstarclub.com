import { CompareCurve as CompareCurveContract, type CompareCurve } from "@/lib/contracts";
import { isAbortError } from "@/lib/client/latest-request";

export type RepoCurveFetchErrorReason = "http-error" | "invalid-response" | "request-failed";

export type RepoCurveFetchResult =
  | { ok: true; name: string; key: string; curve: CompareCurve }
  | { ok: false; name: string; key: string; reason: RepoCurveFetchErrorReason; status?: number; error?: unknown };

export type RepoCurveFetch = (input: string, init: RequestInit) => Promise<Response>;

export type RepoCurveFetchOptions = {
  cache?: "no-cache" | "reload";
  fetchImpl?: RepoCurveFetch;
  signal?: AbortSignal;
};

export async function fetchRepoCurve(
  name: string,
  id: number,
  { cache = "no-cache", fetchImpl = fetch, signal }: RepoCurveFetchOptions = {},
): Promise<RepoCurveFetchResult> {
  const key = name.toLowerCase();
  try {
    const res = await fetchImpl(`/repo-curve?id=${id}`, { cache, signal });
    if (!res.ok) {
      return { ok: false, name, key, reason: "http-error", status: res.status };
    }

    let payload: unknown;
    try {
      payload = await res.json();
    } catch (error) {
      return { ok: false, name, key, reason: "invalid-response", error };
    }

    const parsed = CompareCurveContract.safeParse(payload);
    if (!parsed.success) {
      return { ok: false, name, key, reason: "invalid-response", error: parsed.error };
    }

    return { ok: true, name, key, curve: parsed.data };
  } catch (error) {
    if (signal?.aborted || isAbortError(error)) throw error;
    return { ok: false, name, key, reason: "request-failed", error };
  }
}
