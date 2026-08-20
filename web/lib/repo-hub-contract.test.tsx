import { beforeAll, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import type { CategoryAssignments, CategoryRegistry, Meta, RepoEntity, ReposLookup } from "@/lib/contracts";
import { REPO_HUB_LINK_TYPES, type RepoHubLinkType } from "@/lib/repo-page";

mock.module("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  permanentRedirect: (location: string) => {
    throw new Error(`NEXT_REDIRECT:${location}`);
  },
  usePathname: () => "/org/current",
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

const REPO_ID = 42;
const SIBLING_ID = 43;
const REPO_OWNER = "org";
const REPO_NAME = "current";
const REPO_FULL_NAME = "org/current";
const RELATED_FULL_NAME = "org/sibling";

mock.module("@/lib/data", () => ({
  DAILY_BASE_VIEW_TTL_MS: 86_400_000,
  getAliasMapDaily: async () => ({}),
  getCategoryAssignments: async () => assignments,
  getCategoryRegistry: async () => registry,
  getMeta: async () => meta,
  getRepoPageEntityDaily: async (id: number) => (id === REPO_ID ? entity : null),
  getRepoIdByFullNameDaily: async () => new Map([[REPO_FULL_NAME.toLowerCase(), REPO_ID]]),
  getReposLookupDaily: async () => lookup,
}));

const { RepoPageView } = await import("@/app/_localized/repo");

const entity: RepoEntity = {
  id: REPO_ID,
  full_name: REPO_FULL_NAME,
  owner: REPO_OWNER,
  owner_type: "Organization",
  name: REPO_NAME,
  description: "Tracked TypeScript repository used as the hub-contract fixture.",
  language: "TypeScript",
  languages: [{ name: "TypeScript", size: 1000, color: "#3178c6" }],
  topics: ["cli"],
  homepage_url: null,
  license: "MIT",
  latest_release: null,
  created_at: "2018-01-01",
  current_stars: 12_000,
  is_archived: false,
  milestones: { crossed_10k: "2020-03-01", crossed_50k: null, crossed_100k: null },
  curve: {
    monthly: [
      ["2020-03", 2_000, 10_500],
      ["2026-06", 400, 12_000],
    ],
    recent_daily: [["2026-06-04", 12]],
  },
  monthly_table: [{ month: "2026-06", adds: 400, rank: 7 }],
  rank_history: { month: [["2026-06", 7]] },
  inflections: [],
};

const lookup: ReposLookup = {
  [String(REPO_ID)]: {
    owner: REPO_OWNER,
    name: REPO_NAME,
    full_name: REPO_FULL_NAME,
    owner_type: "Organization",
    language: "TypeScript",
    current_stars: 12_000,
  },
  [String(SIBLING_ID)]: {
    owner: REPO_OWNER,
    name: "sibling",
    full_name: RELATED_FULL_NAME,
    owner_type: "Organization",
    language: "Go",
    current_stars: 11_000,
  },
};

const registry: CategoryRegistry = {
  rules_version: "hub-contract",
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
          count: 2,
          public: true,
          sitemap: true,
          minimum_repo_count: 1,
        },
      ],
    },
  ],
};

const assignments: CategoryAssignments = {
  rules_version: "hub-contract",
  generated_at: "2026-06-04T12:00:00.000Z",
  repositories: {
    [String(REPO_ID)]: {
      language: ["language/typescript"],
      language_family: [],
      domain: [],
      project_type: [],
      ecosystem: [],
      owner_kind: ["owner_kind/organization"],
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

let html = "";

beforeAll(async () => {
  html = await renderPage(await RepoPageView({ locale: "en", owner: REPO_OWNER, name: REPO_NAME }));
});

describe("repo hub contract on the rendered page", () => {
  test("RepoPageView still builds the hub from the shared contract helper", () => {
    const source = readFileSync(join(import.meta.dir, "../app/_localized/repo.tsx"), "utf8");
    expect(source).toContain("buildRepoHub(");
    expect(source).toContain("hub.compare.href");
    expect(source).toContain("hub.owner.href");
    expect(source).toContain("hub.categories");
    expect(source).toContain("hub.related");
    expect(source).toContain("hub.rankingAppearances");
  });

  test("rendered HTML keeps every #356 hub link type as a real anchor", () => {
    const hrefs = anchors(html);
    const present = presentHubTypes(hrefs);
    expect(present.sort()).toEqual([...REPO_HUB_LINK_TYPES].sort());
    expect(hrefs).toContain(`/o/${REPO_OWNER}`);
    expect(hrefs).toContain("/categories/language/typescript");
    expect(hrefs).toContain(`/compare?repos=${encodeURIComponent(REPO_FULL_NAME)}`);
    expect(hrefs).toContain("/rankings/2026/6");
    expect(hrefs).toContain(`/${RELATED_FULL_NAME}`);
    expect(hrefs.some((href) => /^\/rankings\/\d{4}\/\d+$/.test(href))).toBe(true);
  });
});

async function renderPage(element: ReactElement): Promise<string> {
  const stream = await renderToReadableStream(element);
  await stream.allReady;
  return new Response(stream).text();
}

function anchors(markup: string): string[] {
  return [...markup.matchAll(/<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>/gi)].map((match) => match[1]);
}

function presentHubTypes(hrefs: string[]): RepoHubLinkType[] {
  const types: RepoHubLinkType[] = [];
  if (hrefs.includes(`/o/${REPO_OWNER}`)) types.push("owner");
  if (hrefs.some((href) => href.startsWith("/categories/"))) types.push("publicCategory");
  if (hrefs.some((href) => href.startsWith("/compare?repos="))) types.push("compare");
  if (hrefs.some((href) => /^\/rankings\/\d{4}\/\d+$/.test(href))) types.push("historicalRankingPeriod");
  if (hrefs.includes(`/${RELATED_FULL_NAME}`)) types.push("related");
  return types;
}
