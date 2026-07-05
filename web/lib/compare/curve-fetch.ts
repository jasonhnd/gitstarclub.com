import { CompareCurve as CompareCurveContract, type CompareCurve } from "@/lib/contracts";

export type RepoCurveFetchErrorReason = "http-error" | "invalid-response" | "request-failed";

export type RepoCurveFetchResult =
  | { ok: true; name: string; key: string; curve: CompareCurve }
  | { ok: false; name: string; key: string; reason: RepoCurveFetchErrorReason; status?: number; error?: unknown };

export type RepoCurveFetch = (input: string, init: RequestInit) => Promise<Response>;

export async function fetchRepoCurve(name: string, id: number, fetchImpl: RepoCurveFetch = fetch): Promise<RepoCurveFetchResult> {
  const key = name.toLowerCase();
  try {
    const res = await fetchImpl(`/repo-curve?id=${id}`, { cache: "force-cache" });
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
    return { ok: false, name, key, reason: "request-failed", error };
  }
}
