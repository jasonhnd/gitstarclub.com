import { describe, expect, test } from "bun:test";
import type { CompareCurve } from "@/lib/contracts";
import { fetchRepoCurve, type RepoCurveFetch } from "./curve-fetch";

const curve: CompareCurve = {
  id: 1,
  full_name: "facebook/react",
  current_stars: 232000,
  crossed_10k: "2014-02-01",
  points: [["2014-02", 10400]],
};

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), init);
}

describe("fetchRepoCurve", () => {
  test("returns a parsed compare curve on success", async () => {
    const fetchImpl: RepoCurveFetch = async (input, init) => {
      expect(input).toBe("/repo-curve?id=1");
      expect(init.cache).toBe("force-cache");
      return jsonResponse(curve);
    };

    const result = await fetchRepoCurve("facebook/react", 1, fetchImpl);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.curve).toEqual(curve);
  });

  test("returns request-failed when fetch rejects", async () => {
    const fetchImpl: RepoCurveFetch = async () => {
      throw new Error("network down");
    };

    const result = await fetchRepoCurve("facebook/react", 1, fetchImpl);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.reason).toBe("request-failed");
    expect(result.key).toBe("facebook/react");
    expect(result.error).toBeInstanceOf(Error);
  });

  test("returns invalid-response when the payload does not match CompareCurve", async () => {
    const fetchImpl: RepoCurveFetch = async () => jsonResponse({ ...curve, points: [["2014-02", 10400, 1]] });

    const result = await fetchRepoCurve("facebook/react", 1, fetchImpl);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.reason).toBe("invalid-response");
    expect(result.key).toBe("facebook/react");
  });
});
