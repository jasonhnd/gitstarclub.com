import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CategorySummaryTable, OrganizationRankingTable, RepositoryRankingTable } from "@/app/_explore/SemanticDataTable";

describe("semantic data tables", () => {
  test("renders repository ranking rows as a hidden table with headers", () => {
    const html = renderToStaticMarkup(
      createElement(RepositoryRankingTable, {
        caption: "Monthly GitHub repositories",
        variant: "gained",
        rows: [{ owner: "octo", name: "kit", lang: "TypeScript", gained: 1200, total: 42000 }],
      }),
    );

    expect(html).toContain("<table");
    expect(html).toContain('class="sr-only"');
    expect(html).toContain("<thead>");
    expect(html).toContain("<tbody>");
    expect(html).toContain('scope="col"');
    expect(html).toContain('scope="row"');
    expect(html).toContain("Stars gained");
    expect(html).toContain("octo/kit");
  });

  test("renders organization rows with row headers", () => {
    const html = renderToStaticMarkup(
      createElement(OrganizationRankingTable, {
        caption: "All-time GitHub organizations",
        rows: [{ rank: 3, login: "vercel", owner_type: "Organization", repo_count: 42, current_stars_sum: 500000 }],
      }),
    );

    expect(html).toContain('data-semantic-table="organization-rankings"');
    expect(html).toContain('<th scope="row">vercel</th>');
    expect(html).toContain("Tracked repositories");
    expect(html).toContain("500000");
  });

  test("renders category rows with extractable paths", () => {
    const html = renderToStaticMarkup(
      createElement(CategorySummaryTable, {
        caption: "Public categories",
        rows: [{ id: "language/typescript", dimension: "language", slug: "typescript", label: "TypeScript", count: 123, path: "/categories/language/typescript" }],
      }),
    );

    expect(html).toContain('data-semantic-table="repository-categories"');
    expect(html).toContain('<th scope="row">TypeScript</th>');
    expect(html).toContain("Tracked repositories");
    expect(html).toContain("/categories/language/typescript");
  });
});
