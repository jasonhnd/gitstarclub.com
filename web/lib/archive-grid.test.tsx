import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ArchiveGrid, type ArchiveGridItem } from "@/app/_explore/ArchiveGrid";

const items: ArchiveGridItem[] = [
  {
    label: "2026",
    description: "Year archive",
    href: "/rankings/2026",
    count: "1.2M",
    childrenLinks: [
      { label: "June", href: "/rankings/2026/6", count: 30 },
      { label: "W27", href: "/rankings/2026/W27" },
    ],
  },
  {
    label: "2025",
    href: "/rankings/2025",
  },
];

describe("ArchiveGrid", () => {
  test("renders archive cards with responsive columns and resolved hrefs", () => {
    const html = renderToStaticMarkup(
      createElement(ArchiveGrid, {
        items,
        periodType: "year",
        activePeriod: "/ja/rankings/2026",
        getHref: (href) => `/ja${href}`,
      }),
    );

    expect(html).toContain('data-archive-grid="year"');
    expect(html).toContain("md:grid-cols-2");
    expect(html).toContain("lg:grid-cols-4");
    expect(html).toContain('href="/ja/rankings/2026"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain("Year archive");
    expect(html).toContain("1.2M");
  });

  test("renders child links through the same route helper", () => {
    const html = renderToStaticMarkup(
      createElement(ArchiveGrid, {
        items,
        periodType: "month",
        activePeriod: "/rankings/2026/W27",
        getHref: (href) => href,
      }),
    );

    expect(html).toContain('href="/rankings/2026/6"');
    expect(html).toContain('href="/rankings/2026/W27"');
    expect(html).toContain("June");
    expect(html).toContain("30");
  });

  test("renders nothing for empty archives", () => {
    expect(
      renderToStaticMarkup(
        createElement(ArchiveGrid, {
          items: [],
          periodType: "year",
          activePeriod: "/rankings/2026",
          getHref: (href) => href,
        }),
      ),
    ).toBe("");
  });
});
