import { describe, expect, test } from "bun:test";
import type { CompareCurve, SearchDoc } from "@/lib/contracts";
import { loadCompareCurve } from "./load";

const doc: SearchDoc = {
  id: 1,
  full_name: "facebook/react",
  owner: "facebook",
  language: "TypeScript",
  current_stars: 250000,
  description: "UI library",
};

const curve: CompareCurve = {
  id: 1,
  full_name: "facebook/react",
  current_stars: 250000,
  crossed_10k: "2014-02-01",
  points: [["2014-02", 10400]],
};

describe("loadCompareCurve", () => {
  test("returns a request-failed error when fetch rejects", async () => {
    const result = await loadCompareCurve("facebook/react", doc, async () => {
      throw new Error("network down");
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe("request-failed");
      expect(result.error.message).toContain("network down");
    }
  });

  test("returns an invalid-response error for malformed curve JSON", async () => {
    const result = await loadCompareCurve(
      "facebook/react",
      doc,
      async () => new Response(JSON.stringify({ ...curve, points: [["2014-02", 10400, 1]] })),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.reason).toBe("invalid-response");
  });

  test("parses a valid repo curve", async () => {
    const result = await loadCompareCurve("facebook/react", doc, async () => new Response(JSON.stringify(curve)));

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.curve.full_name).toBe("facebook/react");
  });
});
