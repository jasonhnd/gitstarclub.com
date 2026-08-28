import { describe, expect, test } from "bun:test";
import {
  AS_OF,
  FIRST_MONTH,
  HEADLINES,
  MILESTONES,
  MONTHS,
  NODES,
  flowAt,
  formatDelta,
  formatStars,
  inCategory,
  isClimbing,
  isFaster,
  isTrackedRepo,
  lerpStock,
  monthIndex,
  nearbyOf,
  nodeById,
  sparkValues,
  stockAt,
  windowDelta,
} from "./posed-frames";

describe("posed cockpit frames", () => {
  test("months run from first posed month through as-of", () => {
    expect(MONTHS[0]).toBe(FIRST_MONTH);
    expect(MONTHS.at(-1)).toBe(AS_OF);
    expect(MONTHS.length).toBeGreaterThan(80);
  });

  test("keeps 80 to 400 nodes and the seven labeled anchors", () => {
    expect(NODES.length).toBeGreaterThanOrEqual(80);
    expect(NODES.length).toBeLessThanOrEqual(400);
    const labels = NODES.filter((n) => n.label).map((n) => n.label);
    expect(labels).toEqual(["React", "Vue", "Kubernetes", "Rust", "Ollama", "LangChain", "Transformers"]);
  });

  test("Transformers stock hits the frozen milestone sizes", () => {
    const node = nodeById("huggingface/transformers");
    expect(stockAt(node, monthIndex("2019-07"))).toBe(10_000);
    expect(stockAt(node, monthIndex("2021-06"))).toBe(50_000);
    expect(stockAt(node, monthIndex("2023-04"))).toBe(100_000);
    expect(stockAt(node, monthIndex(AS_OF))).toBe(164_100);
    expect(stockAt(node, monthIndex("2018-01"))).toBe(0);
  });

  test("stock does not drop for Transformers across months", () => {
    const node = nodeById("huggingface/transformers");
    let prev = 0;
    for (let i = 0; i < MONTHS.length; i++) {
      const next = stockAt(node, i);
      expect(next).toBeGreaterThanOrEqual(prev);
      prev = next;
    }
  });

  test("flow is the month-over-month stock difference", () => {
    const node = nodeById("huggingface/transformers");
    const at = monthIndex("2021-06");
    expect(flowAt(node, at)).toBe(stockAt(node, at) - stockAt(node, at - 1));
    expect(flowAt(node, node.born)).toBe(0);
  });

  test("default Moving now is Transformers", () => {
    expect(HEADLINES.movingNow).toBe("huggingface/transformers");
    expect(MILESTONES[HEADLINES.movingNow]?.map((m) => m.period)).toEqual(["2019-07", "2021-06", "2023-04"]);
  });

  test("lerp holds endpoints", () => {
    expect(lerpStock([[0, 10], [10, 20]], 0)).toBe(10);
    expect(lerpStock([[0, 10], [10, 20]], 10)).toBe(20);
    expect(lerpStock([[0, 10], [10, 20]], 5)).toBe(15);
    expect(lerpStock([[2, 10], [10, 20]], 0)).toBe(0);
  });

  test("star formatting uses k without forbidden jargon", () => {
    expect(formatStars(164_100)).toBe("164.1k");
    expect(formatStars(900)).toBe("900");
    expect(formatDelta(9_200)).toBe("+9.2k");
  });

  test("windowDelta uses posed this-month figures only at as-of", () => {
    const node = nodeById("huggingface/transformers");
    const asOf = monthIndex(AS_OF);
    expect(windowDelta(node, asOf, "month")).toBe(9_200);
    expect(windowDelta(node, asOf, "week")).toBe(2_300);
    expect(windowDelta(node, asOf, "year")).toBe(stockAt(node, asOf) - stockAt(node, asOf - 12));
    expect(windowDelta(node, monthIndex("2021-06"), "month")).toBe(flowAt(node, monthIndex("2021-06")));
  });

  test("sparkValues walks the last four monthly stocks", () => {
    const node = nodeById("huggingface/transformers");
    const asOf = monthIndex(AS_OF);
    const values = sparkValues(node, asOf);
    expect(values).toHaveLength(4);
    expect(values.at(-1)).toBe(164_100);
    expect(values[0]).toBe(stockAt(node, asOf - 3));
  });

  test("isClimbing is three consecutive positive months", () => {
    const node = nodeById("huggingface/transformers");
    expect(isClimbing(node, monthIndex(AS_OF))).toBe(true);
    expect(isClimbing(node, node.born)).toBe(false);
  });

  test("nearby peers are labeled posed nodes, not invented names", () => {
    const nearby = nearbyOf("huggingface/transformers");
    expect(nearby).toEqual(["ollama/ollama", "langchain-ai/langchain", "facebook/react"]);
    for (const id of nearby) {
      expect(nodeById(id).label).toBeTruthy();
    }
  });

  test("category caption follows the domain legend", () => {
    expect(inCategory(nodeById("huggingface/transformers"))).toEqual({ label: "In AI / ML", rank: 2, prev: 4 });
    expect(inCategory(nodeById("facebook/react"))).toEqual({ label: "In Web", rank: 1, prev: 1 });
    expect(isTrackedRepo("huggingface/transformers")).toBe(true);
    expect(isTrackedRepo("posed/ai-0")).toBe(false);
    expect(isFaster(nodeById("huggingface/transformers"), monthIndex(AS_OF), "month")).toBe(true);
  });
});
