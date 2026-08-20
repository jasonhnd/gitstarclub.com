import { describe, expect, mock, test } from "bun:test";
import type { ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import type { CategoryAssignments, CategoryRegistry, Meta, RepoEntity, ReposLookup } from "@/lib/contracts";
import { getDictionary } from "@/lib/i18n";

mock.module("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  permanentRedirect: (location: string) => {
    throw new Error(`NEXT_REDIRECT:${location}`);
  },
  usePathname: () => "/solo/current",
  useRouter: () => ({
    back: () => undefined,
    forward: () => undefined,
    prefetch: () => undefined,
    push: () => undefined,
    refresh: () => undefined,
    replace: () => undefined,
  }),
  useSearchParams: () => new URLSearchParams(),
}));

let lookup: ReposLookup = {};

mock.module("@/lib/data", () => ({
  DAILY_BASE_VIEW_TTL_MS: 86_400_000,
  getAliasMapDaily: async () => ({}),
  getCategoryAssignments: async () => assignments,
  getCategoryRegistry: async () => registry,
  getMeta: async () => meta,
  getRepoPageEntityDaily: async (id: number) => (id === 1 ? entity : null),
  getRepoIdByFullNameDaily: async () => new Map([["solo/current", 1]]),
  getReposLookupDaily: async () => lookup,
}));

const { RepoPageView } = await import("@/app/_localized/repo");

const entity: RepoEntity = {
  id: 1,
  full_name: "solo/current",
  owner: "solo",
  owner_type: "User",
  name: "current",
  description: "A solo TypeScript repository.",
  language: "TypeScript",
  languages: [{ name: "TypeScript", size: 1000, color: "#3178c6" }],
  topics: [],
  homepage_url: null,
  license: null,
  latest_release: null,
  created_at: "2018-01-01",
  current_stars: 12_000,
  is_archived: false,
  milestones: { crossed_10k: "2020-03-01", crossed_50k: null, crossed_100k: null },
  curve: { monthly: [["2020-03", 2_000, 10_500], ["2026-06", 400, 12_000]], recent_daily: [["2026-06-04", 12]] },
  monthly_table: [{ month: "2026-06", adds: 400, rank: 7 }],
  rank_history: { month: [["2026-06", 7]] },
  inflections: [],
};

const registry: CategoryRegistry = {
  rules_version: "related-empty",
  generated_at: "2026-06-04T12:00:00.000Z",
  dimensions: [
    {
      id: "language",
      label: "Language",
      categories: [
        {
          id: "language/typescript",
          dimension: "language",
          slug: "typescript",
          label: "TypeScript",
          count: 1,
          public: true,
          sitemap: true,
          minimum_repo_count: 1,
        },
      ],
    },
  ],
};

const assignments: CategoryAssignments = {
  rules_version: "related-empty",
  generated_at: "2026-06-04T12:00:00.000Z",
  repositories: {
    "1": {
      language: ["language/typescript"],
      language_family: [],
      domain: [],
      project_type: [],
      ecosystem: [],
      owner_kind: ["owner_kind/user"],
      maturity: [],
    },
  },
};

const meta: Meta = {
  seam_date: "2026-06-01",
  schema_ver: 1,
  generated_at: "2026-06-04T12:00:00.000Z",
  folded_through: { month: "2026-06", week: "2026-W23" },
};

describe("related-repo empty and language-fallback copy", () => {
  test("empty state uses locale-complete dashed-box copy", async () => {
    lookup = {
      "1": { owner: "solo", name: "current", full_name: "solo/current", owner_type: "User", language: "TypeScript", current_stars: 12_000 },
    };
    const html = await renderPage(await RepoPageView({ locale: "en", owner: "solo", name: "current" }));
    const en = await getDictionary("en");
    expect(html).toContain(en.repo.relatedEmpty);
    expect(html).toContain("border-dashed");
    expect(html).not.toContain("/other/top-ts");
  });

  test("language fallback copy appears when the owner has no other active repos", async () => {
    lookup = {
      "1": { owner: "solo", name: "current", full_name: "solo/current", owner_type: "User", language: "TypeScript", current_stars: 12_000 },
      "2": { owner: "other", name: "top-ts", full_name: "other/top-ts", owner_type: "Organization", language: "TypeScript", current_stars: 20_000 },
    };
    const html = await renderPage(await RepoPageView({ locale: "en", owner: "solo", name: "current" }));
    const en = await getDictionary("en");
    expect(html).toContain(en.repo.relatedByLanguage.replace("{language}", "TypeScript"));
    expect(html).toContain("/other/top-ts");
  });
});

async function renderPage(element: ReactElement): Promise<string> {
  const stream = await renderToReadableStream(element);
  await stream.allReady;
  return new Response(stream).text();
}
