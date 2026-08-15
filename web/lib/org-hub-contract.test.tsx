import { beforeAll, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import type { CategoryAssignments, CategoryRegistry, Meta, OrgEntity, ReposLookup } from "@/lib/contracts";

mock.module("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  permanentRedirect: (location: string) => {
    throw new Error(`NEXT_REDIRECT:${location}`);
  },
  usePathname: () => "/o/org",
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

const ORG_LOGIN = "org";
const LEAD_ID = 1;
const SECOND_ID = 2;

mock.module("@/lib/data", () => ({
  DAILY_BASE_VIEW_TTL_MS: 86_400_000,
  getCategoryAssignments: async () => assignments,
  getCategoryRegistry: async () => registry,
  getMeta: async () => meta,
  getOrgEntityDaily: async (login: string) => (login === ORG_LOGIN ? org : null),
  getReposLookupDaily: async () => lookup,
}));

const { OrgPageView } = await import("@/app/_localized/org");

const org: OrgEntity = {
  login: ORG_LOGIN,
  owner_type: "Organization",
  current_stars_sum: 30_000,
  repo_count: 2,
  members: [LEAD_ID, SECOND_ID],
  curve: {
    monthly: [
      ["2024-01", 1_000, 20_000],
      ["2026-06", 400, 30_000],
    ],
    recent_daily: [["2026-06-04", 12]],
  },
  rank_history: { month: [["2026-06", 3]] },
};

const lookup: ReposLookup = {
  [String(LEAD_ID)]: {
    owner: ORG_LOGIN,
    name: "lead",
    full_name: "org/lead",
    owner_type: "Organization",
    language: "TypeScript",
    current_stars: 20_000,
  },
  [String(SECOND_ID)]: {
    owner: ORG_LOGIN,
    name: "second",
    full_name: "org/second",
    owner_type: "Organization",
    language: "TypeScript",
    current_stars: 10_000,
  },
};

const registry: CategoryRegistry = {
  rules_version: "org-hub",
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
  rules_version: "org-hub",
  generated_at: "2026-06-04T12:00:00.000Z",
  repositories: {
    [String(LEAD_ID)]: {
      language: ["language/typescript"],
      language_family: [],
      domain: [],
      project_type: [],
      ecosystem: [],
      owner_kind: ["owner_kind/organization"],
      maturity: [],
    },
    [String(SECOND_ID)]: {
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
  html = await renderPage(await OrgPageView({ locale: "en", login: ORG_LOGIN }));
});

describe("org hub contract on the rendered page", () => {
  test("OrgPageView builds the hub from the shared helper", () => {
    const source = readFileSync(join(import.meta.dir, "../app/_localized/org.tsx"), "utf8");
    expect(source).toContain("buildOrgHub(");
    expect(source).toContain("hub.compare");
    expect(source).toContain("hub.categories");
  });

  test("rendered HTML links members, a public category, and compare", () => {
    const hrefs = anchors(html);
    expect(hrefs).toContain("/org/lead");
    expect(hrefs).toContain("/org/second");
    expect(hrefs).toContain("/categories/language/typescript");
    expect(hrefs).toContain("/compare?repos=org%2Flead%2Corg%2Fsecond");
    expect(hrefs).toContain("/rankings/2026/6");
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
