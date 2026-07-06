import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RelatedPages } from "@/app/_explore/RelatedPages";

describe("RelatedPages", () => {
  test("renders every related page as a descriptive real link", () => {
    const html = renderToStaticMarkup(
      createElement(RelatedPages, {
        title: "Related pages",
        description: "Continue exploring tracked GitHub activity.",
        items: [
          { href: "/rankings", label: "All-time GitHub repository rankings" },
          { href: "/categories/language/typescript", label: "TypeScript repository category" },
        ],
      }),
    );

    expect(html).toContain("<section");
    expect(html).toContain("Related pages");
    expect(html).toContain("Continue exploring tracked GitHub activity.");
    expect(html).toContain('href="/rankings"');
    expect(html).toContain("All-time GitHub repository rankings");
    expect(html).toContain('href="/categories/language/typescript"');
    expect(html).toContain("TypeScript repository category");
    expect(html).not.toContain('href="#"');
  });

  test("does not render an orphan related-pages section without items", () => {
    const html = renderToStaticMarkup(
      createElement(RelatedPages, {
        title: "Related pages",
        description: "Continue exploring tracked GitHub activity.",
        items: [],
      }),
    );

    expect(html).toBe("");
  });
});
