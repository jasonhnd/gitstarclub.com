import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CategorySummaryTable, OrganizationRankingTable, RepositoryRankingTable } from "@/app/_explore/SemanticDataTable";
import en from "@/lib/i18n/dictionaries/en";

const repositoryLabels = {
  caption: en.tables.repositoryRankings,
  rank: en.tables.rank,
  repository: en.tables.repository,
  language: en.tables.language,
  unknown: en.tables.unknown,
  starsGained: en.tables.starsGained,
  growthRatePercent: en.tables.growthRatePercent,
  tenKCrossingDay: en.tables.tenKCrossingDay,
  day: en.tables.day,
  totalStars: en.tables.totalStars,
  rowStarsAdded: en.tables.rowStarsAdded,
};

const organizationLabels = {
  caption: en.tables.organizationRankings,
  rank: en.tables.rank,
  owner: en.tables.owner,
  ownerType: en.tables.ownerType,
  unknown: en.tables.unknown,
  trackedRepositories: en.tables.trackedRepositories,
  totalStars: en.tables.totalStars,
};

const categoryLabels = {
  caption: en.categories.title,
  category: en.categories.eyebrow,
  dimension: en.categories.dimensionEyebrow,
  slug: en.tables.slug,
  trackedRepositories: en.categories.trackedRepositories,
  gitstarclubUrl: en.tables.gitstarclubUrl,
  pendingCount: en.categories.pendingCount,
};

describe("semantic data tables", () => {
  test("renders repository ranking rows as a visible table with canonical links", () => {
    const html = renderToStaticMarkup(
      createElement(RepositoryRankingTable, {
        caption: "Monthly GitHub repositories",
        variant: "gained",
        labels: repositoryLabels,
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
    expect(html).toContain('aria-label="1: 1.2k stars added"');
    expect(html).toContain('href="/octo/kit"');
    expect(html).toContain("octo/kit");
  });

  test("renders repository total variant without a period metric column", () => {
    const html = renderToStaticMarkup(
      createElement(RepositoryRankingTable, {
        caption: "All-time GitHub repositories",
        variant: "total",
        labels: repositoryLabels,
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
        labels: organizationLabels,
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
        labels: categoryLabels,
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
        labels: categoryLabels,
        rows: [{ id: "domain/ai", dimension: "domain", slug: "ai", label: "AI", count: 0, path: "/categories/domain/ai" }],
      }),
    );

    expect(html).toContain("Pending count");
    expect(html).not.toContain("<td>0</td>");
  });

  test("renders no table when rows are empty", () => {
    expect(renderToStaticMarkup(createElement(RepositoryRankingTable, { rows: [], labels: repositoryLabels }))).toBe("");
    expect(renderToStaticMarkup(createElement(OrganizationRankingTable, { rows: [], labels: organizationLabels }))).toBe("");
    expect(renderToStaticMarkup(createElement(CategorySummaryTable, { rows: [], labels: categoryLabels }))).toBe("");
  });
});
