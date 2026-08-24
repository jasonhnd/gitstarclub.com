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
  lerpStock,
  monthIndex,
  nodeById,
  stockAt,
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
});
