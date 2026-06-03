import { describe, expect, test } from "bun:test";
import { narrativePrompt } from "./narrative-context";

describe("narrativePrompt", () => {
  test("includes label, thousands-formatted gainers, fastest, newcomers, and both languages", () => {
    const p = narrativePrompt({
      label: "May 2026",
      topGainers: [
        { full_name: "a/b", gained: 12345 },
        { full_name: "c/d", gained: 9000 },
      ],
      fastest: [{ full_name: "e/f", rate: 120 }],
      newcomers: ["g/h"],
    });
    expect(p).toContain("May 2026");
    expect(p).toContain("a/b (+12,345)");
    expect(p).toContain("e/f (+120%)");
    expect(p).toContain("g/h");
    expect(p).toContain('"en"');
    expect(p).toContain('"zh"');
  });

  test("omits the fastest / newcomer lines when those lists are empty", () => {
    const p = narrativePrompt({ label: "Jan 2020", topGainers: [{ full_name: "x/y", gained: 5 }], fastest: [], newcomers: [] });
    expect(p).toContain("Jan 2020");
    expect(p).not.toContain("Fastest-growing");
    expect(p).not.toContain("first crossed");
  });

  test("caps gainers at 5", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ full_name: `r/${i}`, gained: 100 - i }));
    const p = narrativePrompt({ label: "X", topGainers: many, fastest: [], newcomers: [] });
    expect(p).toContain("r/0");
    expect(p).toContain("r/4");
    expect(p).not.toContain("r/5");
  });
});
