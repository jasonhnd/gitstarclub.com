import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CategorySummaryTable, OrganizationRankingTable, RepositoryRankingTable } from "@/app/_explore/SemanticDataTable";

describe("semantic data tables", () => {
  test("renders repository ranking rows as a visible table with canonical links", () => {
    const html = renderToStaticMarkup(
      createElement(RepositoryRankingTable, {
        caption: "Monthly GitHub repositories",
        variant: "gained",
        rows: [{ owner: "octo", name: "kit", lang: "TypeScript", gained: 1200, total: 42000 }],
      }),
    );

    expect(html).toContain("<table");
    expect(html).not.toContain("sr-only");
    expect(html).toContain('data-semantic-table="repository-rankings"');
    expect(html).toContain("<thead>");
    expect(html).toContain("<tbody>");
    expect(html).toContain('scope="col"');
    expect(html).toContain('scope="row"');
    expect(html).toContain("Stars gained");
    expect(html).toContain('href="/octo/kit"');
    expect(html).toContain("octo/kit");
  });

  test("renders repository total variant without a period metric column", () => {
    const html = renderToStaticMarkup(
      createElement(RepositoryRankingTable, {
        caption: "All-time GitHub repositories",
        variant: "total",
        rows: [{ owner: "octo", name: "kit", lang: null, total: 42000 }],
      }),
    );

    expect(html).toContain("Total stars");
    expect(html).toContain('href="/octo/kit"');
    expect(html).not.toContain("Stars gained");
    expect(html).not.toContain("Growth rate percent");
    expect(html).not.toContain("10k crossing day");
  });

  test("renders organization rows with row headers and canonical links", () => {
    const html = renderToStaticMarkup(
      createElement(OrganizationRankingTable, {
        caption: "All-time GitHub organizations",
        rows: [{ rank: 3, login: "vercel", owner_type: "Organization", repo_count: 42, current_stars_sum: 500000 }],
      }),
    );

    expect(html).toContain('data-semantic-table="organization-rankings"');
    expect(html).toContain('href="/o/vercel"');
    expect(html).toContain("vercel");
    expect(html).toContain("Tracked repositories");
    expect(html).toContain("500.0k");
  });

  test("renders category rows with canonical URL links and column", () => {
    const html = renderToStaticMarkup(
      createElement(CategorySummaryTable, {
        caption: "Public categories",
        rows: [{ id: "language/typescript", dimension: "language", slug: "typescript", label: "TypeScript", count: 123, path: "/categories/language/typescript" }],
      }),
    );

    expect(html).toContain('data-semantic-table="repository-categories"');
    expect(html).toContain("GitStarClub URL");
    expect(html).toContain('href="/categories/language/typescript"');
    expect(html).toContain("TypeScript");
    expect(html).toContain("tracked repositories");
    expect(html).toContain("/categories/language/typescript");
  });

  test("renders pending text for zero-count category rows", () => {
    const html = renderToStaticMarkup(
      createElement(CategorySummaryTable, {
        caption: "Public categories",
        rows: [{ id: "domain/ai", dimension: "domain", slug: "ai", label: "AI", count: 0, path: "/categories/domain/ai" }],
      }),
    );

    expect(html).toContain("Pending count");
    expect(html).not.toContain("<td>0</td>");
  });

  test("renders no table when rows are empty", () => {
    expect(renderToStaticMarkup(createElement(RepositoryRankingTable, { rows: [] }))).toBe("");
    expect(renderToStaticMarkup(createElement(OrganizationRankingTable, { rows: [] }))).toBe("");
    expect(renderToStaticMarkup(createElement(CategorySummaryTable, { rows: [] }))).toBe("");
  });
});
