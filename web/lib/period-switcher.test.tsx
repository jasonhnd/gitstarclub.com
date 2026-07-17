import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PeriodSwitcher, type PeriodSwitcherProps } from "@/app/_explore/PeriodSwitcher";

const links: PeriodSwitcherProps["links"] = {
  "all-time": { href: "/rankings", label: "All-time", value: "All-time" },
  year: { href: "/rankings/2026", label: "Year", value: "2026" },
  month: { href: "/rankings/2026/6", label: "Month", value: "2026-06" },
  week: {
    href: "/rankings/2026/W26",
    label: "Week",
    value: "2026-W26",
    badge: "Latest available: 2026-W26",
  },
};

describe("PeriodSwitcher", () => {
  test("renders an active badge with an opaque semantic foreground token", () => {
    const html = renderToStaticMarkup(createElement(PeriodSwitcher, { links, activePeriod: "week", ariaLabel: "Période de classement" }));

    expect(html).toContain('aria-label="Période de classement"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('class="mt-1 truncate font-mono text-[0.65rem] text-on-primary-container"');
    expect(html).toContain("Latest available: 2026-W26");
    expect(html).not.toContain("opacity-75");
  });
});
