import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import { createHash } from "node:crypto";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CompareCurve, type Meta, type OrgsLookup } from "@/lib/contracts";
import { getDictionary, LOCALES, type Locale } from "@/lib/i18n";
import { COMMON_COMPARE_PAIRS } from "@/lib/compare/conclusions";

const names = COMMON_COMPARE_PAIRS.flatMap((pair) => [pair.a, pair.b]);
const repoIds = new Map(names.map((name, index) => [name.toLowerCase(), index + 1]));
const curves = new Map<number, CompareCurve>(names.map((name, index) => [index + 1, {
  id: index + 1, full_name: name, current_stars: 20_000 + index * 1_000,
  crossed_10k: "2024-01-01", points: [["2024-01", 10_000], ["2024-02", 12_000 + index * 1_000], ["2024-03", 20_000 + index * 1_000]],
}]));
const meta: Meta = { seam_date: "2024-01-01", schema_ver: 1, generated_at: "2024-03-01T12:00:00.000Z", folded_through: { month: "2024-03", week: "2024-W09" } };
const orgs: OrgsLookup = { example: { login: "example", owner_type: "Organization", repo_count: 2, current_stars_sum: 40_000 } };
let orgLookup: OrgsLookup | null = orgs;
let failedIds = new Set<number>();
let absentIds = new Set<number>();
let schemaFailure = false;
let metaFailure = false;
let lookupFailure = false;
const failure = new Error("optional curve transport failed");
const originalWarn = console.warn;
let diagnostics: unknown[][] = [];
console.warn = (...args: unknown[]) => { diagnostics.push(args); };

