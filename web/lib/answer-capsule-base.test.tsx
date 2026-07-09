import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AnswerCapsuleBase } from "@/app/_explore/AnswerCapsuleBase";

describe("answer capsule base", () => {
  test("renders a standalone answer with dated source metadata and supporting facts", () => {
    const html = renderToStaticMarkup(
      createElement(AnswerCapsuleBase, {
        summary: "React leads the tracked weekly movers.",
        dataAsOf: "July 6, 2026",
        source: "GitStarClub weekly rankings",
        href: "/rankings/2026/W27",
        supportingFacts: ["+1.2k stars this week", "Computed from prebuilt ranking JSON"],
      }),
    );

    expect(html).toContain('data-answer-capsule=""');
    expect(html).toContain('data-testid="answer-capsule"');
    expect(html).toContain('data-testid="answer-capsule-data-as-of"');
    expect(html).toContain('data-testid="answer-capsule-source"');
    expect(html).toContain("React leads the tracked weekly movers.");
    expect(html).toContain("Data as of");
    expect(html).toContain("July 6, 2026");
    expect(html).toContain("Source");
    expect(html).toContain('href="/rankings/2026/W27"');
    expect(html).toContain("GitStarClub weekly rankings");
    expect(html).toContain("Supporting facts");
    expect(html).toContain("+1.2k stars this week");
  });

  test("renders explicit missing metadata states instead of hiding blank source or date values", () => {
    const html = renderToStaticMarkup(
      createElement(AnswerCapsuleBase, {
        summary: "The answer still renders.",
        dataAsOf: " ",
        source: "",
      }),
    );

    expect(html).toContain("The answer still renders.");
    expect(html).toContain("Missing date and source");
    expect(html).toContain("Missing data-as-of date");
    expect(html).toContain("Missing source");
  });
});
