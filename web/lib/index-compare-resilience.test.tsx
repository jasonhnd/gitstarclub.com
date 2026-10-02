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

// Fixed SHA-256 values captured from origin/pre b9650f0 with these fixtures.
// Only ko/categories is refreshed for issue #612: intentional Korean conjunctions.
// The other 20 values retain the original pre baseline.
const baseline: Record<string, Record<string, string>> = {
  "en": {
    "org": "1497576aa088189c8dd729b7fd619df3f8701f341cc2174ae5d0dfc5a358ff35",
    "compare": "5d93bff739fcb521fdbc11d7616ed9f9e060d5370b8d354886049087fba8dd5a",
    "categories": "fca6efea4dd48ce38f234498a30e19cb43ec71733a4871ccda6d84e52cf24fe1"
  },
  "ja": {
    "org": "ecd64890c0250edd2bc159ab19ea1f26339ee107b00e2c11866a03bc8f14ecd1",
    "compare": "fb9236f2a6ce0bb1cfb430737ccd7e94c53630acb7f26a2bc07e93a5ba048a96",
    "categories": "fbceb9c0416fcd4ad4b770dccd246e836242b1b28d36e86ac76be085d87c80cb"
  },
  "zh": {
    "org": "9df66aa226821cf126d9c950b72458fef26f6181c2796e00b58de65ab1076891",
    "compare": "37255ddc56ab335d1ccc1ffd2471f2706681367060172ce00349d0af617515ce",
    "categories": "988a441d7f0357063a65a2f6e6f2a80807fc0d51069ddfc0a580c69b1401f9ac"
  },
  "zh-TW": {
    "org": "36327b33cdaae8c76056d29e7778e44ae833a3e33fdadf065e80528079737ede",
    "compare": "7229bd6404bb3c67af468b4fdaceb34ca595abf51dfae7e19b8372c01bb720ac",
    "categories": "ee525e390144e6a1cbfd0c037e20fefa84f4f407922bd58c272a0d1189d8925c"
  },
  "ko": {
    "org": "1d6fae0e39f94686e741fd041e74947ad267adb7f0c5e5e93427a5b0e4182b91",
    "compare": "8ae2ff6ef0cccb9e0f018011bca8b76aa9e7e82771b841750522b51d6b1a9961",
    "categories": "6c37f0a641aa887b228fc1bf51f3b75f02fe593c072301aa3562448ae6dd133c"
  },
  "es": {
    "org": "73f4bc08cde600816bd8757af329a6b7d7b83097606be7002df0e80be943fa8b",
    "compare": "fee00c05d424673bef0973dbd31e034de0dbdd6e6ffae6ed199387e01ed88c54",
    "categories": "a6264b0cb22648ebd5dcbc366c0b1028bf441941a3672bb8bbd6c4cfdba94b39"
  },
  "fr": {
    "org": "ea4d509ec2c5e611c10cb2f13414c7d4b70f4dc692b93495e3339e275958728a",
    "compare": "8fc2c2c27e922620420aed836db845e3dc19c8a4c6970d5cd3c1b6c42f3c0a59",
    "categories": "bd8493a6c441816fa1ccd1f9725c762cd2a437dc1feb88c2359130190b7a7cf1"
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