mock.module("next/navigation", () => ({
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
  usePathname: () => "/compare",
  useRouter: () => ({ replace: () => undefined, push: () => undefined, prefetch: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
}));
mock.module("@/lib/data", () => ({
  getMeta: async () => { if (metaFailure) throw new Error("metadata failed"); return meta; },
  getOrgsLookup: async () => orgLookup,
  getRepoIdByFullName: async () => { if (lookupFailure) throw new Error("lookup failed"); return repoIds; },
  getRepoCurve: async (id: number) => { if (failedIds.has(id)) { if (schemaFailure) CompareCurve.parse({}); throw failure; } return absentIds.has(id) ? null : curves.get(id) ?? null; },
  getCategoryRegistry: async () => null,
  getCategoryAllTimePage: async () => null,
  getReposLookupDaily: async () => ({}),
  joinRepoRank: () => [],
}));
const { OrgIndexPageView } = await import("@/app/_localized/org-index");
const { ComparePageView } = await import("@/app/_localized/compare");
const { CategoriesPageView } = await import("@/app/_localized/categories");

function render(element: ReactElement) { return renderToStaticMarkup(element); }
function hash(html: string) { return createHash("sha256").update(html).digest("hex"); }

afterEach(() => {
  schemaFailure = false; orgLookup = orgs; failedIds = new Set(); absentIds = new Set(); metaFailure = false; lookupFailure = false; diagnostics = [];
});
afterAll(() => {
  console.warn = originalWarn;
  mock.restore();
});

// SHA-256 of the shared chrome HTML. Refreshed when the header search classes change (#819).
const baseline: Record<string, Record<string, string>> = {
  "en": {
    "org": "5fb6afc8ac6d379d84981cdf8e6bd96f015d0b8b472bfd3e38e7f60990d3df29",
    "compare": "148ec3ca31fd74a629a4123dfd8fc6387a50fa81ae07501f027d0004c1fea8a6",
    "categories": "bfc406e0e94f3f121618f94cc3f4ea20845665817002971fa5d5775e3ad043cb"
  },
  "ja": {
    "org": "7e338cace646b2b86af49df9a09d0fa9fc16a6201fbd62b8fbdc0334896c4a1e",
    "compare": "6082e415bf6e503167151108977d36b3227a9e8cb7b600980e2de8aae2fa432a",
    "categories": "e9d37216a338ee7d2c3c9e3ab9a807431b451122aa5fa38ab517b8e2ecd1b67f"
  },
  "zh": {
    "org": "0133bfc9b5e46250a408676db637a60834dbeb73d5171067dfc98590314be70e",
    "compare": "9d26e9091b398a7e1b60892018166f521064c1a3495ddca6e5f748bb46519833",
    "categories": "f64bd734a0062af0a434db9c86f046e81c9767bef6ecc0696b5a9b54171784f5"
  },
  "zh-TW": {
    "org": "79f7e153f662554ce141fde69a4b755d984558e1efe29c7609ce6834a4c48cec",
    "compare": "6190d3d1c9e901693d43201238f214baa0e4bd6df83e07420d15c85fa39dd7d9",
    "categories": "97b1d82aa3260d126f8e62e57e8abb6d799fcbe4507bcaa62a3a25fbf1da67a8"
  },
  "ko": {
    "org": "24f88f6f0aa8fa10693406c35e2efce7a20824c2dca99c114fbe659c67931866",
    "compare": "34afdc1207a1a021a447a80c2064e816de9ac4de5d9b6ac3f5dd7382ad5fcf89",
    "categories": "f26775de90f26f13f908c7a7d2dcc5e6ed64e65042b46f6ed687ab0fcabbec1d"
  },
  "es": {
    "org": "0eda3511e673dda07e0b38445fc5c6c3288e92d5c9113f5dd8b8c3ac7a1ec1ff",
    "compare": "0236740a0636c6ddfca4bf149eeb6c6142733f0f441369e96c4a2c55eafb2527",
    "categories": "02da624fa4d3669a0f280c0c30c978eb96794fc00e15c4bf45abccc1b6c1a9fb"
  },
  "fr": {
    "org": "9828349551eb706ceb749ece65fc770443b52335bb278e01a1cf87d5a7dae9ea",
    "compare": "982c58011f5591391b318a1c9e7616e3b997a24b5726fe1ac0fb4396aa840bd8",
    "categories": "c46b4d379cd9925a79b0d74192a35b02ecea991aea0bf3a1a22eef5f4ed7c516"
  }
};

describe("successful page HTML stays stable", () => {
  test.each([...LOCALES])("%s matches its documented HTML baseline", async (locale) => {
    const html = {
      org: render(await OrgIndexPageView({ locale, page: 1 })),
      compare: render(await ComparePageView({ locale })),
      categories: render(await CategoriesPageView({ locale })),
    };
    expect(Object.fromEntries(Object.entries(html).map(([page, value]) => [page, hash(value)]))).toEqual(baseline[locale]);
  });
});

describe("organization index pending state", () => {
  for (const lookup of [null, {}] as const) {
    test.each([...LOCALES])(`%s explains ${lookup === null ? "missing" : "empty"} lookup`, async (locale) => {
      orgLookup = lookup;
      const t = await getDictionary(locale);
      const html = render(await OrgIndexPageView({ locale, page: 1 }));
      expect(html).toContain(render(<p>{t.categories.rankingPending}</p>).slice(3, -4));
      expect(html).toContain(t.org.indexTitle);
      expect(html).not.toContain("<table");
      expect(html).not.toContain('aria-label="' + t.org.indexPagination + '"');
      expect(html).toContain('"@type":"CollectionPage"');
    });
  }
});

describe("optional comparison example failures", () => {
  test.each([1, 2, 3, 4, 5, 6])("rejected curve %i skips only its pair", async (id) => {
    failedIds.add(id);
    const html = render(await ComparePageView({ locale: "en" }));
    const t = await getDictionary("en");
    expect(html).toContain('id="compare-workbench"');
    expect(html).toContain('id="server-compare-title"');
    const failedPair = COMMON_COMPARE_PAIRS[Math.floor((id - 1) / 2)];
    expect(html).not.toContain(`href="/${failedPair.a}"`);
    for (const pair of COMMON_COMPARE_PAIRS.filter((pair) => pair !== failedPair)) expect(html).toContain(`href="/${pair.a}"`);
    expect(html).toContain(t.compare.loadError.replace("{repo}", `${failedPair.a} ${t.common.versus} ${failedPair.b}`));
    expect(html).not.toContain(failure.message);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0][1]).toEqual({ pair: failedPair.label, error: failure });
  });
  test.each([...LOCALES])("%s keeps the workbench when all examples fail", async (locale: Locale) => {
    failedIds = new Set(repoIds.values());
    const html = render(await ComparePageView({ locale }));
    const t = await getDictionary(locale);
    expect(html).toContain('id="compare-workbench"');
    expect(html).not.toContain('id="server-compare-title"');
    expect(html).toContain(render(<p>{t.compare.empty}</p>).slice(3, -4));
    expect(diagnostics).toHaveLength(3);
  });
  test("missing curves quietly omit only their pair", async () => {
    absentIds.add(1);
    const html = render(await ComparePageView({ locale: "en" }));
    expect(html).toContain('id="compare-workbench"');
    expect(html).toContain('href="/vercel/next.js"');
    expect(html).not.toContain('href="/react/react"');
    expect(diagnostics).toEqual([]);
  });
  test("schema rejection is isolated and diagnosed", async () => {
    schemaFailure = true;
    failedIds.add(1);
    const html = render(await ComparePageView({ locale: "en" }));
    expect(html).toContain('id="compare-workbench"');
    expect(html).toContain('href="/vercel/next.js"');
    expect(diagnostics).toHaveLength(1);
    expect((diagnostics[0][1] as { error: Error }).error.name).toBe("ZodError");
  });
  test("missing IDs omit examples without reads or warnings", async () => {
    const { loadPairConclusions } = await import("@/app/_localized/comparison-page-data");
    const t = await getDictionary("en");
    expect(await loadPairConclusions(new Map(), "en", t.compare)).toEqual({ conclusions: [], unavailablePairs: [] });
    expect(diagnostics).toEqual([]);
  });
  test("metadata failures propagate", async () => {
    metaFailure = true;
    await expect(ComparePageView({ locale: "en" })).rejects.toThrow("metadata failed");
    expect(diagnostics).toEqual([]);
  });
  test("required lookup failures propagate", async () => {
    lookupFailure = true;
    await expect(ComparePageView({ locale: "en" })).rejects.toThrow("lookup failed");
    expect(diagnostics).toEqual([]);
  });
});
