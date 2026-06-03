import { describe, expect, test } from "bun:test";
import type { SearchDoc } from "@/lib/contracts";
import { createIndex, queryIndex } from "./core";

const docs: SearchDoc[] = [
  { id: 1, full_name: "facebook/react", owner: "facebook", language: "JavaScript", current_stars: 230000, description: "A declarative JavaScript library for building user interfaces." },
  { id: 2, full_name: "vuejs/vue", owner: "vuejs", language: "TypeScript", current_stars: 207000, description: "The Progressive JavaScript Framework." },
  { id: 3, full_name: "kubernetes/kubernetes", owner: "kubernetes", language: "Go", current_stars: 109000, description: "Production-Grade Container Scheduling and Management." },
  { id: 4, full_name: "alpha/widget", owner: "alpha", language: "Rust", current_stars: 150000, description: "widget toolkit" },
  { id: 5, full_name: "beta/widget", owner: "beta", language: "C", current_stars: 500, description: "another widget thing" },
  { id: 6, full_name: "nullsoft/empty", owner: "nullsoft", language: null, current_stars: 12000, description: null },
];
const ms = createIndex(docs);

describe("search core", () => {
  test("empty / whitespace query → no hits", () => {
    expect(queryIndex(ms, "")).toEqual([]);
    expect(queryIndex(ms, "   ")).toEqual([]);
  });

  test("exact name match ranks that repo first", () => {
    expect(queryIndex(ms, "react")[0]?.full_name).toBe("facebook/react");
  });

  test("prefix match (incomplete term)", () => {
    expect(queryIndex(ms, "vu").some((h) => h.full_name === "vuejs/vue")).toBe(true);
  });

  test("fuzzy tolerates a one-character typo", () => {
    expect(queryIndex(ms, "kubernets").some((h) => h.full_name === "kubernetes/kubernetes")).toBe(true);
  });

  test("matches on owner", () => {
    expect(queryIndex(ms, "facebook").some((h) => h.full_name === "facebook/react")).toBe(true);
  });

  test("star weight orders the more popular repo first on a tie term", () => {
    const hits = queryIndex(ms, "widget");
    expect(hits[0]?.owner).toBe("alpha"); // 150k stars beats beta's 500
  });

  test("respects the result limit", () => {
    expect(queryIndex(ms, "widget", 1).length).toBe(1);
  });

  test("null language/description docs index without throwing and round-trip as null", () => {
    const hit = queryIndex(ms, "empty").find((h) => h.full_name === "nullsoft/empty");
    expect(hit).toBeDefined();
    expect(hit?.language).toBeNull();
    expect(hit?.description).toBeNull();
  });
});
