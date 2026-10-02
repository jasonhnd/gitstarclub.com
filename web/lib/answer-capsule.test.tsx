import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AnswerCapsule } from "@/app/_explore/AnswerCapsule";
import { ANSWER_CAPSULE_SOURCE } from "@/lib/geo-capsules";

describe("live answer capsule", () => {
  test("renders the visible answer with dated source metadata", () => {
    const html = renderToStaticMarkup(
      createElement(AnswerCapsule, {
        className: "mt-4",
        capsule: {
          text: "React leads the tracked weekly movers.",
          asOf: "July 6, 2026",
          source: ANSWER_CAPSULE_SOURCE,
        },
        labels: {
          ariaLabel: "Answer capsule",
          eyebrow: "Answer",
          dataAsOf: "Data as of",
          source: "Source",
        },
      }),
    );

    expect(html).toContain('data-testid="answer-capsule"');
    expect(html).toContain('aria-label="Answer capsule"');
    expect(html).toContain('data-testid="answer-capsule-data-as-of"');
    expect(html).toContain('data-testid="answer-capsule-source"');
    expect(html).toContain("Answer");
    expect(html).toContain("React leads the tracked weekly movers.");
    expect(html).toContain("Data as of");
    expect(html).toContain("July 6, 2026");
    expect(html).toContain("Source");
    expect(html).toContain(ANSWER_CAPSULE_SOURCE);
    expect(html).toContain("mt-4");
    expect(html).not.toContain("href=");
    expect(html).not.toContain("Supporting facts");
    expect(html).not.toContain("Missing date and source");
  });
});
